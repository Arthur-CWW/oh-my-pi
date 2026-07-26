import { Schema } from "effect";
import {
	NonEmptyStringSchema,
	NonNegativeIntSchema,
	PositiveIntSchema,
	ProtocolRangeSchema,
	ProtocolVersionSchema,
	WIRE_FRAME_KINDS,
	WireAuthorityProofSchema,
	WireBuildIdentitySchema,
	WireCapabilitySchema,
	WireFeaturesSchema,
	type WireFrameKind,
} from "./common";
import { WireDecodeError, WireErrorEnvelopeSchema } from "./errors";

const CorrelationFields = {
	correlationId: NonEmptyStringSchema,
};

const HelloIdentityFields = {
	sessionId: NonEmptyStringSchema,
	ownerEpoch: NonEmptyStringSchema,
	runnerInstanceId: NonEmptyStringSchema,
	build: WireBuildIdentitySchema,
	authority: WireAuthorityProofSchema,
};

export const ManifestRequestFrameSchema = Schema.Struct({
	kind: Schema.Literal("manifestRequest"),
	...CorrelationFields,
});
export type ManifestRequestFrame = typeof ManifestRequestFrameSchema.Type;

export const ManifestResponseFrameSchema = Schema.Struct({
	kind: Schema.Literal("manifestResponse"),
	...CorrelationFields,
	hostLabel: NonEmptyStringSchema,
	protocol: ProtocolRangeSchema,
	...HelloIdentityFields,
	features: WireFeaturesSchema,
});
export type ManifestResponseFrame = typeof ManifestResponseFrameSchema.Type;

export const ClientHelloFrameSchema = Schema.Struct({
	kind: Schema.Literal("clientHello"),
	...CorrelationFields,
	protocol: ProtocolRangeSchema,
	...HelloIdentityFields,
	requestedCapability: WireCapabilitySchema,
	features: WireFeaturesSchema,
});
export type ClientHelloFrame = typeof ClientHelloFrameSchema.Type;

export const ServerHelloFrameSchema = Schema.Struct({
	kind: Schema.Literal("serverHello"),
	...CorrelationFields,
	selectedProtocol: ProtocolVersionSchema,
	...HelloIdentityFields,
	grantedCapability: WireCapabilitySchema,
	features: WireFeaturesSchema,
});
export type ServerHelloFrame = typeof ServerHelloFrameSchema.Type;

export const RequestFrameSchema = Schema.Struct({
	kind: Schema.Literal("request"),
	...CorrelationFields,
	requestId: NonEmptyStringSchema,
	operation: NonEmptyStringSchema,
	payload: Schema.Json,
});
export type RequestFrame = typeof RequestFrameSchema.Type;

export const SuccessfulResponseFrameSchema = Schema.Struct({
	kind: Schema.Literal("response"),
	...CorrelationFields,
	requestId: NonEmptyStringSchema,
	ok: Schema.Literal(true),
	result: Schema.Json,
});
export type SuccessfulResponseFrame = typeof SuccessfulResponseFrameSchema.Type;

export const FailedResponseFrameSchema = Schema.Struct({
	kind: Schema.Literal("response"),
	...CorrelationFields,
	requestId: NonEmptyStringSchema,
	ok: Schema.Literal(false),
	error: WireErrorEnvelopeSchema,
});
export type FailedResponseFrame = typeof FailedResponseFrameSchema.Type;

export const ResponseFrameSchema = Schema.Union([SuccessfulResponseFrameSchema, FailedResponseFrameSchema]);
export type ResponseFrame = typeof ResponseFrameSchema.Type;

export const EventFrameSchema = Schema.Struct({
	kind: Schema.Literal("event"),
	...CorrelationFields,
	eventId: NonEmptyStringSchema,
	sequence: NonNegativeIntSchema,
	eventType: NonEmptyStringSchema,
	payload: Schema.Json,
});
export type EventFrame = typeof EventFrameSchema.Type;

export const SnapshotChunkFrameSchema = Schema.Struct({
	kind: Schema.Literal("snapshotChunk"),
	...CorrelationFields,
	snapshotId: NonEmptyStringSchema,
	chunkIndex: NonNegativeIntSchema,
	chunkTotal: PositiveIntSchema,
	baselineSeq: NonNegativeIntSchema,
	page: Schema.Json,
});
export type SnapshotChunkFrame = typeof SnapshotChunkFrameSchema.Type;

export const ResyncRequiredFrameSchema = Schema.Struct({
	kind: Schema.Literal("resyncRequired"),
	...CorrelationFields,
	expectedSequence: NonNegativeIntSchema,
	observedSequence: NonNegativeIntSchema,
});
export type ResyncRequiredFrame = typeof ResyncRequiredFrameSchema.Type;

export const WireFrameSchema = Schema.Union([
	ManifestRequestFrameSchema,
	ManifestResponseFrameSchema,
	ClientHelloFrameSchema,
	ServerHelloFrameSchema,
	RequestFrameSchema,
	ResponseFrameSchema,
	EventFrameSchema,
	SnapshotChunkFrameSchema,
	ResyncRequiredFrameSchema,
]);
export type WireFrame = typeof WireFrameSchema.Type;

