import type {
	AgentSnapshot,
	AssistantMessage,
	CollabCapability,
	CollabChallengeFrame,
	CollabRunnerEventDelivery,
	CollabRunnerSnapshot,
	HostFrame,
	JsonValue,
	SessionEntry,
	SessionHeader,
	SessionState,
	SubagentLifecyclePayload,
	SubagentProgressPayload,
} from "@oh-my-pi/pi-wire";
import { COLLAB_PROTO } from "@oh-my-pi/pi-wire";
import { importRoomKey } from "./codec";
import { encodeBase64Url, parseCollabLink } from "./link";
import { CollabSocket } from "./socket";

export type ConnectionPhase = "connecting" | "waiting" | "live" | "reconnecting" | "ended";
export interface ActiveTool {
	toolCallId: string;
	toolName: string;
	args: unknown;
	intent?: string;
	partialResult?: unknown;
	startedAt: number;
}
export interface Notice {
	id: number;
	level: "info" | "warning" | "error";
	message: string;
	at: number;
}
export interface GuestSnapshot {
	readonly phase: ConnectionPhase;
	readonly endedReason: string | null;
	readonly runner: CollabRunnerSnapshot | null;
	readonly capability: CollabCapability | null;
	readonly controllerEpoch: number | null;
	readonly header: SessionHeader | null;
	readonly entries: readonly SessionEntry[];
	readonly state: SessionState | null;
	readonly agents: readonly AgentSnapshot[];
	readonly progress: ReadonlyMap<string, SubagentProgressPayload>;
	readonly lifecycle: ReadonlyMap<string, SubagentLifecyclePayload>;
	readonly stream: AssistantMessage | null;
	readonly streamDone: boolean;
	readonly activeTools: ReadonlyMap<string, ActiveTool>;
	readonly working: boolean;
	readonly readOnly: boolean;
	readonly notices: readonly Notice[];
}
export type DeltaReduction =
	| { readonly kind: "applied" | "duplicate"; readonly snapshot: CollabRunnerSnapshot }
	| { readonly kind: "gap"; readonly expectedSequence: number; readonly observedSequence: number };

function record(value: JsonValue): Readonly<Record<string, JsonValue>> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Readonly<Record<string, JsonValue>>)
		: null;
}

/** Pure contiguous runner projection reducer. */
export function reduceRunnerDelta(snapshot: CollabRunnerSnapshot, delivery: CollabRunnerEventDelivery): DeltaReduction {
	const event = record(delivery.event);
	const observedSequence = typeof event?.sequence === "number" ? event.sequence : Number.NaN;
	const expectedSequence = snapshot.runnerSequence + 1;
	if (!Number.isSafeInteger(observedSequence) || observedSequence < 1 || observedSequence > expectedSequence)
		return { kind: "gap", expectedSequence, observedSequence };
	if (observedSequence <= snapshot.runnerSequence) return { kind: "duplicate", snapshot };
	let transcript = snapshot.transcript;
	if (event?.kind === "transcriptEntryAppended" && event.transcriptEntry !== undefined) {
		transcript = [...(Array.isArray(transcript) ? transcript : []), event.transcriptEntry];
	}
	const field = (key: keyof CollabRunnerSnapshot, fallback: JsonValue): JsonValue => event?.[key] ?? fallback;
	return {
		kind: "applied",
		snapshot: {
			revision: typeof event?.revision === "number" ? event.revision : snapshot.revision,
			runnerSequence: observedSequence,
			sessionRevision: typeof event?.sessionRevision === "number" ? event.sessionRevision : snapshot.sessionRevision,
			transcript,
			durableInputs: field("durableInputs", snapshot.durableInputs) as readonly JsonValue[],
			activeOperations: field("activeOperations", snapshot.activeOperations) as readonly JsonValue[],
			workflow: field("workflow", snapshot.workflow),
			tools: field("tools", snapshot.tools),
			todos: field("todos", snapshot.todos),
			model: field("model", snapshot.model),
			session: field("session", snapshot.session),
		},
	};
}

interface PendingCommand {
	resolve(value: JsonValue): void;
	reject(reason: Error): void;
}
const EMPTY_PROGRESS: ReadonlyMap<string, SubagentProgressPayload> = new Map();
const EMPTY_LIFECYCLE: ReadonlyMap<string, SubagentLifecyclePayload> = new Map();
const EMPTY_TOOLS: ReadonlyMap<string, ActiveTool> = new Map();

