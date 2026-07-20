import { AgentRegistry, type AgentRef } from "../registry/agent-registry";
import { IrcExternalBus } from "../irc/bus-external";
import { Settings } from "../config/settings";
import { EventBus } from "../utils/event-bus";
import {
	decodeSpawnWorkerRequest,
	SPAWN_WORKER_MAX_INPUT_BYTES,
	SPAWN_WORKER_MAX_QUEUED_BYTES,
	SPAWN_WORKER_MAX_RECORD_BYTES,
	SPAWN_WORKER_PROTOCOL_VERSION,
	type SpawnWorkerRecord,
	type SpawnWorkerRegistryRef,
	type SpawnWorkerRequest,
} from "./spawn-worker-protocol";
import {
	TASK_SUBAGENT_EVENT_CHANNEL,
	TASK_SUBAGENT_LIFECYCLE_CHANNEL,
	TASK_SUBAGENT_PROGRESS_CHANNEL,
} from "./types";

interface QueuedRecord {
	bytes: Uint8Array;
	droppable: boolean;
}

class BoundedJsonlWriter {
	readonly #queue: QueuedRecord[] = [];
	#queuedBytes = 0;
	#draining: Promise<void> | undefined;

	enqueue(record: SpawnWorkerRecord, droppable = false): void {
		let encoded: Uint8Array;
		try {
			encoded = new TextEncoder().encode(`${JSON.stringify(record)}\n`);
		} catch (error) {
			if (droppable) return;
			throw error;
		}
		if (encoded.byteLength > SPAWN_WORKER_MAX_RECORD_BYTES) {
			if (droppable) return;
			throw new Error(`spawn-worker record exceeds ${SPAWN_WORKER_MAX_RECORD_BYTES} bytes`);
		}
		while (this.#queuedBytes + encoded.byteLength > SPAWN_WORKER_MAX_QUEUED_BYTES) {
			const index = this.#queue.findIndex(item => item.droppable);
			if (index < 0) {
				if (droppable) return;
				throw new Error("spawn-worker output backpressure cap exceeded");
			}
			const [removed] = this.#queue.splice(index, 1);
			this.#queuedBytes -= removed.bytes.byteLength;
		}
		this.#queue.push({ bytes: encoded, droppable });
		this.#queuedBytes += encoded.byteLength;
		this.#draining ??= this.#drain();
	}

	async flush(): Promise<void> {
		await this.#draining;
	}

	async #drain(): Promise<void> {
		const writer = Bun.stdout.writer();
		try {
			while (this.#queue.length > 0) {
				const item = this.#queue.shift();
				if (!item) break;
				this.#queuedBytes -= item.bytes.byteLength;
				writer.write(item.bytes);
				await writer.flush();
			}
		} finally {
			this.#draining = undefined;
			if (this.#queue.length > 0) this.#draining = this.#drain();
		}
	}
}

async function readRequest(): Promise<SpawnWorkerRequest> {
	const reader = Bun.stdin.stream().getReader();
	const decoder = new TextDecoder();
	let total = 0;
	let text = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > SPAWN_WORKER_MAX_INPUT_BYTES) throw new Error("spawn-worker request exceeds input cap");
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
	} finally {
		reader.releaseLock();
	}
	const lines = text.split("\n").filter(line => line.trim().length > 0);
	if (lines.length !== 1) throw new Error("spawn-worker expects exactly one JSONL request record");
	return decodeSpawnWorkerRequest(JSON.parse(lines[0]));
}

function registryRef(ref: AgentRef | undefined): SpawnWorkerRegistryRef | undefined {
	if (!ref) return undefined;
	return {
		id: ref.id,
		displayName: ref.displayName,
		kind: ref.kind,
		status: ref.status,
		...(ref.parentId ? { parentId: ref.parentId } : {}),
		sessionFile: ref.sessionFile,
	};
}

function recordBase(requestId: string) {
	return { version: SPAWN_WORKER_PROTOCOL_VERSION, requestId } as const;
}

