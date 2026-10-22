import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PriceRules, PriceRulesError } from "../src/index";
import { parseRetryAfter, retryDelayMs } from "../src/retry";
import { errorReply, okReply, scriptedFetch, testClient } from "./helpers";

const resolve = (client: PriceRules) => client.resolve({ products: [{ sku: "A" }] });

describe("retries", () => {
    it("retries 429 RATE_LIMIT_EXCEEDED after Retry-After, then succeeds", async () => {
        const { client, calls } = testClient([errorReply(429, "RATE_LIMIT_EXCEEDED", { headers: { "Retry-After": "2" } }), okReply()]);
        const res = await resolve(client);
        assert.equal(res.success, true);
        assert.equal(calls.length, 2);
        assert.deepEqual(client.sleeps, [2000]);
    });

    it("retries 503, 502, 504 and connection errors with backoff", async () => {
        const { client, calls } = testClient(
            [errorReply(503, "PRICING_ENGINE_UNAVAILABLE"), { throws: new TypeError("fetch failed") }, okReply()],
            { maxRetries: 2 },
        );
        await resolve(client);
        assert.equal(calls.length, 3);
        assert.equal(client.sleeps.length, 2);
        assert.ok(client.sleeps[0]! >= 250 && client.sleeps[0]! <= 500, `first wait ${client.sleeps[0]}`);
        assert.ok(client.sleeps[1]! >= 500 && client.sleeps[1]! <= 1000, `second wait ${client.sleeps[1]}`);

        for (const status of [502, 504]) {
            const gateway = testClient([{ status, body: "Bad gateway" }, okReply()]);
            await resolve(gateway.client);
            assert.equal(gateway.calls.length, 2, `HTTP ${status}`);
        }
    });

    it("gives up after maxRetries and throws the last error", async () => {
        const { client, calls } = testClient([errorReply(503, "PRICING_ENGINE_UNAVAILABLE", { requestId: "req_last" })], { maxRetries: 2 });
        await assert.rejects(resolve(client), { status: 503, code: "PRICING_ENGINE_UNAVAILABLE", requestId: "req_last" });
        assert.equal(calls.length, 3);
    });

    it("maxRetries 0 turns retries off; a call can override the client's", async () => {
        const off = testClient([errorReply(503, "PRICING_ENGINE_UNAVAILABLE"), okReply()], { maxRetries: 0 });
        await assert.rejects(resolve(off.client), { status: 503 });
        assert.equal(off.calls.length, 1);

        const perCall = testClient([errorReply(503, "PRICING_ENGINE_UNAVAILABLE")], { maxRetries: 0 });
        await assert.rejects(perCall.client.resolve({ products: [{ sku: "A" }] }, { maxRetries: 1 }), { status: 503 });
        assert.equal(perCall.calls.length, 2);
    });

    const neverRetried: [number, string][] = [
        [400, "INVALID_JSON"],
        [400, "VALIDATION_ERROR"],
        [401, "UNAUTHORIZED"],
        [422, "MAX_PRODUCTS_EXCEEDED"],
        [422, "MAX_REQUESTS_EXCEEDED"],
        [429, "MONTHLY_LIMIT_REACHED"],
        [500, "INTERNAL_ERROR"],
    ];
    for (const [status, code] of neverRetried) {
        it(`never retries ${status} ${code}`, async () => {
            const { client, calls } = testClient([errorReply(status, code), okReply()], { maxRetries: 2 });
            await assert.rejects(resolve(client), { status, code });
            assert.equal(calls.length, 1);
            assert.deepEqual(client.sleeps, []);
        });
    }

    it("doesn't wait out a Retry-After over 60 s: throws with retryAfter", async () => {
        const { client, calls } = testClient([errorReply(429, "RATE_LIMIT_EXCEEDED", { headers: { "Retry-After": "120" } }), okReply()]);
        await assert.rejects(resolve(client), { code: "RATE_LIMIT_EXCEEDED", retryAfter: 120 });
        assert.equal(calls.length, 1);
    });

    it("an abort during the retry wait stops with ABORTED", async () => {
        const { fetch, calls } = scriptedFetch([errorReply(429, "RATE_LIMIT_EXCEEDED", { headers: { "Retry-After": "30" } }), okReply()]);
        const client = new PriceRules({ apiKey: "k", fetch });
        const controller = new AbortController();
        const pending = client.resolve({ products: [{ sku: "A" }] }, { signal: controller.signal });
        setTimeout(() => controller.abort(), 20);
        await assert.rejects(pending, (error: unknown) => error instanceof PriceRulesError && error.code === "ABORTED");
        assert.equal(calls.length, 1);
    });
});

describe("backoff and Retry-After", () => {
    it("doubles from 0.5 s up to 8 s, with jitter in the upper half", () => {
        const low = [0, 1, 2, 3, 4, 5, 6].map((retry) => retryDelayMs(retry, new Error(), () => 0));
        const high = [0, 1, 2, 3, 4, 5, 6].map((retry) => retryDelayMs(retry, new Error(), () => 1));
        assert.deepEqual(low, [250, 500, 1000, 2000, 4000, 4000, 4000]);
        assert.deepEqual(high, [500, 1000, 2000, 4000, 8000, 8000, 8000]);
    });

    it("uses Retry-After when the error has one", () => {
        const error = new PriceRulesError({ code: "RATE_LIMIT_EXCEEDED", message: "", status: 429, retryAfter: 3 });
        assert.equal(retryDelayMs(0, error), 3000);
        assert.equal(retryDelayMs(1, new PriceRulesError({ ...error, code: "X", message: "", retryAfter: 0 })), 0);
    });

    it("reads Retry-After as seconds or an HTTP date", () => {
        const headers = (value: string | null) => ({ get: (name: string) => (name.toLowerCase() === "retry-after" ? value : null) });
        const now = Date.parse("2026-10-22T12:00:00Z");
        assert.equal(parseRetryAfter(headers("5"), now), 5);
        assert.equal(parseRetryAfter(headers(" 0 "), now), 0);
        assert.equal(parseRetryAfter(headers("Thu, 22 Oct 2026 12:00:09 GMT"), now), 9);
        assert.equal(parseRetryAfter(headers("Thu, 22 Oct 2026 11:00:00 GMT"), now), 0);
        assert.equal(parseRetryAfter(headers("soon"), now), undefined);
        assert.equal(parseRetryAfter(headers(null), now), undefined);
    });
});
