import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { AsyncJobManager } from "../async/job-manager";
import type { IrcExternalBus, IrcExternalPeer } from "../irc/bus-external";
import { AgentLifecycleManager, type AgentReviver } from "../registry/agent-lifecycle";
import { AgentRegistry, MAIN_AGENT_ID } from "../registry/agent-registry";
import type { AgentSession } from "../session/agent-session";
import { matchesProcessIdentity, type ProcessIdentity } from "../resource/process-identity";
import type { RestartChildManifestEntryV1, SessionOwnershipHandle } from "../session/session-ownership";
import type { FileEntry, ModelChangeEntry, SessionInitEntry, SubagentSessionMetadata } from "../session/session-entries";
import type { SessionManager } from "../session/session-manager";
import {
	isPendingProviderRecovery,
	latestProviderRecoveryRecord,
	type ProviderRecoveryRecord,
} from "../session/provider-recovery";
import {
	appendChildLifecycleRecord,
	appendChildRestartRecord,
	classifyChildResumeEvidence,
	isTerminalChildLifecycleState,
	latestChildLifecycleRecord,
	latestChildRestartRecord,
	type ChildLifecycleRecord,
	type ChildLifecycleState,
	type ChildRestartRecord,
	type ChildResumeClassification,
} from "./child-lifecycle";
import {
	type DurableSubagentFailureReceipt,
	listDurableSubagentFailureReceipts,
} from "./subagent-failure";

export const RE_ADOPTION_DIAGNOSTIC_CUSTOM_TYPE = "re-adoption-diagnostic" as const;

export type ReAdoptionDiagnosticReason =
	| "corrupt_journal"
	| "stale_parent"
	| "isolated"
	| "id_collision"
	| "unavailable_model"
	| "reviver_unavailable"
	| "external_owner_live"
	| "external_owner_unverifiable"
	| "owner_record_corrupt"
	| "ownership_lost"
	| "legacy_journal"
	| "terminal_state"
	| "detached_process_dead"
	| "detached_process_unverifiable"
	| "manifest_unadopted";

export interface ReAdoptionDiagnostic {
	file: string;
	reason: ReAdoptionDiagnosticReason;
	detail: string;
}

export interface ReAdoptedChild {
	id: string;
	task: string;
	displayName: string;
	sessionFile: string;
	model?: string;
	thinkingLevel?: string | null;
	hotswapModel?: string;
	taskDepth: number;
	parentTaskPrefix: string;
	lifecycleState: ChildLifecycleState;
	providerRecovery?: ProviderRecoveryRecord;
	detachedProcess?: ProcessIdentity;
	turnState: "detached_live" | "interrupted_by_restart";
}

export interface ReAdoptionResult {
	adopted: ReAdoptedChild[];
	autoResumeCandidates: ReAdoptedChild[];
	diagnostics: ReAdoptionDiagnostic[];
	outcome: "ReAdopted" | "ReAdoptionDegraded";
}

export interface ReAdoptionOptions {
	parentSessionFile: string;
	parentSessionId: string;
	idleTtlMs: number;
	ownership: SessionOwnershipHandle;
	/** Ordered-restart predecessor epoch. Omit for an ordinary resume. */
	predecessorOwnerEpoch?: string;
	restartManifest?: readonly RestartChildManifestEntryV1[];
	registry?: AgentRegistry;
	lifecycle?: AgentLifecycleManager;
	/** Parent journal authority for durable rollout re-adoption diagnostics. */
	diagnosticJournal?: Pick<SessionManager, "appendCustomEntry" | "flush">;
	/** Rollout recovery defers manifest-authorized turns until post-reexec health gates pass. */
	deferInterruptedResume?: boolean;
	/** Durable subprocess registry used to prove a detached child is still the same live process. */
	externalBus?: Pick<IrcExternalBus, "listPeers"> & Partial<Pick<IrcExternalBus, "unregisterPeer">>;
	/** Rebuild the parent-side async job around a fingerprint-verified detached worker. */
	reattachRunningChild?: (child: ReAdoptedChild) => void | Promise<void>;
	createReviver: (child: ReAdoptedChild, init: SessionInitEntry) => Promise<AgentReviver>;
	/** Restarts one provider turn from its last journaled boundary. */
	resumeInterruptedTurn?: (child: ReAdoptedChild, session: AgentSession) => Promise<void>;
}