const STRICT_DECODE_OPTIONS = { onExcessProperty: "error" } as const;
const wireFrameKinds = new Set<string>(WIRE_FRAME_KINDS);

function sanitizedDecodeError(frameKind: WireFrameKind | "unknown"): WireDecodeError {
	return new WireDecodeError({
		message: "Wire frame does not match the protocol schema",
		frameKind,
		byteLength: 0,
	});
}

function inferSafeFrameKind(input: unknown): WireFrameKind | "unknown" {
	if (typeof input !== "object" || input === null || !Object.hasOwn(input, "kind")) return "unknown";
	const kind = Reflect.get(input, "kind");
	return typeof kind === "string" && wireFrameKinds.has(kind) ? (kind as WireFrameKind) : "unknown";
}

export function decodeManifestResponseFrame(input: unknown): ManifestResponseFrame {
	try {
		return Schema.decodeUnknownSync(ManifestResponseFrameSchema)(input, STRICT_DECODE_OPTIONS);
	} catch {
		throw sanitizedDecodeError("manifestResponse");
	}
}

export function decodeClientHelloFrame(input: unknown): ClientHelloFrame {
	try {
		return Schema.decodeUnknownSync(ClientHelloFrameSchema)(input, STRICT_DECODE_OPTIONS);
	} catch {
		throw sanitizedDecodeError("clientHello");
	}
}

export function encodeClientHelloFrame(input: ClientHelloFrame): ClientHelloFrame {
	return Schema.encodeUnknownSync(ClientHelloFrameSchema)(input, STRICT_DECODE_OPTIONS);
}

export function decodeServerHelloFrame(input: unknown): ServerHelloFrame {
	try {
		return Schema.decodeUnknownSync(ServerHelloFrameSchema)(input, STRICT_DECODE_OPTIONS);
	} catch {
		throw sanitizedDecodeError("serverHello");
	}
}

export function encodeServerHelloFrame(input: ServerHelloFrame): ServerHelloFrame {
	return Schema.encodeUnknownSync(ServerHelloFrameSchema)(input, STRICT_DECODE_OPTIONS);
}

export function decodeRequestFrame(input: unknown): RequestFrame {
	try {
		return Schema.decodeUnknownSync(RequestFrameSchema)(input, STRICT_DECODE_OPTIONS);
	} catch {
		throw sanitizedDecodeError("request");
	}
}

export function encodeRequestFrame(input: RequestFrame): RequestFrame {
	return Schema.encodeUnknownSync(RequestFrameSchema)(input, STRICT_DECODE_OPTIONS);
}

export function decodeResponseFrame(input: unknown): ResponseFrame {
	try {
		return Schema.decodeUnknownSync(ResponseFrameSchema)(input, STRICT_DECODE_OPTIONS);
	} catch {
		throw sanitizedDecodeError("response");
	}
}

export function encodeResponseFrame(input: ResponseFrame): ResponseFrame {
	return Schema.encodeUnknownSync(ResponseFrameSchema)(input, STRICT_DECODE_OPTIONS);
}

export function decodeEventFrame(input: unknown): EventFrame {
	try {
		return Schema.decodeUnknownSync(EventFrameSchema)(input, STRICT_DECODE_OPTIONS);
	} catch {
		throw sanitizedDecodeError("event");
	}
}

export function encodeEventFrame(input: EventFrame): EventFrame {
	return Schema.encodeUnknownSync(EventFrameSchema)(input, STRICT_DECODE_OPTIONS);
}

export function decodeSnapshotChunkFrame(input: unknown): SnapshotChunkFrame {
	try {
		return Schema.decodeUnknownSync(SnapshotChunkFrameSchema)(input, STRICT_DECODE_OPTIONS);
	} catch {
		throw sanitizedDecodeError("snapshotChunk");
	}
}

export function encodeSnapshotChunkFrame(input: SnapshotChunkFrame): SnapshotChunkFrame {
	return Schema.encodeUnknownSync(SnapshotChunkFrameSchema)(input, STRICT_DECODE_OPTIONS);
}

export function decodeResyncRequiredFrame(input: unknown): ResyncRequiredFrame {
	try {
		return Schema.decodeUnknownSync(ResyncRequiredFrameSchema)(input, STRICT_DECODE_OPTIONS);
	} catch {
		throw sanitizedDecodeError("resyncRequired");
	}
}

export function encodeResyncRequiredFrame(input: ResyncRequiredFrame): ResyncRequiredFrame {
	return Schema.encodeUnknownSync(ResyncRequiredFrameSchema)(input, STRICT_DECODE_OPTIONS);
}

export function decodeWireFrame(input: unknown): WireFrame {
	try {
		return Schema.decodeUnknownSync(WireFrameSchema)(input, STRICT_DECODE_OPTIONS);
	} catch {
		throw sanitizedDecodeError(inferSafeFrameKind(input));
	}
}

export function encodeWireFrame(input: WireFrame): WireFrame {
	return Schema.encodeUnknownSync(WireFrameSchema)(input, STRICT_DECODE_OPTIONS);
}
