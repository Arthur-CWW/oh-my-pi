import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IrcExternalPeer } from "../irc/bus-external";
import { isIrcExternalPeerFresh } from "../irc/bus-external";
import {
	classifyFleetCompatibility,
	type FleetCompatibilityProfile,
	selectFleetRolloutFeature,
} from "./fleet-capability";
import type { RolloutJournal } from "./rollout-journal";
import type { SessionManager } from "./session-manager";

export const FLEET_ROLLOUT_CUSTOM_TYPE = "fleet_rollout" as const;

export const FLEET_TARGET_STATES = [
	"Discovered",
	"Classified",
	"CordonRequested",
	"Cordoned",
	"QuiesceRequested",
	"Quiesced",
	"Draining",
	"Checkpointed",
	"RestartRequested",
	"Acknowledged",
	"ReexecApplied",
	"Reacquired",
	"ReAdopted",
	"AutoResumeAuthorized",
	"AutoResumed",
	"Healthy",
	"PinnedElsewhere",
	"LegacyIncompatible",
	"BusyDeferred",
	"DrainTimedOut",
	"CheckpointFailed",
	"RestartFailed",
	"RecoveryTimedOut",
	"ReAdoptionDegraded",
	"HealthFailed",
	"RollbackRequested",
	"RolledBack",
	"RollbackIncomplete",
] as const;
export type FleetTargetState = (typeof FLEET_TARGET_STATES)[number];
export type FleetRolloutTargetRecordState = FleetTargetState | "Frozen";

export type FleetTargetSource =
	| { readonly kind: "explicit" }
	| { readonly kind: "session-pin"; readonly sessionId: string }
	| { readonly kind: "requested-channel"; readonly channel: "blessed" }
	| { readonly kind: "blessed" };

export interface ResolvedFleetTarget {
	readonly digest: string;
	readonly source: FleetTargetSource;
}

export interface FleetRolloutRecordBase {
	readonly schemaVersion: 1;
	readonly fleetRolloutId: string;
	readonly targetDigest: string;
	readonly targetSource: FleetTargetSource;
	readonly recordedAt: string;
	readonly controllerSessionId: string;
	readonly controllerOwnerEpoch: string;
}

export interface FleetRolloutIntentRecord extends FleetRolloutRecordBase {
	readonly record: "intent";
	readonly state:
		| "Requested"
		| "Preflight"
		| "CanaryWave"
		| "ObserveCanary"
		| "RollingWaves"
		| "Frozen"
		| "Succeeded";
	readonly previousDigest: string;
	readonly maxUnavailable: 1;
}

export interface FleetRolloutTargetRecord extends FleetRolloutRecordBase {
	readonly record: "target";
	readonly waveId: string;
	readonly targetId: string;
	readonly sessionId: string;
	readonly commandId: string;
	readonly expectedOwnerEpoch: string;
	readonly state: FleetRolloutTargetRecordState;
	readonly reason?: string;
	readonly evidence?: {
		readonly kind: "control-receipt" | "checkpoint" | "heartbeat" | "auto-resume" | "health";
		readonly commandId?: string;
		readonly journalUri?: string;
		readonly ownerEpoch?: string;
	};
}

export interface FleetRolloutSupersededRecord extends FleetRolloutRecordBase {
	readonly record: "plan-superseded";
	readonly state: "PlanSuperseded";
	readonly leaseHolderId: string;
}

export type FleetRolloutRecord = FleetRolloutIntentRecord | FleetRolloutTargetRecord | FleetRolloutSupersededRecord;

export interface FleetRolloutWave {
	readonly waveId: string;
	readonly kind: "canary" | "rolling";
	readonly targets: readonly FleetRolloutTarget[];
}

export interface FleetRolloutTarget {
	readonly targetId: string;
	readonly sessionId: string;
	readonly peer: IrcExternalPeer;
	readonly expectedOwnerEpoch: string;
	readonly commandId: string;
	readonly waveId: string;
	readonly state: FleetTargetState;
	readonly reason?: string;
}

export interface FleetRolloutPlan {
	readonly fleetRolloutId: string;
	readonly target: ResolvedFleetTarget;
	readonly previousDigest: string;
	readonly waves: readonly FleetRolloutWave[];
	readonly excluded: readonly FleetRolloutTarget[];
	readonly orderedTargets: readonly FleetRolloutTarget[];
	readonly maxUnavailable: 1;
}

