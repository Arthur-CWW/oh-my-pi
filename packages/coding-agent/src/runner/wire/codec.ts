import { Schema } from "effect";
import { WIRE_FRAME_KINDS, type WireFrameKind } from "./common";
import { WireDecodeError, WireFrameOversizeError } from "./errors";
import { type WireFrame, WireFrameSchema } from "./frames";

export const DEFAULT_MAX_WIRE_FRAME_BYTES = 16 * 1024 * 1024;
const WIRE_LENGTH_PREFIX_BYTES = 4;
const MAX_UINT32 = 0xffff_ffff;
const STRICT_DECODE_OPTIONS = { onExcessProperty: "error" } as const;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const wireFrameKinds = new Set<string>(WIRE_FRAME_KINDS);

function validateMaxFrameBytes(maxFrameBytes: number): void {
	if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 1 || maxFrameBytes > MAX_UINT32) {
		throw new RangeError(`maxFrameBytes must be an integer between 1 and ${MAX_UINT32}`);
	}
}

function inferSafeFrameKind(input: unknown): WireFrameKind | "unknown" {
	if (typeof input !== "object" || input === null || !Object.hasOwn(input, "kind")) return "unknown";
	const kind = Reflect.get(input, "kind");
	return typeof kind === "string" && wireFrameKinds.has(kind) ? (kind as WireFrameKind) : "unknown";
}

export function decodeWireFrameJson(bytes: Uint8Array): WireFrame {
	let parsed: unknown;
	try {
		parsed = JSON.parse(textDecoder.decode(bytes));
	} catch {
		throw new WireDecodeError({
			message: "Wire frame is not valid UTF-8 JSON",
			frameKind: "unknown",
			byteLength: bytes.byteLength,
		});
	}

	const frameKind = inferSafeFrameKind(parsed);
	try {
		return Schema.decodeUnknownSync(WireFrameSchema)(parsed, STRICT_DECODE_OPTIONS);
	} catch {
		throw new WireDecodeError({
			message: "Wire frame does not match the protocol schema",
			frameKind,
			byteLength: bytes.byteLength,
		});
	}
}

export function encodeWireFrameJson(frame: WireFrame): Uint8Array {
	let encoded: WireFrame;
	try {
		encoded = Schema.encodeUnknownSync(WireFrameSchema)(frame, STRICT_DECODE_OPTIONS);
	} catch {
		throw new WireDecodeError({
			message: "Wire frame does not match the protocol schema",
			frameKind: inferSafeFrameKind(frame),
			byteLength: 0,
		});
	}
	return textEncoder.encode(JSON.stringify(encoded));
}

export function encodeLengthPrefixedWireFrame(
	frame: WireFrame,
	maxFrameBytes = DEFAULT_MAX_WIRE_FRAME_BYTES,
): Uint8Array {
	validateMaxFrameBytes(maxFrameBytes);
	const payload = encodeWireFrameJson(frame);
	if (payload.byteLength > maxFrameBytes) {
		throw new WireFrameOversizeError({
			message: "Encoded wire frame exceeds the configured maximum",
			announcedByteLength: payload.byteLength,
			maxByteLength: maxFrameBytes,
		});
	}
	const framed = new Uint8Array(WIRE_LENGTH_PREFIX_BYTES + payload.byteLength);
	new DataView(framed.buffer, framed.byteOffset, WIRE_LENGTH_PREFIX_BYTES).setUint32(0, payload.byteLength, false);
	framed.set(payload, WIRE_LENGTH_PREFIX_BYTES);
	return framed;
}

export class IncrementalWireFrameDecoder {
	readonly #maxFrameBytes: number;
	readonly #header = new Uint8Array(WIRE_LENGTH_PREFIX_BYTES);
	#headerByteLength = 0;
	#payload: Uint8Array | undefined;
	#payloadByteLength = 0;
	#failure: WireFrameOversizeError | WireDecodeError | undefined;

	constructor(maxFrameBytes = DEFAULT_MAX_WIRE_FRAME_BYTES) {
		validateMaxFrameBytes(maxFrameBytes);
		this.#maxFrameBytes = maxFrameBytes;
	}

	push(chunk: Uint8Array): readonly WireFrame[] {
		if (this.#failure) throw this.#failure;
		const frames: WireFrame[] = [];
		let offset = 0;

		while (offset < chunk.byteLength) {
			if (!this.#payload) {
				const headerRemaining = WIRE_LENGTH_PREFIX_BYTES - this.#headerByteLength;
				const copied = Math.min(headerRemaining, chunk.byteLength - offset);
				this.#header.set(chunk.subarray(offset, offset + copied), this.#headerByteLength);
				this.#headerByteLength += copied;
				offset += copied;
				if (this.#headerByteLength < WIRE_LENGTH_PREFIX_BYTES) continue;

				const announcedByteLength = new DataView(
					this.#header.buffer,
					this.#header.byteOffset,
					WIRE_LENGTH_PREFIX_BYTES,
				).getUint32(0, false);
				this.#headerByteLength = 0;
				if (announcedByteLength > this.#maxFrameBytes) {
					this.#failure = new WireFrameOversizeError({
						message: "Announced wire frame length exceeds the configured maximum",
						announcedByteLength,
						maxByteLength: this.#maxFrameBytes,
					});
					throw this.#failure;
				}
				this.#payload = new Uint8Array(announcedByteLength);
				this.#payloadByteLength = 0;
				if (announcedByteLength === 0) this.#finishFrame(frames);
				continue;
			}

			const payloadRemaining = this.#payload.byteLength - this.#payloadByteLength;
			const copied = Math.min(payloadRemaining, chunk.byteLength - offset);
			this.#payload.set(chunk.subarray(offset, offset + copied), this.#payloadByteLength);
			this.#payloadByteLength += copied;
			offset += copied;
			if (this.#payloadByteLength === this.#payload.byteLength) this.#finishFrame(frames);
		}

		return frames;
	}

	reset(): void {
		this.#headerByteLength = 0;
		this.#payload = undefined;
		this.#payloadByteLength = 0;
		this.#failure = undefined;
	}

	#finishFrame(frames: WireFrame[]): void {
		const payload = this.#payload;
		this.#payload = undefined;
		this.#payloadByteLength = 0;
		if (!payload) return;
		try {
			frames.push(decodeWireFrameJson(payload));
		} catch (error) {
			if (error instanceof WireDecodeError) this.#failure = error;
			throw error;
		}
	}
}
