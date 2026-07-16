import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { FragmentValueError, type PolicyFragmentRegistry, type PolicyJsonValue } from "./policy-fragment-registry";
import type { PolicyLiveSession } from "./policy-inspection";
import {
	POLICY_REGISTRY_DIGEST,
	type PolicyAppendOptions,
	type PolicyHead,
	type PolicyJournal,
} from "./policy-journal";
import {
	type EffectiveFragmentPolicyValue,
	type EffectivePolicyValue,
	type EffectiveProviderPolicyValue,
	POLICY_LAYER_PRECEDENCE,
	type PolicyCandidate,
	type FragmentPolicyCandidate,
	type PolicyProjectionOptions,
	type PolicySnapshot,
	type PolicySourceLayer,
	type ProviderPolicyCandidate,
	type PolicyFragmentNotice,
	type ProviderPostureEntry,
	projectPolicy,
} from "./policy-projection";
import { PolicyProjectionStore } from "./policy-projection-store";
import {
	CORE_BUDGET_FRAGMENT_VERSION,
	CORE_FALLBACK_FRAGMENT_VERSION,
	CORE_NON_PROVIDER_KEYS,
	CORE_POLICY_KEYS,
	CORE_PROVIDER_FRAGMENT_VERSION,
	CORE_PROVIDER_KEYS,
	CORE_ROUTING_FRAGMENT_VERSION,
	type AnyPolicyKey,
	type AnyPolicyValue,
	type CoreBudgetValue,
	type CoreNonProviderKey,
	type CoreProviderKey,
	type CoreRoutingValue,
	type ExtensionPolicyKey,
	decodePolicyValueForKey,
	type FallbackChainsValue,
	isCoreProviderKey,
	isExtensionPolicyKey,
	isPolicyKey,
	type ModelDenyValue,
	POLICY_REGISTRY_VERSION,
	PolicyForkDetectedError,
	type PolicyImportProvenance,
	PolicyJournalIoError,
	type PolicyKey,
	PolicyLeaseConflictError,
	type PolicyScope,
	type PolicyTransactionDraftV1,
	type PolicyTransactionV1,
	type PolicyValue,
	type ProviderDenyValue,
	type SetPolicyMutationV1,
	StalePolicyHeadError,
	TornPolicyJournalError,
	UnknownPolicyKeyError,
} from "./policy-records";

export type PolicyServiceFailure =
	| TornPolicyJournalError
	| PolicyForkDetectedError
	| StalePolicyHeadError
	| PolicyLeaseConflictError
	| UnknownPolicyKeyError
	| FragmentValueError
	| PolicyJournalIoError;

export interface PolicyExplainLayer {
	readonly layer: PolicySourceLayer;
	readonly candidates: readonly (PolicyCandidate | ProviderPolicyCandidate | FragmentPolicyCandidate)[];
}

export type PolicyWindowState = "active" | "future" | "expired";

export interface PolicyProvenanceEntry {
	readonly key: AnyPolicyKey;
	readonly operation: PolicyTransactionV1["mutations"][number]["op"];
	readonly value?: AnyPolicyValue;
	readonly layer: PolicySourceLayer;
	readonly precedence: number;
	readonly scope: PolicyScope;
	readonly transactionId: string;
	readonly sequence: number;
	readonly recordHash: string;
	readonly author: PolicyTransactionV1["author"];
	readonly source: PolicyTransactionV1["source"];
	readonly reason: string;
	readonly effectiveFrom: string;
	readonly expiresAt?: string;
	readonly state: PolicyWindowState;
	readonly importProvenance?: PolicyImportProvenance;
	readonly projectionStatus?: "active" | "unregistered" | "newer-version" | "invalid";
	readonly storedVersion?: number;
	readonly currentVersion?: number;
	readonly registration?: string;
	readonly notice?: string;
}

export interface RoutingPolicyExplanation {
	readonly key: CoreNonProviderKey;
	readonly consultedLayers: readonly PolicyExplainLayer[];
	readonly winner?: EffectivePolicyValue;
	readonly shadowed: readonly PolicyCandidate[];
	readonly stack: readonly PolicyProvenanceEntry[];
}

export type ProviderPolicyExplanationStatus = "active" | "future" | "expired" | "unset";
export type ProviderPolicyCountdownTarget = "effectiveFrom" | "expiresAt" | "none";

export interface ProviderPolicyExplanation {
	readonly key: CoreProviderKey;
	readonly consultedLayers: readonly PolicyExplainLayer[];
	readonly status: ProviderPolicyExplanationStatus;
	readonly countdownTo: ProviderPolicyCountdownTarget;
	readonly remainingMs?: number;
	readonly winner?: EffectiveProviderPolicyValue;
	readonly shadowed: readonly ProviderPolicyCandidate[];
	readonly entries: readonly ProviderPostureEntry[];
	readonly stack: readonly PolicyProvenanceEntry[];
}

