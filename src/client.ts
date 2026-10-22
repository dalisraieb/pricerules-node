import { PriceRulesConnectionError, PriceRulesError, PriceRulesTimeoutError, type HeadersLike } from "./errors";
import { isRetryable, parseRetryAfter, retryDelayMs } from "./retry";
import { isBrowser, readEnv, runtimeTag } from "./runtime";
import type {
    ErrorResponse,
    ProductInput,
    ResolveBulkParams,
    ResolveBulkResponse,
    ResolveParams,
    ResolveResponse,
} from "./types";
import { VERSION } from "./version";

export const API_KEY_ENV = "PRICERULES_API_KEY";
export const DEFAULT_BASE_URL = "https://pricerules.app/api/v1";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RETRIES = 2;

/** The part of a fetch Response the SDK reads. */
export type ResponseLike = {
    status: number;
    ok: boolean;
    headers: HeadersLike;
    text(): Promise<string>;
};

export type FetchInit = {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
};

/** A fetch implementation: the runtime's own by default. */
export type FetchLike = (url: string, init: FetchInit) => Promise<ResponseLike>;

export type PriceRulesOptions = {
    /** Default: the PRICERULES_API_KEY environment variable. Keep keys on the server. */
    apiKey?: string;
    /** Default: https://pricerules.app/api/v1 */
    baseUrl?: string;
    /** Milliseconds per attempt before giving up with a PriceRulesTimeoutError (default 10,000). Timeouts are not retried. */
    timeout?: number;
    /** Retries after a 429 RATE_LIMIT_EXCEEDED, a 502/503/504 or a connection error (default 2; 0 turns retries off). */
    maxRetries?: number;
    /** A fetch implementation, e.g. for a proxy (default: the global fetch). */
    fetch?: FetchLike;
    /** Allow use in a browser page. Don't: anyone who opens the page can read the API key. */
    dangerouslyAllowBrowser?: boolean;
};

/** Per-call overrides. */
export type RequestOptions = {
    timeout?: number;
    maxRetries?: number;
    /** Cancels the call (and any retry wait); it then throws a PriceRulesError with code ABORTED. */
    signal?: AbortSignal;
};

/**
 * The PriceRules API client.
 *
 *   const pricerules = new PriceRules({ apiKey: process.env.PRICERULES_API_KEY });
 *   const { data } = await pricerules.resolve({ customerId: "ACME", products: [{ sku: "VLV-304", quantity: 120 }] });
 */
export class PriceRules {
    readonly baseUrl: string;
    readonly timeout: number;
    readonly maxRetries: number;
    readonly #apiKey: string;
    readonly #fetch: FetchLike;
    readonly #userAgent: string;

    constructor(options: PriceRulesOptions = {}) {
        if (isBrowser() && !options.dangerouslyAllowBrowser) {
            throw new PriceRulesError({
                code: "BROWSER_NOT_ALLOWED",
                message:
                    "The PriceRules SDK runs on your server, not in the browser: anyone who opens the page could read your API key. " +
                    "Call your own backend from the page instead. (To override, pass dangerouslyAllowBrowser: true.)",
            });
        }

        const apiKey = options.apiKey ?? readEnv(API_KEY_ENV);
        if (!apiKey) {
            throw new PriceRulesError({
                code: "MISSING_API_KEY",
                message: `No API key: pass { apiKey } or set the ${API_KEY_ENV} environment variable. Keys are on the API page of the PriceRules dashboard.`,
            });
        }

        const fetchImpl = options.fetch ?? defaultFetch();
        if (!fetchImpl) {
            throw new PriceRulesError({
                code: "CONNECTION_ERROR",
                message: "No fetch implementation: use Node 18 or later, or pass { fetch }.",
            });
        }

        this.#apiKey = apiKey;
        this.#fetch = fetchImpl;
        this.#userAgent = `pricerules-node/${VERSION} (${runtimeTag()})`;
        this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
        this.timeout = checkTimeout(options.timeout ?? DEFAULT_TIMEOUT_MS);
        this.maxRetries = checkMaxRetries(options.maxRetries ?? DEFAULT_MAX_RETRIES);
    }

    /** POST /pricing/resolve: the prices of one customer's products. */
    async resolve(params: ResolveParams, options?: RequestOptions): Promise<ResolveResponse> {
        return this.post<ResolveResponse>(
            "/pricing/resolve",
            {
                customer_id: params.customerId,
                products: products(params.products, "products"),
                mode: params.mode,
                as_of: asOfValue(params.asOf),
            },
            options,
        );
    }

    /** POST /pricing/resolve/bulk: up to 10 resolves in one call; `data[i]` answers `requests[i]`. */
    async resolveBulk(params: ResolveBulkParams, options?: RequestOptions): Promise<ResolveBulkResponse> {
        if (!Array.isArray(params?.requests)) throw new TypeError("`requests` must be an array of { customerId?, products }.");
        return this.post<ResolveBulkResponse>(
            "/pricing/resolve/bulk",
            {
                requests: params.requests.map((request, i) => ({
                    customer_id: request.customerId,
                    products: products(request.products, `requests[${i}].products`),
                })),
                mode: params.mode,
                as_of: asOfValue(params.asOf),
            },
            options,
        );
    }

