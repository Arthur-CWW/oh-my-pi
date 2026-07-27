import { MEMORY_SAMPLE_INTERVAL_MS } from "../../../utils/process-memory";

const GIB = 1024 ** 3;

export interface MemoryFootprintSamplerOptions {
	readRss: () => number;
	now: () => number;
}

function formatGibibytes(rssBytes: number): string {
	const gibibytes = rssBytes / GIB;
	if (gibibytes < 10) return gibibytes.toFixed(1);
	if (gibibytes < 100) return Math.round(gibibytes).toString();
	return "99+";
}

/** Throttles the relatively expensive process RSS query across status-line frames. */
export class MemoryFootprintSampler {
	readonly #readRss: () => number;
	readonly #now: () => number;
	#lastSampleAt: number | undefined;
	#rssBytes = 0;

	constructor(options: MemoryFootprintSamplerOptions) {
		this.#readRss = options.readRss;
		this.#now = options.now;
	}

	getBadge(memoryWatermarkBytes: number): string | null {
		if (memoryWatermarkBytes === 0) return null;

		const now = this.#now();
		if (this.#lastSampleAt === undefined || now - this.#lastSampleAt >= MEMORY_SAMPLE_INTERVAL_MS) {
			this.#rssBytes = this.#readRss();
			this.#lastSampleAt = now;
		}
		if (this.#rssBytes < memoryWatermarkBytes) return null;

		return `mem ${formatGibibytes(this.#rssBytes)}G ↻ /restart reclaims`;
	}
}

export const processMemoryFootprintSampler = new MemoryFootprintSampler({
	readRss: () => process.memoryUsage.rss(),
	now: Date.now,
});
