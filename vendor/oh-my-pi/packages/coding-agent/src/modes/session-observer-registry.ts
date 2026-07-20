import { listArchivedDirectChildren } from "../internal-urls/history-protocol";
import { AgentLifecycleManager } from "../registry/agent-lifecycle";
import type { AgentRef, AgentStatus } from "../registry/agent-registry";
import { AgentRegistry, MAIN_AGENT_ID } from "../registry/agent-registry";
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
	/** Authoritative AgentRegistry state used when a view is rebuilt. */
	registryStatus?: AgentStatus;
	sessionFile?: string;
	parentToolCallId?: string;
	/** Registry parent identity, available when the view is seeded without an event. */
	parentAgentId?: string;
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
	/** Sliding-window progress rate for the compact HUD badge. */
	tokenRate?: number;
	/** Running agent has received no progress for the stale threshold. */
	tokenRateStuck?: boolean;
}

const STATUS_MAP: Record<string, ObservableSession["status"]> = {
	started: "active",
	completed: "completed",
	failed: "failed",
	aborted: "aborted",
};

function observerStatusForRegistry(status: AgentStatus): ObservableSession["status"] {
	switch (status) {
		case "running":
			return "active";
		case "aborted":
			return "aborted";
		case "idle":
		case "parked":
			return "completed";
	}
}

interface PendingSessionUpdate {
	id: string;
	agent?: string;
	description?: string;
	status?: ObservableSession["status"];
	registryStatus?: AgentStatus;
	sessionFile?: string;
	parentToolCallId?: string;

	parentAgentId?: string;
	detached?: boolean;
	index?: number;
	progress?: AgentProgress;
}
const TOKEN_RATE_WINDOW_MS = 45_000;
const TOKEN_RATE_STALE_MS = 60_000;

export interface SessionObserverPerformanceCounters {
	snapshotUpdates: number;
	notificationFlushes: number;
	projectionRebuilds: number;
}

export class SessionObserverRegistry {
	#sessions = new Map<string, ObservableSession>();
	#tokenSamples = new Map<string, Array<{ at: number; tokens: number; outputTokens: number }>>();
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
	#registryUnsubscriber: (() => void) | undefined;

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

