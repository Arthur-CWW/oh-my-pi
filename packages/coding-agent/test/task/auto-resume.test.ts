import { describe, expect, it } from "bun:test";
import { createFleetCapability, createFleetCompatibilityProfile } from "../../src/session/fleet-capability";
import type { RolloutCheckpoint } from "../../src/session/rollout-checkpoint";
import { SessionManager } from "../../src/session/session-manager";
import {
	AUTO_RESUME_DECISION_CUSTOM_TYPE,
	performAutoResume,
	waitForRolloutRecovery,
} from "../../src/task/auto-resume";
import type { ReAdoptedChild, ReAdoptionResult } from "../../src/task/re-adopt";

const DIGEST = "a".repeat(64);
const compatibility = createFleetCompatibilityProfile({ minMajor: 1, maxMajor: 2, maxMinor: 0 }, [
	"status",
	"prepare-rollout",
	"rollout-checkpoint",
]);

function checkpoint(pauseProvenance: "manual" | "rollout", autoResumeAllowed: boolean): RolloutCheckpoint {
	return {
		type: "rollout-checkpoint",
		checkpointId: "checkpoint-1",
		rolloutId: "rollout-1",
		commandId: "00000000-0000-4000-8000-000000000001",
		ownerEpoch: "old-epoch",
		expectedDigest: "b".repeat(64),
		journalCheckpoint: { sessionId: "session-1", sessionFile: "/tmp/session.jsonl", checkpointId: "checkpoint-1" },
		children: [],
		unresumableReasons: [],
		autoResumeAllowed,
		pauseProvenance,
		outcome: "Checkpointed",
		createdAt: "2026-01-01T00:00:00.000Z",
	};
}

function child(id: string): ReAdoptedChild {
	return {
		id,
		task: "task",
		displayName: id,
		sessionFile: `/tmp/${id}.jsonl`,
		taskDepth: 1,
		parentTaskPrefix: id,
		lifecycleState: "interrupted",
		turnState: "interrupted_by_restart",
	};
}

function adoption(candidates: readonly ReAdoptedChild[], degraded = false): ReAdoptionResult {
	return {
		adopted: [...candidates],
		autoResumeCandidates: [...candidates],
		diagnostics: degraded ? [{ file: "/tmp/corrupt.jsonl", reason: "corrupt_journal", detail: "invalid" }] : [],
		outcome: degraded ? "ReAdoptionDegraded" : "ReAdopted",
	};
}

describe("rollout replacement recovery", () => {
	it("treats applied-without-replacement-heartbeat as RecoveryTimedOut", async () => {
		let clock = 0;
		const result = await waitForRolloutRecovery({
			sessionId: "session-1",
			sessionFile: "/tmp/session.jsonl",
			previousOwnerEpoch: "old-epoch",
			previousHeartbeat: "2026-01-01T00:00:00.000Z",
			targetDigest: DIGEST,
			targetVersion: "1.2.3",
			compatibility,
			timeoutMs: 10,
			pollIntervalMs: 5,
			listPeers: () => [],
			now: () => clock,
			sleep: async ms => {
				clock += ms;
			},
		});
		expect(result.phase).toBe("RecoveryTimedOut");
	});

	it("requires changed epoch, exact digest/version, session file, compatibility, and newer heartbeat", async () => {
		const peer = {
			sessionId: "session-1",
			name: "runner",
			cwd: "/tmp",
			pid: 42,
			lastSeen: "2026-01-01T00:00:01.000Z",
			state: "idle" as const,
			stateTs: null,
			sessionFile: "/tmp/session.jsonl",
			ownerEpoch: "new-epoch",
			buildDigest: DIGEST,
			version: "1.2.3",
			fleetCapability: createFleetCapability({
				buildDigest: DIGEST,
				productVersion: "1.2.3",
				controlProtocol: { minMajor: 1, maxMajor: 2, maxMinor: 0 },
				rolloutFeatures: ["status", "prepare-rollout", "rollout-checkpoint"],
			}),
		};
		const result = await waitForRolloutRecovery({
			sessionId: peer.sessionId,
			sessionFile: peer.sessionFile,
			previousOwnerEpoch: "old-epoch",
			previousHeartbeat: "2026-01-01T00:00:00.000Z",
			targetDigest: DIGEST,
			targetVersion: "1.2.3",
			compatibility,
			timeoutMs: 1,
			listPeers: () => [peer],
		});
		expect(result.phase).toBe("Reacquired");
	});
});

describe("rollout auto-resume policy", () => {
	it("keeps a manually paused session paused and resumes no children", async () => {
		const journal = SessionManager.inMemory();
		const resumed: string[] = [];
		let pausedMutation: boolean | undefined;
		let cordonReleased = false;
		const decision = await performAutoResume({
			checkpoint: checkpoint("manual", false),
			reAdoption: adoption([child("Running")]),
			newOwnerHealthy: true,
			statusHealthy: true,
			ownershipIsCurrent: () => true,
			isResumeSafe: () => true,
			resume: async candidate => {
				resumed.push(candidate.id);
			},
			decisionJournal: journal,
			setPaused: paused => {
				pausedMutation = paused;
			},
			releaseCordon: () => {
				cordonReleased = true;
			},
		});
		expect(decision.phase).toBe("ReAdopted");
		expect(resumed).toEqual([]);
		expect(pausedMutation).toBeUndefined();
		expect(cordonReleased).toBe(false);
	});

	it("resumes exactly the healthy manifest-authorized set after committing diagnostics", async () => {
		const journal = SessionManager.inMemory();
		const authorized = child("Authorized");
		const ordinary = child("Ordinary");
		const result = adoption([authorized], true);
		result.adopted.push(ordinary);
		const sequence: string[] = [];
		const decision = await performAutoResume({
			checkpoint: checkpoint("rollout", true),
			reAdoption: result,
			newOwnerHealthy: true,
			statusHealthy: true,
			ownershipIsCurrent: () => true,
			isResumeSafe: candidate => candidate.id !== "Corrupt",
			resume: async candidate => {
				sequence.push(`resume:${candidate.id}`);
			},
			decisionJournal: journal,
			setPaused: paused => {
				sequence.push(`paused:${paused}`);
			},
			releaseCordon: () => {
				const committed = journal.getEntries().some(
					entry => entry.type === "custom" && entry.customType === AUTO_RESUME_DECISION_CUSTOM_TYPE,
				);
				expect(committed).toBe(true);
				sequence.push("cordon:released");
			},
		});
		expect(decision.phase).toBe("ReAdoptionDegraded");
		expect(decision.resumedAgentIds).toEqual(["Authorized"]);
		expect(sequence).toEqual(["resume:Authorized", "cordon:released", "paused:false"]);
	});
});
