import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, isEnoent, parseJsonlLenient } from "@oh-my-pi/pi-utils";
import { getActiveProfile } from "@oh-my-pi/pi-utils/dirs";
import { IrcExternalBus, type IrcExternalPeer } from "../irc/bus-external";
import { SessionControlBus, stopConfirmationToken } from "../session/session-control";
import { deriveSessionStatus, type SessionStatus } from "../session/session-listing";
import { type ProcessIdentity, readProcessIdentity } from "./process-identity";
import { readProcessGroupId } from "./ps-command";
import { inspectSessionOwnership } from "../session/session-ownership";

export const IDLE_RECLAIMER_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
export const IDLE_RECLAIMER_THRESHOLD_MS = 6 * 60 * 60 * 1000;
export const IDLE_RECLAIMER_RECEIPTS_FILENAME = "idle-reclaimer-receipts.jsonl";
const JOURNAL_TAIL_BYTES = 64 * 1024;
const DEFAULT_GRACEFUL_EXIT_MS = 2_000;
const DEFAULT_SIGNAL_EXIT_MS = 5_000;

export type IdleReclaimerSkipReason =
	| "peer-not-idle"
	| "missing-session-file"
	| "missing-owner-epoch"
	| "journal-unreadable"
	| "journal-recent"
	| "journal-busy"
	| "control-store-unavailable"
	| "control-owner-mismatch"
	| "admission-store-unavailable"
	| "child-attempts-active"
	| "host-owner-unverified";

export interface IdleReclaimerSkip {
	readonly sessionId: string;
	readonly reason: IdleReclaimerSkipReason;
}

export interface IdleSessionRelaunch {
	readonly argv: readonly string[];
	readonly command: string;
}

export interface VerifiedIdleSessionProcess {
	readonly identity: ProcessIdentity;
	readonly processGroupId: number;
}

export interface IdleReclaimerCandidate {
	readonly peer: IrcExternalPeer;
	readonly sessionFile: string;
	readonly ownerEpoch: string;
	readonly lastActivityMs: number;
	readonly journalStatus: Exclude<SessionStatus, "pending" | "unknown">;
	readonly process: VerifiedIdleSessionProcess;
}

export interface IdleReclaimerStopPlan {
	readonly commandId: string;
	readonly confirmationToken: string;
}

export interface IdleReclaimerStopResult {
	readonly applied: boolean;
	readonly state: "applied" | "failed";
	readonly error?: string;
}

export type IdleReclaimerTermination = "graceful-control" | "sigterm" | "sigkill";

export interface IdleReclaimerSweepResult {
	readonly sweepId: string;
	readonly enabled: boolean;
	readonly selected: readonly string[];
	readonly reclaimed: readonly string[];
	readonly skipped: readonly IdleReclaimerSkip[];
	readonly receiptPath: string;
}

interface SessionReceiptBase {
	readonly version: 1;
	readonly type: "idle-reclaimer-session";
	readonly receiptId: string;
	readonly sweepId: string;
	readonly recordedAt: string;
	readonly sessionId: string;
	readonly sessionFile: string;
	readonly cwd: string;
	readonly ownerEpoch: string;
	readonly lastActivityAt: string;
	readonly journalStatus: Exclude<SessionStatus, "pending" | "unknown">;
	readonly resume: IdleSessionRelaunch;
	readonly commands: {
		readonly gracefulStop: string;
		readonly terminate: readonly [string, string];
	};
}

export type IdleReclaimerSessionReceipt = SessionReceiptBase &
	(
		| { readonly event: "checkpointed" }
		| {
				readonly event: "reclaimed";
				readonly checkpointReceiptId: string;
				readonly termination: IdleReclaimerTermination;
		  }
		| {
				readonly event: "failed";
				readonly checkpointReceiptId: string;
				readonly error: string;
		  }
	);

interface IdleReclaimerSweepReceipt {
	readonly version: 1;
	readonly type: "idle-reclaimer-sweep";
	readonly receiptId: string;
	readonly sweepId: string;
	readonly recordedAt: string;
	readonly enabled: boolean;
	readonly thresholdMs: number;
	readonly selected: readonly string[];
	readonly reclaimed: readonly string[];
	readonly skipped: readonly IdleReclaimerSkip[];
}

