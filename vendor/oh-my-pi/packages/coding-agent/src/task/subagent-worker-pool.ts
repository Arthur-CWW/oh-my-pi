import * as path from "node:path";
import {
	decodeWorkerMessage,
	type Serializable,
	type WorkerMemoryWatermark,
	type WorkerResultMessage,
	type WorkerRunMessage,
	type WorkerToCoordinatorMessage,
	type WorkerTurnPayload,
} from "./subagent-worker-protocol";

export interface SubagentWorkerPoolOptions {
	width: number;
	maxTurnsPerWorker: number;
	/** RSS at which a worker is recycled after finishing its turn. 0 disables. */
	softWorkerRssBytes: number;
	/** RSS at which a worker is retired without taking another turn. 0 disables. */
	hardWorkerRssBytes: number;
	maxAttempts?: number;
	workerEntry?: string;
}

export interface SubagentWorkerResult {
	turnId: string;
	attempt: number;
	payload: Serializable;
	workerPid: number;
	workerRssBytes: number;
	workerTurnsCompleted: number;
	/** Set when the turn ended over a memory watermark; the worker was recycled, not killed. */
	workerMemoryWatermark?: WorkerMemoryWatermark;
}

interface TurnJob {
	sequence: number;
	turnId: string;
	attempt: number;
	payload: WorkerTurnPayload;
	resolve: (value: SubagentWorkerResult) => void;
	reject: (error: Error) => void;
}
type TurnOutcome =
	| { job: TurnJob; result: SubagentWorkerResult; error?: never }
	| { job: TurnJob; error: Error; result?: never };

interface PoolWorker {
	proc: Bun.Subprocess<"ignore", "ignore", "ignore">;
	pid: number;
	ready: boolean;
	retiring: boolean;
	job: TurnJob | undefined;
	leaseId: string | undefined;
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
	return value;
}

function watermarkBytes(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
	return value;
}

export class SubagentWorkerPool {
	readonly coordinatorPid = process.pid;
	readonly #options: Required<Omit<SubagentWorkerPoolOptions, "workerEntry">> & { workerEntry: string };
	readonly #workers = new Set<PoolWorker>();
	readonly #queue: TurnJob[] = [];
	readonly #outcomes = new Map<number, TurnOutcome>();
	#nextSequence = 0;
	#nextDelivery = 0;
	#closed = false;