interface ReAdoptionCandidate {
	sessionFile: string;
	init: SessionInitEntry;
	metadata: SubagentSessionMetadata;
	lifecycle: ChildLifecycleRecord;
	providerRecovery?: ProviderRecoveryRecord;
	hotswapModel?: string;
	restart?: ChildRestartRecord;
	autoResumeAuthorized: boolean;
	detachedPeer?: IrcExternalPeer;
	detachedProcessDead: boolean;
}

function isSubagentMetadata(value: SubagentSessionMetadata | undefined): value is SubagentSessionMetadata {
	return (
		value !== undefined &&
		typeof value.agentId === "string" &&
		typeof value.parentSessionFile === "string" &&
		typeof value.parentSessionId === "string" &&
		typeof value.displayName === "string" &&
		(value.model === undefined || typeof value.model === "string") &&
		(value.thinkingLevel === undefined || value.thinkingLevel === null || typeof value.thinkingLevel === "string") &&
		typeof value.isolated === "boolean" &&
		typeof value.taskDepth === "number" &&
		Number.isInteger(value.taskDepth) &&
		value.taskDepth >= 0 &&
		typeof value.parentTaskPrefix === "string"
	);
}

function parseJournal(text: string): FileEntry[] | null {
	const entries: FileEntry[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const parsed: FileEntry = JSON.parse(line);
			if (typeof parsed.type !== "string") return null;
			entries.push(parsed);
		} catch {
			return null;
		}
	}
	return entries.length > 0 ? entries : null;
}

function latestInit(entries: readonly FileEntry[]): SessionInitEntry | undefined {
	return [...entries].reverse().find((entry): entry is SessionInitEntry => entry.type === "session_init");
}

function samePath(left: string, right: string): boolean {
	return path.resolve(left) === path.resolve(right);
}

function hasLaterParkedTimeline(entries: readonly FileEntry[], lifecycle: ChildLifecycleRecord): boolean {
	const lifecycleIndex = entries.findLastIndex(
		entry =>
			entry.type === "custom" &&
			entry.customType === "child_lifecycle" &&
			(entry.data as { updatedAt?: unknown }).updatedAt === lifecycle.updatedAt,
	);
	if (lifecycleIndex < 0) return false;
	return entries.slice(lifecycleIndex + 1).some(entry => {
		if (entry.type !== "custom" || entry.customType !== "omp:agent-timeline:v1") return false;
		const data = entry.data as { agentId?: unknown; toState?: unknown };
		return data.agentId === lifecycle.agentId && data.toState === "parked";
	});
}

function appendDiagnostic(
	result: ReAdoptionResult,
	file: string,
	reason: ReAdoptionDiagnosticReason,
	detail: string,
	journal?: Pick<SessionManager, "appendCustomEntry">,
): void {
	const entry = { file, reason, detail };
	result.diagnostics.push(entry);
	journal?.appendCustomEntry(RE_ADOPTION_DIAGNOSTIC_CUSTOM_TYPE, {
		...entry,
		outcome: "ReAdoptionDegraded",
		createdAt: new Date().toISOString(),
	});
	logger.warn("Subagent restart re-adoption skipped", entry);
}

/**
 * Reconstruct durable direct children from their journals and durable worker
 * identity projection. Fingerprint-verified workers remain running under the
 * same id; only fingerprint-proven dead workers or restart-checkpointed turns
 * are rebuilt as parked sessions and resumed from journal continuity.
 */