export interface IdleReclaimerSweepOptions {
	readonly enabled?: boolean;
	readonly agentDir?: string;
	readonly ircDbPath?: string;
	readonly controlDbPath?: string;
	readonly admissionDbPath?: string;
	readonly ownershipRoot?: string;
	readonly profile?: string;
	readonly nowMs?: () => number;
	readonly idleThresholdMs?: number;
	readonly controlTimeoutMs?: number;
	readonly gracefulExitMs?: number;
	readonly signalExitMs?: number;
	readonly verifyHostOwnership?: (peer: IrcExternalPeer) => Promise<VerifiedIdleSessionProcess | undefined>;
	readonly requestGracefulStop?: (
		candidate: IdleReclaimerCandidate,
		plan: IdleReclaimerStopPlan,
	) => Promise<IdleReclaimerStopResult>;
	readonly terminateProcessGroup?: (
		candidate: IdleReclaimerCandidate,
		admissionDbPath: string,
	) => Promise<IdleReclaimerTermination>;
}

export interface ResumeIdleSessionOptions {
	readonly agentDir?: string;
	readonly execute?: boolean;
	readonly write?: (text: string) => void;
	readonly launch?: (argv: readonly string[], cwd: string) => Promise<number>;
}

export interface ResumeIdleSessionResult {
	readonly receipt: IdleReclaimerSessionReceipt;
	readonly exitCode?: number;
}

interface JournalState {
	readonly lastActivityMs: number;
	readonly status: SessionStatus;
}

interface AdmissionState {
	readonly activeAttempts: number;
}

interface EvaluationOptions {
	readonly nowMs: number;
	readonly idleThresholdMs: number;
	readonly controlDbPath: string;
	readonly admissionDbPath: string;
	readonly verifyHostOwnership: (peer: IrcExternalPeer) => Promise<VerifiedIdleSessionProcess | undefined>;
}

type CandidateEvaluation = { readonly candidate: IdleReclaimerCandidate } | { readonly skip: IdleReclaimerSkip };

interface CountRow {
	readonly count: number;
}

interface TableRow {
	readonly name: string;
}

function shellQuote(value: string): string {
	if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function buildIdleSessionRelaunch(
	sessionFile: string,
	cwd: string,
	profile: string | undefined = getActiveProfile(),
): IdleSessionRelaunch {
	const argv = ["omp", ...(profile ? ["--profile", profile] : []), "launch", "--cwd", cwd, "--resume", sessionFile];
	return { argv, command: argv.map(shellQuote).join(" ") };
}

export function getIdleReclaimerReceiptPath(agentDir: string = getAgentDir()): string {
	return path.join(agentDir, IDLE_RECLAIMER_RECEIPTS_FILENAME);
}

async function appendReceipt(
	receipt: IdleReclaimerSessionReceipt | IdleReclaimerSweepReceipt,
	receiptPath: string,
): Promise<void> {
	await fs.mkdir(path.dirname(receiptPath), { recursive: true });
	await fs.appendFile(receiptPath, `${JSON.stringify(receipt)}\n`, "utf8");
}

function lastUserInputAtMs(tail: string): number | undefined {
	const lines = tail.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (line.charCodeAt(0) !== 123) continue;
		try {
			const entry = JSON.parse(line) as {
				readonly type?: string;
				readonly timestamp?: string;
				readonly message?: { readonly role?: string };
			};
			if (entry.type !== "message" || entry.message?.role !== "user" || !entry.timestamp) continue;
			const timestamp = Date.parse(entry.timestamp);
			if (Number.isFinite(timestamp)) return timestamp;
		} catch {
			// The first line of a bounded tail may be a partial JSONL record.
		}
	}
	return undefined;
}

async function readJournalState(sessionFile: string): Promise<JournalState | undefined> {
	try {
		const stat = await fs.stat(sessionFile);
		if (!stat.isFile()) return undefined;
		const start = Math.max(0, stat.size - JOURNAL_TAIL_BYTES);
		const tail = await Bun.file(sessionFile).slice(start, stat.size).text();
		return {
			lastActivityMs: Math.max(stat.mtimeMs, lastUserInputAtMs(tail) ?? 0),
			status: deriveSessionStatus(tail),
		};
	} catch {
		return undefined;
	}
}

