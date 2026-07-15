import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-utils";
import {
	IrcExternalBus,
	isIrcExternalPeerFresh,
	type IrcExternalPeer,
} from "../irc/bus-external";
import { decodeJournalEntries, projectJournalEntries } from "../journal/projection";
import {
	createFleetCompatibilityProfile,
	type FleetCompatibilityProfile,
} from "../session/fleet-capability";
import {
	createFleetRollbackPlan,
	executeFleetRollback as executeFleetRollbackPlan,
	type FleetRollbackPlan,
	type FleetRollbackTerminalReceipt,
} from "../session/fleet-rollback";
import { requireHealthyFleetTarget } from "../session/fleet-health";
import {
	executeFleetRolloutPlan,
	fleetRolloutRecords,
	FleetControllerLease,
	startFleetRollout,
	type FleetControllerJournal,
	type FleetRolloutPlan,
	type FleetRolloutRecord,
	type FleetRolloutTarget,
} from "../session/fleet-rollout-plan";
import {
	CURRENT_SESSION_CONTROL_PROTOCOL,
	SessionControlBus,
	decodeSessionControlCommand,
	selectSessionControlCommandKind,
	type FleetPinChannel,
	type SessionControlCommand,
	type SessionControlReceipt,
} from "../session/session-control";
import {
	resolveReleaseValidationPaths,
} from "../session/release-registry-validation";
import { SessionManager } from "../session/session-manager";
import { acquireSessionOwnership, type SessionOwnershipHandle } from "../session/session-ownership";
import { resolveVerifiedReleaseExecutable } from "./restart-session";
import { collectFleetErrors } from "./fleet-cli";
import type { DiagnosticEvent } from "../session/error-inbox-ledger";
import {
	readRegistry as readFleetRegistry,
	readinessForDigest as readinessForFleetDigest,
	resolveFleetRelease,
	resolveFleetSelectors,
	selectorMatches,
	type FleetReleaseRegistry,
	type FleetReleaseSelection,
	type FleetResolvedPeer,
	type FleetSelectorOptions,
	type ReleaseRegistryOptions,
} from "./fleet-target-resolution";
import {
	formatFleetActionReceipts,
	formatFleetReceipt,
	formatFleetRolloutPlan,
} from "./fleet-operation-format";
export {
	formatFleetActionReceipts,
	formatFleetReceipt,
	formatFleetRolloutPlan,
	resolveFleetRelease,
	resolveFleetSelectors,
};
export type {
	FleetReleaseRegistry,
	FleetReleaseSelection,
	FleetResolvedPeer,
	FleetSelectorOptions,
	ReleaseRegistryOptions,
};

const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL_TIMEOUT_MS = 30_000;
const RECOVERY_TIMEOUT_MS = 60_000;
const RECOVERY_POLL_MS = 50;
const CONTROLLER_VERSION = "fleet-controller";
const LOCAL_COMPATIBILITY = createFleetCompatibilityProfile(CURRENT_SESSION_CONTROL_PROTOCOL, [
	"status",
	"prepare-rollout",
	"rollout-checkpoint",
]);



export interface FleetControlOptions {
	readonly action: "pause" | "resume";
	readonly peer: IrcExternalPeer;
	readonly controlBus?: SessionControlBus;
	readonly now?: () => string;
	readonly sourceInstanceId?: string;
	readonly timeoutMs?: number;
}

export interface FleetPinOperationOptions {
	readonly channel: FleetPinChannel;
	readonly explicitDigest?: string;
	readonly peers: readonly FleetResolvedPeer[];
	readonly controlBus?: SessionControlBus;
	readonly release?: ReleaseRegistryOptions;
	readonly now?: () => string;
	readonly sourceInstanceId?: string;
	readonly timeoutMs?: number;
}

export interface FleetPinOperationResult {
	readonly selection: FleetReleaseSelection;
	readonly receipts: readonly SessionControlReceipt[];
}


export interface FleetRolloutOperationOptions {
	readonly peers: readonly FleetResolvedPeer[];
	readonly explicitDigest?: string;
	readonly requestedChannel?: "blessed";
	readonly canarySelector?: string;
	readonly waveSize?: number;
	readonly dryRun?: boolean;
	readonly ircDbPath?: string;
	readonly bus?: IrcExternalBus;
	readonly controlDbPath?: string;
	readonly release?: ReleaseRegistryOptions;
	readonly now?: () => string;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly recoveryTimeoutMs?: number;
	readonly controlTimeoutMs?: number;
	readonly controller?: FleetControllerFactory;
}

