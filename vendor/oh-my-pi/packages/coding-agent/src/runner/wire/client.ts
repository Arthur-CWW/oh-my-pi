import { randomUUID } from "node:crypto";
import * as net from "node:net";
import type { Schema } from "effect";
import type {
	TerminalSessionAttachRequest,
	TerminalSessionAttachment,
	TerminalSessionCommand,
	TerminalSessionCommandResultFor,
	TerminalSessionDeliveryListener,
	TerminalSessionRequestArguments,
	TerminalSessionRequestOperation,
	TerminalSessionRequestResult,
	TerminalSessionTransport,
} from "../terminal-session-transport";
import type { TerminalSessionDelivery, TerminalSessionSnapshot } from "../terminal-session-view";
import type { ProtocolRange } from "./common";
import { DEFAULT_MAX_WIRE_FRAME_BYTES, IncrementalWireFrameDecoder, encodeLengthPrefixedWireFrame } from "./codec";
import {
	WireDecodeError,
	WireFrameOversizeError,
	WireHelloRejectedError,
	WireResyncRequiredError,
	type WireErrorEnvelope,
} from "./errors";
import type {
	ClientHelloFrame,
	EventFrame,
	RequestFrame,
	ResyncRequiredFrame,
	ServerHelloFrame,
	WireFrame,
} from "./frames";
import { decodeEventFrame, decodeResponseFrame, decodeServerHelloFrame, decodeResyncRequiredFrame } from "./frames";

type JsonValue = typeof Schema.Json.Type;

export type TerminalSessionWireClientHello = Omit<ClientHelloFrame, "kind" | "correlationId">;

export interface UnixSocketTerminalSessionTransportOptions {
	readonly socketPath: string;
	readonly hello: TerminalSessionWireClientHello;
	readonly maxFrameBytes?: number;
	readonly requestTimeoutMs?: number;
	readonly reconnectAttempts?: number;
}

export class TerminalSessionWireConnectionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TerminalSessionWireConnectionError";
	}
}

interface PendingRequest {
	readonly correlationId: string;
	readonly resolve: (value: JsonValue) => void;
	readonly reject: (error: unknown) => void;
	readonly timeout: NodeJS.Timeout;
}

interface AttachmentState {
	readonly request: TerminalSessionAttachRequest;
	viewId: string;
	epoch: number;
	detached: boolean;
	resyncing: boolean;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
	if (value === undefined) return null;
	const encoded = JSON.stringify(value);
	if (encoded === undefined) return null;
	return JSON.parse(encoded) as JsonValue;
}

function decodeAttachmentIdentity(value: JsonValue): { readonly viewId: string; readonly epoch: number } {
	if (
		!isRecord(value) ||
		typeof value.viewId !== "string" ||
		value.viewId.length === 0 ||
		!Number.isInteger(value.epoch) ||
		(value.epoch as number) < 0
	) {
		throw new WireDecodeError({
			message: "Invalid attachTerminalView response",
			frameKind: "response",
			byteLength: 0,
		});
	}
	return { viewId: value.viewId, epoch: value.epoch as number };
}

function decodeSnapshot(value: JsonValue): TerminalSessionSnapshot {
	if (!isRecord(value) || !Number.isInteger(value.terminalSequence) || (value.terminalSequence as number) < 0) {
		throw new WireDecodeError({
			message: "Invalid terminalSnapshot response",
			frameKind: "response",
			byteLength: 0,
		});
	}
	return value as unknown as TerminalSessionSnapshot;
}

function decodeDelivery(frame: EventFrame): TerminalSessionDelivery {
	const payload = frame.payload;
	if (
		!isRecord(payload) ||
		(payload.kind !== "agentEvent" && payload.kind !== "runnerEvent") ||
		payload.kind !== frame.eventType ||
		payload.sequence !== frame.sequence
	) {
		throw new WireDecodeError({ message: "Invalid terminal event payload", frameKind: "event", byteLength: 0 });
	}
	return payload as unknown as TerminalSessionDelivery;
}

