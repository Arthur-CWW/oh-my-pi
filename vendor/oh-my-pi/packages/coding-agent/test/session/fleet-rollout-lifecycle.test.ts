import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentSession } from "../../src/session/agent-session";
import {
	buildFleetControlCommand,
	executeFleetRollout,
	resolveFleetRelease,
	type FleetControllerContext,
	type FleetControllerFactory,
} from "../../src/cli/fleet-operations";
import { Settings } from "../../src/config/settings";
import type { IrcExternalPeer } from "../../src/irc/bus-external";
import { IrcExternalBus } from "../../src/irc/bus-external";
import { createFleetCapability, createFleetCompatibilityProfile } from "../../src/session/fleet-capability";
import { evaluateFleetTargetHealth, type FleetHealthResult } from "../../src/session/fleet-health";
import {
	createFleetRollbackPlan,
	evaluateFleetRollbackTrigger,
	executeFleetRollback,
} from "../../src/session/fleet-rollback";
import {
	executeFleetRolloutPlan,
	fleetRolloutRecords,
	FleetControllerLease,
	resolveFleetTarget,
	startFleetRollout,
	type FleetControllerJournal,
	type FleetRolloutPlan,
	type FleetRolloutTarget,
	type FleetTargetState,
} from "../../src/session/fleet-rollout-plan";
import { RolloutJournal } from "../../src/session/rollout-journal";
import { assembleRolloutCheckpoint, type RolloutCheckpoint } from "../../src/session/rollout-checkpoint";
import {
	CURRENT_SESSION_CONTROL_PROTOCOL,
	getSessionSpawnCordon,
	SessionControlBus,
	type SessionControlReceipt,
} from "../../src/session/session-control";
import { startSessionControlTarget, type SessionControlTargetActions } from "../../src/session/session-control-target";
import { SessionManager } from "../../src/session/session-manager";
import type { SessionOwnershipHandle } from "../../src/session/session-ownership";
import { validateFleetUnpinBlessed } from "../../src/session/release-registry-validation";
import { TaskTool } from "../../src/task";
import { performAutoResume, waitForRolloutRecovery } from "../../src/task/auto-resume";
import type { ReAdoptedChild, ReAdoptionResult } from "../../src/task/re-adopt";
import type { ToolSession } from "../../src/tools";

const VERSION = "16.0.1";
const START = Date.parse("2026-07-15T12:00:00.000Z");
const cleanupRoots: string[] = [];

interface TargetFixture {
	readonly manager: SessionManager;
	readonly peer: IrcExternalPeer;
	readonly oldEpoch: string;
	readonly newEpoch: string;
	readonly manualPause: boolean;
}

interface ReleaseFixture {
	readonly targetDigest: string;
	readonly previousDigest: string;
	readonly candidateDigest: string;
	readonly targetExecutable: string;
	readonly registryPath: string;
	readonly releasesDir: string;
	readonly blessedReadiness: string;
	readonly canaryReadiness: string;
}

async function tempRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-fleet-lifecycle-"));
	cleanupRoots.push(root);
	return root;
}

async function executable(releasesDir: string, bytes: string): Promise<{ digest: string; file: string }> {
	const digest = createHash("sha256").update(bytes).digest("hex");
	const file = path.join(releasesDir, `omp-${digest}`);
	await fs.writeFile(file, bytes, { mode: 0o755 });
	return { digest, file };
}

function readiness(digest: string, startedAt: string): string {
	return JSON.stringify({
		schemaVersion: 1,
		buildDigest: digest,
		version: VERSION,
		runnerInstanceId: `runner-${digest.slice(0, 8)}`,
		fixtureSessionId: `fixture-${digest.slice(0, 8)}`,
		ownerEpoch: `ready-${digest.slice(0, 8)}`,
		startedAt,
		stoppedAt: new Date(Date.parse(startedAt) + 1_000).toISOString(),
		initialSnapshotRevision: 1,
		finalSnapshotRevision: 2,
		commandId: randomUUID(),
		proof: {
			mutationAppliedExactlyOnce: true,
			leaseReleased: true,
			leaseReacquired: true,
			jsonlPersisted: true,
			queuePersisted: true,
		},
	});
}

