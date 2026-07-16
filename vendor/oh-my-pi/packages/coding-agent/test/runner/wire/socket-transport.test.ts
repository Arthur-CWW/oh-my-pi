import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as net from "node:net";
import * as path from "node:path";
import { createTerminalSessionController } from "../../../src/modes/terminal-session-controller";
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
} from "../../../src/runner/terminal-session-transport";
import type { TerminalSessionDelivery, TerminalSessionSnapshot } from "../../../src/runner/terminal-session-view";
import { UnixSocketTerminalSessionTransport } from "../../../src/runner/wire/client";
import {
	DEFAULT_MAX_WIRE_FRAME_BYTES,
	IncrementalWireFrameDecoder,
	encodeLengthPrefixedWireFrame,
} from "../../../src/runner/wire/codec";
import type { ClientHelloFrame, RequestFrame } from "../../../src/runner/wire/frames";
import { UnixTerminalSessionServer } from "../../../src/runner/wire/server";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

const snapshot = (revision = 0, terminalSequence = 0) =>
	({
		terminalSequence,
		runner: { revision, sessionRevision: 0 },
		session: { promptOperation: { generation: 0, active: false } },
	}) as unknown as TerminalSessionSnapshot;

interface ControllerLeaseState {
	current: RecordingTransport | undefined;
	nextEpoch: number;
}

class RecordingTransport implements TerminalSessionTransport {
	readonly listeners = new Set<TerminalSessionDeliveryListener>();
	readonly #controllerLease: ControllerLeaseState | undefined;
	detachCount = 0;
	revision = 0;
	terminalSequence = 0;
	epoch = 7;

	constructor(controllerLease?: ControllerLeaseState) {
		this.#controllerLease = controllerLease;
	}
	async attach(request: TerminalSessionAttachRequest): Promise<TerminalSessionAttachment> {
		const controllerLease = this.#controllerLease;
		if (controllerLease) {
			const active = controllerLease.current;
			if (active) {
				if (request.takeover !== true) throw new Error("Controller authority is already held");
				if (request.expectedControllerEpoch !== active.epoch) throw new Error("Controller takeover fence is stale");
			} else if (request.takeover === true) {
				throw new Error("Controller takeover fence is stale");
			}
			this.epoch = ++controllerLease.nextEpoch;
			controllerLease.current = this;
		}
		let detached = false;
		return {
			viewId: request.viewId,
			epoch: this.epoch,
			detach: async () => {
				if (detached) return;
				detached = true;
				this.detachCount += 1;
				if (controllerLease?.current === this) controllerLease.current = undefined;
			},
		};
	}

	async sendCommand<Command extends TerminalSessionCommand>(
		command: Command,
	): Promise<TerminalSessionCommandResultFor<Command>> {
		this.revision += 1;
		return {
			commandId: command.commandId,
			correlationId: command.correlationId,
			inputId: `input-${this.revision}`,
			durableSequence: this.revision,
			revision: this.revision,
			replayed: false,
		} as unknown as TerminalSessionCommandResultFor<Command>;
	}

	async requestSnapshot(): Promise<TerminalSessionSnapshot> {
		return snapshot(this.revision, this.terminalSequence);
	}

	async request<Operation extends TerminalSessionRequestOperation>(
		_operation: Operation,
		_args: TerminalSessionRequestArguments<Operation>,
	): Promise<TerminalSessionRequestResult<Operation>> {
		return null as TerminalSessionRequestResult<Operation>;
	}