export interface FragmentPolicyExplanation {
	readonly key: ExtensionPolicyKey;
	readonly consultedLayers: readonly PolicyExplainLayer[];
	readonly winner?: EffectiveFragmentPolicyValue;
	readonly shadowed: readonly FragmentPolicyCandidate[];
	readonly notices: readonly PolicyFragmentNotice[];
	readonly stack: readonly PolicyProvenanceEntry[];
}

export type PolicyExplanation = RoutingPolicyExplanation | ProviderPolicyExplanation | FragmentPolicyExplanation;

export interface PolicyDiffChange {
	readonly key: AnyPolicyKey;
	readonly before?: EffectivePolicyValue | EffectiveProviderPolicyValue | EffectiveFragmentPolicyValue;
	readonly after?: EffectivePolicyValue | EffectiveProviderPolicyValue | EffectiveFragmentPolicyValue;
}

export interface PolicyDiff {
	readonly before: PolicySnapshot;
	readonly after: PolicySnapshot;
	readonly changes: readonly PolicyDiffChange[];
}

export interface PolicyDiffInput {
	readonly from: string;
	readonly to: string;
	readonly workstream?: string;
	readonly builtIns?: PolicyProjectionOptions["builtIns"];
	readonly fragmentRegistry?: PolicyFragmentRegistry;
}

export interface PolicyHistoryInput {
	readonly key?: string;
	readonly author?: string;
	readonly since?: string;
}

export interface PolicyHistoryRow {
	readonly sequence: number;
	readonly transactionId: string;
	readonly createdAt: string;
	readonly effectiveFrom: string;
	readonly expiresAt?: string;
	readonly author: PolicyTransactionV1["author"];
	readonly source: PolicyTransactionV1["source"];
	readonly reason: string;
	readonly rollbackOf?: string;
	readonly scopes: readonly PolicyScope[];
	readonly mutations: readonly PolicyTransactionV1["mutations"][number][];
}

export interface PolicyDriftValue {
	readonly value?: AnyPolicyValue;
	readonly sequence: number;
}

export interface PolicyDriftRow {
	readonly key: AnyPolicyKey;
	readonly applied: PolicyDriftValue;
	readonly head: PolicyDriftValue;
}

export interface PolicySessionDrift {
	readonly sessionId: string;
	readonly name?: string;
	readonly workstream?: string;
	readonly appliedSequence: number;
	readonly headSequence: number;
	readonly rows: readonly PolicyDriftRow[];
}

export interface PolicyImpactSession {
	readonly sessionId: string;
	readonly name?: string;
	readonly workstream?: string;
	readonly appliedSequence: number;
	readonly keys: readonly AnyPolicyKey[];
}

export interface PolicyImpactPreview {
	readonly committed: false;
	readonly transaction: PolicyTransactionV1;
	readonly sessions: readonly PolicyImpactSession[];
}

export interface PolicySetInput {
	readonly key: string;
	readonly value: AnyPolicyValue;
	readonly scope: PolicyScope;
	readonly reason: string;
	readonly author?: PolicyTransactionDraftV1["author"];
	readonly source?: PolicyTransactionDraftV1["source"];
	readonly effectiveFrom?: string;
	readonly expiresAt?: string;
	readonly expectedHead?: PolicyHead;
	readonly dryRun?: boolean;
	readonly workstream?: string;
	readonly importProvenance?: PolicyImportProvenance;
}

export interface PolicySetResult {
	readonly committed: boolean;
	readonly transaction: PolicyTransactionV1;
	readonly diff: PolicyDiff;
}

export interface PolicyRollbackServiceInput {
	readonly transactionId: string;
	readonly reason: string;
	readonly author?: PolicyTransactionDraftV1["author"];
	readonly source?: PolicyTransactionDraftV1["source"];
	readonly effectiveFrom?: string;
	readonly expectedHead?: PolicyHead;
	readonly workstream?: string;
	readonly dryRun?: boolean;
}

export interface PolicyRollbackResult {
	readonly transaction: PolicyTransactionV1;
	readonly snapshot: PolicySnapshot;
	readonly committed: boolean;
	readonly diff: PolicyDiff;
}

export interface PolicyService {
	readonly get: (
		key: string,
		options?: PolicyProjectionOptions,
	) => Effect.Effect<
		EffectivePolicyValue | EffectiveProviderPolicyValue | EffectiveFragmentPolicyValue | undefined,
		PolicyServiceFailure
	>;
	readonly explain: (
		key: string,
		options?: PolicyProjectionOptions,
	) => Effect.Effect<PolicyExplanation, PolicyServiceFailure>;
	readonly diff: (input: PolicyDiffInput) => Effect.Effect<PolicyDiff, PolicyServiceFailure>;
	readonly history: (input?: PolicyHistoryInput) => Effect.Effect<readonly PolicyHistoryRow[], PolicyServiceFailure>;
	readonly drift: (
		sessions: readonly PolicyLiveSession[],
		options?: Pick<PolicyProjectionOptions, "at" | "builtIns" | "fragmentRegistry">,
	) => Effect.Effect<readonly PolicySessionDrift[], PolicyServiceFailure>;
	readonly impactSet: (
		input: PolicySetInput,
		sessions: readonly PolicyLiveSession[],
	) => Effect.Effect<PolicyImpactPreview, PolicyServiceFailure>;
	readonly impactRollback: (
		input: PolicyRollbackServiceInput,
		sessions: readonly PolicyLiveSession[],
	) => Effect.Effect<PolicyImpactPreview, PolicyServiceFailure>;
	readonly rebuildProjection: (
		options?: PolicyProjectionOptions,
	) => Effect.Effect<PolicySnapshot, PolicyServiceFailure>;
	readonly set: (input: PolicySetInput) => Effect.Effect<PolicySetResult, PolicyServiceFailure>;
	readonly rollback: (input: PolicyRollbackServiceInput) => Effect.Effect<PolicyRollbackResult, PolicyServiceFailure>;
	readonly snapshot: (options?: PolicyProjectionOptions) => Effect.Effect<PolicySnapshot, PolicyServiceFailure>;
}

