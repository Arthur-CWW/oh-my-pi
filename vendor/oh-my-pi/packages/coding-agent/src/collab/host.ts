/** SessionRunner-backed collaboration protocol v2 host. */
import { randomUUID } from "node:crypto";
import * as os from "node:os";
import { logger } from "@oh-my-pi/pi-utils";
import { Effect, Scope } from "effect";
import type {
	ControllerSessionRunnerView,
	RunnerFailure,
	RunnerSubscription,
	SessionRunner,
	SessionRunnerView,
} from "../runner/session-runner";
import { RUNNER_SCHEMA_VERSION, type SessionRunnerSnapshot } from "../runner/protocol";
import {
	ChallengeVerifier,
	generateRoomKey,
	generateWriteToken,
	importRoomKey,
	timingSafeEqual,
} from "./crypto";
import {
	type CollabAttachFrame,
	type CollabRunnerSnapshot,
	type GuestFrame,
	type HostFrame,
	formatCollabLink,
	formatCollabWebLink,
	generateRoomId,
	parseCollabLink,
} from "./protocol";
import { CollabSocket } from "./relay-client";

const CONNECT_TIMEOUT_MS = 15_000;
const CHALLENGE_TTL_MS = 15_000;

export interface CollabHostOptions {
	readonly displayName?: string;
	readonly showStatus?: (message: string) => void;
	readonly emitNotice?: (severity: "warning" | "info", message: string) => void;
}

export interface CollabParticipant {
	readonly name: string;
	readonly role: "host" | "guest";
	readonly readOnly?: boolean;
}

type HostScope = ReturnType<typeof Scope.makeUnsafe>;

interface PeerAttachment {
	readonly peerId: number;
	readonly clientId: string;
	readonly connectionId: string;
	readonly scope: HostScope;
	view: SessionRunnerView;
	subscription: RunnerSubscription;
	closed: boolean;
}

/** Display name helper retained for callers without importing interactive-mode authority. */
export function collabDisplayName(source?: { readonly settings?: { get(key: string): unknown } }): string {
	const configured = source?.settings?.get("collab.displayName");
	if (typeof configured === "string" && configured.trim()) return configured.trim();
	try {
		return os.userInfo().username;
	} catch {
		return "anonymous";
	}
}

export class CollabHost {
	readonly #runner: SessionRunner;
	readonly #options: CollabHostOptions;
	readonly #peers = new Map<number, PeerAttachment>();
	readonly #clientPeers = new Map<string, number>();
	readonly #peerChallenges = new Map<number, string>();
	#socket: CollabSocket | null = null;
	#challenges: ChallengeVerifier | null = null;
	#writeToken: Uint8Array | null = null;
	#link = "";
	#webLink = "";
	#viewLink = "";
	#webViewLink = "";
	#stopped = false;

	constructor(runner: SessionRunner, options: CollabHostOptions = {}) {
		this.#runner = runner;
		this.#options = options;
	}

