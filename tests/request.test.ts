import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_BASE_URL, PriceRules, PriceRulesError, VERSION } from "../src/index";
import { okReply, testClient } from "./helpers";

describe("request building", () => {
    it("posts resolve to the API with the key, JSON and a User-Agent", async () => {
        const { client, calls } = testClient([okReply()]);
        await client.resolve({ customerId: "ACME-BUILD", products: [{ sku: "VLV-304", quantity: 120 }] });

        assert.equal(calls.length, 1);
        const [call] = calls;
        assert.equal(call!.url, `${DEFAULT_BASE_URL}/pricing/resolve`);
        assert.equal(call!.init.method, "POST");
        assert.equal(call!.init.headers.Authorization, "Bearer sk_test_123");
        assert.equal(call!.init.headers["Content-Type"], "application/json");
        assert.equal(call!.init.headers.Accept, "application/json");
        assert.match(call!.init.headers["User-Agent"]!, new RegExp(`^pricerules-node/${VERSION.replace(/\./g, "\\.")} \\(node/\\d+\\.\\d+\\.\\d+\\)$`));
    });

    it("sends the API's snake_case fields, leaving out the ones not given", async () => {
        const { client, calls } = testClient([okReply(), okReply()]);
        await client.resolve({ customerId: "ACME", products: [{ sku: "A", quantity: 2 }], mode: "best_price", asOf: "2026-12-01" });
        await client.resolve({ products: [{ sku: "A" }] });

        assert.deepEqual(calls[0]!.body, { customer_id: "ACME", products: [{ sku: "A", quantity: 2 }], mode: "best_price", as_of: "2026-12-01" });
        assert.deepEqual(calls[1]!.body, { products: [{ sku: "A" }] });
    });

    it("sends only sku and quantity of each product", async () => {
        const { client, calls } = testClient([okReply()]);
        const product = { sku: "A", quantity: 1, name: "Valve", internalId: 7 };
        await client.resolve({ products: [product] });
        assert.deepEqual(calls[0]!.body.products, [{ sku: "A", quantity: 1 }]);
    });

    it("sends a Date asOf as its UTC time", async () => {
        const { client, calls } = testClient([okReply()]);
        await client.resolve({ products: [{ sku: "A" }], asOf: new Date(Date.UTC(2026, 11, 1, 9, 30)) });
        assert.equal(calls[0]!.body.as_of, "2026-12-01T09:30:00.000Z");
        await assert.rejects(client.resolve({ products: [{ sku: "A" }], asOf: new Date("nope") }), TypeError);
    });

    it("posts bulk requests in order, each with customer_id and products", async () => {
        const { client, calls } = testClient([okReply([])]);
        await client.resolveBulk({
            requests: [{ customerId: "ACME", products: [{ sku: "A", quantity: 3 }] }, { products: [{ sku: "B" }] }],
            mode: "business",
            asOf: "2026-12-01",
        });
        assert.equal(calls[0]!.url, `${DEFAULT_BASE_URL}/pricing/resolve/bulk`);
        assert.deepEqual(calls[0]!.body, {
            requests: [{ customer_id: "ACME", products: [{ sku: "A", quantity: 3 }] }, { products: [{ sku: "B" }] }],
            mode: "business",
            as_of: "2026-12-01",
        });
    });

    it("rejects products / requests that aren't arrays before sending", async () => {
        const { client, calls } = testClient([okReply()]);
        await assert.rejects(client.resolve({ products: undefined as never }), /`products` must be an array/);
        await assert.rejects(client.resolveBulk({ requests: [{ products: "A" as never }] }), /`requests\[0\]\.products` must be an array/);
        await assert.rejects(client.resolveBulk({} as never), /`requests` must be an array/);
        assert.equal(calls.length, 0);
    });

    it("uses baseUrl without a trailing slash", async () => {
        const { client, calls } = testClient([okReply()], { baseUrl: "http://localhost:3000/api/v1/" });
        await client.resolve({ products: [{ sku: "A" }] });
        assert.equal(calls[0]!.url, "http://localhost:3000/api/v1/pricing/resolve");
    });

    it("returns the response body unchanged", async () => {
        const reply = okReply({ customer: null, warnings: [], items: [] });
        const { client } = testClient([reply]);
        const res = await client.resolve({ products: [{ sku: "A" }] });
        assert.deepEqual(res, (reply as { body: unknown }).body);
    });
});

