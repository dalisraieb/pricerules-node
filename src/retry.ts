import { PriceRulesConnectionError, PriceRulesError, type HeadersLike } from "./errors";

/*
 * When a failed attempt is tried again. Only failures where nothing was
 * priced, and waiting can help:
 *   - 429 RATE_LIMIT_EXCEEDED, after the Retry-After header's wait;
 *   - 502 / 503 / 504 (PRICING_ENGINE_UNAVAILABLE, or a gateway in between);
 *   - connection errors (no response at all).
 * Never: other 4xx (the request itself is wrong, or MONTHLY_LIMIT_REACHED,
 * which lasts until the next period), 500 (unexpected: a bug, not a
 * passing condition, so a retry rarely helps) and timeouts (the request may
 * still be running and be counted, and the caller's time budget is spent).
 */

/** A Retry-After longer than this isn't waited for: the error is thrown instead. */
export const MAX_RETRY_AFTER_SECONDS = 60;

const RETRY_STATUSES = new Set([502, 503, 504]);
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

export function isRetryable(error: unknown): boolean {
    if (error instanceof PriceRulesConnectionError) return true;
    if (!(error instanceof PriceRulesError) || error.status === undefined) return false;
    if ((error.retryAfter ?? 0) > MAX_RETRY_AFTER_SECONDS) return false;
    if (error.status === 429) return error.code === "RATE_LIMIT_EXCEEDED";
    return RETRY_STATUSES.has(error.status);
}

/**
 * Milliseconds to wait before retry number `retry` (0 = the first retry):
 * the Retry-After header when there is one, else exponential backoff
 * (0.5 s, 1 s, 2 s … up to 8 s) with jitter, so many clients don't retry in step.
 */
export function retryDelayMs(retry: number, error: unknown, random: () => number = Math.random): number {
    if (error instanceof PriceRulesError && error.retryAfter !== undefined) {
        return error.retryAfter * 1000;
    }
    const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** retry);
    return delay / 2 + random() * (delay / 2);
}

/** Retry-After in seconds: a number of seconds or an HTTP date (RFC 9110). */
export function parseRetryAfter(headers: HeadersLike, now: number = Date.now()): number | undefined {
    const value = headers.get("retry-after")?.trim();
    if (!value) return undefined;
    if (/^\d+$/.test(value)) return Number(value);
    const at = Date.parse(value);
    if (Number.isNaN(at)) return undefined;
    return Math.max(0, Math.ceil((at - now) / 1000));
}