	#recordProgressRate(id: string, tokens: number, outputTokens: number, at: number): void {
		let samples = this.#tokenSamples.get(id) ?? [];
		// A revived/restarted child reuses its agent id but restarts its
		// cumulative counters. A regression against the previous run's high
		// baseline would clamp the delta to zero for the whole retention
		// window — discard the stale samples and start a fresh baseline.
		const last = samples[samples.length - 1];
		if (last && (tokens < last.tokens || outputTokens < last.outputTokens)) samples = [];
		samples.push({ at, tokens, outputTokens });
		const cutoff = at - TOKEN_RATE_STALE_MS;
		while (samples.length > 2 && samples[0]!.at < cutoff) samples.shift();
		this.#tokenSamples.set(id, samples);
	}

	#refreshTokenRates(now: number): void {
		const cutoff = now - TOKEN_RATE_WINDOW_MS;
		for (const session of this.#sessions.values()) {
			const samples = this.#tokenSamples.get(session.id);
			if (!samples || samples.length === 0) {
				session.tokenRate = 0;
				session.tokenRateStuck = session.status === "active" && now - session.lastUpdate > TOKEN_RATE_STALE_MS;
				continue;
			}

			while (samples.length > 2 && samples[0]!.at < now - TOKEN_RATE_STALE_MS) samples.shift();
			const latest = samples[samples.length - 1]!;
			// Stuck detection keys off ANY token advance (total counter) so
			// cache-heavy turns still register as alive.
			const latestTotalAdvanceAt = latest.at;
			if (now - latestTotalAdvanceAt > TOKEN_RATE_WINDOW_MS) {
				session.tokenRate = 0;
			} else {
				// Use the latest cumulative snapshot at or before the window
				// boundary. Keeping that baseline avoids an artificial zero
				// whenever the boundary falls between two progress events.
				let start = samples[0]!;
				for (const sample of samples) {
					if (sample.at > cutoff) break;
					start = sample;
				}
				const elapsed = latest.at - start.at;
				// Display rate uses output tokens only (generation speed).
				// Fall back to total when outputTokens is absent (old child).
				const useOutput = latest.outputTokens > 0 || start.outputTokens > 0;
				const delta = useOutput ? latest.outputTokens - start.outputTokens : latest.tokens - start.tokens;
				session.tokenRate = elapsed > 0 ? (Math.max(0, delta) / elapsed) * 1000 : 0;
			}
			session.tokenRateStuck =
				session.status === "active" && session.tokenRate === 0 && now - latestTotalAdvanceAt > TOKEN_RATE_STALE_MS;
		}
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
				registryStatus: update.registryStatus ?? existing?.registryStatus,
				sessionFile: update.sessionFile ?? existing?.sessionFile,
				parentToolCallId: update.parentToolCallId ?? existing?.parentToolCallId,
				parentAgentId: update.parentAgentId ?? existing?.parentAgentId,
				detached: update.detached ?? existing?.detached,
				index: update.index ?? existing?.index,
				lastUpdate: Date.now(),
				progress: update.progress ?? existing?.progress,
				tokenRate: existing?.tokenRate ?? 0,
				tokenRateStuck: existing?.tokenRateStuck ?? false,
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
						registryStatus: update.registryStatus ?? pending.registryStatus,
						sessionFile: update.sessionFile ?? pending.sessionFile,
						parentToolCallId: update.parentToolCallId ?? pending.parentToolCallId,
						parentAgentId: update.parentAgentId ?? pending.parentAgentId,
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
		const parentKey = session.parentToolCallId ?? session.parentAgentId;
		const parentOrder = parentKey ? this.#parentSortOrderById.get(parentKey) : undefined;
		return parentOrder ?? this.#getStableOrder(session);
	}
	#getTreeSortPath(session: ObservableSession): number[] | undefined {
		if (!session.parentAgentId) return undefined;
		const path: number[] = [];
		const visited = new Set<string>();
		let current: ObservableSession | undefined = session;
		while (current && !visited.has(current.id)) {
			visited.add(current.id);
			path.push(this.#getStableOrder(current));
			current = current.parentAgentId ? this.#sessions.get(current.parentAgentId) : undefined;
		}
		path.reverse();
		return path;
	}

	#seedAgentRef(ref: AgentRef): void {
		if (ref.id === MAIN_AGENT_ID || ref.kind === "main") return;
		this.#applyPendingUpdates();
		const existing = this.#sessions.get(ref.id);
		if (ref.parentId) {
			const parentOrder = this.#ensureSortOrder(ref.parentId);
			this.#ensureParentSortOrder(ref.parentId, parentOrder);
		}
		this.#sessions.set(ref.id, {
			id: ref.id,
			kind: "subagent",
			label: existing?.label ?? ref.displayName,
			agent: existing?.agent,
			description: existing?.description ?? ref.displayName,
			status: observerStatusForRegistry(ref.status),
			registryStatus: ref.status,
			sessionFile: ref.sessionFile ?? existing?.sessionFile,
			parentToolCallId: existing?.parentToolCallId,
			parentAgentId: ref.parentId,
			detached: existing?.detached ?? true,
			index: existing?.index ?? ref.spawnIndex,
			lastUpdate: ref.lastActivity || Date.now(),
			progress: existing?.progress,
			tokenRate: existing?.tokenRate ?? 0,
			tokenRateStuck: existing?.tokenRateStuck ?? false,
		});
		this.#sortedProjection = undefined;
	}

	/**
	 * Rehydrate the observer projection from the process-global registry. The
	 * EventBus is ephemeral, so a rebuilt view cannot wait for old lifecycle or
	 * progress events to discover children.
	 */
	seedFromAgentRegistry(registry: AgentRegistry = AgentRegistry.global()): void {
		const refs = registry.list();
		const refsById = new Map(refs.map(ref => [ref.id, ref]));
		const seeded = new Set<string>();
		const seed = (ref: AgentRef): void => {
			if (seeded.has(ref.id)) return;
			seeded.add(ref.id);
			const parent = ref.parentId ? refsById.get(ref.parentId) : undefined;
			if (parent) seed(parent);
			this.#seedAgentRef(ref);
		};
		for (const ref of refs) seed(ref);
	}

	/** Keep the seeded projection current as agents change state or are removed. */
	subscribeToAgentRegistry(registry: AgentRegistry = AgentRegistry.global()): void {
		this.#registryUnsubscriber?.();
		this.seedFromAgentRegistry(registry);
		this.#registryUnsubscriber = registry.onChange(event => {
			if (event.ref.id === MAIN_AGENT_ID) return;
			if (event.type === "removed") {
				this.#applyPendingUpdates();
				this.#sessions.delete(event.ref.id);
				this.#tokenSamples.delete(event.ref.id);
				this.#sortedProjection = undefined;
			} else {
				this.#seedAgentRef(event.ref);
			}
			this.#scheduleFlush();
		});
	}
	/**
	 * Rehydrate terminal child journals that predate the current process. The
	 * registry remains authoritative for live refs; journals fill only rows the
	 * registry cannot know after a restart.
	 */
	async seedFromSessionJournals(parentSessionFile?: string): Promise<void> {
		if (!parentSessionFile) return;
		const queue: Array<{ sessionFile: string; parentAgentId: string }> = [
			{ sessionFile: parentSessionFile, parentAgentId: MAIN_AGENT_ID },
		];
		const visited = new Set<string>();
		while (queue.length > 0) {
			const current = queue.shift()!;
			if (visited.has(current.sessionFile)) continue;
			visited.add(current.sessionFile);
			const children = await listArchivedDirectChildren(current.sessionFile);
			for (const child of children) {
				const existing = this.#sessions.get(child.agentId);
				if (!existing) {
					const sortOrder = this.#ensureSortOrder(child.agentId);
					this.#ensureParentSortOrder(current.parentAgentId, this.#ensureSortOrder(current.parentAgentId));
					this.#sessions.set(child.agentId, {
						id: child.agentId,
						kind: "subagent",
						label: child.agentId,
						description: child.agentId,
						status: child.state === "failed" ? "failed" : child.state === "interrupted" ? "aborted" : "completed",
						registryStatus: "parked",
						sessionFile: child.childSessionFile,
						parentAgentId: current.parentAgentId,
						detached: true,
						index: sortOrder,
						lastUpdate: Date.parse(child.updatedAt) || Date.now(),
						tokenRate: 0,
						tokenRateStuck: false,
					});
					this.#sortedProjection = undefined;
				}
				queue.push({ sessionFile: child.childSessionFile, parentAgentId: child.agentId });
			}
		}
		if (visited.size > 0) this.#scheduleFlush();
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
		this.#refreshTokenRates(Date.now());
		if (this.#sortedProjection) return this.#sortedProjection;
		const sessions = [...this.#sessions.values()];
		sessions.sort((a, b) => {
			if (a.kind === "main" && b.kind !== "main") return -1;
			if (b.kind === "main" && a.kind !== "main") return 1;
			if (a.kind === "main" || b.kind === "main") return 0;

			const aTreePath = this.#getTreeSortPath(a);
			const bTreePath = this.#getTreeSortPath(b);
			if (aTreePath && bTreePath) {
				const pathLength = Math.min(aTreePath.length, bTreePath.length);
				for (let index = 0; index < pathLength; index++) {
					const pathDiff = aTreePath[index]! - bTreePath[index]!;
					if (pathDiff !== 0) return pathDiff;
				}
				if (aTreePath.length !== bTreePath.length) return aTreePath.length - bTreePath.length;
			} else {
				const groupDiff = this.#getGroupOrder(a) - this.#getGroupOrder(b);
				if (groupDiff !== 0) return groupDiff;

				const aIndex = a.index ?? Number.MAX_SAFE_INTEGER;
				const bIndex = b.index ?? Number.MAX_SAFE_INTEGER;
				if (aIndex !== bIndex) return aIndex - bIndex;
			}

			return this.#getStableOrder(a) - this.#getStableOrder(b);
		});
		this.#performanceCounters.projectionRebuilds++;
		this.#sortedProjection = sessions;
		return sessions;
	}

	getActiveSubagentCount(): number {
		this.#applyPendingUpdates();
		let count = 0;
		let lifecycle: AgentLifecycleManager | undefined;
		for (const s of this.#sessions.values()) {
			if (s.kind !== "subagent" || s.status !== "active") continue;
			// A running child stranded with durable terminal evidence and no live
			// model/job work is not really active. Reconcile it against the
			// lifecycle authority before projecting the count: exclude it now via
			// the authority's synchronous evidence gate and kick a durable park.
			// Evidence-gated and idempotent, so a genuinely live peer is never
			// touched and there is no polling.
			if (s.registryStatus === "running") {
				lifecycle ??= AgentLifecycleManager.global();
				if (lifecycle.isParking(s.id)) continue;
				if (lifecycle.isReconcilableStaleOrphan(s.id)) {
					void lifecycle.reconcileStaleOrphan(s.id);
					continue;
				}
			}
			count++;
		}
		return count;
	}

	/** Clear all tracked sessions (e.g. on session switch). Keeps EventBus subscriptions and listeners. */
	resetSessions(): void {
		this.#sessions.clear();
		this.#pendingUpdates.clear();
		this.#tokenSamples.clear();
		this.#sortOrderById.clear();
		this.#parentSortOrderById.clear();
		this.#nextSortOrder = 0;
		this.#sortedProjection = undefined;
		this.#scheduleFlush();
	}

	dispose(): void {
		for (const unsub of this.#eventBusUnsubscribers) unsub();
		this.#registryUnsubscriber?.();
		this.#registryUnsubscriber = undefined;
		this.#tokenSamples.clear();
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
				this.#recordProgressRate(id, progress.tokens, progress.outputTokens ?? 0, Date.now());
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