export async function reAdoptDirectChildren(options: ReAdoptionOptions): Promise<ReAdoptionResult> {
	const result: ReAdoptionResult = {
		adopted: [],
		autoResumeCandidates: [],
		diagnostics: [],
		outcome: "ReAdopted",
	};
	const registry = options.registry ?? AgentRegistry.global();
	const lifecycle = options.lifecycle ?? AgentLifecycleManager.global();
	const diagnostic = (file: string, reason: ReAdoptionDiagnosticReason, detail: string): void =>
		appendDiagnostic(result, file, reason, detail, options.diagnosticJournal);
	const finish = async (): Promise<ReAdoptionResult> => {
		result.outcome = result.diagnostics.length === 0 ? "ReAdopted" : "ReAdoptionDegraded";
		if (result.diagnostics.length > 0) await options.diagnosticJournal?.flush();
		return result;
	};
	const registeredIds: string[] = [];
	const rollbackOwnershipLoss = async (file: string): Promise<ReAdoptionResult> => {
		diagnostic(file, "ownership_lost", "parent ownership epoch changed during re-adoption");
		await Promise.all(registeredIds.map(id => lifecycle.release(id)));
		result.adopted.length = 0;
		result.autoResumeCandidates.length = 0;
		return finish();
	};
	const restartManifest = new Map((options.restartManifest ?? []).map(entry => [entry.agentId, entry]));
	const unmatchedManifest = new Map(restartManifest);
	const externalPeers = options.externalBus?.listPeers({ includeStale: true }) ?? [];
	const diagnoseUnmatchedManifest = (): void => {
		for (const entry of unmatchedManifest.values()) {
			diagnostic(
				entry.journalPath,
				"manifest_unadopted",
				`restart manifest child ${entry.agentId} was not validated and registered`,
			);
		}
		unmatchedManifest.clear();
	};
	if (!(await options.ownership.isCurrent())) return rollbackOwnershipLoss(options.parentSessionFile);
	const childrenDir = options.parentSessionFile.endsWith(".jsonl")
		? options.parentSessionFile.slice(0, -".jsonl".length)
		: "";
	if (!childrenDir) {
		diagnoseUnmatchedManifest();
		return finish();
	}

	let names: string[];
	try {
		names = await fs.readdir(childrenDir);
	} catch {
		diagnoseUnmatchedManifest();
		return finish();
	}

	const candidates: ReAdoptionCandidate[] = [];
	const ownedFilesById = new Map<string, string[]>();
	for (const name of names) {
		if (!name.endsWith(".jsonl") || name.includes(".bak")) continue;
		const sessionFile = path.join(childrenDir, name);
		let entries: FileEntry[] | null;
		try {
			entries = parseJournal(await fs.readFile(sessionFile, "utf8"));
		} catch {
			diagnostic(sessionFile, "corrupt_journal", "child journal cannot be read");
			continue;
		}
		if (!entries) {
			diagnostic(sessionFile, "corrupt_journal", "child journal is not valid JSONL");
			continue;
		}
		const init = latestInit(entries);
		const metadata = init?.subagent;
		if (
			!init ||
			!isSubagentMetadata(metadata) ||
			typeof init.systemPrompt !== "string" ||
			typeof init.task !== "string" ||
			!Array.isArray(init.tools) ||
			!init.tools.every(tool => typeof tool === "string")
		) {
			diagnostic(sessionFile, "corrupt_journal", "missing or invalid typed subagent session-init metadata");
			continue;
		}
		if (
			!samePath(metadata.parentSessionFile, options.parentSessionFile) ||
			metadata.parentSessionId !== options.parentSessionId
		) {
			diagnostic(sessionFile, "stale_parent", "persisted parent session lineage does not match resumed parent");
			continue;
		}
		if (metadata.isolated) {
			diagnostic(sessionFile, "isolated", "isolated children remain history-only");
			continue;
		}
		const ownedFiles = ownedFilesById.get(metadata.agentId);
		if (ownedFiles) ownedFiles.push(sessionFile);
		else ownedFilesById.set(metadata.agentId, [sessionFile]);
		const childLifecycle = latestChildLifecycleRecord(entries);
		if (childLifecycle === null) {
			diagnostic(sessionFile, "corrupt_journal", "child lifecycle record is malformed");
			continue;
		}
		if (!childLifecycle) {
			diagnostic(sessionFile, "legacy_journal", "journals without lifecycle records remain history-only");
			continue;
		}
		if (
			childLifecycle.agentId !== metadata.agentId ||
			!samePath(childLifecycle.childSessionFile, sessionFile) ||
			!samePath(childLifecycle.parentSessionFile, options.parentSessionFile)
		) {
			diagnostic(sessionFile, "owner_record_corrupt", "lifecycle ownership does not match this direct child journal");
			continue;
		}
		const providerRecovery = latestProviderRecoveryRecord(entries);
		if (providerRecovery === null) {
			diagnostic(sessionFile, "corrupt_journal", "provider recovery record is malformed");
			continue;
		}
		if (childLifecycle.state === "waiting-provider" && !isPendingProviderRecovery(providerRecovery)) {
			diagnostic(sessionFile, "owner_record_corrupt", "waiting-provider child has no pending recovery record");
			continue;
		}
		const terminalLifecycle = isTerminalChildLifecycleState(childLifecycle.state);
		const hotswap = [...entries].reverse().find(
			(entry): entry is ModelChangeEntry => entry.type === "model_change" && entry.role === "hotswap",
		);
		const manifestEntry = restartManifest.get(metadata.agentId);
		if (manifestEntry && !samePath(manifestEntry.journalPath, sessionFile)) {
			diagnostic(sessionFile, "owner_record_corrupt", "restart manifest journal does not match this child");
			continue;
		}
		const journalRestart = latestChildRestartRecord(entries);
		if (journalRestart === null) {
			diagnostic(sessionFile, "corrupt_journal", "child restart record is malformed");
			continue;
		}
		const restart =
			journalRestart ??
			(manifestEntry && options.predecessorOwnerEpoch
				? {
						version: 1 as const,
						agentId: metadata.agentId,
						predecessorOwnerEpoch: options.predecessorOwnerEpoch,
						state: manifestEntry.state,
						queueCheckpoint: manifestEntry.queueCheckpoint,
						status: "pending" as const,
						updatedAt: new Date().toISOString(),
					}
				: undefined);
		const restartAuthorizesRecovery =
			manifestEntry !== undefined &&
			options.predecessorOwnerEpoch !== undefined &&
			restart?.predecessorOwnerEpoch === options.predecessorOwnerEpoch &&
			(restart.status === "pending" || restart.status === "resuming");
		let detachedPeer: IrcExternalPeer | undefined;
		let detachedProcessDead = false;
		if (childLifecycle.state === "running") {
			const peers = externalPeers.filter(
				peer =>
					peer.agentId === metadata.agentId &&
					peer.sessionFile !== undefined &&
					samePath(peer.sessionFile, sessionFile),
			);
			if (peers.length === 1 && peers[0]?.processIdentity) {
				if (matchesProcessIdentity(peers[0].processIdentity)) {
					detachedPeer = peers[0];
				} else {
					detachedProcessDead = true;
					options.externalBus?.unregisterPeer?.(peers[0].sessionId, peers[0].pid);
					if (!restartAuthorizesRecovery) {
						diagnostic(
							sessionFile,
							"detached_process_dead",
							`detached process ${peers[0].processIdentity.pid} no longer matches its start fingerprint`,
						);
					}
				}
			} else if (peers.length > 0 || !restartAuthorizesRecovery) {
				diagnostic(
					sessionFile,
					"detached_process_unverifiable",
					peers.length > 1
						? `multiple detached process registry rows claim ${metadata.agentId}`
						: `running child ${metadata.agentId} has no unique PID+start-fingerprint registry row`,
				);
				continue;
			}
		}
		if (terminalLifecycle && !restartAuthorizesRecovery && !hasLaterParkedTimeline(entries, childLifecycle)) {
			diagnostic(sessionFile, "terminal_state", `child lifecycle is terminal (${childLifecycle.state})`);
			continue;
		}
		if (restart && restart.agentId !== metadata.agentId) {
			diagnostic(sessionFile, "owner_record_corrupt", "restart checkpoint agent does not match this journal");
			continue;
		}
		candidates.push({
			sessionFile,
			init,
			metadata,
			lifecycle: childLifecycle,
			...(providerRecovery ? { providerRecovery } : {}),
			...(restart ? { restart } : {}),
			autoResumeAuthorized:
				!detachedPeer && ((restartAuthorizesRecovery && restart?.state === "running") || detachedProcessDead),
			detachedProcessDead,
			...(hotswap && typeof hotswap.model === "string" ? { hotswapModel: hotswap.model } : {}),
			...(detachedPeer ? { detachedPeer } : {}),
		});
	}

	for (const candidate of candidates) {
		if ((ownedFilesById.get(candidate.metadata.agentId)?.length ?? 0) !== 1) {
			diagnostic(candidate.sessionFile, "id_collision", `stable id ${candidate.metadata.agentId} belongs to multiple child journals`);
			continue;
		}
		const desiredStatus = candidate.detachedPeer ? "running" : "parked";
		const existing = registry.get(candidate.metadata.agentId);
		if (
			existing &&
			(existing.status !== desiredStatus || !samePath(existing.sessionFile ?? "", candidate.sessionFile))
		) {
			diagnostic(candidate.sessionFile, "id_collision", `stable id ${candidate.metadata.agentId} is already owned by a live or different child`);
			continue;
		}
		const child: ReAdoptedChild = {
			id: candidate.metadata.agentId,
			task: candidate.init.task,
			displayName: candidate.metadata.displayName,
			taskDepth: candidate.metadata.taskDepth,
			parentTaskPrefix: candidate.metadata.parentTaskPrefix,
			sessionFile: candidate.sessionFile,
			model: candidate.lifecycle.modelId ?? candidate.metadata.model,
			thinkingLevel: candidate.lifecycle.thinkingLevel ?? candidate.metadata.thinkingLevel,
			hotswapModel: candidate.hotswapModel,
			lifecycleState: candidate.lifecycle.state,
			...(candidate.providerRecovery ? { providerRecovery: candidate.providerRecovery } : {}),
			...(candidate.detachedPeer?.processIdentity
				? { detachedProcess: candidate.detachedPeer.processIdentity }
				: {}),
			turnState: candidate.detachedPeer ? "detached_live" : "interrupted_by_restart",
		};
		let revive: AgentReviver;
		try {
			revive = await options.createReviver(child, candidate.init);
		} catch (error) {
			diagnostic(
				candidate.sessionFile,
				"unavailable_model",
				error instanceof Error ? error.message : "current model policy cannot revive this child",
			);
			continue;
		}
		if (!(await options.ownership.isCurrent())) return rollbackOwnershipLoss(candidate.sessionFile);
		const current = registry.get(child.id);
		if (
			current &&
			(current.status !== desiredStatus || !samePath(current.sessionFile ?? "", candidate.sessionFile))
		) {
			diagnostic(candidate.sessionFile, "id_collision", `stable id ${child.id} changed ownership during re-adoption`);
			continue;
		}
		if (!current) {
			registry.register({
				id: child.id,
				displayName: child.displayName,
				kind: "sub",
				parentId: MAIN_AGENT_ID,
				session: null,
				sessionFile: candidate.sessionFile,
				status: desiredStatus,
				recovery: {
					task: child.task,
					model: child.model,
					thinkingLevel: child.thinkingLevel,
					hotswapModel: child.hotswapModel,
					turnState: child.turnState,
				},
			});
			registeredIds.push(child.id);
		}
		lifecycle.adopt(child.id, { idleTtlMs: options.idleTtlMs, revive });
		if (candidate.detachedPeer) {
			try {
				await options.reattachRunningChild?.(child);
			} catch (error) {
				await lifecycle.release(child.id);
				diagnostic(
					candidate.sessionFile,
					"reviver_unavailable",
					error instanceof Error ? error.message : "detached worker supervision could not be reattached",
				);
				continue;
			}
		}
		result.adopted.push(child);
		if (candidate.autoResumeAuthorized) result.autoResumeCandidates.push(child);
		unmatchedManifest.delete(child.id);
	}

	diagnoseUnmatchedManifest();
	// Registration is deliberately a barrier: a crash before this point leaves
	// every journal checkpoint pending and safe for the next replacement.
	if (!options.deferInterruptedResume && options.resumeInterruptedTurn) {
		for (const candidate of candidates) {
			if (
				!candidate.autoResumeAuthorized ||
				!result.adopted.some(child => child.id === candidate.metadata.agentId)
			) {
				continue;
			}
			if (!(await options.ownership.isCurrent())) return rollbackOwnershipLoss(candidate.sessionFile);
			try {
				const session = await lifecycle.ensureLive(candidate.metadata.agentId);
				const child = result.adopted.find(adopted => adopted.id === candidate.metadata.agentId);
				if (!child) continue;
				const restart = candidate.restart;
				const attemptId = restart ? crypto.randomUUID() : undefined;
				if (restart && attemptId) {
					appendChildRestartRecord(session.sessionManager, {
						...restart,
						status: "resuming",
						attemptId,
						updatedAt: new Date().toISOString(),
					});
					await session.sessionManager.flush();
				}
				await options.resumeInterruptedTurn(child, session);
				if (restart && attemptId) {
					appendChildRestartRecord(session.sessionManager, {
						...restart,
						status: "resumed",
						attemptId,
						updatedAt: new Date().toISOString(),
					});
					await session.sessionManager.flush();
				}
			} catch (error) {
				diagnostic(
					candidate.sessionFile,
					"reviver_unavailable",
					error instanceof Error ? error.message : "interrupted turn could not be restarted",
				);
			}
		}
	}
	return finish();
}

