import { PriceRules, type ApiErrorCode, type FetchInit, type FetchLike, type PriceRulesOptions } from "../src/index";

/** Each public error code with the status the API sends it with (tests/contract.test.ts checks it against the app). */
export const ERROR_STATUSES: Record<ApiErrorCode, number> = {
    INVALID_JSON: 400,
    VALIDATION_ERROR: 400,
    UNAUTHORIZED: 401,
    MAX_PRODUCTS_EXCEEDED: 422,
    MAX_REQUESTS_EXCEEDED: 422,
    RATE_LIMIT_EXCEEDED: 429,
    MONTHLY_LIMIT_REACHED: 429,
    INTERNAL_ERROR: 500,
    PRICING_ENGINE_UNAVAILABLE: 503,
};

/*
 * A scripted fetch: each call takes the next reply. Nothing reaches the
 * network; `calls` records what the SDK sent.
 */

export type Reply =
    | { status: number; body?: unknown; headers?: Record<string, string> }
    | { throws: unknown }
    /** Never answers; rejects like fetch does when the request's signal aborts. */
    | { hang: true };

export type Call = { url: string; init: FetchInit; body: any };

export function scriptedFetch(replies: Reply[]) {
    const calls: Call[] = [];
    const fetch: FetchLike = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
        if (!reply) throw new Error("scriptedFetch: no reply scripted");
        if ("throws" in reply) throw reply.throws;
        if ("hang" in reply) {
            return new Promise((_, reject) => {
                const abort = () => reject(new DOMException("This operation was aborted", "AbortError"));
                if (init.signal.aborted) abort();
                init.signal.addEventListener("abort", abort, { once: true });
            });
        }
        const text = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
        return new Response(text, { status: reply.status, headers: reply.headers });
    };
    return { fetch, calls };
}

/** A client whose retry waits are recorded instead of slept. */
export class TestClient extends PriceRules {
    readonly sleeps: number[] = [];

    protected override sleep(ms: number): Promise<void> {
        this.sleeps.push(ms);
        return Promise.resolve();
    }
}

export function testClient(replies: Reply[], options: PriceRulesOptions = {}) {
    const { fetch, calls } = scriptedFetch(replies);
    const client = new TestClient({ apiKey: "sk_test_123", fetch, ...options });
    return { client, calls };
}

/** An error body in the API's one format. */
export function errorReply(
    status: number,
    code: string,
    options: { message?: string; details?: Record<string, unknown>; headers?: Record<string, string>; requestId?: string } = {},
): Reply {
    const requestId = options.requestId ?? "req_test";
    return {
        status,
        headers: { "Content-Type": "application/json", "X-Request-Id": requestId, ...options.headers },
        body: {
            success: false,
            error: { code, message: options.message ?? `${code} message`, ...(options.details ? { details: options.details } : {}) },
            meta: { request_id: requestId },
        },
    };
}

/** A minimal success body (the contract test checks the full shape). */
export function okReply(data: unknown = { customer: null, warnings: [], items: [] }): Reply {
    return {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-Id": "req_ok" },
        body: {
            mode: "business",
            as_of: "2026-10-22",
            time_zone: "UTC",
            success: true,
            data,
            billing: { limit: 1000, usage: 1, remaining: 999 },
            meta: { request_id: "req_ok", processing_ms: 1.5 },
        },
    };
}
