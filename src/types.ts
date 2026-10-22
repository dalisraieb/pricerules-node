/*
 * The PriceRules API's request and response types.
 *
 * Responses are typed exactly as the API sends them (snake_case, nothing
 * renamed or converted), so every field here matches the API reference at
 * https://pricerules.app/docs/api-reference. The lists below (`MATCH_REASONS`,
 * `ERROR_CODES`, …) are checked against the app's generated API contract by
 * tests/contract.test.ts: a value added or removed on either side fails it.
 */

/* ------------------------------------------------------------ value lists */

/**
 * Why an item got its price. The first nine are the rule tiers, most specific
 * first (a rule for this customer and this SKU beats one for the customer's
 * group, and so on down to a rule for everyone and every product).
 */
export const MATCH_REASONS = [
    "MOST_SPECIFIC_RULE",
    "CUSTOMER_GROUP_SKU_RULE",
    "SKU_LEVEL_RULE",
    "CUSTOMER_PRODUCT_GROUP_RULE",
    "CUSTOMER_GROUP_PRODUCT_GROUP_RULE",
    "PRODUCT_GROUP_RULE",
    "CUSTOMER_LEVEL_RULE",
    "CUSTOMER_GROUP_RULE",
    "DEFAULT_RULE",
    /** `best_price` mode: the lowest price among the matching rules won. */
    "LOWEST_PRICE_WINS",
    /** No rule applies: the base price. */
    "NO_RULE",
    /** Only amount-off rules matched, and none was below the base price (see `skipped_rules`): the base price. */
    "RULE_EXCEEDS_BASE_PRICE",
    /** The SKU isn't a product in the workspace: prices are null. */
    "PRODUCT_NOT_FOUND",
] as const;

export type MatchReason = (typeof MATCH_REASONS)[number];

/** The `error.code` values the public pricing API returns. */
export const ERROR_CODES = [
    "INVALID_JSON",
    "VALIDATION_ERROR",
    "UNAUTHORIZED",
    "MAX_PRODUCTS_EXCEEDED",
    "MAX_REQUESTS_EXCEEDED",
    "RATE_LIMIT_EXCEEDED",
    "MONTHLY_LIMIT_REACHED",
    "INTERNAL_ERROR",
    "PRICING_ENGINE_UNAVAILABLE",
] as const;

export type ApiErrorCode = (typeof ERROR_CODES)[number];

/** Warnings on a successful response (`data.warnings`, each bulk `data[i].warnings`). */
export const WARNING_CODES = ["CUSTOMER_NOT_FOUND"] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

/** `business` (default): priority decides between rules. `best_price`: the lowest price wins. */
export const PRICING_MODES = ["business", "best_price"] as const;

export type PricingMode = (typeof PRICING_MODES)[number];

/** `fixed` sets the price, `discount` takes a percentage off, `amount_off` takes an amount off. */
export const RULE_TYPES = ["fixed", "discount", "amount_off"] as const;

export type RuleType = (typeof RULE_TYPES)[number];

/** Why a matching rule was left out (`skipped_rules[].reason`). */
export const SKIP_REASONS = ["AMOUNT_EXCEEDS_BASE_PRICE"] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

export const CUSTOMER_TARGET_TYPES = ["customer", "customer_group", "everyone"] as const;

export type CustomerTargetType = (typeof CUSTOMER_TARGET_TYPES)[number];

export const PRODUCT_TARGET_TYPES = ["sku", "product_group", "all"] as const;

export type ProductTargetType = (typeof PRODUCT_TARGET_TYPES)[number];

/* ------------------------------------------------------------ requests */

export type ProductInput = {
    sku: string;
    /** 1 to 10,000; 1 when omitted. */
    quantity?: number;
};