interface DurableResumeCandidate {
	sessionFile: string;
	entries: FileEntry[];
	init: SessionInitEntry;
	metadata: SubagentSessionMetadata;
	lifecycle: ChildLifecycleRecord | undefined | null;
}

export interface DurableChildJobRecord {
	id: string;
	label: string;
	startTime: number;
	status: "running" | "completed" | "failed";
	outcome: ChildResumeClassification["outcome"];
	disposition: ChildResumeClassification["disposition"];
	errorText?: string;
}

export type ResumeInterruptedChildResult =
	| {
			status: "started";
			agentId: string;
			jobId: string;
			transcriptUri: string;
			assignment: string;
			classification: ChildResumeClassification;
	  }
	| {
			status: "already_running";
			agentId: string;
			jobId: string;
			transcriptUri: string;
	  }
	| {
			status: "refused";
			agentId: string;
			reason: string;
			transcriptUri?: string;
			classification?: ChildResumeClassification;
	  };

export interface ResumeInterruptedChildOptions {
	agentId: string;
	parentSessionFile: string;
	parentSessionId: string;
	parentJournal: Pick<SessionManager, "getEntries" | "getSessionOwnership">;
	manager: AsyncJobManager;
	idleTtlMs: number;
	registry?: AgentRegistry;
	lifecycle?: AgentLifecycleManager;
	externalBus?: Pick<IrcExternalBus, "listPeers">;
	createReviver: (child: ReAdoptedChild, init: SessionInitEntry) => Promise<AgentReviver>;
	startTurn: (child: ReAdoptedChild, session: AgentSession) => Promise<string> | string;
}