export interface FleetRolloutOperationResult {
	readonly mode: "active" | "read-only" | "dry-run";
	readonly plan: FleetRolloutPlan;
	readonly execution?: { readonly state: "Succeeded" | "Frozen"; readonly completed: readonly string[] };
	readonly reason?: string;
}

export interface FleetRollbackOperationOptions {
	readonly rolloutId?: string;
	readonly peers: readonly FleetResolvedPeer[];
	readonly to: "previous" | string;
	readonly controlDbPath?: string;
	readonly ircDbPath?: string;
	readonly bus?: IrcExternalBus;
	readonly release?: ReleaseRegistryOptions;
	readonly now?: () => string;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly recoveryTimeoutMs?: number;
	readonly controlTimeoutMs?: number;
	readonly controller?: FleetControllerFactory;
}

export interface FleetRollbackOperationResult {
	readonly plan: FleetRollbackPlan;
	readonly execution: { readonly state: "RolledBack" | "Failed"; readonly receipts: readonly FleetRollbackTerminalReceipt[] };
}

export interface FleetControllerContext {
	readonly journal: FleetControllerJournal;
	readonly manager: SessionManager;
	readonly ownership: SessionOwnershipHandle;
	readonly lease: FleetControllerLease;
	readonly release: () => Promise<void>;
}

export interface FleetControllerFactory {
	readonly create: (rolloutId: string) => Promise<FleetControllerContext>;
}

function nowIso(): string {
	return new Date().toISOString();
}

