import { afterEach, describe, expect, it } from "bun:test";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { IrcExternalPeer } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import {
	createFleetCapability,
	createFleetCompatibilityProfile,
} from "@oh-my-pi/pi-coding-agent/session/fleet-capability";
import {
	createFleetRolloutPlan,
	executeFleetRolloutPlan,
	type FleetControllerJournal,
	FleetControllerLease,
	fleetRolloutRecords,
	preflightFleetTarget,
	resolveFleetTarget,
	startFleetRollout,
} from "@oh-my-pi/pi-coding-agent/session/fleet-rollout-plan";
import { RolloutJournal } from "@oh-my-pi/pi-coding-agent/session/rollout-journal";
import { CURRENT_SESSION_CONTROL_PROTOCOL } from "@oh-my-pi/pi-coding-agent/session/session-control";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type { SessionOwnershipHandle } from "@oh-my-pi/pi-coding-agent/session/session-ownership";

const TARGET = "a".repeat(64);
const PREVIOUS = "b".repeat(64);
const OTHER = "c".repeat(64);
const NOW = "2026-07-15T00:00:00.000Z";
const cleanupRoots: string[] = [];
const fixtureFiles = new Set<string>();

function materializedSessionFile(sessionId: string): string {
	const file = path.join(os.tmpdir(), `omp-fleet-plan-${process.pid}-${sessionId}.jsonl`);
	fsSync.writeFileSync(file, '{"type":"session","version":1}\n');
	fixtureFiles.add(file);
	return file;
}

const compatibility = createFleetCompatibilityProfile(CURRENT_SESSION_CONTROL_PROTOCOL, [
	"status",
	"prepare-rollout",
	"rollout-checkpoint",
]);
const capability = createFleetCapability({
	buildDigest: OTHER,
	productVersion: "1.0.0",
	controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
});

async function tempRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-fleet-plan-"));
	cleanupRoots.push(root);
	return root;
}

function peer(
	sessionId: string,
	state: IrcExternalPeer["state"] = "idle",
	overrides: Partial<IrcExternalPeer> = {},
): IrcExternalPeer {
	return {
		sessionId,
		name: sessionId,
		cwd: "/workspace",
		pid: process.pid,
		lastSeen: NOW,
		state,
		stateTs: NOW,
		sessionFile: materializedSessionFile(sessionId),
		ownerEpoch: `epoch-${sessionId}`,
		buildDigest: OTHER,
		version: "1.0.0",
		fleetCapability: capability,
		...overrides,
	};
}

async function controllerJournal(): Promise<{
	root: string;
	manager: SessionManager;
	journal: FleetControllerJournal;
}> {
	const root = await tempRoot();
	const manager = SessionManager.create(root, path.join(root, "sessions"));
	await manager.ensureOnDisk();
	const ownership = {
		ownerEpoch: "controller-epoch",
	} as SessionOwnershipHandle;
	return {
		root,
		manager,
		journal: {
			appendCustomEntry: manager.appendCustomEntry.bind(manager),
			getEntries: manager.getEntries.bind(manager),
			getSessionId: manager.getSessionId.bind(manager),
			getSessionOwnership: () => ownership,
		},
	};
}

function ids(): () => string {
	let next = 0;
	return () => `id-${next++}`;
}

const target = resolveFleetTarget({ explicitDigest: TARGET, blessedDigest: OTHER });

function planFor(peers: readonly IrcExternalPeer[], overrides = {}) {
	return createFleetRolloutPlan({
		fleetRolloutId: "rollout-a",
		peers,
		target,
		previousDigest: PREVIOUS,
		compatibility,
		initiatorSessionIds: new Set<string>(),
		nowMs: Date.parse(NOW),
		id: ids(),
		...overrides,
	});
}

afterEach(async () => {
	const roots = cleanupRoots.splice(0);
	const fixtures = [...fixtureFiles];
	fixtureFiles.clear();
	await Promise.all([...roots, ...fixtures].map(file => fs.rm(file, { recursive: true, force: true })));
});

