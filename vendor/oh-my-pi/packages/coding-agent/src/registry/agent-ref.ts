import type { AgentSession } from "../session/agent-session";
import type { AgentKind, AgentQuotaAdmission, AgentStatus } from "./agent-registry";

/** Canonical identity shared by registry agents and their other process-local facets. */
export interface AgentRef {
	id: string;
	jobId?: string;
	sessionId?: string;
	sessionFile: string | null;
	externalPeer?: string;
	displayName: string;
	kind: AgentKind;
	parentId?: string;
	status: AgentStatus;
	/** Null when parked/aborted, and while a reserved child is still `starting`. */
	session: AgentSession | null;
	/**
	 * True only for a reserved child identity registered `running` before its
	 * gated job body builds a session. History/IRC treat it as genuinely-known
	 * queued work; it clears the moment the child comes live or fails to start.
	 */
	starting?: boolean;
	createdAt: number;
	lastActivity: number;
	readonly spawnIndex: number;
	activity?: string;
	recovery?: {
		task: string;
		model?: string;
		thinkingLevel?: string | null;
		hotswapModel?: string;
		turnState: "interrupted_by_restart";
	};
	quota?: AgentQuotaAdmission;
}

export interface AgentRefLookup {
	get(id: string): AgentRef | undefined;
}

export interface AgentJobFacet {
	id: string;
	ownerId?: string;
}

export interface ResolvedAgentRef {
	ref: AgentRef;
	/** The identity to attribute an authorized operation to. */
	attributionId?: string;
	via: "exact" | "descendant" | "job_owner";
}

/** Return the immediate dotted parent, when the id carries dotted lineage. */
export function dottedParentId(id: string): string | undefined {
	const separator = id.lastIndexOf(".");
	return separator > 0 ? id.slice(0, separator) : undefined;
}

/** Pure dotted-lineage check; registry ancestry remains authoritative for authorization. */
export function isDottedDescendant(id: string, ancestorId: string): boolean {
	return id.length > ancestorId.length && id.startsWith(`${ancestorId}.`);
}

/** Registry-backed lineage check, cycle-safe and inclusive of the ancestor. */
export function isAgentInLineage(id: string, ancestorId: string, lookup: AgentRefLookup): boolean {
	let currentId: string | undefined = id;
	const visited = new Set<string>();
	while (currentId && !visited.has(currentId)) {
		if (currentId === ancestorId) return true;
		visited.add(currentId);
		currentId = lookup.get(currentId)?.parentId;
	}
	return false;
}

/**
 * Resolve a registered target for an operation, in the single canonical order:
 * exact identity, registered descendant lineage, then async-job ownership.
 */
export function resolveAgentRef(
	targetId: string,
	requestedBy: string | undefined,
	lookup: AgentRefLookup,
	job?: AgentJobFacet,
): ResolvedAgentRef | undefined {
	const ref = lookup.get(targetId);
	if (!ref) return undefined;
	if (requestedBy === undefined || targetId === requestedBy) {
		return { ref, attributionId: requestedBy, via: "exact" };
	}
	if (isAgentInLineage(targetId, requestedBy, lookup)) {
		return { ref, attributionId: requestedBy, via: "descendant" };
	}
	if (job?.id === targetId && job.ownerId === requestedBy) {
		return { ref, attributionId: requestedBy, via: "job_owner" };
	}
	return undefined;
}

/** Apply the same resolution rules to a job, including nested-task attribution. */
export function isAgentJobOwned(job: AgentJobFacet, requestedBy: string | undefined, lookup: AgentRefLookup): boolean {
	if (requestedBy === undefined || job.ownerId === requestedBy) return true;
	const target = lookup.get(job.id);
	if (!target || !isAgentInLineage(target.id, requestedBy, lookup)) return false;
	return job.ownerId === undefined || isAgentInLineage(job.ownerId, requestedBy, lookup);
}
