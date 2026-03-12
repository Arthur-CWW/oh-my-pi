import { Data, Effect } from "effect";
import {
	runSocketSearchWithAutoRefresh,
	type KagiSearchOptions,
	type KagiSearchResult,
	type SimpleRateLimiter,
} from "./kagi-client.js";

export const KAGI_SEARCH_RUNTIME_ERROR_CODES = [
	"session-unavailable",
	"unauthorized",
	"forbidden",
	"rate-limited",
	"http-error",
	"request-failed",
] as const;

export type KagiSearchRuntimeErrorCode = (typeof KAGI_SEARCH_RUNTIME_ERROR_CODES)[number];

export class KagiSearchRuntimeError extends Data.TaggedError("KagiSearchRuntimeError")<{
	readonly code: KagiSearchRuntimeErrorCode;
	readonly reason: string;
	readonly status?: number;
	readonly requestUrl?: string;
}> {}

export interface KagiSearchAutoRefreshConfig {
	readonly sessionPath?: string;
	readonly browserUrl?: string;
	readonly rateLimiter?: SimpleRateLimiter;
	readonly discoverLenses?: boolean;
}

export interface KagiSearchRuntimeDeps {
	readonly runSocketSearchWithAutoRefresh: (
		options: KagiSearchOptions,
		config?: KagiSearchAutoRefreshConfig,
	) => Promise<KagiSearchResult>;
}

const defaultDeps: KagiSearchRuntimeDeps = {
	runSocketSearchWithAutoRefresh,
};

function statusToErrorCode(status: number): KagiSearchRuntimeErrorCode {
	switch (status) {
		case 401:
			return "unauthorized";
		case 403:
			return "forbidden";
		case 429:
			return "rate-limited";
		default:
			return "http-error";
	}
}

function statusToReason(status: number): string {
	switch (status) {
		case 401:
			return "Kagi session is unauthorized. Refresh your Kagi session and retry.";
		case 403:
			return "Kagi session is forbidden or expired. Refresh your Kagi session and retry.";
		case 429:
			return "Kagi rate-limited the request. Wait briefly and retry.";
		default:
			return `Kagi search failed with status ${status}`;
	}
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function mapTransportFailureToRuntimeError(cause: unknown): KagiSearchRuntimeError {
	const reason = toErrorMessage(cause);
	const normalized = reason.toLowerCase();
	const code: KagiSearchRuntimeErrorCode = normalized.startsWith("kagi session unavailable")
		? "session-unavailable"
		: "request-failed";
	return new KagiSearchRuntimeError({
		code,
		reason,
	});
}

export const runKagiSocketSearchEffect = Effect.fn("Kagi.runKagiSocketSearchEffect")(function* (
	options: KagiSearchOptions,
	config?: KagiSearchAutoRefreshConfig,
	deps: KagiSearchRuntimeDeps = defaultDeps,
) {
	const result = yield* Effect.tryPromise({
		try: () => deps.runSocketSearchWithAutoRefresh(options, config),
		catch: mapTransportFailureToRuntimeError,
	});

	if (!result.ok) {
		return yield* new KagiSearchRuntimeError({
			code: statusToErrorCode(result.status),
			reason: statusToReason(result.status),
			status: result.status,
			requestUrl: result.requestUrl,
		});
	}

	return result;
});
