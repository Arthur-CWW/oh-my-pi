import { scheduler } from "node:timers/promises";
import type { AuthStorage } from "@oh-my-pi/pi-ai";
import type { CustomEntry, FileEntry } from "./session-entries";
import type { SessionManager } from "./session-manager";

export const PROVIDER_RECOVERY_CUSTOM_TYPE = "provider_recovery";
export const PROVIDER_RECOVERY_MAX_DEADLINE_MS = 24 * 60 * 60 * 1000;
export const PROVIDER_RECOVERY_RESET_JITTER_MS = 1_000;

export type ProviderRecoveryKind = "auth-invalid" | "rate-limit";
export type ProviderRecoveryState = "waiting" | "retrying" | "resolved" | "cancelled" | "exhausted";
export type ProviderRecoveryUserAction = "refresh-credentials" | "wait-for-reset";

export interface ProviderRecoveryRecord {
	readonly version: 1;
	readonly agentId: string;
	readonly provider: string;
	readonly model: string;
	readonly route: string;
	readonly kind: ProviderRecoveryKind;
	readonly state: ProviderRecoveryState;
	readonly userAction: ProviderRecoveryUserAction;
	readonly attempt: number;
	readonly maxAttempts: number;
	readonly deadlineAt: number;
	readonly retryAt?: number;
	readonly credentialSlotId?: string;
	readonly updatedAt: string;
}

export type ProviderRecoveryRecordDecode =
	| { readonly kind: "not_recovery" }
	| { readonly kind: "invalid" }
	| { readonly kind: "valid"; readonly record: ProviderRecoveryRecord };

type RecoverySessionManager = Pick<SessionManager, "appendCustomEntry" | "getEntries">;

const RECOVERY_STATES: Record<ProviderRecoveryState, true> = {
	waiting: true,
	retrying: true,
	resolved: true,
	cancelled: true,
	exhausted: true,
};

