/**
 * AES-256-GCM sealing for collab frames (browser-safe vendored mirror of
 * `@oh-my-pi/pi-coding-agent/src/collab/crypto.ts` — WebCrypto only).
 *
 * The room key lives only in the link fragment; the relay sees opaque bytes.
 * Sealed layout: `[12B IV][ciphertext+tag]`.
 */
import { COLLAB_PROTO } from "@oh-my-pi/pi-wire";
import type { CollabDirection, SecureCollabFrame } from "@oh-my-pi/pi-wire";

const AES_ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export interface SecureFrameContext {
	readonly connectionId: string;
	readonly direction: CollabDirection;
	readonly sequence: number;
}

export type SequenceResult =
	| { readonly kind: "accepted" }
	| { readonly kind: "dropped"; readonly expectedSequence: number; readonly observedSequence: number }
	| { readonly kind: "gap"; readonly expectedSequence: number; readonly observedSequence: number };

export class ReceiveSequenceWindow {
	#last = 0;
	get lastAccepted(): number { return this.#last; }
	accept(sequence: number): SequenceResult {
		if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence === Number.MAX_SAFE_INTEGER) throw new Error("Invalid secure frame sequence");
		const expectedSequence = this.#last + 1;
		if (!Number.isSafeInteger(expectedSequence)) throw new Error("Secure frame sequence exhausted");
		if (sequence < expectedSequence) return { kind: "dropped", expectedSequence, observedSequence: sequence };
		if (sequence > expectedSequence) return { kind: "gap", expectedSequence, observedSequence: sequence };
		this.#last = sequence;
		return { kind: "accepted" };
	}
}

export function generateRoomKey(): Uint8Array {
	const key = new Uint8Array(KEY_LENGTH);
	crypto.getRandomValues(key);
	return key;
}

export function importRoomKey(raw: Uint8Array): Promise<CryptoKey> {
	if (raw.byteLength !== KEY_LENGTH) throw new Error(`Room key must be ${KEY_LENGTH} bytes, got ${raw.byteLength}`);
	return crypto.subtle.importKey("raw", asStrict(raw), AES_ALGORITHM, false, ["encrypt", "decrypt"]);
}

function aad(context: SecureFrameContext): Uint8Array<ArrayBuffer> {
	if (!context.connectionId || !Number.isSafeInteger(context.sequence) || context.sequence < 1) throw new Error("Invalid AAD context");
	if (context.direction !== "guestToHost" && context.direction !== "hostToGuest") throw new Error("Invalid AAD direction");
	return asStrict(TEXT_ENCODER.encode(`${COLLAB_PROTO}\n${context.connectionId}\n${context.direction}\n${context.sequence}`));
}

export async function seal(key: CryptoKey, envelope: SecureCollabFrame): Promise<Uint8Array> {
	const iv = new Uint8Array(IV_LENGTH);
	crypto.getRandomValues(iv);
	const plaintext = TEXT_ENCODER.encode(JSON.stringify(envelope));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: AES_ALGORITHM, iv, additionalData: aad(envelope) }, key, plaintext),
	);
	const out = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
	out.set(iv, 0);
	out.set(ciphertext, IV_LENGTH);
	return out;
}

export async function open(key: CryptoKey, data: Uint8Array, expected: SecureFrameContext): Promise<SecureCollabFrame> {
	if (data.byteLength <= IV_LENGTH + 16) throw new Error("Sealed frame too short");
	const plaintext = new Uint8Array(
		await crypto.subtle.decrypt(
			{ name: AES_ALGORITHM, iv: asStrict(data.subarray(0, IV_LENGTH)), additionalData: aad(expected) },
			key,
			asStrict(data.subarray(IV_LENGTH)),
		),
	);
	const value: unknown = JSON.parse(TEXT_DECODER.decode(plaintext));
	if (!isSecureFrame(value)) throw new Error("Invalid secure collaboration frame");
	if (value.connectionId !== expected.connectionId || value.direction !== expected.direction || value.sequence !== expected.sequence) {
		throw new Error("Secure frame metadata mismatch");
	}
	return value;
}

function isSecureFrame(value: unknown): value is SecureCollabFrame {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	if (Object.keys(record).some((key) => !["proto", "connectionId", "direction", "sequence", "frame"].includes(key))) return false;
	return record.proto === COLLAB_PROTO &&
		typeof record.connectionId === "string" && record.connectionId.length > 0 &&
		(record.direction === "guestToHost" || record.direction === "hostToGuest") &&
		Number.isSafeInteger(record.sequence) && (record.sequence as number) > 0 &&
		typeof record.frame === "object" && record.frame !== null && !Array.isArray(record.frame);
}

function asStrict(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
		return bytes as Uint8Array<ArrayBuffer>;
	}
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy;
}