describe("fleet rollout planning", () => {
	it("orders idle peers before waiting-input, selects the first as canary, and keeps later waves serial", () => {
		const plan = planFor([peer("w-b", "waiting_input"), peer("i-b"), peer("i-a"), peer("w-a", "waiting_input")], {
			waveSize: 2,
		});

		expect(plan.waves.map(wave => ({ kind: wave.kind, sessions: wave.targets.map(item => item.sessionId) }))).toEqual(
			[
				{ kind: "canary", sessions: ["i-a"] },
				{ kind: "rolling", sessions: ["i-b", "w-a"] },
				{ kind: "rolling", sessions: ["w-b"] },
			],
		);
		expect(plan.maxUnavailable).toBe(1);
	});

	it("puts an eligible explicit canary first", () => {
		const plan = planFor([peer("a"), peer("b")], { canarySessionId: "b" });
		expect(plan.orderedTargets.map(item => item.sessionId)).toEqual(["b", "a"]);
	});

	it("excludes initiator, legacy, pinned, stale, and working peers without guessing", () => {
		const stale = peer("stale", "idle", { lastSeen: "2020-01-01T00:00:00.000Z" });
		const legacy = peer("legacy", "idle", { fleetCapability: undefined });
		const plan = planFor([peer("controller"), legacy, stale, peer("pinned"), peer("busy", "working"), peer("safe")], {
			initiatorSessionIds: new Set(["controller"]),
			sessionPins: new Map([["pinned", OTHER]]),
		});
		const excluded = Object.fromEntries(plan.excluded.map(item => [item.sessionId, item.state]));

		expect(plan.orderedTargets.map(item => item.sessionId)).toEqual(["safe"]);
		expect(excluded).toEqual({
			controller: "Classified",
			legacy: "LegacyIncompatible",
			stale: "LegacyIncompatible",
			pinned: "PinnedElsewhere",
			busy: "BusyDeferred",
		});
	});

	it("defers a peer without a durable session journal before assigning rollout work", () => {
		const plan = planFor([peer("memory", "idle", { sessionFile: undefined })]);

		expect(plan.waves).toEqual([]);
		expect(plan.orderedTargets).toEqual([]);
		expect(plan.excluded).toContainEqual(
			expect.objectContaining({
				sessionId: "memory",
				state: "BusyDeferred",
				reason: "durable session journal not materialized",
			}),
		);
	});

	it("defers an allocated-but-absent journal without assigning rollout work", async () => {
		const root = await tempRoot();
		const plan = planFor([peer("allocated", "idle", { sessionFile: path.join(root, "allocated.jsonl") })]);

		expect(plan.orderedTargets).toEqual([]);
		expect(plan.excluded).toContainEqual(
			expect.objectContaining({
				sessionId: "allocated",
				state: "BusyDeferred",
				reason: "durable session journal not materialized",
			}),
		);
	});

	it("defers empty and non-regular journal paths", async () => {
		const root = await tempRoot();
		const empty = path.join(root, "empty.jsonl");
		const directory = path.join(root, "directory.jsonl");
		await fs.writeFile(empty, "");
		await fs.mkdir(directory);
		const plan = planFor([
			peer("empty", "idle", { sessionFile: empty }),
			peer("directory", "idle", { sessionFile: directory }),
		]);

		expect(plan.orderedTargets).toEqual([]);
		expect(plan.excluded).toHaveLength(2);
		expect(plan.excluded.every(item => item.state === "BusyDeferred")).toBe(true);
		expect(plan.excluded.every(item => item.reason === "durable session journal not materialized")).toBe(true);
	});

	it("plans an eligible peer with a materialized journal fixture", async () => {
		const root = await tempRoot();
		const sessionFile = path.join(root, "session.jsonl");
		await fs.writeFile(sessionFile, '{"type":"session","version":1}\n');
		const plan = planFor([peer("materialized", "idle", { sessionFile })]);

		expect(plan.orderedTargets.map(item => item.sessionId)).toEqual(["materialized"]);
	});

	it("reclassifies a removed journal before command and does not send prepare", async () => {
		const root = await tempRoot();
		const sessionFile = path.join(root, "session.jsonl");
		await fs.writeFile(sessionFile, '{"type":"session","version":1}\n');
		const current = peer("removed", "idle", { sessionFile });
		const plan = planFor([current]);
		const { journal } = await controllerJournal();
		await fs.rm(sessionFile);
		let sent = false;

		const result = await executeFleetRolloutPlan({
			plan,
			journal,
			listPeers: () => [current],
			compatibility,
			initiatorSessionIds: new Set(),
			executeTarget: async () => {
				sent = true;
			},
			nowMs: Date.parse(NOW),
			now: () => NOW,
		});

		expect(result).toEqual({ state: "Succeeded", completed: [] });
		expect(sent).toBe(false);
		expect(fleetRolloutRecords(journal, plan.fleetRolloutId)).toContainEqual(
			expect.objectContaining({
				sessionId: "removed",
				state: "BusyDeferred",
				reason: "durable session journal not materialized",
			}),
		);
	});

	it("plans a fresh current capability while rejecting a legacy peer", () => {
		const current = peer("current");
		const legacy = peer("legacy", "idle", { fleetCapability: undefined });
		const plan = planFor([current, legacy]);

		expect(plan.orderedTargets.map(item => item.sessionId)).toEqual(["current"]);
		expect(plan.excluded).toContainEqual(
			expect.objectContaining({
				sessionId: "legacy",
				state: "LegacyIncompatible",
				reason: "peer did not advertise a recognized fleet capability",
			}),
		);
	});

	it("rejects test fixture build provenance before choosing a canary", () => {
		const fakeCapability = createFleetCapability({
			buildDigest: "0".repeat(64),
			productVersion: "session-runner-test",
			controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
		});
		const fake = peer("project-fixture", "idle", {
			buildDigest: "0".repeat(64),
			version: "session-runner-test",
			fleetCapability: fakeCapability,
		});
		const plan = planFor([fake, peer("cmux-release")]);

		expect(plan.orderedTargets.map(item => item.sessionId)).toEqual(["cmux-release"]);
		expect(plan.excluded).toContainEqual(
			expect.objectContaining({
				sessionId: "project-fixture",
				state: "LegacyIncompatible",
				reason: "peer build digest is not a nonzero release SHA-256",
			}),
		);
	});
});