	subscribe(listener: TerminalSessionDeliveryListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(delivery: TerminalSessionDelivery): void {
		this.terminalSequence = Math.max(
			this.terminalSequence,
			delivery.kind === "resyncRequired" ? delivery.observedSequence : delivery.sequence,
		);
		for (const listener of this.listeners) listener(delivery);
	}
}

async function fixture(queueCapacity = 8, controllerLease?: ControllerLeaseState) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-wire-socket-"));
	roots.push(root);
	const socketPath = path.join(root, "runner.sock");
	const authority = {
		uid: typeof process.getuid === "function" ? process.getuid() : 0,
		canonicalSessionPath: path.join(root, "session.jsonl"),
		namespaceDigest: "namespace",
	};
	const build = { version: "test", digest: "digest" };
	const hello = {
		protocol: { minMajor: 1, maxMajor: 1, maxMinor: 0 },
		sessionId: "session",
		ownerEpoch: randomUUID(),
		runnerInstanceId: randomUUID(),
		build,
		authority,
		requestedCapability: "controller" as const,
		features: ["event-resync"],
	};
	const transports: RecordingTransport[] = [];
	const server = new UnixTerminalSessionServer({
		socketPath,
		createTransport: () => {
			const transport = new RecordingTransport(controllerLease);
			transports.push(transport);
			return transport;
		},
		hello: { ...hello, grantedCapability: "controller" },
		ownerProof: payload => ({ ownerEpoch: hello.ownerEpoch, payload }),
		outboundQueueCapacity: queueCapacity,
	});
	await server.listen();
	return { server, socketPath, hello, transports };
}
async function attachRawSocket(
	socketPath: string,
	hello: Omit<ClientHelloFrame, "kind" | "correlationId">,
	request: TerminalSessionAttachRequest,
): Promise<net.Socket> {
	const socket = net.createConnection(socketPath);
	const decoder = new IncrementalWireFrameDecoder();
	const result = Promise.withResolvers<void>();
	const helloCorrelationId = randomUUID();
	const requestId = randomUUID();
	let negotiated = false;
	let settled = false;
	const reject = (error: unknown): void => {
		if (settled) return;
		settled = true;
		result.reject(error);
	};
	socket.once("error", reject);
	socket.once("close", () => reject(new Error("Socket closed before attachment")));
	socket.on("data", chunk => {
		if (typeof chunk === "string") {
			reject(new Error("Socket returned text data"));
			return;
		}
		for (const frame of decoder.push(chunk)) {
			if (!negotiated) {
				if (frame.kind !== "serverHello") {
					reject(new Error("Expected server hello"));
					return;
				}
				negotiated = true;
				const attach: RequestFrame = {
					kind: "request",
					correlationId: request.correlationId,
					requestId,
					operation: "attachTerminalView",
					payload: request,
				};
				socket.write(encodeLengthPrefixedWireFrame(attach));
				continue;
			}
			if (frame.kind !== "response" || frame.requestId !== requestId) continue;
			if (!frame.ok) {
				reject(new Error(frame.error.message));
				return;
			}
			settled = true;
			result.resolve();
		}
	});
	socket.once("connect", () => {
		socket.write(
			encodeLengthPrefixedWireFrame(
				{ kind: "clientHello", correlationId: helloCorrelationId, ...hello },
				DEFAULT_MAX_WIRE_FRAME_BYTES,
			),
		);
	});
	await result.promise;
	return socket;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for socket cleanup");
		await Bun.sleep(5);
	}
}

