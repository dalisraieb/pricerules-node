/*
 * The SDK against the app's API contract (contract/api-contract.json, copied
 * from the price repo by `npm run sync:contract`). The types are checked by
 * `npm run typecheck` through tests/contract/fixtures.generated.ts; this
 * checks the value lists, the requests the SDK sends and how it reads every
 * example response and error.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    CUSTOMER_TARGET_TYPES,
    ERROR_CODES,
    MATCH_REASONS,
    PRICING_MODES,
    PRODUCT_TARGET_TYPES,
    PriceRulesError,
    RULE_TYPES,
    SKIP_REASONS,
    WARNING_CODES,
    type ResolveBulkParams,
    type ResolveParams,
} from "../src/index";
import { CONTRACT_COPY, FIXTURES, fixturesSource, readText, type ApiContract } from "../scripts/contract";
import { ERROR_STATUSES, testClient } from "./helpers";

const text = readText(CONTRACT_COPY);
if (text === null) throw new Error(`${CONTRACT_COPY} is missing: run npm run sync:contract (needs the price repo next to this one).`);
const contract = JSON.parse(text) as ApiContract;

type ApiProducts = { sku: string; quantity?: number }[];
type ApiRequest = { customer_id?: string; products: ApiProducts };

/** The SDK call that should send this API body (the SDK's camelCase params). */
const resolveParams = (body: Record<string, unknown>): ResolveParams => {
    const { customer_id, products, mode, as_of } = body as ApiRequest & { mode?: ResolveParams["mode"]; as_of?: string };
    return { customerId: customer_id, products, mode, asOf: as_of };
};

const bulkParams = (body: Record<string, unknown>): ResolveBulkParams => {
    const { requests, mode, as_of } = body as { requests: ApiRequest[]; mode?: ResolveParams["mode"]; as_of?: string };
    return { requests: requests.map((r) => ({ customerId: r.customer_id, products: r.products })), mode, asOf: as_of };
};

describe("API contract", () => {
    it("the typed fixtures are generated from the contract copy", () => {
        assert.equal(readText(FIXTURES), fixturesSource(contract), "Stale tests/contract/fixtures.generated.ts: run npm run sync:contract");
    });

    it("the SDK's value lists are the API's", () => {
        assert.deepEqual([...MATCH_REASONS], contract.match_reasons, "MATCH_REASONS");
        assert.deepEqual([...WARNING_CODES], contract.warning_codes, "WARNING_CODES");
        assert.deepEqual([...PRICING_MODES], contract.pricing_modes, "PRICING_MODES");
        assert.deepEqual([...RULE_TYPES], contract.rule_types, "RULE_TYPES");
        assert.deepEqual([...SKIP_REASONS], contract.skip_reasons, "SKIP_REASONS");
        assert.deepEqual([...CUSTOMER_TARGET_TYPES], contract.customer_target_types, "CUSTOMER_TARGET_TYPES");
        assert.deepEqual([...PRODUCT_TARGET_TYPES], contract.product_target_types, "PRODUCT_TARGET_TYPES");
        assert.deepEqual([...ERROR_CODES], contract.error_codes.map((e) => e.code), "ERROR_CODES");
        assert.deepEqual(
            contract.error_codes.map((e) => [e.code, ERROR_STATUSES[e.code as keyof typeof ERROR_STATUSES]]),
            contract.error_codes.map((e) => [e.code, e.status]),
            "statuses (tests/helpers.ts ERROR_STATUSES)",
        );
    });

    it("the examples cover every match_reason and error code", () => {
        const items = [
            ...contract.examples.resolve.flatMap((e) => (e.response as { data: { items: { match_reason: string }[] } }).data.items),
            ...contract.examples.resolve_bulk.flatMap((e) => (e.response as { data: { items: { match_reason: string }[] }[] }).data.flatMap((d) => d.items)),
        ];
        assert.deepEqual([...new Set(items.map((i) => i.match_reason))].sort(), [...MATCH_REASONS].sort());
        assert.deepEqual(
            [...new Set(contract.examples.errors.map((e) => (e.body as { error: { code: string } }).error.code))].sort(),
            [...ERROR_CODES].sort(),
        );
    });

    for (const example of contract.examples.resolve) {
        it(`resolve: ${example.name}`, async () => {
            const { client, calls } = testClient([{ status: example.status, body: example.response }]);
            const response = await client.resolve(resolveParams(example.request));
            assert.deepEqual(calls[0]!.body, example.request, "the SDK sends the API's request body");
            assert.deepEqual(response, example.response, "the response comes back unchanged");
        });
    }

    for (const example of contract.examples.resolve_bulk) {
        it(`resolve bulk: ${example.name}`, async () => {
            const { client, calls } = testClient([{ status: example.status, body: example.response }]);
            const response = await client.resolveBulk(bulkParams(example.request));
            assert.deepEqual(calls[0]!.body, example.request, "the SDK sends the API's request body");
            assert.deepEqual(response, example.response, "the response comes back unchanged");
        });
    }

    for (const example of contract.examples.errors) {
        it(`error: ${example.name}`, async () => {
            const body = example.body as { error: { code: string; message: string; details?: Record<string, unknown> }; meta: { request_id: string } };
            const { client } = testClient([{ status: example.status, headers: example.headers, body }], { maxRetries: 0 });
            await assert.rejects(client.resolve({ products: [{ sku: "A" }] }), (error: unknown) => {
                assert.ok(error instanceof PriceRulesError);
                assert.equal(error.status, example.status);
                assert.equal(error.code, body.error.code);
                assert.equal(error.message, body.error.message);
                assert.deepEqual(error.details, body.error.details);
                assert.equal(error.requestId, body.meta.request_id);
                const retryAfter = example.headers["Retry-After"];
                assert.equal(error.retryAfter, retryAfter === undefined ? undefined : Number(retryAfter));
                return true;
            });
        });
    }
});
