import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { getIdleReclaimerReceiptPath } from "@oh-my-pi/pi-coding-agent/resource/idle-reclaimer";
import { readProcessIdentity } from "@oh-my-pi/pi-coding-agent/resource/process-identity";
import {
	collectSessionHealth,
	formatSessionHealthJson,
	formatSessionHealthTable,
} from "@oh-my-pi/pi-coding-agent/resource/session-health";
import { SessionControlBus } from "@oh-my-pi/pi-coding-agent/session/session-control";

const DEAD_PID = 2_147_483_647;

async function withFixture(run: (root: string) => Promise<void>): Promise<void> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-health-"));
	try {
		await run(root);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
}

async function writeJournal(file: string, sessionId: string, atMs: number): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(
		file,
		`${JSON.stringify({ type: "session", version: 3, id: sessionId, cwd: "/fixture", timestamp: new Date(atMs).toISOString() })}\n`,
		"utf8",
	);
	const at = new Date(atMs);
	await fs.utimes(file, at, at);
}

async function writeQueueFixture(
	ownershipRoot: string,
	sessionFile: string,
	sessionId: string,
	ownerEpoch: string,
): Promise<void> {
	const canonical = await fs.realpath(sessionFile);
	const key = createHash("sha256").update(canonical).update("\0").update(sessionId).digest("hex");
	const root = path.join(ownershipRoot, "owners-v1", key, "queue-v3");
	const epoch = "fixture-epoch";
	await fs.mkdir(path.join(root, "segments"), { recursive: true });
	await fs.writeFile(
		path.join(root, "head.json"),
		JSON.stringify({ version: 3, epoch, ownershipEpoch: ownerEpoch, adoptedAt: Date.now() }),
		"utf8",
	);
	const records = [
		{
			version: 3,
			type: "enqueue",
			id: "queued-input",
			payload: { text: "queued" },
			sequence: 1,
			deliveryClass: "followUp",
			revision: 1,
			ownerEpoch,
		},
		{
			version: 3,
			type: "enqueue",
			id: "completed-input",
			payload: { text: "completed" },
			sequence: 2,
			deliveryClass: "followUp",
			revision: 1,
			ownerEpoch,
		},
		{ version: 3, type: "state", id: "completed-input", state: "completed", ownerEpoch },
		{
			version: 3,
			type: "enqueue",
			id: "running-input",
			payload: { text: "running" },
			sequence: 3,
			deliveryClass: "steer",
			revision: 1,
			ownerEpoch,
		},
		{
			version: 3,
			type: "attempt",
			id: "running-attempt",
			inputId: "running-input",
			revision: 1,
			ownerEpoch,
		},
		{
			version: 3,
			type: "request-start",
			attemptId: "running-attempt",
			inputId: "running-input",
			ownerEpoch,
		},
	];
	await fs.writeFile(
		path.join(root, "segments", `${epoch}.jsonl`),
		`${records.map(record => JSON.stringify(record)).join("\n")}\n`,
		"utf8",
	);
}

function createAdmissionTables(dbPath: string): Database {
	const db = new Database(dbPath);
	db.run(`
		CREATE TABLE resource_leases (
			lease_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, session_owner_epoch TEXT,
			holder_boot_id TEXT NOT NULL, holder_pid INTEGER NOT NULL, holder_start_fingerprint TEXT NOT NULL,
			state TEXT NOT NULL, acquired_at_ms INTEGER NOT NULL, fence_token INTEGER NOT NULL
		)
	`);
	db.run(`
		CREATE TABLE resource_waiters (
			attempt_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, session_owner_epoch TEXT,
			holder_boot_id TEXT NOT NULL, holder_pid INTEGER NOT NULL, holder_start_fingerprint TEXT NOT NULL,
			rejection_reason TEXT, ticket INTEGER NOT NULL
		)
	`);
	return db;
}

