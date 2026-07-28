/**
 * Collab live-session wire protocol.
 *
 * Hub topology: the host is authoritative, guests never peer. All session
 * payloads (`CollabFrame`) travel AES-256-GCM sealed; the relay only sees the
 * plaintext envelope (`[4B uint32 BE peerId][sealed payload]`) plus TEXT JSON
 * control messages that carry no session data.
 */

import type {
	CollabApplicationFrame,
	CollabAttachFrame,
	CollabChallengeFrame,
	CollabDirection,
	GuestFrame,
	HostFrame,
	JsonValue,
	ParsedCollabLink,
	SecureCollabFrame,
} from "@oh-my-pi/pi-wire";
import {
	COLLAB_PROTO,
	DEFAULT_RELAY_URL,
	ENVELOPE_HEADER_LENGTH,
	ROOM_ID_BYTES,
	ROOM_KEY_BYTES,
	WRITE_TOKEN_BYTES,
} from "@oh-my-pi/pi-wire";

export type {
	CollabApplicationFrame,
	CollabAttachFrame,
	CollabCapability,
	CollabChallengeFrame,
	CollabDirection,
	CollabRunnerEventDelivery,
	CollabRunnerSnapshot,
	GuestFrame,
	HostFrame,
	JsonValue,
	ParsedCollabLink,
	SecureCollabFrame,
} from "@oh-my-pi/pi-wire";
export {
	COLLAB_PROMPT_MESSAGE_TYPE,
	COLLAB_PROTO,
} from "@oh-my-pi/pi-wire";
export { DEFAULT_RELAY_URL, ENVELOPE_HEADER_LENGTH, ROOM_ID_BYTES };

export type CollabFrame = CollabApplicationFrame;

