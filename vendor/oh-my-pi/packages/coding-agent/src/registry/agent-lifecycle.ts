/**
 * AgentLifecycleManager - Owns the idle → parked → revived lifecycle of
 * adopted subagents.
 *
 * The task executor hands a finished agent over via {@link AgentLifecycleManager.adopt};
 * from then on the manager arms a TTL timer whenever the agent goes `idle`,
 * parks it on expiry (disposes the live session, keeps the AgentRef +
 * sessionFile), and revives it on demand through
 * {@link AgentLifecycleManager.ensureLive}. Only this manager flips
 * `parked` ↔ `idle`.
 */

import { logger } from "@oh-my-pi/pi-utils";
import { AsyncJobManager } from "../async/job-manager";
import type { AgentSession } from "../session/agent-session";
import { isTerminalChildLifecycleState, latestChildLifecycleRecord, transitionChildLifecycleRecord } from "../task/child-lifecycle";
import { appendLifecycleEvent } from "../task/route-events";
import { AgentRegistry, MAIN_AGENT_ID, type AgentRef, type RegistryEvent } from "./agent-registry";

export type SessionSubscriptionRegistrar = (unsubscribe: () => void) => void;

export type AgentReviver = (registerSubscription: SessionSubscriptionRegistrar) => Promise<AgentSession>;

export interface AdoptOptions {
	/** TTL before an idle agent is parked. <= 0 disables parking. */
	idleTtlMs: number;
	/** Recreates a live AgentSession from the ref's sessionFile. Absent => not resumable after park (e.g. isolated runs). */
	revive?: AgentReviver;
	/** Child-owned listener for the currently attached live session. */
	sessionSubscription?: () => void;
}

interface AdoptedAgent {
	idleTtlMs: number;
	revive?: AgentReviver;
	sessionSubscription?: () => void;
	timer?: NodeJS.Timeout;
}

export type StaleOrphanReconcileResult =
	| { reconciled: true }
	| {
			reconciled: false;
			reason:
				| "not_running_subagent"
				| "parking_in_progress"
				| "live_async_job"
				| "live_model_turn"
				| "missing_terminal_evidence"
				| "persistence_failed"
				| "changed_during_reconcile"
				| "dispose_failed";
		};

export class AgentLifecycleManager {
	static #global: AgentLifecycleManager | undefined;

	static global(): AgentLifecycleManager {
		if (!AgentLifecycleManager.#global) {
			AgentLifecycleManager.#global = new AgentLifecycleManager();
		}
		return AgentLifecycleManager.#global;
	}

	/** Reset the global manager. Test-only. */
	static resetGlobalForTests(): void {
		const current = AgentLifecycleManager.#global;
		if (current) {
			current.#unsubscribe?.();
			current.#unsubscribe = undefined;
			for (const adopted of current.#adopted.values()) {
				clearTimeout(adopted.timer);
				adopted.sessionSubscription?.();
				adopted.sessionSubscription = undefined;
			}
			current.#adopted.clear();
			current.#revivals.clear();
			current.#parkings.clear();
			current.#releasing.clear();
		}
		AgentLifecycleManager.#global = undefined;
	}

	readonly #registry: AgentRegistry;
	readonly #adopted = new Map<string, AdoptedAgent>();
	/** In-flight releases, so all concurrent callers await the same cleanup. */
	readonly #releasing = new Map<string, Promise<void>>();
	/** In-flight parks, so a wake never returns a session that is being disposed. */
	readonly #parkings = new Map<string, Promise<unknown>>();
	/** In-flight revives, so concurrent {@link ensureLive} calls coalesce. */
	readonly #revivals = new Map<string, Promise<AgentSession>>();
	#unsubscribe: (() => void) | undefined;

	constructor(registry: AgentRegistry = AgentRegistry.global()) {
		this.#registry = registry;
		this.#unsubscribe = registry.onChange(event => this.#onRegistryEvent(event));
	}

	/**
	 * Take ownership of a finished subagent. Caller has already set registry
	 * status to "idle". Arms the TTL timer (idleTtlMs <= 0 adopts without one).
	 */
	adopt(id: string, opts: AdoptOptions): void {
		if (id === MAIN_AGENT_ID) return;
		if (!this.#registry.get(id)) {
			logger.warn("AgentLifecycleManager.adopt: unknown agent id", { id });
			return;
		}
		const existing = this.#adopted.get(id);
		clearTimeout(existing?.timer);
		existing?.sessionSubscription?.();
		const adopted: AdoptedAgent = {
			idleTtlMs: opts.idleTtlMs,
			revive: opts.revive,
			sessionSubscription: opts.sessionSubscription,
		};
		this.#adopted.set(id, adopted);
		this.#armTimer(id, adopted);
	}

