import type { FleetHealthFailure, FleetHealthResult } from "./fleet-health";
import type { FleetRolloutPlan, FleetRolloutTarget } from "./fleet-rollout-plan";
import type { SessionControlReceipt } from "./session-control";

export type FleetRollbackTrigger =
	| { readonly kind: "RestartFailed"; readonly reason: string; readonly automatic: true }
	| { readonly kind: "RecoveryTimedOut"; readonly reason: string; readonly automatic: true }
	| { readonly kind: "ReplacementMismatch"; readonly reason: string; readonly automatic: true }
	| { readonly kind: "ReAdoptionFailed"; readonly reason: string; readonly automatic: true }
	| { readonly kind: "CheckpointFailed"; readonly reason: string; readonly automatic: true }
	| { readonly kind: "StatusHealthFailed"; readonly reason: string; readonly automatic: true }
	| { readonly kind: "CorrelatedErrorThreshold"; readonly reason: string; readonly automatic: true }
	| { readonly kind: "CrashLoop"; readonly reason: string; readonly automatic: true }
	| { readonly kind: "FleetIncident"; readonly reason: string; readonly automatic: false };

export interface FleetRollbackSelection {
	readonly digest: string;
	readonly source: "previous-release" | "prior-pin";
}

export interface FleetRollbackTarget {
	readonly target: FleetRolloutTarget;
	readonly selection: FleetRollbackSelection;
	readonly rolloutOrder: number;
}

export interface FleetRollbackPlan {
	readonly fleetRolloutId: string;
	readonly trigger: FleetRollbackTrigger;
	readonly targets: readonly FleetRollbackTarget[];
}

export interface FleetRollbackTerminalReceipt {
	readonly sessionId: string;
	readonly targetId: string;
	readonly targetDigest: string;
	readonly state: "RolledBack" | "RollbackIncomplete";
	readonly reason?: string;
}

export interface ExecuteFleetRollbackOptions {
	readonly plan: FleetRollbackPlan;
	/** Waits for the target runner's own durable safe boundary. It must never terminate provider work. */
	readonly waitForSafeBoundary: (
		target: FleetRollbackTarget,
	) => Promise<{ readonly safe: true } | { readonly safe: false; readonly reason: string }>;
	/** Executes cordon → drain → checkpoint → restart → recovery → health for the selected digest. */
	readonly executeTargetLifecycle: (target: FleetRollbackTarget) => Promise<FleetHealthResult>;
	readonly recordTerminal?: (receipt: FleetRollbackTerminalReceipt) => void;
}

function triggerForHealthFailure(item: FleetHealthFailure): FleetRollbackTrigger {
	const reason = item.reason;
	switch (item.code) {
		case "HeartbeatTimeout":
			return { kind: "RecoveryTimedOut", reason, automatic: true };
		case "HeartbeatMismatch":
		case "OwnerEpochNotAdvanced":
		case "DualOwner":
		case "CompatibilityMismatch":
			return { kind: "ReplacementMismatch", reason, automatic: true };
		case "CheckpointFailed":
			return { kind: "CheckpointFailed", reason, automatic: true };
		case "ReAdoptionFailed":
			return { kind: "ReAdoptionFailed", reason, automatic: true };
		case "CorrelatedErrorThreshold":
			return { kind: "CorrelatedErrorThreshold", reason, automatic: true };
		case "FleetIncident":
			return { kind: "FleetIncident", reason, automatic: false };
		case "StatusReceiptMissing":
		case "StatusReceiptFailed":
		case "StatusReceiptStale":
			return { kind: "StatusHealthFailed", reason, automatic: true };
	}
}

/** Maps restart/recovery/health evidence to the conservative rollback decision. */
export function evaluateFleetRollbackTrigger(input: {
	readonly restartReceipt?: SessionControlReceipt;
	readonly health?: FleetHealthResult;
	readonly crashLoopStopped?: boolean;
}): FleetRollbackTrigger | undefined {
	if (input.restartReceipt?.state === "failed")
		return {
			kind: "RestartFailed",
			reason: input.restartReceipt.error ?? "restart command failed",
			automatic: true,
		};
	if (input.crashLoopStopped)
		return { kind: "CrashLoop", reason: "two consecutive post-applied replacement failures", automatic: true };
	if (input.health?.state !== "HealthFailed") return undefined;
	const buildAttributed = input.health.failures.find(item => item.attributedToBuild);
	const firstFailure = buildAttributed ?? input.health.failures[0];
	return firstFailure ? triggerForHealthFailure(firstFailure) : undefined;
}

/**
 * Select every affected completed target in reverse rollout order. The explicit prior pin wins per target;
 * otherwise the release inventory's retained N−1 digest is used.
 */
export function createFleetRollbackPlan(input: {
	readonly rollout: FleetRolloutPlan;
	readonly trigger: FleetRollbackTrigger;
	readonly affectedSessionIds: ReadonlySet<string>;
	readonly priorPins?: ReadonlyMap<string, string>;
}): FleetRollbackPlan {
	const targets = input.rollout.orderedTargets
		.map((target, rolloutOrder): FleetRollbackTarget | undefined => {
			if (!input.affectedSessionIds.has(target.sessionId)) return undefined;
			const priorPin = input.priorPins?.get(target.sessionId);
			return {
				target,
				rolloutOrder,
				selection: priorPin
					? { digest: priorPin, source: "prior-pin" }
					: { digest: input.rollout.previousDigest, source: "previous-release" },
			};
		})
		.filter((target): target is FleetRollbackTarget => target !== undefined)
		.reverse();
	return { fleetRolloutId: input.rollout.fleetRolloutId, trigger: input.trigger, targets };
}

/** Serial bounded rollback. Every selected target receives exactly one terminal receipt, even after mixed failures. */
export async function executeFleetRollback(options: ExecuteFleetRollbackOptions): Promise<{
	readonly state: "RolledBack" | "Failed";
	readonly receipts: readonly FleetRollbackTerminalReceipt[];
}> {
	const receipts: FleetRollbackTerminalReceipt[] = [];
	for (const rollbackTarget of options.plan.targets) {
		let receipt: FleetRollbackTerminalReceipt;
		try {
			const boundary = await options.waitForSafeBoundary(rollbackTarget);
			if (!boundary.safe) {
				receipt = {
					sessionId: rollbackTarget.target.sessionId,
					targetId: rollbackTarget.target.targetId,
					targetDigest: rollbackTarget.selection.digest,
					state: "RollbackIncomplete",
					reason: boundary.reason,
				};
			} else {
				const health = await options.executeTargetLifecycle(rollbackTarget);
				receipt =
					health.state === "Healthy"
						? {
								sessionId: rollbackTarget.target.sessionId,
								targetId: rollbackTarget.target.targetId,
								targetDigest: rollbackTarget.selection.digest,
								state: "RolledBack",
							}
						: {
								sessionId: rollbackTarget.target.sessionId,
								targetId: rollbackTarget.target.targetId,
								targetDigest: rollbackTarget.selection.digest,
								state: "RollbackIncomplete",
								reason: health.failures.map(item => item.reason).join("; "),
							};
			}
		} catch (error) {
			receipt = {
				sessionId: rollbackTarget.target.sessionId,
				targetId: rollbackTarget.target.targetId,
				targetDigest: rollbackTarget.selection.digest,
				state: "RollbackIncomplete",
				reason: error instanceof Error ? error.message : String(error),
			};
		}
		receipts.push(receipt);
		options.recordTerminal?.(receipt);
	}
	return {
		state: receipts.every(receipt => receipt.state === "RolledBack") ? "RolledBack" : "Failed",
		receipts,
	};
}
