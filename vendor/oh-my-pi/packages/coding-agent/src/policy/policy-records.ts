import { Schema } from "effect";

export const POLICY_SCHEMA_VERSION = 1 as const;
export const POLICY_REGISTRY_VERSION = 3 as const;
export const CORE_ROUTING_FRAGMENT_VERSION = 1 as const;
export const CORE_PROVIDER_FRAGMENT_VERSION = 1 as const;
export const CORE_FALLBACK_FRAGMENT_VERSION = 1 as const;
export const CORE_BUDGET_FRAGMENT_VERSION = 1 as const;
export const POLICY_GENESIS_HASH = "0".repeat(64);

export const UUIDSchema = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)),
);
export const SHA256DigestSchema = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)));
export const NonEmptyStringSchema = Schema.Trim.pipe(Schema.check(Schema.isMinLength(1)));
export const NonNegativeIntSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
export const PositiveIntSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)));
export const TimestampSchema = Schema.String.pipe(
	Schema.refine((value): value is string => {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
	}),
);

export const PolicyModelRoleSchema = Schema.Literals([
	"default",
	"smol",
	"slow",
	"vision",
	"plan",
	"designer",
	"commit",
	"title",
	"implementer",
	"qa",
	"operator",
	"synthesizer",
	"task",
	"advisor",
]);
export type PolicyModelRole = typeof PolicyModelRoleSchema.Type;

export const CORE_ROUTING_KEYS = [
	"core.routing.default",
	"core.routing.smol",
	"core.routing.slow",
	"core.routing.vision",
	"core.routing.plan",
	"core.routing.designer",
	"core.routing.commit",
	"core.routing.title",
	"core.routing.implementer",
	"core.routing.qa",
	"core.routing.operator",
	"core.routing.synthesizer",
	"core.routing.task",
	"core.routing.advisor",
] as const;
export const CoreRoutingKeySchema = Schema.Literals(CORE_ROUTING_KEYS);
export type CoreRoutingKey = typeof CoreRoutingKeySchema.Type;
export const CoreRoutingValueSchema = NonEmptyStringSchema;
export type CoreRoutingValue = typeof CoreRoutingValueSchema.Type;

export const CORE_PROVIDER_KEYS = ["core.providers.deny.providers", "core.providers.deny.models"] as const;
export const CoreProviderKeySchema = Schema.Literals(CORE_PROVIDER_KEYS);
export type CoreProviderKey = typeof CoreProviderKeySchema.Type;
export const ProviderIdSchema = NonEmptyStringSchema;
export type ProviderId = typeof ProviderIdSchema.Type;
export const ProviderModelSelectorSchema = Schema.Struct({
	provider: ProviderIdSchema,
	model: NonEmptyStringSchema,
});
export type ProviderModelSelector = typeof ProviderModelSelectorSchema.Type;

function hasUniqueProviderIds(providerIds: readonly ProviderId[]): boolean {
	for (let index = 0; index < providerIds.length; index += 1) {
		for (let compared = index + 1; compared < providerIds.length; compared += 1) {
			if (providerIds[index] === providerIds[compared]) return false;
		}
	}
	return true;
}

function hasUniqueModelSelectors(models: readonly ProviderModelSelector[]): boolean {
	for (let index = 0; index < models.length; index += 1) {
		const model = models[index];
		if (model === undefined) continue;
		for (let compared = index + 1; compared < models.length; compared += 1) {
			const other = models[compared];
			if (other !== undefined && model.provider === other.provider && model.model === other.model) return false;
		}
	}
	return true;
}

const ProviderIdsSchema = Schema.Array(ProviderIdSchema).pipe(
	Schema.check(Schema.isMinLength(1)),
	Schema.refine((providerIds): providerIds is readonly ProviderId[] => hasUniqueProviderIds(providerIds)),
);
const ProviderModelSelectorsSchema = Schema.Array(ProviderModelSelectorSchema).pipe(
	Schema.check(Schema.isMinLength(1)),
	Schema.refine((models): models is readonly ProviderModelSelector[] => hasUniqueModelSelectors(models)),
);
export const ProviderDenyValueSchema = Schema.Struct({ providerIds: ProviderIdsSchema });
export type ProviderDenyValue = typeof ProviderDenyValueSchema.Type;
export const ModelDenyValueSchema = Schema.Struct({ models: ProviderModelSelectorsSchema });
export type ModelDenyValue = typeof ModelDenyValueSchema.Type;
export type CoreProviderValue = ProviderDenyValue | ModelDenyValue;