export interface DurableChildJobOptions {
	parentSessionFile: string;
	parentSessionId: string;
	parentEntries: readonly FileEntry[];
	manager?: AsyncJobManager;
	registry?: AgentRegistry;
	externalBus?: Pick<IrcExternalBus, "listPeers">;
}

const resumeOperations = new Map<string, Promise<ResumeInterruptedChildResult>>();

function resumeKey(parentSessionFile: string, agentId: string): string {
	return `${path.resolve(parentSessionFile)}\0${agentId}`;
}

function failureReceiptFor(
	receipts: readonly DurableSubagentFailureReceipt[],
	agentId: string,
): DurableSubagentFailureReceipt | undefined {
	return receipts.find(receipt => receipt.agent === agentId);
}

function parentFailureClass(receipt: DurableSubagentFailureReceipt | undefined): string | undefined {
	return receipt?.errorClass;
}

function childOwnerIsLive(
	agentId: string,
	sessionFile: string,
	registry: AgentRegistry,
	manager: AsyncJobManager | undefined,
	externalBus: Pick<IrcExternalBus, "listPeers"> | undefined,
): boolean {
	if (manager?.getJob(agentId)?.status === "running") return true;
	const ref = registry.get(agentId);
	if (ref?.session?.isStreaming) return true;
	const peers = externalBus?.listPeers({ includeStale: true }) ?? [];
	return peers.some(
		peer =>
			peer.agentId === agentId &&
			peer.sessionFile !== undefined &&
			samePath(peer.sessionFile, sessionFile) &&
			peer.processIdentity !== undefined &&
			matchesProcessIdentity(peer.processIdentity),
	);
}