function insertLease(
	db: Database,
	input: { readonly leaseId: string; readonly sessionId: string; readonly ownerEpoch: string },
): void {
	const identity = readProcessIdentity(process.pid);
	if (!identity) throw new Error("Current process identity is unavailable");
	db.query(
		`INSERT INTO resource_leases
		 (lease_id, session_id, session_owner_epoch, holder_boot_id, holder_pid, holder_start_fingerprint, state, acquired_at_ms, fence_token)
		 VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
	).run(
		input.leaseId,
		input.sessionId,
		input.ownerEpoch,
		identity.bootId,
		identity.pid,
		identity.startFingerprint,
		Date.now(),
		input.leaseId === "lease-ok" ? 1 : 2,
	);
}

function register(
	bus: IrcExternalBus,
	input: {
		readonly sessionId: string;
		readonly sessionFile: string;
		readonly ownerEpoch: string;
		readonly pid: number;
		readonly state: "working" | "waiting_input" | "idle";
		readonly digest?: string;
	},
): void {
	bus.registerPeer({
		sessionId: input.sessionId,
		name: input.sessionId,
		cwd: "/fixture",
		pid: input.pid,
		sessionFile: input.sessionFile,
		ownerEpoch: input.ownerEpoch,
		buildDigest: input.digest,
	});
	bus.updatePeerState(input.sessionId, input.state);
}

describe("session health probe", () => {
	it("classifies every canonical evidence divergence and projects queue, process, and owner metrics read-only", async () => {
		await withFixture(async root => {
			const agentDir = path.join(root, "agent");
			const ownershipRoot = path.join(root, "mux");
			const ircDbPath = path.join(agentDir, "irc-bus.sqlite");
			const controlDbPath = path.join(agentDir, "session-control.sqlite");
			const sessionsDir = path.join(root, "sessions");
			const nowMs = Date.now() + 10_000;
			await fs.mkdir(agentDir, { recursive: true });

			const ids = {
				ok: "session-ok",
				parked: "session-parked",
				orphanedRow: "session-orphaned-row",
				unregistered: "session-unregistered",
				orphanedControl: "session-orphaned-control",
				ownerMismatch: "session-owner-mismatch",
			};
			const files = Object.fromEntries(
				Object.values(ids).map(sessionId => [sessionId, path.join(sessionsDir, `${sessionId}.jsonl`)]),
			) as Record<string, string>;
			for (const sessionId of [ids.ok, ids.parked, ids.orphanedRow, ids.ownerMismatch]) {
				await writeJournal(files[sessionId], sessionId, nowMs - 5_000);
			}
			await writeQueueFixture(ownershipRoot, files[ids.ok], ids.ok, "owner-ok");

			const bus = new IrcExternalBus(ircDbPath);
			try {
				register(bus, {
					sessionId: ids.ok,
					sessionFile: files[ids.ok],
					ownerEpoch: "owner-ok",
					pid: process.pid,
					state: "working",
					digest: "a".repeat(64),
				});
				register(bus, {
					sessionId: ids.parked,
					sessionFile: files[ids.parked],
					ownerEpoch: "owner-parked",
					pid: DEAD_PID,
					state: "idle",
				});
				register(bus, {
					sessionId: ids.orphanedRow,
					sessionFile: files[ids.orphanedRow],
					ownerEpoch: "owner-orphaned",
					pid: DEAD_PID,
					state: "idle",
				});
				register(bus, {
					sessionId: ids.ownerMismatch,
					sessionFile: files[ids.ownerMismatch],
					ownerEpoch: "owner-peer",
					pid: process.pid,
					state: "waiting_input",
				});
			} finally {
				bus.close();
			}

			const control = new SessionControlBus(controlDbPath);
			try {
				control.bindTarget(ids.ok, "owner-ok");
				control.bindTarget(ids.orphanedControl, "owner-control-only");
				control.bindTarget(ids.ownerMismatch, "owner-control");
			} finally {
				control.close();
			}

			const admission = createAdmissionTables(ircDbPath);
			try {
				insertLease(admission, { leaseId: "lease-ok", sessionId: ids.ok, ownerEpoch: "owner-ok" });
				insertLease(admission, {
					leaseId: "lease-unregistered",
					sessionId: ids.unregistered,
					ownerEpoch: "owner-unregistered",
				});
			} finally {
				admission.close();
			}

			await fs.writeFile(
				getIdleReclaimerReceiptPath(agentDir),
				`${JSON.stringify({
					version: 1,
					type: "idle-reclaimer-session",
					receiptId: "receipt-parked",
					sweepId: "sweep-parked",
					recordedAt: new Date(nowMs).toISOString(),
					sessionId: ids.parked,
					sessionFile: files[ids.parked],
					cwd: "/fixture",
					ownerEpoch: "owner-parked",
					lastActivityAt: new Date(nowMs - 5_000).toISOString(),
					journalStatus: "complete",
					resume: { argv: ["omp", "--resume", files[ids.parked]], command: "omp --resume" },
					commands: { gracefulStop: "stop", terminate: ["term", "kill"] },
					event: "reclaimed",
					checkpointReceiptId: "checkpoint-parked",
					termination: "graceful-control",
				})}\n`,
				"utf8",
			);

			const dbBefore = await fs.readFile(ircDbPath);
			const report = await collectSessionHealth({
				agentDir,
				ircDbPath,
				controlDbPath,
				admissionDbPath: ircDbPath,
				ownershipRoot,
				nowMs,
			});
			expect(await fs.readFile(ircDbPath)).toEqual(dbBefore);

			const byId = new Map(report.sessions.map(row => [row.sessionId, row] as const));
			expect(Object.fromEntries(report.sessions.map(row => [row.sessionId, row.classification]))).toEqual({
				[ids.ok]: "ok",
				[ids.parked]: "parked",
				[ids.orphanedRow]: "orphaned-row",
				[ids.unregistered]: "unregistered",
				[ids.orphanedControl]: "orphaned-control",
				[ids.ownerMismatch]: "owner-mismatch",
			});
			const ok = byId.get(ids.ok);
			expect(ok).toBeDefined();
			expect(ok?.state).toBe("working");
			expect(ok?.currentTurnActive).toBe(true);
			expect(ok?.process.alive).toBe(true);
			expect(ok?.process.fingerprint).toBeString();
			expect(ok?.pendingDurableInputs).toBe(2);
			expect(ok?.childAttemptsHeld).toBe(1);
			expect(ok?.lastJournalWriteAgeMs).toBe(5_000);
			expect(ok?.rssBytes).toBeGreaterThan(0);
			expect(ok?.buildDigest).toBe("a".repeat(64));
			expect(byId.get(ids.parked)?.state).toBe("parked");
			expect(byId.get(ids.ownerMismatch)?.evidenceWarnings).toContain("owner-epoch-mismatch");
			expect(byId.get(ids.unregistered)?.process.alive).toBe(true);

			const json = JSON.parse(formatSessionHealthJson(report));
			expect(json.schemaVersion).toBe(1);
			expect(json.sessions).toHaveLength(6);
			const table = formatSessionHealthTable(report);
			expect(table).toContain("SESSION\tSTATE\tHEALTH\tPID\tRSS\tJOURNAL\tTURN\tINPUTS\tCHILDREN\tBUILD\tOWNER");
			expect(table).toContain("session-orphaned-row");
		});
	});
});
