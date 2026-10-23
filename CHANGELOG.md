# Changelog

All notable changes to the `pricerules` package. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-22

### Added

- `PriceRules` client with `resolve()` and `resolveBulk()`: camelCase params, the API's JSON returned unchanged.
- Full response types: customer, warnings, items (`product_group`, `applied_rule` with `target` and `constraints`, `skipped_rules`, `pricing_summary`), `match_reason` as a union of every value, `mode`, `as_of`, `time_zone`, `billing` and `meta`.
- `PriceRulesError` (status, code, message, details, requestId, retryAfter), plus `PriceRulesConnectionError` and `PriceRulesTimeoutError`.
- Retries with backoff for 429 `RATE_LIMIT_EXCEEDED` (honoring `Retry-After`), 502/503/504 and connection errors; `maxRetries` (default 2).
- A per-attempt `timeout` (default 10 s). Timeouts are not retried.
- Refuses to run in a browser page unless `dangerouslyAllowBrowser` is set.
- `User-Agent: pricerules-node/<version> (<runtime>)`.
- ESM and CommonJS builds with type declarations; no runtime dependencies.

[0.1.0]: https://github.com/dalisraieb/pricerules-node/releases/tag/v0.1.0
