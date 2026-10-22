import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, PriceRulesConnectionError, PriceRulesError, PriceRulesTimeoutError } from "../src/index";
import { ERROR_STATUSES, errorReply, testClient } from "./helpers";

describe("API errors", () => {
    for (const code of ERROR_CODES) {
        const status = ERROR_STATUSES[code];

        it(`${status} ${code} becomes a PriceRulesError with status, code, message, details and requestId`, async () => {
            const details = { example: code };
            const { client } = testClient([errorReply(status, code, { message: `The ${code} message.`, details, requestId: `req_${code}` })], {
                maxRetries: 0,
            });

            const error = await client.resolve({ products: [{ sku: "A" }] }).then(
                () => assert.fail("expected an error"),
                (e: unknown) => e,
            );

            assert.ok(error instanceof PriceRulesError);
            assert.equal(error.name, "PriceRulesError");
            assert.equal(error.status, status);
            assert.equal(error.code, code);
            assert.equal(error.message, `The ${code} message.`);
            assert.deepEqual(error.details, details);
            assert.equal(error.requestId, `req_${code}`);
            assert.equal(error.headers?.get("x-request-id"), `req_${code}`);
        });
    }

    it("keeps VALIDATION_ERROR's issues in details", async () => {
        const issues = [{ path: "products.0.quantity", message: "Too small" }];
        const { client } = testClient([errorReply(400, "VALIDATION_ERROR", { details: { issues } })]);
        await assert.rejects(client.resolve({ products: [{ sku: "A", quantity: 0 }] }), (error: PriceRulesError) => {
            assert.deepEqual(error.details, { issues });
            return true;
        });
    });

    it("reads Retry-After on a 429", async () => {
        const { client } = testClient([errorReply(429, "RATE_LIMIT_EXCEEDED", { headers: { "Retry-After": "7" } })], { maxRetries: 0 });
        await assert.rejects(client.resolve({ products: [{ sku: "A" }] }), { code: "RATE_LIMIT_EXCEEDED", retryAfter: 7 });
    });

    it("keeps a code the SDK doesn't know yet", async () => {
        const { client } = testClient([errorReply(409, "SOMETHING_NEW")]);
        await assert.rejects(client.resolve({ products: [{ sku: "A" }] }), { status: 409, code: "SOMETHING_NEW" });
    });

    it("falls back to the X-Request-Id header when the body has no meta", async () => {
        const { client } = testClient([
            { status: 400, headers: { "X-Request-Id": "req_header" }, body: { success: false, error: { code: "INVALID_JSON", message: "Bad JSON" } } },
        ]);
        await assert.rejects(client.resolve({ products: [{ sku: "A" }] }), { code: "INVALID_JSON", requestId: "req_header" });
    });

    it("an error without the API's body (a gateway page) is UNEXPECTED_RESPONSE with the status", async () => {
        const { client } = testClient([{ status: 413, body: "<html>Request Entity Too Large</html>" }]);
        await assert.rejects(client.resolve({ products: [{ sku: "A" }] }), (error: PriceRulesError) => {
            assert.equal(error.code, "UNEXPECTED_RESPONSE");
            assert.equal(error.status, 413);
            assert.match(error.message, /HTTP 413/);
            return true;
        });
    });

    it("a 200 that isn't a JSON success body is UNEXPECTED_RESPONSE", async () => {
        for (const body of ["not json", { success: false }, ""]) {
            const { client } = testClient([{ status: 200, body }]);
            await assert.rejects(client.resolve({ products: [{ sku: "A" }] }), { code: "UNEXPECTED_RESPONSE", status: 200 });
        }
    });

    it("a network failure is a PriceRulesConnectionError (a PriceRulesError without status)", async () => {
        const { client } = testClient([{ throws: new TypeError("fetch failed") }], { maxRetries: 0 });
        await assert.rejects(client.resolve({ products: [{ sku: "A" }] }), (error: unknown) => {
            assert.ok(error instanceof PriceRulesConnectionError);
            assert.ok(error instanceof PriceRulesError);
            assert.equal(error.code, "CONNECTION_ERROR");
            assert.equal(error.status, undefined);
            assert.match(error.message, /fetch failed/);
            assert.ok(error.cause instanceof TypeError);
            return true;
        });
    });

    it("timeout errors are PriceRulesErrors too", () => {
        const error = new PriceRulesTimeoutError("slow");
        assert.ok(error instanceof PriceRulesError);
        assert.equal(error.code, "TIMEOUT");
    });
});