	get link(): string { return this.#link; }
	get webLink(): string { return this.#webLink; }
	get viewLink(): string { return this.#viewLink; }
	get webViewLink(): string { return this.#webViewLink; }

	get participants(): CollabParticipant[] {
		const participants: CollabParticipant[] = [{ name: this.#options.displayName ?? collabDisplayName(), role: "host" }];
		for (const peer of this.#peers.values()) {
			participants.push({ name: peer.clientId, role: "guest", readOnly: peer.view.capability === "observer" || undefined });
		}
		return participants;
	}

	async start(relayUrl: string): Promise<void> {
		if (this.#socket) throw new Error("Collaboration host is already started");
		this.#stopped = false;
		const rawKey = generateRoomKey();
		const writeToken = generateWriteToken();
		const roomId = generateRoomId();
		this.#writeToken = writeToken;
		this.#challenges = new ChallengeVerifier(rawKey);
		this.#link = formatCollabLink(relayUrl, roomId, rawKey, writeToken);
		this.#webLink = formatCollabWebLink(relayUrl, roomId, rawKey, writeToken);
		this.#viewLink = formatCollabLink(relayUrl, roomId, rawKey);
		this.#webViewLink = formatCollabWebLink(relayUrl, roomId, rawKey);
		const parsed = parseCollabLink(this.#link);
		if ("error" in parsed) throw new Error(parsed.error);
		const socket = new CollabSocket({ wsUrl: parsed.wsUrl, role: "host", key: await importRoomKey(rawKey) });
		this.#socket = socket;
		const firstOpen = Promise.withResolvers<void>();
		let opened = false;
		socket.onOpen = () => {
			if (!opened) { opened = true; firstOpen.resolve(); }
		};
		socket.onControl = control => {
			if (control.t === "peer-joined") this.#issueChallenge(control.peer);
			else if (control.t === "peer-left") void this.#detachPeer(control.peer);
		};
		socket.onFrame = (frame, peerId) => void this.#handleFrame(frame as GuestFrame, peerId);
		socket.onClose = (reason, reconnecting) => {
			if (this.#stopped) return;
			void this.#detachAll();
			if (!opened) firstOpen.reject(new Error(reason));
			else if (reconnecting) this.#options.showStatus?.(`Collab relay connection lost (${reason}), reconnecting…`);
			else this.#options.emitNotice?.("warning", `Collab ended: ${reason}`);
		};
		socket.connect();
		const timeout = setTimeout(() => firstOpen.reject(new Error("timed out connecting to relay")), CONNECT_TIMEOUT_MS);
		try { await firstOpen.promise; }
		catch (error) { socket.close(); this.#socket = null; throw error; }
		finally { clearTimeout(timeout); }
	}

	async stop(): Promise<void> {
		if (this.#stopped) return;
		this.#stopped = true;
		for (const peer of this.#peers.values()) this.#send(peer.peerId, { t: "bye", reason: "host stopped" });
		await this.#detachAll();
		this.#socket?.close();
		this.#socket = null;
		this.#challenges = null;
		this.#peerChallenges.clear();
		this.#writeToken = null;
	}

	#issueChallenge(peerId: number): void {
		const verifier = this.#challenges;
		const socket = this.#socket;
		if (!verifier || !socket || this.#stopped) return;
		void this.#detachPeer(peerId).finally(() => {
			const previousChallenge = this.#peerChallenges.get(peerId);
			if (previousChallenge) verifier.discard(previousChallenge);
			const challenge = verifier.issue(CHALLENGE_TTL_MS);
			this.#peerChallenges.set(peerId, challenge.challengeId);
			socket.beginConnection(challenge.challengeId, peerId);
			socket.sendChallenge({ t: "challenge", proto: 2, ...challenge }, peerId);
		});
	}

	async #handleFrame(frame: GuestFrame, peerId: number): Promise<void> {
		try {
			if (frame.t === "attach") { await this.#attach(frame, peerId); return; }
			const peer = this.#peers.get(peerId);
			if (!peer || peer.closed) { this.#send(peerId, { t: "error", code: "notAttached", message: "Peer is not attached" }); return; }
			switch (frame.t) {
				case "detach": await this.#detachPeer(peerId); return;
				case "resyncRequest": await this.#sendSnapshot(peer, "resync", frame.afterSequence); return;
				case "acquireController": await this.#acquireController(peer, frame.requestId); return;
				case "releaseController": await this.#releaseController(peer, frame.requestId, frame.controllerEpoch); return;
				case "command": await this.#dispatchCommand(peer, frame.requestId, frame.command); return;
			}
		} catch (error) {
			logger.debug("collab host frame failed", { peerId, error: String(error) });
			this.#send(peerId, { t: "error", code: publicErrorCode(error), message: publicErrorMessage(error) });
		}
	}

	async #attach(frame: CollabAttachFrame, peerId: number): Promise<void> {
		if (this.#peers.has(peerId)) throw new Error("Peer is already attached");
		const verifier = this.#challenges;
		if (!verifier) throw new Error("Host is not accepting attachments");
		await verifier.consume(
			frame.challengeId,
			frame.challengeResponse,
			frame.clientId,
			frame.requestedCapability,
		);
		this.#peerChallenges.delete(peerId);
		const connectionId = frame.challengeId;
		this.#validateCapability(frame);
		const previousPeer = this.#clientPeers.get(frame.clientId);
		if (previousPeer !== undefined && previousPeer !== peerId) await this.#detachPeer(previousPeer);
		const scope = Scope.makeUnsafe("sequential");
		const run = this.#run(scope);
		try {
			const snapshot = await run(this.#runner.snapshot());
			const commandId = randomUUID();
			const view = await run(this.#runner.attachView({
				schemaVersion: RUNNER_SCHEMA_VERSION,
				kind: "attachView",
				commandId,
				correlationId: commandId,
				expectedRevision: snapshot.revision,
				viewId: frame.viewId,
				capability: frame.requestedCapability,
			}));
			const subscription = await run(view.subscribe());
			const peer: PeerAttachment = { peerId, clientId: frame.clientId, connectionId, scope, view, subscription, closed: false };
			this.#peers.set(peerId, peer);
			this.#clientPeers.set(frame.clientId, peerId);
			const attachedSnapshot = await run(view.snapshot());
			this.#send(peerId, {
				t: "welcome", connectionId, viewId: view.viewId, capability: view.capability,
				controllerEpoch: view.capability === "controller" ? view.controllerEpoch : undefined,
				snapshot: projectSnapshot(attachedSnapshot), sequence: attachedSnapshot.sequence,
			});
			void this.#drain(peer);
		} catch (error) {
			await Effect.runPromise(Scope.close(scope, { _tag: "Failure", cause: error } as never)).catch(() => undefined);
			throw error;
		}
	}

	#validateCapability(frame: CollabAttachFrame): void {
		const supplied = frame.writeToken;
		if (frame.requestedCapability === "observer") {
			if (supplied !== undefined) throw new Error("Observer attach must not include a write token");
			return;
		}
		const expected = this.#writeToken;
		if (!expected || !supplied) throw new Error("Controller authentication failed");
		let decoded: Uint8Array;
		try { decoded = Buffer.from(supplied, "base64url"); }
		catch { throw new Error("Controller authentication failed"); }
		if (!timingSafeEqual(decoded, expected)) throw new Error("Controller authentication failed");
	}

	async #drain(peer: PeerAttachment): Promise<void> {
		const run = this.#run(peer.scope);
		try {
			while (!peer.closed) {
				const delivery = await run(peer.subscription.take);
				if (delivery.kind === "resyncRequired") {
					this.#send(peer.peerId, {
						t: "resync", snapshot: projectSnapshot(delivery.snapshot),
						expectedSequence: delivery.expectedSequence, observedSequence: delivery.observedSequence,
					});
				} else {
					this.#send(peer.peerId, { t: "delta", delivery: { kind: "event", event: delivery.event as never } });
				}
			}
		} catch (error) {
			if (!peer.closed) {
				logger.debug("collab runner subscription ended", { peerId: peer.peerId, error: String(error) });
				await this.#detachPeer(peer.peerId);
			}
		}
	}

	async #sendSnapshot(peer: PeerAttachment, kind: "resync", observedSequence: number): Promise<void> {
		const snapshot = await this.#run(peer.scope)(peer.view.snapshot());
		this.#send(peer.peerId, {
			t: kind,
			snapshot: projectSnapshot(snapshot),
			expectedSequence: snapshot.sequence,
			observedSequence,
		});
	}

	async #acquireController(peer: PeerAttachment, requestId: string): Promise<void> {
		if (peer.view.capability !== "observer") return this.#commandError(peer.peerId, requestId, "alreadyController", "Peer already controls the session");
		const snapshot = await this.#run(peer.scope)(peer.view.snapshot());
		const commandId = randomUUID();
		peer.view = await this.#run(peer.scope)(peer.view.acquireController({
			schemaVersion: RUNNER_SCHEMA_VERSION, kind: "acquireController", commandId, correlationId: requestId,
			expectedRevision: snapshot.revision, viewId: peer.view.viewId,
		}));
		this.#send(peer.peerId, { t: "controllerChanged", capability: "controller", controllerEpoch: peer.view.controllerEpoch });
		this.#commandOk(peer.peerId, requestId, { capability: "controller", controllerEpoch: peer.view.controllerEpoch });
	}

	async #releaseController(peer: PeerAttachment, requestId: string, controllerEpoch: number): Promise<void> {
		if (peer.view.capability !== "controller") return this.#commandError(peer.peerId, requestId, "observer", "Peer does not control the session");
		const snapshot = await this.#run(peer.scope)(peer.view.snapshot());
		const commandId = randomUUID();
		peer.view = await this.#run(peer.scope)(peer.view.releaseController({
			schemaVersion: RUNNER_SCHEMA_VERSION, kind: "releaseController", commandId, correlationId: requestId,
			expectedRevision: snapshot.revision, viewId: peer.view.viewId, controllerEpoch,
		}));
		this.#send(peer.peerId, { t: "controllerChanged", capability: "observer" });
		this.#commandOk(peer.peerId, requestId, { capability: "observer" });
	}

	async #dispatchCommand(peer: PeerAttachment, requestId: string, input: unknown): Promise<void> {
		if (peer.view.capability !== "controller") return this.#commandError(peer.peerId, requestId, "observer", "Observer views cannot mutate the session");
		if (!isCommand(input)) return this.#commandError(peer.peerId, requestId, "invalidCommand", "Invalid runner command");
		if (input.viewId !== peer.view.viewId || input.controllerEpoch !== peer.view.controllerEpoch) {
			return this.#commandError(peer.peerId, requestId, "staleController", "Command controller lease does not match this attachment");
		}
		const method = controllerMethod(peer.view, input.kind);
		if (!method) return this.#commandError(peer.peerId, requestId, "unsupportedCommand", "Unsupported runner command");
		try { this.#commandOk(peer.peerId, requestId, await this.#run(peer.scope)(method(input))); }
		catch (error) { this.#commandError(peer.peerId, requestId, publicErrorCode(error), publicErrorMessage(error)); }
	}

	async #detachPeer(peerId: number): Promise<void> {
		const challengeId = this.#peerChallenges.get(peerId);
		if (challengeId) this.#challenges?.discard(challengeId);
		this.#peerChallenges.delete(peerId);
		this.#socket?.forgetPeer(peerId);
		const peer = this.#peers.get(peerId);
		if (!peer || peer.closed) return;
		peer.closed = true;
		this.#peers.delete(peerId);
		if (this.#clientPeers.get(peer.clientId) === peerId) this.#clientPeers.delete(peer.clientId);
		try {
			const snapshot = await this.#run(peer.scope)(peer.view.snapshot());
			const commandId = randomUUID();
			await this.#run(peer.scope)(peer.view.detach({
				schemaVersion: RUNNER_SCHEMA_VERSION, kind: "detachView", commandId, correlationId: commandId,
				expectedRevision: snapshot.revision, viewId: peer.view.viewId,
				controllerEpoch: peer.view.capability === "controller" ? peer.view.controllerEpoch : undefined,
			}));
		} catch (error) { logger.debug("collab peer detach failed", { peerId, error: String(error) }); }
		finally { await Effect.runPromise(Scope.close(peer.scope, { _tag: "Success", value: undefined } as never)).catch(() => undefined); }
	}

	async #detachAll(): Promise<void> {
		await Promise.all([...this.#peers.keys()].map(peerId => this.#detachPeer(peerId)));
	}

	#send(peerId: number, frame: HostFrame): void { this.#socket?.send(frame, peerId); }
	#commandOk(peerId: number, requestId: string, receipt: unknown): void {
		this.#send(peerId, { t: "commandResult", requestId, ok: true, receipt: receipt as never });
	}
	#commandError(peerId: number, requestId: string, code: string, message: string): void {
		this.#send(peerId, { t: "commandResult", requestId, ok: false, error: { code, message } });
	}
	#run(scope: HostScope) {
		return <A>(effect: Effect.Effect<A, RunnerFailure, Scope.Scope>): Promise<A> => Effect.runPromise(Scope.provide(scope)(effect));
	}
}