async function releaseFixture(root: string): Promise<ReleaseFixture> {
	const releasesDir = path.join(root, "releases");
	await fs.mkdir(releasesDir, { recursive: true });
	const target = await executable(releasesDir, "#!/bin/sh\n# fleet target\n");
	const previous = await executable(releasesDir, "#!/bin/sh\n# fleet previous\n");
	const candidate = await executable(releasesDir, "#!/bin/sh\n# fleet candidate\n");
	const blessedReadiness = readiness(target.digest, "2026-07-15T11:00:00.000Z");
	const canaryReadiness = readiness(candidate.digest, "2026-07-15T11:30:00.000Z");
	const registryPath = path.join(root, "registry.json");
	await fs.writeFile(
		registryPath,
		JSON.stringify({
			schemaVersion: 1,
			stable: target.digest,
			previous: previous.digest,
			candidate: candidate.digest,
			receiptDigest: createHash("sha256").update(blessedReadiness).digest("hex"),
			timestamps: {
				candidate: "2026-07-15T11:15:00.000Z",
				blessed: "2026-07-15T11:05:00.000Z",
				rollback: null,
			},
		}),
	);
	return {
		targetDigest: target.digest,
		previousDigest: previous.digest,
		candidateDigest: candidate.digest,
		targetExecutable: target.file,
		registryPath,
		releasesDir,
		blessedReadiness,
		canaryReadiness,
	};
}

function capability(digest: string, productVersion = VERSION) {
	return createFleetCapability({
		buildDigest: digest,
		productVersion,
		controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
		rolloutFeatures: ["status", "prepare-rollout", "rollout-checkpoint"],
	});
}

async function targetFixture(
	root: string,
	name: string,
	state: IrcExternalPeer["state"],
	oldDigest: string,
	manualPause = false,
): Promise<TargetFixture> {
	const manager = SessionManager.create(root, path.join(root, "target-sessions"));
	await manager.ensureOnDisk();
	const sessionFile = manager.getSessionFile();
	if (!sessionFile) throw new Error("target fixture requires a journal");
	const oldEpoch = `${name}-epoch-v1`;
	return {
		manager,
		oldEpoch,
		newEpoch: `${name}-epoch-v2`,
		manualPause,
		peer: {
			sessionId: manager.getSessionId(),
			name,
			cwd: root,
			pid: process.pid,
			lastSeen: new Date(START).toISOString(),
			state,
			stateTs: new Date(START).toISOString(),
			sessionFile,
			ownerEpoch: oldEpoch,
			buildDigest: oldDigest,
			version: "15.9.0",
			fleetCapability: capability(oldDigest, "15.9.0"),
		},
	};
}

function ownership(target: TargetFixture, buildDigest: string): SessionOwnershipHandle {
	return {
		sessionFile: target.peer.sessionFile!,
		sessionId: target.peer.sessionId,
		ownerEpoch: target.oldEpoch,
		ownerKind: "omp",
		buildRevision: { digest: buildDigest, version: "15.9.0" },
		runnerInstanceIdentity: {
			runnerInstanceId: `runner-${target.peer.name}`,
			startedAt: new Date(START).toISOString(),
		},
		isCurrent: async () => true,
		isFenced: () => false,
		release: async () => {},
	};
}

function child(id: string): ReAdoptedChild {
	return {
		id,
		task: "fixture task",
		displayName: id,
		sessionFile: `/fixture/${id}.jsonl`,
		taskDepth: 1,
		parentTaskPrefix: id,
		turnState: "interrupted_by_restart",
	};
}

function adoption(children: readonly ReAdoptedChild[]): ReAdoptionResult {
	return { adopted: [...children], autoResumeCandidates: [...children], diagnostics: [], outcome: "ReAdopted" };
}

function controllerJournal(manager: SessionManager, ownerEpoch = "controller-epoch"): FleetControllerJournal {
	return {
		appendCustomEntry: manager.appendCustomEntry.bind(manager),
		getEntries: manager.getEntries.bind(manager),
		getSessionId: manager.getSessionId.bind(manager),
		getSessionOwnership: () => ({ ownerEpoch }) as SessionOwnershipHandle,
	};
}

function controllerIntent(
	journal: FleetControllerJournal,
	plan: FleetRolloutPlan,
	state: "Preflight" | "CanaryWave" | "ObserveCanary" | "RollingWaves" | "Frozen" | "Succeeded",
): void {
	journal.appendCustomEntry("fleet_rollout", {
		schemaVersion: 1,
		record: "intent",
		fleetRolloutId: plan.fleetRolloutId,
		targetDigest: plan.target.digest,
		targetSource: plan.target.source,
		recordedAt: new Date().toISOString(),
		controllerSessionId: journal.getSessionId(),
		controllerOwnerEpoch: journal.getSessionOwnership()!.ownerEpoch,
		state,
		previousDigest: plan.previousDigest,
		maxUnavailable: 1,
	});
}