describe("framed runner socket transport", () => {
	it("negotiates identity, serves owner proof, and refuses a mismatched hello", async () => {
		const { server, socketPath, hello } = await fixture();
		const observer = new UnixSocketTerminalSessionTransport({
			socketPath,
			hello: { ...hello, requestedCapability: "observer" },
		});
		const expectedProof = {
			ownerEpoch: hello.ownerEpoch,
			payload: { nonce: "proof" },
		};
		expect(await observer.ownerProof<typeof expectedProof>({ nonce: "proof" })).toEqual(expectedProof);
		await observer.close();
		const mismatched = new UnixSocketTerminalSessionTransport({
			socketPath,
			hello: { ...hello, sessionId: "wrong" },
			requestTimeoutMs: 250,
		});
		await expect(mismatched.ownerProof({ nonce: "nope" })).rejects.toBeInstanceOf(Error);
		await mismatched.close().catch(() => {});
		await server.close();
	});

	it("drives the controller through attach, durable command, event, and detach", async () => {
		const { server, socketPath, hello, transports } = await fixture();
		const client = new UnixSocketTerminalSessionTransport({ socketPath, hello });
		const controller = await createTerminalSessionController(client, { viewId: "socket-controller" });
		const receipt = await controller.submit({ text: "hello", deliveryClass: "followUp", commandId: "durable-1" });
		expect(receipt).toMatchObject({ commandId: "durable-1", revision: 1, replayed: false });
		const eventDelivered = Promise.withResolvers<void>();
		controller.subscribeAgentEvents(() => eventDelivered.resolve());
		transports[0]!.emit({ kind: "agentEvent", sequence: 1, event: { type: "message_start" } as never });
		await eventDelivered.promise;
		await controller.close();
		expect(transports[0]!.detachCount).toBe(1);
		await server.close();
	});

	it("turns outbound queue overflow into resyncRequired without runner backpressure", async () => {
		const { server, socketPath, hello, transports } = await fixture(1);
		const client = new UnixSocketTerminalSessionTransport({ socketPath, hello });
		await client.attach({ viewId: "overflow", commandId: "attach", correlationId: "attach" });
		const resyncDelivered = Promise.withResolvers<void>();
		client.subscribe(delivery => {
			if (delivery.kind === "resyncRequired") resyncDelivered.resolve();
		});
		for (let sequence = 1; sequence <= 100; sequence += 1) {
			transports[0]!.emit({ kind: "agentEvent", sequence, event: { type: "message_start" } as never });
		}
		await resyncDelivered.promise;
		await client.close();
		await server.close();
	});

	it("drops only the disconnected connection's attached view", async () => {
		const { server, socketPath, hello, transports } = await fixture();
		const first = await attachRawSocket(socketPath, hello, {
			viewId: "first",
			commandId: "attach-first",
			correlationId: "attach-first",
		});
		const second = await attachRawSocket(socketPath, hello, {
			viewId: "second",
			commandId: "attach-second",
			correlationId: "attach-second",
		});
		first.destroy();
		await waitUntil(() => transports[0]?.detachCount === 1);
		expect(transports[0]!.detachCount).toBe(1);
		expect(transports[1]!.detachCount).toBe(0);
		second.destroy();
		await waitUntil(() => transports[1]?.detachCount === 1);
		await server.close();
	});

	it("rejects implicit and stale displacement and accepts an epoch-fenced takeover", async () => {
		const controllerLease: ControllerLeaseState = { current: undefined, nextEpoch: 0 };
		const { server, socketPath, hello } = await fixture(8, controllerLease);
		const local = new UnixSocketTerminalSessionTransport({ socketPath, hello });
		const localAttachment = await local.attach({
			viewId: "local",
			commandId: "attach-local",
			correlationId: "attach-local",
		});
		expect(localAttachment.epoch).toBe(1);

		const implicit = new UnixSocketTerminalSessionTransport({ socketPath, hello });
		await expect(
			implicit.attach({
				viewId: "implicit",
				commandId: "attach-implicit",
				correlationId: "attach-implicit",
			}),
		).rejects.toBeInstanceOf(Error);
		await implicit.close();

		const stale = new UnixSocketTerminalSessionTransport({ socketPath, hello });
		await expect(
			stale.attach({
				viewId: "stale",
				commandId: "attach-stale",
				correlationId: "attach-stale",
				takeover: true,
				expectedControllerEpoch: localAttachment.epoch + 1,
			}),
		).rejects.toBeInstanceOf(Error);
		await stale.close();

		const takeover = new UnixSocketTerminalSessionTransport({ socketPath, hello });
		const takeoverAttachment = await takeover.attach({
			viewId: "takeover",
			commandId: "attach-takeover",
			correlationId: "attach-takeover",
			takeover: true,
			expectedControllerEpoch: localAttachment.epoch,
		});
		expect(takeoverAttachment.epoch).toBe(2);
		await local.close();
		expect(controllerLease.current?.epoch).toBe(takeoverAttachment.epoch);
		await takeover.close();
		expect(controllerLease.current).toBeUndefined();
		await server.close();
	});
});
