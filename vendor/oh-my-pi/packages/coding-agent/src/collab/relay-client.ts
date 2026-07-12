/** Reconnecting relay transport for collaboration protocol v2. */
import type { RelayControlMessage } from "@oh-my-pi/pi-wire";
import { logger } from "@oh-my-pi/pi-utils";
import { open, ReceiveSequenceWindow, seal } from "./crypto";
import type {
	CollabApplicationFrame,
	CollabChallengeFrame,
	CollabDirection,
	SecureCollabFrame,
} from "./protocol";
import {
	COLLAB_PROTO,
	decodeApplicationFrame,
	decodeChallengeFrame,
	packEnvelope,
	unpackEnvelope,
} from "./protocol";

const FATAL_CLOSE_REASONS: Record<number, string> = {
	4001: "room closed",
	4004: "no such room",
	4009: "a host is already connected for this room",
	4029: "room is full",
};
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export interface CollabSocketOptions {
	wsUrl: string;
	role: "host" | "guest";
	key: CryptoKey;
}

interface PeerCryptoState {
	readonly connectionId: string;
	sendSequence: number;
	readonly receive: ReceiveSequenceWindow;
}

/**
 * The socket owns only connection-scoped encryption and ordering. It never
 * buffers application frames: callers must wait for a fresh welcome before
 * issuing semantic sends after reconnect.
 */
export class CollabSocket {
	onOpen?: () => void;
	onChallenge?: (frame: CollabChallengeFrame, fromPeer: number) => void;
	onFrame?: (frame: CollabApplicationFrame, fromPeer: number) => void;
	onControl?: (msg: RelayControlMessage) => void;
	onClose?: (reason: string, willReconnect: boolean) => void;

	readonly #opts: CollabSocketOptions;
	readonly #peers = new Map<number, PeerCryptoState>();
	#ws: WebSocket | null = null;
	#retryTimer: NodeJS.Timeout | undefined;
	#attempt = 0;
	#closed = false;
	#sendChain: Promise<void> = Promise.resolve();
	#recvChain: Promise<void> = Promise.resolve();

	constructor(opts: CollabSocketOptions) {
		this.#opts = opts;
	}

	get isOpen(): boolean {
		return this.#ws?.readyState === WebSocket.OPEN;
	}