export interface FleetArtifactInventory {
	readonly hasArtifact: (digest: string) => boolean | Promise<boolean>;
	readonly hasReadinessReceipt: (digest: string) => boolean | Promise<boolean>;
	readonly previousDigest?: string;
}

export interface ResolveFleetTargetOptions {
	readonly explicitDigest?: string;
	readonly sessionPin?: { readonly sessionId: string; readonly digest: string };
	readonly requestedChannel?: "blessed";
	readonly blessedDigest: string;
}

const SHA256_DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/i;

function assertDigest(digest: string, label: string): void {
	if (!SHA256_DIGEST.test(digest)) throw new Error(`${label} is not a SHA-256 digest`);
}

export function resolveFleetTarget(options: ResolveFleetTargetOptions): ResolvedFleetTarget {
	if (options.explicitDigest !== undefined) {
		assertDigest(options.explicitDigest, "Explicit rollout digest");
		return { digest: options.explicitDigest, source: { kind: "explicit" } };
	}
	if (options.sessionPin !== undefined) {
		assertDigest(options.sessionPin.digest, "Session pin digest");
		return {
			digest: options.sessionPin.digest,
			source: { kind: "session-pin", sessionId: options.sessionPin.sessionId },
		};
	}
	assertDigest(options.blessedDigest, "Blessed digest");
	return options.requestedChannel === "blessed"
		? { digest: options.blessedDigest, source: { kind: "requested-channel", channel: "blessed" } }
		: { digest: options.blessedDigest, source: { kind: "blessed" } };
}

export async function preflightFleetTarget(
	target: ResolvedFleetTarget,
	inventory: FleetArtifactInventory,
): Promise<{ readonly previousDigest: string }> {
	assertDigest(target.digest, "Target digest");
	if (!(await inventory.hasArtifact(target.digest)))
		throw new Error(`Target artifact ${target.digest} is unavailable`);
	if (!(await inventory.hasReadinessReceipt(target.digest))) {
		throw new Error(`Readiness receipt for ${target.digest} is unavailable`);
	}
	const previousDigest = inventory.previousDigest;
	if (previousDigest === undefined) throw new Error("N−1 artifact retention is unavailable");
	assertDigest(previousDigest, "N−1 digest");
	if (!(await inventory.hasArtifact(previousDigest))) throw new Error(`N−1 artifact ${previousDigest} is unavailable`);
	return { previousDigest };
}

export interface CreateFleetRolloutPlanOptions {
	readonly fleetRolloutId?: string;
	readonly peers: readonly IrcExternalPeer[];
	readonly target: ResolvedFleetTarget;
	readonly previousDigest: string;
	readonly compatibility: FleetCompatibilityProfile;
	readonly initiatorSessionIds: ReadonlySet<string>;
	readonly initiatorPids?: ReadonlySet<number>;
	readonly sessionPins?: ReadonlyMap<string, string>;
	readonly canarySessionId?: string;
	readonly waveSize?: number;
	readonly nowMs?: number;
	readonly id?: () => string;
}

function stateRank(peer: IrcExternalPeer): number {
	return peer.state === "idle" ? 0 : peer.state === "waiting_input" ? 1 : 2;
}

function comparePeers(left: IrcExternalPeer, right: IrcExternalPeer): number {
	return stateRank(left) - stateRank(right) || left.sessionId.localeCompare(right.sessionId);
}

function classifyPeer(
	peer: IrcExternalPeer,
	options: CreateFleetRolloutPlanOptions,
): { readonly state: FleetTargetState; readonly reason?: string } {
	if (options.initiatorSessionIds.has(peer.sessionId) || options.initiatorPids?.has(peer.pid)) {
		return { state: "Classified", reason: "rollout initiator excluded" };
	}
	if (!isIrcExternalPeerFresh(peer.lastSeen, options.nowMs))
		return { state: "LegacyIncompatible", reason: "stale peer" };
	const compatibility = classifyFleetCompatibility(peer, options.compatibility);
	if (compatibility.kind !== "compatible")
		return { state: "LegacyIncompatible", reason: compatibility.reasons.join("; ") };
	if (selectFleetRolloutFeature("prepare-rollout", options.compatibility, peer) === undefined) {
		return { state: "LegacyIncompatible", reason: "prepare-rollout capability unavailable" };
	}
	if (!peer.ownerEpoch) return { state: "LegacyIncompatible", reason: "owner epoch unavailable" };
	const pin = options.sessionPins?.get(peer.sessionId);
	if (pin !== undefined && pin !== options.target.digest)
		return { state: "PinnedElsewhere", reason: `pinned to ${pin}` };
	if (peer.state === "working") return { state: "BusyDeferred", reason: "working peer is not safe to cordon" };
	if (peer.state !== "idle" && peer.state !== "waiting_input") {
		return { state: "BusyDeferred", reason: `unsafe peer state ${peer.state}` };
	}
	if (peer.buildDigest === options.target.digest) return { state: "Classified", reason: "already at target digest" };
	return { state: "Classified" };
}