function asPolicyServiceFailure(error: unknown): PolicyServiceFailure {
	if (
		error instanceof TornPolicyJournalError ||
		error instanceof PolicyForkDetectedError ||
		error instanceof StalePolicyHeadError ||
		error instanceof PolicyLeaseConflictError ||
		error instanceof UnknownPolicyKeyError ||
		error instanceof FragmentValueError ||
		error instanceof PolicyJournalIoError
	) {
		return error;
	}
	return new PolicyJournalIoError({
		operation: "policy service",
		path: "policy-v1.jsonl",
		reason: error instanceof Error ? error.message : String(error),
	});
}

function requirePolicyKey(key: string): AnyPolicyKey {
	if (isPolicyKey(key) || isExtensionPolicyKey(key)) return key;
	const normalized = key.toLowerCase();
	const suggestions = CORE_POLICY_KEYS.filter(
		candidate => candidate.includes(normalized) || normalized.includes(candidate.slice(candidate.indexOf(".") + 1)),
	);
	throw new UnknownPolicyKeyError({
		key: key.length === 0 ? "<empty>" : key,
		suggestions: suggestions.length > 0 ? suggestions.slice(0, 3) : CORE_POLICY_KEYS.slice(0, 3),
	});
}

function setMutation(
	key: AnyPolicyKey,
	value: AnyPolicyValue,
	scope: PolicyScope,
	fragmentRegistry: PolicyFragmentRegistry | undefined,
	importProvenance?: PolicyImportProvenance,
): SetPolicyMutationV1 {
	const provenance = importProvenance === undefined ? {} : { importProvenance };
	if (isExtensionPolicyKey(key)) {
		const registration = fragmentRegistry?.resolve(key);
		if (registration === undefined) {
			throw new FragmentValueError({
				key,
				propertyPath: "$",
				registration: "unregistered",
				reason: "extension namespace is not registered",
			});
		}
		return {
			op: "set",
			key,
			scope,
			...provenance,
			fragmentVersion: registration.version,
			value: value as PolicyJsonValue,
		};
	}
	switch (key) {
		case "core.providers.deny.providers":
			return {
				op: "set",
				key,
				scope,
				...provenance,
				fragmentVersion: CORE_PROVIDER_FRAGMENT_VERSION,
				value: value as ProviderDenyValue,
			};
		case "core.providers.deny.models":
			return {
				op: "set",
				key,
				scope,
				...provenance,
				fragmentVersion: CORE_PROVIDER_FRAGMENT_VERSION,
				value: value as ModelDenyValue,
			};
		case "core.fallback.chains":
			return {
				op: "set",
				key,
				scope,
				...provenance,
				fragmentVersion: CORE_FALLBACK_FRAGMENT_VERSION,
				value: value as FallbackChainsValue,
			};
		case "core.budgets.task.maxConcurrency":
		case "core.budgets.task.maxLiveChildren":
		case "core.budgets.task.maxRuntimeMs":
		case "core.budgets.task.softRequestBudget":
			return {
				op: "set",
				key,
				scope,
				...provenance,
				fragmentVersion: CORE_BUDGET_FRAGMENT_VERSION,
				value: value as CoreBudgetValue,
			};
		default:
			return {
				op: "set",
				key,
				scope,
				...provenance,
				fragmentVersion: CORE_ROUTING_FRAGMENT_VERSION,
				value: value as CoreRoutingValue,
			};
	}
}