function targetTransition(
	journal: FleetControllerJournal,
	plan: FleetRolloutPlan,
	target: FleetRolloutTarget,
	state: FleetTargetState,
	evidence: {
		commandId: string;
		checkpointId?: string;
		resultOwnerEpoch?: string;
		journalUri?: string;
	},
): void {
	journal.appendCustomEntry("fleet_rollout", {
		schemaVersion: 1,
		record: "target",
		fleetRolloutId: plan.fleetRolloutId,
		waveId: target.waveId,
		targetId: target.targetId,
		sessionId: target.sessionId,
		commandId: target.commandId,
		expectedOwnerEpoch: target.expectedOwnerEpoch,
		targetDigest: plan.target.digest,
		targetSource: plan.target.source,
		recordedAt: new Date().toISOString(),
		controllerSessionId: journal.getSessionId(),
		controllerOwnerEpoch: journal.getSessionOwnership()!.ownerEpoch,
		state,
		evidence,
	});
}

function healthyResult(peer: IrcExternalPeer): FleetHealthResult {
	return { state: "Healthy", replacement: peer, correlatedErrorCount: 0 };
}

async function controllerFactory(root: string): Promise<{
	factory: FleetControllerFactory;
	managers: SessionManager[];
}> {
	const managers: SessionManager[] = [];
	return {
		managers,
		factory: {
			create: async rolloutId => {
				const manager = SessionManager.create(root, path.join(root, "dry-controller"));
				await manager.ensureOnDisk();
				managers.push(manager);
				const lease = new FleetControllerLease(path.join(root, `dry-lease-${rolloutId}`), {
					ownerId: manager.getSessionId(),
					ownerEpoch: "dry-controller-epoch",
					fleetRolloutId: rolloutId,
				});
				return {
					journal: controllerJournal(manager, "dry-controller-epoch"),
					manager,
					ownership: { ownerEpoch: "dry-controller-epoch" } as SessionOwnershipHandle,
					lease,
					release: async () => lease.release(),
				} satisfies FleetControllerContext;
			},
		},
	};
}