async function durableResumeCandidates(
	parentSessionFile: string,
	parentSessionId: string,
): Promise<DurableResumeCandidate[]> {
	if (!parentSessionFile.endsWith(".jsonl")) return [];
	const childrenDir = parentSessionFile.slice(0, -".jsonl".length);
	let names: string[];
	try {
		names = await fs.readdir(childrenDir);
	} catch {
		return [];
	}
	const candidates: DurableResumeCandidate[] = [];
	for (const name of names) {
		if (!name.endsWith(".jsonl") || name.includes(".bak")) continue;
		const sessionFile = path.join(childrenDir, name);
		let entries: FileEntry[] | null;
		try {
			entries = parseJournal(await fs.readFile(sessionFile, "utf8"));
		} catch {
			continue;
		}
		if (!entries) continue;
		const init = latestInit(entries);
		const metadata = init?.subagent;
		if (
			!init ||
			!isSubagentMetadata(metadata) ||
			typeof init.task !== "string" ||
			!samePath(metadata.parentSessionFile, parentSessionFile) ||
			metadata.parentSessionId !== parentSessionId
		) {
			continue;
		}
		candidates.push({
			sessionFile,
			entries,
			init,
			metadata,
			lifecycle: latestChildLifecycleRecord(entries),
		});
	}
	return candidates;
}

function childDescriptor(candidate: DurableResumeCandidate): ReAdoptedChild {
	const hotswap = [...candidate.entries].reverse().find(
		(entry): entry is ModelChangeEntry => entry.type === "model_change" && entry.role === "hotswap",
	);
	return {
		id: candidate.metadata.agentId,
		task: candidate.init.task,
		displayName: candidate.metadata.displayName,
		sessionFile: candidate.sessionFile,
		model: candidate.lifecycle?.modelId ?? candidate.metadata.model,
		thinkingLevel: candidate.lifecycle?.thinkingLevel ?? candidate.metadata.thinkingLevel,
		...(hotswap && typeof hotswap.model === "string" ? { hotswapModel: hotswap.model } : {}),
		taskDepth: candidate.metadata.taskDepth,
		parentTaskPrefix: candidate.metadata.parentTaskPrefix,
		lifecycleState: candidate.lifecycle?.state ?? "interrupted",
		turnState: "interrupted_by_restart",
	};
}