function errorFromEnvelope(envelope: WireErrorEnvelope): Error {
	switch (envelope.tag) {
		case "WireFrameOversizeError":
			return new WireFrameOversizeError({
				message: envelope.message,
				announcedByteLength: envelope.details.announcedByteLength,
				maxByteLength: envelope.details.maxByteLength,
			});
		case "WireDecodeError":
			return new WireDecodeError({
				message: envelope.message,
				frameKind: envelope.details.frameKind,
				byteLength: envelope.details.byteLength,
			});
		case "WireHelloRejectedError":
			return new WireHelloRejectedError({ message: envelope.message, reason: envelope.details.reason });
		case "WireResyncRequiredError":
			return new WireResyncRequiredError({
				message: envelope.message,
				reason: envelope.details.reason,
				expectedSequence: envelope.details.expectedSequence,
				observedSequence: envelope.details.observedSequence,
			});
	}
}

function validateServerHello(server: ServerHelloFrame, client: ClientHelloFrame): void {
	const protocol: ProtocolRange = client.protocol;
	if (
		server.correlationId !== client.correlationId ||
		server.selectedProtocol.major < protocol.minMajor ||
		server.selectedProtocol.major > protocol.maxMajor ||
		server.selectedProtocol.minor > protocol.maxMinor ||
		server.sessionId !== client.sessionId ||
		server.ownerEpoch !== client.ownerEpoch ||
		server.runnerInstanceId !== client.runnerInstanceId ||
		server.build.version !== client.build.version ||
		server.build.digest !== client.build.digest ||
		server.authority.uid !== client.authority.uid ||
		server.authority.canonicalSessionPath !== client.authority.canonicalSessionPath ||
		server.authority.namespaceDigest !== client.authority.namespaceDigest ||
		(client.requestedCapability === "observer" && server.grantedCapability !== "observer") ||
		!server.features.every(feature => client.features.includes(feature))
	) {
		throw new WireHelloRejectedError({ reason: "authority-mismatch", message: "Server hello identity is invalid" });
	}
}

class ClientConnection {
	readonly #options: UnixSocketTerminalSessionTransportOptions;
	readonly #onEvent: (event: EventFrame) => void;
	readonly #onResync: (frame: ResyncRequiredFrame) => void;
	readonly #socket: net.Socket;
	readonly #decoder: IncrementalWireFrameDecoder;
	readonly #pending = new Map<string, PendingRequest>();
	readonly #helloReady = Promise.withResolvers<void>();
	readonly #hello: ClientHelloFrame;
	#negotiated = false;
	#closed = false;