function samePolicyValue(left: AnyPolicyValue | undefined, right: AnyPolicyValue | undefined): boolean {
	if (left === right) return true;
	if (left === undefined || right === undefined || typeof left !== "object" || typeof right !== "object") return false;
	if (left === null || right === null) return false;
	if (Array.isArray(left)) {
		if (!Array.isArray(right) || left.length !== right.length) return false;
		for (let index = 0; index < left.length; index += 1) {
			if (!samePolicyValue(left[index], right[index])) return false;
		}
		return true;
	}
	if (Array.isArray(right)) return false;
	if ("providerIds" in left && Array.isArray(left.providerIds)) {
		if (
			!("providerIds" in right) ||
			!Array.isArray(right.providerIds) ||
			left.providerIds.length !== right.providerIds.length
		)
			return false;
		for (const provider of left.providerIds) if (!right.providerIds.includes(provider)) return false;
		return true;
	}
	if ("models" in left && Array.isArray(left.models)) {
		if (!("models" in right) || !Array.isArray(right.models) || left.models.length !== right.models.length)
			return false;
		for (const model of left.models) {
			if (
				typeof model !== "object" ||
				model === null ||
				!("provider" in model) ||
				!("model" in model) ||
				!right.models.some(
					candidate =>
						typeof candidate === "object" &&
						candidate !== null &&
						"provider" in candidate &&
						"model" in candidate &&
						candidate.provider === model.provider &&
						candidate.model === model.model,
				)
			)
				return false;
		}
		return true;
	}
	const leftRecord = left as Readonly<Record<string, AnyPolicyValue>>;
	const rightRecord = right as Readonly<Record<string, AnyPolicyValue>>;
	const leftKeys = Object.keys(leftRecord);
	const rightKeys = Object.keys(rightRecord);
	if (leftKeys.length !== rightKeys.length) return false;
	for (const key of leftKeys) {
		if (!(key in rightRecord) || !samePolicyValue(leftRecord[key], rightRecord[key])) return false;
	}
	return true;
}

function sameEffectiveValue(
	left: EffectivePolicyValue | EffectiveProviderPolicyValue | EffectiveFragmentPolicyValue | undefined,
	right: EffectivePolicyValue | EffectiveProviderPolicyValue | EffectiveFragmentPolicyValue | undefined,
): boolean {
	return (
		samePolicyValue(left?.value, right?.value) &&
		left?.sourceLayer === right?.sourceLayer &&
		left?.transactionId === right?.transactionId &&
		left?.sequence === right?.sequence
	);
}

function diffSnapshots(before: PolicySnapshot, after: PolicySnapshot): PolicyDiff {
	const changes: PolicyDiffChange[] = [];
	for (const key of CORE_NON_PROVIDER_KEYS) {
		const previous = before.values[key];
		const next = after.values[key];
		if (sameEffectiveValue(previous, next)) continue;
		changes.push({
			key,
			...(previous === undefined ? {} : { before: previous }),
			...(next === undefined ? {} : { after: next }),
		});
	}
	for (const key of CORE_PROVIDER_KEYS) {
		const previous = before.providerPosture?.values[key];
		const next = after.providerPosture?.values[key];
		if (sameEffectiveValue(previous, next)) continue;
		changes.push({
			key,
			...(previous === undefined ? {} : { before: previous }),
			...(next === undefined ? {} : { after: next }),
		});
	}
	const fragmentKeys = new Set<ExtensionPolicyKey>([
		...(Object.keys(before.fragmentValues ?? {}) as ExtensionPolicyKey[]),
		...(Object.keys(after.fragmentValues ?? {}) as ExtensionPolicyKey[]),
	]);
	for (const key of fragmentKeys) {
		const previous = before.fragmentValues?.[key];
		const next = after.fragmentValues?.[key];
		if (sameEffectiveValue(previous, next)) continue;
		changes.push({
			key,
			...(previous === undefined ? {} : { before: previous }),
			...(next === undefined ? {} : { after: next }),
		});
	}
	return { before, after, changes };
}