export const CORE_FALLBACK_KEYS = ["core.fallback.chains"] as const;
export const CoreFallbackKeySchema = Schema.Literals(CORE_FALLBACK_KEYS);
export type CoreFallbackKey = typeof CoreFallbackKeySchema.Type;
const FallbackSelectorChainSchema = Schema.Array(NonEmptyStringSchema).pipe(Schema.check(Schema.isMinLength(1)));
export const FallbackChainsValueSchema = Schema.Struct({
	chains: Schema.Record(Schema.String, FallbackSelectorChainSchema),
});
export type FallbackChainsValue = typeof FallbackChainsValueSchema.Type;
export type CoreFallbackValue = FallbackChainsValue;

export const CORE_BUDGET_KEYS = [
	"core.budgets.task.maxConcurrency",
	"core.budgets.task.maxLiveChildren",
	"core.budgets.task.maxRuntimeMs",
	"core.budgets.task.softRequestBudget",
] as const;
export const CoreBudgetKeySchema = Schema.Literals(CORE_BUDGET_KEYS);
export type CoreBudgetKey = typeof CoreBudgetKeySchema.Type;
export const CoreBudgetValueSchema = NonNegativeIntSchema;
export type CoreBudgetValue = typeof CoreBudgetValueSchema.Type;

export const CORE_NON_PROVIDER_KEYS = [...CORE_ROUTING_KEYS, ...CORE_FALLBACK_KEYS, ...CORE_BUDGET_KEYS] as const;
export type CoreNonProviderKey = (typeof CORE_NON_PROVIDER_KEYS)[number];
export type CoreNonProviderValue = CoreRoutingValue | CoreFallbackValue | CoreBudgetValue;
export const CORE_POLICY_KEYS = [...CORE_NON_PROVIDER_KEYS, ...CORE_PROVIDER_KEYS] as const;
export const PolicyKeySchema = Schema.Literals(CORE_POLICY_KEYS);
export type PolicyKey = typeof PolicyKeySchema.Type;
export type PolicyValue = CoreNonProviderValue | CoreProviderValue;
export type PolicyValueForKey<Key extends PolicyKey> = Key extends "core.providers.deny.providers"
	? ProviderDenyValue
	: Key extends "core.providers.deny.models"
		? ModelDenyValue
		: Key extends CoreFallbackKey
			? FallbackChainsValue
			: Key extends CoreBudgetKey
				? CoreBudgetValue
				: CoreRoutingValue;

export const GlobalPolicyScopeSchema = Schema.Struct({ kind: Schema.Literal("global") });
export const WorkstreamPolicyScopeSchema = Schema.Struct({
	kind: Schema.Literal("workstream"),
	workstream: NonEmptyStringSchema,
});
export const PolicyScopeSchema = Schema.Union([GlobalPolicyScopeSchema, WorkstreamPolicyScopeSchema]);
export type PolicyScope = typeof PolicyScopeSchema.Type;

export const PolicyImportProvenanceSchema = Schema.Struct({
	sourcePath: NonEmptyStringSchema,
	keyPath: NonEmptyStringSchema,
});
export type PolicyImportProvenance = typeof PolicyImportProvenanceSchema.Type;

