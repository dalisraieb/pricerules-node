import type { ApiErrorCode } from "./types";

/** Codes the SDK itself uses, when there is no API error to report. */
export type SdkErrorCode =
    | "TIMEOUT"
    | "CONNECTION_ERROR"
    | "ABORTED"
    | "UNEXPECTED_RESPONSE"
    | "MISSING_API_KEY"
    | "BROWSER_NOT_ALLOWED";

/** Every code a PriceRulesError can carry; a string for codes added to the API later. */
export type ErrorCode = ApiErrorCode | SdkErrorCode | (string & {});

/** The response headers, as any fetch implementation exposes them. */
export type HeadersLike = { get(name: string): string | null };

export type PriceRulesErrorInit = {
    code: ErrorCode;
    message: string;
    status?: number;
    details?: Record<string, unknown>;
    requestId?: string;
    headers?: HeadersLike;
    retryAfter?: number;
    cause?: unknown;
};

/**
 * Every error the SDK throws. `status` and `requestId` are set when the API
 * answered; quote the request id to support.
 */
export class PriceRulesError extends Error {
    /** The HTTP status, or undefined when no response arrived (timeout, network, abort). */
    readonly status: number | undefined;
    /** The API's `error.code` (VALIDATION_ERROR, RATE_LIMIT_EXCEEDED, …) or one of the SDK's own. */
    readonly code: ErrorCode;
    /** The API's `error.details` (e.g. `issues` for VALIDATION_ERROR). */
    readonly details: Record<string, unknown> | undefined;
    /** `meta.request_id` (or the X-Request-Id header). */
    readonly requestId: string | undefined;
    readonly headers: HeadersLike | undefined;
    /** Seconds to wait before retrying, from the Retry-After header (429 RATE_LIMIT_EXCEEDED). */
    readonly retryAfter: number | undefined;

    constructor(init: PriceRulesErrorInit) {
        super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
        this.name = "PriceRulesError";
        this.status = init.status;
        this.code = init.code;
        this.details = init.details;
        this.requestId = init.requestId;
        this.headers = init.headers;
        this.retryAfter = init.retryAfter;
    }
}

/** The request didn't get a response: DNS, connection refused or reset, TLS… */
export class PriceRulesConnectionError extends PriceRulesError {
    constructor(message: string, cause?: unknown) {
        super({ code: "CONNECTION_ERROR", message, cause });
        this.name = "PriceRulesConnectionError";
    }
}

/** An attempt took longer than the `timeout`. Timeouts are never retried. */
export class PriceRulesTimeoutError extends PriceRulesError {
    constructor(message: string) {
        super({ code: "TIMEOUT", message });
        this.name = "PriceRulesTimeoutError";
    }
}