	/** True if the id is adopted (parked or live). */
	has(id: string): boolean {
		return this.#adopted.has(id);
	}

	/** True while {@link park} is disposing this agent's session (lets dispose hooks distinguish park from teardown). */
	isParking(id: string): boolean {
		return this.#parkings.has(id);
	}

	/** Deterministic lifecycle resource counts. Test-only. */
	resourceCountsForTests(): { liveSessions: number; subscriptions: number; timers: number } {
		let liveSessions = 0;
		let subscriptions = 0;
		let timers = 0;
		for (const [id, adopted] of this.#adopted) {
			if (this.#registry.get(id)?.session) liveSessions++;
			if (adopted.sessionSubscription) subscriptions++;
			if (adopted.timer) timers++;
		}
		return { liveSessions, subscriptions, timers };
	}

	/**
	 * Persist the parked state, dispose the live session, detach it from the
	 * registry, and mark the agent `parked`. No-op unless the id is adopted,
	 * idle, and still owns the same live session.
	 */
	async park(id: string): Promise<void> {
		const current = this.#parkings.get(id);
		if (current) {
			await current;
			return;
		}
		const parking = this.#park(id);
		this.#parkings.set(id, parking);
		try {
			await parking;
		} finally {
			if (this.#parkings.get(id) === parking) this.#parkings.delete(id);
		}
	}

	/**
	 * Explicitly reconcile a peer stranded as `running` after its child journal
	 * recorded a terminal result. This never guesses: it refuses while that
	 * peer owns a live async job or model turn, and requires a flushed terminal
	 * record bound to the same child session before disposing it.
	 */
	async reconcileStaleOrphan(id: string): Promise<StaleOrphanReconcileResult> {
		if (this.#parkings.has(id)) return { reconciled: false, reason: "parking_in_progress" };
		const parking = this.#reconcileStaleOrphan(id);
		this.#parkings.set(id, parking);
		try {
			return await parking;
		} finally {
			if (this.#parkings.get(id) === parking) this.#parkings.delete(id);
		}
	}

	/**
	 * Return the live session, reviving from the sessionFile if parked.
	 * Throws a plain Error if the id is unknown or parked without a reviver.
	 * Concurrent calls share one in-flight revive.
	 */
	async ensureLive(id: string): Promise<AgentSession> {
		const parking = this.#parkings.get(id);
		if (parking) await parking;
		const ref = this.#registry.get(id);
		if (!ref) {
			throw new Error(
				`Unknown agent "${id}" — it was never registered or has been released. If a transcript exists, read history://${id}.`,
			);
		}
		if (ref.session) return ref.session;
		const inflight = this.#revivals.get(id);
		if (inflight) return inflight;
		const adopted = this.#adopted.get(id);
		if (ref.status !== "parked" || !adopted?.revive) {
			throw new Error(
				`Agent "${id}" is ${ref.status} and cannot be revived${adopted?.revive ? "" : " (no reviver registered)"}. Its transcript remains readable at history://${id}.`,
			);
		}
		const revival = this.#revive(id, adopted, ref.sessionFile);
		this.#revivals.set(id, revival);
		try {
			return await revival;
		} finally {
			if (this.#revivals.get(id) === revival) this.#revivals.delete(id);
		}
	}

	/** Hard removal: dispose if live, unregister from registry, drop timers. */
	async release(id: string): Promise<void> {
		const current = this.#releasing.get(id);
		if (current) return current;
		const releasing = this.#release(id);
		this.#releasing.set(id, releasing);
		try {
			await releasing;
		} finally {
			if (this.#releasing.get(id) === releasing) this.#releasing.delete(id);
		}
	}

	async #release(id: string): Promise<void> {
		const adopted = this.#adopted.get(id);
		const revival = this.#revivals.get(id);
		clearTimeout(adopted?.timer);
		adopted?.sessionSubscription?.();
		if (adopted) adopted.sessionSubscription = undefined;
		this.#adopted.delete(id);
		await this.#parkings.get(id);
		await revival?.catch(() => undefined);
		const ref = this.#registry.get(id);
		if (ref?.session) {
			try {
				await ref.session.dispose({ scope: "child" });
			} catch (error) {
				logger.warn("AgentLifecycleManager.release: session dispose failed", { id, error: String(error) });
			}
		}
		this.#registry.unregister(id);
	}

	/**
	 * Relinquish this process's live lifecycle bookkeeping without deleting
	 * durable child descriptors. Detached/out-of-process children keep running;
	 * in-process children are recovered from their non-terminal journals by the
	 * replacement controller.
	 */
	async detach(): Promise<void> {
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		for (const adopted of this.#adopted.values()) {
			clearTimeout(adopted.timer);
			adopted.timer = undefined;
		}
		await Promise.all([
			...this.#parkings.values(),
			...[...this.#revivals.values()].map(revival => revival.catch(() => undefined)),
			...this.#releasing.values(),
		]);
		for (const adopted of this.#adopted.values()) {
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = undefined;
		}
		this.#adopted.clear();
		this.#revivals.clear();
		this.#parkings.clear();
		this.#releasing.clear();
	}

	/** Teardown everything (process exit / main session dispose). */
	async dispose(): Promise<void> {
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		const ids = [...this.#adopted.keys()];
		await Promise.all(ids.map(id => this.release(id)));
		this.#revivals.clear();
		this.#parkings.clear();
		this.#releasing.clear();
	}

	async #park(id: string): Promise<void> {
		if (this.#releasing.has(id)) return;
		const adopted = this.#adopted.get(id);
		const ref = this.#registry.get(id);
		const session = ref?.session;
		if (!adopted || !ref || !session || ref.status !== "idle") return;
		if (adopted.timer) {
			clearTimeout(adopted.timer);
			adopted.timer = undefined;
		}
		const sessionManager = session.sessionManager;
		if (sessionManager) {
			try {
				appendLifecycleEvent(sessionManager, id, "park", "idle", "parked");
				transitionChildLifecycleRecord(sessionManager, "parked");
				await sessionManager.flush();
			} catch (error) {
				logger.warn("AgentLifecycleManager.park: could not persist parked state", { id, error: String(error) });
				this.#armTimer(id, adopted);
				return;
			}
		}
		if (
			this.#releasing.has(id) ||
			this.#adopted.get(id) !== adopted ||
			this.#registry.get(id) !== ref ||
			ref.session !== session ||
			ref.status !== "idle"
		) {
			return;
		}
		adopted.sessionSubscription?.();
		adopted.sessionSubscription = undefined;
		try {
			await session.dispose({ scope: "child" });
		} catch (error) {
			logger.warn("AgentLifecycleManager.park: session dispose failed", { id, error: String(error) });
		}
		// Once disposal begins, this session cannot safely remain discoverable.
		// Only a replacement ref/session may take ownership away from this park.
		if (this.#registry.get(id) !== ref || ref.session !== session) return;
		this.#registry.detachSession(id);
		this.#registry.setStatus(id, "parked");
	}

	#hasLiveWork(id: string, session: AgentSession): "live_async_job" | "live_model_turn" | undefined {
		if (AsyncJobManager.instance()?.getRunningJobs({ ownerId: id }).length) return "live_async_job";
		if (session.isStreaming) return "live_model_turn";
		return undefined;
	}

	#hasDurableTerminalEvidence(id: string, ref: AgentRef, session: AgentSession): boolean {
		if (!ref.sessionFile) return false;
		const record = latestChildLifecycleRecord(session.sessionManager.getEntries());
		return (
			record !== null &&
			record !== undefined &&
			record.agentId === id &&
			record.childSessionFile === ref.sessionFile &&
			isTerminalChildLifecycleState(record.state)
		);
	}

	async #reconcileStaleOrphan(id: string): Promise<StaleOrphanReconcileResult> {
		if (this.#releasing.has(id)) return { reconciled: false, reason: "changed_during_reconcile" };
		const ref = this.#registry.get(id);
		const session = ref?.session;
		if (!ref || ref.kind !== "sub" || ref.status !== "running" || !session || id === MAIN_AGENT_ID) {
			return { reconciled: false, reason: "not_running_subagent" };
		}
		const liveWork = this.#hasLiveWork(id, session);
		if (liveWork) return { reconciled: false, reason: liveWork };
		if (!this.#hasDurableTerminalEvidence(id, ref, session)) {
			return { reconciled: false, reason: "missing_terminal_evidence" };
		}
		try {
			await session.sessionManager.flush();
		} catch (error) {
			logger.warn("AgentLifecycleManager.reconcileStaleOrphan: could not flush terminal evidence", {
				id,
				error: String(error),
			});
			return { reconciled: false, reason: "persistence_failed" };
		}
		if (
			this.#releasing.has(id) ||
			this.#registry.get(id) !== ref ||
			ref.session !== session ||
			ref.status !== "running"
		) {
			return { reconciled: false, reason: "changed_during_reconcile" };
		}
		const postFlushLiveWork = this.#hasLiveWork(id, session);
		if (postFlushLiveWork) return { reconciled: false, reason: postFlushLiveWork };
		if (!this.#hasDurableTerminalEvidence(id, ref, session)) {
			return { reconciled: false, reason: "missing_terminal_evidence" };
		}
		const adopted = this.#adopted.get(id);
		clearTimeout(adopted?.timer);
		if (adopted) {
			adopted.timer = undefined;
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = undefined;
		}
		try {
			await session.dispose({ scope: "child" });
		} catch (error) {
			logger.warn("AgentLifecycleManager.reconcileStaleOrphan: session dispose failed", { id, error: String(error) });
		}
		// Once disposal begins, this session cannot safely remain discoverable.
		// Only a replacement ref/session may take ownership away from this park.
		if (this.#registry.get(id) !== ref || ref.session !== session) {
			return { reconciled: false, reason: "changed_during_reconcile" };
		}
		this.#registry.detachSession(id);
		this.#registry.setStatus(id, "parked");
		return { reconciled: true };
	}

	async #revive(id: string, adopted: AdoptedAgent, sessionFile: string | null): Promise<AgentSession> {
		const registerSubscription: SessionSubscriptionRegistrar = unsubscribe => {
			if (this.#adopted.get(id) !== adopted) {
				unsubscribe();
				return;
			}
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = unsubscribe;
		};
		let session: AgentSession;
		try {
			session = await adopted.revive!(registerSubscription);
		} catch (error) {
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = undefined;
			throw error;
		}
		const ref = this.#registry.get(id);
		if (this.#adopted.get(id) !== adopted || !ref || ref.status !== "parked" || ref.session) {
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = undefined;
			await session.dispose({ scope: "child" });
			throw new Error(`Agent "${id}" was released or replaced while reviving.`);
		}
		const sessionManager = session.sessionManager;
		try {
			if (sessionManager) {
				appendLifecycleEvent(sessionManager, id, "revive", "parked", "idle");
				transitionChildLifecycleRecord(sessionManager, "idle");
				await sessionManager.flush();
			}
		} catch (error) {
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = undefined;
			try {
				await session.dispose({ scope: "child" });
			} catch (disposeError) {
				logger.warn("AgentLifecycleManager.revive: session dispose failed", { id, error: String(disposeError) });
			}
			throw error;
		}
		if (
			this.#adopted.get(id) !== adopted ||
			this.#registry.get(id) !== ref ||
			ref.status !== "parked" ||
			ref.session
		) {
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = undefined;
			await session.dispose({ scope: "child" });
			throw new Error(`Agent "${id}" was released or replaced while reviving.`);
		}
		this.#registry.attachSession(id, session, sessionFile);
		this.#registry.setStatus(id, "idle");
		return session;
	}

	#armTimer(id: string, adopted: AdoptedAgent): void {
		if (adopted.idleTtlMs <= 0) return;
		clearTimeout(adopted.timer);
		const timer = setTimeout(() => {
			if (this.#adopted.get(id) !== adopted) return;
			adopted.timer = undefined;
			void this.park(id);
		}, adopted.idleTtlMs);
		timer.unref?.();
		adopted.timer = timer;
	}

	#onRegistryEvent(event: RegistryEvent): void {
		const adopted = this.#adopted.get(event.ref.id);
		if (!adopted) return;
		if (event.type === "removed") {
			clearTimeout(adopted.timer);
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = undefined;
			this.#adopted.delete(event.ref.id);
			return;
		}
		if (event.type !== "status_changed") return;
		if (event.ref.status === "running") {
			if (adopted.timer) {
				clearTimeout(adopted.timer);
				adopted.timer = undefined;
			}
		} else if (event.ref.status === "idle") {
			this.#armTimer(event.ref.id, adopted);
		}
	}
}