    /** Waits between retries; rejects when the caller's signal aborts. */
    protected sleep(ms: number, signal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(abortedError());
            const onAbort = () => {
                clearTimeout(timer);
                reject(abortedError());
            };
            const timer = setTimeout(() => {
                signal?.removeEventListener("abort", onAbort);
                resolve();
            }, ms);
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }

    private async post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
        const maxRetries = options.maxRetries === undefined ? this.maxRetries : checkMaxRetries(options.maxRetries);
        const timeout = options.timeout === undefined ? this.timeout : checkTimeout(options.timeout);
        const payload = JSON.stringify(body);

        for (let attempt = 0; ; attempt++) {
            try {
                return await this.attempt<T>(path, payload, { timeout, signal: options.signal, attempt, attempts: maxRetries + 1 });
            } catch (error) {
                if (attempt >= maxRetries || !isRetryable(error)) throw error;
                await this.sleep(retryDelayMs(attempt, error), options.signal);
            }
        }
    }

    private async attempt<T>(
        path: string,
        payload: string,
        { timeout, signal, attempt, attempts }: { timeout: number; signal?: AbortSignal; attempt: number; attempts: number },
    ): Promise<T> {
        if (signal?.aborted) throw abortedError();

        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeout);
        const onAbort = () => controller.abort();
        signal?.addEventListener("abort", onAbort, { once: true });

        const failure = (cause: unknown): PriceRulesError => {
            if (timedOut) {
                return new PriceRulesTimeoutError(
                    `Request timed out after ${timeout} ms (attempt ${attempt + 1} of ${attempts}). ` +
                        "Timeouts are not retried: the request may still have been processed. Raise `timeout` for large requests.",
                );
            }
            if (signal?.aborted) return abortedError();
            const reason = cause instanceof Error ? cause.message : String(cause);
            return new PriceRulesConnectionError(`Could not reach the PriceRules API at ${this.baseUrl}: ${reason}`, cause);
        };

        try {
            let response: ResponseLike;
            let text: string;
            try {
                response = await this.#fetch(this.baseUrl + path, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.#apiKey}`,
                        "Content-Type": "application/json",
                        Accept: "application/json",
                        "User-Agent": this.#userAgent,
                    },
                    body: payload,
                    signal: controller.signal,
                });
                text = await response.text();
            } catch (cause) {
                throw failure(cause);
            }
            return parseResponse<T>(response, text);
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        }
    }
}

/** A success body is returned as is; anything else becomes a PriceRulesError. */
export function parseResponse<T>(response: ResponseLike, text: string): T {
    let json: unknown;
    try {
        json = text ? JSON.parse(text) : undefined;
    } catch {
        json = undefined;
    }

    const headers = response.headers;
    const headerRequestId = headers.get("x-request-id") ?? undefined;

    if (response.ok) {
        if (isObject(json) && json.success === true) return json as T;
        throw new PriceRulesError({
            code: "UNEXPECTED_RESPONSE",
            status: response.status,
            message: `Unexpected response from the PriceRules API (HTTP ${response.status}): the body isn't a JSON success response.`,
            requestId: headerRequestId,
            headers,
        });
    }

    const retryAfter = parseRetryAfter(headers);

    if (isErrorBody(json)) {
        throw new PriceRulesError({
            code: json.error.code,
            message: json.error.message,
            status: response.status,
            details: json.error.details,
            requestId: json.meta?.request_id ?? headerRequestId,
            headers,
            retryAfter,
        });
    }

    throw new PriceRulesError({
        code: "UNEXPECTED_RESPONSE",
        status: response.status,
        message: `The PriceRules API answered HTTP ${response.status} without an error body.`,
        requestId: headerRequestId,
        headers,
        retryAfter,
    });
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isErrorBody(value: unknown): value is ErrorResponse {
    return (
        isObject(value) &&
        value.success === false &&
        isObject(value.error) &&
        typeof value.error.code === "string" &&
        typeof value.error.message === "string"
    );
}

function abortedError(): PriceRulesError {
    return new PriceRulesError({ code: "ABORTED", message: "The request was aborted." });
}

/** The runtime's fetch, called unbound (Workers reject `this` other than the global). */
function defaultFetch(): FetchLike | undefined {
    const globalFetch = (globalThis as { fetch?: unknown }).fetch;
    if (typeof globalFetch !== "function") return undefined;
    return (url, init) => (globalThis as unknown as { fetch: FetchLike }).fetch(url, init);
}

/** Only the fields the API reads, so nothing else in the caller's objects is sent. */
function products(list: ProductInput[], name: string) {
    if (!Array.isArray(list)) throw new TypeError(`\`${name}\` must be an array of { sku, quantity? }.`);
    return list.map((product) => ({ sku: product.sku, quantity: product.quantity }));
}

function asOfValue(asOf: string | Date | undefined): string | undefined {
    if (asOf === undefined) return undefined;
    if (asOf instanceof Date) {
        if (Number.isNaN(asOf.getTime())) throw new TypeError("`asOf` is an invalid Date.");
        return asOf.toISOString();
    }
    return asOf;
}

function checkTimeout(timeout: number): number {
    if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError("`timeout` must be a positive number of milliseconds.");
    return timeout;
}

function checkMaxRetries(maxRetries: number): number {
    if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new TypeError("`maxRetries` must be a whole number, 0 or more.");
    return maxRetries;
}
