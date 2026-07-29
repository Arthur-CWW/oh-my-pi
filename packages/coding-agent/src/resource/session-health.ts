import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-utils";
import { IrcExternalBus, type IrcExternalPeer, resolveIrcExternalDbPath } from "../irc/bus-external";
import { decodeHead, decodeRecord, type QueueHead, type QueueRecord } from "../session/durable-queue-record-codec";
import { SESSION_CONTROL_DB_PATH } from "../session/session-control";
import { inspectLiveSessionOwnerView, resolveAgentMuxRoot } from "../session/session-ownership";
import { sampleLeaseProcessTrees } from "./host-resource-sampler";
import { type IdleReclaimerSessionReceipt, readIdleReclaimerSessionReceipts } from "./idle-reclaimer";
import { matchesProcessIdentity, type ProcessIdentity, readProcessIdentity } from "./process-identity";

const QUEUE_HEAD_FILE = "head.json";
const QUEUE_HEADS_DIR = "heads";
const QUEUE_SEGMENTS_DIR = "segments";
const PENDING_INPUT_STATES: Readonly<Record<string, true>> = {
	queued: true,
	admitted: true,
	running: true,
	uncertain: true,
	"failed-rate-limit": true,
};

export type SessionHealthState = "working" | "waiting-input" | "idle" | "parked" | "orphaned";
export type SessionHealthClassification =
	| "ok"
	| "parked"
	| "orphaned-row"
	| "unregistered"
	| "orphaned-control"
	| "owner-mismatch";

export interface SessionHealthProcess {
	readonly pid: number | null;
	readonly alive: boolean;
	readonly fingerprint: string | null;
	readonly fingerprintMatched: boolean | null;
}

export interface SessionHealthOwner {
	readonly cwd: string | null;
	readonly cmuxWorkspaceId: string | null;
	readonly cmuxSurfaceId: string | null;
}

export interface SessionHealthRow {
	readonly sessionId: string;
	readonly name: string | null;
	readonly classification: SessionHealthClassification;
	readonly state: SessionHealthState;
	readonly process: SessionHealthProcess;
	readonly currentTurnActive: boolean;
	readonly lastJournalWriteAgeMs: number | null;
	readonly pendingDurableInputs: number | null;
	readonly childAttemptsHeld: number;
	readonly rssBytes: number | null;
	readonly buildDigest: string | null;
	readonly journalPath: string | null;
	readonly owner: SessionHealthOwner;
	readonly evidenceWarnings: readonly string[];
}

export interface SessionHealthReport {
	readonly schemaVersion: 1;
	readonly generatedAt: string;
	readonly sessions: readonly SessionHealthRow[];
}

export interface SessionHealthOptions {
	readonly ircDbPath?: string;
	readonly controlDbPath?: string;
	readonly admissionDbPath?: string;
	readonly agentDir?: string;
	readonly ownershipRoot?: string;
	readonly nowMs?: number;
}

interface ControlRow {
	readonly session_id: string;
	readonly owner_epoch: string;
	readonly paused: number | null;
}

interface ControlEvidence {
	readonly sessionId: string;
	readonly ownerEpoch: string;
	readonly paused: boolean;
}

interface AdmissionLeaseRow {
	readonly session_id: string;
	readonly session_owner_epoch: string | null;
	readonly holder_boot_id: string;
	readonly holder_pid: number;
	readonly holder_start_fingerprint: string;
}

interface AdmissionWaiterRow {
	readonly session_id: string;
	readonly session_owner_epoch: string | null;
	readonly holder_boot_id: string;
	readonly holder_pid: number;
	readonly holder_start_fingerprint: string;
}

interface AdmissionEvidence {
	readonly sessionId: string;
	readonly ownerEpoch: string | null;
	readonly processIdentity: ProcessIdentity;
	readonly held: boolean;
}

interface JournalEvidence {
	readonly ageMs: number | null;
	readonly pendingInputs: number | null;
	readonly warnings: readonly string[];
}

