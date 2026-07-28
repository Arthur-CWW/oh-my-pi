import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import type { Schema } from "effect";
import type {
	TerminalSessionAttachment,
	TerminalSessionAttachRequest,
	TerminalSessionCommand,
	TerminalSessionRequestOperation,
	TerminalSessionTransport,
} from "../terminal-session-transport";
import type { TerminalSessionDelivery } from "../terminal-session-view";
import { DEFAULT_MAX_WIRE_FRAME_BYTES, encodeLengthPrefixedWireFrame, IncrementalWireFrameDecoder } from "./codec";
import type { WireCapability } from "./common";
import {
	toWireErrorEnvelope,
	WireDecodeError,
	WireFrameOversizeError,
	WireHelloRejectedError,
	WireResyncRequiredError,
} from "./errors";
import type {
	ManifestResponseFrame,
	ClientHelloFrame,
	EventFrame,
	RequestFrame,
	ResponseFrame,
	ResyncRequiredFrame,
	WireFrame,
} from "./frames";
import { decodeClientHelloFrame, decodeRequestFrame } from "./frames";
import { type HelloNegotiationExpectation, negotiateClientHello } from "./negotiation";

type JsonValue = typeof Schema.Json.Type;

const TERMINAL_REQUEST_OPERATIONS: Record<TerminalSessionRequestOperation, true> = {
	getContextUsage: true,
	getSessionStats: true,
	getAdvisorStats: true,
	getAsyncJobSnapshot: true,
	getHindsightSessionState: true,
	getAllToolNames: true,
	formatSessionAsText: true,
	formatAdvisorHistoryAsText: true,
	getModelCatalog: true,
	getToolCatalog: true,
	getSessionMetadataSnapshot: true,
	getWorkflowEligibility: true,
	getTurnLifecycle: true,
	saveDraft: true,
	consumeDraft: true,
	invokeExtensionCommand: true,
	invokePlanResolve: true,
	requestGoalContinuation: true,
};

const DEFAULT_OUTBOUND_QUEUE_CAPACITY = 256;

export interface TerminalSessionWireServerOptions {
	readonly socketPath: string;
	readonly createTransport: (capability: WireCapability) => TerminalSessionTransport;
	readonly hello: HelloNegotiationExpectation;
	readonly ownerProof: (payload: JsonValue, hello: ClientHelloFrame) => JsonValue | Promise<JsonValue>;
	readonly maxFrameBytes?: number;
	readonly outboundQueueCapacity?: number;
	readonly removeSocketOnClose?: boolean;
}

interface QueuedFrame {
	readonly bytes: Uint8Array;
	readonly eventTraffic: boolean;
	readonly sequence: number | undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) throw requestDecodeError(`Missing ${field}`);
	return value;
}

function requestDecodeError(message: string): WireDecodeError {
	return new WireDecodeError({ message, frameKind: "request", byteLength: 0 });
}

function decodeAttachRequest(payload: JsonValue): TerminalSessionAttachRequest {
	if (!isRecord(payload)) throw requestDecodeError("Invalid attachTerminalView payload");
	const causationId = payload.causationId;
	if (causationId !== undefined && (typeof causationId !== "string" || causationId.length === 0)) {
		throw requestDecodeError("Invalid causationId");
	}
	const takeover = payload.takeover;
	const expectedControllerEpoch = payload.expectedControllerEpoch;
	if (
		(takeover !== undefined && takeover !== true) ||
		(expectedControllerEpoch !== undefined &&
			(!Number.isInteger(expectedControllerEpoch) || (expectedControllerEpoch as number) < 0)) ||
		(takeover === true) !== (expectedControllerEpoch !== undefined)
	) {
		throw requestDecodeError("Invalid controller takeover fence");
	}
	return {
		viewId: requireNonEmptyString(payload.viewId, "viewId"),
		commandId: requireNonEmptyString(payload.commandId, "commandId"),
		correlationId: requireNonEmptyString(payload.correlationId, "correlationId"),
		...(causationId === undefined ? {} : { causationId }),
		...(takeover === true ? { takeover, expectedControllerEpoch: expectedControllerEpoch as number } : {}),
	};
}

function decodeTerminalCommand(payload: JsonValue): TerminalSessionCommand {
	if (!isRecord(payload)) throw requestDecodeError("Invalid terminalCommand payload");
	return {
		...payload,
		kind: requireNonEmptyString(payload.kind, "kind"),
		commandId: requireNonEmptyString(payload.commandId, "commandId"),
		correlationId: requireNonEmptyString(payload.correlationId, "correlationId"),
	} as TerminalSessionCommand;
}

