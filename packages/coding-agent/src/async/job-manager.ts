import { logger } from "@oh-my-pi/pi-utils";
import {
	type ChildRouteUpdateReport,
	childRouteUpdateStatus,
	onChildRouteUpdate,
} from "../task/child-route-update";
import { MEMORY_SAMPLE_INTERVAL_MS } from "../utils/process-memory";
import { ProgressCoalescer } from "./progress-coalescer";

const DELIVERY_RETRY_BASE_MS = 500;
const DELIVERY_RETRY_MAX_MS = 30_000;
const DELIVERY_RETRY_JITTER_MS = 200;
const DEFAULT_RETENTION_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RUNNING_JOBS = 15;
const DEFAULT_COMPLETION_SUMMARY_BYTES = 32 * 1024;
const JOB_METADATA_ESTIMATE_BYTES = 512;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

/**
 * Adaptive ("smart") `job` poll-wait ladder (ms). A tight poll loop climbs
 * these rungs so each immediate re-poll backs off and stops spending turns on
 * "still running" frames; the floor (first rung) is the shortest wait and the
 * top rung is the longest a smart poll will ever block. Only used when
 * `async.pollWaitDuration` is set to `smart`; fixed durations wait verbatim.
 */
const POLL_WAIT_LADDER_MS = [5_000, 10_000, 30_000, 60_000, 300_000] as const;
/**
 * Going at least this long between poll calls means the agent stepped out of
 * the poll loop to do real work — the next poll drops back to the ladder floor.
 */
const POLL_ESCALATION_RESET_MS = 60_000;

const ASYNC_JOB_INTERRUPT_REASON_TYPE = "omp:async-job-interrupt";

export interface AsyncJobInterruptReason {
	type: typeof ASYNC_JOB_INTERRUPT_REASON_TYPE;
	requestedBy?: string;
	reason?: string;
}

export function isAsyncJobInterruptReason(value: unknown): value is AsyncJobInterruptReason {
	if (!value || typeof value !== "object") return false;
	return (value as { type?: unknown }).type === ASYNC_JOB_INTERRUPT_REASON_TYPE;
}

export function createAsyncJobInterruptReason(
	requestedBy: string | undefined,
	reason: string | undefined,
): AsyncJobInterruptReason {
	return {
		type: ASYNC_JOB_INTERRUPT_REASON_TYPE,
		...(requestedBy ? { requestedBy } : {}),
		...(reason ? { reason } : {}),
	};
}

interface PollEscalationState {
	/** Index into POLL_WAIT_LADDER_MS used for the most recent poll wait. */
	level: number;
	/** Timestamp (ms) when the most recent poll wait returned. */
	lastPollEndAt: number;
}

export type AsyncJobGroupTopology = "flat" | "supervised";
export type AsyncJobGroupReporting = "main" | "hub";

export interface AsyncJobGroupConfiguration {
	topology: AsyncJobGroupTopology;
	reporting: AsyncJobGroupReporting;
}

export interface AsyncJobGroupMetadata extends AsyncJobGroupConfiguration {
	/** Stable root agent id derived from AgentRegistry parentage. */
	groupId: string;
	/** Immediate supervisor for a supervised leaf; absent for group coordinators. */
	coordinatorId?: string;
}

const DEFAULT_GROUP_CONFIGURATION: AsyncJobGroupConfiguration = {
	topology: "flat",
	reporting: "main",
};

export interface AsyncJob {
	id: string;
	type: "bash" | "task";
	status: "running" | "waiting-provider" | "completed" | "failed" | "cancelled";
	startTime: number;
	label: string;
	abortController: AbortController;
	promise: Promise<void>;
	resultText?: string;
	errorText?: string;
	providerRecovery?: {
		reason: "auth-invalid" | "rate-limit";
		userAction: "refresh-credentials" | "wait-for-reset";
		retryAt?: number;
	};
	interruptRequested?: boolean;
	interruptReason?: string;
	interruptRequestedBy?: string;
	interrupted?: boolean;
	hardCancelled?: boolean;
	isolated?: boolean;
	/** Ownership was relinquished without aborting the underlying detached work. */
	detached?: boolean;
	/**
	 * Registry id of the agent that registered the job (e.g. "Main",
	 * "AuthLoader"). Used by scoped cancel/list APIs so a subagent's teardown
	 * does not cancel its parent's jobs. Undefined for callers that don't
	 * supply an id (e.g. legacy tests, SDK consumers without an agent context).
	 */
	ownerId?: string;
	/** Snapshot group routing metadata. Group configuration changes affect only later registrations. */
	group?: AsyncJobGroupMetadata;
	/** Monotonic result revision used to fence durable parent receipt admission. */
	completionSequence: number;
	/**
	 * Job is registered but parked behind a caller-managed gate (e.g. a task
	 * batch semaphore). Queued jobs do not count toward the running-job limit
	 * until the caller invokes `markRunning()` from the run context.
	 */
	queued?: boolean;
	/** Latest known route-update answer, including an explicit unavailable or corrupt answer. */
	routeUpdate?: ChildRouteUpdateReport;
}

