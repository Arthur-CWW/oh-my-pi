import { Schema } from "effect";
import { NonNegativeIntSchema, PositiveIntSchema, WireFrameKindSchema } from "./common";

export const WIRE_ERROR_TAGS = [
	"WireFrameOversizeError",
	"WireDecodeError",
	"WireHelloRejectedError",
	"WireResyncRequiredError",
] as const;

export const WireErrorTagSchema = Schema.Literals(WIRE_ERROR_TAGS);
export type WireErrorTag = typeof WireErrorTagSchema.Type;

export const WireHelloRejectionReasonSchema = Schema.Literals([
	"protocol-range-invalid",
	"protocol-version-mismatch",
	"session-mismatch",
	"owner-epoch-mismatch",
	"runner-instance-mismatch",
	"build-mismatch",
	"authority-mismatch",
]);
export type WireHelloRejectionReason = typeof WireHelloRejectionReasonSchema.Type;

export const WireResyncReasonSchema = Schema.Literals([
	"event-sequence-gap",
	"snapshot-chunk-order",
	"snapshot-baseline-mismatch",
	"snapshot-identity-mismatch",
	"snapshot-size-mismatch",
]);
export type WireResyncReason = typeof WireResyncReasonSchema.Type;

export class WireFrameOversizeError extends Schema.TaggedErrorClass<WireFrameOversizeError>()(
	"WireFrameOversizeError",
	{
		message: Schema.String,
		announcedByteLength: NonNegativeIntSchema,
		maxByteLength: PositiveIntSchema,
	},
) {}

export class WireDecodeError extends Schema.TaggedErrorClass<WireDecodeError>()("WireDecodeError", {
	message: Schema.String,
	frameKind: Schema.Union([WireFrameKindSchema, Schema.Literal("unknown")]),
	byteLength: NonNegativeIntSchema,
}) {}

export class WireHelloRejectedError extends Schema.TaggedErrorClass<WireHelloRejectedError>()(
	"WireHelloRejectedError",
	{
		message: Schema.String,
		reason: WireHelloRejectionReasonSchema,
	},
) {}

export class WireResyncRequiredError extends Schema.TaggedErrorClass<WireResyncRequiredError>()(
	"WireResyncRequiredError",
	{
		message: Schema.String,
		reason: WireResyncReasonSchema,
		expectedSequence: NonNegativeIntSchema,
		observedSequence: NonNegativeIntSchema,
	},
) {}

export const WireErrorSchema = Schema.Union([
	WireFrameOversizeError,
	WireDecodeError,
	WireHelloRejectedError,
	WireResyncRequiredError,
]);
export type WireError = typeof WireErrorSchema.Type;

export const WireFrameOversizeErrorEnvelopeSchema = Schema.Struct({
	tag: Schema.Literal("WireFrameOversizeError"),
	message: Schema.String,
	details: Schema.Struct({
		announcedByteLength: NonNegativeIntSchema,
		maxByteLength: PositiveIntSchema,
	}),
});

export const WireDecodeErrorEnvelopeSchema = Schema.Struct({
	tag: Schema.Literal("WireDecodeError"),
	message: Schema.String,
	details: Schema.Struct({
		frameKind: Schema.Union([WireFrameKindSchema, Schema.Literal("unknown")]),
		byteLength: NonNegativeIntSchema,
	}),
});

export const WireHelloRejectedErrorEnvelopeSchema = Schema.Struct({
	tag: Schema.Literal("WireHelloRejectedError"),
	message: Schema.String,
	details: Schema.Struct({ reason: WireHelloRejectionReasonSchema }),
});

export const WireResyncRequiredErrorEnvelopeSchema = Schema.Struct({
	tag: Schema.Literal("WireResyncRequiredError"),
	message: Schema.String,
	details: Schema.Struct({
		reason: WireResyncReasonSchema,
		expectedSequence: NonNegativeIntSchema,
		observedSequence: NonNegativeIntSchema,
	}),
});

export const WireErrorEnvelopeSchema = Schema.Union([
	WireFrameOversizeErrorEnvelopeSchema,
	WireDecodeErrorEnvelopeSchema,
	WireHelloRejectedErrorEnvelopeSchema,
	WireResyncRequiredErrorEnvelopeSchema,
]);
export type WireErrorEnvelope = typeof WireErrorEnvelopeSchema.Type;

export function decodeWireErrorEnvelope(input: unknown): WireErrorEnvelope {
	return Schema.decodeUnknownSync(WireErrorEnvelopeSchema)(input, { onExcessProperty: "error" });
}

export function encodeWireErrorEnvelope(input: WireErrorEnvelope): WireErrorEnvelope {
	return Schema.encodeUnknownSync(WireErrorEnvelopeSchema)(input, { onExcessProperty: "error" });
}

export function toWireErrorEnvelope(error: WireError): WireErrorEnvelope {
	switch (error._tag) {
		case "WireFrameOversizeError":
			return {
				tag: error._tag,
				message: error.message,
				details: {
					announcedByteLength: error.announcedByteLength,
					maxByteLength: error.maxByteLength,
				},
			};
		case "WireDecodeError":
			return {
				tag: error._tag,
				message: error.message,
				details: { frameKind: error.frameKind, byteLength: error.byteLength },
			};
		case "WireHelloRejectedError":
			return {
				tag: error._tag,
				message: error.message,
				details: { reason: error.reason },
			};
		case "WireResyncRequiredError":
			return {
				tag: error._tag,
				message: error.message,
				details: {
					reason: error.reason,
					expectedSequence: error.expectedSequence,
					observedSequence: error.observedSequence,
				},
			};
	}
}
