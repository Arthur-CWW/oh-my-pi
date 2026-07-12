import type {
	CollabAttachFrame,
	CollabChallengeFrame,
	GuestFrame,
	HostFrame,
	RelayControlMessage,
	SecureCollabFrame,
} from "@oh-my-pi/pi-wire";
import { COLLAB_PROTO } from "@oh-my-pi/pi-wire";
import { open, ReceiveSequenceWindow, seal } from "./codec";
import { packEnvelope, unpackEnvelope } from "./link";

const FATAL_CLOSE_REASONS: Record<number, string> = {
	4001: "room closed",
	4004: "no such room",
	4009: "a host is already connected for this room",
	4029: "room is full",
};
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

export interface CollabSocketOptions {
	wsUrl: string;
	role: "host" | "guest";
	key: CryptoKey | PromiseLike<CryptoKey>;
}

/** Browser relay transport. It never carries semantic frames across reconnects. */
export class CollabSocket {
	onOpen?: () => void;
	onChallenge?: (frame: CollabChallengeFrame, fromPeer: number) => void;
	onFrame?: (frame: HostFrame, fromPeer: number) => void;
	onControl?: (msg: RelayControlMessage) => void;
	onSequenceGap?: (expectedSequence: number, observedSequence: number) => void;
	onClose?: (reason: string, willReconnect: boolean) => void;

	readonly #opts: CollabSocketOptions;
	#ws: WebSocket | null = null;
	#retryTimer: Timer | undefined;
	#attempt = 0;
	#closed = false;
	#connectionId: string | null = null;
	#sendSequence = 0;
	#receiveWindow = new ReceiveSequenceWindow();
	#sendChain: Promise<void> = Promise.resolve();
	#recvChain: Promise<void> = Promise.resolve();

	constructor(opts: CollabSocketOptions) {
		this.#opts = opts;
	}

	get isOpen(): boolean {
		return this.#ws?.readyState === WebSocket.OPEN;
	}

