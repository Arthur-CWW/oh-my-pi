import {
	CORE_NON_PROVIDER_KEYS,
	CORE_PROVIDER_KEYS,
	CORE_ROUTING_KEYS,
	type CoreNonProviderKey,
	type CoreNonProviderValue,
	type CoreProviderKey,
	type CoreProviderValue,
	type CoreRoutingKey,
	type CoreRoutingValue,
	isCoreProviderKey,
	type ModelDenyValue,
	type PolicyMutationV1,
	type PolicyScope,
	type PolicyTransactionV1,
	type ProviderDenyValue,
	type ProviderModelSelector,
} from "./policy-records";

export type PolicySourceLayer =
	| "invocation-override"
	| "session-policy"
	| "temporary-posture"
	| "workstream-durable"
	| "global-durable"
	| "built-in";

export const POLICY_LAYER_PRECEDENCE: readonly PolicySourceLayer[] = [
	"invocation-override",
	"session-policy",
	"temporary-posture",
	"workstream-durable",
	"global-durable",
	"built-in",
];

export interface PolicyCandidate {
	readonly key: CoreNonProviderKey;
	readonly operation: PolicyMutationV1["op"];
	readonly value?: CoreNonProviderValue;
	readonly sourceLayer: PolicySourceLayer;
	readonly scope:
		| PolicyScope
		| { readonly kind: "built-in" }
		| { readonly kind: "invocation" }
		| { readonly kind: "session" };
	readonly transactionId?: string;
	readonly sequence: number;
	readonly recordHash?: string;
}

export interface EffectivePolicyValue {
	readonly key: CoreNonProviderKey;
	readonly value: CoreNonProviderValue;
	readonly sourceLayer: PolicySourceLayer;
	readonly scope: PolicyCandidate["scope"];
	readonly transactionId?: string;
	readonly sequence: number;
	readonly recordHash?: string;
	readonly shadowed: readonly PolicyCandidate[];
}

export type EffectiveRoutingPolicyValue = Omit<EffectivePolicyValue, "key" | "value"> & {
	readonly key: CoreRoutingKey;
	readonly value: CoreRoutingValue;
};

export interface ProviderPolicyCandidate {
	readonly key: CoreProviderKey;
	readonly operation: PolicyMutationV1["op"];
	readonly value?: CoreProviderValue;
	readonly sourceLayer: PolicySourceLayer;
	readonly scope: PolicyScope;
	readonly transactionId: string;
	readonly sequence: number;
	readonly recordHash: string;
}

export interface EffectiveProviderPolicyValue {
	readonly key: CoreProviderKey;
	readonly value: CoreProviderValue;
	readonly sourceLayer: PolicySourceLayer;
	readonly scope: PolicyScope;
	readonly transactionId: string;
	readonly sequence: number;
	readonly recordHash: string;
	readonly shadowed: readonly ProviderPolicyCandidate[];
}

export type ProviderPostureState = "active" | "future" | "expired";

export interface ProviderPostureEntry {
	readonly key: CoreProviderKey;
	readonly operation: PolicyMutationV1["op"];
	readonly value?: CoreProviderValue;
	readonly state: ProviderPostureState;
	readonly effective: boolean;
	readonly transactionId: string;
	readonly sequence: number;
	readonly effectiveFrom: string;
	readonly expiresAt?: string;
	readonly remainingMs?: number;
	readonly sourceLayer: PolicySourceLayer;
	readonly scope: PolicyScope;
	readonly recordHash: string;
}

export interface ProviderPostureProjection {
	readonly values: Readonly<Partial<Record<CoreProviderKey, EffectiveProviderPolicyValue>>>;
	readonly deniedProviderIds: readonly string[];
	readonly deniedModels: readonly ProviderModelSelector[];
	readonly entries: readonly ProviderPostureEntry[];
}

