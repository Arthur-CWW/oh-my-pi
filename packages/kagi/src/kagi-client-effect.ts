import { Data, Effect } from "effect";
import {
	captureSessionFromChrome,
	discoverLenses,
	loadSession,
	parseVideoRuleTargetFromDomain,
	runAdvancedSearchRedirect,
	runDomainRuleBulk,
	runDomainRuleDelete,
	runDomainRuleSet,
	runVideoRuleDelete,
	runVideoRuleSet,
	saveSession,
	type KagiAdvancedRedirectResult,
	type KagiAdvancedSearchOptions,
	type KagiLensDiscoveryResult,
	type KagiRuleKind,
	type KagiRuleMutationResult,
	type KagiSessionState,
	type KagiVideoRuleTarget,
} from "./kagi-client.js";

export const KAGI_CLIENT_RUNTIME_ERROR_CODES = [
	"session-unavailable",
	"storage-failed",
	"unauthorized",
	"forbidden",
	"rate-limited",
	"http-error",
	"request-failed",
	"invalid-target",
] as const;

export const KAGI_CLIENT_RUNTIME_OPERATIONS = [
	"session:refresh",
	"session:load",
	"session:save",
	"lenses:list",
	"advanced:redirect",
	"rules:domain:set",
	"rules:domain:bulk",
	"rules:domain:delete",
	"rules:video:target",
	"rules:video:set",
	"rules:video:delete",
] as const;

export type KagiClientRuntimeErrorCode = (typeof KAGI_CLIENT_RUNTIME_ERROR_CODES)[number];
export type KagiClientRuntimeOperation = (typeof KAGI_CLIENT_RUNTIME_OPERATIONS)[number];

export class KagiClientRuntimeError extends Data.TaggedError("KagiClientRuntimeError")<{
	readonly code: KagiClientRuntimeErrorCode;
	readonly operation: KagiClientRuntimeOperation;
	readonly reason: string;
	readonly status?: number;
	readonly requestUrl?: string;
}> {}

export interface KagiLensDiscoveryEffectOptions {
	readonly query?: string;
	readonly includeFallback?: boolean;
}

export interface RefreshAndSaveKagiSessionEffectOptions {
	readonly browserUrl?: string;
	readonly sessionPath?: string;
}

export interface KagiClientRuntimeDeps {
	readonly captureSessionFromChrome: (browserUrl?: string) => Promise<KagiSessionState>;
	readonly loadSession: (filePath?: string) => KagiSessionState;
	readonly saveSession: (session: KagiSessionState, filePath?: string) => string;
	readonly discoverLenses: (
		session: KagiSessionState,
		options?: KagiLensDiscoveryEffectOptions,
	) => Promise<KagiLensDiscoveryResult>;
	readonly runAdvancedSearchRedirect: (
		session: KagiSessionState,
		options: KagiAdvancedSearchOptions,
	) => Promise<KagiAdvancedRedirectResult>;
	readonly runDomainRuleSet: (
		session: KagiSessionState,
		domain: string,
		kind: KagiRuleKind,
	) => Promise<KagiRuleMutationResult>;
	readonly runDomainRuleDelete: (
		session: KagiSessionState,
		domain: string,
	) => Promise<KagiRuleMutationResult>;
	readonly runDomainRuleBulk: (
		session: KagiSessionState,
		domains: string[],
		kind: KagiRuleKind,
		redirectPath?: string,
	) => Promise<KagiRuleMutationResult>;
	readonly parseVideoRuleTargetFromDomain: (domainOrUrl: string, creatorName?: string) => KagiVideoRuleTarget;
	readonly runVideoRuleSet: (
		session: KagiSessionState,
		target: KagiVideoRuleTarget,
		kind: KagiRuleKind,
	) => Promise<KagiRuleMutationResult>;
	readonly runVideoRuleDelete: (
		session: KagiSessionState,
		target: Pick<KagiVideoRuleTarget, "platformId" | "creatorId">,
	) => Promise<KagiRuleMutationResult>;
}

const defaultDeps: KagiClientRuntimeDeps = {
	captureSessionFromChrome,
	loadSession,
	saveSession,
	discoverLenses,
	runAdvancedSearchRedirect,
	runDomainRuleSet,
	runDomainRuleDelete,
	runDomainRuleBulk,
	parseVideoRuleTargetFromDomain,
	runVideoRuleSet,
	runVideoRuleDelete,
};

interface KagiHttpResult {
	readonly status: number;
	readonly requestUrl: string;
}

function resolveDeps(deps: Partial<KagiClientRuntimeDeps> | undefined): KagiClientRuntimeDeps {
	return {
		...defaultDeps,
		...deps,
	};
}

