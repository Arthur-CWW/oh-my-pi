import { describe, expect, it } from "bun:test";
import type { IrcExternalPeer } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import type { DiagnosticEvent } from "@oh-my-pi/pi-coding-agent/session/error-inbox-ledger";
import {
	createFleetCapability,
	createFleetCompatibilityProfile,
} from "@oh-my-pi/pi-coding-agent/session/fleet-capability";
import {
	countBuildCorrelatedErrors,
	evaluateFleetCrashLoop,
	evaluateFleetTargetHealth,
	FleetHealthGateError,
	type FleetHealthObservation,
	type FleetHealthResult,
	requireHealthyFleetTarget,
} from "@oh-my-pi/pi-coding-agent/session/fleet-health";
import {
	createFleetRollbackPlan,
	evaluateFleetRollbackTrigger,
	executeFleetRollback,
} from "@oh-my-pi/pi-coding-agent/session/fleet-rollback";
import type { FleetRolloutPlan, FleetRolloutTarget } from "@oh-my-pi/pi-coding-agent/session/fleet-rollout-plan";
import {
	CURRENT_SESSION_CONTROL_PROTOCOL,
	type SessionControlReceipt,
} from "@oh-my-pi/pi-coding-agent/session/session-control";
import type { FleetIncident } from "@oh-my-pi/pi-coding-agent/task/fleet-incident";

const DIGEST = "a".repeat(64);
const PREVIOUS = "b".repeat(64);
const VERSION = "16.0.1";
const BASELINE = Date.parse("2026-07-15T00:00:00.000Z");
const OBSERVED = BASELINE + 10_000;
const compatibility = createFleetCompatibilityProfile(CURRENT_SESSION_CONTROL_PROTOCOL, [
	"status",
	"prepare-rollout",
	"rollout-checkpoint",
]);
const capability = createFleetCapability({
	buildDigest: DIGEST,
	productVersion: VERSION,
	controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
});

function heartbeat(sessionId = "session-1", ownerEpoch = "epoch-new", seenAt = OBSERVED - 1_000): IrcExternalPeer {
	return {
		sessionId,
		name: sessionId,
		cwd: "/tmp",
		pid: 42,
		lastSeen: new Date(seenAt).toISOString(),
		state: "idle",
		stateTs: null,
		ownerEpoch,
		buildDigest: DIGEST,
		version: VERSION,
		fleetCapability: capability,
	};
}

function statusReceipt(ownerEpoch = "epoch-new"): SessionControlReceipt {
	return {
		schemaVersion: 1,
		commandId: "00000000-0000-4000-8000-000000000001",
		sessionId: "session-1",
		targetOwnerEpoch: ownerEpoch,
		state: "applied",
		requestedAt: new Date(BASELINE + 2_000).toISOString(),
		acknowledgedAt: new Date(BASELINE + 2_100).toISOString(),
		completedAt: new Date(BASELINE + 2_200).toISOString(),
		result: { kind: "status", sessionId: "session-1", ownerEpoch, paused: false },
	};
}

function observation(overrides: Partial<FleetHealthObservation> = {}): FleetHealthObservation {
	return {
		sessionId: "session-1",
		previousOwnerEpoch: "epoch-old",
		targetDigest: DIGEST,
		targetVersion: VERSION,
		fleetRolloutId: "rollout-1",
		observedAt: OBSERVED,
		heartbeatFreshAfter: BASELINE + 1_000,
		statusRequestedAt: BASELINE + 2_000,
		replacementHeartbeats: [heartbeat()],
		statusReceipt: statusReceipt(),
		errors: [],
		errorBaseline: { capturedAt: BASELINE, countsById: new Map() },
		errorPolicy: { correlatedEventThreshold: 1 },
		incidents: [],
		compatibility,
		...overrides,
	};
}