const RECORD = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const STRING = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const UINT = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const POSITIVE_SEQUENCE = (value: unknown): value is number => UINT(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;

function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of required) if (!(key in value)) throw new Error(`Missing field: ${key}`);
	for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown field: ${key}`);
}

export function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (!RECORD(value)) return false;
	return Object.values(value).every(isJsonValue);
}

export function decodeChallengeFrame(input: unknown): CollabChallengeFrame {
	if (!RECORD(input)) throw new Error("Challenge must be an object");
	exact(input, ["t", "proto", "challengeId", "challenge"]);
	if (input.t !== "challenge" || input.proto !== COLLAB_PROTO || !STRING(input.challengeId) || !STRING(input.challenge)) {
		throw new Error("Invalid collaboration challenge");
	}
	return input as unknown as CollabChallengeFrame;
}

export function decodeAttachFrame(input: unknown): CollabAttachFrame {
	if (!RECORD(input)) throw new Error("Attach must be an object");
	exact(input, ["t", "proto", "clientId", "viewId", "requestedCapability", "challengeId", "challengeResponse"], [
		"writeToken",
		"afterSequence",
	]);
	if (
		input.t !== "attach" ||
		input.proto !== COLLAB_PROTO ||
		!STRING(input.clientId) ||
		!STRING(input.viewId) ||
		(input.requestedCapability !== "observer" && input.requestedCapability !== "controller") ||
		!STRING(input.challengeId) ||
		!STRING(input.challengeResponse) ||
		(input.writeToken !== undefined && !STRING(input.writeToken)) ||
		(input.afterSequence !== undefined && !UINT(input.afterSequence))
	) {
		throw new Error("Invalid collaboration attach");
	}
	return input as unknown as CollabAttachFrame;
}

export function decodeApplicationFrame(input: unknown): CollabApplicationFrame {
	if (!RECORD(input) || !STRING(input.t)) throw new Error("Frame must be a tagged object");
	const request = () => {
		if (!STRING(input.requestId)) throw new Error("Invalid request id");
	};
	switch (input.t) {
		case "attach":
			return decodeAttachFrame(input);
		case "command":
			exact(input, ["t", "requestId", "command"]);
			request();
			if (!RECORD(input.command) || !isJsonValue(input.command)) throw new Error("Invalid runner command");
			break;
		case "acquireController":
			exact(input, ["t", "requestId"]);
			request();
			break;
		case "releaseController":
			exact(input, ["t", "requestId", "controllerEpoch"]);
			request();
			if (!POSITIVE_SEQUENCE(input.controllerEpoch)) throw new Error("Invalid controller epoch");
			break;
		case "detach":
			exact(input, ["t"]);
			break;
		case "resyncRequest":
			exact(input, ["t", "afterSequence"]);
			if (!UINT(input.afterSequence)) throw new Error("Invalid resync sequence");
			break;
		case "welcome":
			exact(input, ["t", "connectionId", "viewId", "capability", "snapshot", "sequence"], ["controllerEpoch"]);
			if (!STRING(input.connectionId) || !STRING(input.viewId) || !POSITIVE_SEQUENCE(input.sequence)) throw new Error("Invalid welcome");
			if (input.capability !== "observer" && input.capability !== "controller") throw new Error("Invalid capability");
			if (!decodeSnapshot(input.snapshot)) throw new Error("Invalid snapshot");
			break;
		case "delta":
			exact(input, ["t", "delivery"]);
			if (!RECORD(input.delivery) || input.delivery.kind !== "event" || !isJsonValue(input.delivery.event)) throw new Error("Invalid delta");
			break;
		case "resync":
			exact(input, ["t", "snapshot", "expectedSequence", "observedSequence"]);
			if (!decodeSnapshot(input.snapshot) || !POSITIVE_SEQUENCE(input.expectedSequence) || !POSITIVE_SEQUENCE(input.observedSequence)) throw new Error("Invalid resync");
			break;
		case "commandResult":
			exact(input, ["t", "requestId", "ok"], ["receipt", "error"]);
			request();
			if (typeof input.ok !== "boolean" || (input.receipt !== undefined && !isJsonValue(input.receipt))) throw new Error("Invalid result");
			if (input.error !== undefined && (!RECORD(input.error) || !STRING(input.error.code) || !STRING(input.error.message))) throw new Error("Invalid result error");
			break;
		case "controllerChanged":
			exact(input, ["t", "capability"], ["controllerEpoch"]);
			if (input.capability !== "observer" && input.capability !== "controller") throw new Error("Invalid capability");
			break;
		case "bye":
			exact(input, ["t", "reason"]);
			if (!STRING(input.reason)) throw new Error("Invalid bye");
			break;
		case "error":
			exact(input, ["t", "code", "message"], ["requestId"]);
			if (!STRING(input.code) || !STRING(input.message) || (input.requestId !== undefined && !STRING(input.requestId))) throw new Error("Invalid error");
			break;
		default:
			throw new Error(`Unknown collaboration frame: ${input.t}`);
	}
	return input as unknown as CollabApplicationFrame;
}

function decodeSnapshot(value: unknown): boolean {
	if (!RECORD(value)) return false;
	try {
		exact(value, ["revision", "runnerSequence", "sessionRevision", "transcript", "durableInputs", "activeOperations", "workflow", "tools", "todos", "model", "session"]);
	} catch {
		return false;
	}
	return UINT(value.revision) && UINT(value.runnerSequence) && UINT(value.sessionRevision) && isJsonValue(value);
}

export function decodeSecureCollabFrame(input: unknown): SecureCollabFrame {
	if (!RECORD(input)) throw new Error("Secure frame must be an object");
	exact(input, ["proto", "connectionId", "direction", "sequence", "frame"]);
	if (
		input.proto !== COLLAB_PROTO ||
		!STRING(input.connectionId) ||
		(input.direction !== "guestToHost" && input.direction !== "hostToGuest") ||
		!POSITIVE_SEQUENCE(input.sequence)
	) throw new Error("Invalid secure frame metadata");
	return { ...input, frame: decodeApplicationFrame(input.frame) } as SecureCollabFrame;
}

// ═══════════════════════════════════════════════════════════════════════════
// Wire envelope: [4B uint32 BE peerId][sealed payload]
// Host→relay: peerId 0 broadcasts to all guests; peerId N targets guest N.
// Guest→relay: always 0; the relay rewrites it to the sender's id.
// ═══════════════════════════════════════════════════════════════════════════

export function packEnvelope(peerId: number, sealed: Uint8Array): Uint8Array {
	const out = new Uint8Array(ENVELOPE_HEADER_LENGTH + sealed.byteLength);
	new DataView(out.buffer).setUint32(0, peerId, false);
	out.set(sealed, ENVELOPE_HEADER_LENGTH);
	return out;
}

export function unpackEnvelope(data: Uint8Array): { peerId: number; payload: Uint8Array } | null {
	if (data.byteLength < ENVELOPE_HEADER_LENGTH) return null;
	const peerId = new DataView(data.buffer, data.byteOffset, ENVELOPE_HEADER_LENGTH).getUint32(0, false);
	return { peerId, payload: data.subarray(ENVELOPE_HEADER_LENGTH) };
}

/** Rewrite the peerId in place without copying the payload. */
export function rewriteEnvelopePeer(data: Uint8Array, peerId: number): void {
	new DataView(data.buffer, data.byteOffset, ENVELOPE_HEADER_LENGTH).setUint32(0, peerId, false);
}

// ═══════════════════════════════════════════════════════════════════════════
// Link format: wss://<host[:port]>/r/<roomId>.<base64url-32-byte-key>
// ═══════════════════════════════════════════════════════════════════════════

const ROOM_PATH_RE = /^\/r\/([A-Za-z0-9_-]{10,64})(?:\.([A-Za-z0-9_-]+))?$/;
const BARE_LINK_RE = /^([A-Za-z0-9_-]{10,64})[#.]([A-Za-z0-9_-]+)$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const LOCAL_HOSTNAMES: Record<string, true> = { localhost: true, "127.0.0.1": true, "::1": true, "[::1]": true };

export function generateRoomId(): string {
	const bytes = new Uint8Array(ROOM_ID_BYTES);
	crypto.getRandomValues(bytes);
	return Buffer.from(bytes).toString("base64url");
}

/** Normalize a relay base URL (ws/wss/http/https) into a ws/wss origin, or an error. */
function normalizeRelayOrigin(relayUrl: string): { origin: string } | { error: string } {
	let url: URL;
	try {
		url = new URL(relayUrl);
	} catch {
		return { error: `Invalid relay URL: ${relayUrl}` };
	}
	let scheme: string;
	switch (url.protocol) {
		case "wss:":
		case "https:":
			scheme = "wss:";
			break;
		case "ws:":
		case "http:":
			scheme = "ws:";
			break;
		default:
			return { error: `Unsupported relay URL scheme: ${url.protocol}` };
	}
	if (scheme === "ws:" && !LOCAL_HOSTNAMES[url.hostname]) {
		return { error: "relay link must be wss:// (plain ws:// is only allowed for localhost)" };
	}
	const port = url.port ? `:${url.port}` : "";
	return { origin: `${scheme}//${url.hostname}${port}` };
}