function operationLabel(operation: KagiClientRuntimeOperation): string {
	switch (operation) {
		case "session:refresh":
			return "Kagi session refresh";
		case "session:load":
			return "Kagi session load";
		case "session:save":
			return "Kagi session save";
		case "lenses:list":
			return "Kagi lens discovery";
		case "advanced:redirect":
			return "Kagi advanced search redirect";
		case "rules:domain:set":
			return "Kagi domain rule update";
		case "rules:domain:bulk":
			return "Kagi bulk domain rule update";
		case "rules:domain:delete":
			return "Kagi domain rule delete";
		case "rules:video:target":
			return "Kagi video rule target parsing";
		case "rules:video:set":
			return "Kagi video rule update";
		case "rules:video:delete":
			return "Kagi video rule delete";
	}
}

function statusToErrorCode(status: number): KagiClientRuntimeErrorCode {
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

function statusToReason(operation: KagiClientRuntimeOperation, status: number): string {
	const label = operationLabel(operation);
	switch (status) {
		case 401:
			return `${label} is unauthorized. Refresh your Kagi session and retry.`;
		case 403:
			return `${label} is forbidden or your session expired. Refresh your Kagi session and retry.`;
		case 429:
			return `${label} was rate-limited by Kagi. Wait briefly and retry.`;
		default:
			return `${label} failed with status ${status}.`;
	}
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function isSessionUnavailableReason(reason: string): boolean {
	const normalized = reason.toLowerCase();
	return (
		normalized.startsWith("kagi session unavailable") || normalized.startsWith("kagi session file not found:")
	);
}

function mapSessionRefreshFailure(cause: unknown): KagiClientRuntimeError {
	return new KagiClientRuntimeError({
		code: "session-unavailable",
		operation: "session:refresh",
		reason: toErrorMessage(cause),
	});
}

function mapSessionLoadFailure(cause: unknown): KagiClientRuntimeError {
	const reason = toErrorMessage(cause);
	return new KagiClientRuntimeError({
		code: isSessionUnavailableReason(reason) ? "session-unavailable" : "storage-failed",
		operation: "session:load",
		reason,
	});
}

function mapSessionSaveFailure(cause: unknown): KagiClientRuntimeError {
	return new KagiClientRuntimeError({
		code: "storage-failed",
		operation: "session:save",
		reason: toErrorMessage(cause),
	});
}

function mapTransportFailure(
	operation: Exclude<KagiClientRuntimeOperation, "session:refresh" | "session:load" | "session:save" | "rules:video:target">,
	cause: unknown,
): KagiClientRuntimeError {
	const reason = toErrorMessage(cause);
	return new KagiClientRuntimeError({
		code: isSessionUnavailableReason(reason) ? "session-unavailable" : "request-failed",
		operation,
		reason,
	});
}

function mapInvalidTargetFailure(cause: unknown): KagiClientRuntimeError {
	return new KagiClientRuntimeError({
		code: "invalid-target",
		operation: "rules:video:target",
		reason: toErrorMessage(cause),
	});
}

function isExpectedStatus(operation: KagiClientRuntimeOperation, status: number): boolean {
	switch (operation) {
		case "advanced:redirect":
			return status >= 200 && status < 400;
		case "session:refresh":
		case "session:load":
		case "session:save":
		case "rules:video:target":
			return true;
		default:
			return status >= 200 && status < 300;
	}
}

function ensureExpectedStatus<T extends KagiHttpResult>(
	operation: KagiClientRuntimeOperation,
	result: T,
): Effect.Effect<T, KagiClientRuntimeError> {
	if (isExpectedStatus(operation, result.status)) {
		return Effect.succeed(result);
	}
	return Effect.fail(
		new KagiClientRuntimeError({
			code: statusToErrorCode(result.status),
			operation,
			reason: statusToReason(operation, result.status),
			status: result.status,
			requestUrl: result.requestUrl,
		}),
	);
}

export const refreshKagiSessionEffect = Effect.fn("Kagi.refreshKagiSessionEffect")(function* (
	browserUrl?: string,
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	return yield* Effect.tryPromise({
		try: () => runtimeDeps.captureSessionFromChrome(browserUrl),
		catch: mapSessionRefreshFailure,
	});
});

export const loadKagiSessionEffect = Effect.fn("Kagi.loadKagiSessionEffect")(function* (
	filePath?: string,
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	return yield* Effect.try({
		try: () => runtimeDeps.loadSession(filePath),
		catch: mapSessionLoadFailure,
	});
});

export const saveKagiSessionEffect = Effect.fn("Kagi.saveKagiSessionEffect")(function* (
	session: KagiSessionState,
	filePath?: string,
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	return yield* Effect.try({
		try: () => runtimeDeps.saveSession(session, filePath),
		catch: mapSessionSaveFailure,
	});
});

export const refreshAndSaveKagiSessionEffect = Effect.fn("Kagi.refreshAndSaveKagiSessionEffect")(function* (
	options: RefreshAndSaveKagiSessionEffectOptions = {},
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const session = yield* refreshKagiSessionEffect(options.browserUrl, deps);
	const saved = yield* saveKagiSessionEffect(session, options.sessionPath, deps);
	return { session, saved } as const;
});

export const discoverKagiLensesEffect = Effect.fn("Kagi.discoverKagiLensesEffect")(function* (
	session: KagiSessionState,
	options?: KagiLensDiscoveryEffectOptions,
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	const result = yield* Effect.tryPromise({
		try: () => runtimeDeps.discoverLenses(session, options),
		catch: (cause) => mapTransportFailure("lenses:list", cause),
	});
	return yield* ensureExpectedStatus("lenses:list", result);
});

export const runKagiAdvancedSearchRedirectEffect = Effect.fn("Kagi.runKagiAdvancedSearchRedirectEffect")(function* (
	session: KagiSessionState,
	options: KagiAdvancedSearchOptions,
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	const result = yield* Effect.tryPromise({
		try: () => runtimeDeps.runAdvancedSearchRedirect(session, options),
		catch: (cause) => mapTransportFailure("advanced:redirect", cause),
	});
	return yield* ensureExpectedStatus("advanced:redirect", result);
});

export const runKagiDomainRuleSetEffect = Effect.fn("Kagi.runKagiDomainRuleSetEffect")(function* (
	session: KagiSessionState,
	domain: string,
	kind: KagiRuleKind,
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	const result = yield* Effect.tryPromise({
		try: () => runtimeDeps.runDomainRuleSet(session, domain, kind),
		catch: (cause) => mapTransportFailure("rules:domain:set", cause),
	});
	return yield* ensureExpectedStatus("rules:domain:set", result);
});

export const runKagiDomainRuleDeleteEffect = Effect.fn("Kagi.runKagiDomainRuleDeleteEffect")(function* (
	session: KagiSessionState,
	domain: string,
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	const result = yield* Effect.tryPromise({
		try: () => runtimeDeps.runDomainRuleDelete(session, domain),
		catch: (cause) => mapTransportFailure("rules:domain:delete", cause),
	});
	return yield* ensureExpectedStatus("rules:domain:delete", result);
});

export const runKagiDomainRuleBulkEffect = Effect.fn("Kagi.runKagiDomainRuleBulkEffect")(function* (
	session: KagiSessionState,
	domains: string[],
	kind: KagiRuleKind,
	redirectPath = "/settings/user_ranked",
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	const result = yield* Effect.tryPromise({
		try: () => runtimeDeps.runDomainRuleBulk(session, domains, kind, redirectPath),
		catch: (cause) => mapTransportFailure("rules:domain:bulk", cause),
	});
	return yield* ensureExpectedStatus("rules:domain:bulk", result);
});

export const parseKagiVideoRuleTargetEffect = Effect.fn("Kagi.parseKagiVideoRuleTargetEffect")(function* (
	domainOrUrl: string,
	creatorName?: string,
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	return yield* Effect.try({
		try: () => runtimeDeps.parseVideoRuleTargetFromDomain(domainOrUrl, creatorName),
		catch: mapInvalidTargetFailure,
	});
});

export const runKagiVideoRuleSetEffect = Effect.fn("Kagi.runKagiVideoRuleSetEffect")(function* (
	session: KagiSessionState,
	target: KagiVideoRuleTarget,
	kind: KagiRuleKind,
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	const result = yield* Effect.tryPromise({
		try: () => runtimeDeps.runVideoRuleSet(session, target, kind),
		catch: (cause) => mapTransportFailure("rules:video:set", cause),
	});
	return yield* ensureExpectedStatus("rules:video:set", result);
});

export const runKagiVideoRuleDeleteEffect = Effect.fn("Kagi.runKagiVideoRuleDeleteEffect")(function* (
	session: KagiSessionState,
	target: Pick<KagiVideoRuleTarget, "platformId" | "creatorId">,
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const runtimeDeps = resolveDeps(deps);
	const result = yield* Effect.tryPromise({
		try: () => runtimeDeps.runVideoRuleDelete(session, target),
		catch: (cause) => mapTransportFailure("rules:video:delete", cause),
	});
	return yield* ensureExpectedStatus("rules:video:delete", result);
});

export const runKagiVideoRuleSetFromDomainEffect = Effect.fn("Kagi.runKagiVideoRuleSetFromDomainEffect")(function* (
	session: KagiSessionState,
	domainOrUrl: string,
	kind: KagiRuleKind,
	creatorName?: string,
	deps?: Partial<KagiClientRuntimeDeps>,
) {
	const target = yield* parseKagiVideoRuleTargetEffect(domainOrUrl, creatorName, deps);
	return yield* runKagiVideoRuleSetEffect(session, target, kind, deps);
});

export const runKagiVideoRuleDeleteFromDomainEffect = Effect.fn(
	"Kagi.runKagiVideoRuleDeleteFromDomainEffect",
)(function* (session: KagiSessionState, domainOrUrl: string, deps?: Partial<KagiClientRuntimeDeps>) {
	const target = yield* parseKagiVideoRuleTargetEffect(domainOrUrl, undefined, deps);
	return yield* runKagiVideoRuleDeleteEffect(
		session,
		{
			platformId: target.platformId,
			creatorId: target.creatorId,
		},
		deps,
	);
});