export interface AsyncJobManagerOptions {
	onJobComplete: (jobId: string, text: string, job: AsyncJob | undefined, sequence: number) => void | Promise<void>;
	onJobAcknowledge?: (receipts: readonly AsyncJobDeliveryAcknowledgement[]) => void | Promise<void>;
	maxRunningJobs?: number;
	retentionMs?: number;
	/** Maximum UTF-8 bytes retained for a terminal job after reliable delivery. */
	completionSummaryBytes?: number;
	/**
	 * Coordinator RSS threshold that evicts delivered terminal detail.
	 * Disabled when omitted or 0. RSS, not heap-used: JSC heap is a rounding
	 * error next to the native footprint that actually forces a restart.
	 */
	memoryPressureBytes?: number;
	/** RSS reader for the pressure sweep. Injected by tests; defaults to this process. */
	readRss?: () => number;
	/** Pressure sweep cadence. Defaults to the status-line RSS sampling interval. */
	memoryPressureIntervalMs?: number;
}

export interface AsyncJobMemoryReport {
	running: { count: number; estimatedBytes: number };
	terminal: { count: number; estimatedBytes: number };
	deliveries: { count: number; estimatedBytes: number };
	timers: { count: number; estimatedBytes: number };
	totalEstimatedBytes: number;
	pressureEvictions: number;
}

interface AsyncJobDelivery {
	jobId: string;
	text: string;
	attempt: number;
	sequence: number;
	nextAttemptAt: number;
	lastError?: string;
	ownerId?: string;
	promise?: Promise<void>;
}

export interface AsyncJobDeliveryAcknowledgement {
	agentId: string;
	jobId: string;
	sequence: number;
	job: AsyncJob;
}

export function asyncJobCompletionAgentId(job: AsyncJob): string {
	return job.type === "task" ? job.id : (job.ownerId ?? job.id);
}

export interface AsyncJobDeliveryState {
	queued: number;
	delivering: boolean;
	nextRetryAt?: number;
	pendingJobIds: string[];
}

export interface AsyncJobRegisterOptions {
	id?: string;
	/** Registry id of the agent that owns this job; used to scope cancelAll. */
	ownerId?: string;
	/** Stable group root and immediate supervisor, both derived from AgentRegistry parentage. */
	group?: Pick<AsyncJobGroupMetadata, "groupId" | "coordinatorId">;
	onProgress?: (text: string, details?: Record<string, unknown>) => void | Promise<void>;
	/** Register the job in queued state; see {@link AsyncJob.queued}. */
	queued?: boolean;
	/** Isolated task jobs cannot be kept alive after an interrupt. */
	isolated?: boolean;
	/** Reuse a stable id after its prior terminal projection settled; never replaces live work. */
	replaceTerminal?: boolean;
}

/**
 * Filter applied to job query/cancel APIs. With `ownerId`, results are
 * restricted to jobs registered by that agent (registry id from
 * `AgentRegistry`, e.g. "Main", "AuthLoader").
 */
export interface AsyncJobFilter {
	ownerId?: string;
}

export interface AsyncJobDetachFilter extends AsyncJobFilter {
	type?: AsyncJob["type"];
}

export class AsyncJobManager {
	static #instance: AsyncJobManager | undefined;

	/** Process-global instance shared by internal URL protocol handlers and tools. */
	static instance(): AsyncJobManager | undefined {
		return AsyncJobManager.#instance;
	}

	/** Install or clear the process-global instance. */
	static setInstance(value: AsyncJobManager | undefined): void {
		AsyncJobManager.#instance = value;
	}

	/** Reset the process-global instance. Test-only. */
	static resetForTests(): void {
		AsyncJobManager.#instance = undefined;
	}

	readonly #jobs = new Map<string, AsyncJob>();
	readonly #deliveries: AsyncJobDelivery[] = [];
	readonly #inFlightDeliveries: AsyncJobDelivery[] = [];
	readonly #suppressedDeliveries = new Set<string>();
	readonly #watchedJobs = new Set<string>();
	readonly #evictionTimers = new Map<string, NodeJS.Timeout>();
	readonly #pollEscalation = new Map<string | undefined, PollEscalationState>();
	readonly #groupConfigurations = new Map<string, AsyncJobGroupConfiguration>();
	readonly #onJobComplete: AsyncJobManagerOptions["onJobComplete"];
	readonly #onJobAcknowledge: AsyncJobManagerOptions["onJobAcknowledge"];
	readonly #maxRunningJobs: number;
	readonly #retentionMs: number;
	readonly #completionSummaryBytes: number;
	readonly #memoryPressureBytes: number;
	readonly #readRss: () => number;
	readonly #pressureSweep: NodeJS.Timeout | undefined;
	readonly #routeUpdateUnsubscribe: () => void;
	#pressureEvictions = 0;
	#deliveryLoop: Promise<void> | undefined;
	#disposed = false;