async function runSynthetic(request: Extract<SpawnWorkerRequest, { type: "synthetic" }>): Promise<SpawnWorkerRecord> {
	const allocation = new Uint8Array(request.workload.allocateBytes);
	for (let index = 0; index < allocation.byteLength; index += 4096) allocation[index] = index & 0xff;
	const spinUntil = performance.now() + request.workload.spinMs;
	while (performance.now() < spinUntil) {
		// Deliberate worker-local CPU pressure for the spawn-wave proof.
	}
	if (request.workload.hangMs) await Bun.sleep(request.workload.hangMs);
	return {
		...recordBase(request.requestId),
		type: "synthetic-result",
		allocatedBytes: allocation.byteLength,
		rssBytes: process.memoryUsage.rss(),
	};
}

export async function initializeSpawnWorkerSettings(
	request: Extract<SpawnWorkerRequest, { type: "run" }>,
): Promise<void> {
	await Settings.init({ inMemory: true, cwd: request.options.cwd, overrides: request.settings });
}

export async function startSpawnWorker(): Promise<void> {
	const writer = new BoundedJsonlWriter();
	let requestId = "unparsed";
	let workerIrcBus: IrcExternalBus | undefined;
	let workerIrcSessionId: string | undefined;
	try {
		const request = await readRequest();
		requestId = request.requestId;
		if (request.type === "run") process.env.OMP_SUBPROCESS_WORKER = "1";
		// Install the serialized settings snapshot before loading the executor/tool graph.
		// Edit's auto-generated-file guard reads the process-global proxy.
		if (request.type === "run") {
			await initializeSpawnWorkerSettings(request);
			workerIrcBus = IrcExternalBus.global();
			workerIrcSessionId = request.options.id;
			workerIrcBus.registerPeer({
				sessionId: workerIrcSessionId,
				agentId: workerIrcSessionId,
				name: workerIrcSessionId,
				cwd: request.options.worktree ?? request.options.cwd,
				pid: process.pid,
				sessionFile: request.options.sessionFile ?? undefined,
			});
		}
		writer.enqueue({ ...recordBase(requestId), type: "ready", pid: process.pid });
		writer.enqueue({ ...recordBase(requestId), type: "phase", phase: "decode", at: Date.now() });
		if (request.type === "synthetic") {
			writer.enqueue({ ...recordBase(requestId), type: "phase", phase: "run", at: Date.now() });
			writer.enqueue(await runSynthetic(request));
			await writer.flush();
			return;
		}

		const registry = AgentRegistry.global();
		for (const ref of request.registry) {
			registry.register({ ...ref, session: null });
		}
		const unsubscribeRegistry = registry.onChange(event => {
			const ref = registryRef(event.ref);
			if (ref) writer.enqueue({ ...recordBase(requestId), type: "registry", ref });
		});
		const eventBus = new EventBus();
		const unsubscribeEvents = [TASK_SUBAGENT_PROGRESS_CHANNEL, TASK_SUBAGENT_EVENT_CHANNEL, TASK_SUBAGENT_LIFECYCLE_CHANNEL].map(
			channel => eventBus.on(channel, payload => writer.enqueue({ ...recordBase(requestId), type: "event", channel, payload }, true)),
		);
		try {
			writer.enqueue({ ...recordBase(requestId), type: "phase", phase: "setup", at: Date.now() });
			writer.enqueue({ ...recordBase(requestId), type: "phase", phase: "run", at: Date.now() });
			const { runSubprocessWorkerRequest } = await import("./executor");
			const result = await runSubprocessWorkerRequest(request, {
				eventBus,
				onProgress: progress => writer.enqueue({ ...recordBase(requestId), type: "progress", progress }, true),
			});
			writer.enqueue({ ...recordBase(requestId), type: "phase", phase: "finalize", at: Date.now() });
			writer.enqueue({ ...recordBase(requestId), type: "result", result, rssBytes: process.memoryUsage.rss() });
		} finally {
			unsubscribeRegistry();
			for (const unsubscribe of unsubscribeEvents) unsubscribe();
			eventBus.clear();
		}
	} catch (error) {
		const message = error instanceof Error ? error.stack || error.message : String(error);
		writer.enqueue({ ...recordBase(requestId), type: "error", code: "protocol", message });
	} finally {
		if (workerIrcBus && workerIrcSessionId) {
			workerIrcBus.unregisterPeer(workerIrcSessionId, process.pid);
			workerIrcBus.close();
		}
	}
	await writer.flush();
}
