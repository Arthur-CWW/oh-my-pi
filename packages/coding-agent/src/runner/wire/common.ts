import { Schema } from "effect";

export const WIRE_FRAME_KINDS = [
	"manifestRequest",
	"manifestResponse",
	"clientHello",
	"serverHello",
	"request",
	"response",
	"event",
	"snapshotChunk",
	"resyncRequired",
] as const;

export const WireFrameKindSchema = Schema.Literals(WIRE_FRAME_KINDS);
export type WireFrameKind = typeof WireFrameKindSchema.Type;

export const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
export const NonNegativeIntSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
export const PositiveIntSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)));

export const ProtocolRangeSchema = Schema.Struct({
	minMajor: NonNegativeIntSchema,
	maxMajor: NonNegativeIntSchema,
	maxMinor: NonNegativeIntSchema,
});
export type ProtocolRange = typeof ProtocolRangeSchema.Type;

export const ProtocolVersionSchema = Schema.Struct({
	major: NonNegativeIntSchema,
	minor: NonNegativeIntSchema,
});
export type ProtocolVersion = typeof ProtocolVersionSchema.Type;

export const WireBuildIdentitySchema = Schema.Struct({
	version: NonEmptyStringSchema,
	digest: NonEmptyStringSchema,
});
export type WireBuildIdentity = typeof WireBuildIdentitySchema.Type;

export const WireAuthorityProofSchema = Schema.Struct({
	uid: NonNegativeIntSchema,
	canonicalSessionPath: NonEmptyStringSchema,
	namespaceDigest: NonEmptyStringSchema,
});
export type WireAuthorityProof = typeof WireAuthorityProofSchema.Type;

export const WireCapabilitySchema = Schema.Literals(["controller", "observer"]);
export type WireCapability = typeof WireCapabilitySchema.Type;

export const WireFeaturesSchema = Schema.Array(NonEmptyStringSchema);
export type WireFeatures = typeof WireFeaturesSchema.Type;