function decodeTerminalRequest(payload: JsonValue): {
	readonly operation: TerminalSessionRequestOperation;
	readonly args: readonly unknown[];
} {
	if (!isRecord(payload)) throw requestDecodeError("Invalid terminalRequest payload");
	const operation = requireNonEmptyString(payload.operation, "operation") as TerminalSessionRequestOperation;
	if (!Object.hasOwn(TERMINAL_REQUEST_OPERATIONS, operation)) {
		throw requestDecodeError("Unknown terminal request operation");
	}
	const args = payload.args;
	if (!Array.isArray(args)) throw requestDecodeError("Invalid terminal request arguments");
	return { operation, args };
}

function toJsonValue(value: unknown): JsonValue {
	if (value === undefined) return null;
	const encoded = JSON.stringify(value);
	if (encoded === undefined) return null;
	return JSON.parse(encoded) as JsonValue;
}

function wireError(
	error: unknown,
): WireFrameOversizeError | WireDecodeError | WireHelloRejectedError | WireResyncRequiredError {
	if (
		error instanceof WireFrameOversizeError ||
		error instanceof WireDecodeError ||
		error instanceof WireHelloRejectedError ||
		error instanceof WireResyncRequiredError
	) {
		return error;
	}
	return requestDecodeError("Terminal session request failed");
}

class BoundedSocketWriter {
	readonly #socket: net.Socket;
	readonly #capacity: number;
	readonly #maxFrameBytes: number;
	readonly #queue: QueuedFrame[] = [];
	#active: QueuedFrame | undefined;
	#closed = false;
	#resyncQueued = false;
	#lastWrittenSequence = 0;

	constructor(socket: net.Socket, capacity: number, maxFrameBytes: number) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new RangeError("outboundQueueCapacity must be a positive integer");
		}
		this.#socket = socket;
		this.#capacity = capacity;
		this.#maxFrameBytes = maxFrameBytes;
	}

	close(): void {
		this.#closed = true;
		this.#queue.length = 0;
	}

	enqueueControl(frame: WireFrame): boolean {
		return this.#enqueue(frame, false, undefined);
	}

	enqueueEvent(frame: EventFrame): void {
		if (this.#closed || this.#resyncQueued) return;
		if (this.#queue.length >= this.#capacity) {
			const lastGuaranteedSequence = this.#active?.sequence ?? this.#lastWrittenSequence;
			this.enqueueResync(lastGuaranteedSequence + 1, frame.sequence, frame.correlationId);
			return;
		}
		this.#enqueue(frame, true, frame.sequence);
	}

	enqueueResync(expectedSequence: number, observedSequence: number, correlationId: string): void {
		if (this.#closed || this.#resyncQueued) return;
		for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
			if (this.#queue[index]?.eventTraffic) this.#queue.splice(index, 1);
		}
		if (this.#queue.length >= this.#capacity) {
			this.#closed = true;
			this.#socket.destroy();
			return;
		}
		this.#resyncQueued = true;
		const frame: ResyncRequiredFrame = {
			kind: "resyncRequired",
			correlationId,
			expectedSequence,
			observedSequence,
		};
		this.#enqueue(frame, true, undefined);
	}

	markResynced(baselineSequence: number): void {
		this.#lastWrittenSequence = baselineSequence;
		this.#resyncQueued = false;
	}

	#enqueue(frame: WireFrame, eventTraffic: boolean, sequence: number | undefined): boolean {
		if (this.#closed) return false;
		if (this.#queue.length >= this.#capacity) {
			this.#closed = true;
			this.#socket.destroy();
			return false;
		}
		let bytes: Uint8Array;
		try {
			bytes = encodeLengthPrefixedWireFrame(frame, this.#maxFrameBytes);
		} catch {
			this.#closed = true;
			this.#socket.destroy();
			return false;
		}
		this.#queue.push({ bytes, eventTraffic, sequence });
		this.#flush();
		return true;
	}

	#flush(): void {
		if (this.#closed || this.#active) return;
		const next = this.#queue.shift();
		if (!next) return;
		this.#active = next;
		this.#socket.write(next.bytes, error => {
			this.#active = undefined;
			if (error || this.#closed) {
				this.#closed = true;
				this.#socket.destroy();
				return;
			}
			if (next.sequence !== undefined) this.#lastWrittenSequence = next.sequence;
			this.#flush();
		});
	}
}

class ServerConnection {
	readonly #socket: net.Socket;
	readonly #createTransport: TerminalSessionWireServerOptions["createTransport"];
	readonly #expectedHello: HelloNegotiationExpectation;
	readonly #ownerProof: TerminalSessionWireServerOptions["ownerProof"];
	readonly #decoder: IncrementalWireFrameDecoder;
	readonly #writer: BoundedSocketWriter;
	readonly #maxPendingRequests: number;
	readonly #requests: RequestFrame[] = [];
	#hello: ClientHelloFrame | undefined;
	#grantedCapability: "controller" | "observer" | undefined;
	#attachment: TerminalSessionAttachment | undefined;
	#unsubscribe: (() => void) | undefined;
	#eventCorrelationId: string = randomUUID();
	#closed = false;
	#transport: TerminalSessionTransport | undefined;
	#handlingRequest = false;

