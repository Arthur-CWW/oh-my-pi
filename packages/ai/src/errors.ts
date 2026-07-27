import type { RequestFailureCause } from "./utils/network-error";

export interface ProviderRequestErrorOptions {
	readonly failureCause: RequestFailureCause;
	readonly cause?: unknown;
}

/**
 * Provider transport/stream failure with a stable machine-readable cause.
 * The message remains the raw SDK detail; callers should use `failureCause`
 * for headlines and retry policy.
 */
export class ProviderRequestError extends Error {
	readonly failureCause: RequestFailureCause;

	constructor(message: string, options: ProviderRequestErrorOptions) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "ProviderRequestError";
		this.failureCause = options.failureCause;
	}
}

/**
 * Structured HTTP errors thrown by provider clients.
 *
 * Downstream classification reads these fields structurally rather than via
 * `instanceof`: `extractHttpStatusFromError` (pi-utils) reads `status`,
 * `getHeadersFromError` (retry-after extraction) reads `headers`, and retry
 * policies such as `isCopilotTransientModelError` read `code`. Per-provider
 * subclasses exist so call sites can narrow with `instanceof` and logs carry
 * a meaningful `error.name`.
 */
export interface ProviderHttpErrorOptions {
	/** Response headers; enables `retry-after`/rate-limit extraction downstream. */
	headers?: Headers;
	/** Machine-readable error code from the response body (`error.code` / `error.type`). */
	code?: string;
	cause?: unknown;
}

/** Non-2xx HTTP response from a provider endpoint. */
export class ProviderHttpError extends Error {
	readonly status: number;
	readonly headers: Headers | undefined;
	readonly code: string | undefined;

	constructor(message: string, status: number, options?: ProviderHttpErrorOptions) {
		super(message, options?.cause === undefined ? undefined : { cause: options.cause });
		this.name = "ProviderHttpError";
		this.status = status;
		this.headers = options?.headers;
		this.code = options?.code;
	}
}
