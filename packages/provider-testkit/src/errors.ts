import { Schema } from "effect";

/**
 * Component digests are safe to log: they identify *which* dimension of a
 * request changed without exposing prompts, tool bodies, or user content.
 */
export const ComponentDigests = Schema.Struct({
	route: Schema.String,
	contract: Schema.String,
	prompt: Schema.String,
	conversation: Schema.String,
	tools: Schema.String,
	generation: Schema.String,
});
export type ComponentDigests = Schema.Schema.Type<typeof ComponentDigests>;

export const DigestComponent = Schema.Literals([
	"route",
	"contract",
	"prompt",
	"conversation",
	"tools",
	"generation",
]);
export type DigestComponent = Schema.Schema.Type<typeof DigestComponent>;

export const DigestMismatch = Schema.Struct({
	component: DigestComponent,
	expected: Schema.String,
	actual: Schema.String,
});
export type DigestMismatch = Schema.Schema.Type<typeof DigestMismatch>;

export const RedactionFinding = Schema.Struct({
	rule: Schema.String,
	/** JSON pointer into the sealed bundle. Never the offending value. */
	pointer: Schema.String,
	occurrences: Schema.Int,
});
export type RedactionFinding = Schema.Schema.Type<typeof RedactionFinding>;

/** No cassette entry exists for this request identity. Never falls through to live. */
export class CassetteMissError extends Schema.TaggedErrorClass<CassetteMissError>()(
	"CassetteMissError",
	{
		cassetteId: Schema.String,
		requestDigest: Schema.String,
		variant: Schema.String,
		attempt: Schema.optionalKey(Schema.Int),
		componentDigests: ComponentDigests,
		indexedInteractions: Schema.Int,
	},
) {}

/**
 * More than one recorded interaction satisfies the lookup key. The caller must
 * name the attempt explicitly; "first one wins" is prohibited.
 */
export class CassetteAmbiguousMatchError extends Schema.TaggedErrorClass<CassetteAmbiguousMatchError>()(
	"CassetteAmbiguousMatchError",
	{
		cassetteId: Schema.String,
		requestDigest: Schema.String,
		variant: Schema.String,
		candidateInteractionIds: Schema.Array(Schema.String),
	},
) {}

/**
 * A recorded interaction exists for this route/variant identity but one or more
 * component digests changed — typically a prompt or tool-contract edit. The
 * cassette is stale and must be regenerated through review.
 */
export class PromptDigestMismatchError extends Schema.TaggedErrorClass<PromptDigestMismatchError>()(
	"PromptDigestMismatchError",
	{
		cassetteId: Schema.String,
		interactionId: Schema.String,
		variant: Schema.String,
		expectedRequestDigest: Schema.String,
		actualRequestDigest: Schema.String,
		mismatches: Schema.Array(DigestMismatch),
	},
) {}

/** Sensitive material survived the declared redaction policy; the write is refused. */
export class RedactionViolationError extends Schema.TaggedErrorClass<RedactionViolationError>()(
	"RedactionViolationError",
	{
		cassetteId: Schema.String,
		policyVersion: Schema.String,
		findings: Schema.Array(RedactionFinding),
	},
) {}

/** Any provider or network access from a context where it must remain inert. */
export class UnexpectedNetworkAccessError extends Schema.TaggedErrorClass<UnexpectedNetworkAccessError>()(
	"UnexpectedNetworkAccessError",
	{
		/** Which guard rejected: "RejectingProvider" or "networkGuard". */
		guard: Schema.String,
		label: Schema.String,
		/** Safe audit fields only. Populated for provider calls. */
		routeDigest: Schema.optionalKey(Schema.String),
		contractDigest: Schema.optionalKey(Schema.String),
		requestDigest: Schema.optionalKey(Schema.String),
		/** Populated for network calls: scheme + host only, never a full URL with query. */
		origin: Schema.optionalKey(Schema.String),
	},
) {}

/** Cassette bytes are corrupt, mutated, unsupported, or internally inconsistent. */
export class CassetteIntegrityError extends Schema.TaggedErrorClass<CassetteIntegrityError>()(
	"CassetteIntegrityError",
	{
		cassetteId: Schema.String,
		reason: Schema.Literals([
			"unreadable",
			"malformedManifest",
			"unsupportedVersion",
			"checksumMismatch",
			"fileChecksumMismatch",
			"duplicateIndexKey",
			"invalidEventSequence",
			"unknownRedactionPolicy",
			"redactionResidue",
			"malformedFrame",
			"unsafeInteractionPath",
			"fileTooLarge",
		]),
		detail: Schema.String,
	},
) {}

/** A provider-emitted failure, normalized and sanitized. Live, replay and scripted all raise this. */
export class ProviderStreamError extends Schema.TaggedErrorClass<ProviderStreamError>()(
	"ProviderStreamError",
	{
		code: Schema.String,
		retryable: Schema.Boolean,
		message: Schema.String,
		statusHint: Schema.optionalKey(Schema.Int),
		retryAfterMs: Schema.optionalKey(Schema.Int),
	},
) {}

/** LiveProvider refuses to run without credentials rather than producing an empty stream. */
export class ProviderCredentialsMissingError extends Schema.TaggedErrorClass<ProviderCredentialsMissingError>()(
	"ProviderCredentialsMissingError",
	{ routeDigest: Schema.String, detail: Schema.String },
) {}

/** No scripted interaction, or more than one, matched the request predicate. */
export class ScriptedNoMatchError extends Schema.TaggedErrorClass<ScriptedNoMatchError>()(
	"ScriptedNoMatchError",
	{
		scriptId: Schema.String,
		requestDigest: Schema.String,
		variant: Schema.String,
		matchCount: Schema.Int,
		candidateNames: Schema.Array(Schema.String),
	},
) {}

export type ProviderError =
	| CassetteMissError
	| CassetteAmbiguousMatchError
	| PromptDigestMismatchError
	| CassetteIntegrityError
	| UnexpectedNetworkAccessError
	| ProviderStreamError
	| ProviderCredentialsMissingError
	| ScriptedNoMatchError;

export type CassetteWriteError =
	| RedactionViolationError
	| CassetteIntegrityError;
