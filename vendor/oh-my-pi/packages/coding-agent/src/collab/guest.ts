/** Pure collaboration protocol-v2 guest state machine. */
import type {
	CollabCapability,
	CollabChallengeFrame,
	CollabRunnerEventDelivery,
	CollabRunnerSnapshot,
	GuestFrame,
	HostFrame,
	JsonValue,
} from "./protocol";
import { COLLAB_PROTO, parseCollabLink } from "./protocol";
import { createChallengeResponse, importRoomKey } from "./crypto";
import { CollabSocket } from "./relay-client";

export const COLLAB_GUEST_ALLOWED_COMMANDS: Record<string, true> = {
	export: true,
	help: true,
	theme: true,
	settings: true,
	leave: true,
	collab: true,
	exit: true,
	quit: true,
};

const WELCOME_TIMEOUT_MS = 30_000;

export interface CollabGuestState {
	readonly connectionId: string;
	readonly viewId: string;
	readonly capability: CollabCapability;
	readonly controllerEpoch?: number;
	readonly snapshot: CollabRunnerSnapshot;
	readonly deltas: readonly CollabRunnerEventDelivery[];
}

export interface CollabGuestLinkOptions {
	onState?: (state: CollabGuestState) => void;
	onStatus?: (message: string) => void;
	onError?: (message: string) => void;
}

interface PendingRequest {
	readonly resolve: (receipt: JsonValue | undefined) => void;
	readonly reject: (error: Error) => void;
}

/**
 * Maintains a transport-neutral runner read model. Terminal code must render
 * this state; this class never creates, switches, or mutates a local session.
 */
export class CollabGuestLink {
	readonly clientId = crypto.randomUUID();
	readonly viewId = crypto.randomUUID();
	readonly #options: CollabGuestLinkOptions;
	readonly #pending = new Map<string, PendingRequest>();
	#socket: CollabSocket | null = null;
	#roomKey: Uint8Array | null = null;
	#writeToken: string | undefined;
	#requestedCapability: CollabCapability = "observer";
	#challengeId: string | null = null;
	#welcomeResolve: (() => void) | null = null;
	#welcomeReject: ((error: Error) => void) | null = null;
	#left = false;
	#welcomed = false;
	state: CollabGuestState | null = null;

	constructor(options: CollabGuestLinkOptions = {}) {
		this.#options = options;
	}

	get readOnly(): boolean {
		return this.state?.capability !== "controller";
	}