function assertDigest(value: string, label: string): void {
	if (!SHA256.test(value)) throw new Error(`${label} must be a full 64-character lowercase SHA-256 digest`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localSource(instanceId?: string): {
	readonly kind: "local-cli";
	readonly instanceId: `${string}-${string}-${string}-${string}-${string}`;
	readonly pid: number;
	readonly uid?: number;
} {
	const uid = process.getuid?.();
	return {
		kind: "local-cli",
		instanceId: (instanceId ?? randomUUID()) as `${string}-${string}-${string}-${string}-${string}`,
		pid: process.pid,
		...(uid === undefined ? {} : { uid }),
	};
}

function peerControlRange(peer: IrcExternalPeer): { readonly minMajor: number; readonly maxMajor: number; readonly maxMinor: number } | undefined {
	return peer.fleetCapability?.controlProtocol;
}

export function buildFleetControlCommand(input: {
	readonly peer: IrcExternalPeer;
	readonly intent: SessionControlCommand["intent"];
	readonly commandId?: string;
	readonly sourceInstanceId?: string;
	readonly now?: () => string;
}): SessionControlCommand {
	if (!input.peer.ownerEpoch) throw new Error(`Fleet target ${input.peer.sessionId} has no owner epoch`);
	const kind = selectSessionControlCommandKind(input.intent.kind, CURRENT_SESSION_CONTROL_PROTOCOL, peerControlRange(input.peer) ?? { minMajor: 1, maxMajor: 1, maxMinor: 0 });
	if (!kind) throw new Error(`Fleet target ${input.peer.sessionId} is incompatible with ${input.intent.kind}`);
	const commandId = input.commandId ?? randomUUID();
	const envelope = {
		commandId,
		source: localSource(input.sourceInstanceId),
		sessionId: input.peer.sessionId,
		targetOwnerEpoch: input.peer.ownerEpoch,
		requestedAt: (input.now ?? nowIso)(),
		intent: input.intent,
	} as const;
	const schemaVersion =
		input.intent.kind === "prepare-rollout" ||
		input.intent.kind === "restart" ||
		input.intent.kind === "fleet-pin" ||
		input.intent.kind === "fleet-unpin"
			? 2
			: 1;
	return decodeSessionControlCommand({ schemaVersion, ...envelope });
}


export async function issueFleetControl(input: FleetControlOptions): Promise<SessionControlReceipt> {
	const bus = input.controlBus ?? new SessionControlBus();
	const ownsBus = input.controlBus === undefined;
	try {
		const command = buildFleetControlCommand({
			peer: input.peer,
			intent: { kind: input.action },
			now: input.now,
			sourceInstanceId: input.sourceInstanceId,
		});
		const requested = bus.request(command);
		if (requested.state === "applied" || requested.state === "failed") return requested;
		return await bus.waitForTerminal(command.commandId, { timeoutMs: input.timeoutMs ?? CONTROL_TIMEOUT_MS });
	} finally {
		if (ownsBus) bus.close();
	}
}


export async function executeFleetPinOperation(options: FleetPinOperationOptions): Promise<FleetPinOperationResult> {
	const selection = await resolveFleetRelease({ requestedChannel: options.channel, explicitDigest: options.explicitDigest, validation: options.release });
	const bus = options.controlBus ?? new SessionControlBus();
	const ownsBus = options.controlBus === undefined;
	try {
		const receipts: SessionControlReceipt[] = [];
		for (const target of options.peers) {
			if (!target.peer.ownerEpoch) throw new Error(`Fleet target ${target.peer.sessionId} has no owner epoch`);
			const command = buildFleetControlCommand({
				peer: target.peer,
				intent: { kind: "fleet-pin", selection: {
					requestedChannel: selection.requestedChannel,
					resolvedDigest: selection.resolvedDigest,
					readinessReceipt: selection.readinessReceipt,
				} },
				now: options.now,
				sourceInstanceId: options.sourceInstanceId,
			});
			const requested = bus.request(command);
			const receipt = requested.state === "applied" || requested.state === "failed" ? requested : await bus.waitForTerminal(command.commandId, { timeoutMs: options.timeoutMs ?? CONTROL_TIMEOUT_MS });
			receipts.push(receipt);
		}
		return { selection, receipts };
	} finally {
		if (ownsBus) bus.close();
	}
}

export async function executeFleetUnpinOperation(options: Omit<FleetPinOperationOptions, "channel" | "explicitDigest">): Promise<{ readonly receipts: readonly SessionControlReceipt[] }> {
	const validation = options.release ?? {};
	const paths = resolveReleaseValidationPaths(validation);
	const registry = await readFleetRegistry(paths);
	if (!registry.stable) throw new Error("Release registry has no blessed stable digest");
	const bus = options.controlBus ?? new SessionControlBus();
	const ownsBus = options.controlBus === undefined;
	try {
		const receipts: SessionControlReceipt[] = [];
		for (const target of options.peers) {
			const command = buildFleetControlCommand({ peer: target.peer, intent: { kind: "fleet-unpin" }, now: options.now, sourceInstanceId: options.sourceInstanceId });
			const requested = bus.request(command);
			receipts.push(requested.state === "applied" || requested.state === "failed" ? requested : await bus.waitForTerminal(command.commandId, { timeoutMs: options.timeoutMs ?? CONTROL_TIMEOUT_MS }));
		}
		return { receipts };
	} finally {
		if (ownsBus) bus.close();
	}
}

function defaultControllerFactory(): FleetControllerFactory {
	return {
		create: async (rolloutId: string): Promise<FleetControllerContext> => {
			const manager = SessionManager.create(process.cwd(), path.join(getAgentDir(), "fleet-controller"));
			const sessionFile = manager.getSessionFile();
			if (!sessionFile) throw new Error("Fleet controller journal was not persisted");
			const digest = createHash("sha256").update(await fs.readFile(process.execPath)).digest("hex");
			const runnerInstanceIdentity = { runnerInstanceId: randomUUID(), startedAt: nowIso() };
			const ownership = await acquireSessionOwnership(sessionFile, manager.getSessionId(), {
				buildRevision: { digest, version: CONTROLLER_VERSION },
				runnerInstanceIdentity,
			});
			manager.bindSessionOwnership(ownership);
			const lease = new FleetControllerLease(getAgentDir(), {
				ownerId: manager.getSessionId(),
				ownerEpoch: ownership.ownerEpoch,
				fleetRolloutId: rolloutId,
			});
			const journal: FleetControllerJournal = {
				appendCustomEntry: manager.appendCustomEntry.bind(manager),
				getEntries: manager.getEntries.bind(manager),
				getSessionId: manager.getSessionId.bind(manager),
				getSessionOwnership: manager.getSessionOwnership.bind(manager),
			};
			return {
				journal,
				manager,
				ownership,
				lease,
				release: async () => {
					await lease.release();
					await ownership.release();
					await manager.close();
				},
			};
		},
	};
}

function targetDigest(peer: IrcExternalPeer): string {
	const digest = peer.buildDigest ?? peer.fleetCapability?.buildDigest;
	if (!digest) throw new Error(`Fleet target ${peer.sessionId} has no current build digest`);
	return digest;
}

function targetVersion(peer: IrcExternalPeer): string {
	const version = peer.version ?? peer.fleetCapability?.productVersion;
	if (!version) throw new Error(`Fleet target ${peer.sessionId} has no current product version`);
	return version;
}

function appendIntentLifecycle(
	journal: FleetControllerJournal,
	plan: FleetRolloutPlan,
	state: "Preflight" | "CanaryWave" | "ObserveCanary" | "RollingWaves" | "Frozen" | "Succeeded",
): void {
	const ownership = journal.getSessionOwnership();
	if (!ownership) throw new Error("Fleet controller journal is not bound to session ownership");
	journal.appendCustomEntry("fleet_rollout", {
		schemaVersion: 1,
		record: "intent",
		fleetRolloutId: plan.fleetRolloutId,
		targetDigest: plan.target.digest,
		targetSource: plan.target.source,
		recordedAt: nowIso(),
		controllerSessionId: journal.getSessionId(),
		controllerOwnerEpoch: ownership.ownerEpoch,
		state,
		previousDigest: plan.previousDigest,
		maxUnavailable: 1,
	});
}

function appendTargetLifecycle(journal: FleetControllerJournal, plan: FleetRolloutPlan, target: FleetRolloutTarget, state: FleetRolloutTarget["state"], reason?: string, digest = plan.target.digest): void {
	const ownership = journal.getSessionOwnership();
	if (!ownership) throw new Error("Fleet controller journal is not bound to session ownership");
	journal.appendCustomEntry("fleet_rollout", {
		schemaVersion: 1,
		record: "target",
		fleetRolloutId: plan.fleetRolloutId,
		waveId: target.waveId,
		targetId: target.targetId,
		sessionId: target.sessionId,
		commandId: target.commandId,
		expectedOwnerEpoch: target.expectedOwnerEpoch,
		targetDigest: digest,
		targetSource: plan.target.source,
		recordedAt: nowIso(),
		controllerSessionId: journal.getSessionId(),
		controllerOwnerEpoch: ownership.ownerEpoch,
		state,
		...(reason === undefined ? {} : { reason }),
	});
}

function checkpointFromReceipt(receipt: SessionControlReceipt): unknown {
	if (receipt.state !== "applied" || !isRecord(receipt.result) || !Object.hasOwn(receipt.result, "checkpoint")) throw new Error(receipt.error ?? "Rollout checkpoint command failed");
	return receipt.result.checkpoint;
}

async function waitForReplacement(options: {
	readonly listPeers: () => readonly IrcExternalPeer[];
	readonly target: FleetRolloutTarget;
	readonly targetDigest: string;
	readonly startedAt: number;
	readonly sleep: (ms: number) => Promise<void>;
	readonly timeoutMs: number;
}): Promise<IrcExternalPeer> {
	const deadline = Date.now() + options.timeoutMs;
	for (;;) {
		const replacement = options.listPeers().find(peer => {
			const seen = Date.parse(peer.lastSeen);
			return (
				peer.sessionId === options.target.sessionId &&
				!!peer.ownerEpoch &&
				peer.ownerEpoch !== options.target.expectedOwnerEpoch &&
				peer.buildDigest === options.targetDigest &&
				seen >= options.startedAt
			);
		});
		if (replacement) return replacement;
		if (Date.now() >= deadline)
			throw new Error(`Timed out waiting for replacement heartbeat for ${options.target.sessionId}`);
		await options.sleep(Math.min(RECOVERY_POLL_MS, Math.max(1, deadline - Date.now())));
	}
}

function toDiagnosticEvents(rows: readonly { readonly sessionId: string; readonly cause: string; readonly timestamp: number; readonly buildDigest: string; readonly rolloutId: string; readonly count: number; readonly message: string }[]): DiagnosticEvent[] {
	return rows.map(row => ({
		id: `${row.sessionId}:${row.cause}:${row.timestamp}`,
		firstTimestamp: row.timestamp,
		lastTimestamp: row.timestamp,
		message: row.message,
		count: row.count,
		cause: row.cause as DiagnosticEvent["cause"],
		buildDigest: row.buildDigest,
		fleetRolloutId: row.rolloutId,
		unread: false,
		resolved: false,
	}));
}

async function executeRolloutTarget(input: {
	readonly target: FleetRolloutTarget;
	readonly plan: FleetRolloutPlan;
	readonly journal: FleetControllerJournal;
	readonly controlBus: SessionControlBus;
	readonly allPeers: () => readonly IrcExternalPeer[];
	readonly release: FleetReleaseSelection;
	readonly controlTimeoutMs: number;
	readonly recoveryTimeoutMs: number;
	readonly sleep: (ms: number) => Promise<void>;
	readonly errorsRoot?: string;
	readonly controlDbPath?: string;
	readonly compatibility: FleetCompatibilityProfile;
	readonly sourceInstanceId: string;
}): Promise<void> {
	const current = input.allPeers().find(peer => peer.sessionId === input.target.sessionId);
	if (!current) throw new Error(`Fleet target ${input.target.sessionId} disappeared before rollout`);
	const currentDigest = targetDigest(current);
	const startedAt = Date.now();
	const prepare = buildFleetControlCommand({
		peer: current,
		commandId: input.target.commandId,
		sourceInstanceId: input.sourceInstanceId,
		intent: { kind: "prepare-rollout", rolloutId: input.plan.fleetRolloutId, expectedDigest: currentDigest, drainTimeoutMs: CONTROL_TIMEOUT_MS },
	});
	let receipt = input.controlBus.request(prepare);
	receipt = receipt.state === "applied" || receipt.state === "failed" ? receipt : await input.controlBus.waitForTerminal(prepare.commandId, { timeoutMs: input.controlTimeoutMs });
	if (receipt.state !== "applied") throw new Error(receipt.error ?? `prepare-rollout failed for ${current.sessionId}`);
	checkpointFromReceipt(receipt);
	appendTargetLifecycle(input.journal, input.plan, input.target, "Checkpointed");
	const executable = await resolveVerifiedReleaseExecutable(input.release.releaseStoreDir, input.plan.target.digest);
	const restart = buildFleetControlCommand({
		peer: current,
		sourceInstanceId: input.sourceInstanceId,
		intent: { kind: "restart", executable, rolloutId: input.plan.fleetRolloutId, targetDigest: input.plan.target.digest, checkpointCommandId: prepare.commandId },
	});
	appendTargetLifecycle(input.journal, input.plan, input.target, "RestartRequested");
	receipt = input.controlBus.request(restart);
	receipt = receipt.state === "applied" || receipt.state === "failed" ? receipt : await input.controlBus.waitForTerminal(restart.commandId, { timeoutMs: input.controlTimeoutMs });
	if (receipt.state !== "applied") throw new Error(receipt.error ?? `restart failed for ${current.sessionId}`);
	appendTargetLifecycle(input.journal, input.plan, input.target, "Acknowledged");
	const replacement = await waitForReplacement({
		listPeers: input.allPeers,
		target: input.target,
		targetDigest: input.plan.target.digest,
		startedAt,
		sleep: input.sleep,
		timeoutMs: input.recoveryTimeoutMs,
	});
	appendTargetLifecycle(input.journal, input.plan, input.target, "Reacquired");
	const statusRequestedAt = Date.now();
	const status = buildFleetControlCommand({ peer: replacement, sourceInstanceId: input.sourceInstanceId, intent: { kind: "status" } });
	let statusReceipt = input.controlBus.request(status);
	statusReceipt = statusReceipt.state === "applied" || statusReceipt.state === "failed" ? statusReceipt : await input.controlBus.waitForTerminal(status.commandId, { timeoutMs: input.controlTimeoutMs });
	const projection = await collectFleetErrors({ controlDbPath: input.controlDbPath, nowMs: Date.now() });
	const health = requireHealthyFleetTarget({
		sessionId: replacement.sessionId,
		previousOwnerEpoch: input.target.expectedOwnerEpoch,
		targetDigest: input.plan.target.digest,
		targetVersion: input.release.version,
		fleetRolloutId: input.plan.fleetRolloutId,
		observedAt: Date.now(),
		heartbeatFreshAfter: startedAt,
		statusRequestedAt,
		replacementHeartbeats: input.allPeers(),
		statusReceipt,
		errors: toDiagnosticEvents(projection.errors),
		errorBaseline: { capturedAt: startedAt, countsById: new Map() },
		errorPolicy: { correlatedEventThreshold: 1 },
		incidents: projection.incidents,
		compatibility: input.compatibility,
	});
	if (health.state !== "Healthy") throw new Error("Fleet target health gate failed");
	appendTargetLifecycle(input.journal, input.plan, input.target, "ReAdopted");
	appendTargetLifecycle(input.journal, input.plan, input.target, "Healthy");
}

function buildPlanFromRecords(records: readonly FleetRolloutRecord[], peers: readonly FleetResolvedPeer[], rolloutId: string): FleetRolloutPlan {
	const intent = records.find((record): record is Extract<FleetRolloutRecord, { readonly record: "intent" }> => record.record === "intent");
	if (!intent) throw new Error(`Rollout ${rolloutId} has no durable intent record`);
	const bySession = new Map<string, Extract<FleetRolloutRecord, { readonly record: "target" }>>();
	for (const record of records) {
		if (record.record !== "target" || record.state === "Healthy" || record.state === "RestartFailed" || record.state === "Frozen") continue;
		if (!bySession.has(record.sessionId)) bySession.set(record.sessionId, record);
	}
	const targets: FleetRolloutTarget[] = [];
	for (const record of bySession.values()) {
		const resolved = peers.find(peer => peer.peer.sessionId === record.sessionId);
		if (!resolved) continue;
		targets.push({ targetId: record.targetId, sessionId: record.sessionId, peer: resolved.peer, expectedOwnerEpoch: resolved.peer.ownerEpoch ?? record.expectedOwnerEpoch, commandId: record.commandId, waveId: record.waveId, state: "Classified" });
	}
	if (targets.length === 0) throw new Error(`Rollout ${rolloutId} has no durable target records`);
	const waves = [...new Set(targets.map(target => target.waveId))].map(waveId => ({ waveId, kind: waveId === targets[0]?.waveId ? "canary" as const : "rolling" as const, targets: targets.filter(target => target.waveId === waveId) }));
	return {
		fleetRolloutId: rolloutId,
		target: { digest: intent.targetDigest, source: intent.targetSource },
		previousDigest: intent.previousDigest,
		waves,
		excluded: [],
		orderedTargets: targets,
		maxUnavailable: 1,
	};
}

async function controllerFor(factory: FleetControllerFactory | undefined, rolloutId: string): Promise<FleetControllerContext> {
	return (factory ?? defaultControllerFactory()).create(rolloutId);
}

export async function executeFleetRollout(options: FleetRolloutOperationOptions): Promise<FleetRolloutOperationResult> {
	if (options.peers.length === 0) throw new Error("No eligible fleet targets matched the rollout selectors");
	const release = await resolveFleetRelease({ requestedChannel: options.explicitDigest ? "digest" : (options.requestedChannel ?? "blessed"), explicitDigest: options.explicitDigest, validation: options.release });
	const liveBus = options.bus ?? new IrcExternalBus(options.ircDbPath, { readonly: true });
	const ownsLiveBus = options.bus === undefined;
	const selectedIds = new Set(options.peers.map(item => item.peer.sessionId));
	const allPeers = (): readonly IrcExternalPeer[] => liveBus.listPeers({ includeStale: true }).filter(peer => selectedIds.has(peer.sessionId));
	const canary = options.canarySelector ? options.peers.find(item => selectorMatches(options.canarySelector!, item)) : undefined;
	if (options.canarySelector && !canary) throw new Error(`No rollout target matches --canary ${options.canarySelector}`);
	if (options.canarySelector && options.peers.filter(item => selectorMatches(options.canarySelector!, item)).length !== 1) throw new Error(`--canary ${options.canarySelector} must identify exactly one target`);
	const rolloutId = randomUUID();
	const controller = await controllerFor(options.controller, rolloutId);
	try {
		const inventory = {
			hasArtifact: async (digest: string) => {
				try {
					await resolveVerifiedReleaseExecutable(release.releaseStoreDir, digest);
					return true;
				} catch {
					return false;
				}
			},
			hasReadinessReceipt: async (digest: string) => {
				try {
					await readinessForFleetDigest(digest, options.release ?? {});
					return true;
				} catch {
					return false;
				}
			},
			previousDigest: release.registry.previous ?? undefined,
		};
		const started = await startFleetRollout({
			journal: controller.journal,
			lease: controller.lease,
			resolveTarget: release.requestedChannel === "blessed" ? { requestedChannel: "blessed", blessedDigest: release.resolvedDigest } : { explicitDigest: release.resolvedDigest, blessedDigest: release.resolvedDigest },
			inventory,
			listPeers: allPeers,
			targetVersion: release.version,
			compatibility: LOCAL_COMPATIBILITY,
			initiatorSessionIds: new Set([controller.manager.getSessionId()]),
			canarySessionId: canary?.peer.sessionId,
			fleetRolloutId: rolloutId,
		});
		if (started.mode === "read-only") return { mode: "read-only", reason: started.reason, plan: { fleetRolloutId: "superseded", target: { digest: release.resolvedDigest, source: { kind: "explicit" } }, previousDigest: release.registry.previous ?? release.resolvedDigest, waves: [], excluded: [], orderedTargets: [], maxUnavailable: 1 } };
		appendIntentLifecycle(controller.journal, started.plan, "Preflight");
		if (options.dryRun) return { mode: "dry-run", plan: started.plan };
		appendIntentLifecycle(controller.journal, started.plan, "CanaryWave");
		const controlBus = new SessionControlBus(options.controlDbPath);
		try {
			let rollingStarted = false;
			const execution = await executeFleetRolloutPlan({
				plan: started.plan,
				journal: controller.journal,
				listPeers: allPeers,
				compatibility: LOCAL_COMPATIBILITY,
				initiatorSessionIds: new Set([controller.manager.getSessionId()]),
				executeTarget: async target => {
					const wave = started.plan.waves.find(item => item.waveId === target.waveId);
					if (wave?.kind === "rolling" && !rollingStarted) {
						rollingStarted = true;
						appendIntentLifecycle(controller.journal, started.plan, "RollingWaves");
					}
					await executeRolloutTarget({
						target,
						plan: started.plan,
						journal: controller.journal,
						controlBus,
						allPeers,
						release,
						controlTimeoutMs: options.controlTimeoutMs ?? CONTROL_TIMEOUT_MS,
						recoveryTimeoutMs: options.recoveryTimeoutMs ?? RECOVERY_TIMEOUT_MS,
						sleep: options.sleep ?? Bun.sleep,
						controlDbPath: options.controlDbPath,
						compatibility: LOCAL_COMPATIBILITY,
						sourceInstanceId: randomUUID(),
					});
					if (wave?.kind === "canary")
						appendIntentLifecycle(controller.journal, started.plan, "ObserveCanary");
				},
			});
			appendIntentLifecycle(
				controller.journal,
				started.plan,
				execution.state === "Succeeded" ? "Succeeded" : "Frozen",
			);
			if (execution.state !== "Succeeded" || execution.completed.length !== started.plan.orderedTargets.length) throw new Error("Rollout did not reach a healthy terminal result");
			return { mode: "active", plan: started.plan, execution };
		} finally {
			controlBus.close();
		}
	} finally {
		await controller.release();
		if (ownsLiveBus) liveBus.close();
	}
}

function latestRolloutId(records: readonly FleetRolloutRecord[], peers: readonly FleetResolvedPeer[]): string | undefined {
	const candidates = records.filter((record): record is Extract<FleetRolloutRecord, { readonly record: "intent" }> => record.record === "intent").filter(intent => records.some(record => record.record === "target" && peers.some(peer => peer.peer.sessionId === record.sessionId) && record.fleetRolloutId === intent.fleetRolloutId));
	return candidates.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt)).at(-1)?.fleetRolloutId;
}