function tableExists(db: Database, table: string): boolean {
	return (
		db
			.query<TableRow, { $table: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=$table")
			.get({ $table: table }) !== null
	);
}

function readAdmissionState(dbPath: string, sessionId: string): AdmissionState | undefined {
	let db: Database | undefined;
	try {
		db = new Database(dbPath, { readonly: true });
		if (!tableExists(db, "resource_leases") || !tableExists(db, "resource_waiters")) return undefined;
		const leases = db
			.query<CountRow, { $sessionId: string }>(
				"SELECT COUNT(*) AS count FROM resource_leases WHERE session_id=$sessionId",
			)
			.get({ $sessionId: sessionId });
		const waiters = db
			.query<CountRow, { $sessionId: string }>(
				"SELECT COUNT(*) AS count FROM resource_waiters WHERE session_id=$sessionId",
			)
			.get({ $sessionId: sessionId });
		if (!leases || !waiters || !Number.isSafeInteger(leases.count) || !Number.isSafeInteger(waiters.count))
			return undefined;
		return { activeAttempts: leases.count + waiters.count };
	} catch {
		return undefined;
	} finally {
		db?.close();
	}
}

function readControlOwner(dbPath: string, sessionId: string): string | null | undefined {
	let db: Database | undefined;
	try {
		db = new Database(dbPath, { readonly: true });
		if (!tableExists(db, "control_targets")) return undefined;
		const row = db
			.query<{ readonly owner_epoch: string }, { $sessionId: string }>(
				"SELECT owner_epoch FROM control_targets WHERE session_id=$sessionId",
			)
			.get({ $sessionId: sessionId });
		return row?.owner_epoch ?? null;
	} catch {
		return undefined;
	} finally {
		db?.close();
	}
}

function processGroupId(pid: number): number | undefined {
	return readProcessGroupId(pid);
}

function processIdentityFor(pid: number): ProcessIdentity | undefined {
	return readProcessIdentity(pid) ?? undefined;
}

function matchesProcessIdentity(identity: ProcessIdentity): boolean {
	const current = processIdentityFor(identity.pid);
	return (
		current !== undefined &&
		current.bootId === identity.bootId &&
		current.startFingerprint === identity.startFingerprint
	);
}

async function waitForProcessExit(identity: ProcessIdentity, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + Math.max(0, timeoutMs);
	while (matchesProcessIdentity(identity)) {
		if (Date.now() >= deadline) return false;
		await Bun.sleep(Math.min(50, Math.max(1, deadline - Date.now())));
	}
	return true;
}

async function defaultVerifyHostOwnership(
	peer: IrcExternalPeer,
	ownershipRoot: string | undefined,
): Promise<VerifiedIdleSessionProcess | undefined> {
	if (!peer.sessionFile || !peer.ownerEpoch || process.platform === "win32") return undefined;
	const ownership = await inspectSessionOwnership(peer.sessionFile, peer.sessionId, { root: ownershipRoot });
	if (
		ownership.status !== "live" ||
		ownership.lease.ownerKind !== "omp" ||
		ownership.lease.ownerEpoch !== peer.ownerEpoch ||
		ownership.lease.controllerProcess.pid !== peer.pid
	)
		return undefined;
	const pgid = processGroupId(peer.pid);
	const currentPgid = processGroupId(process.pid);
	if (pgid === undefined || pgid === currentPgid) return undefined;
	return { identity: ownership.lease.controllerProcess, processGroupId: pgid };
}

async function evaluatePeer(peer: IrcExternalPeer, options: EvaluationOptions): Promise<CandidateEvaluation> {
	const skip = (reason: IdleReclaimerSkipReason): CandidateEvaluation => ({
		skip: { sessionId: peer.sessionId, reason },
	});
	if (peer.state !== "idle") return skip("peer-not-idle");
	if (!peer.sessionFile) return skip("missing-session-file");
	if (!peer.ownerEpoch) return skip("missing-owner-epoch");
	const journal = await readJournalState(peer.sessionFile);
	if (!journal) return skip("journal-unreadable");
	if (options.nowMs - journal.lastActivityMs <= options.idleThresholdMs) return skip("journal-recent");
	if (journal.status === "pending" || journal.status === "unknown") return skip("journal-busy");
	const controlOwner = readControlOwner(options.controlDbPath, peer.sessionId);
	if (controlOwner === undefined) return skip("control-store-unavailable");
	if (controlOwner !== peer.ownerEpoch) return skip("control-owner-mismatch");
	const admission = readAdmissionState(options.admissionDbPath, peer.sessionId);
	if (!admission) return skip("admission-store-unavailable");
	if (admission.activeAttempts > 0) return skip("child-attempts-active");
	const verifiedProcess = await options.verifyHostOwnership(peer);
	if (!verifiedProcess) return skip("host-owner-unverified");
	return {
		candidate: {
			peer,
			sessionFile: peer.sessionFile,
			ownerEpoch: peer.ownerEpoch,
			lastActivityMs: journal.lastActivityMs,
			journalStatus: journal.status,
			process: verifiedProcess,
		},
	};
}

async function defaultRequestGracefulStop(
	candidate: IdleReclaimerCandidate,
	plan: IdleReclaimerStopPlan,
	controlDbPath: string,
	nowMs: number,
	timeoutMs: number,
): Promise<IdleReclaimerStopResult> {
	const bus = new SessionControlBus(controlDbPath);
	try {
		const uid = process.getuid?.();
		bus.request({
			schemaVersion: 1,
			commandId: plan.commandId,
			source: {
				kind: "local-cli",
				instanceId: randomUUID(),
				pid: process.pid,
				...(uid === undefined ? {} : { uid }),
			},
			sessionId: candidate.peer.sessionId,
			targetOwnerEpoch: candidate.ownerEpoch,
			requestedAt: new Date(nowMs).toISOString(),
			intent: { kind: "stop", confirmationToken: plan.confirmationToken },
		});
		const receipt = await bus.waitForTerminal(plan.commandId, { timeoutMs });
		return receipt.state === "applied"
			? { applied: true, state: "applied" }
			: { applied: false, state: "failed", error: receipt.error ?? "Session rejected graceful stop" };
	} finally {
		bus.close();
	}
}

async function defaultTerminateProcessGroup(
	candidate: IdleReclaimerCandidate,
	admissionDbPath: string,
	gracefulExitMs: number,
	signalExitMs: number,
): Promise<IdleReclaimerTermination> {
	if (await waitForProcessExit(candidate.process.identity, gracefulExitMs)) return "graceful-control";
	const admission = readAdmissionState(admissionDbPath, candidate.peer.sessionId);
	if (!admission || admission.activeAttempts > 0) {
		throw new Error("Child-attempt state changed after graceful stop; refusing to signal the process group");
	}
	if (
		!matchesProcessIdentity(candidate.process.identity) ||
		processGroupId(candidate.process.identity.pid) !== candidate.process.processGroupId
	) {
		throw new Error("Session process identity changed after graceful stop; refusing to signal the process group");
	}
	process.kill(-candidate.process.processGroupId, "SIGTERM");
	if (await waitForProcessExit(candidate.process.identity, signalExitMs)) return "sigterm";
	if (
		!matchesProcessIdentity(candidate.process.identity) ||
		processGroupId(candidate.process.identity.pid) !== candidate.process.processGroupId
	) {
		throw new Error("Session process identity changed before SIGKILL; refusing to signal the process group");
	}
	process.kill(-candidate.process.processGroupId, "SIGKILL");
	return "sigkill";
}

function sessionReceiptBase(
	candidate: IdleReclaimerCandidate,
	sweepId: string,
	receiptId: string,
	recordedAt: string,
	profile: string | undefined,
	plan: IdleReclaimerStopPlan,
): SessionReceiptBase {
	const pgid = candidate.process.processGroupId;
	return {
		version: 1,
		type: "idle-reclaimer-session",
		receiptId,
		sweepId,
		recordedAt,
		sessionId: candidate.peer.sessionId,
		sessionFile: candidate.sessionFile,
		cwd: candidate.peer.cwd,
		ownerEpoch: candidate.ownerEpoch,
		lastActivityAt: new Date(candidate.lastActivityMs).toISOString(),
		journalStatus: candidate.journalStatus,
		resume: buildIdleSessionRelaunch(candidate.sessionFile, candidate.peer.cwd, profile),
		commands: {
			gracefulStop: `session-control stop ${shellQuote(candidate.peer.sessionId)} --owner-epoch ${shellQuote(candidate.ownerEpoch)} --command-id ${plan.commandId}`,
			terminate: [`/bin/kill -TERM -- -${pgid}`, `/bin/kill -KILL -- -${pgid}`],
		},
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function runIdleReclaimerSweep(
	options: IdleReclaimerSweepOptions = {},
): Promise<IdleReclaimerSweepResult> {
	const sweepId = randomUUID();
	const enabled = options.enabled ?? false;
	const agentDir = options.agentDir ?? getAgentDir();
	const receiptPath = getIdleReclaimerReceiptPath(agentDir);
	const nowMs = (options.nowMs ?? Date.now)();
	const recordedAt = new Date(nowMs).toISOString();
	const idleThresholdMs = options.idleThresholdMs ?? IDLE_RECLAIMER_THRESHOLD_MS;
	const selected: string[] = [];
	const reclaimed: string[] = [];
	const skipped: IdleReclaimerSkip[] = [];
	if (!enabled) {
		await appendReceipt(
			{
				version: 1,
				type: "idle-reclaimer-sweep",
				receiptId: randomUUID(),
				sweepId,
				recordedAt,
				enabled,
				thresholdMs: idleThresholdMs,
				selected,
				reclaimed,
				skipped,
			},
			receiptPath,
		);
		return { sweepId, enabled, selected, reclaimed, skipped, receiptPath };
	}

	const ircDbPath = options.ircDbPath ?? path.join(agentDir, "irc-bus.sqlite");
	const controlDbPath =
		options.controlDbPath ?? process.env.OMP_SESSION_CONTROL_DB ?? path.join(agentDir, "session-control.sqlite");
	const admissionDbPath = options.admissionDbPath ?? ircDbPath;
	const verifyHostOwnership =
		options.verifyHostOwnership ?? (peer => defaultVerifyHostOwnership(peer, options.ownershipRoot));
	const evaluationOptions: EvaluationOptions = {
		nowMs,
		idleThresholdMs,
		controlDbPath,
		admissionDbPath,
		verifyHostOwnership,
	};
	let peers: readonly IrcExternalPeer[] = [];
	let bus: IrcExternalBus | undefined;
	try {
		bus = new IrcExternalBus(ircDbPath, { readonly: true });
		peers = bus.listPeers({ includeStale: true });
	} catch {
		peers = [];
	} finally {
		bus?.close();
	}

	for (const peer of peers) {
		const initial = await evaluatePeer(peer, evaluationOptions);
		if ("skip" in initial) {
			skipped.push(initial.skip);
			continue;
		}
		// Re-read every durable fence immediately before checkpointing. A user turn,
		// child admission, owner handoff, or journal append that raced the scan wins.
		const revalidated = await evaluatePeer(peer, evaluationOptions);
		if ("skip" in revalidated) {
			skipped.push(revalidated.skip);
			continue;
		}
		const candidate = revalidated.candidate;
		selected.push(peer.sessionId);
		const plan: IdleReclaimerStopPlan = {
			commandId: randomUUID(),
			confirmationToken: stopConfirmationToken(peer.sessionId, candidate.ownerEpoch),
		};
		const checkpointReceiptId = randomUUID();
		const base = sessionReceiptBase(
			candidate,
			sweepId,
			checkpointReceiptId,
			recordedAt,
			options.profile ?? getActiveProfile(),
			plan,
		);
		await appendReceipt({ ...base, event: "checkpointed" }, receiptPath);
		try {
			const stop = options.requestGracefulStop
				? await options.requestGracefulStop(candidate, plan)
				: await defaultRequestGracefulStop(
						candidate,
						plan,
						controlDbPath,
						nowMs,
						options.controlTimeoutMs ?? 30_000,
					);
			if (!stop.applied) throw new Error(stop.error ?? "Session rejected graceful stop");
			const termination = options.terminateProcessGroup
				? await options.terminateProcessGroup(candidate, admissionDbPath)
				: await defaultTerminateProcessGroup(
						candidate,
						admissionDbPath,
						options.gracefulExitMs ?? DEFAULT_GRACEFUL_EXIT_MS,
						options.signalExitMs ?? DEFAULT_SIGNAL_EXIT_MS,
					);
			reclaimed.push(peer.sessionId);
			await appendReceipt(
				{
					...base,
					receiptId: randomUUID(),
					event: "reclaimed",
					checkpointReceiptId,
					termination,
				},
				receiptPath,
			);
		} catch (error) {
			await appendReceipt(
				{
					...base,
					receiptId: randomUUID(),
					event: "failed",
					checkpointReceiptId,
					error: errorMessage(error),
				},
				receiptPath,
			);
		}
	}

	await appendReceipt(
		{
			version: 1,
			type: "idle-reclaimer-sweep",
			receiptId: randomUUID(),
			sweepId,
			recordedAt,
			enabled,
			thresholdMs: idleThresholdMs,
			selected,
			reclaimed,
			skipped,
		},
		receiptPath,
	);
	return { sweepId, enabled, selected, reclaimed, skipped, receiptPath };
}

function decodeSessionReceipt(value: Record<string, unknown>): IdleReclaimerSessionReceipt | undefined {
	if (
		value.version !== 1 ||
		value.type !== "idle-reclaimer-session" ||
		(value.event !== "checkpointed" && value.event !== "reclaimed" && value.event !== "failed") ||
		typeof value.receiptId !== "string" ||
		typeof value.sweepId !== "string" ||
		typeof value.recordedAt !== "string" ||
		typeof value.sessionId !== "string" ||
		typeof value.sessionFile !== "string" ||
		typeof value.cwd !== "string" ||
		typeof value.ownerEpoch !== "string" ||
		typeof value.lastActivityAt !== "string" ||
		(value.journalStatus !== "complete" &&
			value.journalStatus !== "interrupted" &&
			value.journalStatus !== "aborted" &&
			value.journalStatus !== "error") ||
		typeof value.resume !== "object" ||
		value.resume === null ||
		Array.isArray(value.resume)
	)
		return undefined;
	const resume = value.resume as Record<string, unknown>;
	if (
		!Array.isArray(resume.argv) ||
		!resume.argv.every(argument => typeof argument === "string") ||
		resume.argv.length === 0 ||
		typeof resume.command !== "string"
	)
		return undefined;
	return value as unknown as IdleReclaimerSessionReceipt;
}

export async function readIdleReclaimerSessionReceipts(
	agentDir: string = getAgentDir(),
): Promise<IdleReclaimerSessionReceipt[]> {
	try {
		const content = await fs.readFile(getIdleReclaimerReceiptPath(agentDir), "utf8");
		return parseJsonlLenient<Record<string, unknown>>(content)
			.map(decodeSessionReceipt)
			.filter((receipt): receipt is IdleReclaimerSessionReceipt => receipt !== undefined);
	} catch (error) {
		if (isEnoent(error)) return [];
		throw error;
	}
}

export async function resolveIdleSessionResumeReceipt(
	selector: string,
	agentDir: string = getAgentDir(),
): Promise<IdleReclaimerSessionReceipt> {
	const normalized = selector.trim();
	if (!normalized) throw new Error("Session id is required");
	const receipts = await readIdleReclaimerSessionReceipts(agentDir);
	const sessionIds = [...new Set(receipts.map(receipt => receipt.sessionId))];
	const exact = sessionIds.find(sessionId => sessionId === normalized);
	const matches = exact ? [exact] : sessionIds.filter(sessionId => sessionId.startsWith(normalized));
	if (matches.length === 0) throw new Error(`No idle-reclaimer receipt matches session ${normalized}`);
	if (matches.length > 1) throw new Error(`Session prefix ${normalized} is ambiguous: ${matches.join(", ")}`);
	const sessionId = matches[0];
	const receipt = receipts.findLast(candidate => candidate.sessionId === sessionId);
	if (!receipt) throw new Error(`No idle-reclaimer receipt matches session ${normalized}`);
	return receipt;
}

async function launchResume(argv: readonly string[], cwd: string): Promise<number> {
	const child = Bun.spawn({
		cmd: [...argv],
		cwd,
		env: process.env,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	return child.exited;
}

export async function resumeIdleSession(
	selector: string,
	options: ResumeIdleSessionOptions = {},
): Promise<ResumeIdleSessionResult> {
	const receipt = await resolveIdleSessionResumeReceipt(selector, options.agentDir);
	(options.write ?? (text => process.stdout.write(text)))(`${receipt.resume.command}\n`);
	if (options.execute === false) return { receipt };
	const exitCode = await (options.launch ?? launchResume)(receipt.resume.argv, receipt.cwd);
	return { receipt, exitCode };
}