function isEnoent(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function tableExists(db: Database, table: string): boolean {
	return (
		db
			.query<{ readonly present: number }, string>(
				"SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
			)
			.get(table) !== null
	);
}

function readControlEvidence(dbPath: string): readonly ControlEvidence[] {
	let db: Database | undefined;
	try {
		db = new Database(dbPath, { readonly: true });
		db.run("PRAGMA busy_timeout = 3000");
		if (!tableExists(db, "control_targets")) return [];
		const hasState = tableExists(db, "control_state");
		const rows = db
			.query<ControlRow, []>(
				hasState
					? `SELECT t.session_id, t.owner_epoch, s.paused
						 FROM control_targets t
						 LEFT JOIN control_state s ON s.session_id=t.session_id AND s.owner_epoch=t.owner_epoch
						 ORDER BY t.session_id`
					: "SELECT session_id, owner_epoch, NULL AS paused FROM control_targets ORDER BY session_id",
			)
			.all();
		return rows.map(row => ({ sessionId: row.session_id, ownerEpoch: row.owner_epoch, paused: row.paused === 1 }));
	} catch {
		return [];
	} finally {
		db?.close();
	}
}

function processIdentityFromAdmission(row: AdmissionLeaseRow | AdmissionWaiterRow): ProcessIdentity {
	return {
		bootId: row.holder_boot_id,
		pid: row.holder_pid,
		startFingerprint: row.holder_start_fingerprint,
	};
}

function readAdmissionEvidence(dbPath: string): readonly AdmissionEvidence[] {
	let db: Database | undefined;
	try {
		db = new Database(dbPath, { readonly: true });
		db.run("PRAGMA busy_timeout = 3000");
		const out: AdmissionEvidence[] = [];
		if (tableExists(db, "resource_leases")) {
			const rows = db
				.query<AdmissionLeaseRow, []>(
					`SELECT session_id, session_owner_epoch, holder_boot_id, holder_pid, holder_start_fingerprint
					 FROM resource_leases WHERE state='active' ORDER BY acquired_at_ms, fence_token`,
				)
				.all();
			for (const row of rows) {
				out.push({
					sessionId: row.session_id,
					ownerEpoch: row.session_owner_epoch,
					processIdentity: processIdentityFromAdmission(row),
					held: true,
				});
			}
		}
		if (tableExists(db, "resource_waiters")) {
			const rows = db
				.query<AdmissionWaiterRow, []>(
					`SELECT session_id, session_owner_epoch, holder_boot_id, holder_pid, holder_start_fingerprint
					 FROM resource_waiters WHERE rejection_reason IS NULL ORDER BY ticket`,
				)
				.all();
			for (const row of rows) {
				out.push({
					sessionId: row.session_id,
					ownerEpoch: row.session_owner_epoch,
					processIdentity: processIdentityFromAdmission(row),
					held: false,
				});
			}
		}
		return out;
	} catch {
		return [];
	} finally {
		db?.close();
	}
}

async function canonicalSessionFile(sessionFile: string): Promise<string> {
	const resolved = path.resolve(sessionFile);
	try {
		return await fs.realpath(resolved);
	} catch (error) {
		if (!isEnoent(error)) throw error;
		return path.join(await fs.realpath(path.dirname(resolved)), path.basename(resolved));
	}
}

function queueKey(sessionFile: string, sessionId: string): string {
	return createHash("sha256").update(sessionFile).update("\0").update(sessionId).digest("hex");
}

async function readQueueHead(file: string): Promise<QueueHead | undefined> {
	try {
		const head = decodeHead(JSON.parse(await fs.readFile(file, "utf8")));
		if (!head) throw new Error(`Invalid durable input queue head: ${file}`);
		return head;
	} catch (error) {
		if (isEnoent(error)) return undefined;
		throw error;
	}
}

async function readQueueSegment(file: string, maxBytes?: number): Promise<readonly QueueRecord[]> {
	let content: string;
	try {
		content = await fs.readFile(file, "utf8");
	} catch (error) {
		if (isEnoent(error)) return [];
		throw error;
	}
	if (maxBytes !== undefined) content = content.slice(0, Math.max(0, maxBytes));
	const partialTail = !content.endsWith("\n");
	const lines = content.split("\n");
	const records: QueueRecord[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line) continue;
		let record: QueueRecord | undefined;
		try {
			record = decodeRecord(JSON.parse(line));
		} catch {}
		if (record) {
			records.push(record);
			continue;
		}
		if (partialTail && index === lines.length - 1) continue;
		throw new Error(`Invalid durable input queue record: ${file}:${index + 1}`);
	}
	return records;
}