	connect(): void {
		if (this.#ws && (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING)) return;
		this.#closed = false;
		this.#clearRetry();
		this.#openSocket();
	}

	/** The challenge id is the fresh connection id used to bootstrap welcome AAD. */
	activateConnection(connectionId: string): void {
		this.#connectionId = connectionId;
		this.#sendSequence = 0;
		this.#receiveWindow = new ReceiveSequenceWindow();
		this.#sendChain = Promise.resolve();
		this.#recvChain = Promise.resolve();
	}

	/** Attach is challenge-authenticated but deliberately not encrypted. */
	sendAttach(frame: CollabAttachFrame, targetPeer = 0): void {
		if (!this.isOpen) throw new Error("collab socket is not open");
		this.#ws!.send(packEnvelope(targetPeer, ENCODER.encode(JSON.stringify(frame))));
	}

	send(frame: Exclude<GuestFrame, CollabAttachFrame>, targetPeer = 0): void {
		const connectionId = this.#connectionId;
		if (!connectionId || !this.isOpen) throw new Error("collab connection is not attached");
		const sequence = ++this.#sendSequence;
		const envelope: SecureCollabFrame = {
			proto: COLLAB_PROTO,
			connectionId,
			direction: "guestToHost",
			sequence,
			frame,
		};
		const ws = this.#ws!;
		this.#sendChain = this.#sendChain
			.then(async () => {
				const encrypted = await seal(await this.#opts.key, envelope);
				if (this.#ws !== ws || ws.readyState !== WebSocket.OPEN) throw new Error("collab connection closed before send");
				ws.send(packEnvelope(targetPeer, encrypted));
			})
			.catch(error => this.#failFatal(error instanceof Error ? error.message : String(error)));
	}

	close(): void {
		this.#closed = true;
		this.#clearRetry();
		this.#resetConnection();
		const ws = this.#ws;
		this.#ws = null;
		if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close(1000, "client closed");
	}

	#openSocket(): void {
		const ws = new WebSocket(this.#opts.wsUrl);
		ws.binaryType = "arraybuffer";
		this.#ws = ws;
		ws.addEventListener("open", () => {
			if (this.#ws !== ws || this.#closed) return;
			this.#attempt = 0;
			this.#resetConnection();
			this.onOpen?.();
		});
		ws.addEventListener("message", event => {
			if (this.#ws === ws && !this.#closed) this.#handleMessage(ws, event.data);
		});
		ws.addEventListener("close", event => {
			if (this.#ws !== ws) return;
			this.#ws = null;
			this.#handleClose(event.code, event.reason);
		});
		ws.addEventListener("error", () => undefined);
	}

	#handleMessage(ws: WebSocket, data: unknown): void {
		if (typeof data === "string") {
			try {
				this.onControl?.(JSON.parse(data) as RelayControlMessage);
			} catch {
				this.#failFatal("invalid relay control message");
			}
			return;
		}
		if (!(data instanceof ArrayBuffer)) return;
		const unpacked = unpackEnvelope(new Uint8Array(data));
		if (!unpacked) return;
		if (this.#connectionId === null) {
			try {
				const value = JSON.parse(DECODER.decode(unpacked.payload)) as Partial<CollabChallengeFrame>;
				if (value.t !== "challenge" || value.proto !== COLLAB_PROTO || typeof value.challengeId !== "string" || typeof value.challenge !== "string") {
					throw new Error("invalid challenge");
				}
				this.onChallenge?.(value as CollabChallengeFrame, unpacked.peerId);
			} catch (error) {
				this.#failFatal(error instanceof Error ? error.message : "invalid challenge");
			}
			return;
		}
		const connectionId = this.#connectionId;
		this.#recvChain = this.#recvChain
			.then(async () => {
				const expectedSequence = this.#receiveWindow.lastAccepted + 1;
				const envelope = await open(await this.#opts.key, unpacked.payload, {
					connectionId,
					direction: "hostToGuest",
					sequence: expectedSequence,
				});
				if (this.#ws !== ws || this.#connectionId !== connectionId) return;
				const result = this.#receiveWindow.accept(envelope.sequence);
				if (result.kind === "dropped") return;
				if (result.kind === "gap") {
					this.onSequenceGap?.(result.expectedSequence, result.observedSequence);
					return;
				}
				this.onFrame?.(envelope.frame as HostFrame, unpacked.peerId);
			})
			.catch(error => this.#failFatal(error instanceof Error ? error.message : "failed to decrypt collab frame"));
	}

	#handleClose(code: number, reason: string): void {
		this.#resetConnection();
		if (this.#closed) return;
		const fatal = FATAL_CLOSE_REASONS[code];
		if (fatal) {
			this.#closed = true;
			this.onClose?.(fatal, false);
			return;
		}
		this.onClose?.(reason || "connection lost", true);
		this.#scheduleRetry();
	}

	#failFatal(reason: string): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#clearRetry();
		this.#resetConnection();
		const ws = this.#ws;
		this.#ws = null;
		if (ws && ws.readyState < WebSocket.CLOSING) ws.close(4003, "protocol error");
		this.onClose?.(reason, false);
	}

	#resetConnection(): void {
		this.#connectionId = null;
		this.#sendSequence = 0;
		this.#receiveWindow = new ReceiveSequenceWindow();
		this.#sendChain = Promise.resolve();
		this.#recvChain = Promise.resolve();
	}

	#scheduleRetry(): void {
		if (this.#closed || this.#retryTimer) return;
		const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.#attempt++, BACKOFF_MAX_MS);
		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = undefined;
			if (!this.#closed) this.#openSocket();
		}, delay);
	}

	#clearRetry(): void {
		if (this.#retryTimer) clearTimeout(this.#retryTimer);
		this.#retryTimer = undefined;
	}
}
