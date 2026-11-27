# Changelog

All notable changes to the `pricerules` package. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-11-27

### Changed

- Documented how the API rounds prices: `final_price` is rounded once, half-up, to 2 decimals, or 4 when `base_price` or the winning rule's fixed price / amount off has more than 2; a discount's percentage never counts (19.90 at 8% off is 18.31; 0.0125 at 8% off is 0.0115; 12.345% off 19.90 is 17.44). `applied_rule.value` and `base_price` keep their stored precision (up to 4 decimals), and `pricing_summary.savings` is worked out from the rounded `final_price`. Types are unchanged.

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

[0.1.1]: https://github.com/dalisraieb/pricerules-node/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/dalisraieb/pricerules-node/releases/tag/v0.1.0