const MutationScopeFields = {
	scope: PolicyScopeSchema,
	importProvenance: Schema.optional(PolicyImportProvenanceSchema),
};
const SetCoreRoutingPolicyMutationV1Schema = Schema.Struct({
	op: Schema.Literal("set"),
	key: CoreRoutingKeySchema,
	...MutationScopeFields,
	fragmentVersion: Schema.Literals([1, 2, POLICY_REGISTRY_VERSION]),
	value: CoreRoutingValueSchema,
});
const SetProviderDenyPolicyMutationV1Schema = Schema.Struct({
	op: Schema.Literal("set"),
	key: Schema.Literal("core.providers.deny.providers"),
	...MutationScopeFields,
	fragmentVersion: Schema.Literal(CORE_PROVIDER_FRAGMENT_VERSION),
	value: ProviderDenyValueSchema,
});
const SetModelDenyPolicyMutationV1Schema = Schema.Struct({
	op: Schema.Literal("set"),
	key: Schema.Literal("core.providers.deny.models"),
	...MutationScopeFields,
	fragmentVersion: Schema.Literal(CORE_PROVIDER_FRAGMENT_VERSION),
	value: ModelDenyValueSchema,
});
const ClearCoreRoutingPolicyMutationV1Schema = Schema.Struct({
	op: Schema.Literal("clear"),
	key: CoreRoutingKeySchema,
	...MutationScopeFields,
	fragmentVersion: Schema.Literals([1, 2, POLICY_REGISTRY_VERSION]),
});
const ClearProviderPolicyMutationV1Schema = Schema.Struct({
	op: Schema.Literal("clear"),
	key: CoreProviderKeySchema,
	...MutationScopeFields,
	fragmentVersion: Schema.Literal(CORE_PROVIDER_FRAGMENT_VERSION),
});
const SetFallbackPolicyMutationV1Schema = Schema.Struct({
	op: Schema.Literal("set"),
	key: CoreFallbackKeySchema,
	...MutationScopeFields,
	fragmentVersion: Schema.Literal(CORE_FALLBACK_FRAGMENT_VERSION),
	value: FallbackChainsValueSchema,
});
const SetBudgetPolicyMutationV1Schema = Schema.Struct({
	op: Schema.Literal("set"),
	key: CoreBudgetKeySchema,
	...MutationScopeFields,
	fragmentVersion: Schema.Literal(CORE_BUDGET_FRAGMENT_VERSION),
	value: CoreBudgetValueSchema,
});
const ClearFallbackPolicyMutationV1Schema = Schema.Struct({
	op: Schema.Literal("clear"),
	key: CoreFallbackKeySchema,
	...MutationScopeFields,
	fragmentVersion: Schema.Literal(CORE_FALLBACK_FRAGMENT_VERSION),
});
const ClearBudgetPolicyMutationV1Schema = Schema.Struct({
	op: Schema.Literal("clear"),
	key: CoreBudgetKeySchema,
	...MutationScopeFields,
	fragmentVersion: Schema.Literal(CORE_BUDGET_FRAGMENT_VERSION),
});
export const SetPolicyMutationV1Schema = Schema.Union([
	SetCoreRoutingPolicyMutationV1Schema,
	SetProviderDenyPolicyMutationV1Schema,
	SetModelDenyPolicyMutationV1Schema,
	SetFallbackPolicyMutationV1Schema,
	SetBudgetPolicyMutationV1Schema,
]);
export const ClearPolicyMutationV1Schema = Schema.Union([
	ClearCoreRoutingPolicyMutationV1Schema,
	ClearProviderPolicyMutationV1Schema,
	ClearFallbackPolicyMutationV1Schema,
	ClearBudgetPolicyMutationV1Schema,
]);
export const PolicyMutationV1Schema = Schema.Union([SetPolicyMutationV1Schema, ClearPolicyMutationV1Schema]);
export type SetPolicyMutationV1 = typeof SetPolicyMutationV1Schema.Type;
export type ClearPolicyMutationV1 = typeof ClearPolicyMutationV1Schema.Type;
export type PolicyMutationV1 = typeof PolicyMutationV1Schema.Type;

export const PolicyAuthorV1Schema = Schema.Struct({
	kind: Schema.Literals(["cli", "control-plane", "import"]),
	uid: NonNegativeIntSchema,
	pid: PositiveIntSchema,
	sessionId: Schema.optional(NonEmptyStringSchema),
});
export type PolicyAuthorV1 = typeof PolicyAuthorV1Schema.Type;

export const PolicySourceV1Schema = Schema.Struct({
	kind: Schema.Literals(["cli", "control-plane", "import"]),
	uri: Schema.optional(NonEmptyStringSchema),
	importDigest: Schema.optional(SHA256DigestSchema),
});
export type PolicySourceV1 = typeof PolicySourceV1Schema.Type;

export const PolicyRegistryV1Schema = Schema.Struct({
	version: Schema.Literals([1, 2, POLICY_REGISTRY_VERSION]),
	digest: SHA256DigestSchema,
});
export type PolicyRegistryV1 = typeof PolicyRegistryV1Schema.Type;