async function countPendingDurableInputs(
	sessionFile: string,
	sessionId: string,
	ownershipRoot?: string,
): Promise<number> {
	const canonical = await canonicalSessionFile(sessionFile);
	const queueRoot = path.join(
		resolveAgentMuxRoot(ownershipRoot),
		"owners-v1",
		queueKey(canonical, sessionId),
		"queue-v3",
	);
	let head = await readQueueHead(path.join(queueRoot, QUEUE_HEAD_FILE));
	if (!head) return 0;
	let boundary: number | undefined;
	const epochs: { readonly epoch: string; readonly boundary?: number }[] = [];
	while (head) {
		epochs.unshift({ epoch: head.epoch, boundary });
		boundary = head.predecessorBytes;
		if (!head.predecessor) break;
		head = await readQueueHead(path.join(queueRoot, QUEUE_HEADS_DIR, `${head.predecessor}.json`));
		if (!head) throw new Error("Durable input queue predecessor head is missing");
	}
	const states = new Map<string, string>();
	for (const epoch of epochs) {
		const records = await readQueueSegment(
			path.join(queueRoot, QUEUE_SEGMENTS_DIR, `${epoch.epoch}.jsonl`),
			epoch.boundary,
		);
		for (const record of records) {
			switch (record.type) {
				case "enqueue":
					if (!states.has(record.id)) states.set(record.id, "queued");
					break;
				case "state":
					if (states.has(record.id)) states.set(record.id, record.state);
					break;
				case "attempt":
					if (states.has(record.inputId)) states.set(record.inputId, "admitted");
					break;
				case "request-start":
					if (states.has(record.inputId)) states.set(record.inputId, "running");
					break;
				case "terminal":
					if (states.has(record.inputId)) states.set(record.inputId, record.state);
					break;
				case "requeue":
					if (states.has(record.inputId)) states.set(record.inputId, "queued");
					break;
				case "revision":
				case "adopt":
					break;
			}
		}
	}
	let pending = 0;
	for (const state of states.values()) {
		if (PENDING_INPUT_STATES[state]) pending += 1;
	}
	return pending;
}

async function readJournalEvidence(
	sessionFile: string | undefined,
	sessionId: string,
	nowMs: number,
	ownershipRoot?: string,
): Promise<JournalEvidence> {
	if (!sessionFile) return { ageMs: null, pendingInputs: null, warnings: ["journal-path-missing"] };
	let ageMs: number | null = null;
	const warnings: string[] = [];
	try {
		const stat = await fs.stat(sessionFile);
		if (!stat.isFile()) warnings.push("journal-not-a-file");
		else ageMs = Math.max(0, nowMs - stat.mtimeMs);
	} catch (error) {
		warnings.push(isEnoent(error) ? "journal-missing" : "journal-unreadable");
	}
	let pendingInputs: number | null = null;
	try {
		pendingInputs = await countPendingDurableInputs(sessionFile, sessionId, ownershipRoot);
	} catch {
		warnings.push("durable-inputs-unreadable");
	}
	return { ageMs, pendingInputs, warnings };
}

function latestReceiptsBySession(
	receipts: readonly IdleReclaimerSessionReceipt[],
): ReadonlyMap<string, IdleReclaimerSessionReceipt> {
	const latest = new Map<string, IdleReclaimerSessionReceipt>();
	for (const receipt of receipts) {
		const previous = latest.get(receipt.sessionId);
		if (!previous || Date.parse(receipt.recordedAt) >= Date.parse(previous.recordedAt))
			latest.set(receipt.sessionId, receipt);
	}
	return latest;
}

function peerState(peer: IrcExternalPeer, paused: boolean): SessionHealthState {
	if (paused || peer.state === "paused") return "parked";
	if (peer.state === "working") return "working";
	if (peer.state === "waiting_input") return "waiting-input";
	return "idle";
}

function matchingReceiptIsParked(
	peer: IrcExternalPeer | undefined,
	receipt: IdleReclaimerSessionReceipt | undefined,
): boolean {
	if (receipt?.event !== "reclaimed") return false;
	if (!peer) return true;
	return Date.parse(receipt.recordedAt) >= Date.parse(peer.lastSeen);
}

