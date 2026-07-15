import { AgentRegistry, MAIN_AGENT_ID } from "../registry/agent-registry";
import type { AgentSession } from "./agent-session";
import { captureRestartChildManifest } from "./restart-child-manifest";
import type { SessionManager } from "./session-manager";

export const ROLLOUT_CHECKPOINT_CUSTOM_TYPE = "rollout-checkpoint" as const;

export type RolloutPauseProvenance = "manual" | "rollout";
export type RolloutCheckpointOutcome = "Checkpointed" | "DrainTimedOut" | "BusyDeferred";

export interface RolloutChildSummary {
	readonly agentId: string;
	readonly state: "running" | "parked" | "terminal" | "unresumable";
	readonly resumable: boolean;
	readonly journalPath?: string;
	readonly reason?: string;
}

export interface RolloutJournalCheckpointPointer {
	readonly sessionId: string;
	readonly sessionFile: string;
	readonly checkpointId: string;
}

export interface RolloutCheckpoint {
	readonly type: typeof ROLLOUT_CHECKPOINT_CUSTOM_TYPE;
	readonly checkpointId: string;
	readonly rolloutId: string;
	readonly commandId: string;
	readonly ownerEpoch: string;
	readonly expectedDigest: string;
	readonly journalCheckpoint: RolloutJournalCheckpointPointer;
	readonly children: readonly RolloutChildSummary[];
	readonly unresumableReasons: readonly string[];
	readonly autoResumeAllowed: boolean;
	readonly pauseProvenance: RolloutPauseProvenance;
	readonly outcome: RolloutCheckpointOutcome;
	readonly createdAt: string;
}

export interface RolloutDrainSnapshot {
	readonly safe: boolean;
	readonly busyReason?: string;
	readonly children: readonly RolloutChildSummary[];
}

/** Observe only; running work is never signalled or cancelled by drain inspection. */
export function inspectRolloutDrain(session: AgentSession, pendingOperations: number): RolloutDrainSnapshot {
	const supervisedJobIds = new Set(
		session.asyncJobManager
			?.getRunningJobs({ ownerId: MAIN_AGENT_ID })
			.filter(job => job.type === "task" && !job.isolated)
			.map(job => job.id) ?? [],
	);
	const children: RolloutChildSummary[] = AgentRegistry.global()
		.list()
		.filter(
			ref =>
				(ref.parentId === MAIN_AGENT_ID || supervisedJobIds.has(ref.id)) &&
				(ref.status === "running" || ref.status === "parked"),
		)
		.map(ref => ({
			agentId: ref.id,
			state: ref.status as "running" | "parked",
			resumable: ref.status === "parked" && typeof ref.sessionFile === "string",
			...(typeof ref.sessionFile === "string" ? { journalPath: ref.sessionFile } : {}),
			...(ref.status === "running"
				? { reason: "child has not reached a durable parked boundary" }
				: typeof ref.sessionFile !== "string"
					? { reason: "child has no durable journal" }
					: {}),
		}));
	const parentBusy = session.isStreaming || pendingOperations > 0;
	const childBusy = children.some(child => child.state === "running");
	return {
		safe: !parentBusy && !childBusy,
		...(parentBusy
			? { busyReason: "parent provider or tool work has not reached a durable turn boundary" }
			: childBusy
				? { busyReason: "child work has not reached a durable parked boundary" }
				: {}),
		children,
	};
}

export interface AssembleRolloutCheckpointOptions {
	readonly sessionManager: SessionManager;
	readonly session: AgentSession;
	readonly commandId: string;
	readonly rolloutId: string;
	readonly ownerEpoch: string;
	readonly expectedDigest: string;
	readonly pauseProvenance: RolloutPauseProvenance;
	readonly drainTimeoutMs: number;
	readonly drainPollIntervalMs?: number;
	readonly inspectDrain: () => RolloutDrainSnapshot | Promise<RolloutDrainSnapshot>;
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
}

function collectUnresumableReasons(children: readonly RolloutChildSummary[], busyReason?: string): string[] {
	const reasons = children.flatMap(child => (child.resumable || !child.reason ? [] : [child.reason]));
	if (busyReason) reasons.push(busyReason);
	return [...new Set(reasons)];
}