	constructor(
		options: UnixSocketTerminalSessionTransportOptions,
		onEvent: (event: EventFrame) => void,
		onResync: (frame: ResyncRequiredFrame) => void,
	) {
		this.#options = options;
		this.#onEvent = onEvent;
		this.#onResync = onResync;
		this.#socket = net.createConnection(options.socketPath);
		this.#decoder = new IncrementalWireFrameDecoder(options.maxFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES);
		this.#hello = { kind: "clientHello", correlationId: randomUUID(), ...options.hello };
		this.#socket.once("connect", () => {
			try {
				this.#socket.write(
					encodeLengthPrefixedWireFrame(this.#hello, options.maxFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES),
				);
			} catch (error) {
				this.#fail(error);
			}
		});
		this.#socket.on("data", chunk => this.#receive(chunk));
		this.#socket.once("error", error => this.#fail(error));
		this.#socket.once("close", () => this.#fail(new TerminalSessionWireConnectionError("Socket closed")));
	}

	get closed(): boolean {
		return this.#closed;
	}

	async connect(): Promise<void> {
		return this.#helloReady.promise;
	}

	close(): void {
		this.#fail(new TerminalSessionWireConnectionError("Socket closed by client"));
	}

	async request(operation: string, payload: JsonValue, correlationId: string = randomUUID()): Promise<JsonValue> {
		await this.connect();
		if (this.#closed) throw new TerminalSessionWireConnectionError("Socket is closed");
		const requestId = randomUUID();
		const result = Promise.withResolvers<JsonValue>();
		const timeout = setTimeout(() => {
			this.#pending.delete(requestId);
			const error = new TerminalSessionWireConnectionError(`Wire request timed out: ${operation}`);
			result.reject(error);
			this.#fail(error);
		}, this.#options.requestTimeoutMs ?? 5_000);
		this.#pending.set(requestId, {
			correlationId,
			resolve: result.resolve,
			reject: result.reject,
			timeout,
		});
		const frame: RequestFrame = { kind: "request", correlationId, requestId, operation, payload };
		try {
			this.#socket.write(
				encodeLengthPrefixedWireFrame(frame, this.#options.maxFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES),
			);
		} catch (error) {
			clearTimeout(timeout);
			this.#pending.delete(requestId);
			result.reject(error);
		}
		return result.promise;
	}

	#receive(chunk: Buffer | string): void {
		if (typeof chunk === "string") {
			this.#fail(new WireDecodeError({ message: "Socket delivered text data", frameKind: "unknown", byteLength: 0 }));
			return;
		}
		if (this.#closed) return;
		let frames: readonly WireFrame[];
		try {
			frames = this.#decoder.push(chunk);
		} catch (error) {
			this.#fail(error);
			return;
		}
		for (const frame of frames) {
			if (!this.#negotiated) {
				if (frame.kind !== "serverHello") {
					this.#fail(new TerminalSessionWireConnectionError("Server sent traffic before hello negotiation"));
					return;
				}
				try {
					const hello = decodeServerHelloFrame(frame);
					validateServerHello(hello, this.#hello);
					this.#negotiated = true;
					this.#helloReady.resolve();
				} catch (error) {
					this.#fail(error);
				}
				continue;
			}
			try {
				switch (frame.kind) {
					case "response": {
						const response = decodeResponseFrame(frame);
						const pending = this.#pending.get(response.requestId);
						if (!pending || pending.correlationId !== response.correlationId) {
							throw new WireDecodeError({
								message: "Response does not match a pending request",
								frameKind: "response",
								byteLength: 0,
							});
						}
						this.#pending.delete(response.requestId);
						clearTimeout(pending.timeout);
						if (response.ok) pending.resolve(response.result);
						else pending.reject(errorFromEnvelope(response.error));
						break;
					}
					case "event":
						this.#onEvent(decodeEventFrame(frame));
						break;
					case "resyncRequired":
						this.#onResync(decodeResyncRequiredFrame(frame));
						break;
					default:
						throw new WireDecodeError({
							message: "Unexpected frame after hello negotiation",
							frameKind: frame.kind,
							byteLength: 0,
						});
				}
			} catch (error) {
				this.#fail(error);
				return;
			}
		}
	}

	#fail(cause: unknown): void {
		if (this.#closed) return;
		this.#closed = true;
		const error =
			cause instanceof TerminalSessionWireConnectionError ||
			cause instanceof WireFrameOversizeError ||
			cause instanceof WireDecodeError ||
			cause instanceof WireHelloRejectedError ||
			cause instanceof WireResyncRequiredError
				? cause
				: new TerminalSessionWireConnectionError(
						cause instanceof Error ? `Terminal session socket failed: ${cause.message}` : "Terminal session socket failed",
					);
		this.#helloReady.reject(error);
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.#pending.clear();
		this.#socket.destroy();
	}
}

class SocketTerminalSessionAttachment implements TerminalSessionAttachment {
	readonly #transport: UnixSocketTerminalSessionTransport;
	readonly #state: AttachmentState;

	constructor(transport: UnixSocketTerminalSessionTransport, state: AttachmentState) {
		this.#transport = transport;
		this.#state = state;
	}

	get viewId(): string {
		return this.#state.viewId;
	}

	get epoch(): number {
		return this.#state.epoch;
	}

