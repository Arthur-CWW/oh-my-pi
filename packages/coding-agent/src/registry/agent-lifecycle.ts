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

import { gcAndSweep } from "bun:jsc";
import { randomUUID } from "node:crypto";
import { logger } from "@oh-my-pi/pi-utils";
import { AsyncJobManager } from "../async/job-manager";
import { resolveGlobalHostResourceAdmission } from "../resource/admission-bootstrap";
import { HostAdmissionRejectedError, type HostResourceLease } from "../resource/host-resource-admission";
import {
	type LeaseReleaseTally,
	leaseReleaseTally,
	PendingHostLeaseReleases,
} from "../resource/pending-lease-releases";
import { readProcessIdentity } from "../resource/process-identity";
import type { AgentSession } from "../session/agent-session";
import {
	isTerminalChildLifecycleState,
	latestChildLifecycleRecord,
	transitionChildLifecycleRecord,
} from "../task/child-lifecycle";
import { appendLifecycleEvent } from "../task/route-events";
import { type AgentRef, AgentRegistry, MAIN_AGENT_ID, type RegistryEvent } from "./agent-registry";

export type SessionSubscriptionRegistrar = (unsubscribe: () => void) => void;

export type AgentReviver = (registerSubscription: SessionSubscriptionRegistrar) => Promise<AgentSession>;
export type ResourceLeaseAcquirer = (agentId: string) => Promise<HostResourceLease>;

export interface AdoptOptions {
	/** TTL before an idle agent is parked. <= 0 disables parking. */
	idleTtlMs: number;
	/** Recreates a live AgentSession from the ref's sessionFile. Absent => not resumable after park (e.g. isolated runs). */
	revive?: AgentReviver;
	/** Acquire the host-scoped fenced lease before rebuilding this session. */
	acquireResourceLease?: ResourceLeaseAcquirer;
	/** Child-owned listener for the currently attached live session. */
	sessionSubscription?: () => void;
}