function projectSnapshot(snapshot: SessionRunnerSnapshot): CollabRunnerSnapshot {
	const activeOperations = [snapshot.activeCompaction, snapshot.activeLocalOperation, snapshot.activeEphemeralTurn].filter(
		(value): value is NonNullable<typeof value> => value !== undefined,
	);
	let model: { readonly model: string; readonly role?: string } | null = null;
	for (let index = snapshot.transcript.entries.length - 1; index >= 0; index--) {
		const entry = snapshot.transcript.entries[index]!;
		if (entry.type === "model_change") {
			model = { model: entry.model, role: entry.role };
			break;
		}
	}
	return {
		revision: snapshot.revision,
		runnerSequence: snapshot.sequence,
		sessionRevision: snapshot.sessionRevision,
		transcript: snapshot.transcript.entries as never,
		durableInputs: snapshot.items as never,
		activeOperations: activeOperations as never,
		workflow: snapshot.workflow as never,
		tools: { generation: snapshot.toolConfigurationGeneration, activeNames: snapshot.activeToolNames } as never,
		todos: { generation: snapshot.todoGeneration } as never,
		model,
		session: {
			header: snapshot.transcript.header,
			status: snapshot.status,
			pendingOperations: snapshot.pendingOperations,
		} as never,
	};
}