async function loadDurableFleetRolloutRecords(
	root = path.join(getAgentDir(), "fleet-controller"),
): Promise<FleetRolloutRecord[]> {
	const records: FleetRolloutRecord[] = [];
	const visit = async (directory: string): Promise<void> => {
		let entries: import("node:fs").Dirent[];
		try {
			entries = await fs.readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const candidate = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(candidate);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
			try {
				const projection = projectJournalEntries(decodeJournalEntries(await fs.readFile(candidate, "utf8")));
				if (!projection) continue;
				for (const item of projection.entries) {
					if (item.type !== "custom" || item.customType !== "fleet_rollout" || !isRecord(item.data))
						continue;
					if (item.data.schemaVersion === 1 && typeof item.data.fleetRolloutId === "string")
						records.push(item.data as unknown as FleetRolloutRecord);
				}
			} catch {
				// Ignore a concurrently-written or unrelated controller journal.
			}
		}
	};
	await visit(root);
	return records;
}

export async function executeFleetRollback(options: FleetRollbackOperationOptions): Promise<FleetRollbackOperationResult> {
	const controller = await controllerFor(options.controller, options.rolloutId ?? "rollback");
	try {
		const records = [
			...(await loadDurableFleetRolloutRecords()),
			...fleetRolloutRecords(controller.journal),
		];
		const rolloutId = options.rolloutId ?? latestRolloutId(records, options.peers);
		if (!rolloutId)
			throw new Error("Rollback requires a durable rollout ID or a selector matching a journaled rollout");
		const rolloutRecords = records.filter(record => record.fleetRolloutId === rolloutId);
		const rollout = buildPlanFromRecords(rolloutRecords, options.peers, rolloutId);
		const affected = new Set(rollout.orderedTargets.map(target => target.sessionId));
		if (options.peers.length > 0) {
			const requested = new Set(options.peers.map(peer => peer.peer.sessionId));
			for (const sessionId of [...affected]) if (!requested.has(sessionId)) affected.delete(sessionId);
		}
		const trigger = { kind: "FleetIncident" as const, reason: "operator requested rollback", automatic: false as const };
		const planned = createFleetRollbackPlan({ rollout, trigger, affectedSessionIds: affected });
		const rollbackPlan: FleetRollbackPlan = options.to === "previous" ? planned : {
			...planned,
			targets: planned.targets.map(target => ({ ...target, selection: { digest: options.to, source: "previous-release" as const } })),
		};
		for (const target of rollbackPlan.targets) assertDigest(target.selection.digest, "Rollback digest");
		const releases = options.release ?? {};
		for (const target of rollbackPlan.targets) await resolveVerifiedReleaseExecutable(resolveReleaseValidationPaths(releases).releasesDir, target.selection.digest);
		const controlBus = new SessionControlBus(options.controlDbPath);
		try {
			const execution = await executeFleetRollbackPlan({
				plan: rollbackPlan,
				waitForSafeBoundary: async () => ({ safe: true }),
				executeTargetLifecycle: async rollbackTarget => {
					const peer = rollbackTarget.target.peer;
					const currentDigest = targetDigest(peer);
					const command = buildFleetControlCommand({ peer, commandId: rollbackTarget.target.commandId, intent: { kind: "prepare-rollout", rolloutId, expectedDigest: currentDigest, drainTimeoutMs: CONTROL_TIMEOUT_MS } });
					let receipt = controlBus.request(command);
					receipt = receipt.state === "applied" || receipt.state === "failed" ? receipt : await controlBus.waitForTerminal(command.commandId, { timeoutMs: options.controlTimeoutMs ?? CONTROL_TIMEOUT_MS });
					if (receipt.state !== "applied") throw new Error(receipt.error ?? "rollback checkpoint failed");
					const executable = await resolveVerifiedReleaseExecutable(resolveReleaseValidationPaths(releases).releasesDir, rollbackTarget.selection.digest);
					const restart = buildFleetControlCommand({ peer, intent: { kind: "restart", executable, rolloutId, targetDigest: rollbackTarget.selection.digest, checkpointCommandId: command.commandId } });
					receipt = controlBus.request(restart);
					receipt = receipt.state === "applied" || receipt.state === "failed" ? receipt : await controlBus.waitForTerminal(restart.commandId, { timeoutMs: options.controlTimeoutMs ?? CONTROL_TIMEOUT_MS });
					if (receipt.state !== "applied") throw new Error(receipt.error ?? "rollback restart failed");
					const replacement = await waitForReplacement({
						listPeers: () => options.peers.map(item => item.peer),
						target: rollbackTarget.target,
						targetDigest: rollbackTarget.selection.digest,
						startedAt: Date.now() - 1,
						sleep: options.sleep ?? Bun.sleep,
						timeoutMs: options.recoveryTimeoutMs ?? RECOVERY_TIMEOUT_MS,
					});
					const status = buildFleetControlCommand({ peer: replacement, intent: { kind: "status" } });
					let statusReceipt = controlBus.request(status);
					statusReceipt = statusReceipt.state === "applied" || statusReceipt.state === "failed" ? statusReceipt : await controlBus.waitForTerminal(status.commandId, { timeoutMs: options.controlTimeoutMs ?? CONTROL_TIMEOUT_MS });
					const release = await resolveFleetRelease({ requestedChannel: "digest", explicitDigest: rollbackTarget.selection.digest, validation: releases });
					return requireHealthyFleetTarget({
						sessionId: replacement.sessionId,
						previousOwnerEpoch: rollbackTarget.target.expectedOwnerEpoch,
						targetDigest: rollbackTarget.selection.digest,
						targetVersion: release.version,
						fleetRolloutId: rolloutId,
						observedAt: Date.now(),
						heartbeatFreshAfter: Date.now() - 1,
						statusRequestedAt: Date.now() - 1,
						replacementHeartbeats: options.peers.map(item => item.peer),
						statusReceipt,
						errors: [],
						errorBaseline: { capturedAt: 0, countsById: new Map() },
						errorPolicy: { correlatedEventThreshold: 1 },
						incidents: [],
						compatibility: LOCAL_COMPATIBILITY,
					});
				},
			});
			return { plan: rollbackPlan, execution };
		} finally {
			controlBus.close();
		}
	} finally {
		await controller.release();
	}
}