export interface PolicySnapshot {
	readonly at: string;
	readonly workstream?: string;
	readonly values: Readonly<
		Partial<Record<CoreNonProviderKey, EffectivePolicyValue>> &
			Partial<Record<CoreRoutingKey, EffectiveRoutingPolicyValue>>
	>;
	/**
	 * Always present on snapshots produced by projectPolicy. Optional only so older
	 * callers that construct routing-only snapshots remain source-compatible.
	 */
	readonly providerPosture?: ProviderPostureProjection;
	readonly transactions: readonly PolicyTransactionV1[];
	readonly expiredTransactionIds: readonly string[];
	readonly futureTransactionIds: readonly string[];
}

export interface PolicyProjectionOverrides {
	readonly invocation?: Readonly<Partial<Record<CoreRoutingKey, CoreRoutingValue>>>;
	readonly session?: Readonly<Partial<Record<CoreRoutingKey, CoreRoutingValue>>>;
}

export interface PolicyProjectionOptions extends PolicyProjectionOverrides {
	readonly at?: string;
	readonly workstream?: string;
	readonly builtIns?: Readonly<Partial<Record<CoreRoutingKey, CoreRoutingValue>>>;
}

function layerFor(record: PolicyTransactionV1, scope: PolicyScope): PolicySourceLayer {
	if (record.expiresAt !== undefined) return "temporary-posture";
	return scope.kind === "workstream" ? "workstream-durable" : "global-durable";
}

function policyCandidateFromMutation(record: PolicyTransactionV1, mutation: PolicyMutationV1): PolicyCandidate {
	if (isCoreProviderKey(mutation.key))
		throw new Error(`Provider mutation passed to ordinary policy projection: ${mutation.key}`);
	return {
		key: mutation.key,
		operation: mutation.op,
		...(mutation.op === "set" ? { value: mutation.value as CoreNonProviderValue } : {}),
		sourceLayer: layerFor(record, mutation.scope),
		scope: mutation.scope,
		transactionId: record.transactionId,
		sequence: record.sequence,
		recordHash: record.recordHash,
	};
}

function providerCandidateFromMutation(
	record: PolicyTransactionV1,
	mutation: PolicyMutationV1,
): ProviderPolicyCandidate {
	if (!isCoreProviderKey(mutation.key))
		throw new Error(`Non-provider mutation passed to provider projection: ${mutation.key}`);
	return {
		key: mutation.key,
		operation: mutation.op,
		...(mutation.op === "set" ? { value: mutation.value as CoreProviderValue } : {}),
		sourceLayer: layerFor(record, mutation.scope),
		scope: mutation.scope,
		transactionId: record.transactionId,
		sequence: record.sequence,
		recordHash: record.recordHash,
	};
}

function compareCandidates(
	left: Pick<PolicyCandidate, "sourceLayer" | "sequence">,
	right: Pick<PolicyCandidate, "sourceLayer" | "sequence">,
): number {
	const layerDifference =
		POLICY_LAYER_PRECEDENCE.indexOf(left.sourceLayer) - POLICY_LAYER_PRECEDENCE.indexOf(right.sourceLayer);
	return layerDifference === 0 ? right.sequence - left.sequence : layerDifference;
}

function appendCandidate<Key extends PropertyKey, Candidate>(
	groups: Partial<Record<Key, Candidate[]>>,
	key: Key,
	candidate: Candidate,
): void {
	const current = groups[key];
	if (current) current.push(candidate);
	else groups[key] = [candidate];
}

function scopeParticipates(scope: PolicyScope, workstream: string | undefined): boolean {
	return scope.kind === "global" || scope.workstream === workstream;
}

