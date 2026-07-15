import { randomUUID } from "node:crypto";
import { Effect } from "effect";
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

export interface RoutingPolicyExplanation {
	readonly key: CoreRoutingKey;
	readonly consultedLayers: readonly PolicyExplainLayer[];
	readonly winner?: EffectivePolicyValue;
	readonly shadowed: readonly PolicyCandidate[];
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
}

export interface PolicyRollbackResult {
	readonly transaction: PolicyTransactionV1;
	readonly snapshot: PolicySnapshot;
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

export function makePolicyService(
	journal: PolicyJournal,
	defaults: Pick<PolicyProjectionOptions, "builtIns"> = {},
): PolicyService {
	const replay = Effect.fn("PolicyService.replay")(function* () {
		return yield* Effect.tryPromise({ try: () => journal.replay(), catch: asPolicyServiceFailure });
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
		const projected = yield* snapshot(options);
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
			const consultedLayers = POLICY_LAYER_PRECEDENCE.map(layer => ({
				layer,
				candidates: candidates.filter(candidate => candidate.sourceLayer === layer),
			}));
			return {
				key: validatedKey,
				consultedLayers,
				status,
				countdownTo,
				...(remainingMs === undefined ? {} : { remainingMs }),
				...(winner === undefined ? {} : { winner }),
				shadowed: winner?.shadowed ?? [],
				entries,
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
		const consultedLayers = POLICY_LAYER_PRECEDENCE.map(layer => ({
			layer,
			candidates: candidates.filter(candidate => candidate.sourceLayer === layer),
		}));
		return {
			key: validatedKey,
			consultedLayers,
			...(winner === undefined ? {} : { winner }),
			shadowed: winner?.shadowed ?? [],
		};
	});
	const diff = Effect.fn("PolicyService.diff")(function* (input: PolicyDiffInput) {
		const records = yield* replay();
		const before = projectPolicy(records, {
			...defaults,
			at: input.from,
			workstream: input.workstream,
			builtIns: input.builtIns ?? defaults.builtIns,
		});
		const after = projectPolicy(records, {
			...defaults,
			at: input.to,
			workstream: input.workstream,
			builtIns: input.builtIns ?? defaults.builtIns,
		});
		return diffSnapshots(before, after);
	});
	const set = Effect.fn("PolicyService.set")(function* (input: PolicySetInput) {
		const key = yield* Effect.try({ try: () => requirePolicyKey(input.key), catch: asPolicyServiceFailure });
		const value = yield* Effect.try({
			try: () => decodePolicyValueForKey(key, input.value),
			catch: asPolicyServiceFailure,
		});
		const recordsBefore = yield* replay();
		const now = new Date().toISOString();
		const draft: PolicyTransactionDraftV1 = {
			transactionId: randomUUID(),
			createdAt: now,
			effectiveFrom: input.effectiveFrom ?? now,
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
		const before = projectPolicy(recordsBefore, { ...defaults, workstream: input.workstream, at: now });
		const after = projectPolicy([...recordsBefore, transaction], {
			...defaults,
			workstream: input.workstream,
			at: now,
		});
		return { committed: input.dryRun !== true, transaction, diff: diffSnapshots(before, after) };
	});
	const rollback = Effect.fn("PolicyService.rollback")(function* (input: PolicyRollbackServiceInput) {
		const transaction = yield* Effect.tryPromise({
			try: () =>
				journal.rollback({
					transactionId: input.transactionId,
					author: input.author ?? { kind: "cli", uid: journal.uid, pid: journal.pid },
					source: input.source ?? { kind: "cli", uri: journal.journalPath },
					reason: input.reason,
					...(input.effectiveFrom === undefined ? {} : { effectiveFrom: input.effectiveFrom }),
					...(input.expectedHead === undefined ? {} : { expectedHead: input.expectedHead }),
				}),
			catch: asPolicyServiceFailure,
		});
		const records = yield* replay();
		return {
			transaction,
			snapshot: projectPolicy(records, { ...defaults, workstream: input.workstream, at: new Date().toISOString() }),
		};
	});
	return { get, explain, diff, set, rollback, snapshot };
}
