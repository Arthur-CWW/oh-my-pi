import { logger } from "@oh-my-pi/pi-utils";

interface ProgressUpdate {
	text: string;
	details?: Record<string, unknown>;
}

type ProgressCallback = (text: string, details?: Record<string, unknown>) => void | Promise<void>;

/** Coalesces same-turn progress updates while preserving the latest snapshot. */
export class ProgressCoalescer {
	#latest: ProgressUpdate | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#pending: Promise<void> | undefined;

	constructor(
		private readonly jobId: string,
		private readonly callback: ProgressCallback | undefined,
	) {}

	report(text: string, details?: Record<string, unknown>): Promise<void> {
		if (!this.callback) return Promise.resolve();
		this.#latest = { text, details };
		if (!this.#pending) {
			this.#pending = new Promise<void>(resolve => {
				this.#timer = setTimeout(() => void this.#drain().then(resolve), 0);
			}).finally(() => {
				this.#pending = undefined;
			});
		}
		return this.#pending;
	}

	flush(): Promise<void> {
		return this.#pending ?? Promise.resolve();
	}

	async #drain(): Promise<void> {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		while (this.#latest) {
			const current = this.#latest;
			this.#latest = undefined;
			try {
				await this.callback?.(current.text, current.details);
			} catch (error) {
				logger.warn("Async job progress callback failed", {
					jobId: this.jobId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}
}
