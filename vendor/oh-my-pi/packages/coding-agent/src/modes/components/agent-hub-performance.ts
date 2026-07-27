import type { JournalTailChunk } from "../../journal/projection";
import { JOURNAL_TAIL_BYTES, readJournalTailChunkAsync } from "../../journal/projection";

export interface AgentHubPerfCounters {
	journalReads: number;
	projectionRebuilds: number;
}

const counters: AgentHubPerfCounters = {
	journalReads: 0,
	projectionRebuilds: 0,
};

export function getAgentHubPerfCounters(): Readonly<AgentHubPerfCounters> {
	return { ...counters };
}

export function resetAgentHubPerfCounters(): void {
	counters.journalReads = 0;
	counters.projectionRebuilds = 0;
}

export function recordAgentHubProjectionRebuild(): void {
	counters.projectionRebuilds++;
}

interface CachedTail {
	fromByte: number;
	newSize?: number;
	result?: JournalTailChunk | null;
}

export type AgentHubJournalTailReader = (
	filePath: string,
	fromByte: number,
	maxBytes: number,
) => Promise<JournalTailChunk | null>;

/** Single-flight async journal tails. Callers explicitly invalidate when an append notification arrives. */
export class AgentHubJournalTailCache {
	readonly #cache = new Map<string, CachedTail>();
	readonly #inFlight = new Map<string, Promise<JournalTailChunk | null>>();
	readonly #versions = new Map<string, number>();
	readonly #readTail: AgentHubJournalTailReader;
	#retainedTextBytes = 0;

	constructor(readTail: AgentHubJournalTailReader = readJournalTailChunkAsync) {
		this.#readTail = readTail;
	}

	get retainedTextBytes(): number {
		return this.#retainedTextBytes;
	}

	invalidate(filePath: string): void {
		this.#versions.set(filePath, (this.#versions.get(filePath) ?? 0) + 1);
		this.#deleteCached(filePath);
		this.#inFlight.delete(filePath);
	}

	peek(filePath: string, fromByte: number): JournalTailChunk | null | undefined {
		const cached = this.#cache.get(filePath);
		if (cached?.fromByte === fromByte) {
			if ("result" in cached) return cached.result;
			return { text: "", fromByte, newSize: cached.newSize ?? fromByte };
		}
		if (cached?.newSize === fromByte) return { text: "", fromByte, newSize: fromByte };
		return undefined;
	}

	/**
	 * Replace an ingested raw chunk with scalar read metadata. The next append
	 * invalidation will make the unread suffix eligible for another read.
	 */
	releaseText(filePath: string, fromByte: number, newSize: number): void {
		const cached = this.#cache.get(filePath);
		if (!cached || cached.fromByte !== fromByte || (cached.result !== null && cached.result?.newSize !== newSize))
			return;
		this.#setCached(filePath, { fromByte, newSize });
	}

	load(filePath: string, fromByte = 0, maxBytes = JOURNAL_TAIL_BYTES): Promise<JournalTailChunk | null> {
		const cached = this.peek(filePath, fromByte);
		if (cached !== undefined) return Promise.resolve(cached);
		const pending = this.#inFlight.get(filePath);
		if (pending) return pending;
		counters.journalReads++;
		const version = this.#versions.get(filePath) ?? 0;
		const request = this.#readTail(filePath, fromByte, maxBytes).then(result => {
			if ((this.#versions.get(filePath) ?? 0) === version)
				this.#setCached(filePath, { fromByte, newSize: result?.newSize, result });
			return result;
		});
		this.#inFlight.set(filePath, request);
		void request.finally(() => {
			if (this.#inFlight.get(filePath) === request) this.#inFlight.delete(filePath);
		});
		return request;
	}

	#setCached(filePath: string, cached: CachedTail): void {
		this.#deleteCached(filePath);
		this.#cache.set(filePath, cached);
		const text = cached.result?.text;
		if (text) this.#retainedTextBytes += Buffer.byteLength(text, "utf-8");
	}

	#deleteCached(filePath: string): void {
		const text = this.#cache.get(filePath)?.result?.text;
		if (text) this.#retainedTextBytes -= Buffer.byteLength(text, "utf-8");
		this.#cache.delete(filePath);
	}
}
