// A local stand-in for the API, for the smoke tests: the built package makes
// real HTTP requests to it. Paths pick the scenario:
//   /ok/...     a resolve / bulk success
//   /fail/...   401 UNAUTHORIZED
//   /retry/...  429 RATE_LIMIT_EXCEEDED (Retry-After: 0) once, then success
//   /slow/...   never answers (the client's timeout must fire)
import { createServer } from "node:http";

const item = {
    sku: "A",
    product_group: null,
    base_price: 10,
    quantity: 2,
    final_price: 9.5,
    applied_rule: null,
    match_reason: "NO_RULE",
    pricing_summary: { savings: 0.5, message: "Customer saved 0.50 due to active pricing rules" },
};

const envelope = (data) => ({
    mode: "business",
    as_of: "2026-10-22",
    time_zone: "UTC",
    success: true,
    data,
    billing: { limit: 1000, usage: 1, remaining: 999 },
    meta: { request_id: "req_smoke", processing_ms: 1 },
});

export async function startServer() {
    const seen = [];
    const hits = new Map();

    const server = createServer((req, res) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
            seen.push({ url: req.url, userAgent: req.headers["user-agent"], authorization: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
            const [, scenario] = req.url.split("/");
            hits.set(scenario, (hits.get(scenario) ?? 0) + 1);
            const send = (status, body, headers = {}) => {
                res.writeHead(status, { "Content-Type": "application/json", "X-Request-Id": "req_smoke", ...headers });
                res.end(JSON.stringify(body));
            };
            const success = () =>
                send(200, req.url.endsWith("/bulk") ? envelope([{ customer: null, warnings: [], items: [item] }]) : envelope({ customer: null, warnings: [], items: [item] }));

            if (scenario === "ok") return success();
            if (scenario === "fail") {
                return send(401, { success: false, error: { code: "UNAUTHORIZED", message: "Invalid or missing API key." }, meta: { request_id: "req_smoke" } });
            }
            if (scenario === "retry") {
                if (hits.get("retry") === 1) {
                    return send(
                        429,
                        { success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "Slow down." }, meta: { request_id: "req_smoke" } },
                        { "Retry-After": "0" },
                    );
                }
                return success();
            }
            // "slow": never answer.
        });
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    return {
        origin: `http://127.0.0.1:${port}`,
        seen,
        hits,
        close: () => {
            server.closeAllConnections?.();
            return new Promise((resolve) => server.close(resolve));
        },
    };
}

/**
 * The checks every runtime runs against the built package. Self-contained
 * (no closure, no imports): the edge smoke test evaluates its source inside
 * the edge runtime.
 */
export async function smokeChecks(sdk, origin) {
    const { PriceRules, PriceRulesError, PriceRulesTimeoutError } = sdk;
    const check = (condition, what) => {
        if (!condition) throw new Error(`smoke check failed: ${what}`);
    };
    const client = (path, options = {}) => new PriceRules({ apiKey: "sk_smoke", baseUrl: `${origin}${path}/api/v1`, ...options });
    const products = [{ sku: "A", quantity: 2 }];
    const caught = async (promise) => {
        try {
            await promise;
        } catch (error) {
            return error;
        }
        return undefined;
    };

    const res = await client("/ok").resolve({ customerId: "ACME", products, asOf: "2026-10-22" });
    check(res.success === true && res.data.items[0].final_price === 9.5 && res.meta.request_id === "req_smoke", "resolve returns the body");

    const bulk = await client("/ok").resolveBulk({ requests: [{ customerId: "ACME", products }] });
    check(Array.isArray(bulk.data) && bulk.data[0].items[0].sku === "A", "resolveBulk returns the body");

    const unauthorized = await caught(client("/fail").resolve({ products }));
    check(
        unauthorized instanceof PriceRulesError && unauthorized.status === 401 && unauthorized.code === "UNAUTHORIZED" && unauthorized.requestId === "req_smoke",
        "a 401 becomes a PriceRulesError",
    );

    const retried = await client("/retry").resolve({ products });
    check(retried.success === true, "a 429 is retried after Retry-After");

    const timedOut = await caught(client("/slow", { timeout: 100 }).resolve({ products }));
    check(timedOut instanceof PriceRulesTimeoutError && timedOut.code === "TIMEOUT", "a slow answer times out");

    return sdk.VERSION;
}

/** What the server must have seen, whatever the runtime. */
export function checkRequests(seen, version, runtime) {
    const fail = (what) => {
        throw new Error(`smoke check failed: ${what}`);
    };
    const first = seen[0] ?? fail("no request reached the server");
    if (first.url !== "/ok/api/v1/pricing/resolve") fail(`resolve URL ${first.url}`);
    if (first.authorization !== "Bearer sk_smoke") fail("Authorization header");
    if (!new RegExp(`^pricerules-node/${version.replace(/\./g, "\\.")} \\(${runtime}`).test(first.userAgent ?? "")) {
        fail(`User-Agent ${first.userAgent} (expected pricerules-node/${version} (${runtime}…))`);
    }
    if (JSON.stringify(first.body) !== JSON.stringify({ customer_id: "ACME", products: [{ sku: "A", quantity: 2 }], as_of: "2026-10-22" })) {
        fail(`body ${JSON.stringify(first.body)}`);
    }
    if (seen[1]?.url !== "/ok/api/v1/pricing/resolve/bulk") fail("bulk URL");
    if (seen.filter((request) => request.url.startsWith("/retry")).length !== 2) fail("the 429 was retried once");
}
