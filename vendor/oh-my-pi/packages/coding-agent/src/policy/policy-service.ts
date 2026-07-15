import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { type PolicyAppendOptions, type PolicyHead, PolicyJournal, POLICY_REGISTRY_DIGEST } from "./policy-journal";
import {
	type EffectivePolicyValue,
	POLICY_LAYER_PRECEDENCE,
	type PolicyCandidate,
	projectPolicy,
	type PolicyProjectionOptions,
	type PolicySnapshot,
	type PolicySourceLayer,
} from "./policy-projection";
import {
	CORE_ROUTING_KEYS,
	type CoreRoutingKey,
	type CoreRoutingValue,
	isCoreRoutingKey,
	POLICY_REGISTRY_VERSION,
	PolicyForkDetectedError,
	PolicyJournalIoError,
	PolicyLeaseConflictError,
	type PolicyScope,
	type PolicyTransactionDraftV1,
	type PolicyTransactionV1,
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
	readonly candidates: readonly PolicyCandidate[];
}

export interface PolicyExplanation {
	readonly key: CoreRoutingKey;
	readonly consultedLayers: readonly PolicyExplainLayer[];
	readonly winner?: EffectivePolicyValue;
	readonly shadowed: readonly PolicyCandidate[];
}

export interface PolicyDiffChange {
	readonly key: CoreRoutingKey;
	readonly before?: EffectivePolicyValue;
	readonly after?: EffectivePolicyValue;
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
	readonly value: CoreRoutingValue;
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
	) => Effect.Effect<EffectivePolicyValue | undefined, PolicyServiceFailure>;
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

function requireCoreRoutingKey(key: string): CoreRoutingKey {
	if (isCoreRoutingKey(key)) return key;
	const normalized = key.toLowerCase();
	const suggestions = CORE_ROUTING_KEYS.filter(
		candidate => candidate.includes(normalized) || normalized.includes(candidate.slice(13)),
	);
	throw new UnknownPolicyKeyError({
		key: key.length === 0 ? "<empty>" : key,
		suggestions: suggestions.length > 0 ? suggestions.slice(0, 3) : CORE_ROUTING_KEYS.slice(0, 3),
	});
}

function diffSnapshots(before: PolicySnapshot, after: PolicySnapshot): PolicyDiff {
	const changes: PolicyDiffChange[] = [];
	for (const key of CORE_ROUTING_KEYS) {
		const previous = before.values[key];
		const next = after.values[key];
		if (
			previous?.value === next?.value &&
			previous?.sourceLayer === next?.sourceLayer &&
			previous?.transactionId === next?.transactionId &&
			previous?.sequence === next?.sequence
		) {
			continue;
		}
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
		const validatedKey = yield* Effect.try({ try: () => requireCoreRoutingKey(key), catch: asPolicyServiceFailure });
		return (yield* snapshot(options)).values[validatedKey];
	});
	const explain = Effect.fn("PolicyService.explain")(function* (key: string, options: PolicyProjectionOptions = {}) {
		const validatedKey = yield* Effect.try({ try: () => requireCoreRoutingKey(key), catch: asPolicyServiceFailure });
		const projected = yield* snapshot(options);
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
		const key = yield* Effect.try({ try: () => requireCoreRoutingKey(input.key), catch: asPolicyServiceFailure });
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
			mutations: [
				{ op: "set", key, scope: input.scope, fragmentVersion: POLICY_REGISTRY_VERSION, value: input.value },
			],
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
