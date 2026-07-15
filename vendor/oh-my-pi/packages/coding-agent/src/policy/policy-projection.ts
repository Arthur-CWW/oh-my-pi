import {
	CORE_ROUTING_KEYS,
	type CoreRoutingKey,
	type CoreRoutingValue,
	type PolicyMutationV1,
	type PolicyScope,
	type PolicyTransactionV1,
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
	readonly key: CoreRoutingKey;
	readonly operation: PolicyMutationV1["op"];
	readonly value?: CoreRoutingValue;
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
	readonly key: CoreRoutingKey;
	readonly value: CoreRoutingValue;
	readonly sourceLayer: PolicySourceLayer;
	readonly scope: PolicyCandidate["scope"];
	readonly transactionId?: string;
	readonly sequence: number;
	readonly recordHash?: string;
	readonly shadowed: readonly PolicyCandidate[];
}

export interface PolicySnapshot {
	readonly at: string;
	readonly workstream?: string;
	readonly values: Readonly<Partial<Record<CoreRoutingKey, EffectivePolicyValue>>>;
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

function candidateFromMutation(record: PolicyTransactionV1, mutation: PolicyMutationV1): PolicyCandidate {
	return {
		key: mutation.key,
		operation: mutation.op,
		...(mutation.op === "set" ? { value: mutation.value } : {}),
		sourceLayer: layerFor(record, mutation.scope),
		scope: mutation.scope,
		transactionId: record.transactionId,
		sequence: record.sequence,
		recordHash: record.recordHash,
	};
}

function compareCandidates(left: PolicyCandidate, right: PolicyCandidate): number {
	const layerDifference =
		POLICY_LAYER_PRECEDENCE.indexOf(left.sourceLayer) - POLICY_LAYER_PRECEDENCE.indexOf(right.sourceLayer);
	return layerDifference === 0 ? right.sequence - left.sequence : layerDifference;
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
	const candidatesByKey: Partial<Record<CoreRoutingKey, PolicyCandidate[]>> = {};

	for (const record of records) {
		if (Date.parse(record.effectiveFrom) > atMillis) {
			futureTransactionIds.push(record.transactionId);
			continue;
		}
		if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= atMillis) {
			expiredTransactionIds.push(record.transactionId);
			continue;
		}
		for (const mutation of record.mutations) {
			if (!scopeParticipates(mutation.scope, options.workstream)) continue;
			(candidatesByKey[mutation.key] ??= []).push(candidateFromMutation(record, mutation));
		}
	}

	for (const key of CORE_ROUTING_KEYS) {
		const invocation = options.invocation?.[key];
		if (invocation !== undefined) {
			(candidatesByKey[key] ??= []).push({
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
			(candidatesByKey[key] ??= []).push({
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
			(candidatesByKey[key] ??= []).push({
				key,
				operation: "set",
				value: builtIn,
				sourceLayer: "built-in",
				scope: { kind: "built-in" },
				sequence: 0,
			});
		}
	}

	const values: Partial<Record<CoreRoutingKey, EffectivePolicyValue>> = {};
	for (const key of CORE_ROUTING_KEYS) {
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

	return {
		at,
		...(options.workstream === undefined ? {} : { workstream: options.workstream }),
		values,
		transactions: [...records],
		expiredTransactionIds,
		futureTransactionIds,
	};
}
