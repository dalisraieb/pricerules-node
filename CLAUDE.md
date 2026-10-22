# pricerules-node

The official TypeScript SDK for the PriceRules public API, published on npm as **`pricerules`** from the public repo `dalisraieb/pricerules-node`. It is a thin typed wrapper around two endpoints, `POST /api/v1/pricing/resolve` and `/resolve/bulk`, and not a framework: no caching, no client-side validation beyond "is this an array", no response conversion.

The API itself lives in the app, the sibling folder `../price` (private repo `dalisraieb/pricing-engine`). Its CLAUDE.md describes the endpoints; this SDK follows them.

## Commands

```bash
npm run typecheck      # src (no Node types) + tests/scripts (Node types, incl. the generated contract fixtures)
npm test               # node:test via tsx, tests/**/*.test.ts (needs Node 22+ for the glob)
npm run build          # tsup → dist/index.js (ESM), dist/index.cjs (CJS), .d.ts / .d.cts
npm run lint:package   # publint + arethetypeswrong on the packed package
npm run smoke          # the BUILT package against a local server: ESM, CJS, edge-runtime
npm run check          # all of the above (also prepublishOnly)
npm run sync:contract  # copy the app's API contract; -- --check to only compare
```

## Principles

- **Zero runtime dependencies**, native `fetch`. Nothing in `src/` may use a Node API: `tsconfig.json` has no Node types on purpose, and runtime-specific globals (`process`, `window`, `Bun`, `Deno`, `EdgeRuntime`) are read through `globalThis` in `src/runtime.ts` only.
- **Requests in camelCase, responses unchanged.** Params (`customerId`, `products`, `mode`, `asOf`) are mapped by hand to the API's snake_case in `src/client.ts`, sending only the fields the API reads. Responses are returned exactly as the API sends them (snake_case), so the docs, the dashboard's API explorer and users' logs show the same names. Never add a generic key converter.
- **Errors**: every failure is a `PriceRulesError` (`src/errors.ts`): the API's `{ success: false, error: { code, message, details }, meta: { request_id } }` becomes status / code / message / details / requestId (+ `retryAfter` from the header). No response → `PriceRulesConnectionError` (`CONNECTION_ERROR`) or `PriceRulesTimeoutError` (`TIMEOUT`); the caller's abort → `ABORTED`; a body that isn't the API's format → `UNEXPECTED_RESPONSE`.
- **Retries** (`src/retry.ts`) only where nothing was priced and waiting helps: 429 `RATE_LIMIT_EXCEEDED` (after `Retry-After`; over 60 s → thrown), 502/503/504, connection errors; exponential backoff 0.5 s → 8 s with jitter. Never: other 4xx, `MONTHLY_LIMIT_REACHED`, 500, timeouts (the request may still be processed and counted; documented in the README). The app counts usage only after a successful resolve, so a 503 is never charged.
- **Browser**: the constructor refuses a page (`window.document`) unless `dangerouslyAllowBrowser`.
- `User-Agent: pricerules-node/<VERSION> (<runtime>)`. `src/version.ts` is generated from package.json (`npm run version:sync`, run by `npm version`); a test fails when they differ.

## Keeping the types in sync with the API

The app is the source of truth. It generates **`contract/api-contract.json`** (app: `npm run contract:generate`, built by its `tests/contract/api-contract.test.ts` from the **real** resolve routes): every `match_reason`, error code + status, warning code, mode, rule type, skip reason and target type, plus example responses that cover every `match_reason` and an example error for every code.

`npm run sync:contract` (`scripts/sync-contract.ts`, the same idea as price-worker's `sync:shared`) copies it to `contract/api-contract.json` here and generates `tests/contract/fixtures.generated.ts`, where every example is written as an object literal `satisfies` the SDK's own types. Never edit either by hand.

Drift fails in three places:
- `npm run typecheck`: a field the API sends that the types lack, a required field it no longer sends, or a different type (excess-property and assignability checks on the fixtures).
- `tests/contract.test.ts`: `MATCH_REASONS`, `ERROR_CODES` (and `ERROR_STATUSES` in `tests/helpers.ts`), `WARNING_CODES`, `PRICING_MODES`, `RULE_TYPES`, `SKIP_REASONS` and the target types must equal the contract's lists; the SDK must send each example's exact request body and turn each error example into the right `PriceRulesError`; the fixtures must match the copy.
- CI's `contract` job: `sync:contract -- --check` against the app's `master` on every push / PR and **nightly**, so an API change the SDK hasn't followed fails here even if nobody touches the SDK. (The app's own CI runs the same check and only warns.)

After an API change: in the app, `npm run contract:generate` and merge; here, `npm run sync:contract` (with `../price` on that commit, or `PRICE_REPO=<path>`), update `src/types.ts` (and the README if users see it) until `npm run check` passes, add a CHANGELOG entry, release. An additive field is a minor version; removing or retyping one is a breaking change.

## CI

`.github/workflows/ci.yml`: `check` (Node 22: typecheck, tests, build, package lint), `smoke-node` (the built package on Node 18 / 20 / 22, no install), `smoke-edge` (Vercel's edge-runtime), `contract` (needs the secret **`CROSS_REPO_TOKEN`**: fine-grained, Contents read-only on `dalisraieb/pricing-engine` only; skipped for fork PRs). Bun, Deno and Cloudflare Workers aren't in CI yet.

## Releasing

1. Move the CHANGELOG's `## [x.y.z] - Unreleased` heading to today's date (add the link at the bottom).
2. `npm version <patch|minor|major>` (bumps package.json, regenerates `src/version.ts`, commits, tags `vX.Y.Z`).
3. `git push --follow-tags`. `.github/workflows/release.yml` checks the tag matches package.json and the CHANGELOG has the section, runs `npm run check`, publishes with provenance (`-` in the version → dist-tag `next`) and creates the GitHub release from the CHANGELOG section.

npm authentication is **trusted publishing** (OIDC, no token): on npmjs.com, package `pricerules` → Settings → Trusted publishing → GitHub Actions, repo `dalisraieb/pricerules-node`, workflow `release.yml`. A trusted publisher can only be added once the package exists, so the very first release (0.1.0) uses a token: create a granular access token on npmjs.com (read and write, package scope `pricerules` once it exists or "all packages" for the first publish, short expiry), save it as the repo secret `NPM_TOKEN`, tag `v0.1.0`; then configure trusted publishing, delete `NPM_TOKEN` (and the token on npm), and set the package's publishing access to "Require two-factor authentication and disallow tokens".