/**
 * Render the shareable link. Compact forms: the default relay collapses to
 * `<roomId>.<key>`, other wss relays drop the scheme (`host[:port]/r/…`);
 * only localhost ws:// links keep their full URL so parsing cannot
 * mis-infer wss.
 *
 * The room secret is dot-joined (`<roomId>.<key>`) rather than `#`-joined:
 * RFC 3986 forbids a raw `#` inside a fragment, so strict URL stacks (macOS
 * Foundation behind terminal click-to-open) percent-encode a second `#` to
 * `%23` and break the link. Parsers still accept the legacy `#` form and the
 * mangled `%23` form.
 *
 * Full links append the write token to the key
 * (`base64url(key ∥ writeToken)`); read-only (view) links carry the bare
 * 32-byte key, which is also the pre-token link format.
 */
export function formatCollabLink(relayUrl: string, roomId: string, key: Uint8Array, writeToken?: Uint8Array): string {
	const normalized = normalizeRelayOrigin(relayUrl);
	if ("error" in normalized) throw new Error(normalized.error);
	const secret = writeToken ? Buffer.concat([key, writeToken]) : Buffer.from(key);
	const keyText = secret.toString("base64url");
	if (normalized.origin === DEFAULT_RELAY_URL) return `${roomId}.${keyText}`;
	const compact = normalized.origin.startsWith("wss://")
		? normalized.origin.slice("wss://".length)
		: normalized.origin;
	return `${compact}/r/${roomId}.${keyText}`;
}