function provenanceStack(
	records: readonly PolicyTransactionV1[],
	key: AnyPolicyKey,
	options: Pick<PolicyProjectionOptions, "at" | "workstream" | "fragmentRegistry">,
): readonly PolicyProvenanceEntry[] {
	const at = Date.parse(options.at ?? new Date().toISOString());
	const stack: PolicyProvenanceEntry[] = [];
	for (const record of records) {
		const effectiveFrom = Date.parse(record.effectiveFrom);
		const expiresAt = record.expiresAt === undefined ? undefined : Date.parse(record.expiresAt);
		const state: PolicyWindowState =
			effectiveFrom > at ? "future" : expiresAt !== undefined && expiresAt <= at ? "expired" : "active";
		for (const mutation of record.mutations) {
			if (mutation.key !== key) continue;
			if (mutation.scope.kind === "workstream" && mutation.scope.workstream !== options.workstream) continue;
			const layer: PolicySourceLayer =
				record.expiresAt !== undefined
					? "temporary-posture"
					: mutation.scope.kind === "workstream"
						? "workstream-durable"
						: "global-durable";
			let projection:
				| {
						readonly projectionStatus: "active" | "unregistered" | "newer-version" | "invalid";
						readonly storedVersion: number;
						readonly currentVersion?: number;
						readonly registration?: string;
						readonly notice?: string;
				  }
				| undefined;
			if (isExtensionPolicyKey(mutation.key)) {
				const registration = options.fragmentRegistry?.resolve(mutation.key);
				if (registration === undefined) {
					projection = {
						projectionStatus: "unregistered",
						storedVersion: mutation.fragmentVersion,
						notice: `Extension policy fragment ${mutation.key} is inert because its namespace is not registered`,
					};
				} else if (mutation.fragmentVersion > registration.version) {
					projection = {
						projectionStatus: "newer-version",
						storedVersion: mutation.fragmentVersion,
						currentVersion: registration.version,
						registration: registration.registration,
						notice: `Extension policy fragment ${mutation.key} was written by newer registration version ${mutation.fragmentVersion}`,
					};
				} else if (mutation.op === "set") {
					const projected = options.fragmentRegistry!.project(
						mutation.key,
						mutation.fragmentVersion,
						mutation.value,
					);
					projection = {
						projectionStatus: projected.status,
						storedVersion: projected.storedVersion,
						...(projected.currentVersion === undefined ? {} : { currentVersion: projected.currentVersion }),
						...(projected.registration === undefined ? {} : { registration: projected.registration }),
						notice: projected.notice,
					};
				} else {
					projection = {
						projectionStatus: "active",
						storedVersion: mutation.fragmentVersion,
						currentVersion: registration.version,
						registration: registration.registration,
					};
				}
			}
			stack.push({
				key,
				operation: mutation.op,
				...(mutation.op === "set" ? { value: mutation.value } : {}),
				layer,
				precedence: POLICY_LAYER_PRECEDENCE.indexOf(layer),
				scope: mutation.scope,
				transactionId: record.transactionId,
				sequence: record.sequence,
				recordHash: record.recordHash,
				author: record.author,
				source: record.source,
				reason: record.reason,
				effectiveFrom: record.effectiveFrom,
				...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
				...(mutation.importProvenance === undefined ? {} : { importProvenance: mutation.importProvenance }),
				state,
				...(projection ?? {}),
			});
		}
	}
	return stack.sort((left, right) => left.precedence - right.precedence || right.sequence - left.sequence);
}

function sequenceSnapshot(
	records: readonly PolicyTransactionV1[],
	point: string,
	options: Pick<PolicyProjectionOptions, "workstream" | "builtIns" | "fragmentRegistry">,
): PolicySnapshot {
	if (/^(?:0|[1-9]\d*)$/.test(point)) {
		const sequence = Number(point);
		if (!Number.isSafeInteger(sequence) || sequence > records.length) {
			throw new Error(`Policy sequence ${point} is outside journal history 0..${records.length}`);
		}
		const prefix = records.slice(0, sequence);
		const at = prefix.at(-1)?.createdAt ?? records[0]?.createdAt ?? new Date().toISOString();
		return projectPolicy(prefix, { ...options, at });
	}
	return projectPolicy(records, { ...options, at: point });
}

function impactSessions(
	records: readonly PolicyTransactionV1[],
	transaction: PolicyTransactionV1,
	sessions: readonly PolicyLiveSession[],
	at: string,
	projectionDefaults: Pick<PolicyProjectionOptions, "builtIns" | "fragmentRegistry">,
): readonly PolicyImpactSession[] {
	const impacted: PolicyImpactSession[] = [];
	for (const session of sessions) {
		const before = projectPolicy(records, { ...projectionDefaults, at, workstream: session.workstream });
		const after = projectPolicy([...records, transaction], {
			...projectionDefaults,
			at,
			workstream: session.workstream,
		});
		const keys = diffSnapshots(before, after).changes.map(change => change.key);
		if (keys.length === 0) continue;
		impacted.push({
			sessionId: session.sessionId,
			...(session.name === undefined ? {} : { name: session.name }),
			...(session.workstream === undefined ? {} : { workstream: session.workstream }),
			appliedSequence: session.appliedSequence,
			keys,
		});
	}
	return impacted;
}