describe("options", () => {
    const saved = process.env.PRICERULES_API_KEY;
    afterEach(() => {
        if (saved === undefined) delete process.env.PRICERULES_API_KEY;
        else process.env.PRICERULES_API_KEY = saved;
    });

    it("reads the key from PRICERULES_API_KEY by default; apiKey wins", async () => {
        process.env.PRICERULES_API_KEY = "sk_from_env";
        const seen: string[] = [];
        const fetch = async (_url: string, init: { headers: Record<string, string> }) => {
            seen.push(init.headers.Authorization!);
            return new Response(JSON.stringify((okReply() as { body: unknown }).body), { status: 200 });
        };
        await new PriceRules({ fetch }).resolve({ products: [{ sku: "A" }] });
        await new PriceRules({ fetch, apiKey: "sk_explicit" }).resolve({ products: [{ sku: "A" }] });
        assert.deepEqual(seen, ["Bearer sk_from_env", "Bearer sk_explicit"]);
    });

    it("throws MISSING_API_KEY without a key", () => {
        delete process.env.PRICERULES_API_KEY;
        assert.throws(
            () => new PriceRules(),
            (error: unknown) => error instanceof PriceRulesError && error.code === "MISSING_API_KEY" && /PRICERULES_API_KEY/.test(error.message),
        );
        process.env.PRICERULES_API_KEY = "";
        assert.throws(() => new PriceRules(), { code: "MISSING_API_KEY" });
    });

    it("defaults to a 10 s timeout and 2 retries; rejects invalid values", () => {
        const client = new PriceRules({ apiKey: "k" });
        assert.equal(client.timeout, 10_000);
        assert.equal(client.maxRetries, 2);
        assert.equal(client.baseUrl, "https://pricerules.app/api/v1");
        assert.throws(() => new PriceRules({ apiKey: "k", timeout: 0 }), TypeError);
        assert.throws(() => new PriceRules({ apiKey: "k", timeout: Number.NaN }), TypeError);
        assert.throws(() => new PriceRules({ apiKey: "k", maxRetries: -1 }), TypeError);
        assert.throws(() => new PriceRules({ apiKey: "k", maxRetries: 1.5 }), TypeError);
    });

    it("never puts the key in the client's enumerable fields", () => {
        const client = new PriceRules({ apiKey: "sk_secret" });
        assert.doesNotMatch(JSON.stringify(client), /sk_secret/);
    });
});

describe("browser guard", () => {
    const g = globalThis as { window?: unknown };
    afterEach(() => {
        delete g.window;
    });

    it("refuses to run in a browser page", () => {
        g.window = { document: {} };
        assert.throws(
            () => new PriceRules({ apiKey: "k" }),
            (error: unknown) => error instanceof PriceRulesError && error.code === "BROWSER_NOT_ALLOWED" && /dangerouslyAllowBrowser/.test(error.message),
        );
    });

    it("runs there only with dangerouslyAllowBrowser", () => {
        g.window = { document: {} };
        assert.doesNotThrow(() => new PriceRules({ apiKey: "k", dangerouslyAllowBrowser: true }));
    });

    it("isn't fooled by a window without a document (Deno 1, workers)", () => {
        g.window = {};
        assert.doesNotThrow(() => new PriceRules({ apiKey: "k" }));
    });
});

describe("version", () => {
    it("VERSION matches package.json (npm run version:sync)", () => {
        const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
        assert.equal(VERSION, pkg.version);
    });
});
