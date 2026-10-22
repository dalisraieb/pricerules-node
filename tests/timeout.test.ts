import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PriceRulesError, PriceRulesTimeoutError } from "../src/index";
import { okReply, testClient } from "./helpers";

describe("timeout", () => {
    it("throws a PriceRulesTimeoutError after `timeout` ms, and doesn't retry it", async () => {
        const { client, calls } = testClient([{ hang: true }, okReply()], { timeout: 30, maxRetries: 2 });
        const started = Date.now();
        await assert.rejects(client.resolve({ products: [{ sku: "A" }] }), (error: unknown) => {
            assert.ok(error instanceof PriceRulesTimeoutError);
            assert.equal(error.code, "TIMEOUT");
            assert.equal(error.status, undefined);
            assert.match(error.message, /timed out after 30 ms \(attempt 1 of 3\)/);
            assert.match(error.message, /not retried/);
            return true;
        });
        assert.ok(Date.now() - started < 2000);
        assert.equal(calls.length, 1);
    });

    it("a call's timeout overrides the client's", async () => {
        const { client } = testClient([{ hang: true }], { timeout: 60_000 });
        await assert.rejects(client.resolve({ products: [{ sku: "A" }] }, { timeout: 20 }), /timed out after 20 ms/);
    });

    it("a caller's abort is ABORTED, not a timeout", async () => {
        const { client } = testClient([{ hang: true }], { timeout: 60_000 });
        const controller = new AbortController();
        const pending = client.resolve({ products: [{ sku: "A" }] }, { signal: controller.signal });
        setTimeout(() => controller.abort(), 10);
        await assert.rejects(pending, (error: unknown) => error instanceof PriceRulesError && !(error instanceof PriceRulesTimeoutError) && error.code === "ABORTED");
    });

    it("an already-aborted signal sends nothing", async () => {
        const { client, calls } = testClient([okReply()]);
        await assert.rejects(client.resolve({ products: [{ sku: "A" }] }, { signal: AbortSignal.abort() }), { code: "ABORTED" });
        assert.equal(calls.length, 0);
    });
});