function error(overrides: Partial<DiagnosticEvent> = {}): DiagnosticEvent {
	return {
		id: "error-1",
		firstTimestamp: BASELINE + 3_000,
		lastTimestamp: BASELINE + 3_000,
		message: "replacement failed",
		count: 1,
		buildDigest: DIGEST,
		fleetRolloutId: "rollout-1",
		session: "session-1",
		unread: true,
		resolved: false,
		...overrides,
	};
}

function healthy(): FleetHealthResult {
	return { state: "Healthy", replacement: heartbeat(), correlatedErrorCount: 0 };
}

describe("fleet target health", () => {
	it("fails when the replacement heartbeat times out", () => {
		const result = evaluateFleetTargetHealth(observation({ replacementHeartbeats: [] }));
		expect(result.state).toBe("HealthFailed");
		if (result.state === "HealthFailed") expect(result.failures.map(item => item.code)).toContain("HeartbeatTimeout");
	});

	it("throws the planner freeze seam for any failed health gate", () => {
		expect(() => requireHealthyFleetTarget(observation({ replacementHeartbeats: [] }))).toThrow(FleetHealthGateError);
	});

	it("fails required re-adoption evidence", () => {
		const result = evaluateFleetTargetHealth(observation({ reAdoptionFailure: "child lineage mismatch" }));
		expect(result.state).toBe("HealthFailed");
		if (result.state === "HealthFailed")
			expect(result.failures).toContainEqual({
				code: "ReAdoptionFailed",
				reason: "child lineage mismatch",
				attributedToBuild: true,
			});
	});

	it("counts only new build/session/rollout-correlated non-cancelled errors", () => {
		const errors = [
			error({ id: "existing", count: 3 }),
			error({ id: "wrong-build", buildDigest: PREVIOUS }),
			error({ id: "cancelled", cause: "user-interrupt" }),
			error({ id: "wrong-rollout", fleetRolloutId: "rollout-old" }),
		];
		const input = observation({
			errors,
			errorBaseline: { capturedAt: BASELINE, countsById: new Map([["existing", 2]]) },
		});
		expect(countBuildCorrelatedErrors(input)).toBe(1);
		const result = evaluateFleetTargetHealth(input);
		expect(result.state).toBe("HealthFailed");
		if (result.state === "HealthFailed") {
			expect(result.correlatedErrorCount).toBe(1);
			expect(result.failures.map(item => item.code)).toContain("CorrelatedErrorThreshold");
		}
	});

	it("does not attribute a network outage to the replacement build", () => {
		const incident: FleetIncident = {
			id: "incident-1",
			failureClass: "network",
			status: "open",
			openedAt: BASELINE + 2_000,
			evidence: [],
		};
		const result = evaluateFleetTargetHealth(
			observation({ errors: [error({ cause: "network" })], incidents: [incident] }),
		);
		expect(result.state).toBe("HealthFailed");
		if (result.state === "HealthFailed") {
			expect(result.correlatedErrorCount).toBe(0);
			expect(result.failures).toContainEqual({
				code: "FleetIncident",
				reason: "fleet incident incident-1 overlaps observation",
				attributedToBuild: false,
			});
		}
		expect(evaluateFleetRollbackTrigger({ health: result })?.automatic).toBe(false);
	});

	it("rejects dual fresh owners instead of choosing one", () => {
		const result = evaluateFleetTargetHealth(
			observation({ replacementHeartbeats: [heartbeat(), heartbeat("session-1", "epoch-other")] }),
		);
		expect(result.state).toBe("HealthFailed");
		if (result.state === "HealthFailed") expect(result.failures.map(item => item.code)).toContain("DualOwner");
	});
});

