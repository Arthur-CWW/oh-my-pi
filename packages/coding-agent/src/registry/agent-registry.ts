/**
 * AgentRegistry - Process-global registry of agents (the main session plus
 * every subagent), keyed by stable id.
 *
 * Tracks each agent's status and (when live) its AgentSession so peers can be
 * addressed by id (`irc`, `task resume`, `history://`). Sessions are
 * registered explicitly at creation; finished agents stay registered as
 * `idle` (live) or `parked` (session disposed, ref + sessionFile retained for
 * revival) and are only removed on explicit release/teardown.
 */

import type { AgentSession } from "../session/agent-session";
import { oneLineLabel } from "../task/types";
import { type AgentRef, isAgentInLineage } from "./agent-ref";

export type { AgentRef } from "./agent-ref";

export const MAIN_AGENT_ID = "Main";

/**
 * - `running`: a turn is in flight.
 * - `idle`: live AgentSession in memory, awaiting work. Finished agents are
 *   `idle`, not removed.
 * - `parked`: session disposed; AgentRef + sessionFile retained, revivable.
 * - `aborted`: hard-killed, terminal.
 */
export type AgentStatus = "running" | "idle" | "parked" | "aborted";
export type AgentKind = "main" | "sub";

export interface AgentQuotaAdmission {
	originalProvider?: string;
	reroutedProvider?: string;
	originalModel?: string;
	reroutedModel?: string;
	ratePerHour?: number;
	projectedEmptyAt?: number;
	resetAt?: number;
	deficitPerHour?: number;
	decisionReason?: string;
	quotaPoolId?: string;
	limitWindowId?: string;
}

export type RegistryEvent =
	| { type: "registered"; ref: AgentRef }
	| { type: "status_changed"; ref: AgentRef }
	| { type: "removed"; ref: AgentRef };

type RegistryListener = (event: RegistryEvent) => void;

export interface RegisterInput {
	id: string;
	displayName: string;
	kind: AgentKind;
	parentId?: string;
	session: AgentSession | null;
	sessionFile?: string | null;
	status?: AgentStatus;
	/**
	 * Reserved-but-not-yet-live marker. A nonblocking spawn registers the child
	 * `running` + `starting: true` before its gated job body builds a real
	 * session, so history/IRC resolve genuinely-queued work instead of reporting
	 * a known id as unknown. Cleared when the child comes live (its own
	 * `register` overwrites this ref without the flag).
	 */
	starting?: boolean;
	recovery?: AgentRef["recovery"];
	quota?: AgentQuotaAdmission;
}

export class AgentRegistry {
	static #global: AgentRegistry | undefined;

	static global(): AgentRegistry {
		if (!AgentRegistry.#global) {
			AgentRegistry.#global = new AgentRegistry();
		}
		return AgentRegistry.#global;
	}

	/** Reset the global registry. Test-only. */
	static resetGlobalForTests(): void {
		AgentRegistry.#global = new AgentRegistry();
	}

	readonly #refs = new Map<string, AgentRef>();
	#nextSpawnIndex = 0;
	readonly #listeners = new Set<RegistryListener>();

	register(input: RegisterInput): AgentRef {
		const existing = this.#refs.get(input.id);
		const now = Date.now();
		const ref: AgentRef = {
			id: input.id,
			displayName: input.displayName,
			kind: input.kind,
			parentId: input.parentId,
			status: input.status ?? "running",
			session: input.session,
			sessionFile: input.sessionFile ?? null,
			recovery: input.recovery,
			starting: input.starting,
			createdAt: now,
			lastActivity: now,
			spawnIndex: existing?.spawnIndex ?? this.#nextSpawnIndex++,
			quota: input.quota ?? existing?.quota,
		};
		this.#refs.set(ref.id, ref);
		this.#emit({ type: "registered", ref });
		return ref;
	}

	setStatus(id: string, status: AgentStatus): void {
		const ref = this.#refs.get(id);
		if (!ref || ref.status === status) return;
		ref.status = status;
		// Activity describes current work; it is meaningless once the agent
		// leaves `running`, so drop it to avoid showing stale work in rosters.
		if (status !== "running") ref.activity = undefined;
		ref.lastActivity = Date.now();
		this.#emit({ type: "status_changed", ref });
	}

	/**
	 * Finalize a reserved `starting` child that never built a live session as
	 * terminal `aborted`. No-op once the child has come live (its `register`
	 * cleared the flag) or when the id was never reserved — so a normal spawn
	 * and a duplicate finalizer are both safe. The identity stays registered
	 * and inspectable via `history://`; it just no longer projects as active
	 * work to the HUD or shutdown confirmation.
	 */
	failStart(id: string): void {
		const ref = this.#refs.get(id);
		if (ref?.starting !== true) return;
		ref.starting = false;
		ref.status = "aborted";
		ref.session = null;
		ref.activity = undefined;
		ref.lastActivity = Date.now();
		this.#emit({ type: "status_changed", ref });
	}

	/**
	 * Record a short activity gist for the work-aware roster. Display-only and
	 * read on demand (`irc list`, peer roster), so it emits no event — keeping
	 * the per-tool-call update rate off the registry listener path (same as
	 * `attachSession`, which also bumps `lastActivity` without emitting). Only a
	 * `running` agent has current work: a heartbeat for any other status is
	 * dropped, so a late progress flush can't resurrect activity on a ref that
	 * `setStatus` just cleared. Every running heartbeat refreshes `lastActivity`
	 * — even when the gist text is unchanged — so the roster's "active … ago"
	 * status column tracks real work, not just the last status change.
	 * The gist is normalized to one bounded line (`oneLineLabel`) so model-derived
	 * intent text can neither break the roster nor smuggle terminal escapes —
	 * every caller is safe without sanitizing at its own call site.
	 */
	setActivity(id: string, activity: string): void {
		const ref = this.#refs.get(id);
		if (!ref) return;
		if (ref.status !== "running") return;
		const gist = oneLineLabel(activity);
		ref.lastActivity = Date.now();
		if (ref.activity === gist) return;
		ref.activity = gist;
	}

	attachSession(id: string, session: AgentSession, sessionFile?: string | null): void {
		const ref = this.#refs.get(id);
		if (!ref) return;
		ref.session = session;
		if (sessionFile !== undefined) ref.sessionFile = sessionFile;
		ref.lastActivity = Date.now();
	}

	detachSession(id: string): void {
		const ref = this.#refs.get(id);
		if (!ref) return;
		ref.session = null;
	}

	unregister(id: string): void {
		const ref = this.#refs.get(id);
		if (!ref) return;
		this.#refs.delete(id);
		this.#emit({ type: "removed", ref });
	}

	get(id: string): AgentRef | undefined {
		return this.#refs.get(id);
	}

	/** True when `id` is the ancestor itself or belongs to its registered descendant tree. */
	isInSubtree(id: string, ancestorId: string): boolean {
		return isAgentInLineage(id, ancestorId, this);
	}

	list(): AgentRef[] {
		return [...this.#refs.values()];
	}

	/**
	 * Returns every alive agent (running | idle) except the caller.
	 * Flat namespace: every agent can see every other agent.
	 */
	listVisibleTo(id: string): AgentRef[] {
		return this.list().filter(ref => ref.id !== id && (ref.status === "running" || ref.status === "idle"));
	}

	onChange(listener: RegistryListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#emit(event: RegistryEvent): void {
		for (const listener of this.#listeners) {
			try {
				listener(event);
			} catch {
				// listeners must not break the dispatch loop
			}
		}
	}
}