	connect(): void {
		if (this.#ws || this.#retryTimer) return;
		this.#closed = false;
		this.#attempt = 0;
		this.#openSocket();
	}

	/** Install a fresh peer epoch. challengeId is the pre-welcome connectionId. */
	beginConnection(connectionId: string, peerId = 0): void {
		this.#peers.set(peerId, { connectionId, sendSequence: 1, receive: new ReceiveSequenceWindow() });
	}

	forgetPeer(peerId = 0): void {
		this.#peers.delete(peerId);
	}

	/** Challenges are the protocol's sole plaintext frame. */
	sendChallenge(frame: CollabChallengeFrame, targetPeer: number): boolean {
		const ws = this.#ws;
		if (!ws || ws.readyState !== WebSocket.OPEN || this.#closed) return false;
		ws.send(packEnvelope(targetPeer, TEXT_ENCODER.encode(JSON.stringify(frame))).buffer as ArrayBuffer);
		return true;
	}

	/** Returns false unless the socket is open and a fresh connection epoch exists. */
	send(frame: CollabApplicationFrame, targetPeer = 0): boolean {
		const state = this.#peers.get(targetPeer);
		const ws = this.#ws;
		if (!state || !ws || ws.readyState !== WebSocket.OPEN || this.#closed) return false;
		if (!Number.isSafeInteger(state.sendSequence) || state.sendSequence >= Number.MAX_SAFE_INTEGER) {
			this.#failFatal("collab sequence exhausted");
			return false;
		}
		const sequence = state.sendSequence++;
		const direction = this.#outboundDirection();
		const envelope: SecureCollabFrame = {
			proto: COLLAB_PROTO,
			connectionId: state.connectionId,
			direction,
			sequence,
			frame,
		};
		this.#sendChain = this.#sendChain
			.then(async () => {
				if (this.#ws !== ws || ws.readyState !== WebSocket.OPEN || this.#peers.get(targetPeer) !== state) return;
				ws.send(packEnvelope(targetPeer, await seal(this.#opts.key, envelope)).buffer as ArrayBuffer);
			})
			.catch((err: unknown) => this.#failFatal(`collab send failed: ${String(err)}`));
		return true;
	}

	close(): void {
		const hadActivity = this.#ws !== null || this.#retryTimer !== undefined;
		this.#clearRetry();
		const wasClosed = this.#closed;
		this.#closed = true;
		this.#peers.clear();
		const ws = this.#ws;
		this.#ws = null;
		try { ws?.close(1000); } catch { /* already closed */ }
		if (hadActivity && !wasClosed) this.onClose?.("closed", false);
	}

	#openSocket(): void {
		const ws = new WebSocket(`${this.#opts.wsUrl}?role=${this.#opts.role}`);
		ws.binaryType = "arraybuffer";
		this.#ws = ws;
		ws.onopen = () => {
			if (this.#ws !== ws) return;
			this.#attempt = 0;
			this.#peers.clear();
			this.onOpen?.();
		};
		ws.onmessage = (event: MessageEvent) => {
			if (this.#ws === ws) this.#handleMessage(ws, event.data);
		};
		ws.onerror = () => {};
		ws.onclose = (event: CloseEvent) => {
			if (this.#ws !== ws) return;
			this.#ws = null;
			this.#peers.clear();
			this.#handleClose(event.code, event.reason);
		};
	}

	#handleMessage(ws: WebSocket, data: unknown): void {
		if (typeof data === "string") {
			try { this.onControl?.(JSON.parse(data) as RelayControlMessage); }
			catch { logger.debug("collab: ignoring malformed control message"); }
			return;
		}
		const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
		if (!bytes) return;
		const relay = unpackEnvelope(bytes);
		if (!relay) return;
		const state = this.#peers.get(relay.peerId);
		if (!state) {
			try {
				const challenge = decodeChallengeFrame(JSON.parse(TEXT_DECODER.decode(relay.payload)));
				this.onChallenge?.(challenge, relay.peerId);
			} catch {
				this.#failFatal("encrypted frame received before challenge");
			}
			return;
		}
		this.#recvChain = this.#recvChain.then(async () => {
			if (this.#ws !== ws || this.#peers.get(relay.peerId) !== state) return;
			const expectedSequence = state.receive.lastAccepted + 1;
			let secure: SecureCollabFrame;
			try {
				secure = await open(this.#opts.key, relay.payload, {
					connectionId: state.connectionId,
					direction: this.#inboundDirection(),
					sequence: expectedSequence,
				});
			} catch {
				this.#failFatal("bad key, stale connection, or corrupted frame");
				return;
			}
			if (state.receive.accept(secure.sequence).kind !== "accepted") {
				this.#failFatal("out-of-order encrypted frame");
				return;
			}
			this.onFrame?.(decodeApplicationFrame(secure.frame), relay.peerId);
		}).catch((err: unknown) => this.#failFatal(`collab frame failed: ${String(err)}`));
	}

	#outboundDirection(): CollabDirection { return this.#opts.role === "guest" ? "guestToHost" : "hostToGuest"; }
	#inboundDirection(): CollabDirection { return this.#opts.role === "guest" ? "hostToGuest" : "guestToHost"; }

	#handleClose(code: number, reason: string): void {
		if (this.#closed) return;
		const fatal = FATAL_CLOSE_REASONS[code];
		if (fatal) {
			this.#closed = true;
			this.onClose?.(fatal, false);
			return;
		}
		this.onClose?.(reason || `connection lost (code ${code})`, true);
		this.#scheduleRetry();
	}

	#failFatal(reason: string): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#clearRetry();
		this.#peers.clear();
		const ws = this.#ws;
		this.#ws = null;
		try { ws?.close(1000); } catch { /* already closed */ }
		this.onClose?.(reason, false);
	}

	#scheduleRetry(): void {
		const base = Math.min(BACKOFF_BASE_MS * 2 ** this.#attempt++, BACKOFF_MAX_MS);
		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = undefined;
			if (!this.#closed) this.#openSocket();
		}, base * (0.75 + Math.random() * 0.5));
	}

	#clearRetry(): void {
		if (this.#retryTimer !== undefined) clearTimeout(this.#retryTimer);
		this.#retryTimer = undefined;
	}
}