function processSnapshot(identity: ProcessIdentity | undefined, fallbackPid?: number): SessionHealthProcess {
	if (identity) {
		const matched = matchesProcessIdentity(identity);
		return {
			pid: identity.pid,
			alive: matched,
			fingerprint: identity.startFingerprint,
			fingerprintMatched: matched,
		};
	}
	if (fallbackPid === undefined) return { pid: null, alive: false, fingerprint: null, fingerprintMatched: null };
	const observed = readProcessIdentity(fallbackPid);
	return {
		pid: fallbackPid,
		alive: observed !== null,
		fingerprint: observed?.startFingerprint ?? null,
		fingerprintMatched: null,
	};
}

function ownerEpochMismatch(
	peer: IrcExternalPeer | undefined,
	control: ControlEvidence | undefined,
	admissions: readonly AdmissionEvidence[],
): boolean {
	if (peer?.ownerEpoch && control && peer.ownerEpoch !== control.ownerEpoch) return true;
	if (!peer?.ownerEpoch) return false;
	return admissions.some(admission => admission.ownerEpoch !== null && admission.ownerEpoch !== peer.ownerEpoch);
}

export async function collectSessionHealth(options: SessionHealthOptions = {}): Promise<SessionHealthReport> {
	const nowMs = options.nowMs ?? Date.now();
	const ircDbPath = resolveIrcExternalDbPath(options.ircDbPath);
	const controlDbPath = options.controlDbPath ?? SESSION_CONTROL_DB_PATH;
	const admissionDbPath = options.admissionDbPath ?? ircDbPath;
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
	const controls = readControlEvidence(controlDbPath);
	const admissions = readAdmissionEvidence(admissionDbPath);
	const receipts = latestReceiptsBySession(
		await readIdleReclaimerSessionReceipts(options.agentDir ?? getAgentDir()).catch(() => []),
	);
	const peerBySession = new Map(peers.map(peer => [peer.sessionId, peer] as const));
	const controlBySession = new Map(controls.map(control => [control.sessionId, control] as const));
	const admissionsBySession = new Map<string, AdmissionEvidence[]>();
	for (const admission of admissions) {
		const grouped = admissionsBySession.get(admission.sessionId) ?? [];
		grouped.push(admission);
		admissionsBySession.set(admission.sessionId, grouped);
	}
	const sessionIds = new Set<string>([
		...peerBySession.keys(),
		...controlBySession.keys(),
		...admissionsBySession.keys(),
		...[...receipts].filter(([, receipt]) => receipt.event === "reclaimed").map(([sessionId]) => sessionId),
	]);
	const roots = new Map<number, ProcessIdentity>();
	const drafts = await Promise.all(
		[...sessionIds].map(async sessionId => {
			const peer = peerBySession.get(sessionId);
			const control = controlBySession.get(sessionId);
			const sessionAdmissions = admissionsBySession.get(sessionId) ?? [];
			const liveAdmission = sessionAdmissions.find(admission => matchesProcessIdentity(admission.processIdentity));
			const parkedByReceipt = matchingReceiptIsParked(peer, receipts.get(sessionId));
			const identity =
				peer?.processIdentity ??
				liveAdmission?.processIdentity ??
				(peer ? (readProcessIdentity(peer.pid) ?? undefined) : undefined);
			const process = processSnapshot(identity, peer?.pid);
			if (process.alive && identity) roots.set(identity.pid, identity);
			const mismatch = ownerEpochMismatch(peer, control, sessionAdmissions);
			let classification: SessionHealthClassification;
			let state: SessionHealthState;
			if (process.alive && peer) {
				state = peerState(peer, control?.paused ?? false);
				classification = mismatch ? "owner-mismatch" : state === "parked" ? "parked" : "ok";
			} else if (parkedByReceipt) {
				state = "parked";
				classification = "parked";
			} else if (peer) {
				state = "orphaned";
				classification = "orphaned-row";
			} else if (liveAdmission) {
				state = "orphaned";
				classification = "unregistered";
			} else {
				state = "orphaned";
				classification = "orphaned-control";
			}
			const receipt = receipts.get(sessionId);
			const journalPath = peer?.sessionFile ?? receipt?.sessionFile;
			const journal = await readJournalEvidence(journalPath, sessionId, nowMs, options.ownershipRoot);
			const ownerView =
				process.alive && journalPath
					? await inspectLiveSessionOwnerView(journalPath, sessionId, { root: options.ownershipRoot }).catch(
							() => undefined,
						)
					: undefined;
			return {
				sessionId,
				name: peer?.name ?? null,
				classification,
				state,
				process,
				currentTurnActive: process.alive && state === "working",
				lastJournalWriteAgeMs: journal.ageMs,
				pendingDurableInputs: journal.pendingInputs,
				childAttemptsHeld: sessionAdmissions.filter(admission => admission.held).length,
				buildDigest: peer?.buildDigest ?? peer?.fleetCapability?.buildDigest ?? null,
				journalPath: journalPath ?? null,
				owner: {
					cwd: peer?.cwd ?? receipt?.cwd ?? null,
					cmuxWorkspaceId: ownerView?.cmux.workspaceId ?? null,
					cmuxSurfaceId: ownerView?.cmux.surfaceId ?? null,
				},
				evidenceWarnings: mismatch ? [...journal.warnings, "owner-epoch-mismatch"] : journal.warnings,
			};
		}),
	);
	let rssByPid = new Map<number, number>();
	try {
		const sample = await sampleLeaseProcessTrees(
			[...roots].map(([pid, identity]) => ({ leaseId: String(pid), holderProcess: identity })),
		);
		rssByPid = new Map([...sample.observedBytesByLease].map(([pid, bytes]) => [Number(pid), bytes] as const));
	} catch {}
	const sessions: SessionHealthRow[] = drafts
		.map(draft => ({
			...draft,
			rssBytes: draft.process.pid === null ? null : (rssByPid.get(draft.process.pid) ?? null),
		}))
		.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
	return { schemaVersion: 1, generatedAt: new Date(nowMs).toISOString(), sessions };
}