export function createFleetRolloutPlan(options: CreateFleetRolloutPlanOptions): FleetRolloutPlan {
	const id = options.id ?? randomUUID;
	const fleetRolloutId = options.fleetRolloutId ?? id();
	const eligible: IrcExternalPeer[] = [];
	const excluded: FleetRolloutTarget[] = [];
	for (const peer of options.peers) {
		const classification = classifyPeer(peer, options);
		if (classification.state === "Classified" && classification.reason === undefined) eligible.push(peer);
		else {
			excluded.push({
				targetId: peer.sessionId,
				sessionId: peer.sessionId,
				peer,
				expectedOwnerEpoch: peer.ownerEpoch ?? "unavailable",
				commandId: id(),
				waveId: "excluded",
				...classification,
			});
		}
	}
	eligible.sort(comparePeers);
	if (options.canarySessionId !== undefined) {
		const canaryIndex = eligible.findIndex(peer => peer.sessionId === options.canarySessionId);
		if (canaryIndex < 0) throw new Error(`Explicit canary ${options.canarySessionId} is not an eligible target`);
		const [canary] = eligible.splice(canaryIndex, 1);
		if (canary) eligible.unshift(canary);
	}
	const waveSize = options.waveSize ?? 1;
	if (!Number.isSafeInteger(waveSize) || waveSize < 1) throw new Error("Wave size must be a positive integer");
	const waves: FleetRolloutWave[] = [];
	const orderedTargets: FleetRolloutTarget[] = [];
	for (let offset = 0; offset < eligible.length; ) {
		const kind = offset === 0 ? "canary" : "rolling";
		const take = kind === "canary" ? 1 : waveSize;
		const waveId = id();
		const targets = eligible.slice(offset, offset + take).map(peer => ({
			targetId: peer.sessionId,
			sessionId: peer.sessionId,
			peer,
			expectedOwnerEpoch: peer.ownerEpoch as string,
			commandId: id(),
			waveId,
			state: "Classified" as const,
		}));
		waves.push({ waveId, kind, targets });
		orderedTargets.push(...targets);
		offset += take;
	}
	return {
		fleetRolloutId,
		target: options.target,
		previousDigest: options.previousDigest,
		waves,
		excluded,
		orderedTargets,
		maxUnavailable: 1,
	};
}

export interface FleetControllerJournal {
	readonly appendCustomEntry: SessionManager["appendCustomEntry"];
	readonly getEntries: SessionManager["getEntries"];
	readonly getSessionId: SessionManager["getSessionId"];
	readonly getSessionOwnership: SessionManager["getSessionOwnership"];
}

function appendFleetRecord(journal: FleetControllerJournal, record: FleetRolloutRecord): void {
	journal.appendCustomEntry(FLEET_ROLLOUT_CUSTOM_TYPE, record);
}

export function fleetRolloutRecords(
	journal: Pick<FleetControllerJournal, "getEntries">,
	fleetRolloutId?: string,
): FleetRolloutRecord[] {
	const records: FleetRolloutRecord[] = [];
	for (const entry of journal.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== FLEET_ROLLOUT_CUSTOM_TYPE) continue;
		const record = entry.data as Partial<FleetRolloutRecord> | undefined;
		if (record?.schemaVersion !== 1 || typeof record.fleetRolloutId !== "string") continue;
		if (fleetRolloutId === undefined || record.fleetRolloutId === fleetRolloutId)
			records.push(record as FleetRolloutRecord);
	}
	return records;
}

export interface FleetControllerLeaseClaim {
	readonly ownerId: string;
	readonly ownerEpoch: string;
	readonly fleetRolloutId: string;
}

export class FleetControllerLease {
	readonly #leaseFile: string;
	readonly #claim: FleetControllerLeaseClaim;
	#held = false;