	detach(): Promise<void> {
		return this.#transport.detach(this.#state);
	}
}

export class UnixSocketTerminalSessionTransport implements TerminalSessionTransport {
	readonly #options: UnixSocketTerminalSessionTransportOptions;
	readonly #listeners = new Set<TerminalSessionDeliveryListener>();
	#connection: ClientConnection | undefined;
	#connecting: Promise<ClientConnection> | undefined;
	#attachment: AttachmentState | undefined;
	#reconnecting: Promise<void> | undefined;
	#closed = false;

	constructor(options: UnixSocketTerminalSessionTransportOptions) {
		if (
			options.reconnectAttempts !== undefined &&
			(!Number.isInteger(options.reconnectAttempts) || options.reconnectAttempts < 1)
		) {
			throw new RangeError("reconnectAttempts must be a positive integer");
		}
		if (
			options.requestTimeoutMs !== undefined &&
			(!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs <= 0)
		) {
			throw new RangeError("requestTimeoutMs must be positive");
		}
		if (options.maxFrameBytes !== undefined) new IncrementalWireFrameDecoder(options.maxFrameBytes);
		this.#options = options;
	}

	async attach(request: TerminalSessionAttachRequest): Promise<TerminalSessionAttachment> {
		if (this.#closed) throw new Error("Terminal session transport is closed");
		if (this.#attachment && !this.#attachment.detached) {
			throw new Error("A terminal session view is already attached");
		}
		const connection = await this.#getConnection();
		const identity = decodeAttachmentIdentity(
			await connection.request("attachTerminalView", toJsonValue(request), request.correlationId),
		);
		const state: AttachmentState = {
			request,
			viewId: identity.viewId,
			epoch: identity.epoch,
			detached: false,
			resyncing: false,
		};
		this.#attachment = state;
		return new SocketTerminalSessionAttachment(this, state);
	}

	async ownerProof<Result>(payload: JsonValue): Promise<Result> {
		if (this.#closed) throw new Error("Terminal session transport is closed");
		const connection = await this.#getConnection();
		return (await connection.request("ownerProof", payload)) as unknown as Result;
	}

	async close(): Promise<void> {
		const attachment = this.#attachment;
		if (attachment && !attachment.detached) {
			await this.detach(attachment);
			return;
		}
		this.#closed = true;
		this.#listeners.clear();
		this.#connection?.close();
		this.#connection = undefined;
	}

	async requestSnapshot(): Promise<TerminalSessionSnapshot> {
		const state = this.#requireAttachment();
		const connection = await this.#getAttachedConnection(state);
		return decodeSnapshot(await connection.request("terminalSnapshot", null));
	}

	async sendCommand<Command extends TerminalSessionCommand>(
		command: Command,
	): Promise<TerminalSessionCommandResultFor<Command>> {
		const state = this.#requireAttachment();
		try {
			const connection = await this.#getAttachedConnection(state);
			return (await connection.request(
				"terminalCommand",
				toJsonValue(command),
				command.correlationId,
			)) as unknown as TerminalSessionCommandResultFor<Command>;
		} catch (error) {
			if (!(error instanceof TerminalSessionWireConnectionError)) throw error;
			await this.#reconnectAttachment(state);
			const connection = await this.#getConnection();
			return (await connection.request(
				"terminalCommand",
				toJsonValue(command),
				command.correlationId,
			)) as unknown as TerminalSessionCommandResultFor<Command>;
		}
	}

	async request<Operation extends TerminalSessionRequestOperation>(
		operation: Operation,
		args: TerminalSessionRequestArguments<Operation>,
	): Promise<TerminalSessionRequestResult<Operation>> {
		const state = this.#requireAttachment();
		let argumentCount = args.length;
		while (argumentCount > 0 && args[argumentCount - 1] === undefined) argumentCount -= 1;
		const wireArgs = argumentCount === args.length ? args : args.slice(0, argumentCount);
		const connection = await this.#getAttachedConnection(state);
		return (await connection.request(
			"terminalRequest",
			toJsonValue({ operation, args: wireArgs }),
		)) as unknown as TerminalSessionRequestResult<Operation>;
	}

	subscribe(listener: TerminalSessionDeliveryListener): () => void {
		if (this.#closed) throw new Error("Terminal session transport is closed");
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	async detach(state: AttachmentState): Promise<void> {
		if (state.detached) return;
		if (this.#attachment !== state) throw new Error("Terminal session view is detached");
		state.detached = true;
		this.#attachment = undefined;
		this.#closed = true;
		this.#listeners.clear();
		const connection = this.#connection;
		try {
			if (connection && !connection.closed) await connection.request("detachTerminalView", null);
		} finally {
			connection?.close();
			this.#connection = undefined;
		}
	}

	#requireAttachment(): AttachmentState {
		const state = this.#attachment;
		if (this.#closed || !state || state.detached) throw new Error("Terminal session transport is not attached");
		return state;
	}

	async #getAttachedConnection(state: AttachmentState): Promise<ClientConnection> {
		if (this.#connection && !this.#connection.closed) return this.#connection;
		await this.#reconnectAttachment(state);
		return this.#getConnection();
	}

	async #getConnection(): Promise<ClientConnection> {
		if (this.#connection && !this.#connection.closed) return this.#connection;
		if (this.#connecting) return this.#connecting;
		this.#connecting = (async () => {
			const connection = new ClientConnection(
				this.#options,
				frame => this.#handleEvent(frame),
				frame => this.#handleResync(frame),
			);
			try {
				await connection.connect();
				this.#connection = connection;
				return connection;
			} catch (error) {
				connection.close();
				throw error;
			} finally {
				this.#connecting = undefined;
			}
		})();
		return this.#connecting;
	}

	async #reconnectAttachment(state: AttachmentState): Promise<void> {
		if (this.#reconnecting) return this.#reconnecting;
		this.#reconnecting = (async () => {
			this.#connection?.close();
			this.#connection = undefined;
			const attempts = this.#options.reconnectAttempts ?? 3;
			let lastError: unknown;
			for (let attempt = 0; attempt < attempts; attempt += 1) {
				if (state.detached) throw new TerminalSessionWireConnectionError("Terminal session view is detached");
				if (attempt > 0) await Bun.sleep(25 * attempt);
				let connection: ClientConnection | undefined;
				try {
					connection = await this.#getConnection();
					const identity = decodeAttachmentIdentity(
						await connection.request(
							"attachTerminalView",
							toJsonValue(state.request),
							state.request.correlationId,
						),
					);
					state.viewId = identity.viewId;
					state.epoch = identity.epoch;
					return;
				} catch (error) {
					lastError = error;
					connection?.close();
					this.#connection = undefined;
				}
			}
			throw lastError instanceof Error
				? lastError
				: new TerminalSessionWireConnectionError("Unable to reconnect terminal session view");
		})().finally(() => {
			this.#reconnecting = undefined;
		});
		return this.#reconnecting;
	}

	#handleEvent(frame: EventFrame): void {
		const state = this.#attachment;
		if (!state || state.detached || state.resyncing) return;
		const delivery = decodeDelivery(frame);
		for (const listener of this.#listeners) {
			try {
				listener(delivery);
			} catch {
				continue;
			}
		}
	}

	#handleResync(frame: ResyncRequiredFrame): void {
		const state = this.#attachment;
		if (!state || state.detached || state.resyncing) return;
		state.resyncing = true;
		void this.requestSnapshot()
			.then(snapshot => {
				const delivery: TerminalSessionDelivery = {
					kind: "resyncRequired",
					expectedSequence: frame.expectedSequence,
					observedSequence: frame.observedSequence,
					snapshot,
				};
				for (const listener of this.#listeners) {
					try {
						listener(delivery);
					} catch {
						continue;
					}
				}
			})
			.catch(() => {})
			.finally(() => {
				state.resyncing = false;
			});
	}
}