	constructor(socket: net.Socket, options: TerminalSessionWireServerOptions) {
		this.#socket = socket;
		this.#createTransport = options.createTransport;
		this.#expectedHello = options.hello;
		this.#ownerProof = options.ownerProof;
		const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_WIRE_FRAME_BYTES;
		this.#decoder = new IncrementalWireFrameDecoder(maxFrameBytes);
		this.#maxPendingRequests = options.outboundQueueCapacity ?? DEFAULT_OUTBOUND_QUEUE_CAPACITY;
		this.#writer = new BoundedSocketWriter(
			socket,
			options.outboundQueueCapacity ?? DEFAULT_OUTBOUND_QUEUE_CAPACITY,
			maxFrameBytes,
		);
		socket.on("data", chunk => this.#receive(chunk));
		socket.once("close", () => this.#cleanup());
		socket.once("error", () => {});
	}

	close(): void {
		this.#socket.destroy();
	}

	#receive(chunk: Buffer | string): void {
		if (typeof chunk === "string") {
			this.#socket.destroy();
			return;
		}
		if (this.#closed) return;
		let frames: readonly WireFrame[];
		try {
			frames = this.#decoder.push(chunk);
		} catch {
			this.#socket.destroy();
			return;
		}
		for (const frame of frames) {
			if (!this.#hello) {
				if (frame.kind === "manifestRequest") {
					const response: ManifestResponseFrame = {
						kind: "manifestResponse",
						correlationId: frame.correlationId,
						hostLabel: os.hostname().split(".", 1)[0] || os.hostname(),
						protocol: this.#expectedHello.protocol,
						sessionId: this.#expectedHello.sessionId,
						ownerEpoch: this.#expectedHello.ownerEpoch,
						runnerInstanceId: this.#expectedHello.runnerInstanceId,
						build: this.#expectedHello.build,
						authority: this.#expectedHello.authority,
						features: this.#expectedHello.features,
					};
					this.#writer.enqueueControl(response);
					continue;
				}
				if (frame.kind !== "clientHello") {
					this.#socket.destroy();
					return;
				}
				try {
					const hello = decodeClientHelloFrame(frame);
					const response = negotiateClientHello(hello, this.#expectedHello);
					this.#hello = hello;
					this.#grantedCapability = response.grantedCapability;
					this.#eventCorrelationId = hello.correlationId;
					this.#writer.enqueueControl(response);
				} catch {
					this.#socket.destroy();
				}
				continue;
			}
			if (frame.kind !== "request") {
				this.#socket.destroy();
				return;
			}
			const request = decodeRequestFrame(frame);
			if (this.#requests.length >= this.#maxPendingRequests) {
				this.#socket.destroy();
				return;
			}
			this.#requests.push(request);
			this.#drainRequests();
		}
	}

	#drainRequests(): void {
		if (this.#closed || this.#handlingRequest) return;
		const frame = this.#requests.shift();
		if (!frame) return;
		this.#handlingRequest = true;
		void this.#handleRequest(frame).finally(() => {
			this.#handlingRequest = false;
			this.#drainRequests();
		});
	}