function resumableErrorText(classification: ChildResumeClassification): string {
	const suffix =
		classification.disposition === "resumable"
			? ' Resume in place with `job {"resume":["<id>"]}`.'
			: "";
	return `${classification.reason}.${suffix}`;
}

/** Durable job projection used when the process-local AsyncJobManager map has been lost. */
export async function listDurableChildJobs(options: DurableChildJobOptions): Promise<DurableChildJobRecord[]> {
	const registry = options.registry ?? AgentRegistry.global();
	const receipts = listDurableSubagentFailureReceipts(options.parentEntries);
	const candidates = await durableResumeCandidates(options.parentSessionFile, options.parentSessionId);
	const counts = new Map<string, number>();
	for (const candidate of candidates)
		counts.set(candidate.metadata.agentId, (counts.get(candidate.metadata.agentId) ?? 0) + 1);
	const records = new Map<string, DurableChildJobRecord>();
	for (const candidate of candidates) {
		const agentId = candidate.metadata.agentId;
		if (counts.get(agentId) !== 1) continue;
		const receipt = failureReceiptFor(receipts, agentId);
		const liveOwner = childOwnerIsLive(
			agentId,
			candidate.sessionFile,
			registry,
			options.manager,
			options.externalBus,
		);
		const classification = classifyChildResumeEvidence({
			journal: candidate.lifecycle === null ? "corrupt" : "usable",
			lifecycle: candidate.lifecycle ?? undefined,
			liveOwner,
			isolated: candidate.metadata.isolated,
			parentFailureClass: parentFailureClass(receipt),
		});
		const status =
			liveOwner || candidate.lifecycle?.state === "running"
				? liveOwner
					? "running"
					: "failed"
				: candidate.lifecycle?.state === "completed"
					? "completed"
					: "failed";
		records.set(agentId, {
			id: agentId,
			label: candidate.metadata.displayName,
			startTime: Date.parse(candidate.init.timestamp),
			status,
			outcome: classification.outcome,
			disposition: classification.disposition,
			...(status === "failed" ? { errorText: resumableErrorText(classification) } : {}),
		});
	}
	for (const receipt of receipts) {
		if (records.has(receipt.agent)) continue;
		const classification = classifyChildResumeEvidence({
			journal: "missing",
			liveOwner: false,
			isolated: false,
			parentFailureClass: receipt.errorClass,
		});
		records.set(receipt.agent, {
			id: receipt.agent,
			label: receipt.agent,
			startTime: receipt.lastTimestamp,
			status: "failed",
			outcome: classification.outcome,
			disposition: receipt.disposition,
			errorText:
				receipt.disposition === "resumable"
					? `${receipt.message} Resume requires the missing child journal; do not respawn until it is recovered.`
					: receipt.message,
		});
	}
	return [...records.values()].sort((left, right) => right.startTime - left.startTime);
}

/** Resume one interrupted direct child from its own append-only journal under the current parent ownership epoch. */
export function resumeInterruptedChild(
	options: ResumeInterruptedChildOptions,
): Promise<ResumeInterruptedChildResult> {
	const key = resumeKey(options.parentSessionFile, options.agentId);
	const existing = resumeOperations.get(key);
	if (existing) return existing;
	const operation = performInterruptedChildResume(options);
	resumeOperations.set(key, operation);
	return operation.finally(() => {
		if (resumeOperations.get(key) === operation) resumeOperations.delete(key);
	});
}