export class GuestClient {
	readonly #socket: CollabSocket;
	readonly #keyPromise: Promise<CryptoKey>;
	readonly #writeToken: string | undefined;
	readonly #rawKey: Uint8Array;
	readonly #clientId = crypto.randomUUID();
	readonly #viewId = crypto.randomUUID();
	readonly #listeners = new Set<() => void>();
	readonly #pending = new Map<string, PendingCommand>();
	#phase: ConnectionPhase = "connecting";
	#endedReason: string | null = null;
	#runner: CollabRunnerSnapshot | null = null;
	#capability: CollabCapability | null = null;
	#controllerEpoch: number | null = null;
	#everConnected = false;
	#notices: readonly Notice[] = [];
	#noticeSequence = 0;
	#snapshot: GuestSnapshot;

	constructor(link: string, _displayName: string) {
		const parsed = parseCollabLink(link);
		if ("error" in parsed) throw new Error(parsed.error);
		this.#writeToken = parsed.writeToken ? encodeBase64Url(parsed.writeToken) : undefined;
		this.#keyPromise = importRoomKey(parsed.key);
		this.#rawKey = parsed.key;
		this.#socket = new CollabSocket({ wsUrl: parsed.wsUrl, role: "guest", key: this.#keyPromise });
		this.#socket.onOpen = () => {
			this.#phase = this.#everConnected ? "reconnecting" : "waiting";
			this.#everConnected = true;
			this.#commit();
		};
		this.#socket.onChallenge = challenge => void this.#attach(challenge);
		this.#socket.onFrame = frame => this.#applyFrame(frame);
		this.#socket.onSequenceGap = () => {
			if (this.#runner) this.#socket.send({ t: "resyncRequest", afterSequence: this.#runner.runnerSequence });
		};
		this.#socket.onControl = message => {
			if (message.t === "room-closed") this.#end("room closed");
		};
		this.#socket.onClose = (reason, reconnecting) => this.#handleClose(reason, reconnecting);
		this.#snapshot = this.#buildSnapshot();
	}

	connect(): void {
		this.#socket.connect();
	}
	close(): void {
		if (this.#socket.isOpen && this.#capability !== null) this.#socket.send({ t: "detach" });
		this.#socket.close();
		this.#end("client closed");
	}
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	getSnapshot(): GuestSnapshot {
		return this.#snapshot;
	}

	sendCommand(command: JsonValue, requestId = crypto.randomUUID()): Promise<JsonValue> {
		if (this.#capability !== "controller" || this.#controllerEpoch === null)
			return Promise.reject(new Error("controller capability is not active"));
		const { promise, resolve, reject } = Promise.withResolvers<JsonValue>();
		this.#pending.set(requestId, { resolve, reject });
		try {
			this.#socket.send({ t: "command", requestId, command });
		} catch (error) {
			this.#pending.delete(requestId);
			reject(error instanceof Error ? error : new Error(String(error)));
		}
		return promise;
	}

	async setModel(provider: string, id: string): Promise<JsonValue> {
		if (!this.#runner || this.#controllerEpoch === null) throw new Error("controller capability is not active");
		if (!provider || !id) throw new Error("provider and model id are required");
		const commandId = crypto.randomUUID();
		return this.sendCommand({
			schemaVersion: 1,
			kind: "setModel",
			commandId,
			correlationId: commandId,
			expectedSessionRevision: this.#runner.sessionRevision,
			viewId: this.#viewId,
			controllerEpoch: this.#controllerEpoch,
			payload: { provider, id },
		});
	}
	sendPrompt(text: string): void {
		if (!this.#runner || this.#controllerEpoch === null) return;
		const commandId = crypto.randomUUID();
		void this.sendCommand({
			schemaVersion: 1,
			kind: "submitInput",
			commandId,
			correlationId: commandId,
			expectedRevision: this.#runner.revision,
			viewId: this.#viewId,
			controllerEpoch: this.#controllerEpoch,
			payload: { text, deliveryClass: "followUp" },
		}).catch(error => this.#notice("error", error.message));
	}
	interruptPrompt(): void {
		if (!this.#runner || this.#controllerEpoch === null) return;
		const session = record(this.#runner.session);
		const promptOperation = session ? record(session.promptOperation) : null;
		const targetGeneration = promptOperation?.generation;
		if (typeof targetGeneration !== "number" || !Number.isSafeInteger(targetGeneration)) return;
		const commandId = crypto.randomUUID();
		void this.sendCommand({
			schemaVersion: 1,
			kind: "interruptPrompt",
			commandId,
			correlationId: commandId,
			viewId: this.#viewId,
			controllerEpoch: this.#controllerEpoch,
			targetGeneration,
		}).catch(error => this.#notice("error", error.message));
	}
	applyFrameForTest(frame: HostFrame): void {
		this.#applyFrame(frame);
	}

	async #attach(challenge: CollabChallengeFrame): Promise<void> {
		const requestedCapability: CollabCapability = this.#writeToken ? "controller" : "observer";
		const canonical = `${challenge.challengeId.length}:${challenge.challengeId}${challenge.challenge.length}:${challenge.challenge}${this.#clientId.length}:${this.#clientId}${requestedCapability}`;
		const hmacKey = await crypto.subtle.importKey(
			"raw",
			new Uint8Array(this.#rawKey),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const response = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(canonical)));
		this.#socket.activateConnection(challenge.challengeId);
		this.#socket.sendAttach({
			t: "attach",
			proto: COLLAB_PROTO,
			clientId: this.#clientId,
			viewId: this.#viewId,
			requestedCapability,
			writeToken: this.#writeToken,
			challengeId: challenge.challengeId,
			challengeResponse: encodeBase64Url(response),
			afterSequence: this.#runner?.runnerSequence,
		});
	}

	#applyFrame(frame: HostFrame): void {
		switch (frame.t) {
			case "welcome":
				this.#runner = frame.snapshot;
				this.#capability = frame.capability;
				this.#controllerEpoch = frame.capability === "controller" ? (frame.controllerEpoch ?? null) : null;
				this.#phase = "live";
				this.#endedReason = null;
				break;
			case "delta": {
				if (!this.#runner) break;
				const reduced = reduceRunnerDelta(this.#runner, frame.delivery);
				if (reduced.kind === "gap")
					this.#socket.send({ t: "resyncRequest", afterSequence: this.#runner.runnerSequence });
				else this.#runner = reduced.snapshot;
				break;
			}
			case "resync":
				this.#runner = frame.snapshot;
				break;
			case "controllerChanged":
				this.#capability = frame.capability;
				this.#controllerEpoch = frame.capability === "controller" ? (frame.controllerEpoch ?? null) : null;
				break;
			case "commandResult": {
				const pending = this.#pending.get(frame.requestId);
				if (!pending) break;
				this.#pending.delete(frame.requestId);
				if (frame.ok) pending.resolve(frame.receipt ?? null);
				else pending.reject(new Error(frame.error?.message ?? "runner command failed"));
				break;
			}
			case "error": {
				if (frame.requestId) {
					const pending = this.#pending.get(frame.requestId);
					if (pending) {
						this.#pending.delete(frame.requestId);
						pending.reject(new Error(frame.message));
					}
				}
				this.#notice("error", frame.message);
				return;
			}
			case "bye":
				this.#end(frame.reason);
				return;
		}
		this.#commit();
	}
	#handleClose(reason: string, reconnecting: boolean): void {
		for (const pending of this.#pending.values())
			pending.reject(new Error("connection closed before command result"));
		this.#pending.clear();
		this.#capability = null;
		this.#controllerEpoch = null;
		if (reconnecting) {
			this.#phase = "reconnecting";
			this.#commit();
		} else this.#end(reason);
	}
	#end(reason: string): void {
		this.#phase = "ended";
		this.#endedReason = reason;
		this.#capability = null;
		this.#controllerEpoch = null;
		this.#commit();
	}
	#notice(level: Notice["level"], message: string): void {
		this.#notices = [...this.#notices.slice(-48), { id: ++this.#noticeSequence, level, message, at: Date.now() }];
		this.#commit();
	}
	#buildSnapshot(): GuestSnapshot {
		const session = this.#runner ? record(this.#runner.session) : null;
		const transcript = this.#runner?.transcript;
		return {
			phase: this.#phase,
			endedReason: this.#endedReason,
			runner: this.#runner,
			capability: this.#capability,
			controllerEpoch: this.#controllerEpoch,
			header: (session?.header as SessionHeader | undefined) ?? null,
			entries: (Array.isArray(transcript) ? transcript : []) as readonly SessionEntry[],
			state: (session?.state as SessionState | undefined) ?? null,
			agents: (Array.isArray(session?.agents) ? session.agents : []) as unknown as readonly AgentSnapshot[],
			progress: EMPTY_PROGRESS,
			lifecycle: EMPTY_LIFECYCLE,
			stream: null,
			streamDone: false,
			activeTools: EMPTY_TOOLS,
			working: session?.isStreaming === true,
			readOnly: this.#capability !== "controller",
			notices: this.#notices,
		};
	}
	#commit(): void {
		this.#snapshot = this.#buildSnapshot();
		for (const listener of this.#listeners) listener();
	}
}