export function projectPolicy(
	records: readonly PolicyTransactionV1[],
	options: PolicyProjectionOptions & { readonly at: string },
): PolicySnapshot {
	const at = options.at;
	const atMillis = Date.parse(at);
	if (!Number.isFinite(atMillis)) throw new Error(`Invalid projection time: ${at}`);
	const expiredTransactionIds: string[] = [];
	const futureTransactionIds: string[] = [];
	const candidatesByKey: Partial<Record<CoreNonProviderKey, PolicyCandidate[]>> = {};
	const providerCandidatesByKey: Partial<Record<CoreProviderKey, ProviderPolicyCandidate[]>> = {};
	const providerEntries: ProviderPostureEntry[] = [];

	for (const record of records) {
		const effectiveMillis = Date.parse(record.effectiveFrom);
		const expiresMillis = record.expiresAt === undefined ? undefined : Date.parse(record.expiresAt);
		const state: ProviderPostureState =
			effectiveMillis > atMillis
				? "future"
				: expiresMillis !== undefined && expiresMillis <= atMillis
					? "expired"
					: "active";
		if (state === "future") futureTransactionIds.push(record.transactionId);
		else if (state === "expired") expiredTransactionIds.push(record.transactionId);

		for (const mutation of record.mutations) {
			if (!scopeParticipates(mutation.scope, options.workstream)) continue;
			if (isCoreProviderKey(mutation.key)) {
				const candidate = providerCandidateFromMutation(record, mutation);
				providerEntries.push({
					key: candidate.key,
					operation: candidate.operation,
					...(candidate.value === undefined ? {} : { value: candidate.value }),
					state,
					effective: false,
					transactionId: record.transactionId,
					sequence: record.sequence,
					effectiveFrom: record.effectiveFrom,
					...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
					...(state === "future"
						? { remainingMs: effectiveMillis - atMillis }
						: state === "expired"
							? { remainingMs: 0 }
							: expiresMillis === undefined
								? {}
								: { remainingMs: expiresMillis - atMillis }),
					sourceLayer: candidate.sourceLayer,
					scope: candidate.scope,
					recordHash: record.recordHash,
				});
				if (state === "active") appendCandidate(providerCandidatesByKey, candidate.key, candidate);
				continue;
			}
			if (state === "active") {
				const candidate = policyCandidateFromMutation(record, mutation);
				appendCandidate(candidatesByKey, candidate.key, candidate);
			}
		}
	}

	for (const key of CORE_ROUTING_KEYS) {
		const invocation = options.invocation?.[key];
		if (invocation !== undefined) {
			appendCandidate(candidatesByKey, key, {
				key,
				operation: "set",
				value: invocation,
				sourceLayer: "invocation-override",
				scope: { kind: "invocation" },
				sequence: Number.MAX_SAFE_INTEGER,
			});
		}
		const session = options.session?.[key];
		if (session !== undefined) {
			appendCandidate(candidatesByKey, key, {
				key,
				operation: "set",
				value: session,
				sourceLayer: "session-policy",
				scope: { kind: "session" },
				sequence: Number.MAX_SAFE_INTEGER - 1,
			});
		}
		const builtIn = options.builtIns?.[key];
		if (builtIn !== undefined) {
			appendCandidate(candidatesByKey, key, {
				key,
				operation: "set",
				value: builtIn,
				sourceLayer: "built-in",
				scope: { kind: "built-in" },
				sequence: 0,
			});
		}
	}

	const values: Partial<Record<CoreNonProviderKey, EffectivePolicyValue>> = {};
	for (const key of CORE_NON_PROVIDER_KEYS) {
		const candidates = candidatesByKey[key];
		if (candidates === undefined) continue;
		candidates.sort(compareCandidates);
		const latestByLayer: Partial<Record<PolicySourceLayer, PolicyCandidate>> = {};
		for (const candidate of candidates) latestByLayer[candidate.sourceLayer] ??= candidate;
		const winner = POLICY_LAYER_PRECEDENCE.map(layer => latestByLayer[layer]).find(
			(candidate): candidate is PolicyCandidate => candidate?.operation === "set",
		);
		if (winner === undefined || winner.value === undefined) continue;
		values[key] = {
			key,
			value: winner.value,
			sourceLayer: winner.sourceLayer,
			scope: winner.scope,
			...(winner.transactionId === undefined ? {} : { transactionId: winner.transactionId }),
			sequence: winner.sequence,
			...(winner.recordHash === undefined ? {} : { recordHash: winner.recordHash }),
			shadowed: candidates.filter(candidate => candidate !== winner),
		};
	}

	const providerValues: Partial<Record<CoreProviderKey, EffectiveProviderPolicyValue>> = {};
	for (const key of CORE_PROVIDER_KEYS) {
		const candidates = providerCandidatesByKey[key];
		if (candidates === undefined) continue;
		candidates.sort(compareCandidates);
		const latestByLayer: Partial<Record<PolicySourceLayer, ProviderPolicyCandidate>> = {};
		for (const candidate of candidates) latestByLayer[candidate.sourceLayer] ??= candidate;
		const winner = POLICY_LAYER_PRECEDENCE.map(layer => latestByLayer[layer]).find(
			(candidate): candidate is ProviderPolicyCandidate => candidate?.operation === "set",
		);
		if (winner === undefined || winner.value === undefined) continue;
		providerValues[key] = {
			key,
			value: winner.value,
			sourceLayer: winner.sourceLayer,
			scope: winner.scope,
			transactionId: winner.transactionId,
			sequence: winner.sequence,
			recordHash: winner.recordHash,
			shadowed: candidates.filter(candidate => candidate !== winner),
		};
	}

	const deniedProviderIds = [
		...((providerValues["core.providers.deny.providers"]?.value as ProviderDenyValue | undefined)?.providerIds ?? []),
	].sort();
	const deniedModels = [
		...((providerValues["core.providers.deny.models"]?.value as ModelDenyValue | undefined)?.models ?? []),
	].sort((left, right) => left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model));
	const entries = providerEntries.map(entry => {
		const winner = providerValues[entry.key];
		return winner?.transactionId === entry.transactionId && winner.sequence === entry.sequence
			? { ...entry, effective: true }
			: entry;
	});

	return {
		at,
		...(options.workstream === undefined ? {} : { workstream: options.workstream }),
		values: values as PolicySnapshot["values"],
		providerPosture: { values: providerValues, deniedProviderIds, deniedModels, entries },
		transactions: [...records],
		expiredTransactionIds,
		futureTransactionIds,
	};
}

