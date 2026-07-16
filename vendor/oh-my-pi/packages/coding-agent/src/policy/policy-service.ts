import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { PolicyLiveSession } from "./policy-inspection";
import { type PolicyAppendOptions, type PolicyHead, PolicyJournal, POLICY_REGISTRY_DIGEST } from "./policy-journal";
import {
	type EffectivePolicyValue,
	type EffectiveProviderPolicyValue,
	POLICY_LAYER_PRECEDENCE,
	type PolicyCandidate,
	projectPolicy,
	type PolicyProjectionOptions,
	type PolicySnapshot,
	type PolicySourceLayer,
	type ProviderPolicyCandidate,
	type ProviderPostureEntry,
} from "./policy-projection";
import { PolicyProjectionStore } from "./policy-projection-store";
import {
	CORE_POLICY_KEYS,
	CORE_PROVIDER_KEYS,
	CORE_PROVIDER_FRAGMENT_VERSION,
	CORE_ROUTING_KEYS,
	CORE_ROUTING_FRAGMENT_VERSION,
	type CoreProviderKey,
	type CoreRoutingKey,
	type CoreRoutingValue,
	decodePolicyValueForKey,
	isCoreRoutingKey,
	isPolicyKey,
	type ModelDenyValue,
	POLICY_REGISTRY_VERSION,
	type PolicyKey,
	PolicyForkDetectedError,
	PolicyJournalIoError,
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
	| PolicyJournalIoError;

export interface PolicyExplainLayer {
	readonly layer: PolicySourceLayer;
	readonly candidates: readonly (PolicyCandidate | ProviderPolicyCandidate)[];
}

export type PolicyWindowState = "active" | "future" | "expired";

export interface PolicyProvenanceEntry {
	readonly key: PolicyKey;
	readonly operation: PolicyTransactionV1["mutations"][number]["op"];
	readonly value?: PolicyValue;
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
}

export interface RoutingPolicyExplanation {
	readonly key: CoreRoutingKey;
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

export type PolicyExplanation = RoutingPolicyExplanation | ProviderPolicyExplanation;

export interface PolicyDiffChange {
	readonly key: PolicyKey;
	readonly before?: EffectivePolicyValue | EffectiveProviderPolicyValue;
	readonly after?: EffectivePolicyValue | EffectiveProviderPolicyValue;
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
	readonly value?: PolicyValue;
	readonly sequence: number;
}

export interface PolicyDriftRow {
	readonly key: PolicyKey;
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
	readonly keys: readonly PolicyKey[];
}

export interface PolicyImpactPreview {
	readonly committed: false;
	readonly transaction: PolicyTransactionV1;
	readonly sessions: readonly PolicyImpactSession[];
}

export interface PolicySetInput {
	readonly key: string;
	readonly value: PolicyValue;
	readonly scope: PolicyScope;
	readonly reason: string;
	readonly author?: PolicyTransactionDraftV1["author"];
	readonly source?: PolicyTransactionDraftV1["source"];
	readonly effectiveFrom?: string;
	readonly expiresAt?: string;
	readonly expectedHead?: PolicyHead;
	readonly dryRun?: boolean;
	readonly workstream?: string;
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
	) => Effect.Effect<EffectivePolicyValue | EffectiveProviderPolicyValue | undefined, PolicyServiceFailure>;
	readonly explain: (
		key: string,
		options?: PolicyProjectionOptions,
	) => Effect.Effect<PolicyExplanation, PolicyServiceFailure>;
	readonly diff: (input: PolicyDiffInput) => Effect.Effect<PolicyDiff, PolicyServiceFailure>;
	readonly history: (input?: PolicyHistoryInput) => Effect.Effect<readonly PolicyHistoryRow[], PolicyServiceFailure>;
	readonly drift: (
		sessions: readonly PolicyLiveSession[],
		options?: Pick<PolicyProjectionOptions, "at" | "builtIns">,
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

function requirePolicyKey(key: string): PolicyKey {
	if (isPolicyKey(key)) return key;
	const normalized = key.toLowerCase();
	const suggestions = CORE_POLICY_KEYS.filter(
		candidate => candidate.includes(normalized) || normalized.includes(candidate.slice(candidate.indexOf(".") + 1)),
	);
	throw new UnknownPolicyKeyError({
		key: key.length === 0 ? "<empty>" : key,
		suggestions: suggestions.length > 0 ? suggestions.slice(0, 3) : CORE_POLICY_KEYS.slice(0, 3),
	});
}

function setMutation(key: PolicyKey, value: PolicyValue, scope: PolicyScope): SetPolicyMutationV1 {
	switch (key) {
		case "core.providers.deny.providers":
			return {
				op: "set",
				key,
				scope,
				fragmentVersion: CORE_PROVIDER_FRAGMENT_VERSION,
				value: value as ProviderDenyValue,
			};
		case "core.providers.deny.models":
			return {
				op: "set",
				key,
				scope,
				fragmentVersion: CORE_PROVIDER_FRAGMENT_VERSION,
				value: value as ModelDenyValue,
			};
		default:
			return {
				op: "set",
				key,
				scope,
				fragmentVersion: CORE_ROUTING_FRAGMENT_VERSION,
				value: value as CoreRoutingValue,
			};
	}
}

function samePolicyValue(left: PolicyValue | undefined, right: PolicyValue | undefined): boolean {
	if (left === right) return true;
	if (left === undefined || right === undefined || typeof left === "string" || typeof right === "string") return false;
	if ("providerIds" in left) {
		if (!("providerIds" in right) || left.providerIds.length !== right.providerIds.length) return false;
		for (const provider of left.providerIds) if (!right.providerIds.includes(provider)) return false;
		return true;
	}
	if (!("models" in right) || left.models.length !== right.models.length) return false;
	for (const model of left.models) {
		let matched = false;
		for (const candidate of right.models) {
			if (candidate.provider === model.provider && candidate.model === model.model) {
				matched = true;
				break;
			}
		}
		if (!matched) return false;
	}
	return true;
}

function sameEffectiveValue(
	left: EffectivePolicyValue | EffectiveProviderPolicyValue | undefined,
	right: EffectivePolicyValue | EffectiveProviderPolicyValue | undefined,
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
	for (const key of CORE_ROUTING_KEYS) {
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
	return { before, after, changes };
}


function provenanceStack(
	records: readonly PolicyTransactionV1[],
	key: PolicyKey,
	options: Pick<PolicyProjectionOptions, "at" | "workstream">,
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
				state,
			});
		}
	}
	return stack.sort((left, right) => left.precedence - right.precedence || right.sequence - left.sequence);
}

