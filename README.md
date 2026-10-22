# PriceRules TypeScript SDK

The official TypeScript client for the [PriceRules](https://pricerules.app) API: ask what a customer pays for a SKU at a quantity, from your server.

It's a thin, typed wrapper around the public API: no runtime dependencies, native `fetch`, ESM and CommonJS, with retries where they're safe and a timeout.

## Install

```bash
npm install pricerules
```

Node 18 or later. It also runs in edge runtimes (Vercel Edge), since it only needs `fetch`.

## Quickstart

```ts
import { PriceRules } from "pricerules";

const pricerules = new PriceRules({ apiKey: process.env.PRICERULES_API_KEY });

const { data } = await pricerules.resolve({
  customerId: "ACME-BUILD",
  products: [{ sku: "VLV-304", quantity: 120 }],
});

for (const item of data.items) console.log(item.sku, item.final_price, item.match_reason);
```

Create an API key on the **API** page of the PriceRules dashboard and set it as `PRICERULES_API_KEY` in your server's environment.

## API keys stay on the server

An API key can price every customer and product in your workspace. Use the SDK in server code only (API routes, backend services, edge functions), never in a browser page. The client refuses to start in a browser unless you pass `dangerouslyAllowBrowser: true`, and you shouldn't. Have your page call your own backend, and let the backend call PriceRules.

## Resolving prices

### One customer: `resolve`

```ts
const res = await pricerules.resolve({
  customerId: "ACME-BUILD",          // optional: without it, only rules for every customer apply
  products: [
    { sku: "VLV-304", quantity: 120 },
    { sku: "FAS-1001" },             // quantity defaults to 1
  ],
  mode: "business",                  // optional: "business" (default) or "best_price"
  asOf: "2026-12-01",                // optional: price as of this day (default: today)
});
```

- `products`: 1 to 500 per request.
- `asOf`: a `YYYY-MM-DD` day in your workspace's time zone, an RFC 3339 time with an offset, or a `Date`.

### Several customers in one call: `resolveBulk`

```ts
const res = await pricerules.resolveBulk({
  requests: [
    { customerId: "ACME-BUILD", products: [{ sku: "VLV-304", quantity: 120 }] },
    { customerId: "SHOP-42", products: [{ sku: "TAPE-1" }] },
  ],
  asOf: "2026-12-01",
});

res.data[0].items; // answers requests[0]
```

Up to 10 requests per call, each with up to 500 products.

### The response

You get the API's JSON exactly as the [API reference](https://pricerules.app/docs/api-reference) describes it. Field names stay in snake_case (`final_price`, `applied_rule`, `match_reason`), so the docs, the dashboard's API explorer and your logs all show the same names. Every field is typed:

```ts
const item = res.data.items[0];

if (item.match_reason === "PRODUCT_NOT_FOUND") {
  // the SKU isn't in your workspace: base_price and final_price are null
} else {
  item.final_price;               // number
  item.applied_rule?.name;        // the rule that set the price, or null
  item.applied_rule?.target;      // who and what the rule was for
  item.applied_rule?.constraints; // minimum_quantity, valid_from, valid_to
}

res.data.customer;  // { id, found, group } or null
res.data.warnings;  // e.g. CUSTOMER_NOT_FOUND: an unknown code is priced as anonymous, not an error
res.as_of;          // the day rule dates were checked against
res.billing;        // { limit, usage, remaining } for this usage period
res.meta.request_id;
```

The value lists are exported too: `MATCH_REASONS`, `ERROR_CODES`, `WARNING_CODES`, `RULE_TYPES`, `PRICING_MODES`.

## Options

```ts
const pricerules = new PriceRules({
  apiKey: process.env.PRICERULES_API_KEY,
  timeout: 10_000,
  maxRetries: 2,
});
```

| Option | Default | |
| --- | --- | --- |
| `apiKey` | `process.env.PRICERULES_API_KEY` | Your API key. Runtimes without `process.env` (such as Cloudflare Workers without `nodejs_compat`) must pass it. |
| `baseUrl` | `https://pricerules.app/api/v1` | |
| `timeout` | `10000` | Milliseconds per attempt. See [Timeouts](#timeouts). |
| `maxRetries` | `2` | Retries after a rate limit, a 502/503/504 or a connection error. `0` turns retries off. |
| `fetch` | the global `fetch` | Your own fetch implementation, for example to go through a proxy. |
| `dangerouslyAllowBrowser` | `false` | See [API keys stay on the server](#api-keys-stay-on-the-server). |

Each call also takes `{ timeout, maxRetries, signal }` as a second argument:

```ts
await pricerules.resolve(params, { timeout: 3_000, signal: AbortSignal.timeout(5_000) });
```

## Errors

Every failure throws a `PriceRulesError`:

```ts
import { PriceRules, PriceRulesError } from "pricerules";

try {
  await pricerules.resolve({ customerId: "ACME-BUILD", products });
} catch (error) {
  if (error instanceof PriceRulesError) {
    console.error(error.status, error.code, error.message, error.requestId);
    if (error.code === "VALIDATION_ERROR") console.error(error.details?.issues);
  }
  throw error;
}
```

| Property | |
| --- | --- |
| `status` | The HTTP status, or `undefined` when no response arrived |
| `code` | The API's `error.code`, or one of the SDK's own codes (below) |
| `message` | The API's message |
| `details` | The API's `error.details`, e.g. `issues` for `VALIDATION_ERROR` |
| `requestId` | `meta.request_id`. Quote it to support |
| `retryAfter` | Seconds from the `Retry-After` header (rate limits) |

| Code | Status | Retried |
| --- | --- | --- |
| `INVALID_JSON`, `VALIDATION_ERROR` | 400 | No: fix the request |
| `UNAUTHORIZED` | 401 | No: check the key |
| `MAX_PRODUCTS_EXCEEDED`, `MAX_REQUESTS_EXCEEDED` | 422 | No: split the request |
| `RATE_LIMIT_EXCEEDED` | 429 | Yes, after `Retry-After` |
| `MONTHLY_LIMIT_REACHED` | 429 | No: the period's quota is used up |
| `INTERNAL_ERROR` | 500 | No |
| `PRICING_ENGINE_UNAVAILABLE` | 503 | Yes, with backoff (nothing was priced or counted) |
| `TIMEOUT` (`PriceRulesTimeoutError`) | | No |
| `CONNECTION_ERROR` (`PriceRulesConnectionError`) | | Yes, with backoff |
| `ABORTED` | | No: your `signal` aborted the call |
| `UNEXPECTED_RESPONSE` | any | Yes when 502/503/504, otherwise no |

The constructor throws `MISSING_API_KEY` when there is no key, and `BROWSER_NOT_ALLOWED` in a browser page.

A `CUSTOMER_NOT_FOUND`, an unknown SKU (`PRODUCT_NOT_FOUND`) or a product with no rule (`NO_RULE`) isn't an error: the call succeeds, and the warning or `match_reason` tells you.

## Retries

Failed attempts are retried, up to `maxRetries` times (default 2), only when nothing was priced and waiting can help:

- **429 `RATE_LIMIT_EXCEEDED`**: after the `Retry-After` header's seconds. A wait over 60 seconds isn't slept: the error is thrown with `retryAfter` set.
- **502, 503, 504** (including `PRICING_ENGINE_UNAVAILABLE`) and **connection errors**: after 0.5 s, then 1 s, 2 s… (at most 8 s), with jitter.

Never retried: other 4xx errors (the request itself has to change), `MONTHLY_LIMIT_REACHED`, 500s and timeouts. An aborted `signal` also stops a retry wait.

## Timeouts

Each attempt gets `timeout` milliseconds (default 10 s), reading the response included. Past it, the call throws a `PriceRulesTimeoutError` (code `TIMEOUT`).

**Timeouts are not retried.** The server may still be processing the request, and possibly counting it toward your usage, and your own time budget is already spent. Retry yourself if that suits you, or raise `timeout` for large requests (500 products, or a bulk call).

## Runtimes

The SDK uses only `fetch`, `AbortController` and `setTimeout`, so it runs on Node 18+ and edge runtimes. CI tests the built package on Node 18, 20 and 22 (ESM and CommonJS) and in Vercel's edge runtime. Bun, Deno and Cloudflare Workers should work too, but they aren't in CI yet.

## Versioning

[Semantic versioning](https://semver.org). The SDK is checked in CI against the API's published contract, so its types match what the API returns. See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