export const PolicyTransactionV1Schema = Schema.Struct({
	recordType: Schema.Literal("policy-transaction"),
	schemaVersion: Schema.Literal(POLICY_SCHEMA_VERSION),
	transactionId: UUIDSchema,
	sequence: PositiveIntSchema,
	previousHash: SHA256DigestSchema,
	recordHash: SHA256DigestSchema,
	createdAt: TimestampSchema,
	effectiveFrom: TimestampSchema,
	expiresAt: Schema.optional(TimestampSchema),
	author: PolicyAuthorV1Schema,
	source: PolicySourceV1Schema,
	reason: NonEmptyStringSchema,
	rollbackOf: Schema.optional(UUIDSchema),
	registry: PolicyRegistryV1Schema,
	mutations: Schema.Array(PolicyMutationV1Schema).pipe(Schema.check(Schema.isMinLength(1))),
});
export type PolicyTransactionV1 = typeof PolicyTransactionV1Schema.Type;
export type PolicyTransactionDraftV1 = Omit<
	PolicyTransactionV1,
	"recordType" | "schemaVersion" | "sequence" | "previousHash" | "recordHash"
>;

export const SessionPolicyRecordV1Schema = Schema.Struct({
	recordType: Schema.Literal("session-policy"),
	schemaVersion: Schema.Literal(POLICY_SCHEMA_VERSION),
	sessionPolicyId: UUIDSchema,
	transactionId: UUIDSchema,
	mutation: PolicyMutationV1Schema,
	effectiveFrom: TimestampSchema,
	expiresAt: Schema.optional(TimestampSchema),
	author: PolicyAuthorV1Schema,
	source: PolicySourceV1Schema,
	reason: NonEmptyStringSchema,
	commandId: UUIDSchema,
	sessionId: NonEmptyStringSchema,
	ownerEpoch: NonEmptyStringSchema,
});
export type SessionPolicyRecordV1 = typeof SessionPolicyRecordV1Schema.Type;

export const PolicyApplyClassSchema = Schema.Literals(["hot", "next-operation", "next-turn", "restart-required"]);
export type PolicyApplyClass = typeof PolicyApplyClassSchema.Type;

export const PolicyApplyCommandV1Schema = Schema.Struct({
	recordType: Schema.Literal("policy-apply-command"),
	schemaVersion: Schema.Literal(POLICY_SCHEMA_VERSION),
	commandId: UUIDSchema,
	targetSessionId: NonEmptyStringSchema,
	targetOwnerEpoch: NonEmptyStringSchema,
	policyTransactionId: UUIDSchema,
	policySequence: PositiveIntSchema,
	policyHeadHash: SHA256DigestSchema,
	expectedAppliedSequence: NonNegativeIntSchema,
	impactedPolicyClasses: Schema.Array(PolicyApplyClassSchema).pipe(Schema.check(Schema.isMinLength(1))),
});
export type PolicyApplyCommandV1 = typeof PolicyApplyCommandV1Schema.Type;

export const PolicyApplyResultSchema = Schema.Literals(["applied", "deferred", "failed"]);
export type PolicyApplyResult = typeof PolicyApplyResultSchema.Type;
export const PolicyApplyRecordV1Schema = Schema.Struct({
	recordType: Schema.Literal("policy-apply"),
	schemaVersion: Schema.Literal(POLICY_SCHEMA_VERSION),
	policyTransactionId: UUIDSchema,
	policySequence: PositiveIntSchema,
	policyHeadHash: SHA256DigestSchema,
	previousAppliedSequence: NonNegativeIntSchema,
	sessionId: NonEmptyStringSchema,
	ownerEpoch: NonEmptyStringSchema,
	commandId: UUIDSchema,
	classification: PolicyApplyClassSchema,
	result: PolicyApplyResultSchema,
	boundary: NonEmptyStringSchema,
	effectiveAt: TimestampSchema,
	reason: NonEmptyStringSchema,
});
export type PolicyApplyRecordV1 = typeof PolicyApplyRecordV1Schema.Type;

export class TornPolicyJournalError extends Schema.TaggedErrorClass<TornPolicyJournalError>()(
	"TornPolicyJournalError",
	{ journalPath: NonEmptyStringSchema, line: PositiveIntSchema, reason: NonEmptyStringSchema },
) {}