function sequenceSnapshot(
	records: readonly PolicyTransactionV1[],
	point: string,
	options: Pick<PolicyProjectionOptions, "workstream" | "builtIns">,
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
	builtIns: PolicyProjectionOptions["builtIns"],
): readonly PolicyImpactSession[] {
	const impacted: PolicyImpactSession[] = [];
	for (const session of sessions) {
		const before = projectPolicy(records, { at, workstream: session.workstream, builtIns });
		const after = projectPolicy([...records, transaction], { at, workstream: session.workstream, builtIns });
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
	defaults: Pick<PolicyProjectionOptions, "builtIns"> = {},
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
		return isCoreRoutingKey(validatedKey)
			? projected.values[validatedKey]
			: projected.providerPosture?.values[validatedKey];
	});
	const explain = Effect.fn("PolicyService.explain")(function* (key: string, options: PolicyProjectionOptions = {}) {
		const validatedKey = yield* Effect.try({ try: () => requirePolicyKey(key), catch: asPolicyServiceFailure });
		const records = yield* replay();
		const at = options.at ?? new Date().toISOString();
		const projected = projectPolicy(records, { ...defaults, ...options, at });
		const stack = provenanceStack(records, validatedKey, { at, workstream: options.workstream });
		if (!isCoreRoutingKey(validatedKey)) {
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
							if (!Number.isFinite(timestamp)) throw new Error("Policy history --since requires a valid timestamp");
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
			const mutations = key === undefined ? record.mutations : record.mutations.filter(mutation => mutation.key === key);
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
		options: Pick<PolicyProjectionOptions, "at" | "builtIns"> = {},
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
			});
			const head = projectPolicy(records, {
				at,
				workstream: session.workstream,
				builtIns: options.builtIns ?? defaults.builtIns,
			});
			const rows: PolicyDriftRow[] = [];
			for (const key of CORE_POLICY_KEYS) {
				const appliedValue = isCoreRoutingKey(key) ? applied.values[key] : applied.providerPosture?.values[key];
				const headValue = isCoreRoutingKey(key) ? head.values[key] : head.providerPosture?.values[key];
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
			try: () => decodePolicyValueForKey(key, input.value),
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
			registry: { version: POLICY_REGISTRY_VERSION, digest: POLICY_REGISTRY_DIGEST },
			mutations: [setMutation(key, value, input.scope)],
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
			sessions: impactSessions(
				records,
				preview.transaction,
				sessions,
				preview.transaction.effectiveFrom,
				defaults.builtIns,
			),
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
			sessions: impactSessions(
				records,
				preview.transaction,
				sessions,
				preview.transaction.effectiveFrom,
				defaults.builtIns,
			),
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