export type ProviderDenyMatch =
	| {
			readonly kind: "provider";
			readonly key: "core.providers.deny.providers";
			readonly provider: string;
			readonly entry: ProviderPostureEntry;
	  }
	| {
			readonly kind: "model";
			readonly key: "core.providers.deny.models";
			readonly provider: string;
			readonly model: string;
			readonly entry: ProviderPostureEntry;
	  };

function effectivePostureEntry(snapshot: PolicySnapshot, key: CoreProviderKey): ProviderPostureEntry | undefined {
	return snapshot.providerPosture?.entries.find(
		entry => entry.key === key && entry.state === "active" && entry.effective,
	);
}

export function isProviderDenied(snapshot: PolicySnapshot, provider: string): boolean {
	return snapshot.providerPosture?.deniedProviderIds.includes(provider) ?? false;
}

export function isModelDenied(snapshot: PolicySnapshot, provider: string, model: string): boolean {
	return (
		snapshot.providerPosture?.deniedModels.some(
			selector => selector.provider === provider && selector.model === model,
		) ?? false
	);
}

export function providerDenyMatches(
	snapshot: PolicySnapshot,
	provider: string,
	model: string,
): readonly ProviderDenyMatch[] {
	const matches: ProviderDenyMatch[] = [];
	if (isProviderDenied(snapshot, provider)) {
		const entry = effectivePostureEntry(snapshot, "core.providers.deny.providers");
		if (entry !== undefined)
			matches.push({
				kind: "provider",
				key: "core.providers.deny.providers",
				provider,
				entry,
			});
	}
	if (isModelDenied(snapshot, provider, model)) {
		const entry = effectivePostureEntry(snapshot, "core.providers.deny.models");
		if (entry !== undefined)
			matches.push({
				kind: "model",
				key: "core.providers.deny.models",
				provider,
				model,
				entry,
			});
	}
	return matches;
}