afterEach(async () => {
	await Promise.all(cleanupRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("fleet rollout lifecycle proof", () => {
	it("proves rollout, recovery, rollback, channel, dry-run, and journal authority end to end", async () => {
		const root = await tempRoot();
		const release = await releaseFixture(root);
		const compatibility = createFleetCompatibilityProfile(CURRENT_SESSION_CONTROL_PROTOCOL, [
			"status",
			"prepare-rollout",
			"rollout-checkpoint",
		]);
		const targets = [
			await targetFixture(root, "canary-idle", "idle", release.previousDigest),
			await targetFixture(root, "rolling-idle", "idle", release.previousDigest, true),
			await targetFixture(root, "rolling-waiting", "waiting_input", release.previousDigest),
		];
		const peers = new Map(targets.map(target => [target.peer.sessionId, target.peer]));
		const controller = SessionManager.create(root, path.join(root, "controller"));
		await controller.ensureOnDisk();
		const journal = controllerJournal(controller);
		const indexPath = path.join(root, "rollout-index.sqlite");
		const index = new RolloutJournal(indexPath);
		const fleetRolloutId = "fleet-lifecycle-proof";
		const lease = new FleetControllerLease(path.join(root, "controller-lease"), {
			ownerId: controller.getSessionId(),
			ownerEpoch: "controller-epoch",
			fleetRolloutId,
		});

		const explicit = resolveFleetTarget({
			explicitDigest: release.targetDigest,
			sessionPin: { sessionId: targets[1]!.peer.sessionId, digest: release.candidateDigest },
			requestedChannel: "blessed",
			blessedDigest: release.previousDigest,
		});
		expect(explicit).toEqual({ digest: release.targetDigest, source: { kind: "explicit" } });
		const started = await startFleetRollout({
			fleetRolloutId,
			journal,
			rolloutIndex: index,
			lease,
			resolveTarget: { explicitDigest: release.targetDigest, blessedDigest: release.previousDigest },
			inventory: {
				hasArtifact: digest => digest === release.targetDigest || digest === release.previousDigest,
				hasReadinessReceipt: digest => digest === release.targetDigest,
				previousDigest: release.previousDigest,
			},
			listPeers: () => [...peers.values()],
			targetVersion: VERSION,
			compatibility,
			initiatorSessionIds: new Set(),
			canarySessionId: targets[0]!.peer.sessionId,
			waveSize: 1,
			nowMs: START,
			now: () => new Date(START).toISOString(),
		});
		if (started.mode !== "active") throw new Error("fixture controller unexpectedly lost its lease");
		const plan = started.plan;
		expect(plan.target).toEqual(explicit);
		expect(plan.previousDigest).toBe(release.previousDigest);
		expect(plan.waves.map(wave => [wave.kind, ...wave.targets.map(target => target.sessionId)])).toEqual([
			["canary", targets[0]!.peer.sessionId],
			["rolling", targets[1]!.peer.sessionId],
			["rolling", targets[2]!.peer.sessionId],
		]);
		expect(index.latestForPeer({ sessionId: targets[0]!.peer.sessionId })?.phase).toBe("planned");
		controllerIntent(journal, plan, "Preflight");
		index.close();
		await fs.rm(indexPath, { force: true });
		await controller.flush();
		const controllerFile = controller.getSessionFile();
		if (!controllerFile) throw new Error("controller fixture requires a journal");
		const recoveredController = await SessionManager.open(controllerFile, path.join(root, "controller"));
		expect(
			fleetRolloutRecords(controllerJournal(recoveredController), fleetRolloutId).map(record => record.state),
		).toEqual(["Requested", "Preflight"]);

		controllerIntent(journal, plan, "CanaryWave");
		const bus = new SessionControlBus(path.join(root, "control.sqlite"));
		const resumed: string[] = [];
		const checkpoints = new Map<string, RolloutCheckpoint>();
		const restartCommandIds = new Map<string, string>();
		const targetStateCounts: string[] = [];
		let rollingRecorded = false;
		const execution = await executeFleetRolloutPlan({
			plan,
			journal,
			listPeers: () => [...peers.values()],
			compatibility,
			initiatorSessionIds: new Set(),
			nowMs: START,
			executeTarget: async planned => {
				const fixture = targets.find(item => item.peer.sessionId === planned.sessionId);
				if (!fixture) throw new Error(`missing target fixture ${planned.sessionId}`);
				const wave = plan.waves.find(item => item.waveId === planned.waveId)!;
				if (wave.kind === "rolling" && !rollingRecorded) {
					rollingRecorded = true;
					controllerIntent(journal, plan, "RollingWaves");
				}
				const owner = ownership(fixture, release.previousDigest);
				let restartCommitted = false;
				const fakeSession = {
					asyncJobManager: undefined,
					checkpointChildJobsForRestart: async () => {},
				} as unknown as AgentSession;
				const actions: SessionControlTargetActions = {
					status: () => ({}),
					pause: () => {},
					resume: () => {},
					prepareRollout: async (intent, pauseProvenance, command) => {
						const checkpoint = await assembleRolloutCheckpoint({
							sessionManager: fixture.manager,
							session: fakeSession,
							commandId: command.commandId,
							rolloutId: intent.rolloutId,
							ownerEpoch: command.targetOwnerEpoch,
							expectedDigest: intent.expectedDigest,
							pauseProvenance,
							drainTimeoutMs: 10,
							inspectDrain: () => ({ safe: true, pendingOperations: 0, children: [] }),
						});
						checkpoints.set(planned.sessionId, checkpoint);
						return checkpoint;
					},
					restart: async (_command, commit) => {
						commit();
						restartCommitted = true;
					},
					setModel: () => ({}),
					compact: () => ({}),
					stop: () => {},
				};
				const target = await startSessionControlTarget({ ownership: owner, actions, bus, pollIntervalMs: 1 });
				if (fixture.manualPause) bus.setPaused(planned.sessionId, fixture.oldEpoch, true);
				const prepare = buildFleetControlCommand({
					peer: peers.get(planned.sessionId)!,
					commandId: planned.commandId,
					intent: {
						kind: "prepare-rollout",
						rolloutId: fleetRolloutId,
						expectedDigest: release.previousDigest,
						drainTimeoutMs: 10,
					},
				});
				bus.request(prepare);
				const prepareReceipt = await bus.waitForTerminal(prepare.commandId, {
					timeoutMs: 1_000,
					pollIntervalMs: 1,
				});
				const checkpoint = checkpoints.get(planned.sessionId)!;
				expect(prepareReceipt.state).toBe("applied");
				expect(bus.getCordon(planned.sessionId)).toMatchObject({
					rolloutId: fleetRolloutId,
					ownerEpoch: fixture.oldEpoch,
					checkpointId: checkpoint.checkpointId,
					pauseProvenance: fixture.manualPause ? "manual" : "rollout",
				});
				for (const state of ["Cordoned", "Quiesced", "Checkpointed"] as const) {
					targetStateCounts.push(state);
					targetTransition(journal, plan, planned, state, {
						commandId: prepare.commandId,
						checkpointId: checkpoint.checkpointId,
						journalUri: checkpoint.journalCheckpoint.sessionFile,
					});
				}
				if (wave.kind === "canary") {
					const toolSession = {
						cwd: root,
						hasUI: false,
						settings: Settings.isolated({ "task.isolation.mode": "none", "task.batch": false }),
						getSessionFile: () => fixture.peer.sessionFile ?? null,
						getSessionId: () => planned.sessionId,
						getSessionSpawns: () => "*",
					} as unknown as ToolSession;
					const taskTool = await TaskTool.create(toolSession);
					const refusal = await taskTool.execute("cordoned-spawn", {
						agent: "task",
						assignment: "must be refused",
					});
					expect(refusal.details?.spawnRefusal?.checkpointId).toBe(checkpoint.checkpointId);
					expect(refusal.content[0]).toMatchObject({
						type: "text",
						text: expect.stringContaining("Spawn refused"),
					});
				}
				const restart = buildFleetControlCommand({
					peer: peers.get(planned.sessionId)!,
					intent: {
						kind: "restart",
						executable: release.targetExecutable,
						rolloutId: fleetRolloutId,
						targetDigest: release.targetDigest,
						checkpointCommandId: prepare.commandId,
					},
				});
				restartCommandIds.set(planned.sessionId, restart.commandId);
				targetStateCounts.push("RestartRequested");
				targetTransition(journal, plan, planned, "RestartRequested", {
					commandId: restart.commandId,
					checkpointId: checkpoint.checkpointId,
				});
				bus.request(restart);
				const restartReceipt = await bus.waitForTerminal(restart.commandId, {
					timeoutMs: 1_000,
					pollIntervalMs: 1,
				});
				await target.done;
				expect(restartReceipt.state).toBe("applied");
				expect(restartCommitted).toBe(true);
				for (const state of ["Acknowledged", "ReexecApplied"] as const) {
					targetStateCounts.push(state);
					targetTransition(journal, plan, planned, state, {
						commandId: restart.commandId,
						checkpointId: checkpoint.checkpointId,
					});
				}
				expect(
					fleetRolloutRecords(journal, fleetRolloutId).some(
						record =>
							record.record === "target" && record.sessionId === planned.sessionId && record.state === "Healthy",
					),
				).toBe(false);

				const replacement: IrcExternalPeer = {
					...fixture.peer,
					lastSeen: new Date(START + 10_000).toISOString(),
					stateTs: new Date(START + 10_000).toISOString(),
					ownerEpoch: fixture.newEpoch,
					buildDigest: release.targetDigest,
					version: VERSION,
					fleetCapability: capability(release.targetDigest),
				};
				peers.set(planned.sessionId, replacement);
				const recovery = await waitForRolloutRecovery({
					sessionId: planned.sessionId,
					sessionFile: fixture.peer.sessionFile!,
					previousOwnerEpoch: fixture.oldEpoch,
					previousHeartbeat: fixture.peer.lastSeen,
					targetDigest: release.targetDigest,
					targetVersion: VERSION,
					compatibility,
					timeoutMs: 10,
					listPeers: () => [...peers.values()],
				});
				expect(recovery.phase).toBe("Reacquired");
				targetStateCounts.push("Reacquired");
				targetTransition(journal, plan, planned, "Reacquired", {
					commandId: restart.commandId,
					checkpointId: checkpoint.checkpointId,
					resultOwnerEpoch: fixture.newEpoch,
				});

				const replacementOwnership = {
					...owner,
					ownerEpoch: fixture.newEpoch,
					buildRevision: { digest: release.targetDigest, version: VERSION },
				};
				const statusTarget = await startSessionControlTarget({
					ownership: replacementOwnership,
					actions,
					bus,
					pollIntervalMs: 1,
				});
				const statusCommand = buildFleetControlCommand({ peer: replacement, intent: { kind: "status" } });
				bus.request(statusCommand);
				const statusReceipt = await bus.waitForTerminal(statusCommand.commandId, {
					timeoutMs: 1_000,
					pollIntervalMs: 1,
				});
				const health = evaluateFleetTargetHealth({
					sessionId: planned.sessionId,
					previousOwnerEpoch: fixture.oldEpoch,
					targetDigest: release.targetDigest,
					targetVersion: VERSION,
					fleetRolloutId,
					observedAt: START + 20_000,
					heartbeatFreshAfter: START + 1,
					statusRequestedAt: Date.parse(statusReceipt.requestedAt),
					replacementHeartbeats: [replacement],
					statusReceipt,
					errors: [],
					errorBaseline: { capturedAt: START, countsById: new Map() },
					errorPolicy: { correlatedEventThreshold: 1 },
					incidents: [],
					compatibility,
				});
				expect(health.state).toBe("Healthy");
				const authorized = child(`${fixture.peer.name}-authorized`);
				const notAuthorized = child(`${fixture.peer.name}-not-authorized`);
				let pausedAfterDecision = bus.getPaused(planned.sessionId);
				for (const invalidFence of [
					{ expectedOwnerEpoch: "stale-epoch", fleetRolloutId, checkpointId: checkpoint.checkpointId },
					{
						expectedOwnerEpoch: fixture.oldEpoch,
						fleetRolloutId: "wrong-rollout",
						checkpointId: checkpoint.checkpointId,
					},
					{ expectedOwnerEpoch: fixture.oldEpoch, fleetRolloutId, checkpointId: "wrong-checkpoint" },
				]) {
					expect(() =>
						bus.releaseCordon({
							sessionId: planned.sessionId,
							...invalidFence,
						}),
					).toThrow("No releasable rollout cordon");
				}
				const decision = await performAutoResume({
					checkpoint,
					reAdoption: adoption([authorized, notAuthorized]),
					newOwnerHealthy: health.state === "Healthy",
					statusHealthy: statusReceipt.state === "applied",
					ownershipIsCurrent: () => true,
					isResumeSafe: candidate => candidate.id === authorized.id,
					resume: async candidate => {
						resumed.push(candidate.id);
					},
					decisionJournal: fixture.manager,
					setPaused: paused => {
						bus.setPaused(planned.sessionId, fixture.newEpoch, paused);
						pausedAfterDecision = paused;
					},
					releaseCordon: () =>
						bus.releaseCordon({
							sessionId: planned.sessionId,
							expectedOwnerEpoch: fixture.oldEpoch,
							fleetRolloutId,
							checkpointId: checkpoint.checkpointId,
						}),
				});
				if (fixture.manualPause) {
					expect(decision.resumedAgentIds).toEqual([]);
					expect(pausedAfterDecision).toBe(true);
					expect(bus.getCordon(planned.sessionId)?.pauseProvenance).toBe("manual");
					expect(() =>
						bus.releaseCordon({
							sessionId: planned.sessionId,
							expectedOwnerEpoch: fixture.oldEpoch,
							fleetRolloutId,
							checkpointId: checkpoint.checkpointId,
						}),
					).toThrow("No releasable rollout cordon");
				} else {
					expect(decision.resumedAgentIds).toEqual([authorized.id]);
					expect(decision.excludedAgentIds).toEqual([notAuthorized.id]);
					expect(pausedAfterDecision).toBe(false);
					expect(getSessionSpawnCordon(planned.sessionId)).toBeUndefined();
				}
				await statusTarget.stop();
				for (const state of ["ReAdopted", "AutoResumeAuthorized"] as const) {
					targetStateCounts.push(state);
					targetTransition(journal, plan, planned, state, {
						commandId: restart.commandId,
						checkpointId: checkpoint.checkpointId,
						resultOwnerEpoch: fixture.newEpoch,
					});
				}
				if (decision.phase === "AutoResumed") {
					targetStateCounts.push("AutoResumed");
					targetTransition(journal, plan, planned, "AutoResumed", {
						commandId: restart.commandId,
						checkpointId: checkpoint.checkpointId,
						resultOwnerEpoch: fixture.newEpoch,
					});
				}
				targetStateCounts.push("Healthy");
				targetTransition(journal, plan, planned, "Healthy", {
					commandId: statusCommand.commandId,
					checkpointId: checkpoint.checkpointId,
					resultOwnerEpoch: fixture.newEpoch,
				});
				if (wave.kind === "canary") controllerIntent(journal, plan, "ObserveCanary");
			},
		});
		expect(execution).toEqual({ state: "Succeeded", completed: targets.map(target => target.peer.sessionId) });
		controllerIntent(journal, plan, "Succeeded");
		const records = fleetRolloutRecords(journal, fleetRolloutId);
		for (const target of plan.orderedTargets) {
			const targetRecords = records.filter(
				(record): record is Extract<(typeof records)[number], { readonly record: "target" }> =>
					record.record === "target" && record.sessionId === target.sessionId,
			);
			const checkpoint = checkpoints.get(target.sessionId)!;
			expect(targetRecords.some(record => record.state === "Healthy")).toBe(true);
			expect(targetRecords.every(record => record.fleetRolloutId === fleetRolloutId)).toBe(true);
			expect(
				targetRecords.every(record => record.waveId === target.waveId && record.targetId === target.targetId),
			).toBe(true);
			expect(targetRecords.every(record => record.commandId === target.commandId)).toBe(true);
			expect(targetRecords.every(record => record.expectedOwnerEpoch === target.expectedOwnerEpoch)).toBe(true);
			expect(targetRecords.every(record => record.targetDigest === release.targetDigest)).toBe(true);
			expect(
				targetRecords.some(record => {
					const evidence = record.evidence as { checkpointId?: string; resultOwnerEpoch?: string } | undefined;
					return (
						evidence?.checkpointId === checkpoint.checkpointId &&
						evidence.resultOwnerEpoch === targets.find(item => item.peer.sessionId === target.sessionId)!.newEpoch
					);
				}),
			).toBe(true);
			expect(restartCommandIds.get(target.sessionId)).toMatch(/^[0-9a-f-]{36}$/);
		}

		const rollbackError = {
			id: "post-baseline-build-error",
			firstTimestamp: START + 21_000,
			lastTimestamp: START + 21_000,
			message: "new build failed",
			count: 1,
			source: "runtime",
			session: targets[2]!.peer.sessionId,
			buildDigest: release.targetDigest,
			fleetRolloutId,
			unread: true,
			resolved: false,
		};
		const rollbackHealth = evaluateFleetTargetHealth({
			sessionId: targets[2]!.peer.sessionId,
			previousOwnerEpoch: targets[2]!.oldEpoch,
			targetDigest: release.targetDigest,
			targetVersion: VERSION,
			fleetRolloutId,
			observedAt: START + 30_000,
			heartbeatFreshAfter: START + 1,
			statusRequestedAt: START + 19_000,
			replacementHeartbeats: [peers.get(targets[2]!.peer.sessionId)!],
			statusReceipt: {
				schemaVersion: 1,
				commandId: randomUUID(),
				sessionId: targets[2]!.peer.sessionId,
				targetOwnerEpoch: targets[2]!.newEpoch,
				state: "applied",
				requestedAt: new Date(START + 19_000).toISOString(),
				acknowledgedAt: new Date(START + 19_100).toISOString(),
				completedAt: new Date(START + 19_200).toISOString(),
				result: { kind: "status", sessionId: targets[2]!.peer.sessionId, ownerEpoch: targets[2]!.newEpoch },
			} satisfies SessionControlReceipt,
			errors: [rollbackError],
			errorBaseline: { capturedAt: START + 20_000, countsById: new Map() },
			errorPolicy: { correlatedEventThreshold: 1 },
			incidents: [],
			compatibility,
		});
		expect(rollbackHealth).toMatchObject({ state: "HealthFailed", correlatedErrorCount: 1 });
		const trigger = evaluateFleetRollbackTrigger({ health: rollbackHealth });
		expect(trigger).toMatchObject({ kind: "CorrelatedErrorThreshold", automatic: true });
		if (!trigger) throw new Error("expected rollback trigger");
		controllerIntent(journal, plan, "Frozen");
		const rollbackPlan = createFleetRollbackPlan({
			rollout: plan,
			trigger,
			affectedSessionIds: new Set(plan.orderedTargets.map(target => target.sessionId)),
		});
		expect(rollbackPlan.targets.map(target => target.target.sessionId)).toEqual(
			[...targets].reverse().map(target => target.peer.sessionId),
		);
		journal.appendCustomEntry("fleet_rollout", {
			schemaVersion: 1,
			record: "rollback-wave",
			fleetRolloutId,
			state: "RollbackWave",
			targetDigest: release.previousDigest,
			recordedAt: new Date().toISOString(),
		});
		let terminalCount = 0;
		let globalRolledBack = false;
		const rollback = await executeFleetRollback({
			plan: rollbackPlan,
			waitForSafeBoundary: async target =>
				target.target.sessionId === targets[1]!.peer.sessionId
					? { safe: false, reason: "manual pause did not reach a rollout-owned safe boundary" }
					: { safe: true },
			executeTargetLifecycle: async target => healthyResult(peers.get(target.target.sessionId)!),
			recordTerminal: receipt => {
				terminalCount += 1;
				globalRolledBack =
					terminalCount === rollbackPlan.targets.length && receipt.state === "RolledBack" && globalRolledBack;
				journal.appendCustomEntry("fleet_rollout", {
					schemaVersion: 1,
					record: "rollback-terminal",
					fleetRolloutId,
					...receipt,
				});
			},
		});
		expect(terminalCount).toBe(rollbackPlan.targets.length);
		expect(rollback.state).toBe("Failed");
		expect(rollback.receipts.map(receipt => receipt.state)).toEqual([
			"RolledBack",
			"RollbackIncomplete",
			"RolledBack",
		]);
		expect(globalRolledBack).toBe(false);

		const pinned = resolveFleetTarget({
			sessionPin: { sessionId: targets[0]!.peer.sessionId, digest: release.candidateDigest },
			requestedChannel: "blessed",
			blessedDigest: release.targetDigest,
		});
		expect(pinned).toEqual({
			digest: release.candidateDigest,
			source: { kind: "session-pin", sessionId: targets[0]!.peer.sessionId },
		});
		const validation = { registryPath: release.registryPath, releasesDir: release.releasesDir };
		const blessed = await resolveFleetRelease({
			requestedChannel: "blessed",
			validation: { ...validation, readinessJson: release.blessedReadiness },
		});
		expect(blessed.resolvedDigest).toBe(release.targetDigest);
		const canary = await resolveFleetRelease({
			requestedChannel: "canary",
			validation: { ...validation, readinessJson: release.canaryReadiness },
		});
		expect(canary).toMatchObject({ requestedChannel: "canary", resolvedDigest: release.candidateDigest });
		const unpinned = await validateFleetUnpinBlessed(validation);
		expect(unpinned).toEqual({ channel: "blessed", digest: release.targetDigest, source: "registry-stable" });

		const dryIrc = new IrcExternalBus(path.join(root, "dry-irc.sqlite"));
		const dryManager = SessionManager.create(root, path.join(root, "dry-target"));
		await dryManager.ensureOnDisk();
		const dryPeer = dryIrc.registerPeer({
			sessionId: dryManager.getSessionId(),
			name: "dry-run-target",
			cwd: root,
			sessionFile: dryManager.getSessionFile(),
			ownerEpoch: "dry-old-epoch",
			buildDigest: release.previousDigest,
			version: "15.9.0",
			fleetCapability: capability(release.previousDigest, "15.9.0"),
		});
		dryIrc.updatePeerState(dryPeer.sessionId, "idle");
		const dryController = await controllerFactory(root);
		const dryControlPath = path.join(root, "dry-control.sqlite");
		const dryResult = await executeFleetRollout({
			peers: [{ peer: dryIrc.listPeers({ includeStale: true })[0]!, workstream: "adhoc" }],
			requestedChannel: "blessed",
			dryRun: true,
			bus: dryIrc,
			controlDbPath: dryControlPath,
			release: { ...validation, readinessJson: release.blessedReadiness },
			controller: dryController.factory,
		});
		expect(dryResult.mode).toBe("dry-run");
		expect(dryResult.plan.orderedTargets).toHaveLength(1);
		expect(await Bun.file(dryControlPath).exists()).toBe(false);
		expect(
			dryController.managers
				.flatMap(manager => fleetRolloutRecords(controllerJournal(manager)))
				.some(record => record.state === "Requested"),
		).toBe(true);

		const controllerStates = fleetRolloutRecords(journal, fleetRolloutId)
			.filter(record => record.record === "intent")
			.map(record => record.state);
		expect(controllerStates).toEqual([
			"Requested",
			"Preflight",
			"CanaryWave",
			"ObserveCanary",
			"RollingWaves",
			"Succeeded",
			"Frozen",
		]);
		const stateTransitionCount =
			controllerStates.length + 3 + targetStateCounts.length + 2 + rollback.receipts.length;
		expect(stateTransitionCount).toBe(47);

		bus.close();
		dryIrc.close();
		await lease.release();
		await Promise.all([
			controller.close(),
			recoveredController.close(),
			dryManager.close(),
			...targets.map(target => target.manager.close()),
			...dryController.managers.map(manager => manager.close()),
		]);
	});

	it("returns a typed terminal failure when a registered target never acknowledges", async () => {
		const root = await tempRoot();
		const release = await releaseFixture(root);
		const fixture = await targetFixture(root, "unresponsive", "idle", release.previousDigest);
		const irc = new IrcExternalBus(path.join(root, "irc.sqlite"));
		irc.registerPeer({
			sessionId: fixture.peer.sessionId,
			name: fixture.peer.name,
			cwd: root,
			sessionFile: fixture.peer.sessionFile,
			ownerEpoch: fixture.oldEpoch,
			buildDigest: release.previousDigest,
			version: fixture.peer.version,
			fleetCapability: fixture.peer.fleetCapability,
		});
		irc.updatePeerState(fixture.peer.sessionId, "idle");
		const controller = await controllerFactory(root);
		const controlDbPath = path.join(root, "control.sqlite");
		const startedAt = Date.now();
		const result = await executeFleetRollout({
			peers: [{ peer: irc.listPeers({ includeStale: true })[0]!, workstream: "adhoc" }],
			requestedChannel: "blessed",
			bus: irc,
			controlDbPath,
			release: {
				registryPath: release.registryPath,
				releasesDir: release.releasesDir,
				readinessJson: release.blessedReadiness,
			},
			controller: controller.factory,
			controlTimeoutMs: 20,
			isProcessAlive: () => true,
		});

		expect(Date.now() - startedAt).toBeLessThan(1_000);
		expect(result.execution?.state).toBe("Frozen");
		const failure = result.execution?.state === "Frozen" ? result.execution.failures[0] : undefined;
		expect(failure).toMatchObject({
			targetId: fixture.peer.sessionId,
			sessionId: fixture.peer.sessionId,
			phaseReached: "CordonRequested",
			awaitedCondition: "prepare-rollout terminal receipt",
			timedOut: true,
			cause: expect.stringContaining("last receipt state=requested"),
		});
		const receipts = new SessionControlBus(controlDbPath);
		expect(failure?.commandId ? receipts.getReceipt(failure.commandId) : undefined).toMatchObject({
			sessionId: fixture.peer.sessionId,
			state: "requested",
		});
		receipts.close();
		irc.close();
		await Promise.all([fixture.manager.close(), ...controller.managers.map(manager => manager.close())]);
	});
});