const RECOVERY_KINDS: Record<ProviderRecoveryKind, true> = {
	"auth-invalid": true,
	"rate-limit": true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeProviderRecoveryEntry(entry: FileEntry): ProviderRecoveryRecordDecode {
	if (entry.type !== "custom" || entry.customType !== PROVIDER_RECOVERY_CUSTOM_TYPE) return { kind: "not_recovery" };
	const data = (entry as CustomEntry).data;
	if (!isRecord(data)) return { kind: "invalid" };
	const {
		version,
		agentId,
		provider,
		model,
		route,
		kind,
		state,
		userAction,
		attempt,
		maxAttempts,
		deadlineAt,
		retryAt,
		credentialSlotId,
		updatedAt,
	} = data;
	if (
		version !== 1 ||
		typeof agentId !== "string" ||
		agentId.length === 0 ||
		typeof provider !== "string" ||
		provider.length === 0 ||
		typeof model !== "string" ||
		model.length === 0 ||
		typeof route !== "string" ||
		route.length === 0 ||
		typeof kind !== "string" ||
		!(kind in RECOVERY_KINDS) ||
		typeof state !== "string" ||
		!(state in RECOVERY_STATES) ||
		(userAction !== "refresh-credentials" && userAction !== "wait-for-reset") ||
		typeof attempt !== "number" ||
		!Number.isInteger(attempt) ||
		attempt < 1 ||
		typeof maxAttempts !== "number" ||
		!Number.isInteger(maxAttempts) ||
		maxAttempts < attempt ||
		typeof deadlineAt !== "number" ||
		!Number.isFinite(deadlineAt) ||
		(retryAt !== undefined && (typeof retryAt !== "number" || !Number.isFinite(retryAt))) ||
		(credentialSlotId !== undefined && (typeof credentialSlotId !== "string" || credentialSlotId.length === 0)) ||
		typeof updatedAt !== "string" ||
		!Number.isFinite(Date.parse(updatedAt))
	) {
		return { kind: "invalid" };
	}
	return {
		kind: "valid",
		record: {
			version,
			agentId,
			provider,
			model,
			route,
			kind: kind as ProviderRecoveryKind,
			state: state as ProviderRecoveryState,
			userAction,
			attempt,
			maxAttempts,
			deadlineAt,
			...(retryAt === undefined ? {} : { retryAt }),
			...(credentialSlotId === undefined ? {} : { credentialSlotId }),
			updatedAt,
		},
	};
}

export function appendProviderRecoveryRecord(
	sessionManager: Pick<SessionManager, "appendCustomEntry">,
	record: ProviderRecoveryRecord,
): void {
	sessionManager.appendCustomEntry(PROVIDER_RECOVERY_CUSTOM_TYPE, record);
}

export function latestProviderRecoveryRecord(entries: readonly FileEntry[]): ProviderRecoveryRecord | undefined | null {
	let latest: ProviderRecoveryRecord | undefined;
	for (const entry of entries) {
		const decoded = decodeProviderRecoveryEntry(entry);
		if (decoded.kind === "invalid") return null;
		if (decoded.kind === "valid" && (!latest || Date.parse(decoded.record.updatedAt) >= Date.parse(latest.updatedAt))) {
			latest = decoded.record;
		}
	}
	return latest;
}

export function transitionProviderRecoveryRecord(
	sessionManager: RecoverySessionManager,
	state: ProviderRecoveryState,
	now = Date.now(),
): ProviderRecoveryRecord | undefined {
	const current = latestProviderRecoveryRecord(sessionManager.getEntries());
	if (!current || current.state === state) return current ?? undefined;
	const next = { ...current, state, updatedAt: new Date(now).toISOString() };
	appendProviderRecoveryRecord(sessionManager, next);
	return next;
}

export function isPendingProviderRecovery(record: ProviderRecoveryRecord | undefined | null): record is ProviderRecoveryRecord {
	return record?.state === "waiting" || record?.state === "retrying";
}

export function isAuthenticationInvalidError(message: string, status?: number): boolean {
	if (status === 401) return true;
	return /invalidated oauth token|invalid oauth token|oauth token (?:was )?(?:revoked|invalid|expired)|authentication_error|invalid authentication credentials|unauthorized/i.test(
		message,
	);
}

export function createProviderRecoveryRecord(input: {
	readonly agentId: string;
	readonly provider: string;
	readonly model: string;
	readonly route: string;
	readonly kind: ProviderRecoveryKind;
	readonly attempt: number;
	readonly maxAttempts: number;
	readonly now: number;
	readonly retryAt?: number;
	readonly credentialSlotId?: string;
}): ProviderRecoveryRecord {
	return {
		version: 1,
		agentId: input.agentId,
		provider: input.provider,
		model: input.model,
		route: input.route,
		kind: input.kind,
		state: "waiting",
		userAction: input.kind === "auth-invalid" ? "refresh-credentials" : "wait-for-reset",
		attempt: input.attempt,
		maxAttempts: input.maxAttempts,
		deadlineAt: input.now + PROVIDER_RECOVERY_MAX_DEADLINE_MS,
		...(input.retryAt === undefined ? {} : { retryAt: input.retryAt }),
		...(input.credentialSlotId === undefined ? {} : { credentialSlotId: input.credentialSlotId }),
		updatedAt: new Date(input.now).toISOString(),
	};
}

export async function waitForProviderRecovery(input: {
	readonly record: ProviderRecoveryRecord;
	readonly authStorage: Pick<AuthStorage, "getGeneration" | "onGenerationChanged">;
	readonly signal: AbortSignal;
	readonly now?: () => number;
	readonly random?: () => number;
	readonly wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}): Promise<"ready" | "cancelled" | "deadline"> {
	const now = input.now ?? Date.now;
	if (input.signal.aborted) return "cancelled";
	const remainingDeadline = input.record.deadlineAt - now();
	if (remainingDeadline <= 0) return "deadline";
	const wait = input.wait ?? ((delayMs, signal) => scheduler.wait(delayMs, { signal }));
	const controller = new AbortController();
	const onCancel = (): void => controller.abort();
	input.signal.addEventListener("abort", onCancel, { once: true });
	try {
		if (input.record.kind === "rate-limit") {
			const baseDelay = Math.max(0, (input.record.retryAt ?? now()) - now());
			const jitter = Math.floor((input.random ?? Math.random)() * PROVIDER_RECOVERY_RESET_JITTER_MS);
			const delay = Math.min(remainingDeadline, baseDelay + jitter);
			try {
				await wait(delay, controller.signal);
			} catch {
				return input.signal.aborted ? "cancelled" : "deadline";
			}
			return input.signal.aborted ? "cancelled" : now() >= input.record.deadlineAt ? "deadline" : "ready";
		}

		const generation = input.authStorage.getGeneration();
		const { promise, resolve } = Promise.withResolvers<"changed" | "deadline">();
		const unsubscribe = input.authStorage.onGenerationChanged(next => {
			if (next !== generation) resolve("changed");
		});
		void wait(remainingDeadline, controller.signal).then(
			() => resolve("deadline"),
			() => resolve("deadline"),
		);
		try {
			const outcome = await promise;
			if (input.signal.aborted) return "cancelled";
			return outcome === "changed" ? "ready" : "deadline";
		} finally {
			unsubscribe();
		}
	} finally {
		input.signal.removeEventListener("abort", onCancel);
		controller.abort();
	}
}