describe("fleet rollout authority and execution", () => {
	it("journals controller intent as authority while SQLite remains a replaceable index", async () => {
		const { root, manager, journal } = await controllerJournal();
		const index = new RolloutJournal(path.join(root, "rollout-index.sqlite"));
		const lease = new FleetControllerLease(path.join(root, "lease"), {
			ownerId: "controller-a",
			ownerEpoch: "controller-epoch",
			fleetRolloutId: "rollout-authority",
		});
		const result = await startFleetRollout({
			fleetRolloutId: "rollout-authority",
			journal,
			rolloutIndex: index,
			lease,
			resolveTarget: { explicitDigest: TARGET, blessedDigest: OTHER },
			inventory: {
				hasArtifact: digest => digest === TARGET || digest === PREVIOUS,
				hasReadinessReceipt: digest => digest === TARGET,
				previousDigest: PREVIOUS,
			},
			listPeers: () => [peer("target")],
			targetVersion: "1.0.0",
			compatibility,
			initiatorSessionIds: new Set(),
			nowMs: Date.parse(NOW),
			now: () => NOW,
		});
		expect(result.mode).toBe("active");
		expect(index.latestForPeer({ sessionId: "target" })?.phase).toBe("planned");
		index.close();
		await fs.rm(path.join(root, "rollout-index.sqlite"), { force: true });

		expect(fleetRolloutRecords(journal, "rollout-authority")).toMatchObject([
			{ record: "intent", state: "Requested", fleetRolloutId: "rollout-authority", targetDigest: TARGET },
		]);
		await lease.release();
		await manager.close();
	});

	it("freezes every later target after the first failure", async () => {
		const { manager, journal } = await controllerJournal();
		const plan = planFor([peer("a"), peer("b"), peer("c")]);
		const attempted: string[] = [];
		const result = await executeFleetRolloutPlan({
			plan,
			journal,
			listPeers: () => [peer("a"), peer("b"), peer("c")],
			compatibility,
			initiatorSessionIds: new Set(),
			executeTarget: async item => {
				attempted.push(item.sessionId);
				throw new Error("restart failed");
			},
			nowMs: Date.parse(NOW),
			now: () => NOW,
		});

		expect(result).toEqual({ state: "Frozen", completed: [] });
		expect(attempted).toEqual(["a"]);
		expect(
			fleetRolloutRecords(journal, plan.fleetRolloutId).map(record =>
				record.record === "target" ? [record.sessionId, record.state] : [],
			),
		).toEqual([
			["a", "CordonRequested"],
			["a", "RestartFailed"],
			["b", "Frozen"],
			["c", "Frozen"],
		]);
		await manager.close();
	});

	it("re-reads and defers a peer whose epoch changes before command", async () => {
		const { manager, journal } = await controllerJournal();
		const planned = peer("moving");
		const plan = planFor([planned]);
		let called = false;
		const result = await executeFleetRolloutPlan({
			plan,
			journal,
			listPeers: () => [{ ...planned, ownerEpoch: "new-epoch" }],
			compatibility,
			initiatorSessionIds: new Set(),
			executeTarget: async () => {
				called = true;
			},
			nowMs: Date.parse(NOW),
			now: () => NOW,
		});

		expect(result.state).toBe("Succeeded");
		expect(called).toBe(false);
		expect(fleetRolloutRecords(journal, plan.fleetRolloutId)).toMatchObject([
			{ record: "target", sessionId: "moving", state: "BusyDeferred", reason: "owner epoch changed before command" },
		]);
		await manager.close();
	});

	it("defers a target that dies between planning and command without sending", async () => {
		const { manager, journal } = await controllerJournal();
		const planned = peer("dead-before-command");
		const plan = planFor([planned]);
		let sent = false;
		const result = await executeFleetRolloutPlan({
			plan,
			journal,
			listPeers: () => [planned],
			compatibility,
			initiatorSessionIds: new Set(),
			isProcessAlive: () => false,
			executeTarget: async () => {
				sent = true;
			},
			nowMs: Date.parse(NOW),
			now: () => NOW,
		});

		expect(result).toEqual({ state: "Succeeded", completed: [] });
		expect(sent).toBe(false);
		expect(fleetRolloutRecords(journal, plan.fleetRolloutId)).toMatchObject([
			{
				record: "target",
				sessionId: "dead-before-command",
				state: "BusyDeferred",
				reason: "owner process is not alive",
			},
		]);
		await manager.close();
	});

	it("re-observes a journaled command after controller restart without sending it twice", async () => {
		const { manager, journal } = await controllerJournal();
		const current = peer("resume");
		const plan = planFor([current]);
		const planned = plan.orderedTargets[0];
		if (!planned) throw new Error("expected planned target");
		journal.appendCustomEntry("fleet_rollout", {
			schemaVersion: 1,
			record: "target",
			fleetRolloutId: plan.fleetRolloutId,
			waveId: planned.waveId,
			targetId: planned.targetId,
			sessionId: planned.sessionId,
			commandId: planned.commandId,
			expectedOwnerEpoch: planned.expectedOwnerEpoch,
			targetDigest: plan.target.digest,
			targetSource: plan.target.source,
			recordedAt: NOW,
			controllerSessionId: manager.getSessionId(),
			controllerOwnerEpoch: "controller-epoch",
			state: "CordonRequested",
		});
		let sent = 0;
		let observed = 0;
		const result = await executeFleetRolloutPlan({
			plan,
			journal,
			listPeers: () => [current],
			compatibility,
			initiatorSessionIds: new Set(),
			executeTarget: async () => {
				sent += 1;
			},
			reobserveTarget: async target => {
				expect(target.commandId).toBe(planned.commandId);
				observed += 1;
			},
			nowMs: Date.parse(NOW),
			now: () => NOW,
		});

		expect(result).toEqual({ state: "Succeeded", completed: ["resume"] });
		expect({ sent, observed }).toEqual({ sent: 0, observed: 1 });
		await manager.close();
	});

	it("makes a contending controller read-only and journals plan superseded", async () => {
		const root = await tempRoot();
		const first = new FleetControllerLease(root, {
			ownerId: "winner",
			ownerEpoch: "winner-epoch",
			fleetRolloutId: "winner-rollout",
		});
		expect(await first.acquire()).toEqual({ acquired: true });
		const { manager, journal } = await controllerJournal();
		const loser = new FleetControllerLease(root, {
			ownerId: "loser",
			ownerEpoch: "loser-epoch",
			fleetRolloutId: "loser-rollout",
		});
		const result = await startFleetRollout({
			fleetRolloutId: "loser-rollout",
			journal,
			lease: loser,
			resolveTarget: { explicitDigest: TARGET, blessedDigest: OTHER },
			inventory: {
				hasArtifact: digest => digest === TARGET || digest === PREVIOUS,
				hasReadinessReceipt: () => true,
				previousDigest: PREVIOUS,
			},
			listPeers: () => [peer("target")],
			targetVersion: "1.0.0",
			compatibility,
			initiatorSessionIds: new Set(),
			nowMs: Date.parse(NOW),
			now: () => NOW,
		});

		expect(result).toEqual({ mode: "read-only", reason: "plan superseded" });
		expect(fleetRolloutRecords(journal, "loser-rollout")).toMatchObject([
			{ record: "plan-superseded", state: "PlanSuperseded", leaseHolderId: "winner" },
		]);
		await first.release();
		await manager.close();
	});
});