export function makePolicyService(
	journal: PolicyJournal,
	defaults: Pick<PolicyProjectionOptions, "builtIns" | "fragmentRegistry"> = {},
	projectionStore = new PolicyProjectionStore(journal.journalPath),
): PolicyService {
	const replay = Effect.fn("PolicyService.replay")(function* () {
		const authoritative = yield* Effect.tryPromise({ try: () => journal.replay(), catch: asPolicyServiceFailure });
		return yield* Effect.try({
			try: () => projectionStore.load(authoritative),
			catch: asPolicyServiceFailure,
		});
	});
	const snapshot = Effect.fn("PolicyService.snapshot")(function* (options: PolicyProjectionOptions = {}) {
		const records = yield* replay();
		return projectPolicy(records, { ...defaults, ...options, at: options.at ?? new Date().toISOString() });
	});
	const get = Effect.fn("PolicyService.get")(function* (key: string, options: PolicyProjectionOptions = {}) {
		const validatedKey = yield* Effect.try({ try: () => requirePolicyKey(key), catch: asPolicyServiceFailure });
		const projected = yield* snapshot(options);
		return isExtensionPolicyKey(validatedKey)
			? projected.fragmentValues?.[validatedKey]
			: isCoreProviderKey(validatedKey)
				? projected.providerPosture?.values[validatedKey]
				: projected.values[validatedKey];
	});
	const explain = Effect.fn("PolicyService.explain")(function* (key: string, options: PolicyProjectionOptions = {}) {
		const validatedKey = yield* Effect.try({ try: () => requirePolicyKey(key), catch: asPolicyServiceFailure });
		const records = yield* replay();
		const at = options.at ?? new Date().toISOString();
		const projected = projectPolicy(records, { ...defaults, ...options, at });
		const stack = provenanceStack(records, validatedKey, {
			at,
			workstream: options.workstream,
			fragmentRegistry: options.fragmentRegistry ?? defaults.fragmentRegistry,
		});
		if (isExtensionPolicyKey(validatedKey)) {
			const winner = projected.fragmentValues?.[validatedKey];
			const candidates: readonly FragmentPolicyCandidate[] =
				winner === undefined
					? []
					: [
							{
								key: winner.key,
								operation: "set",
								value: winner.value,
								fragmentVersion: winner.fragmentVersion,
								registration: winner.registration,
								sourceLayer: winner.sourceLayer,
								scope: winner.scope,
								transactionId: winner.transactionId,
								sequence: winner.sequence,
								recordHash: winner.recordHash,
							},
							...winner.shadowed,
						];
			return {
				key: validatedKey,
				consultedLayers: POLICY_LAYER_PRECEDENCE.map(layer => ({
					layer,
					candidates: candidates.filter(candidate => candidate.sourceLayer === layer),
				})),
				...(winner === undefined ? {} : { winner }),
				shadowed: winner?.shadowed ?? [],
				notices: (projected.fragmentNotices ?? []).filter(notice => notice.key === validatedKey),
				stack,
			};
		}
		if (isCoreProviderKey(validatedKey)) {
			const entries = projected.providerPosture?.entries.filter(entry => entry.key === validatedKey) ?? [];
			const winner = projected.providerPosture?.values[validatedKey];
			const activeEntry = entries.find(entry => entry.state === "active" && entry.effective);
			const futureEntries = entries.filter(entry => entry.state === "future");
			const expiredEntries = entries.filter(entry => entry.state === "expired");
			const nextFutureMs =
				futureEntries.length === 0
					? undefined
					: Math.min(...futureEntries.map(entry => entry.remainingMs ?? Number.MAX_SAFE_INTEGER));
			const status: ProviderPolicyExplanationStatus =
				winner !== undefined
					? "active"
					: futureEntries.length > 0
						? "future"
						: expiredEntries.length > 0
							? "expired"
							: "unset";
			const remainingMs =
				status === "active"
					? activeEntry?.remainingMs
					: status === "future"
						? nextFutureMs
						: status === "expired"
							? 0
							: undefined;
			const countdownTo: ProviderPolicyCountdownTarget =
				status === "future"
					? "effectiveFrom"
					: status === "active" && remainingMs !== undefined
						? "expiresAt"
						: "none";
			const candidates: readonly ProviderPolicyCandidate[] =
				winner === undefined
					? []
					: [
							{
								key: winner.key,
								operation: "set",
								value: winner.value,
								sourceLayer: winner.sourceLayer,
								scope: winner.scope,
								transactionId: winner.transactionId,
								sequence: winner.sequence,
								recordHash: winner.recordHash,
							},
							...winner.shadowed,
						];
			return {
				key: validatedKey,
				consultedLayers: POLICY_LAYER_PRECEDENCE.map(layer => ({
					layer,
					candidates: candidates.filter(candidate => candidate.sourceLayer === layer),
				})),
				status,
				countdownTo,
				...(remainingMs === undefined ? {} : { remainingMs }),
				...(winner === undefined ? {} : { winner }),
				shadowed: winner?.shadowed ?? [],
				entries,
				stack,
			};
		}
		const winner = projected.values[validatedKey];
		const candidates =
			winner === undefined
				? []
				: [
						{
							key: winner.key,
							operation: "set" as const,
							value: winner.value,
							sourceLayer: winner.sourceLayer,
							scope: winner.scope,
							...(winner.transactionId === undefined ? {} : { transactionId: winner.transactionId }),
							sequence: winner.sequence,
							...(winner.recordHash === undefined ? {} : { recordHash: winner.recordHash }),
						},
						...winner.shadowed,
					];
		return {
			key: validatedKey,
			consultedLayers: POLICY_LAYER_PRECEDENCE.map(layer => ({
				layer,
				candidates: candidates.filter(candidate => candidate.sourceLayer === layer),
			})),
			...(winner === undefined ? {} : { winner }),
			shadowed: winner?.shadowed ?? [],
			stack,
		};
	});
	const diff = Effect.fn("PolicyService.diff")(function* (input: PolicyDiffInput) {
		const records = yield* replay();
		const projectionOptions = {
			workstream: input.workstream,
			builtIns: input.builtIns ?? defaults.builtIns,
			fragmentRegistry: input.fragmentRegistry ?? defaults.fragmentRegistry,
		};
		const before = yield* Effect.try({
			try: () => sequenceSnapshot(records, input.from, projectionOptions),
			catch: asPolicyServiceFailure,
		});
		const after = yield* Effect.try({
			try: () => sequenceSnapshot(records, input.to, projectionOptions),
			catch: asPolicyServiceFailure,
		});
		return diffSnapshots(before, after);
	});
	const history = Effect.fn("PolicyService.history")(function* (input: PolicyHistoryInput = {}) {
		const key =
			input.key === undefined
				? undefined
				: yield* Effect.try({ try: () => requirePolicyKey(input.key!), catch: asPolicyServiceFailure });
		const since =
			input.since === undefined
				? undefined
				: yield* Effect.try({
						try: () => {
							const timestamp = Date.parse(input.since!);
							if (!Number.isFinite(timestamp))
								throw new Error("Policy history --since requires a valid timestamp");
							return timestamp;
						},
						catch: asPolicyServiceFailure,
					});
		const records = yield* replay();
		const rows: PolicyHistoryRow[] = [];
		for (const record of records) {
			if (since !== undefined && Date.parse(record.createdAt) < since) continue;
			if (
				input.author !== undefined &&
				record.author.kind !== input.author &&
				record.author.sessionId !== input.author &&
				String(record.author.uid) !== input.author
			) {
				continue;
			}
			const mutations =
				key === undefined ? record.mutations : record.mutations.filter(mutation => mutation.key === key);
			if (mutations.length === 0) continue;
			const scopes: PolicyScope[] = [];
			for (const mutation of mutations) {
				if (
					!scopes.some(scope =>
						scope.kind === "global"
							? mutation.scope.kind === "global"
							: mutation.scope.kind === "workstream" && mutation.scope.workstream === scope.workstream,
					)
				) {
					scopes.push(mutation.scope);
				}
			}
			rows.push({
				sequence: record.sequence,
				transactionId: record.transactionId,
				createdAt: record.createdAt,
				effectiveFrom: record.effectiveFrom,
				...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
				author: record.author,
				source: record.source,
				reason: record.reason,
				...(record.rollbackOf === undefined ? {} : { rollbackOf: record.rollbackOf }),
				scopes,
				mutations,
			});
		}
		return rows;
	});
	const drift = Effect.fn("PolicyService.drift")(function* (
		sessions: readonly PolicyLiveSession[],
		options: Pick<PolicyProjectionOptions, "at" | "builtIns" | "fragmentRegistry"> = {},
	) {
		const records = yield* replay();
		const at = options.at ?? new Date().toISOString();
		const headSequence = records.at(-1)?.sequence ?? 0;
		const result: PolicySessionDrift[] = [];
		for (const session of sessions) {
			const appliedRecords = records.slice(0, Math.min(session.appliedSequence, records.length));
			const applied = projectPolicy(appliedRecords, {
				at,
				workstream: session.workstream,
				builtIns: options.builtIns ?? defaults.builtIns,
				fragmentRegistry: options.fragmentRegistry ?? defaults.fragmentRegistry,
			});
			const head = projectPolicy(records, {
				at,
				workstream: session.workstream,
				builtIns: options.builtIns ?? defaults.builtIns,
				fragmentRegistry: options.fragmentRegistry ?? defaults.fragmentRegistry,
			});
			const rows: PolicyDriftRow[] = [];
			for (const key of CORE_POLICY_KEYS) {
				const appliedValue = isCoreProviderKey(key) ? applied.providerPosture?.values[key] : applied.values[key];
				const headValue = isCoreProviderKey(key) ? head.providerPosture?.values[key] : head.values[key];
				if (sameEffectiveValue(appliedValue, headValue)) continue;
				rows.push({
					key,
					applied: {
						...(appliedValue?.value === undefined ? {} : { value: appliedValue.value }),
						sequence: appliedValue?.sequence ?? 0,
					},
					head: {
						...(headValue?.value === undefined ? {} : { value: headValue.value }),
						sequence: headValue?.sequence ?? 0,
					},
				});
			}
			const fragmentKeys = new Set<ExtensionPolicyKey>([
				...(Object.keys(applied.fragmentValues ?? {}) as ExtensionPolicyKey[]),
				...(Object.keys(head.fragmentValues ?? {}) as ExtensionPolicyKey[]),
			]);
			for (const key of fragmentKeys) {
				const appliedValue = applied.fragmentValues?.[key];
				const headValue = head.fragmentValues?.[key];
				if (sameEffectiveValue(appliedValue, headValue)) continue;
				rows.push({
					key,
					applied: {
						...(appliedValue?.value === undefined ? {} : { value: appliedValue.value }),
						sequence: appliedValue?.sequence ?? 0,
					},
					head: {
						...(headValue?.value === undefined ? {} : { value: headValue.value }),
						sequence: headValue?.sequence ?? 0,
					},
				});
			}
			if (rows.length === 0) continue;
			result.push({
				sessionId: session.sessionId,
				...(session.name === undefined ? {} : { name: session.name }),
				...(session.workstream === undefined ? {} : { workstream: session.workstream }),
				appliedSequence: session.appliedSequence,
				headSequence,
				rows,
			});
		}
		return result;
	});
	const set = Effect.fn("PolicyService.set")(function* (input: PolicySetInput) {
		const key = yield* Effect.try({ try: () => requirePolicyKey(input.key), catch: asPolicyServiceFailure });
		const value = yield* Effect.try({
			try: () =>
				isExtensionPolicyKey(key)
					? (defaults.fragmentRegistry?.decodeCurrent(key, input.value as PolicyJsonValue) ??
						(() => {
							throw new FragmentValueError({
								key,
								propertyPath: "$",
								registration: "unregistered",
								reason: "extension namespace is not registered",
							});
						})())
					: decodePolicyValueForKey(key, input.value),
			catch: asPolicyServiceFailure,
		});
		const recordsBefore = yield* replay();
		const createdAt = new Date().toISOString();
		const draft: PolicyTransactionDraftV1 = {
			transactionId: randomUUID(),
			createdAt,
			effectiveFrom: input.effectiveFrom ?? createdAt,
			...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
			author: input.author ?? { kind: "cli", uid: journal.uid, pid: journal.pid },
			source: input.source ?? { kind: "cli", uri: journal.journalPath },
			reason: input.reason,
			registry: {
				version: POLICY_REGISTRY_VERSION,
				digest: defaults.fragmentRegistry?.digest ?? POLICY_REGISTRY_DIGEST,
			},
			mutations: [setMutation(key, value, input.scope, defaults.fragmentRegistry, input.importProvenance)],
		};
		const appendOptions: PolicyAppendOptions =
			input.expectedHead === undefined ? {} : { expectedHead: input.expectedHead };
		const transaction = yield* Effect.tryPromise({
			try: () =>
				input.dryRun === true ? journal.previewAppend(draft, appendOptions) : journal.append(draft, appendOptions),
			catch: asPolicyServiceFailure,
		});
		const at = transaction.createdAt;
		const before = projectPolicy(recordsBefore, { ...defaults, workstream: input.workstream, at });
		const after = projectPolicy([...recordsBefore, transaction], { ...defaults, workstream: input.workstream, at });
		return { committed: input.dryRun !== true, transaction, diff: diffSnapshots(before, after) };
	});
	const rollback = Effect.fn("PolicyService.rollback")(function* (input: PolicyRollbackServiceInput) {
		const recordsBefore = yield* replay();
		const rollbackInput = {
			transactionId: input.transactionId,
			author: input.author ?? { kind: "cli" as const, uid: journal.uid, pid: journal.pid },
			source: input.source ?? { kind: "cli" as const, uri: journal.journalPath },
			reason: input.reason,
			...(input.effectiveFrom === undefined ? {} : { effectiveFrom: input.effectiveFrom }),
			...(input.expectedHead === undefined ? {} : { expectedHead: input.expectedHead }),
		};
		const transaction = yield* Effect.tryPromise({
			try: () => (input.dryRun === true ? journal.previewRollback(rollbackInput) : journal.rollback(rollbackInput)),
			catch: asPolicyServiceFailure,
		});
		const recordsAfter = input.dryRun === true ? [...recordsBefore, transaction] : yield* replay();
		const at = transaction.createdAt;
		const before = projectPolicy(recordsBefore, { ...defaults, workstream: input.workstream, at });
		const after = projectPolicy(recordsAfter, { ...defaults, workstream: input.workstream, at });
		return {
			transaction,
			snapshot: after,
			committed: input.dryRun !== true,
			diff: diffSnapshots(before, after),
		};
	});
	const impactSet = Effect.fn("PolicyService.impactSet")(function* (
		input: PolicySetInput,
		sessions: readonly PolicyLiveSession[],
	) {
		const preview = yield* set({ ...input, dryRun: true });
		const records = yield* replay();
		return {
			committed: false as const,
			transaction: preview.transaction,
			sessions: impactSessions(records, preview.transaction, sessions, preview.transaction.effectiveFrom, defaults),
		};
	});
	const impactRollback = Effect.fn("PolicyService.impactRollback")(function* (
		input: PolicyRollbackServiceInput,
		sessions: readonly PolicyLiveSession[],
	) {
		const preview = yield* rollback({ ...input, dryRun: true });
		const records = yield* replay();
		return {
			committed: false as const,
			transaction: preview.transaction,
			sessions: impactSessions(records, preview.transaction, sessions, preview.transaction.effectiveFrom, defaults),
		};
	});
	const rebuildProjection = Effect.fn("PolicyService.rebuildProjection")(function* (
		options: PolicyProjectionOptions = {},
	) {
		const authoritative = yield* Effect.tryPromise({
			try: () => journal.replay(),
			catch: asPolicyServiceFailure,
		});
		const records = yield* Effect.try({
			try: () => projectionStore.rebuild(authoritative),
			catch: asPolicyServiceFailure,
		});
		return projectPolicy(records, { ...defaults, ...options, at: options.at ?? new Date().toISOString() });
	});
	return {
		get,
		explain,
		diff,
		history,
		drift,
		impactSet,
		impactRollback,
		rebuildProjection,
		set,
		rollback,
		snapshot,
	};
}