export type ResolveParams = {
    /** The customer's code. Omitted: priced as an anonymous customer (only rules for every customer apply). */
    customerId?: string;
    /** 1 to 500 products. */
    products: ProductInput[];
    mode?: PricingMode;
    /**
     * The day rule dates are checked against (default: today in the
     * workspace's time zone): `YYYY-MM-DD`, an RFC 3339 time with an offset,
     * or a Date (sent as its UTC time).
     */
    asOf?: string | Date;
};

export type ResolveBulkRequest = {
    customerId?: string;
    /** 1 to 500 products. */
    products: ProductInput[];
};

export type ResolveBulkParams = {
    /** 1 to 10 requests; `data[i]` answers `requests[i]`. */
    requests: ResolveBulkRequest[];
    mode?: PricingMode;
    asOf?: string | Date;
};

/* ------------------------------------------------------------ responses */

/** The request's customer as resolve saw it (null when no customer_id was sent). */
export type Customer = {
    id: string;
    /** false: no active customer has this code; priced as anonymous, with a CUSTOMER_NOT_FOUND warning. */
    found: boolean;
    /** The customer's group code, or null. */
    group: string | null;
};

export type Warning = {
    code: WarningCode;
    message: string;
};

/** Who and what a rule was for. `code` is null for `everyone` / `all`. */
export type RuleTarget = {
    customer: { type: CustomerTargetType; code: string | null };
    product: { type: ProductTargetType; code: string | null };
};

export type RuleConstraints = {
    minimum_quantity: number | null;
    /** First day the rule applies (YYYY-MM-DD, workspace time zone), or null. */
    valid_from: string | null;
    /** Last day the rule applies (included), or null. */
    valid_to: string | null;
};

export type AppliedRule = {
    id: string;
    name: string | null;
    type: RuleType;
    value: number;
    constraints: RuleConstraints;
    target: RuleTarget;
};

/** A rule that matched but couldn't apply to this product. */
export type SkippedRule = AppliedRule & {
    reason: SkipReason;
};

export type PricingSummary = {
    /** base_price − final_price per unit, rounded to cents; 0 when the product wasn't found. */
    savings: number;
    message: string;
};

/** An item for a product the workspace has. */
export type PricedItem = {
    sku: string;
    product_group: string | null;
    base_price: number;
    quantity: number;
    final_price: number;
    applied_rule: AppliedRule | null;
    match_reason: Exclude<MatchReason, "PRODUCT_NOT_FOUND">;
    /** Only when a matching rule was skipped. */
    skipped_rules?: SkippedRule[];
    pricing_summary: PricingSummary;
};

/** An item for a SKU the workspace doesn't have. */
export type ProductNotFoundItem = {
    sku: string;
    product_group: null;
    base_price: null;
    quantity: number;
    final_price: null;
    applied_rule: null;
    match_reason: "PRODUCT_NOT_FOUND";
    pricing_summary: PricingSummary;
};

/** Narrow on `match_reason !== "PRODUCT_NOT_FOUND"` to get a non-null price. */
export type ResolvedItem = PricedItem | ProductNotFoundItem;

/** `data` of resolve, and each `data[i]` of bulk. */
export type ResolveData = {
    customer: Customer | null;
    warnings: Warning[];
    /** In the order of the request's products. */
    items: ResolvedItem[];
};

/** The workspace's usage quota for the current period, after this request. */
export type Billing = {
    limit: number;
    usage: number;
    remaining: number;
};

export type Meta = {
    request_id: string;
    processing_ms: number;
};

type ResponseEnvelope<Data> = {
    mode: PricingMode;
    /** The day rule dates were checked against (YYYY-MM-DD). */
    as_of: string;
    /** The workspace's time zone (IANA). */
    time_zone: string;
    success: true;
    data: Data;
    billing: Billing;
    meta: Meta;
};

export type ResolveResponse = ResponseEnvelope<ResolveData>;

export type ResolveBulkResponse = ResponseEnvelope<ResolveData[]>;

/** The body of every error response. */
export type ErrorResponse = {
    success: false;
    error: { code: string; message: string; details?: Record<string, unknown> };
    meta: { request_id: string };
};
