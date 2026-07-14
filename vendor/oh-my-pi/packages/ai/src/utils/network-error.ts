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
