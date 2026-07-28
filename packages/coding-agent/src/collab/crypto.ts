/**
 * AES-256-GCM sealing for collab frames.
 *
 * The room key lives only in the link fragment; the relay sees opaque bytes.
 * Sealed layout: `[12B IV][ciphertext+tag]`.
 */
import { COLLAB_PROTO, ROOM_KEY_BYTES, WRITE_TOKEN_BYTES } from "@oh-my-pi/pi-wire";
import type { CollabCapability, CollabDirection, SecureCollabFrame } from "@oh-my-pi/pi-wire";
import { decodeSecureCollabFrame } from "./protocol";

const AES_ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;
const RANDOM_ID_BYTES = 16;
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

/** Per-connection exact-order receive window. Create a new instance on reconnect. */
export class ReceiveSequenceWindow {
	#last = 0;

	get lastAccepted(): number {
		return this.#last;
	}
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
	const key = new Uint8Array(ROOM_KEY_BYTES);
	crypto.getRandomValues(key);
	return key;
}

export function generateWriteToken(): Uint8Array {
	const token = new Uint8Array(WRITE_TOKEN_BYTES);
	crypto.getRandomValues(token);
	return token;
}

export function generateChallengeValue(): string {
	const bytes = new Uint8Array(RANDOM_ID_BYTES);
	crypto.getRandomValues(bytes);
	return toBase64Url(bytes);
}

export const generateConnectionId = generateChallengeValue;

export function importRoomKey(raw: Uint8Array): Promise<CryptoKey> {
	if (raw.byteLength !== ROOM_KEY_BYTES) throw new Error(`Room key must be ${ROOM_KEY_BYTES} bytes, got ${raw.byteLength}`);
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
	const additionalData = aad(envelope);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: AES_ALGORITHM, iv, additionalData }, key, plaintext),
	);
	const out = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
	out.set(iv, 0);
	out.set(ciphertext, IV_LENGTH);
	return out;
}

/** Decrypt using independently known routing metadata, then require an exact inner match. */
export async function open(key: CryptoKey, data: Uint8Array, expected: SecureFrameContext): Promise<SecureCollabFrame> {
	if (data.byteLength <= IV_LENGTH + 16) throw new Error("Sealed frame too short");
	const iv = asStrict(data.subarray(0, IV_LENGTH));
	const ciphertext = asStrict(data.subarray(IV_LENGTH));
	const plaintext = new Uint8Array(
		await crypto.subtle.decrypt({ name: AES_ALGORITHM, iv, additionalData: aad(expected) }, key, ciphertext),
	);
	const decoded: unknown = JSON.parse(TEXT_DECODER.decode(plaintext));
	const envelope = decodeSecureCollabFrame(decoded);
	if (
		envelope.connectionId !== expected.connectionId ||
		envelope.direction !== expected.direction ||
		envelope.sequence !== expected.sequence
	) throw new Error("Secure frame metadata mismatch");
	return envelope;
}

export async function createChallengeResponse(
	roomKey: Uint8Array,
	challengeId: string,
	challenge: string,
	clientId: string,
	requestedCapability: CollabCapability,
): Promise<string> {
	if (roomKey.byteLength !== ROOM_KEY_BYTES) throw new Error("Invalid room key");
	for (const value of [challengeId, challenge, clientId]) if (!value) throw new Error("Challenge fields must be non-empty");
	const key = await crypto.subtle.importKey("raw", asStrict(roomKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const canonical = TEXT_ENCODER.encode(`${challengeId.length}:${challengeId}${challenge.length}:${challenge}${clientId.length}:${clientId}${requestedCapability}`);
	return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, canonical)));
}

export interface PendingChallenge {
	readonly challengeId: string;
	readonly challenge: string;
	readonly expiresAt: number;
}

/** One-use host challenge store. Closing a peer must call `discard`. */
export class ChallengeVerifier {
	readonly #roomKey: Uint8Array;
	readonly #pending = new Map<string, PendingChallenge>();

	constructor(roomKey: Uint8Array) {
		if (roomKey.byteLength !== ROOM_KEY_BYTES) throw new Error("Invalid room key");
		this.#roomKey = roomKey.slice();
	}

	issue(ttlMs = 30_000, now = Date.now()): PendingChallenge {
		if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error("Invalid challenge TTL");
		const pending = { challengeId: generateChallengeValue(), challenge: generateChallengeValue(), expiresAt: now + ttlMs };
		this.#pending.set(pending.challengeId, pending);
		return pending;
	}

	discard(challengeId: string): void {
		this.#pending.delete(challengeId);
	}

	async consume(
		challengeId: string,
		response: string,
		clientId: string,
		requestedCapability: CollabCapability,
		now = Date.now(),
	): Promise<string> {
		const pending = this.#pending.get(challengeId);
		this.#pending.delete(challengeId);
		if (!pending || pending.expiresAt < now) throw new Error("Challenge missing or expired");
		const expected = await createChallengeResponse(
			this.#roomKey,
			pending.challengeId,
			pending.challenge,
			clientId,
			requestedCapability,
		);
		if (!timingSafeEqualBase64Url(response, expected)) throw new Error("Invalid challenge response");
		return generateConnectionId();
	}
}

export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
	let difference = left.byteLength ^ right.byteLength;
	const length = Math.max(left.byteLength, right.byteLength);
	for (let index = 0; index < length; index++) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	return difference === 0;
}

export function timingSafeEqualBase64Url(left: string, right: string): boolean {
	try {
		return timingSafeEqual(fromBase64Url(left), fromBase64Url(right));
	} catch {
		return false;
	}
}

function toBase64Url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
	return new Uint8Array(Buffer.from(value, "base64url"));
}

function asStrict(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
		return bytes as Uint8Array<ArrayBuffer>;
	}
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy;
}
