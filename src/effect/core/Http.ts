import { Effect } from "effect";
import {
	HttpRequestError,
	HttpStatusError,
	HttpTimeoutError,
	type HttpError,
	stringifyUnknown,
} from "./Errors.js";

export interface HttpRequestOptions {
	readonly url: string;
	readonly init?: RequestInit;
	readonly timeoutMs?: number;
	readonly retries?: number;
	readonly retryDelayMs?: number;
	readonly signal?: AbortSignal;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
	if (signal) {
		return AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]);
	}
	return AbortSignal.timeout(timeoutMs);
}

function shouldRetryForStatus(status: number): boolean {
	return status >= 500 || status === 429;
}

export function request(options: HttpRequestOptions): Effect.Effect<Response, HttpError> {
	return Effect.tryPromise({
		try: async () => {
			const timeoutMs = options.timeoutMs ?? 15000;
			const retries = options.retries ?? 1;
			const retryDelayMs = options.retryDelayMs ?? 200;
			let attempt = 0;
			let lastError: HttpError | null = null;

			while (attempt <= retries) {
				attempt += 1;
				try {
					const response = await fetch(options.url, {
						...options.init,
						signal: buildSignal(timeoutMs, options.signal),
					});

					if (!response.ok) {
						const bodySnippet = (await response.text()).slice(0, 300);
						const statusError = new HttpStatusError({
							url: options.url,
							status: response.status,
							bodySnippet,
						});
						if (attempt <= retries && shouldRetryForStatus(response.status)) {
							lastError = statusError;
							await delay(retryDelayMs);
							continue;
						}
						throw statusError;
					}

					return response;
				} catch (cause) {
					if (cause instanceof HttpStatusError) {
						throw cause;
					}
					const message = stringifyUnknown(cause).toLowerCase();
					const mappedError: HttpError = message.includes("timeout") || message.includes("abort")
						? new HttpTimeoutError({ url: options.url, timeoutMs })
						: new HttpRequestError({ url: options.url, reason: stringifyUnknown(cause) });

					if (attempt <= retries) {
						lastError = mappedError;
						await delay(retryDelayMs);
						continue;
					}
					throw mappedError;
				}
			}

			if (lastError) throw lastError;
			throw new HttpRequestError({
				url: options.url,
				reason: "Request failed without a specific error",
			});
		},
		catch: (cause) => {
			if (
				cause instanceof HttpRequestError ||
				cause instanceof HttpStatusError ||
				cause instanceof HttpTimeoutError
			) {
				return cause;
			}
			return new HttpRequestError({
				url: options.url,
				reason: stringifyUnknown(cause),
			});
		},
	});
}

export function requestJson<T>(
	options: HttpRequestOptions,
): Effect.Effect<T, HttpError | HttpRequestError> {
	return Effect.flatMap(request(options), (response) =>
		Effect.tryPromise({
			try: () => response.json() as Promise<T>,
			catch: (cause) =>
				new HttpRequestError({
					url: options.url,
					reason: `Failed to parse JSON response: ${stringifyUnknown(cause)}`,
				}),
		}),
	);
}
