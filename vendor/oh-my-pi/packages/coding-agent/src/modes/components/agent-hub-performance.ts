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
	result: JournalTailChunk | null;
}

/** Single-flight async journal tails. Callers explicitly invalidate when an append notification arrives. */
export class AgentHubJournalTailCache {
	readonly #cache = new Map<string, CachedTail>();
	readonly #inFlight = new Map<string, Promise<JournalTailChunk | null>>();
	readonly #versions = new Map<string, number>();

	invalidate(filePath: string): void {
		this.#versions.set(filePath, (this.#versions.get(filePath) ?? 0) + 1);
		this.#cache.delete(filePath);
		this.#inFlight.delete(filePath);
	}

	peek(filePath: string, fromByte: number): JournalTailChunk | null | undefined {
		const cached = this.#cache.get(filePath);
		if (cached?.fromByte === fromByte) return cached.result;
		if (cached?.result && cached.result.newSize === fromByte)
			return { text: "", fromByte, newSize: fromByte };
		return undefined;
	}

	load(filePath: string, fromByte = 0, maxBytes = JOURNAL_TAIL_BYTES): Promise<JournalTailChunk | null> {
		const cached = this.peek(filePath, fromByte);
		if (cached !== undefined) return Promise.resolve(cached);
		const pending = this.#inFlight.get(filePath);
		if (pending) return pending;
		counters.journalReads++;
		const version = this.#versions.get(filePath) ?? 0;
		const request = readJournalTailChunkAsync(filePath, fromByte, maxBytes).then(result => {
			if ((this.#versions.get(filePath) ?? 0) === version) this.#cache.set(filePath, { fromByte, result });
			return result;
		});
		this.#inFlight.set(filePath, request);
		void request.finally(() => {
			if (this.#inFlight.get(filePath) === request) this.#inFlight.delete(filePath);
		});
		return request;
	}
}