	async #handleRequest(frame: RequestFrame): Promise<void> {
		try {
			const result = await this.#dispatch(frame);
			const response: ResponseFrame = {
				kind: "response",
				correlationId: frame.correlationId,
				requestId: frame.requestId,
				ok: true,
				result: toJsonValue(result),
			};
			this.#writer.enqueueControl(response);
		} catch (error) {
			const response: ResponseFrame = {
				kind: "response",
				correlationId: frame.correlationId,
				requestId: frame.requestId,
				ok: false,
				error: toWireErrorEnvelope(wireError(error)),
			};
			this.#writer.enqueueControl(response);
		}
	}

	async #dispatch(frame: RequestFrame): Promise<unknown> {
		const hello = this.#hello;
		if (!hello) throw requestDecodeError("Hello negotiation is incomplete");
		switch (frame.operation) {
			case "ownerProof":
				return this.#ownerProof(frame.payload, hello);
			case "attachTerminalView": {
				if (this.#attachment) throw requestDecodeError("A terminal view is already attached");
				const capability = this.#grantedCapability;
				if (!capability) throw requestDecodeError("Hello negotiation did not grant a terminal capability");
				const transport = this.#createTransport(capability);
				this.#transport = transport;
				let attachment: TerminalSessionAttachment;
				try {
					attachment = await transport.attach(decodeAttachRequest(frame.payload));
				} catch (error) {
					if (this.#transport === transport) this.#transport = undefined;
					throw error;
				}
				if (this.#closed) {
					await attachment.detach();
					throw requestDecodeError("Connection closed during terminal view attachment");
				}
				this.#attachment = attachment;
				this.#eventCorrelationId = frame.correlationId;
				this.#unsubscribe = transport.subscribe(delivery => this.#deliver(delivery));
				return { viewId: attachment.viewId, epoch: attachment.epoch };
			}
			case "terminalCommand":
				if (this.#grantedCapability !== "controller") {
					throw requestDecodeError("Terminal commands require controller capability");
				}
				this.#requireAttachment();
				return this.#requireTransport().sendCommand(decodeTerminalCommand(frame.payload));
			case "terminalRequest": {
				if (this.#grantedCapability !== "controller") {
					throw requestDecodeError("Terminal requests require controller capability");
				}
				this.#requireAttachment();
				const request = decodeTerminalRequest(frame.payload);
				const transportRequest = this.#requireTransport().request as (
					operation: TerminalSessionRequestOperation,
					args: readonly unknown[],
				) => Promise<unknown>;
				return transportRequest(request.operation, request.args);
			}
			case "terminalSnapshot": {
				this.#requireAttachment();
				const snapshot = await this.#requireTransport().requestSnapshot();
				this.#writer.markResynced(snapshot.terminalSequence);
				return snapshot;
			}
			case "detachTerminalView":
				await this.#detachAttachment();
				return null;
			default:
				throw requestDecodeError("Unknown terminal session operation");
		}
	}

	#requireAttachment(): TerminalSessionAttachment {
		if (!this.#attachment) throw requestDecodeError("No terminal view is attached");
		return this.#attachment;
	}
	#requireTransport(): TerminalSessionTransport {
		const transport = this.#transport;
		if (!transport) throw requestDecodeError("No terminal transport is attached");
		return transport;
	}

	#deliver(delivery: TerminalSessionDelivery): void {
		try {
			if (delivery.kind === "resyncRequired") {
				this.#writer.enqueueResync(delivery.expectedSequence, delivery.observedSequence, this.#eventCorrelationId);
				return;
			}
			const frame: EventFrame = {
				kind: "event",
				correlationId: this.#eventCorrelationId,
				eventId: randomUUID(),
				sequence: delivery.sequence,
				eventType: delivery.kind,
				payload: toJsonValue(delivery),
			};
			this.#writer.enqueueEvent(frame);
		} catch {
			this.#writer.enqueueResync(0, 0, this.#eventCorrelationId);
		}
	}

	async #detachAttachment(): Promise<void> {
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		const attachment = this.#attachment;
		this.#attachment = undefined;
		this.#transport = undefined;
		if (attachment) await attachment.detach();
	}

	#cleanup(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#writer.close();
		this.#requests.length = 0;
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		const attachment = this.#attachment;
		this.#attachment = undefined;
		this.#transport = undefined;
		if (attachment) void attachment.detach().catch(() => {});
	}
}

export class UnixTerminalSessionServer {
	readonly #options: TerminalSessionWireServerOptions;
	readonly #server: net.Server;
	readonly #connections = new Set<ServerConnection>();
	#closing: Promise<void> | undefined;
	#didListen = false;

	constructor(options: TerminalSessionWireServerOptions) {
		const capacity = options.outboundQueueCapacity ?? DEFAULT_OUTBOUND_QUEUE_CAPACITY;
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new RangeError("outboundQueueCapacity must be a positive integer");
		}
		if (options.maxFrameBytes !== undefined) new IncrementalWireFrameDecoder(options.maxFrameBytes);
		this.#options = options;
		this.#server = net.createServer(socket => {
			try {
				const connection = new ServerConnection(socket, options);
				this.#connections.add(connection);
				socket.once("close", () => this.#connections.delete(connection));
			} catch {
				socket.destroy();
			}
		});
		this.#server.on("error", () => void this.close().catch(() => {}));
	}

	async listen(): Promise<void> {
		const listening = Promise.withResolvers<void>();
		const onError = (error: Error): void => listening.reject(error);
		this.#server.once("error", onError);
		this.#server.listen(this.#options.socketPath, () => {
			this.#server.off("error", onError);
			this.#server.unref();
			this.#didListen = true;
			listening.resolve();
		});
		await listening.promise;
	}

	async close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closing = (async () => {
			const removeSocket = this.#didListen && this.#options.removeSocketOnClose !== false;
			this.#didListen = false;
			for (const connection of this.#connections) connection.close();
			if (this.#server.listening) {
				const closed = Promise.withResolvers<void>();
				this.#server.close(error => (error ? closed.reject(error) : closed.resolve()));
				await closed.promise;
			}
			if (removeSocket) await fs.rm(this.#options.socketPath, { force: true });
		})();
		return this.#closing;
	}
}
