import type { AgentProgress, SubagentLifecyclePayload, SubagentProgressPayload } from "../task";
import { TASK_SUBAGENT_LIFECYCLE_CHANNEL, TASK_SUBAGENT_PROGRESS_CHANNEL } from "../task";
import type { EventBus } from "../utils/event-bus";

export interface ObservableSession {
	id: string;
	kind: "main" | "subagent";
	label: string;
	agent?: string;
	description?: string;
	status: "active" | "completed" | "failed" | "aborted";
	sessionFile?: string;
	parentToolCallId?: string;
	/**
	 * Spawn runs as a detached background job (parent turn not blocked on it).
	 * The anchored subagent HUD only lists detached spawns: sync task spawns
	 * and eval `agent()` spawns are already rendered live by their own inline
	 * tool block / eval cell.
	 */
	detached?: boolean;
	index?: number;
	lastUpdate: number;
	/** Latest progress snapshot from the subagent executor */
	progress?: AgentProgress;
}

const STATUS_MAP: Record<string, ObservableSession["status"]> = {
	started: "active",
	completed: "completed",
	failed: "failed",
	aborted: "aborted",
};


interface PendingSessionUpdate {
	id: string;
	agent?: string;
	description?: string;
	status?: ObservableSession["status"];
	sessionFile?: string;
	parentToolCallId?: string;
	detached?: boolean;
	index?: number;
	progress?: AgentProgress;
}

export interface SessionObserverPerformanceCounters {
	snapshotUpdates: number;
	notificationFlushes: number;
	projectionRebuilds: number;
}