/**
 * Wait only for observed durable boundaries. This function never aborts a turn,
 * provider request, tool call, or child. Restart-manifest capture runs only after
 * the drain probe declares the parent and children safe.
 */
export async function assembleRolloutCheckpoint(
	options: AssembleRolloutCheckpointOptions,
): Promise<RolloutCheckpoint> {
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? Bun.sleep;
	const pollIntervalMs = options.drainPollIntervalMs ?? 25;
	const deadline = now() + Math.max(0, options.drainTimeoutMs);
	let snapshot = await options.inspectDrain();
	while (!snapshot.safe && now() < deadline) {
		await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - now())));
		snapshot = await options.inspectDrain();
	}

	let outcome: RolloutCheckpointOutcome = "Checkpointed";
	let children = [...snapshot.children];
	if (!snapshot.safe) {
		outcome = snapshot.busyReason ? "BusyDeferred" : "DrainTimedOut";
	} else {
		const manifest = await captureRestartChildManifest(options.session, options.ownerEpoch);
		const resumable = new Map(manifest.map(child => [child.agentId, child]));
		children = children.map(child => {
			const entry = resumable.get(child.agentId);
			if (!entry) return child;
			return { ...child, state: entry.state, resumable: true, journalPath: entry.journalPath };
		});
		for (const entry of manifest) {
			if (children.some(child => child.agentId === entry.agentId)) continue;
			children.push({
				agentId: entry.agentId,
				state: entry.state,
				resumable: true,
				journalPath: entry.journalPath,
			});
		}
	}

	const checkpointId = crypto.randomUUID();
	const unresumableReasons = collectUnresumableReasons(children, snapshot.safe ? undefined : snapshot.busyReason);
	const sessionFile = options.sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("Rollout checkpoint requires a durable session journal");
	const checkpoint: RolloutCheckpoint = {
		type: ROLLOUT_CHECKPOINT_CUSTOM_TYPE,
		checkpointId,
		rolloutId: options.rolloutId,
		commandId: options.commandId,
		ownerEpoch: options.ownerEpoch,
		expectedDigest: options.expectedDigest,
		journalCheckpoint: {
			sessionId: options.sessionManager.getSessionId(),
			sessionFile,
			checkpointId,
		},
		children,
		unresumableReasons,
		autoResumeAllowed:
			outcome === "Checkpointed" &&
			options.pauseProvenance === "rollout" &&
			children.every(child => child.resumable || child.state === "terminal"),
		pauseProvenance: options.pauseProvenance,
		outcome,
		createdAt: new Date(now()).toISOString(),
	};
	options.sessionManager.appendCustomEntry(ROLLOUT_CHECKPOINT_CUSTOM_TYPE, checkpoint);
	await options.sessionManager.ensureOnDisk();
	await options.sessionManager.flush();
	return checkpoint;
}

export function decodeRolloutCheckpoint(input: unknown): RolloutCheckpoint {
	if (!input || typeof input !== "object") throw new Error("Invalid rollout checkpoint");
	const value = input as Partial<RolloutCheckpoint>;
	if (
		value.type !== ROLLOUT_CHECKPOINT_CUSTOM_TYPE ||
		typeof value.checkpointId !== "string" ||
		typeof value.rolloutId !== "string" ||
		typeof value.commandId !== "string" ||
		typeof value.ownerEpoch !== "string" ||
		typeof value.expectedDigest !== "string" ||
		!Array.isArray(value.children) ||
		!Array.isArray(value.unresumableReasons) ||
		typeof value.autoResumeAllowed !== "boolean" ||
		(value.pauseProvenance !== "manual" && value.pauseProvenance !== "rollout") ||
		!(["Checkpointed", "DrainTimedOut", "BusyDeferred"] as const).includes(value.outcome as RolloutCheckpointOutcome) ||
		typeof value.createdAt !== "string" ||
		!value.journalCheckpoint
	) {
		throw new Error("Invalid rollout checkpoint");
	}
	return value as RolloutCheckpoint;
}