	async join(link: string): Promise<void> {
		if (this.#socket) throw new Error("collaboration guest is already connected");
		const parsed = parseCollabLink(link);
		if ("error" in parsed) throw new Error(parsed.error);
		this.#left = false;
		this.#roomKey = parsed.key;
		this.#writeToken = parsed.writeToken ? Buffer.from(parsed.writeToken).toString("base64url") : undefined;
		this.#requestedCapability = this.#writeToken ? "controller" : "observer";
		const socket = new CollabSocket({ wsUrl: parsed.wsUrl, role: "guest", key: await importRoomKey(parsed.key) });
		this.#socket = socket;

		const welcome = Promise.withResolvers<void>();
		this.#welcomeResolve = welcome.resolve;
		this.#welcomeReject = welcome.reject;
		socket.onOpen = () => {
			this.#welcomed = false;
			this.#challengeId = null;
			this.#rejectPending("connection lost before command result");
			this.#options.onStatus?.(this.state ? "Collab transport reconnected; authenticating" : "Authenticating collab link");
		};
		socket.onChallenge = frame => void this.#answerChallenge(frame);
		socket.onFrame = frame => this.#handleHostFrame(frame);
		socket.onClose = (reason, willReconnect) => {
			this.#welcomed = false;
			this.#challengeId = null;
			this.#rejectPending(`collab disconnected: ${reason}`);
			if (!this.state && !willReconnect) this.#welcomeReject?.(new Error(reason));
			this.#options.onStatus?.(willReconnect ? `Collab connection lost (${reason}); reconnecting` : `Collab ended (${reason})`);
		};
		socket.connect();

		const timer = setTimeout(() => welcome.reject(new Error("timed out waiting for the host welcome")), WELCOME_TIMEOUT_MS);
		try {
			await welcome.promise;
		} catch (error) {
			this.#left = true;
			socket.close();
			this.#socket = null;
			throw error;
		} finally {
			clearTimeout(timer);
			this.#welcomeResolve = null;
			this.#welcomeReject = null;
	}
	}

	leave(_reason = "left"): void {
		if (this.#left) return;
		this.#left = true;
		if (this.state) this.#socket?.send({ t: "detach" });
		this.#socket?.close();
		this.#socket = null;
		this.#challengeId = null;
		this.#rejectPending("collab guest left");
	}

	sendCommand(command: JsonValue, requestId = crypto.randomUUID()): Promise<JsonValue | undefined> {
		if (this.state?.capability !== "controller" || this.state.controllerEpoch === undefined) {
			return Promise.reject(new Error("collab guest does not hold controller capability"));
		}
		return this.#request({ t: "command", requestId, command });
	}

	acquireController(requestId = crypto.randomUUID()): Promise<JsonValue | undefined> {
		return this.#request({ t: "acquireController", requestId });
	}

	releaseController(requestId = crypto.randomUUID()): Promise<JsonValue | undefined> {
		const epoch = this.state?.controllerEpoch;
		if (epoch === undefined) return Promise.reject(new Error("collab guest does not hold controller capability"));
		return this.#request({ t: "releaseController", requestId, controllerEpoch: epoch });
	}

	async #answerChallenge(challenge: CollabChallengeFrame): Promise<void> {
		const socket = this.#socket;
		const roomKey = this.#roomKey;
		if (!socket || !roomKey || this.#left) return;
		this.#challengeId = challenge.challengeId;
		socket.beginConnection(challenge.challengeId);
		const attach: GuestFrame = {
			t: "attach",
			proto: COLLAB_PROTO,
			clientId: this.clientId,
			viewId: this.viewId,
			requestedCapability: this.#requestedCapability,
			writeToken: this.#writeToken,
			challengeId: challenge.challengeId,
			challengeResponse: await createChallengeResponse(
				roomKey,
				challenge.challengeId,
				challenge.challenge,
				this.clientId,
				this.#requestedCapability,
			),
			afterSequence: this.state?.snapshot.runnerSequence,
		};
		if (!socket.send(attach)) this.#options.onError?.("Collab attach could not be sent");
	}

	#handleHostFrame(frame: GuestFrame | HostFrame): void {
		if (this.#left) return;
		switch (frame.t) {
			case "welcome": {
				if (frame.connectionId !== this.#challengeId || frame.viewId !== this.viewId) {
					this.#socket?.close();
					this.#welcomeReject?.(new Error("host welcome did not match the authenticated attach"));
					return;
				}
				this.state = {
					connectionId: frame.connectionId,
					viewId: frame.viewId,
					capability: frame.capability,
					controllerEpoch: frame.controllerEpoch,
					snapshot: frame.snapshot,
					deltas: [],
				};
				this.#welcomed = true;
				this.#options.onState?.(this.state);
				this.#options.onStatus?.("Joined collab session");
				this.#welcomeResolve?.();
				return;
			}
			case "delta":
				if (!this.state) return;
				this.state = { ...this.state, deltas: [...this.state.deltas, frame.delivery] };
				this.#options.onState?.(this.state);
				return;
			case "resync":
				if (!this.state) return;
				this.state = { ...this.state, snapshot: frame.snapshot, deltas: [] };
				this.#options.onState?.(this.state);
				return;
			case "controllerChanged":
				if (!this.state) return;
				this.state = { ...this.state, capability: frame.capability, controllerEpoch: frame.controllerEpoch };
				this.#options.onState?.(this.state);
				return;
			case "commandResult": {
				const pending = this.#pending.get(frame.requestId);
				if (!pending) return;
				this.#pending.delete(frame.requestId);
				if (frame.ok) pending.resolve(frame.receipt);
				else pending.reject(new Error(frame.error?.message ?? frame.error?.code ?? "collab command failed"));
				return;
			}
			case "error":
				if (frame.requestId) {
					const pending = this.#pending.get(frame.requestId);
					if (pending) {
						this.#pending.delete(frame.requestId);
						pending.reject(new Error(frame.message));
						return;
					}
				}
				this.#options.onError?.(frame.message);
				return;
			case "bye":
				this.#options.onStatus?.(`Collab ended (${frame.reason})`);
				this.leave(frame.reason);
				return;
			default:
				return;
		}
	}

	#request(frame: Extract<GuestFrame, { requestId: string }>): Promise<JsonValue | undefined> {
		if (!this.#welcomed || !this.state || !this.#socket) {
			return Promise.reject(new Error("collab guest has not received welcome for this connection"));
		}
		if (this.#pending.has(frame.requestId)) return Promise.reject(new Error("duplicate collab request id"));
		const result = Promise.withResolvers<JsonValue | undefined>();
		this.#pending.set(frame.requestId, result);
		if (!this.#socket.send(frame)) {
			this.#pending.delete(frame.requestId);
			result.reject(new Error("collab transport is not ready"));
		}
		return result.promise;
	}

	#rejectPending(reason: string): void {
		for (const pending of this.#pending.values()) pending.reject(new Error(reason));
		this.#pending.clear();
	}
}