export class SessionObserverRegistry {
	#sessions = new Map<string, ObservableSession>();
	#listeners = new Set<() => void>();
	#eventBusUnsubscribers: Array<() => void> = [];
	#sortOrderById = new Map<string, number>();
	#parentSortOrderById = new Map<string, number>();
	#nextSortOrder = 0;
	#pendingUpdates = new Map<string, PendingSessionUpdate>();
	#flushTimer: ReturnType<typeof setTimeout> | undefined;
	#sortedProjection: ObservableSession[] | undefined;
	#performanceCounters: SessionObserverPerformanceCounters = {
		snapshotUpdates: 0,
		notificationFlushes: 0,
		projectionRebuilds: 0,
	};

	/** Add a change listener. Returns unsubscribe function. */
	onChange(cb: () => void): () => void {
		this.#listeners.add(cb);
		return () => this.#listeners.delete(cb);
	}

	#notifyListeners(): void {
		this.#performanceCounters.notificationFlushes++;
		for (const cb of this.#listeners) cb();
	}

	#scheduleFlush(): void {
		if (this.#flushTimer !== undefined) return;
		this.#flushTimer = setTimeout(() => {
			this.#flushTimer = undefined;
			this.#applyPendingUpdates();
			this.#notifyListeners();
		}, 0);
	}

	#applyPendingUpdates(): void {
		if (this.#pendingUpdates.size === 0) return;
		for (const update of this.#pendingUpdates.values()) {
			const existing = this.#sessions.get(update.id);
			this.#sessions.set(update.id, {
				id: update.id,
				kind: "subagent",
				label: update.description ?? existing?.label ?? `Subagent #${update.index}`,
				agent: update.agent ?? existing?.agent,
				description: update.description ?? existing?.description,
				status: update.status ?? existing?.status ?? "active",
				sessionFile: update.sessionFile ?? existing?.sessionFile,
				parentToolCallId: update.parentToolCallId ?? existing?.parentToolCallId,
				detached: update.detached ?? existing?.detached,
				index: update.index ?? existing?.index,
				lastUpdate: Date.now(),
				progress: update.progress ?? existing?.progress,
			});
			this.#performanceCounters.snapshotUpdates++;
		}
		this.#pendingUpdates.clear();
		this.#sortedProjection = undefined;
	}

	#queueUpdate(update: PendingSessionUpdate): void {
		const pending = this.#pendingUpdates.get(update.id);
		this.#pendingUpdates.set(
			update.id,
			pending
				? {
						id: update.id,
						agent: update.agent ?? pending.agent,
						description: update.description ?? pending.description,
						status: update.status ?? pending.status,
						sessionFile: update.sessionFile ?? pending.sessionFile,
						parentToolCallId: update.parentToolCallId ?? pending.parentToolCallId,
						detached: update.detached ?? pending.detached,
						index: update.index ?? pending.index,
						progress: update.progress ?? pending.progress,
					}
				: update,
		);
		this.#scheduleFlush();
	}

	getPerformanceCounters(): Readonly<SessionObserverPerformanceCounters> {
		return { ...this.#performanceCounters };
	}

	resetPerformanceCounters(): void {
		this.#performanceCounters.snapshotUpdates = 0;
		this.#performanceCounters.notificationFlushes = 0;
		this.#performanceCounters.projectionRebuilds = 0;
	}

	#ensureSortOrder(id: string): number {
		const existing = this.#sortOrderById.get(id);
		if (existing !== undefined) return existing;
		const order = this.#nextSortOrder++;
		this.#sortOrderById.set(id, order);
		return order;
	}

	#ensureParentSortOrder(parentToolCallId: string | undefined, order: number): void {
		if (!parentToolCallId) return;
		if (this.#parentSortOrderById.has(parentToolCallId)) return;
		this.#parentSortOrderById.set(parentToolCallId, order);
	}

	#getStableOrder(session: ObservableSession): number {
		return this.#sortOrderById.get(session.id) ?? Number.MAX_SAFE_INTEGER;
	}

	#getGroupOrder(session: ObservableSession): number {
		const parentOrder = session.parentToolCallId
			? this.#parentSortOrderById.get(session.parentToolCallId)
			: undefined;
		return parentOrder ?? this.#getStableOrder(session);
	}

	setMainSession(sessionFile?: string): void {
		const existing = this.#sessions.get("main");
		this.#ensureSortOrder("main");
		this.#sessions.set("main", {
			id: "main",
			kind: "main",
			label: "Main Session",
			status: "active",
			sessionFile: sessionFile ?? existing?.sessionFile,
			lastUpdate: Date.now(),
		});
		this.#sortedProjection = undefined;
		this.#scheduleFlush();
	}

	getSessions(): ObservableSession[] {
		this.#applyPendingUpdates();
		if (this.#sortedProjection) return this.#sortedProjection;
		const sessions = [...this.#sessions.values()];
		sessions.sort((a, b) => {
			if (a.kind === "main" && b.kind !== "main") return -1;
			if (b.kind === "main" && a.kind !== "main") return 1;
			if (a.kind === "main" || b.kind === "main") return 0;

			const groupDiff = this.#getGroupOrder(a) - this.#getGroupOrder(b);
			if (groupDiff !== 0) return groupDiff;

			const aIndex = a.index ?? Number.MAX_SAFE_INTEGER;
			const bIndex = b.index ?? Number.MAX_SAFE_INTEGER;
			if (aIndex !== bIndex) return aIndex - bIndex;

			return this.#getStableOrder(a) - this.#getStableOrder(b);
		});
		this.#performanceCounters.projectionRebuilds++;
		this.#sortedProjection = sessions;
		return sessions;
	}

	getActiveSubagentCount(): number {
		this.#applyPendingUpdates();
		let count = 0;
		for (const s of this.#sessions.values()) {
			if (s.kind === "subagent" && s.status === "active") count++;
		}
		return count;
	}

	/** Clear all tracked sessions (e.g. on session switch). Keeps EventBus subscriptions and listeners. */
	resetSessions(): void {
		this.#sessions.clear();
		this.#pendingUpdates.clear();
		this.#sortOrderById.clear();
		this.#parentSortOrderById.clear();
		this.#nextSortOrder = 0;
		this.#sortedProjection = undefined;
		this.#scheduleFlush();
	}

	dispose(): void {
		for (const unsub of this.#eventBusUnsubscribers) unsub();
		this.#eventBusUnsubscribers = [];
		if (this.#flushTimer !== undefined) clearTimeout(this.#flushTimer);
		this.#flushTimer = undefined;
		this.#pendingUpdates.clear();
		this.#sessions.clear();
		this.#sortOrderById.clear();
		this.#parentSortOrderById.clear();
		this.#nextSortOrder = 0;
		this.#sortedProjection = undefined;
		this.#listeners.clear();
	}

	subscribeToEventBus(eventBus: EventBus): void {
		// Dispose previous EventBus subscriptions if called again
		for (const unsub of this.#eventBusUnsubscribers) unsub();
		this.#eventBusUnsubscribers = [];

		this.#eventBusUnsubscribers.push(
			eventBus.on(TASK_SUBAGENT_LIFECYCLE_CHANNEL, data => {
				const payload = data as SubagentLifecyclePayload;
				const status = STATUS_MAP[payload.status];
				if (!status) return;

				const sortOrder = this.#ensureSortOrder(payload.id);
				this.#ensureParentSortOrder(payload.parentToolCallId, sortOrder);
				this.#queueUpdate({
					id: payload.id,
					agent: payload.agent,
					description: payload.description,
					status,
					sessionFile: payload.sessionFile,
					parentToolCallId: payload.parentToolCallId,
					detached: payload.detached,
					index: payload.index,
				});
			}),
		);

		this.#eventBusUnsubscribers.push(
			eventBus.on(TASK_SUBAGENT_PROGRESS_CHANNEL, data => {
				const payload = data as SubagentProgressPayload;
				const progress = payload.progress;
				const id = progress.id;
				const sortOrder = this.#ensureSortOrder(id);
				this.#ensureParentSortOrder(payload.parentToolCallId, sortOrder);
				this.#queueUpdate({
					id,
					agent: payload.agent,
					description: progress.description,
					sessionFile: payload.sessionFile,
					parentToolCallId: payload.parentToolCallId,
					detached: payload.detached,
					index: payload.index,
					progress,
				});
			}),
		);
	}
}
