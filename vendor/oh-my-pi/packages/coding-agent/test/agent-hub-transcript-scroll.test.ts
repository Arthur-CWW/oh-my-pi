import { beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { type JournalTailChunk, readJournalTailChunkAsync } from "@oh-my-pi/pi-coding-agent/journal/projection";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import {
	AgentHubJournalTailCache,
	type AgentHubJournalTailReader,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-performance";
import { TranscriptViewportModel } from "@oh-my-pi/pi-coding-agent/modes/components/transcript-viewport";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type {
	AgentSession,
	AgentSessionEvent,
	AgentSessionEventListener,
} from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { TempDir } from "@oh-my-pi/pi-utils";

const LINE_COUNT = 300_000;
const VIEWPORT_HEIGHT = 41;
const SIBLING_COUNT = 5;
const SIBLING_CONTENT_BYTES = 6 * 1024 * 1024;

interface LiveSessionControl {
	readonly session: AgentSession;
	emit(event: AgentSessionEvent): void;
}

interface HubHarness {
	readonly hub: AgentHubOverlayComponent;
	readonly observers: SessionObserverRegistry;
	readonly renderBarrier: GenerationBarrier;
}

class GenerationBarrier {
	#generation = 0;
	readonly #waiters: Array<{ after: number; resolve: () => void }> = [];

	get generation(): number {
		return this.#generation;
	}

	signal(): void {
		this.#generation++;
		for (let index = this.#waiters.length - 1; index >= 0; index--) {
			const waiter = this.#waiters[index];
			if (waiter && this.#generation > waiter.after) {
				this.#waiters.splice(index, 1);
				waiter.resolve();
			}
		}
	}

	waitAfter(generation: number): Promise<void> {
		if (this.#generation > generation) return Promise.resolve();
		const completion = Promise.withResolvers<void>();
		this.#waiters.push({ after: generation, resolve: completion.resolve });
		return completion.promise;
	}
}

interface JournalReadRequest {
	readonly filePath: string;
	readonly fromByte: number;
	readonly maxBytes: number;
	resolve(result: JournalTailChunk | null): void;
}

class ControlledJournalReads {
	readonly #pending: JournalReadRequest[] = [];

	readonly reader: AgentHubJournalTailReader = (filePath, fromByte, maxBytes) => {
		const completion = Promise.withResolvers<JournalTailChunk | null>();
		const request: JournalReadRequest = {
			filePath,
			fromByte,
			maxBytes,
			resolve: completion.resolve,
		};
		this.#pending.push(request);
		return completion.promise;
	};

	get pendingCount(): number {
		return this.#pending.length;
	}

	latest(): JournalReadRequest {
		const request = this.#pending.at(-1);
		if (!request) throw new Error("journal read did not reach its barrier");
		this.#pending.length = 0;
		return request;
	}
}

function controlledLiveSession(): LiveSessionControl {
	let listener: AgentSessionEventListener | undefined;
	return {
		session: {
			subscribe: (nextListener: AgentSessionEventListener) => {
				listener = nextListener;
				return () => {
					if (listener === nextListener) listener = undefined;
				};
			},
		} as unknown as AgentSession,
		emit: event => listener?.(event),
	};
}

function journalMessage(id: string, content: string): string {
	return `${JSON.stringify({
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-07-27T00:00:00.000Z",
		message: { role: "user", content, timestamp: 1 },
	})}\n`;
}

function registerWorker(registry: AgentRegistry, id: string, sessionFile: string, session: AgentSession): void {
	registry.register({
		id,
		displayName: id,
		kind: "sub",
		parentId: "Main",
		session,
		sessionFile,
		status: "running",
	});
}

function createHub(
	registry: AgentRegistry,
	journalTails?: AgentHubJournalTailCache,
	transcriptWrap = false,
): HubHarness {
	const observers = new SessionObserverRegistry();
	const renderBarrier = new GenerationBarrier();
	return {
		hub: new AgentHubOverlayComponent({
			observers,
			hubKeys: [],
			onDone: () => {},
			requestRender: () => renderBarrier.signal(),
			registry,
			irc: new IrcBus(registry),
			externalIrc: null,
			journalTails,
			transcriptDisplay: { transcriptWrap, richTranscript: true },
		}),
		observers,
		renderBarrier,
	};
}

function count(text: string, needle: string): number {
	let matches = 0;
	let offset = text.indexOf(needle);
	while (offset >= 0) {
		matches++;
		offset = text.indexOf(needle, offset + needle.length);
	}
	return matches;
}

beforeAll(async () => {
	await initTheme();
});

describe("full subagent transcript scrolling", () => {
	it("loads a 300K-line journal record from byte zero", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-full-transcript-");
		const sessionFile = `${tempDir.path()}/Worker.jsonl`;
		const content = Array.from({ length: LINE_COUNT }, (_, index) => `line-${index}`).join("\n");
		await Bun.write(sessionFile, journalMessage("large-message", content));

		const reads = new ControlledJournalReads();
		const registry = new AgentRegistry();
		const { hub, observers, renderBarrier } = createHub(registry, new AgentHubJournalTailCache(reads.reader));
		registerWorker(registry, "Worker", sessionFile, controlledLiveSession().session);
		try {
			hub.openChat("Worker");
			hub.render(120);
			expect(reads.pendingCount).toBeGreaterThan(0);
			const request = reads.latest();
			const result = await readJournalTailChunkAsync(request.filePath, request.fromByte, request.maxBytes);
			const loadGeneration = renderBarrier.generation;
			request.resolve(result);
			await renderBarrier.waitAfter(loadGeneration);

			expect(hub.getRetentionMetrics()).toMatchObject({
				cachedTranscriptEntries: 1,
				materializedChatComponents: 1,
				retainedJournalTextBytes: 0,
			});
			expect(hub.getRetentionMetrics().materializedTranscriptRows).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
		} finally {
			hub.dispose();
			observers.dispose();
		}
	});

	it("keeps every row reachable while materializing only the viewport", () => {
		const rows = Array.from({ length: LINE_COUNT }, (_, index) => `line-${index}`);
		const viewport = new TranscriptViewportModel<string>();
		viewport.layout(rows, VIEWPORT_HEIGHT, true);

		expect(viewport.totalRows).toBe(LINE_COUNT);
		expect(viewport.visibleRowCount).toBe(VIEWPORT_HEIGHT);
		expect(viewport.visibleRows()).toHaveLength(VIEWPORT_HEIGHT);
		expect(viewport.visibleRows().at(-1)).toBe(`line-${LINE_COUNT - 1}`);

		viewport.scrollToTop();
		expect(viewport.followsTail).toBeFalse();
		expect(viewport.visibleRows()[0]).toBe("line-0");
		for (let offset = 0; offset <= viewport.maxOffset; offset += VIEWPORT_HEIGHT) {
			viewport.setOffset(offset);
			expect(viewport.visibleRows()[0]).toBe(rows[offset]);
		}
		viewport.scrollToBottom();
		expect(viewport.followsTail).toBeTrue();
		viewport.scrollBy(-1);
		expect(viewport.followsTail).toBeFalse();
		viewport.scrollBy(1);
		expect(viewport.followsTail).toBeTrue();
		viewport.setOffset(viewport.maxOffset);
		expect(viewport.followsTail).toBeFalse();
		expect(viewport.visibleRows().at(-1)).toBe(`line-${LINE_COUNT - 1}`);

		viewport.setOffset(123_456);
		const stableOffset = viewport.offset;
		viewport.layout(rows, VIEWPORT_HEIGHT, true);
		expect(viewport.offset).toBe(stableOffset);
		expect(viewport.visibleRows()[0]).toBe("line-123456");
		expect(viewport.visibleRowCount).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
	});

	it("preserves gg top intent when an empty transcript grows", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-empty-append-");
		const sessionFile = `${tempDir.path()}/Worker.jsonl`;
		await Bun.write(sessionFile, "");

		const reads = new ControlledJournalReads();
		const live = controlledLiveSession();
		const registry = new AgentRegistry();
		const { hub, observers, renderBarrier } = createHub(registry, new AgentHubJournalTailCache(reads.reader));
		registerWorker(registry, "Worker", sessionFile, live.session);
		try {
			hub.openChat("Worker");
			hub.render(120);
			expect(reads.pendingCount).toBeGreaterThan(0);
			const emptyRequest = reads.latest();
			const emptyResult = await readJournalTailChunkAsync(
				emptyRequest.filePath,
				emptyRequest.fromByte,
				emptyRequest.maxBytes,
			);
			let loadGeneration = renderBarrier.generation;
			emptyRequest.resolve(emptyResult);
			await renderBarrier.waitAfter(loadGeneration);
			hub.render(120);

			hub.handleInput("g");
			hub.handleInput("g");

			const entryCount = VIEWPORT_HEIGHT * 3;
			const appended = Array.from({ length: entryCount }, (_, index) =>
				journalMessage(
					`append-${index}`,
					index === 0 ? "TOP_APPEND_MARKER" : index === entryCount - 1 ? "BOTTOM_APPEND_MARKER" : `row-${index}`,
				),
			).join("");
			await fs.appendFile(sessionFile, appended);
			live.emit({ type: "message_end", message: { role: "assistant" } } as AgentSessionEvent);
			hub.render(120);
			const appendRequest = reads.latest();
			const appendResult = await readJournalTailChunkAsync(
				appendRequest.filePath,
				appendRequest.fromByte,
				appendRequest.maxBytes,
			);

			loadGeneration = renderBarrier.generation;
			appendRequest.resolve(appendResult);
			await renderBarrier.waitAfter(loadGeneration);
			const rendered = hub.render(120).join("\n");
			expect(hub.getRetentionMetrics().cachedTranscriptEntries).toBe(entryCount);
			expect(rendered).toContain("TOP_APPEND_MARKER");
			expect(rendered).not.toContain("BOTTOM_APPEND_MARKER");
		} finally {
			hub.dispose();
			observers.dispose();
		}
	});

	it("follows live appends after grammar down movements reach the tail", async () => {
		for (const transcriptWrap of [false, true]) {
			using tempDir = TempDir.createSync("@omp-agent-hub-grammar-tail-");
			const sessionFile = `${tempDir.path()}/Worker.jsonl`;
			const entryCount = VIEWPORT_HEIGHT * 3;
			const initial = Array.from({ length: entryCount }, (_, index) =>
				journalMessage(`initial-${index}`, `row-${index}`),
			).join("");
			await Bun.write(sessionFile, initial);

			const reads = new ControlledJournalReads();
			const live = controlledLiveSession();
			const registry = new AgentRegistry();
			const { hub, observers, renderBarrier } = createHub(
				registry,
				new AgentHubJournalTailCache(reads.reader),
				transcriptWrap,
			);
			registerWorker(registry, "Worker", sessionFile, live.session);
			try {
				hub.openChat("Worker");
				hub.render(120);
				const initialRequest = reads.latest();
				const initialResult = await readJournalTailChunkAsync(
					initialRequest.filePath,
					initialRequest.fromByte,
					initialRequest.maxBytes,
				);
				let loadGeneration = renderBarrier.generation;
				initialRequest.resolve(initialResult);
				await renderBarrier.waitAfter(loadGeneration);
				hub.render(120);

				hub.handleInput("g");
				hub.handleInput("g");
				for (let index = 0; index < entryCount * 8; index++) {
					hub.handleInput("g");
					hub.handleInput("j");
				}

				const marker = transcriptWrap ? "DISPLAY_ROW_APPEND_MARKER" : "LOGICAL_ROW_APPEND_MARKER";
				await fs.appendFile(sessionFile, journalMessage("live-append", marker));
				live.emit({ type: "message_end", message: { role: "assistant" } } as AgentSessionEvent);
				hub.render(120);
				const appendRequest = reads.latest();
				const appendResult = await readJournalTailChunkAsync(
					appendRequest.filePath,
					appendRequest.fromByte,
					appendRequest.maxBytes,
				);
				loadGeneration = renderBarrier.generation;
				appendRequest.resolve(appendResult);
				await renderBarrier.waitAfter(loadGeneration);

				expect(hub.render(120).join("\n")).toContain(marker);
			} finally {
				hub.dispose();
				observers.dispose();
			}
		}
	});

	it("discards a superseded full read and reschedules from the current byte", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-stale-transcript-");
		const sessionFile = `${tempDir.path()}/Worker.jsonl`;
		await Bun.write(sessionFile, journalMessage("first", "FIRST_MARKER"));

		const reads = new ControlledJournalReads();
		const journalTails = new AgentHubJournalTailCache(reads.reader);
		const live = controlledLiveSession();
		const registry = new AgentRegistry();
		const { hub, observers, renderBarrier } = createHub(registry, journalTails);
		registerWorker(registry, "Worker", sessionFile, live.session);
		try {
			hub.openChat("Worker");
			hub.render(120);
			expect(reads.pendingCount).toBeGreaterThan(0);
			const staleRequest = reads.latest();
			expect(staleRequest.fromByte).toBe(0);
			const staleResult = await readJournalTailChunkAsync(
				staleRequest.filePath,
				staleRequest.fromByte,
				staleRequest.maxBytes,
			);
			if (!staleResult) throw new Error("initial transcript snapshot was unavailable");

			await fs.appendFile(sessionFile, journalMessage("second", "SECOND_MARKER"));
			live.emit({ type: "message_end", message: { role: "assistant" } } as AgentSessionEvent);
			hub.render(120);
			const currentRequest = reads.latest();
			expect(currentRequest.fromByte).toBe(0);
			const currentResult = await readJournalTailChunkAsync(
				currentRequest.filePath,
				currentRequest.fromByte,
				currentRequest.maxBytes,
			);
			if (!currentResult) throw new Error("replacement transcript snapshot was unavailable");

			let applyGeneration = renderBarrier.generation;
			currentRequest.resolve(currentResult);
			await renderBarrier.waitAfter(applyGeneration);
			expect(hub.getRetentionMetrics().cachedTranscriptEntries).toBe(2);

			applyGeneration = renderBarrier.generation;
			staleRequest.resolve(staleResult);
			await renderBarrier.waitAfter(applyGeneration);

			const rendered = hub.render(120).join("\n");
			expect(count(rendered, "FIRST_MARKER")).toBe(1);
			expect(count(rendered, "SECOND_MARKER")).toBe(1);
			expect(hub.getRetentionMetrics().cachedTranscriptEntries).toBe(2);
			expect(hub.getRetentionMetrics().retainedJournalTextBytes).toBe(0);
		} finally {
			hub.dispose();
			observers.dispose();
		}
	});

	it("does not retain serialized journals across sequential large siblings", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-sibling-retention-");
		const content = "x".repeat(SIBLING_CONTENT_BYTES);
		const workers: Array<{ id: string; sessionFile: string }> = [];
		let serializedBytes = 0;
		for (let index = 0; index < SIBLING_COUNT; index++) {
			const id = `Worker${index}`;
			const sessionFile = `${tempDir.path()}/${id}.jsonl`;
			const serialized = journalMessage(`message-${index}`, `${id}\n${content}\nEND_${id}`);
			serializedBytes = Buffer.byteLength(serialized, "utf-8");
			await Bun.write(sessionFile, serialized);
			workers.push({ id, sessionFile });
		}

		const reads = new ControlledJournalReads();
		const registry = new AgentRegistry();
		const { hub, observers, renderBarrier } = createHub(registry, new AgentHubJournalTailCache(reads.reader));
		for (const worker of workers) {
			registerWorker(registry, worker.id, worker.sessionFile, controlledLiveSession().session);
		}
		let rssAfterOne = 0;
		try {
			for (let index = 0; index < workers.length; index++) {
				const worker = workers[index];
				hub.openChat(worker.id);
				hub.render(120);
				expect(reads.pendingCount).toBeGreaterThan(0);
				const request = reads.latest();
				const result = await readJournalTailChunkAsync(request.filePath, request.fromByte, request.maxBytes);
				const loadGeneration = renderBarrier.generation;
				request.resolve(result);
				await renderBarrier.waitAfter(loadGeneration);
				expect(hub.getRetentionMetrics().retainedJournalTextBytes).toBe(0);
				Bun.gc(true);
				if (index === 0) rssAfterOne = process.memoryUsage().rss;
			}
			Bun.gc(true);
			const rssAfterAll = process.memoryUsage().rss;
			process.stdout.write(
				`agent-hub sequential transcript RSS: one=${rssAfterOne} all=${rssAfterAll} delta=${rssAfterAll - rssAfterOne} siblings=${SIBLING_COUNT} serialized=${serializedBytes}\n`,
			);
			expect(hub.getRetentionMetrics().cachedTranscriptEntries).toBe(1);
			expect(hub.getRetentionMetrics().materializedTranscriptRows).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
			expect(hub.getRetentionMetrics().retainedJournalTextBytes).toBe(0);
			expect(rssAfterAll - rssAfterOne).toBeLessThan(serializedBytes * 2);
		} finally {
			hub.dispose();
			observers.dispose();
		}
	});
});
