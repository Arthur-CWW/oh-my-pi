/**
 * Canonical retry taxonomy shared by provider classification and the coding
 * agent retry state machine. `provider` remains the retry-policy bucket; the
 * operator-facing surface renders it as the more explicit `provider-error`.
 */
export type RetryCause = "network" | "rate-limit" | "provider";

export type RequestFailureCause =
	| Exclude<RetryCause, "provider">
	| "user-interrupt"
	| "parent-cancel"
	| "timeout"
	| "provider-stream-abort"
	| "provider-error";

interface StructuredRequestFailure {
	readonly failureCause?: unknown;
	readonly status?: unknown;
	readonly message?: unknown;
}

const RATE_LIMIT_MESSAGE_REGEX = /\brate.?limit\b|too many requests|\b429\b/i;
const STREAM_ABORT_MESSAGE_REGEX =
	/stream (?:stalled|timed out|ended|closed|terminated)|waiting for (?:the first|the next) event/i;
const TIMEOUT_MESSAGE_REGEX = /\btimed? ?out\b|\btimeout\b/i;
const USER_INTERRUPT_MESSAGE_REGEX = /\binterrupted by user\b/i;

/** Map a retry-policy bucket onto the public operator-facing cause taxonomy. */
export function requestFailureCauseFromRetryCause(cause: RetryCause): RequestFailureCause {
	return cause === "provider" ? "provider-error" : cause;
}

/** Classify the reason attached to a caller-owned AbortSignal. */
export function classifyAbortReason(
	reason: unknown,
): Extract<RequestFailureCause, "user-interrupt" | "parent-cancel" | "timeout"> {
	if (typeof reason === "string" && USER_INTERRUPT_MESSAGE_REGEX.test(reason)) return "user-interrupt";
	if (reason instanceof Error && USER_INTERRUPT_MESSAGE_REGEX.test(reason.message)) return "user-interrupt";
	if (
		(typeof reason === "string" && TIMEOUT_MESSAGE_REGEX.test(reason)) ||
		(reason instanceof Error && TIMEOUT_MESSAGE_REGEX.test(reason.message))
	) {
		return "timeout";
	}
	return "parent-cancel";
}

/**
 * Classify one provider/request failure without relying on SDK-specific
 * `instanceof` checks. Structured provider errors win; legacy/raw messages
 * remain supported while providers migrate.
 */
export function classifyRequestFailure(error: Error | string | StructuredRequestFailure): RequestFailureCause {
	const structured = typeof error === "string" ? undefined : (error as StructuredRequestFailure);
	const structuredCause = structured?.failureCause;
	if (typeof structuredCause === "string") {
		switch (structuredCause) {
			case "user-interrupt":
			case "parent-cancel":
			case "timeout":
			case "provider-stream-abort":
			case "network":
			case "rate-limit":
			case "provider-error":
				return structuredCause;
		}
	}

	const message =
		typeof error === "string" ? error : typeof error.message === "string" ? error.message : String(error);
	if (USER_INTERRUPT_MESSAGE_REGEX.test(message)) return "user-interrupt";
	if (STREAM_ABORT_MESSAGE_REGEX.test(message)) return "provider-stream-abort";
	if (TIMEOUT_MESSAGE_REGEX.test(message)) return "timeout";
	if (structured?.status === 429) return "rate-limit";
	if (RATE_LIMIT_MESSAGE_REGEX.test(message)) return "rate-limit";
	if (isTransientNetworkError(error instanceof Error || typeof error === "string" ? error : message)) return "network";
	if (/\brequest was aborted\b|\boperation aborted\b/i.test(message)) return "parent-cancel";
	return "provider-error";
}

type CodedError = Error & { code?: string };

const TRANSIENT_NETWORK_MESSAGE_REGEX =
	/\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)\b|fetch failed|socket hang ?up/i;

function hasTransientNetworkCode(error: Error): boolean {
	switch ((error as CodedError).code) {
		case "ENOTFOUND":
		case "EAI_AGAIN":
		case "ECONNREFUSED":
		case "ECONNRESET":
		case "ETIMEDOUT":
		case "EHOSTUNREACH":
		case "ENETUNREACH":
			return true;
		default:
			return false;
	}
}

/**
 * Returns whether an error represents a transient network failure.
 *
 * Native fetch errors commonly keep the actionable system error in `cause`,
 * so the chain is inspected without allocating an intermediate array or set.
 */
export function isTransientNetworkError(error: Error | string): boolean {
	let current: Error | string | undefined = error;

	// A malformed cause cycle must not turn error handling into an infinite loop.
	for (let depth = 0; current !== undefined && depth < 32; depth++) {
		if (typeof current === "string") return TRANSIENT_NETWORK_MESSAGE_REGEX.test(current);
		if (hasTransientNetworkCode(current) || TRANSIENT_NETWORK_MESSAGE_REGEX.test(current.message)) return true;

		const cause: unknown = current.cause;
		current = cause instanceof Error || typeof cause === "string" ? cause : undefined;
	}

	return false;
}