	constructor(root: string, claim: FleetControllerLeaseClaim) {
		this.#leaseFile = path.join(root, "fleet-controller.lease");
		this.#claim = claim;
	}

	async acquire(): Promise<
		{ readonly acquired: true } | { readonly acquired: false; readonly holder: FleetControllerLeaseClaim }
	> {
		await fs.mkdir(path.dirname(this.#leaseFile), { recursive: true });
		try {
			await fs.writeFile(this.#leaseFile, JSON.stringify(this.#claim), { flag: "wx" });
			this.#held = true;
			return { acquired: true };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const holder = JSON.parse(await fs.readFile(this.#leaseFile, "utf8")) as FleetControllerLeaseClaim;
			return { acquired: false, holder };
		}
	}

	async release(): Promise<void> {
		if (!this.#held) return;
		this.#held = false;
		await fs.rm(this.#leaseFile, { force: true });
	}
}

export interface ExecuteFleetRolloutOptions {
	readonly plan: FleetRolloutPlan;
	readonly journal: FleetControllerJournal;
	readonly rolloutIndex?: Pick<RolloutJournal, "beginRun" | "updatePeer">;
	readonly listPeers: () => readonly IrcExternalPeer[];
	readonly compatibility: FleetCompatibilityProfile;
	readonly initiatorSessionIds: ReadonlySet<string>;
	readonly sessionPins?: ReadonlyMap<string, string>;
	readonly executeTarget: (target: FleetRolloutTarget) => Promise<void>;
	readonly reobserveTarget?: (target: FleetRolloutTarget) => Promise<void>;
	readonly nowMs?: number;
	readonly now?: () => string;
}

function controllerFields(journal: FleetControllerJournal): {
	controllerSessionId: string;
	controllerOwnerEpoch: string;
} {
	const ownership = journal.getSessionOwnership();
	if (!ownership) throw new Error("Fleet controller journal is not bound to session ownership");
	return { controllerSessionId: journal.getSessionId(), controllerOwnerEpoch: ownership.ownerEpoch };
}

function targetRecord(
	options: ExecuteFleetRolloutOptions,
	target: FleetRolloutTarget,
	state: FleetRolloutTargetRecordState,
	reason?: string,
): FleetRolloutTargetRecord {
	return {
		schemaVersion: 1,
		record: "target",
		fleetRolloutId: options.plan.fleetRolloutId,
		waveId: target.waveId,
		targetId: target.targetId,
		sessionId: target.sessionId,
		commandId: target.commandId,
		expectedOwnerEpoch: target.expectedOwnerEpoch,
		targetDigest: options.plan.target.digest,
		targetSource: options.plan.target.source,
		recordedAt: (options.now ?? (() => new Date().toISOString()))(),
		...controllerFields(options.journal),
		state,
		...(reason === undefined ? {} : { reason }),
	};
}

export async function executeFleetRolloutPlan(
	options: ExecuteFleetRolloutOptions,
): Promise<{ readonly state: "Succeeded" | "Frozen"; readonly completed: readonly string[] }> {
	const completed: string[] = [];
	for (const excluded of options.plan.excluded)
		appendFleetRecord(options.journal, targetRecord(options, excluded, excluded.state, excluded.reason));
	for (let index = 0; index < options.plan.orderedTargets.length; index++) {
		const planned = options.plan.orderedTargets[index] as FleetRolloutTarget;
		const current = options.listPeers().find(peer => peer.sessionId === planned.sessionId);
		const reclassified = current
			? classifyPeer(current, {
					peers: [],
					target: options.plan.target,
					previousDigest: options.plan.previousDigest,
					compatibility: options.compatibility,
					initiatorSessionIds: options.initiatorSessionIds,
					sessionPins: options.sessionPins,
					nowMs: options.nowMs,
				})
			: { state: "LegacyIncompatible" as const, reason: "peer disappeared before command" };
		if (
			!current ||
			reclassified.state !== "Classified" ||
			reclassified.reason !== undefined ||
			current.ownerEpoch !== planned.expectedOwnerEpoch
		) {
			const state = current?.ownerEpoch !== planned.expectedOwnerEpoch ? "BusyDeferred" : reclassified.state;
			const reason =
				current?.ownerEpoch !== planned.expectedOwnerEpoch
					? "owner epoch changed before command"
					: reclassified.reason;
			appendFleetRecord(options.journal, targetRecord(options, planned, state, reason));
			continue;
		}
		const priorRequest = fleetRolloutRecords(options.journal, options.plan.fleetRolloutId).some(
			record =>
				record.record === "target" &&
				record.sessionId === planned.sessionId &&
				record.commandId === planned.commandId &&
				record.expectedOwnerEpoch === planned.expectedOwnerEpoch &&
				record.state === "CordonRequested",
		);
		if (priorRequest && options.reobserveTarget === undefined) {
			throw new Error(`Cannot re-observe previously requested command ${planned.commandId}`);
		}
		if (priorRequest) {
			await options.reobserveTarget?.(planned);
			completed.push(planned.sessionId);
			continue;
		}
		appendFleetRecord(options.journal, targetRecord(options, planned, "CordonRequested"));
		options.rolloutIndex?.updatePeer({
			rolloutId: options.plan.fleetRolloutId,
			sessionId: planned.sessionId,
			...(planned.peer.sessionFile ? { sessionFile: planned.peer.sessionFile } : {}),
			name: planned.peer.name,
			phase: "requested",
		});
		try {
			await options.executeTarget(planned);
			completed.push(planned.sessionId);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			appendFleetRecord(options.journal, targetRecord(options, planned, "RestartFailed", reason));
			options.rolloutIndex?.updatePeer({
				rolloutId: options.plan.fleetRolloutId,
				sessionId: planned.sessionId,
				...(planned.peer.sessionFile ? { sessionFile: planned.peer.sessionFile } : {}),
				name: planned.peer.name,
				phase: "failed",
				error: reason,
			});
			for (const later of options.plan.orderedTargets.slice(index + 1)) {
				appendFleetRecord(
					options.journal,
					targetRecord(options, later, "Frozen", `frozen after ${planned.sessionId} failed`),
				);
			}
			return { state: "Frozen", completed };
		}
	}
	return { state: "Succeeded", completed };
}

export interface StartFleetRolloutOptions
	extends Omit<CreateFleetRolloutPlanOptions, "peers" | "target" | "previousDigest"> {
	readonly journal: FleetControllerJournal;
	readonly rolloutIndex?: Pick<RolloutJournal, "beginRun" | "updatePeer">;
	readonly lease: FleetControllerLease;
	readonly resolveTarget: ResolveFleetTargetOptions;
	readonly inventory: FleetArtifactInventory;
	readonly listPeers: () => readonly IrcExternalPeer[];
	readonly targetVersion: string;
	readonly now?: () => string;
}

export async function startFleetRollout(
	options: StartFleetRolloutOptions,
): Promise<
	| { readonly mode: "active"; readonly plan: FleetRolloutPlan }
	| { readonly mode: "read-only"; readonly reason: "plan superseded" }
> {
	const target = resolveFleetTarget(options.resolveTarget);
	const { previousDigest } = await preflightFleetTarget(target, options.inventory);
	const plan = createFleetRolloutPlan({ ...options, peers: options.listPeers(), target, previousDigest });
	const common = {
		schemaVersion: 1 as const,
		fleetRolloutId: plan.fleetRolloutId,
		targetDigest: target.digest,
		targetSource: target.source,
		recordedAt: (options.now ?? (() => new Date().toISOString()))(),
		...controllerFields(options.journal),
	};
	const lease = await options.lease.acquire();
	if (!lease.acquired) {
		appendFleetRecord(options.journal, {
			...common,
			record: "plan-superseded",
			state: "PlanSuperseded",
			leaseHolderId: lease.holder.ownerId,
		});
		return { mode: "read-only", reason: "plan superseded" };
	}
	appendFleetRecord(options.journal, {
		...common,
		record: "intent",
		state: "Requested",
		previousDigest,
		maxUnavailable: 1,
	});
	options.rolloutIndex?.beginRun({
		rolloutId: plan.fleetRolloutId,
		targetDigest: target.digest,
		targetVersion: options.targetVersion,
		startedAt: common.recordedAt,
	});
	for (const targetPlan of [...plan.excluded, ...plan.orderedTargets]) {
		options.rolloutIndex?.updatePeer({
			rolloutId: plan.fleetRolloutId,
			sessionId: targetPlan.sessionId,
			...(targetPlan.peer.sessionFile ? { sessionFile: targetPlan.peer.sessionFile } : {}),
			name: targetPlan.peer.name,
			phase: targetPlan.state === "Classified" ? "planned" : "skipped",
			...(targetPlan.reason === undefined ? {} : { reason: targetPlan.reason }),
		});
	}
	return { mode: "active", plan };
}