describe("fleet rollback triggers", () => {
	it("turns a failed restart receipt into an immediate rollback trigger", () => {
		const receipt: SessionControlReceipt = {
			...statusReceipt(),
			state: "failed",
			result: undefined,
			error: "exec failed",
		};
		expect(evaluateFleetRollbackTrigger({ restartReceipt: receipt })).toEqual({
			kind: "RestartFailed",
			reason: "exec failed",
			automatic: true,
		});
	});

	it("stops the crash loop after two distinct post-applied replacement failures", () => {
		const one = evaluateFleetCrashLoop(
			[
				{
					sessionId: "session-1",
					targetDigest: DIGEST,
					ownerEpoch: "epoch-1",
					occurredAt: OBSERVED - 2_000,
					phase: "post-applied-loss",
				},
			],
			{ sessionId: "session-1", targetDigest: DIGEST, now: OBSERVED, windowMs: 5_000 },
		);
		expect(one).toEqual({ stop: false, consecutiveFailures: 1 });
		const two = evaluateFleetCrashLoop(
			[
				{
					sessionId: "session-1",
					targetDigest: DIGEST,
					ownerEpoch: "epoch-1",
					occurredAt: OBSERVED - 2_000,
					phase: "post-applied-loss",
				},
				{
					sessionId: "session-1",
					targetDigest: DIGEST,
					ownerEpoch: "epoch-2",
					occurredAt: OBSERVED - 1_000,
					phase: "post-applied-failure",
				},
			],
			{ sessionId: "session-1", targetDigest: DIGEST, now: OBSERVED, windowMs: 5_000 },
		);
		expect(two).toEqual({ stop: true, consecutiveFailures: 2 });
		expect(evaluateFleetRollbackTrigger({ crashLoopStopped: two.stop })?.kind).toBe("CrashLoop");
	});
});

function rolloutTarget(sessionId: string, order: number): FleetRolloutTarget {
	return {
		targetId: `target-${order}`,
		sessionId,
		peer: heartbeat(sessionId, `old-${order}`),
		expectedOwnerEpoch: `old-${order}`,
		commandId: `command-${order}`,
		waveId: order === 0 ? "canary" : "rolling",
		state: "Classified",
	};
}

function rolloutPlan(): FleetRolloutPlan {
	const orderedTargets = [rolloutTarget("alpha", 0), rolloutTarget("beta", 1), rolloutTarget("gamma", 2)];
	return {
		fleetRolloutId: "rollout-1",
		target: { digest: DIGEST, source: { kind: "explicit" } },
		previousDigest: PREVIOUS,
		waves: [
			{ waveId: "canary", kind: "canary", targets: [orderedTargets[0] as FleetRolloutTarget] },
			{ waveId: "rolling", kind: "rolling", targets: orderedTargets.slice(1) },
		],
		excluded: [],
		orderedTargets,
		maxUnavailable: 1,
	};
}

describe("bounded rollback execution", () => {
	it("uses reverse rollout order and reports mixed rollback-incomplete terminals", async () => {
		const visited: string[] = [];
		const plan = createFleetRollbackPlan({
			rollout: rolloutPlan(),
			trigger: { kind: "RestartFailed", reason: "failed", automatic: true },
			affectedSessionIds: new Set(["alpha", "beta", "gamma"]),
			priorPins: new Map([["gamma", "c".repeat(64)]]),
		});
		expect(plan.targets.map(item => item.target.sessionId)).toEqual(["gamma", "beta", "alpha"]);
		expect(plan.targets[0]?.selection.source).toBe("prior-pin");
		const result = await executeFleetRollback({
			plan,
			waitForSafeBoundary: async target => {
				visited.push(target.target.sessionId);
				return target.target.sessionId === "beta"
					? { safe: false, reason: "provider call still running" }
					: { safe: true };
			},
			executeTargetLifecycle: async () => healthy(),
		});
		expect(visited).toEqual(["gamma", "beta", "alpha"]);
		expect(result.state).toBe("Failed");
		expect(result.receipts).toHaveLength(3);
		expect(result.receipts.map(receipt => receipt.state)).toEqual(["RolledBack", "RollbackIncomplete", "RolledBack"]);
		expect(result.receipts[1]?.reason).toBe("provider call still running");
	});
});