describe("fleet rollout preflight", () => {
	it("honors digest resolution precedence", () => {
		expect(
			resolveFleetTarget({
				explicitDigest: TARGET,
				sessionPin: { sessionId: "pinned", digest: PREVIOUS },
				requestedChannel: "blessed",
				blessedDigest: OTHER,
			}),
		).toEqual({ digest: TARGET, source: { kind: "explicit" } });
	});

	it("blocks missing canary artifact or N−1 before any journal record or cordon", async () => {
		const { root, manager, journal } = await controllerJournal();
		let cordons = 0;
		const lease = new FleetControllerLease(root, {
			ownerId: "controller",
			ownerEpoch: "controller-epoch",
			fleetRolloutId: "blocked",
		});
		await expect(
			startFleetRollout({
				fleetRolloutId: "blocked",
				journal,
				lease,
				resolveTarget: { explicitDigest: TARGET, blessedDigest: OTHER },
				inventory: {
					hasArtifact: digest => {
						cordons += 0;
						return digest !== TARGET;
					},
					hasReadinessReceipt: () => true,
					previousDigest: PREVIOUS,
				},
				listPeers: () => {
					cordons += 1;
					return [peer("target")];
				},
				targetVersion: "1.0.0",
				compatibility,
				initiatorSessionIds: new Set(),
			}),
		).rejects.toThrow("Target artifact");
		expect(cordons).toBe(0);
		expect(fleetRolloutRecords(journal)).toEqual([]);

		await expect(
			preflightFleetTarget(target, {
				hasArtifact: () => true,
				hasReadinessReceipt: () => true,
			}),
		).rejects.toThrow("N−1 artifact retention");
		await manager.close();
	});
});