interface AdoptedAgent {
	idleTtlMs: number;
	revive?: AgentReviver;
	acquireResourceLease?: ResourceLeaseAcquirer;
	resourceLease?: HostResourceLease;
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

/**
 * Raise what a teardown could not absorb, once the caller's own bookkeeping is
 * done. Failures are collected instead of thrown in place so one damaged host
 * database — or one park that died mid-flight — cannot leave half a teardown
 * behind it.
 */
function throwCleanupFailures(failures: readonly unknown[], summary: string): void {
	if (failures.length === 0) return;
	if (failures.length === 1) throw failures[0];
	throw new AggregateError(failures, summary);
}

const LEASE_CLEANUP_SUMMARY = "Failed to release one or more host resource leases";

/**
 * Where a refused handback lives. Retry ownership cannot sit on a manager: a
 * reset or a controller handover replaces the manager while releases started
 * under it are still in flight, and the durable row outlives the authority that
 * granted it. The service takes ownership the moment a release begins and
 * retries on its own asynchronous schedule, so every cleanup path here is a
 * best-effort nudge rather than the row's last chance.
 */
function pendingLeases(): PendingHostLeaseReleases {
	return PendingHostLeaseReleases.global();
}

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
		// Cleared first: a corrupt host authority must not be able to leave a
		// half-torn-down manager installed for whatever runs next.
		AgentLifecycleManager.#global = undefined;
		if (!current) return;
		current.#unsubscribe?.();
		current.#unsubscribe = undefined;
		const tally = leaseReleaseTally();
		for (const [id, adopted] of current.#adopted) {
			clearTimeout(adopted.timer);
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = undefined;
			current.#releaseResourceLease(id, adopted, tally);
		}
		// A nudge, not a last chance: what the authority still refuses stays owned
		// by the process-global service, which keeps retrying it after this
		// manager — and any release still in flight under it — is gone.
		pendingLeases().sweep(undefined, tally);
		current.#adopted.clear();
		current.#revivals.clear();
		current.#parkings.clear();
		current.#releasing.clear();
		throwCleanupFailures(tally.corruption, LEASE_CLEANUP_SUMMARY);
	}

	readonly #registry: AgentRegistry;
	readonly #adopted = new Map<string, AdoptedAgent>();
	/** In-flight releases, so all concurrent callers await the same cleanup. */
	readonly #releasing = new Map<string, Promise<void>>();
	/** In-flight parks, so a wake never returns a session that is being disposed. */
	readonly #parkings = new Map<string, Promise<unknown>>();
	/** In-flight revives, so concurrent {@link ensureLive} calls coalesce. */
	readonly #revivals = new Map<string, Promise<AgentSession>>();
	/** In-flight pressure reclaim, so concurrent doorbells share one invocation and one answer. */
	#pressureReclaim: Promise<number> | undefined;
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
			acquireResourceLease: opts.acquireResourceLease,
			sessionSubscription: opts.sessionSubscription,
			resourceLease: existing?.resourceLease,
		};
		this.#adopted.set(id, adopted);
		this.#armTimer(id, adopted);
	}

	/** True if the id is adopted (parked or live). */
	has(id: string): boolean {
		return this.#adopted.has(id);
	}

	/** True when an idle or parked agent can accept a follow-up turn in place. */
	canResumeInPlace(id: string): boolean {
		const ref = this.#registry.get(id);
		const adopted = this.#adopted.get(id);
		if (!ref || !adopted) return false;
		if (ref.status === "idle") return ref.session !== null;
		return ref.status === "parked" && adopted.revive !== undefined;
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

	/** Durable rows this process still owes the host authority. Test-only. */
	pendingLeaseCountForTests(): number {
		return pendingLeases().owed();
	}

	/** Immediately park every adopted idle child while leaving live work untouched. */
	async parkIdleAgents(): Promise<number> {
		const candidates = [...this.#adopted.keys()].filter(id => this.#registry.get(id)?.status === "idle");
		const results = await Promise.allSettled(candidates.map(id => this.park(id)));
		const failures = results.flatMap(result => (result.status === "rejected" ? [result.reason] : []));
		if (failures.length > 0) throw new AggregateError(failures, "Failed to park one or more idle agents");
		return candidates.reduce((count, id) => {
			const ref = this.#registry.get(id);
			return count + (ref?.status === "parked" && ref.session === null ? 1 : 0);
		}, 0);
	}

	/** Permanently release adopted parked children and their retained revival state. */
	async releaseParkedAgents(): Promise<number> {
		const candidates = [...this.#adopted.keys()].filter(id => this.#registry.get(id)?.status === "parked");
		const results = await Promise.allSettled(candidates.map(id => this.release(id)));
		const failures = results.flatMap(result => (result.status === "rejected" ? [result.reason] : []));
		if (failures.length > 0) throw new AggregateError(failures, "Failed to release one or more parked agents");
		return candidates.reduce((count, id) => count + (this.#registry.get(id) === undefined ? 1 : 0), 0);
	}

	/**
	 * Cooperative host-pressure doorbell: force the Bun/JSC collector, then park
	 * every currently idle child so its live session resources are disposed.
	 *
	 * Reports host slots this invocation actually handed back, not children
	 * parked and not a level difference. The waiter that rang this doorbell is
	 * queued behind durable rows, and a park whose lease release the authority
	 * refused frees none of them: that row is still owned by this live process
	 * and expiry reaping will not touch it.
	 *
	 * Concurrent doorbells share one invocation. Two runs racing over the same
	 * rows would each subtract the same slot from their own before/after
	 * snapshot and each claim it, telling one waiter twice over that capacity it
	 * never got had arrived.
	 */
	reclaimIdleChildrenForHostPressure(): Promise<number> {
		const inFlight = this.#pressureReclaim;
		// The same promise, not a wrapper around it: a joining doorbell shares the
		// invocation's answer rather than being a second claim on the same rows.
		if (inFlight) return inFlight;
		const reclaiming = this.#reclaimIdleChildrenForHostPressure().finally(() => {
			if (this.#pressureReclaim === reclaiming) this.#pressureReclaim = undefined;
		});
		this.#pressureReclaim = reclaiming;
		return reclaiming;
	}

	async #reclaimIdleChildrenForHostPressure(): Promise<number> {
		Bun.gc(true);
		gcAndSweep();
		const tally = leaseReleaseTally();
		const idleIds = [...this.#adopted.keys()].filter(id => this.#registry.get(id)?.status === "idle");
		// Every park settles first: relief that stops at the first damaged lease
		// reclaims nothing from the children behind it. Each park counts into this
		// invocation's tally, so what is reported is what it released.
		const settled = await Promise.allSettled(idleIds.map(id => this.#parkCoalesced(id, tally)));
		const failures: unknown[] = settled.flatMap(result => (result.status === "rejected" ? [result.reason] : []));
		// Unscoped: every owed row is capacity this process holds, and a blocked
		// waiter cannot tell which child it is queued behind. Parks from an
		// earlier doorbell left theirs owed here too.
		pendingLeases().sweep(undefined, tally);
		failures.push(...tally.corruption);
		throwCleanupFailures(failures, "Failed to park one or more idle agents");
		return tally.released;
	}

	/**
	 * Persist the parked state, dispose the live session, detach it from the
	 * registry, and mark the agent `parked`. No-op unless the id is adopted,
	 * idle, and still owns the same live session.
	 */
	async park(id: string): Promise<void> {
		return this.#parkCoalesced(id, undefined);
	}

	/**
	 * One park per agent, however many callers ask for it. `counted` belongs to
	 * the caller that started this park: it collects what the park released and
	 * absorbs what it could not, so a pressure invocation reports its own work
	 * instead of inferring it from a snapshot. A caller that merely joins an
	 * in-flight park counts nothing — those releases are the starter's.
	 */
	async #parkCoalesced(id: string, counted: LeaseReleaseTally | undefined): Promise<void> {
		const current = this.#parkings.get(id);
		if (current) {
			await current;
			return;
		}
		const parking = this.#park(id, counted);
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
	 * Synchronous evidence check mirroring {@link reconcileStaleOrphan}'s gate:
	 * a `running` subagent that owns a live session, carries a durable terminal
	 * lifecycle record bound to that session, and has no live model turn or
	 * owned async job. Lets the HUD projection drop a provably-dead peer from
	 * the active count before the async park lands, without any polling.
	 */
	isReconcilableStaleOrphan(id: string): boolean {
		if (this.#parkings.has(id) || this.#releasing.has(id)) return false;
		const ref = this.#registry.get(id);
		const session = ref?.session;
		if (ref?.kind !== "sub" || ref.status !== "running" || !session || id === MAIN_AGENT_ID) return false;
		if (this.#hasLiveWork(id, session)) return false;
		return this.#hasDurableTerminalEvidence(id, ref, session);
	}

	/**
	 * Reconcile every stranded `running` subagent that now has durable terminal
	 * evidence and no live work into `parked`, before a caller reads live-work
	 * counts (HUD active projection, shutdown stop/detach confirmation). Each
	 * child goes through the same evidence-gated, idempotent path as
	 * {@link reconcileStaleOrphan}; live peers are left untouched. Returns the
	 * ids that were parked.
	 */
	async reconcileStaleOrphans(): Promise<string[]> {
		const candidates = this.#registry
			.list()
			.filter(ref => ref.kind === "sub" && ref.status === "running" && ref.id !== MAIN_AGENT_ID);
		const outcomes = await Promise.all(
			candidates.map(async ref => ((await this.reconcileStaleOrphan(ref.id)).reconciled ? ref.id : undefined)),
		);
		return outcomes.filter((id): id is string => id !== undefined);
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
		const revival = this.#revive(id, adopted, ref);
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
		const failures: unknown[] = [];
		// A park that died on a damaged authority has already detached the
		// session. Its failure is carried, not propagated here: hard removal
		// still has an agent to unregister.
		const parking = this.#parkings.get(id);
		if (parking) {
			try {
				await parking;
			} catch (error) {
				failures.push(error);
			}
		}
		await revival?.catch(() => undefined);
		const ref = this.#registry.get(id);
		if (ref?.session) {
			try {
				await ref.session.dispose({ scope: "child" });
			} catch (error) {
				logger.warn("AgentLifecycleManager.release: session dispose failed", { id, error: String(error) });
			}
		}
		failures.push(...this.#releaseAgentLeases(id, adopted).corruption);
		// Unregistering is what removes the agent. It runs before any failure
		// escapes, so a damaged host database cannot leave a released agent
		// still registered around a session that is already disposed.
		this.#registry.unregister(id);
		throwCleanupFailures(failures, `Failed to finish releasing agent "${id}"`);
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
		// Settled, not raced. A park or release that dies on a damaged authority
		// must not skip the rest of this teardown, and what it raised belongs in
		// the aggregate reported once every map is clear.
		const settled = await Promise.allSettled([
			...this.#parkings.values(),
			...[...this.#revivals.values()].map(revival => revival.catch(() => undefined)),
			...this.#releasing.values(),
		]);
		const failures: unknown[] = settled.flatMap(result => (result.status === "rejected" ? [result.reason] : []));
		const tally = leaseReleaseTally();
		for (const [id, adopted] of this.#adopted) {
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = undefined;
			this.#releaseResourceLease(id, adopted, tally);
		}
		pendingLeases().sweep(undefined, tally);
		failures.push(...tally.corruption);
		this.#adopted.clear();
		this.#revivals.clear();
		this.#parkings.clear();
		this.#releasing.clear();
		// Rows the authority still refuses stay owned by the process-global
		// service: detach relinquishes bookkeeping, not the host slots this
		// process holds and must keep offering back.
		throwCleanupFailures(failures, LEASE_CLEANUP_SUMMARY);
	}

	/** Park child sessions after their supervised turns have soft-stopped, then relinquish lifecycle ownership. */
	async checkpointRestart(ids: readonly string[]): Promise<void> {
		for (const id of ids) {
			if (this.#registry.get(id)?.status === "idle" && this.#adopted.has(id)) await this.park(id);
		}
		await this.detach();
	}

	/** Teardown everything (process exit / main session dispose). */
	async dispose(): Promise<void> {
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		const ids = [...this.#adopted.keys()];
		const settled = await Promise.allSettled(ids.map(id => this.release(id)));
		const failures: unknown[] = settled.flatMap(result => (result.status === "rejected" ? [result.reason] : []));
		failures.push(...pendingLeases().sweep().corruption);
		this.#revivals.clear();
		this.#parkings.clear();
		this.#releasing.clear();
		throwCleanupFailures(failures, "Failed to release one or more agents");
	}

	async #park(id: string, counted: LeaseReleaseTally | undefined): Promise<void> {
		if (this.#releasing.has(id)) return;
		const adopted = this.#adopted.get(id);
		const ref = this.#registry.get(id);
		const session = ref?.session;
		if (!adopted || !ref || !session || ref.status !== "idle") return;
		if (adopted.timer) {
			clearTimeout(adopted.timer);
			adopted.timer = undefined;
		}
		// Publish the transition before the first await. Message delivery uses
		// `parked` as the reserve-before-revive path; leaving this ref `idle`
		// during flush/dispose lets a sender target a session that is already
		// dying and falsely report a successful wake.
		this.#registry.setStatus(id, "parked");
		const sessionManager = session.sessionManager;
		if (sessionManager) {
			try {
				appendLifecycleEvent(sessionManager, id, "park", "idle", "parked");
				transitionChildLifecycleRecord(sessionManager, "parked");
				await sessionManager.flush();
			} catch (error) {
				logger.warn("AgentLifecycleManager.park: could not persist parked state", { id, error: String(error) });
				if (
					this.#adopted.get(id) === adopted &&
					this.#registry.get(id) === ref &&
					ref.session === session &&
					this.#registry.get(id)?.status === "parked"
				) {
					// Persistence is authoritative: make the still-live session
					// visible again. The idle status event re-arms its TTL.
					this.#registry.setStatus(id, "idle");
				}
				return;
			}
		}
		if (
			this.#releasing.has(id) ||
			this.#adopted.get(id) !== adopted ||
			this.#registry.get(id) !== ref ||
			ref.session !== session ||
			this.#registry.get(id)?.status !== "parked"
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
		// A counted park belongs to a caller that reports the whole invocation:
		// it collects the failures too, so one damaged lease cannot cancel the
		// parks behind it before that caller has seen them all.
		const tally = this.#releaseAgentLeases(id, adopted, counted);
		if (!counted) throwCleanupFailures(tally.corruption, LEASE_CLEANUP_SUMMARY);
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
		if (ref?.kind !== "sub" || ref.status !== "running" || !session || id === MAIN_AGENT_ID) {
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
			logger.warn("AgentLifecycleManager.reconcileStaleOrphan: session dispose failed", {
				id,
				error: String(error),
			});
		}
		// Once disposal begins, this session cannot safely remain discoverable.
		// Only a replacement ref/session may take ownership away from this park.
		if (this.#registry.get(id) !== ref || ref.session !== session) {
			return { reconciled: false, reason: "changed_during_reconcile" };
		}
		this.#registry.detachSession(id);
		this.#registry.setStatus(id, "parked");
		throwCleanupFailures(this.#releaseAgentLeases(id, adopted).corruption, LEASE_CLEANUP_SUMMARY);
		return { reconciled: true };
	}

	async #revive(id: string, adopted: AdoptedAgent, parkedRef: AgentRef): Promise<AgentSession> {
		const registerSubscription: SessionSubscriptionRegistrar = unsubscribe => {
			if (this.#adopted.get(id) !== adopted) {
				unsubscribe();
				return;
			}
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = unsubscribe;
		};
		// A park this child lost to a contended authority leaves a row this
		// process still owes. Nothing is acquired on top of it: two granted rows
		// for one live child each consume a host slot only this process can
		// return, and under a single-row budget the replacement would queue
		// behind this child's own row, which expiry reaping refuses to reclaim
		// while the holder is alive. So the revival nudges the handback service
		// once — synchronously, because the uncontended case finishes in the same
		// tick it always did — and refuses if anything is still owed. The service
		// keeps retrying in the background; the caller can wake this child again
		// once the writer that refused it lets go.
		const owed = this.#releaseAgentLeases(id, adopted);
		throwCleanupFailures(owed.corruption, LEASE_CLEANUP_SUMMARY);
		const stillOwed = pendingLeases().owed(id);
		if (stillOwed > 0) {
			throw new HostAdmissionRejectedError(
				"authority-unavailable",
				`Cannot revive ${id}: the host authority refused ${stillOwed} lease release(s) this agent still owns`,
			);
		}
		let resourceLease: HostResourceLease | undefined;
		let session: AgentSession;
		try {
			// Admission happens while the ref is still parked. The mailbox entry
			// reserved by IRC remains durable while this fair waiter is deferred.
			resourceLease = adopted.acquireResourceLease
				? await adopted.acquireResourceLease(id)
				: await this.#acquireDefaultReviveLease(id, parkedRef);
			session = await adopted.revive!(registerSubscription);
		} catch (error) {
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = undefined;
			this.#releaseUnownedLease(resourceLease, id);
			throw error;
		}
		if (!resourceLease) {
			throw new HostAdmissionRejectedError(
				"authority-unavailable",
				`Host resource authority returned no lease while reviving ${id}`,
			);
		}
		const ref = this.#registry.get(id);
		if (this.#adopted.get(id) !== adopted || !ref || ref !== parkedRef || (ref.session && ref.session !== session)) {
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = undefined;
			await this.#disposeRevivedSession(id, session);
			this.#releaseUnownedLease(resourceLease, id);
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
			this.#releaseUnownedLease(resourceLease, id);
			throw error;
		}
		if (
			this.#adopted.get(id) !== adopted ||
			this.#registry.get(id) !== ref ||
			(ref.session && ref.session !== session)
		) {
			adopted.sessionSubscription?.();
			adopted.sessionSubscription = undefined;
			await this.#disposeRevivedSession(id, session);
			this.#releaseUnownedLease(resourceLease, id);
			throw new Error(`Agent "${id}" was released or replaced while reviving.`);
		}
		// A successful revive owns the host lease until cleanup parks, releases,
		// or detaches this session. Every failure above releases after cleanup.
		// Nothing is overwritten here: the sweep above emptied this record, and a
		// row it could not hand back would have refused the revival outright.
		adopted.resourceLease = resourceLease;
		if (!ref.session) this.#registry.attachSession(id, session, parkedRef.sessionFile);
		this.#registry.setStatus(id, "idle");
		return session;
	}

	async #disposeRevivedSession(id: string, session: AgentSession): Promise<void> {
		try {
			await session.dispose({ scope: "child" });
		} catch (error) {
			logger.warn("AgentLifecycleManager.revive: session dispose failed", { id, error: String(error) });
		}
	}

	/**
	 * Hand a host lease back to the service that owns refused releases, and
	 * report what this cleanup could not absorb.
	 *
	 * The handle leaves the record before the attempt runs. A terminal release
	 * is finished; anything else is already owned by the service, which then
	 * holds the only reference — so no cleanup ever hits the authority twice for
	 * the same lease, and deleting or replacing the record cannot drop the last
	 * reference to a row this live process still holds.
	 *
	 * Corruption is returned to the caller, because nothing downstream repairs
	 * it and swallowing it here is how a damaged host database goes unnoticed
	 * for an entire session. Accumulated rather than thrown: every caller has
	 * registry, session and map bookkeeping to finish first, and a half-torn-down
	 * manager outlives the error that caused it.
	 */
	#releaseResourceLease(id: string, adopted: AdoptedAgent | undefined, tally: LeaseReleaseTally): void {
		const lease = adopted?.resourceLease;
		if (!lease) return;
		adopted.resourceLease = undefined;
		pendingLeases().handBack(id, lease, tally);
	}

	/**
	 * Hand back everything this agent still owes the authority: the handle on
	 * its record plus whatever earlier cleanups were refused. The two sets are
	 * disjoint by construction — a handle the service owns is no longer on any
	 * record — so this is one attempt per outstanding row.
	 */
	#releaseAgentLeases(id: string, adopted: AdoptedAgent | undefined, counted?: LeaseReleaseTally): LeaseReleaseTally {
		const tally = pendingLeases().sweep(id, counted);
		this.#releaseResourceLease(id, adopted, tally);
		return tally;
	}

	/**
	 * Release a lease no adopted record owns yet. Revive failure paths run this
	 * while already unwinding, so it reports rather than replaces the error on
	 * its way out — corruption included, which the next admission call raises
	 * anyway rather than losing the failure that actually broke the revive.
	 */
	#releaseUnownedLease(lease: HostResourceLease | undefined, id: string): void {
		if (!lease) return;
		const tally = pendingLeases().handBack(id, lease);
		for (const corruption of tally.corruption) {
			logger.warn("AgentLifecycleManager.revive: host resource lease release failed", {
				id,
				error: String(corruption),
			});
		}
	}

	async #acquireDefaultReviveLease(id: string, ref: AgentRef): Promise<HostResourceLease> {
		const holderProcess = readProcessIdentity(process.pid);
		if (!holderProcess) {
			throw new HostAdmissionRejectedError(
				"authority-unavailable",
				`Cannot prove process identity while reviving ${id}`,
			);
		}
		const attemptId = randomUUID();
		const admission = resolveGlobalHostResourceAdmission({
			onPressure: async () => {
				await this.reclaimIdleChildrenForHostPressure();
			},
		});
		return admission.acquire({
			attemptId,
			kind: "revive",
			sessionId: ref.parentId ?? MAIN_AGENT_ID,
			sessionOwnerEpoch: null,
			parentAgentId: ref.parentId ?? MAIN_AGENT_ID,
			agentId: id,
			jobId: `revive:${attemptId}`,
			holderProcess,
			reservationBytes: admission.childReservationBytes,
		});
	}

	#armTimer(id: string, adopted: AdoptedAgent): void {
		if (adopted.idleTtlMs <= 0) return;
		clearTimeout(adopted.timer);
		const timer = setTimeout(() => {
			if (this.#adopted.get(id) !== adopted) return;
			adopted.timer = undefined;
			// Nothing awaits an idle park, so its failure has to be absorbed here
			// or it becomes an unhandled rejection that fails an unrelated turn.
			void this.park(id).catch(error => {
				logger.warn("AgentLifecycleManager: idle park failed", { id, error: String(error) });
			});
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
			// The record is gone, the lease is not abandoned: a row the authority
			// refused stays owned by the handback service, which keeps retrying it
			// on its own schedule.
			const leaseFailures = this.#releaseAgentLeases(event.ref.id, adopted).corruption;
			// A registry listener has no caller to raise this to: the dispatch loop
			// swallows what a listener throws so one subscriber cannot break the
			// rest. The log is the only place corruption found here is visible.
			for (const failure of leaseFailures) {
				logger.error("AgentLifecycleManager: host resource authority is corrupt", {
					id: event.ref.id,
					error: String(failure),
				});
			}
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
