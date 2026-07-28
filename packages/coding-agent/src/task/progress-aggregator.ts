import type { AgentProgress } from "./types";

export interface ProgressAggregatorPerformanceCounters {
	flushes: number;
	snapshotUpdates: number;
}

/**
 * Retains the latest progress object for each dispatch index and publishes one
 * ordered projection per event-loop turn. Unchanged objects keep their identity
 * so row renderers can reuse child-id snapshots.
 */
export class ProgressAggregator {
	#byIndex: Array<AgentProgress | undefined> = [];
	#flushTimer: ReturnType<typeof setTimeout> | undefined;
	#dirty = false;
	#flushes = 0;
	#snapshotUpdates = 0;
	readonly #onFlush: (progress: readonly AgentProgress[]) => void;

	constructor(onFlush: (progress: readonly AgentProgress[]) => void) {
		this.#onFlush = onFlush;
	}

	update(index: number, progress: AgentProgress): void {
		this.#byIndex[index] = progress;
		this.#snapshotUpdates++;
		this.#dirty = true;
		if (this.#flushTimer !== undefined) return;
		this.#flushTimer = setTimeout(() => {
			this.#flushTimer = undefined;
			this.flush();
		}, 0);
	}

	flush(): void {
		clearTimeout(this.#flushTimer);
		this.#flushTimer = undefined;
		if (!this.#dirty) return;
		this.#dirty = false;
		this.#flushes++;
		this.#onFlush(this.#byIndex.filter((progress): progress is AgentProgress => progress !== undefined));
	}

	dispose(): void {
		clearTimeout(this.#flushTimer);
		this.#flushTimer = undefined;
		this.#dirty = false;
		this.#byIndex = [];
	}

	getPerformanceCounters(): Readonly<ProgressAggregatorPerformanceCounters> {
		return { flushes: this.#flushes, snapshotUpdates: this.#snapshotUpdates };
	}
}