	#filterJobs(jobs: Iterable<AsyncJob>, filter?: AsyncJobFilter): AsyncJob[] {
		const ownerId = filter?.ownerId;
		if (!ownerId) return Array.from(jobs);
		const out: AsyncJob[] = [];
		for (const job of jobs) {
			if (job.ownerId === ownerId) out.push(job);
		}
		return out;
	}

	constructor(options: AsyncJobManagerOptions) {
		this.#onJobComplete = options.onJobComplete;
		this.#onJobAcknowledge = options.onJobAcknowledge;
		this.#maxRunningJobs = Math.max(1, Math.floor(options.maxRunningJobs ?? DEFAULT_MAX_RUNNING_JOBS));
		this.#retentionMs = Math.max(0, Math.floor(options.retentionMs ?? DEFAULT_RETENTION_MS));
		this.#completionSummaryBytes = Math.max(
			0,
			Math.floor(options.completionSummaryBytes ?? DEFAULT_COMPLETION_SUMMARY_BYTES),
		);
		this.#memoryPressureBytes = Math.max(0, Math.floor(options.memoryPressureBytes ?? 0));
		this.#readRss = options.readRss ?? (() => process.memoryUsage.rss());
		if (this.#memoryPressureBytes > 0) {
			const intervalMs = Math.max(1, Math.floor(options.memoryPressureIntervalMs ?? MEMORY_SAMPLE_INTERVAL_MS));
			this.#pressureSweep = setInterval(() => this.enforceMemoryPressure(), intervalMs);
			// A memory sweep must never be the reason the process stays alive.
			this.#pressureSweep.unref();
		}
		this.#routeUpdateUnsubscribe = onChildRouteUpdate(notification => {
			const status = childRouteUpdateStatus(notification.record);
			if (status) {
				this.setRouteUpdate(notification.agentId, { availability: "known", status });
			}
		});
	}

	/**
	 * Set routing defaults for a group. Existing jobs retain their registration
	 * snapshot; the update applies only to jobs registered after this call.
	 */
	configureGroup(groupId: string, configuration: AsyncJobGroupConfiguration): void {
		this.#groupConfigurations.set(groupId, { ...configuration });
	}

	/** Return the current defaults used by a future registration in this group. */
	getGroupConfiguration(groupId: string): AsyncJobGroupConfiguration {
		return this.#groupConfigurations.get(groupId) ?? DEFAULT_GROUP_CONFIGURATION;
	}

	/**
	 * Explicitly promote a hub-only terminal completion to the Main delivery
	 * route. This is intentionally per-job; it does not alter future jobs.
	 */
	escalateCompletion(jobId: string): boolean {
		const job = this.#jobs.get(jobId);
		if (job?.group?.reporting !== "hub") return false;
		if (job.status !== "completed" && job.status !== "failed") return false;
		job.group.reporting = "main";
		const text = job.resultText ?? job.errorText;
		if (!text || this.#hasDelivery(jobId)) return true;
		job.completionSequence++;
		this.#enqueueDelivery(jobId, text, job.completionSequence);
		return true;
	}

	/** True when the running-job count has reached the configured cap. */
	get atCapacity(): boolean {
		if (this.#disposed) return true;
		// Mirror register(): queued jobs hold no execution slot.
		let activeCount = 0;
		for (const job of this.#jobs.values()) {
			if (job.status === "running" && !job.queued) activeCount++;
		}
		return activeCount >= this.#maxRunningJobs;
	}

	register(
		type: "bash" | "task",
		label: string,
		run: (ctx: {
			jobId: string;
			signal: AbortSignal;
			reportProgress: (text: string, details?: Record<string, unknown>) => Promise<void>;
			/** Clear the queued flag once the job actually starts executing. */
			markRunning: () => void;
		}) => Promise<string>,
		options?: AsyncJobRegisterOptions,
	): string {
		if (this.#disposed) {
			throw new Error("Async job manager is disposed");
		}
		// Queued jobs hold no execution slot yet — only count jobs that are
		// actually running so a large parked batch cannot starve registration.
		let activeCount = 0;
		for (const existing of this.#jobs.values()) {
			if (existing.status === "running" && !existing.queued) activeCount++;
		}
		if (activeCount >= this.#maxRunningJobs) {
			throw new Error(
				`Background job limit reached (${this.#maxRunningJobs}). Wait for running jobs to finish or cancel one.`,
			);
		}

		const preferredId = options?.id?.trim();
		if (preferredId && options?.replaceTerminal) {
			const previous = this.#jobs.get(preferredId);
			if (previous && previous.status !== "running") this.#evictJob(preferredId);
		}

		const id = this.#resolveJobId(options?.id);
		this.#suppressedDeliveries.delete(id);
		const abortController = new AbortController();
		const startTime = Date.now();

		const job: AsyncJob = {
			id,
			type,
			status: "running",
			startTime,
			label,
			abortController,
			promise: Promise.resolve(),
			completionSequence: 0,
			ownerId: options?.ownerId,
			group: options?.group
				? {
						groupId: options.group.groupId,
						coordinatorId: options.group.coordinatorId,
						...this.getGroupConfiguration(options.group.groupId),
					}
				: undefined,
			queued: options?.queued === true,
			isolated: options?.isolated === true,
		};

		const progress = new ProgressCoalescer(id, options?.onProgress);
		const reportProgress = progress.report.bind(progress);
		job.promise = (async () => {
			try {
				const text = await run({
					jobId: id,
					signal: abortController.signal,
					reportProgress,
					markRunning: () => {
						job.queued = false;
						job.status = "running";
						job.providerRecovery = undefined;
					},
				});
				await progress.flush();
				if (job.detached) return;
				if (job.status === "cancelled") {
					this.#scheduleEviction(id);
					return;
				}
				job.status = "completed";
				if (job.interruptRequested) job.interrupted = true;
				job.resultText = text;
				job.completionSequence++;
				this.#enqueueDelivery(id, text, job.completionSequence);
				this.#scheduleEviction(id);
			} catch (error) {
				await progress.flush();
				if (job.detached) return;
				if (job.status === "cancelled") {
					this.#scheduleEviction(id);
					return;
				}
				const errorText = error instanceof Error ? error.message : String(error);
				job.status = "failed";
				job.errorText = errorText;
				job.completionSequence++;
				this.#enqueueDelivery(id, errorText, job.completionSequence);
				this.#scheduleEviction(id);
			}
		})();

		this.#jobs.set(id, job);
		return id;
	}

	/**
	 * Cancel a single job by id. When `filter.ownerId` is set and does not
	 * match the job's owner, the call is treated as not-found (returns false)
	 * so cross-agent cancellation is rejected at the manager level.
	 */
	cancel(id: string, filter?: AsyncJobFilter): boolean {
		const job = this.#jobs.get(id);
		if (!job) return false;
		if (filter?.ownerId && job.ownerId !== filter.ownerId) return false;
		if (job.status !== "running" && job.status !== "waiting-provider") return false;
		job.status = "cancelled";
		if (job.interruptRequested) job.hardCancelled = true;
		job.abortController.abort();
		this.#scheduleEviction(id);
		return true;
	}

	/**
	 * Soft-interrupt a running job: abort the current turn with a typed reason
	 * while leaving completion status to the job body. Unlike cancel(), this does
	 * not mark the job terminal or schedule eviction.
	 */
	interrupt(id: string, filter?: AsyncJobFilter, reason?: string, requestedBy?: string): boolean {
		const job = this.#jobs.get(id);
		if (!job) return false;
		if (filter?.ownerId && job.ownerId !== filter.ownerId) return false;
		if (
			(job.status !== "running" && job.status !== "waiting-provider") ||
			job.queued ||
			job.interruptRequested ||
			job.isolated
		) {
			return false;
		}
		const interruptReason = reason?.trim();
		const attribution = requestedBy ?? filter?.ownerId;
		job.interruptRequested = true;
		job.interruptRequestedBy = attribution;
		if (interruptReason) job.interruptReason = interruptReason;
		job.abortController.abort(createAsyncJobInterruptReason(attribution, interruptReason));
		return true;
	}

	refreshResultText(id: string, text: string): boolean {
		const job = this.#jobs.get(id);
		if (!job || (job.status !== "completed" && job.status !== "failed")) return false;
		job.resultText = text;
		if (job.errorText !== undefined) job.errorText = undefined;
		job.completionSequence++;
		// A refreshed child result is a new delivery generation. A prior explicit
		// acknowledgement covers only the earlier sequence.
		this.#suppressedDeliveries.delete(id);
		this.#enqueueDelivery(id, text, job.completionSequence);
		return true;
	}

	getJob(id: string): AsyncJob | undefined {
		return this.#jobs.get(id);
	}

	/**
	 * Project a durable child route update into a process-local job without
	 * allowing one owner to mutate another owner's job view.
	 */
	setRouteUpdate(id: string, update: ChildRouteUpdateReport, filter?: AsyncJobFilter): boolean {
		const job = this.#jobs.get(id);
		if (!job) return false;
		if (filter?.ownerId && job.ownerId !== filter.ownerId) return false;
		job.routeUpdate = { ...update };
		return true;
	}
	markWaitingProvider(
		id: string,
		recovery: NonNullable<AsyncJob["providerRecovery"]>,
	): boolean {
		const job = this.#jobs.get(id);
		if (!job || (job.status !== "running" && job.status !== "waiting-provider")) return false;
		job.status = "waiting-provider";
		job.providerRecovery = recovery;
		return true;
	}

	markRunning(id: string): boolean {
		const job = this.#jobs.get(id);
		if (!job || (job.status !== "running" && job.status !== "waiting-provider")) return false;
		job.status = "running";
		job.providerRecovery = undefined;
		return true;
	}

	getRunningJobs(filter?: AsyncJobFilter): AsyncJob[] {
		return this.#filterJobs(this.#jobs.values(), filter).filter(
			job => job.status === "running" || job.status === "waiting-provider",
		);
	}

	getRecentJobs(limit = 10, filter?: AsyncJobFilter): AsyncJob[] {
		return this.#filterJobs(this.#jobs.values(), filter)
			.filter(job => job.status !== "running")
			.sort((a, b) => b.startTime - a.startTime)
			.slice(0, limit);
	}

	getAllJobs(filter?: AsyncJobFilter): AsyncJob[] {
		return this.#filterJobs(this.#jobs.values(), filter);
	}

	/** Bounded, allocation-light view of memory held directly by the manager. */
	getMemoryReport(): AsyncJobMemoryReport {
		let runningCount = 0;
		let runningBytes = 0;
		let terminalCount = 0;
		let terminalBytes = 0;
		for (const job of this.#jobs.values()) {
			const bytes =
				JOB_METADATA_ESTIMATE_BYTES +
				UTF8_ENCODER.encode(job.id).byteLength +
				UTF8_ENCODER.encode(job.label).byteLength +
				UTF8_ENCODER.encode(job.ownerId ?? "").byteLength +
				UTF8_ENCODER.encode(job.resultText ?? "").byteLength +
				UTF8_ENCODER.encode(job.errorText ?? "").byteLength;
			if (job.status === "running" || job.status === "waiting-provider") {
				runningCount++;
				runningBytes += bytes;
			} else {
				terminalCount++;
				terminalBytes += bytes;
			}
		}
		let deliveryBytes = 0;
		for (const delivery of this.#deliveries) deliveryBytes += UTF8_ENCODER.encode(delivery.text).byteLength;
		for (const delivery of this.#inFlightDeliveries) deliveryBytes += UTF8_ENCODER.encode(delivery.text).byteLength;
		const report: AsyncJobMemoryReport = {
			running: { count: runningCount, estimatedBytes: runningBytes },
			terminal: { count: terminalCount, estimatedBytes: terminalBytes },
			deliveries: {
				count: this.#deliveries.length + this.#inFlightDeliveries.length,
				estimatedBytes: deliveryBytes,
			},
			timers: { count: this.#evictionTimers.size, estimatedBytes: this.#evictionTimers.size * 128 },
			totalEstimatedBytes: 0,
			pressureEvictions: this.#pressureEvictions,
		};
		report.totalEstimatedBytes =
			report.running.estimatedBytes +
			report.terminal.estimatedBytes +
			report.deliveries.estimatedBytes +
			report.timers.estimatedBytes;
		return report;
	}

	/**
	 * Drop only delivered terminal cache entries once coordinator RSS reaches
	 * the configured threshold. Pending deliveries remain authoritative, and
	 * task journals are owned elsewhere.
	 *
	 * Gated on RSS rather than `heapUsed`: the manager's retained job detail is
	 * native (string bytes reached through JSC), so the node-compatible heap
	 * counter stays near zero while the process footprint grows.
	 */
	enforceMemoryPressure(rssBytes?: number): number {
		// Reading RSS is a syscall; skip it entirely when the lever is disabled.
		if (this.#memoryPressureBytes === 0) return 0;
		if ((rssBytes ?? this.#readRss()) < this.#memoryPressureBytes) return 0;
		let evicted = 0;
		for (const [jobId, job] of this.#jobs) {
			if (
				job.status === "running" ||
				job.status === "waiting-provider" ||
				this.#watchedJobs.has(jobId) ||
				this.#hasDelivery(jobId)
			) {
				continue;
			}
			this.#evictJob(jobId);
			evicted++;
		}
		this.#pressureEvictions += evicted;
		return evicted;
	}

	getDeliveryState(filter?: AsyncJobFilter): AsyncJobDeliveryState {
		const deliveries = this.#filterDeliveries(filter);
		const inFlightDeliveries = this.#filterInFlightDeliveries(filter);
		const nextRetryAt = deliveries.reduce<number | undefined>((next, delivery) => {
			if (next === undefined) return delivery.nextAttemptAt;
			return Math.min(next, delivery.nextAttemptAt);
		}, undefined);

		return {
			queued: deliveries.length + inFlightDeliveries.length,
			delivering: inFlightDeliveries.length > 0 || (this.#deliveryLoop !== undefined && deliveries.length > 0),
			nextRetryAt,
			pendingJobIds: deliveries.concat(inFlightDeliveries).map(delivery => delivery.jobId),
		};
	}

	hasPendingDeliveries(filter?: AsyncJobFilter): boolean {
		return this.getDeliveryState(filter).queued > 0;
	}

	watchJobs(jobIds: string[]): number {
		const uniqueJobIds = Array.from(new Set(jobIds.map(id => id.trim()).filter(id => id.length > 0)));
		for (const jobId of uniqueJobIds) {
			this.#watchedJobs.add(jobId);
		}
		return uniqueJobIds.length;
	}

	unwatchJobs(jobIds: string[]): number {
		const uniqueJobIds = Array.from(new Set(jobIds.map(id => id.trim()).filter(id => id.length > 0)));
		let removed = 0;
		for (const jobId of uniqueJobIds) {
			if (this.#watchedJobs.delete(jobId)) {
				removed += 1;
			}
		}
		return removed;
	}

	/**
	 * Compute the next adaptive ("smart") wait (ms) for a blocking `job` poll by
	 * the given owner. Consecutive polls — those starting within
	 * POLL_ESCALATION_RESET_MS of the previous poll returning — climb
	 * POLL_WAIT_LADDER_MS so a tight wait loop backs off; a longer gap means the
	 * agent left to do real work, so the wait resets to the floor. Pair each call
	 * with `recordPollWaitEnd()` once the wait returns.
	 */
	nextPollWaitMs(ownerId: string | undefined, now: number = Date.now()): number {
		const prev = this.#pollEscalation.get(ownerId);
		const reset = !prev || now - prev.lastPollEndAt >= POLL_ESCALATION_RESET_MS;
		const level = reset ? 0 : Math.min(prev.level + 1, POLL_WAIT_LADDER_MS.length - 1);
		this.#pollEscalation.set(ownerId, { level, lastPollEndAt: prev?.lastPollEndAt ?? now });
		return POLL_WAIT_LADDER_MS[level];
	}

	/**
	 * Mark a blocking poll wait as finished so the idle-reset window is measured
	 * from now. Polling again before POLL_ESCALATION_RESET_MS elapses keeps
	 * climbing the ladder; waiting longer resets it to the floor.
	 */
	recordPollWaitEnd(ownerId: string | undefined, now: number = Date.now()): void {
		const prev = this.#pollEscalation.get(ownerId);
		this.#pollEscalation.set(ownerId, { level: prev?.level ?? 0, lastPollEndAt: now });
	}

	async acknowledgeDeliveries(jobIds: string[]): Promise<number> {
		const uniqueJobIds = Array.from(new Set(jobIds.map(id => id.trim()).filter(id => id.length > 0)));
		if (uniqueJobIds.length === 0) return 0;

		const acknowledgements: AsyncJobDeliveryAcknowledgement[] = [];
		for (const jobId of uniqueJobIds) {
			this.#suppressedDeliveries.add(jobId);
			const job = this.#jobs.get(jobId);
			if (job && job.completionSequence > 0) {
				acknowledgements.push({
					agentId: asyncJobCompletionAgentId(job),
					jobId,
					sequence: job.completionSequence,
					job,
				});
			}
		}

		const removed = this.#removeSuppressedDeliveries();
		try {
			await this.#onJobAcknowledge?.(acknowledgements);
		} catch (error) {
			for (const jobId of uniqueJobIds) this.#suppressedDeliveries.delete(jobId);
			for (const jobId of uniqueJobIds) {
				const job = this.#jobs.get(jobId);
				if (job && (job.status === "completed" || job.status === "failed") && !this.#hasDelivery(jobId)) {
					this.#enqueueDelivery(
						jobId,
						job.status === "completed" ? (job.resultText ?? "") : (job.errorText ?? ""),
						job.completionSequence,
					);
				}
			}
			throw error;
		}
		return removed;
	}

	/** Temporarily suppress delivery while a foreground caller waits for a job. */
	suppressDeliveries(jobIds: string[]): number {
		const uniqueJobIds = Array.from(new Set(jobIds.map(id => id.trim()).filter(id => id.length > 0)));
		for (const jobId of uniqueJobIds) this.#suppressedDeliveries.add(jobId);
		return this.#removeSuppressedDeliveries();
	}

	#removeSuppressedDeliveries(): number {
		const before = this.#deliveries.length;
		this.#deliveries.splice(
			0,
			this.#deliveries.length,
			...this.#deliveries.filter(delivery => !this.isDeliverySuppressed(delivery.jobId)),
		);
		return before - this.#deliveries.length;
	}

	/**
	 * Lift a temporary foreground-wait suppression. If the job finished while
	 * suppressed, enqueue its current completion generation.
	 */
	resumeDeliveries(jobIds: string[]): void {
		for (const rawId of jobIds) {
			const jobId = rawId.trim();
			if (!jobId) continue;
			if (!this.#suppressedDeliveries.delete(jobId)) continue;
			const job = this.#jobs.get(jobId);
			if (!job || (job.status !== "completed" && job.status !== "failed")) continue;
			const queued =
				this.#deliveries.some(delivery => delivery.jobId === jobId) ||
				this.#inFlightDeliveries.some(delivery => delivery.jobId === jobId);
			if (queued) continue;
			this.#enqueueDelivery(
				jobId,
				job.status === "completed" ? (job.resultText ?? "") : (job.errorText ?? ""),
				job.completionSequence,
			);
		}
	}

	/**
	 * Relinquish matching jobs without aborting their process work. Detached
	 * subprocess groups continue independently and can be reconstructed by the
	 * replacement parent from their durable registry and journal projection.
	 */
	detachRunningJobs(filter: AsyncJobDetachFilter): string[] {
		const detached: string[] = [];
		for (const job of this.getRunningJobs(filter)) {
			if (filter.type && job.type !== filter.type) continue;
			job.detached = true;
			this.#jobs.delete(job.id);
			this.#suppressedDeliveries.add(job.id);
			this.#watchedJobs.delete(job.id);
			detached.push(job.id);
		}
		return detached;
	}

	/**
	 * Cancel running jobs. With `filter.ownerId` set, cancels only jobs the
	 * matching agent registered; with no filter, cancels every running job
	 * (used by `dispose()` to nuke the manager's state).
	 */
	cancelAll(filter?: AsyncJobFilter): void {
		for (const job of this.getRunningJobs(filter)) {
			job.status = "cancelled";
			job.abortController.abort();
			this.#scheduleEviction(job.id);
		}
	}

	async waitForAll(): Promise<void> {
		await Promise.all(Array.from(this.#jobs.values()).map(job => job.promise));
	}

	async drainDeliveries(options?: { timeoutMs?: number; filter?: AsyncJobFilter }): Promise<boolean> {
		const timeoutMs = options?.timeoutMs;
		const filter = options?.filter;
		const hasDeadline = timeoutMs !== undefined;
		const deadline = hasDeadline ? Date.now() + Math.max(timeoutMs, 0) : Number.POSITIVE_INFINITY;

		while (this.hasPendingDeliveries(filter)) {
			if (filter?.ownerId) {
				const delivered = await this.#deliverNextFiltered(filter, deadline);
				if (delivered) continue;
				return false;
			}
			const inFlightDeliveries = this.#filterInFlightDeliveries();
			if (inFlightDeliveries.length > 0 && this.#filterDeliveries().length === 0) {
				const delivered = await this.#waitForDeliveryPromise(inFlightDeliveries[0]?.promise, deadline);
				if (delivered) continue;
				return false;
			}

			this.#ensureDeliveryLoop();
			const loop = this.#deliveryLoop;
			if (!loop) {
				continue;
			}

			if (!hasDeadline) {
				await loop;
				continue;
			}

			const remainingMs = deadline - Date.now();
			if (remainingMs <= 0) {
				return false;
			}

			await Promise.race([loop, Bun.sleep(remainingMs)]);
			if (Date.now() >= deadline && this.hasPendingDeliveries(filter)) {
				return false;
			}
		}

		return true;
	}

	async dispose(options?: { timeoutMs?: number }): Promise<boolean> {
		this.#disposed = true;
		this.#routeUpdateUnsubscribe();
		if (this.#pressureSweep !== undefined) clearInterval(this.#pressureSweep);
		this.#clearEvictionTimers();
		this.cancelAll();
		await this.waitForAll();
		const drained = await this.drainDeliveries({ timeoutMs: options?.timeoutMs ?? 3_000 });
		this.#clearEvictionTimers();
		this.#jobs.clear();
		this.#deliveries.length = 0;
		this.#inFlightDeliveries.length = 0;
		this.#suppressedDeliveries.clear();
		this.#watchedJobs.clear();
		this.#pollEscalation.clear();
		return drained;
	}

	#resolveJobId(preferredId?: string): string {
		preferredId = preferredId?.trim();
		if (!preferredId) {
			let candidate = 1;
			while (true) {
				const id = `bg_${candidate}`;
				if (!this.#jobs.has(id)) {
					return id;
				}
				candidate += 1;
			}
		}

		const base = preferredId.trim();
		if (!this.#jobs.has(base)) return base;

		let suffix = 2;
		let candidate = `${base}-${suffix}`;
		while (this.#jobs.has(candidate)) {
			suffix += 1;
			candidate = `${base}-${suffix}`;
		}
		return candidate;
	}

	#compactTerminalJob(jobId: string): void {
		const job = this.#jobs.get(jobId);
		if (!job || job.status === "running" || job.status === "waiting-provider") return;
		if (job.resultText !== undefined) job.resultText = this.#truncateUtf8(job.resultText);
		if (job.errorText !== undefined) job.errorText = this.#truncateUtf8(job.errorText);
		// A settled promise may retain the async closure graph in JSC. Replace it
		// with a shared-shape resolved promise once completion has been delivered.
		job.promise = Promise.resolve();
		job.abortController = new AbortController();
	}

	#truncateUtf8(text: string): string {
		const encoded = UTF8_ENCODER.encode(text);
		if (encoded.byteLength <= this.#completionSummaryBytes) return text;
		if (this.#completionSummaryBytes === 0) return "";
		return UTF8_DECODER.decode(encoded.subarray(0, this.#completionSummaryBytes));
	}

	#evictJob(jobId: string): void {
		const timer = this.#evictionTimers.get(jobId);
		if (timer) clearTimeout(timer);
		this.#evictionTimers.delete(jobId);
		this.#jobs.delete(jobId);
		this.#suppressedDeliveries.delete(jobId);
		this.#watchedJobs.delete(jobId);
	}

	#scheduleEviction(jobId: string): void {
		if (this.#retentionMs <= 0) {
			this.#evictJob(jobId);
			return;
		}
		const existing = this.#evictionTimers.get(jobId);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(() => this.#evictJob(jobId), this.#retentionMs);
		timer.unref();
		this.#evictionTimers.set(jobId, timer);
	}

	#clearEvictionTimers(): void {
		for (const timer of this.#evictionTimers.values()) {
			clearTimeout(timer);
		}
		this.#evictionTimers.clear();
	}

	#filterDeliveries(filter?: AsyncJobFilter): AsyncJobDelivery[] {
		const ownerId = filter?.ownerId;
		if (!ownerId) return this.#deliveries.filter(delivery => !this.isDeliverySuppressed(delivery.jobId));
		return this.#deliveries.filter(
			delivery => delivery.ownerId === ownerId && !this.isDeliverySuppressed(delivery.jobId),
		);
	}

	#filterInFlightDeliveries(filter?: AsyncJobFilter): AsyncJobDelivery[] {
		const ownerId = filter?.ownerId;
		if (!ownerId) return this.#inFlightDeliveries.filter(delivery => !this.isDeliverySuppressed(delivery.jobId));
		return this.#inFlightDeliveries.filter(
			delivery => delivery.ownerId === ownerId && !this.isDeliverySuppressed(delivery.jobId),
		);
	}

	async #deliverNextFiltered(filter: AsyncJobFilter, deadline: number): Promise<boolean> {
		while (true) {
			let selected: AsyncJobDelivery | undefined;
			for (const delivery of this.#deliveries) {
				if (delivery.ownerId !== filter.ownerId) continue;
				if (this.isDeliverySuppressed(delivery.jobId)) continue;
				if (!selected || delivery.nextAttemptAt < selected.nextAttemptAt) {
					selected = delivery;
				}
			}

			if (!selected) {
				const inFlight = this.#filterInFlightDeliveries(filter);
				if (inFlight.length === 0) return true;
				return this.#waitForDeliveryPromise(inFlight[0]?.promise, deadline);
			}

			const now = Date.now();
			if (selected.nextAttemptAt > now) {
				if (selected.nextAttemptAt > deadline) return false;
				await Bun.sleep(selected.nextAttemptAt - now);
				continue;
			}

			const index = this.#deliveries.indexOf(selected);
			if (index === -1) continue;
			this.#deliveries.splice(index, 1);
			if (this.isDeliverySuppressed(selected.jobId)) continue;

			return this.#waitForDeliveryPromise(this.#deliverDelivery(selected), deadline);
		}
	}

	isDeliverySuppressed(jobId: string): boolean {
		return this.#suppressedDeliveries.has(jobId) || this.#watchedJobs.has(jobId);
	}

	#hasDelivery(jobId: string): boolean {
		return (
			this.#deliveries.some(delivery => delivery.jobId === jobId) ||
			this.#inFlightDeliveries.some(delivery => delivery.jobId === jobId)
		);
	}

	#enqueueDelivery(jobId: string, text: string, sequence: number): void {
		if (this.isDeliverySuppressed(jobId)) return;
		this.#deliveries.push({
			jobId,
			text,
			sequence,
			attempt: 0,
			nextAttemptAt: Date.now(),
			ownerId: this.#jobs.get(jobId)?.ownerId,
		});
		this.#ensureDeliveryLoop();
	}

	#ensureDeliveryLoop(): void {
		if (this.#deliveryLoop) {
			return;
		}

		this.#deliveryLoop = this.#runDeliveryLoop()
			.catch(error => {
				logger.error("Async job delivery loop crashed", { error: String(error) });
			})
			.finally(() => {
				this.#deliveryLoop = undefined;
				if (this.#deliveries.length > 0) {
					this.#ensureDeliveryLoop();
				}
			});
	}

	async #runDeliveryLoop(): Promise<void> {
		while (this.#deliveries.length > 0) {
			const delivery = this.#deliveries[0];
			if (this.isDeliverySuppressed(delivery.jobId)) {
				this.#deliveries.shift();
				continue;
			}
			const waitMs = delivery.nextAttemptAt - Date.now();
			if (waitMs > 0) {
				await Bun.sleep(waitMs);
			}
			if (this.#deliveries[0] !== delivery) {
				continue;
			}
			if (this.isDeliverySuppressed(delivery.jobId)) {
				this.#deliveries.shift();
				continue;
			}

			this.#deliveries.shift();
			await this.#deliverDelivery(delivery);
		}
	}

	#deliverDelivery(delivery: AsyncJobDelivery): Promise<void> {
		const promise = (async () => {
			this.#inFlightDeliveries.push(delivery);
			let delivered = false;
			try {
				await this.#onJobComplete(delivery.jobId, delivery.text, this.#jobs.get(delivery.jobId), delivery.sequence);
				this.#compactTerminalJob(delivery.jobId);
				delivered = true;
			} catch (error) {
				delivery.attempt += 1;
				delivery.lastError = error instanceof Error ? error.message : String(error);
				delivery.nextAttemptAt = Date.now() + this.#getRetryDelay(delivery.attempt);
				if (!this.isDeliverySuppressed(delivery.jobId)) {
					this.#deliveries.push(delivery);
				}
				logger.warn("Async job completion delivery failed", {
					jobId: delivery.jobId,
					attempt: delivery.attempt,
					nextRetryAt: delivery.nextAttemptAt,
					error: delivery.lastError,
				});
			} finally {
				const index = this.#inFlightDeliveries.indexOf(delivery);
				if (index !== -1) this.#inFlightDeliveries.splice(index, 1);
				if (delivered) this.enforceMemoryPressure();
				if (this.#deliveries.length > 0) this.#ensureDeliveryLoop();
			}
		})();
		delivery.promise = promise;
		return promise;
	}

	async #waitForDeliveryPromise(promise: Promise<void> | undefined, deadline: number): Promise<boolean> {
		if (!promise) return true;
		if (deadline === Number.POSITIVE_INFINITY) {
			await promise;
			return true;
		}
		const remainingMs = deadline - Date.now();
		if (remainingMs <= 0) return false;
		let timedOut = false;
		await Promise.race([
			promise,
			Bun.sleep(remainingMs).then(() => {
				timedOut = true;
			}),
		]);
		return !timedOut;
	}

	#getRetryDelay(attempt: number): number {
		const exp = Math.min(Math.max(attempt - 1, 0), 8);
		const backoffMs = DELIVERY_RETRY_BASE_MS * 2 ** exp;
		const jitterMs = Math.floor(Math.random() * DELIVERY_RETRY_JITTER_MS);
		return Math.min(DELIVERY_RETRY_MAX_MS, backoffMs + jitterMs);
	}
}
