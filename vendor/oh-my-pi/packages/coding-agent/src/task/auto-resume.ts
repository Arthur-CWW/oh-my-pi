import * as path from "node:path";
import type { IrcExternalPeer } from "../irc/bus-external";
import {
	classifyFleetCompatibility,
	type FleetCompatibilityProfile,
} from "../session/fleet-capability";
import type { FleetTargetState } from "../session/fleet-rollout-plan";
import type { RolloutCheckpoint } from "../session/rollout-checkpoint";
import type { SessionManager } from "../session/session-manager";
import type { ReAdoptedChild, ReAdoptionResult } from "./re-adopt";

export const AUTO_RESUME_DECISION_CUSTOM_TYPE = "rollout-auto-resume" as const;

type RecoveryPhase = Extract<FleetTargetState, "Reacquired" | "RecoveryTimedOut">;
export type RecoveryResult =
	| { readonly phase: Extract<RecoveryPhase, "Reacquired">; readonly peer: IrcExternalPeer }
	| { readonly phase: Extract<RecoveryPhase, "RecoveryTimedOut">; readonly reason: string };

export interface WaitForRolloutRecoveryOptions {
	readonly sessionId: string;
	readonly sessionFile: string;
	readonly previousOwnerEpoch: string;
	readonly previousHeartbeat: string;
	readonly targetDigest: string;
	readonly targetVersion: string;
	readonly compatibility: FleetCompatibilityProfile;
	readonly timeoutMs: number;
	readonly pollIntervalMs?: number;
	readonly listPeers: () => readonly IrcExternalPeer[];
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
}

/** An applied receipt is intentionally not an input: only replacement-heartbeat evidence can reacquire a target. */
export async function waitForRolloutRecovery(options: WaitForRolloutRecoveryOptions): Promise<RecoveryResult> {
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? Bun.sleep;
	const deadline = now() + Math.max(0, options.timeoutMs);
	for (;;) {
		const peer = options.listPeers().find(candidate => candidate.sessionId === options.sessionId);
		if (
			peer?.sessionFile &&
			path.resolve(peer.sessionFile) === path.resolve(options.sessionFile) &&
			Date.parse(peer.lastSeen) > Date.parse(options.previousHeartbeat) &&
			peer.ownerEpoch !== undefined &&
			peer.ownerEpoch !== options.previousOwnerEpoch &&
			peer.buildDigest === options.targetDigest &&
			peer.version === options.targetVersion &&
			classifyFleetCompatibility(peer, options.compatibility).kind === "compatible"
		) {
			return { phase: "Reacquired", peer };
		}
		const remaining = deadline - now();
		if (remaining <= 0) {
			return {
				phase: "RecoveryTimedOut",
				reason: `No compatible replacement heartbeat for ${options.sessionId} at ${options.targetDigest}`,
			};
		}
		await sleep(Math.min(options.pollIntervalMs ?? 25, remaining));
	}
}

export type AutoResumePhase = Extract<
	FleetTargetState,
	"AutoResumed" | "ReAdoptionDegraded" | "HealthFailed" | "ReAdopted"
>;

export interface AutoResumeDecision {
	readonly decisionId: string;
	readonly rolloutId: string;
	readonly checkpointId: string;
	readonly phase: AutoResumePhase;
	readonly resumedAgentIds: readonly string[];
	readonly excludedAgentIds: readonly string[];
	readonly pauseProvenance: "manual" | "rollout";
	readonly committedAt: string;
}

export interface AutoResumeOptions {
	readonly checkpoint: RolloutCheckpoint;
	readonly reAdoption: ReAdoptionResult;
	readonly newOwnerHealthy: boolean;
	readonly statusHealthy: boolean;
	readonly ownershipIsCurrent: () => boolean | Promise<boolean>;
	readonly isResumeSafe: (child: ReAdoptedChild) => boolean | Promise<boolean>;
	readonly resume: (child: ReAdoptedChild) => Promise<void>;
	readonly decisionJournal: Pick<SessionManager, "appendCustomEntry" | "flush">;
	readonly setPaused: (paused: boolean) => void | Promise<void>;
	readonly releaseCordon: () => void | Promise<void>;
	readonly now?: () => Date;
}

/** Commit a journal-authoritative decision before releasing the rollout cordon. */
export async function performAutoResume(options: AutoResumeOptions): Promise<AutoResumeDecision> {
	const resumedAgentIds: string[] = [];
	const excludedAgentIds: string[] = [];
	let phase: AutoResumePhase;
	if (!options.newOwnerHealthy || !options.statusHealthy || !(await options.ownershipIsCurrent())) {
		phase = "HealthFailed";
	} else if (!options.checkpoint.autoResumeAllowed || options.checkpoint.pauseProvenance === "manual") {
		phase = options.reAdoption.outcome;
		excludedAgentIds.push(...options.reAdoption.autoResumeCandidates.map(child => child.id));
	} else {
		for (const child of options.reAdoption.autoResumeCandidates) {
			if (!(await options.ownershipIsCurrent()) || !(await options.isResumeSafe(child))) {
				excludedAgentIds.push(child.id);
				continue;
			}
			await options.resume(child);
			resumedAgentIds.push(child.id);
		}
		phase = options.reAdoption.outcome === "ReAdoptionDegraded" ? "ReAdoptionDegraded" : "AutoResumed";
	}
	const decision: AutoResumeDecision = {
		decisionId: crypto.randomUUID(),
		rolloutId: options.checkpoint.rolloutId,
		checkpointId: options.checkpoint.checkpointId,
		phase,
		resumedAgentIds,
		excludedAgentIds,
		pauseProvenance: options.checkpoint.pauseProvenance,
		committedAt: (options.now ?? (() => new Date()))().toISOString(),
	};
	options.decisionJournal.appendCustomEntry(AUTO_RESUME_DECISION_CUSTOM_TYPE, decision);
	await options.decisionJournal.flush();
	if (phase !== "HealthFailed" && options.checkpoint.pauseProvenance === "rollout") {
		await options.releaseCordon();
		await options.setPaused(false);
	}
	return decision;
}