	constructor(options: SubagentWorkerPoolOptions) {
		this.#options = {
			width: positiveInteger(options.width, "width"),
			maxTurnsPerWorker: positiveInteger(options.maxTurnsPerWorker, "maxTurnsPerWorker"),
			softWorkerRssBytes: watermarkBytes(options.softWorkerRssBytes, "softWorkerRssBytes"),
			hardWorkerRssBytes: watermarkBytes(options.hardWorkerRssBytes, "hardWorkerRssBytes"),
			maxAttempts: positiveInteger(options.maxAttempts ?? 3, "maxAttempts"),
			workerEntry: options.workerEntry ?? path.join(import.meta.dir, "subagent-worker-entry.ts"),
		};
	}

	run(payload: WorkerTurnPayload): Promise<SubagentWorkerResult> {
		if (this.#closed) return Promise.reject(new Error("worker pool is closed"));
		const { promise, resolve, reject } = Promise.withResolvers<SubagentWorkerResult>();
		this.#queue.push({
			sequence: this.#nextSequence++,
			turnId: crypto.randomUUID(),
			attempt: 0,
			payload,
			resolve,
			reject,
		});
		this.#schedule();
		return promise;
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		const error = new Error("worker pool closed before turn completion");
		for (const job of this.#queue.splice(0)) job.reject(error);
		for (const outcome of this.#outcomes.values()) outcome.job.reject(error);
		this.#outcomes.clear();
		for (const worker of this.#workers) {
			worker.job?.reject(error);
			worker.job = undefined;
			worker.retiring = true;
			try {
				worker.proc.kill("SIGKILL");
			} catch {
				// The worker already exited.
			}
		}
		await Promise.allSettled([...this.#workers].map(worker => worker.proc.exited));
		this.#workers.clear();
	}

	#schedule(): void {
		if (this.#closed) return;
		for (const worker of this.#workers) {
			if (this.#queue.length === 0) break;
			if (worker.ready && !worker.retiring && !worker.job) this.#assign(worker);
		}
		while (this.#queue.length > 0 && this.#workers.size < this.#options.width) this.#spawn();
	}

	#spawn(): void {
		let worker: PoolWorker;
		const proc = Bun.spawn({
			cmd: [process.execPath, this.#options.workerEntry],
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
			serialization: "advanced",
			windowsHide: true,
			ipc: raw => this.#onMessage(worker, raw),
			onExit: (_proc, exitCode, signalCode) => this.#onExit(worker, exitCode, signalCode),
		});
		worker = { proc, pid: proc.pid, ready: false, retiring: false, job: undefined, leaseId: undefined };
		this.#workers.add(worker);
	}

	#assign(worker: PoolWorker): void {
		const job = this.#queue.shift();
		if (!job) return;
		job.attempt += 1;
		const leaseId = crypto.randomUUID();
		worker.job = job;
		worker.leaseId = leaseId;
		const message: WorkerRunMessage = {
			type: "run",
			leaseId,
			turnId: job.turnId,
			attempt: job.attempt,
			payload: job.payload,
			limits: {
				maxTurns: this.#options.maxTurnsPerWorker,
				softRssBytes: this.#options.softWorkerRssBytes,
				hardRssBytes: this.#options.hardWorkerRssBytes,
			},
		};
		try {
			worker.proc.send(message);
		} catch {
			worker.retiring = true;
			try {
				worker.proc.kill("SIGKILL");
			} catch {
				// Exit handling owns retry and replacement.
			}
		}
	}

	#onMessage(worker: PoolWorker, raw: unknown): void {
		if (this.#closed || !this.#workers.has(worker)) return;
		let message: WorkerToCoordinatorMessage;
		try {
			message = decodeWorkerMessage(raw);
		} catch {
			worker.retiring = true;
			worker.proc.kill("SIGKILL");
			return;
		}
		if (message.type === "ready") {
			if (worker.ready || message.pid !== worker.pid) {
				worker.retiring = true;
				worker.proc.kill("SIGKILL");
				return;
			}
			worker.ready = true;
			this.#schedule();
			return;
		}
		if (message.type === "protocol-error") {
			worker.retiring = true;
			worker.proc.kill("SIGKILL");
			return;
		}
		this.#commitResult(worker, message);
	}

	#commitResult(worker: PoolWorker, message: WorkerResultMessage): void {
		const job = worker.job;
		if (
			!job ||
			message.pid !== worker.pid ||
			message.leaseId !== worker.leaseId ||
			message.turnId !== job.turnId ||
			message.attempt !== job.attempt
		) {
			worker.retiring = true;
			worker.proc.kill("SIGKILL");
			return;
		}

		const result: SubagentWorkerResult = {
			turnId: job.turnId,
			attempt: job.attempt,
			payload: message.payload,
			workerPid: message.pid,
			workerRssBytes: message.rssBytes,
			workerTurnsCompleted: message.turnsCompleted,
			...(message.memoryWatermark ? { workerMemoryWatermark: message.memoryWatermark } : {}),
		};
		this.#outcomes.set(job.sequence, { job, result });
		worker.job = undefined;
		worker.leaseId = undefined;
		worker.retiring = message.recycle;
		this.#flushDeliveries();

		try {
			worker.proc.send({
				type: "ack",
				leaseId: message.leaseId,
				turnId: message.turnId,
				attempt: message.attempt,
			});
		} catch {
			worker.retiring = true;
		}
		this.#schedule();
	}

	#flushDeliveries(): void {
		while (true) {
			const outcome = this.#outcomes.get(this.#nextDelivery);
			if (!outcome) return;
			this.#outcomes.delete(this.#nextDelivery++);
			if (outcome.error) outcome.job.reject(outcome.error);
			else outcome.job.resolve(outcome.result);
		}
	}

	#onExit(worker: PoolWorker, exitCode: number | null, signalCode: number | null): void {
		if (!this.#workers.delete(worker)) return;
		const job = worker.job;
		worker.job = undefined;
		if (job && !this.#closed) {
			if (job.attempt < this.#options.maxAttempts) {
				this.#queue.unshift(job);
			} else {
				const reason = exitCode !== null ? `code ${exitCode}` : `signal ${signalCode ?? "unknown"}`;
				this.#outcomes.set(job.sequence, {
					job,
					error: new Error(`worker exited with ${reason} after ${job.attempt} attempts`),
				});
				this.#flushDeliveries();
			}
		}
		this.#schedule();
	}
}