/**
 * Render the browser deep link: `http(s)://<relay-host>/#<collab-link>`. The
 * relay serves the web client at `/`, and the whole collab link (including the
 * room key) rides in the fragment, so it never appears in any HTTP request.
 * Terminals auto-link the https form, making it click-to-join.
 */
export function formatCollabWebLink(
	relayUrl: string,
	roomId: string,
	key: Uint8Array,
	writeToken?: Uint8Array,
): string {
	const normalized = normalizeRelayOrigin(relayUrl);
	if ("error" in normalized) throw new Error(normalized.error);
	const httpOrigin = normalized.origin.startsWith("wss://")
		? `https://${normalized.origin.slice("wss://".length)}`
		: `http://${normalized.origin.slice("ws://".length)}`;
	return `${httpOrigin}/#${formatCollabLink(relayUrl, roomId, key, writeToken)}`;
}

export function parseCollabLink(link: string): ParsedCollabLink | { error: string } {
	// Lenient input: terminals that open OSC 8 links through strict URL stacks
	// (macOS Foundation) percent-encode the legacy second `#` to `%23`.
	let text = link.trim().replace(/%23/gi, "#");
	// Bare `<roomId>.<key>` (legacy `<roomId>#<key>`) → default relay.
	const bare = BARE_LINK_RE.exec(text);
	if (bare) text = `${DEFAULT_RELAY_URL}/r/${bare[1]}.${bare[2]}`;
	// Scheme-less `host[:port]/r/…` → wss.
	else if (!text.includes("://")) text = `wss://${text}`;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return { error: `Invalid collab link: ${link}` };
	}
	const normalized = normalizeRelayOrigin(url.origin);
	if ("error" in normalized) return normalized;
	const match = ROOM_PATH_RE.exec(url.pathname);
	if (!match) {
		// Web deep link: `http(s)://<relay>/#<collab-link>` — the fragment holds
		// the whole link, so recurse on it. The recursion terminates because
		// the inner text is a strict suffix of the input.
		const inner = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
		if (inner) return parseCollabLink(inner);
		return { error: "Collab link must contain a /r/<roomId> path" };
	}
	const roomId = match[1]!;
	// Key rides dot-joined in the path (`/r/<roomId>.<key>`); legacy links
	// carry it in the fragment (`/r/<roomId>#<key>`).
	const fragment = match[2] ?? (url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
	if (!fragment) {
		return { error: "Collab link is missing the <key> part" };
	}
	const secret = B64URL_RE.test(fragment) ? new Uint8Array(Buffer.from(fragment, "base64url")) : null;
	if (!secret || (secret.byteLength !== ROOM_KEY_BYTES && secret.byteLength !== ROOM_KEY_BYTES + WRITE_TOKEN_BYTES)) {
		return { error: "Collab link key must be 32 (view) or 48 (full) base64url bytes" };
	}
	const key = secret.subarray(0, ROOM_KEY_BYTES);
	const writeToken = secret.byteLength > ROOM_KEY_BYTES ? secret.subarray(ROOM_KEY_BYTES) : undefined;
	return { wsUrl: `${normalized.origin}/r/${roomId}`, roomId, key, writeToken };
}