export class PolicyForkDetectedError extends Schema.TaggedErrorClass<PolicyForkDetectedError>()(
	"PolicyForkDetectedError",
	{
		journalPath: NonEmptyStringSchema,
		line: PositiveIntSchema,
		expectedSequence: PositiveIntSchema,
		actualSequence: PositiveIntSchema,
		expectedPreviousHash: SHA256DigestSchema,
		actualPreviousHash: SHA256DigestSchema,
	},
) {}

export class StalePolicyHeadError extends Schema.TaggedErrorClass<StalePolicyHeadError>()("StalePolicyHeadError", {
	expectedSequence: NonNegativeIntSchema,
	actualSequence: NonNegativeIntSchema,
	expectedHash: SHA256DigestSchema,
	actualHash: SHA256DigestSchema,
}) {}

export class PolicyLeaseConflictError extends Schema.TaggedErrorClass<PolicyLeaseConflictError>()(
	"PolicyLeaseConflictError",
	{
		leasePath: NonEmptyStringSchema,
		holderUid: NonNegativeIntSchema,
		holderPid: PositiveIntSchema,
		holderEpoch: UUIDSchema,
	},
) {}

export class UnknownPolicyKeyError extends Schema.TaggedErrorClass<UnknownPolicyKeyError>()("UnknownPolicyKeyError", {
	key: NonEmptyStringSchema,
	suggestions: Schema.Array(PolicyKeySchema),
}) {}

export class PolicyJournalIoError extends Schema.TaggedErrorClass<PolicyJournalIoError>()("PolicyJournalIoError", {
	operation: NonEmptyStringSchema,
	path: NonEmptyStringSchema,
	reason: NonEmptyStringSchema,
}) {}

function validateEffectiveInterval(record: { readonly effectiveFrom: string; readonly expiresAt?: string }): void {
	if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= Date.parse(record.effectiveFrom)) {
		throw new Error("expiresAt must be later than effectiveFrom");
	}
}

export function decodePolicyTransactionV1(input: unknown): PolicyTransactionV1 {
	const record = Schema.decodeUnknownSync(PolicyTransactionV1Schema)(input, { onExcessProperty: "error" });
	validateEffectiveInterval(record);
	return record;
}

export function decodeSessionPolicyRecordV1(input: unknown): SessionPolicyRecordV1 {
	const record = Schema.decodeUnknownSync(SessionPolicyRecordV1Schema)(input, { onExcessProperty: "error" });
	validateEffectiveInterval(record);
	return record;
}

export function isCoreRoutingKey(key: string): key is CoreRoutingKey {
	return (CORE_ROUTING_KEYS as readonly string[]).includes(key);
}

export function isCoreProviderKey(key: string): key is CoreProviderKey {
	return (CORE_PROVIDER_KEYS as readonly string[]).includes(key);
}

export function isCoreFallbackKey(key: string): key is CoreFallbackKey {
	return (CORE_FALLBACK_KEYS as readonly string[]).includes(key);
}

export function isCoreBudgetKey(key: string): key is CoreBudgetKey {
	return (CORE_BUDGET_KEYS as readonly string[]).includes(key);
}

export function isPolicyKey(key: string): key is PolicyKey {
	return (CORE_POLICY_KEYS as readonly string[]).includes(key);
}

export function decodePolicyValueForKey<Key extends PolicyKey>(key: Key, input: unknown): PolicyValueForKey<Key> {
	const options = { onExcessProperty: "error" as const };
	switch (key) {
		case "core.providers.deny.providers":
			return Schema.decodeUnknownSync(ProviderDenyValueSchema)(input, options) as PolicyValueForKey<Key>;
		case "core.providers.deny.models":
			return Schema.decodeUnknownSync(ModelDenyValueSchema)(input, options) as PolicyValueForKey<Key>;
		case "core.fallback.chains":
			return Schema.decodeUnknownSync(FallbackChainsValueSchema)(input, options) as PolicyValueForKey<Key>;
		case "core.budgets.task.maxConcurrency":
		case "core.budgets.task.maxLiveChildren":
		case "core.budgets.task.maxRuntimeMs":
		case "core.budgets.task.softRequestBudget":
			return Schema.decodeUnknownSync(CoreBudgetValueSchema)(input, options) as PolicyValueForKey<Key>;
		default:
			return Schema.decodeUnknownSync(CoreRoutingValueSchema)(input, options) as PolicyValueForKey<Key>;
	}
}