function printable(value: string): string {
	return value.replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ") || "-";
}

function truncate(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, Math.max(1, max - 3))}...`;
}

function formatBytes(bytes: number | null): string {
	if (bytes === null) return "-";
	if (bytes < 1_048_576) return `${Math.round(bytes / 1024)}K`;
	if (bytes < 1_073_741_824) return `${Math.round(bytes / 1_048_576)}M`;
	return `${(bytes / 1_073_741_824).toFixed(1)}G`;
}

function formatAge(ageMs: number | null): string {
	if (ageMs === null) return "-";
	if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s`;
	if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m`;
	if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h`;
	return `${Math.floor(ageMs / 86_400_000)}d`;
}

export function formatSessionHealthTable(report: SessionHealthReport): string {
	const lines = [
		["SESSION", "STATE", "HEALTH", "PID", "RSS", "JOURNAL", "TURN", "INPUTS", "CHILDREN", "BUILD", "OWNER"].join(
			"\t",
		),
	];
	for (const row of report.sessions) {
		const session = row.name ? `${row.name} (${row.sessionId.slice(0, 8)})` : row.sessionId;
		const cmux =
			row.owner.cmuxWorkspaceId && row.owner.cmuxSurfaceId
				? `${row.owner.cmuxWorkspaceId.slice(0, 8)}/${row.owner.cmuxSurfaceId.slice(0, 8)}`
				: row.owner.cwd;
		lines.push(
			[
				truncate(printable(session), 36),
				row.state,
				row.classification,
				row.process.pid === null ? "-" : `${row.process.pid}${row.process.alive ? "" : "!"}`,
				formatBytes(row.rssBytes),
				formatAge(row.lastJournalWriteAgeMs),
				row.currentTurnActive ? "yes" : "no",
				row.pendingDurableInputs === null ? "-" : String(row.pendingDurableInputs),
				String(row.childAttemptsHeld),
				row.buildDigest ? row.buildDigest.slice(0, 12) : "-",
				truncate(printable(cmux ?? "-"), 48),
			].join("\t"),
		);
	}
	return `${lines.join("\n")}\n`;
}

export function formatSessionHealthJson(report: SessionHealthReport): string {
	return `${JSON.stringify(report, null, 2)}\n`;
}