async function performInterruptedChildResume(
	options: ResumeInterruptedChildOptions,
): Promise<ResumeInterruptedChildResult> {
	const transcriptUri = `history://${options.agentId}`;
	const liveJob = options.manager.getJob(options.agentId);
	if (liveJob?.status === "running") {
		return {
			status: "already_running",
			agentId: options.agentId,
			jobId: liveJob.id,
			transcriptUri,
		};
	}
	const ownership = options.parentJournal.getSessionOwnership();
	if (!ownership) {
		return {
			status: "refused",
			agentId: options.agentId,
			reason: "the parent session has no durable ownership handle",
			transcriptUri,
		};
	}
	if (ownership.isFenced?.() || !(await ownership.isCurrent())) {
		return {
			status: "refused",
			agentId: options.agentId,
			reason: `parent ownership epoch ${ownership.ownerEpoch} is not current`,
			transcriptUri,
		};
	}
	const candidates = (await durableResumeCandidates(options.parentSessionFile, options.parentSessionId)).filter(
		candidate => candidate.metadata.agentId === options.agentId,
	);
	if (candidates.length !== 1) {
		const receipt = failureReceiptFor(
			listDurableSubagentFailureReceipts(options.parentJournal.getEntries()),
			options.agentId,
		);
		const classification = classifyChildResumeEvidence({
			journal: "missing",
			liveOwner: false,
			isolated: false,
			parentFailureClass: parentFailureClass(receipt),
		});
		return {
			status: "refused",
			agentId: options.agentId,
			reason:
				candidates.length === 0
					? "no usable direct-child journal exists; the durable failure record remains listed"
					: "multiple child journals claim this stable id",
			transcriptUri,
			classification,
		};
	}
	const candidate = candidates[0];
	const registry = options.registry ?? AgentRegistry.global();
	const lifecycle = options.lifecycle ?? AgentLifecycleManager.global();
	const liveOwner = childOwnerIsLive(
		options.agentId,
		candidate.sessionFile,
		registry,
		undefined,
		options.externalBus,
	);
	const receipt = failureReceiptFor(
		listDurableSubagentFailureReceipts(options.parentJournal.getEntries()),
		options.agentId,
	);
	const classification = classifyChildResumeEvidence({
		journal: candidate.lifecycle === null ? "corrupt" : "usable",
		lifecycle: candidate.lifecycle ?? undefined,
		liveOwner,
		isolated: candidate.metadata.isolated,
		parentFailureClass: parentFailureClass(receipt),
	});
	if (classification.disposition !== "resumable") {
		return {
			status: "refused",
			agentId: options.agentId,
			reason: classification.reason,
			transcriptUri,
			classification,
		};
	}
	const child = childDescriptor(candidate);
	const revive = await options.createReviver(child, candidate.init);
	if (ownership.isFenced?.() || !(await ownership.isCurrent())) {
		return {
			status: "refused",
			agentId: options.agentId,
			reason: `parent ownership epoch ${ownership.ownerEpoch} changed while preparing resume`,
			transcriptUri,
			classification,
		};
	}
	const current = registry.get(child.id);
	if (current?.session?.isStreaming || options.manager.getJob(child.id)?.status === "running") {
		const jobId = options.manager.getJob(child.id)?.id ?? child.id;
		return { status: "already_running", agentId: child.id, jobId, transcriptUri };
	}
	if (!current || !samePath(current.sessionFile ?? "", candidate.sessionFile)) {
		registry.register({
			id: child.id,
			displayName: child.displayName,
			kind: "sub",
			parentId: MAIN_AGENT_ID,
			session: null,
			sessionFile: candidate.sessionFile,
			status: "parked",
			recovery: {
				task: child.task,
				model: child.model,
				thinkingLevel: child.thinkingLevel,
				hotswapModel: child.hotswapModel,
				turnState: child.turnState,
			},
		});
	} else if (!current.session) {
		registry.setStatus(child.id, "parked");
	}
	lifecycle.adopt(child.id, { idleTtlMs: options.idleTtlMs, revive });
	const session = await lifecycle.ensureLive(child.id);
	if (ownership.isFenced?.() || !(await ownership.isCurrent())) {
		return {
			status: "refused",
			agentId: options.agentId,
			reason: `parent ownership epoch ${ownership.ownerEpoch} changed before resume registration`,
			transcriptUri,
			classification,
		};
	}
	appendChildLifecycleRecord(session.sessionManager, {
		version: 1,
		agentId: child.id,
		childSessionFile: child.sessionFile,
		parentSessionFile: options.parentSessionFile,
		state: "running",
		updatedAt: new Date().toISOString(),
		...(session.model ? { modelId: `${session.model.provider}/${session.model.id}` } : {}),
		...(session.thinkingLevel === undefined ? {} : { thinkingLevel: session.thinkingLevel }),
	});
	await session.sessionManager.flush();
	const jobId = await options.startTurn(child, session);
	const assignment = candidate.metadata.spawnRecord?.assignment ?? candidate.init.task;
	return {
		status: "started",
		agentId: child.id,
		jobId,
		transcriptUri,
		assignment,
		classification,
	};
}