function isCommand(input: unknown): input is {
	readonly kind: string;
	readonly viewId?: unknown;
	readonly controllerEpoch?: unknown;
} {
	return typeof input === "object" && input !== null && typeof (input as { kind?: unknown }).kind === "string";
}

function controllerMethod(
	view: ControllerSessionRunnerView,
	kind: string,
): ((input: unknown) => Effect.Effect<unknown, RunnerFailure, Scope.Scope>) | undefined {
	const methods: Record<string, (input: unknown) => Effect.Effect<unknown, RunnerFailure, Scope.Scope>> = {
		submitInput: view.submitInput,
		submitCustomMessage: view.submitCustomMessage,
		editQueuedInput: view.editQueuedInput,
		cancelQueuedInput: view.cancelQueuedInput,
		setActiveTools: view.setActiveTools,
		replaceTodos: input => view.replaceTodos(input as never),
		refreshSshTool: input => view.refreshSshTool(input as never),
		setModel: view.setModel,
		setThinkingLevel: view.setThinkingLevel,
		transitionPlanMode: view.transitionPlanMode,
		transitionGoalMode: view.transitionGoalMode,
		runCompaction: input => view.compact(input as never),
		cancelCompaction: input => view.cancelCompaction(input as never),
		runEphemeralTurn: input => view.runEphemeralTurn(input as never),
		cancelEphemeralTurn: input => view.cancelEphemeralTurn(input as never),
		runLocalOperation: input => view.runLocalOperation(input as never),
		cancelLocalOperation: input => view.cancelLocalOperation(input as never),
		interruptPrompt: input => view.interruptPrompt(input as never),
	};
	return methods[kind];
}

function publicErrorCode(error: unknown): string {
	if (typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string") return error._tag;
	return "collabError";
}
function publicErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return "Collaboration request failed";
}
