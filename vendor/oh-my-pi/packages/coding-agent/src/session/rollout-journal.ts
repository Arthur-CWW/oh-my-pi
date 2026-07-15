import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { Schema } from "effect";
import { SESSION_CONTROL_DB_PATH } from "./session-control";

export const ROLLOUT_PEER_PHASES = [
	"planned",
	"skipped",
	"requested",
	"acknowledged",
	"applied",
	"recovered",
	"failed",
] as const;
export type RolloutPeerPhase = (typeof ROLLOUT_PEER_PHASES)[number];

export interface RolloutPeerSnapshot {
	readonly rolloutId: string;
	readonly targetDigest: string;
	readonly targetVersion: string;
	readonly sessionId: string;
	readonly sessionFile?: string;
	readonly name: string;
	readonly phase: RolloutPeerPhase;
	readonly reason?: string;
	readonly error?: string;
	readonly updatedAt: string;
}

export interface RolloutRunInput {
	readonly rolloutId: string;
	readonly targetDigest: string;
	readonly targetVersion: string;
	readonly startedAt?: string;
}

export interface RolloutPeerTransition {
	readonly rolloutId: string;
	readonly sessionId: string;
	readonly sessionFile?: string;
	readonly name: string;
	readonly phase: RolloutPeerPhase;
	readonly reason?: string;
	readonly error?: string;
	readonly updatedAt?: string;
}

interface RolloutRunRow {
	target_digest: string;
	target_version: string;
	started_at: string;
}

interface RolloutPhaseRow {
	phase: string;
}

interface RolloutSnapshotRow {
	rollout_id: string;
	target_digest: string;
	target_version: string;
	session_id: string;
	session_file: string | null;
	name: string;
	phase: string;
	reason: string | null;
	error: string | null;
	updated_at: string;
}

const NonEmptyStringSchema = Schema.Trim.pipe(Schema.check(Schema.isMinLength(1)));
const TimestampSchema = Schema.String.pipe(
	Schema.refine((value): value is string => {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
	}),
);
const RolloutPeerPhaseSchema = Schema.Literals(ROLLOUT_PEER_PHASES);
const RolloutPeerSnapshotSchema = Schema.Struct({
	rolloutId: NonEmptyStringSchema,
	targetDigest: NonEmptyStringSchema,
	targetVersion: NonEmptyStringSchema,
	sessionId: NonEmptyStringSchema,
	sessionFile: Schema.optional(NonEmptyStringSchema),
	name: NonEmptyStringSchema,
	phase: RolloutPeerPhaseSchema,
	reason: Schema.optional(NonEmptyStringSchema),
	error: Schema.optional(NonEmptyStringSchema),
	updatedAt: TimestampSchema,
});

const nowIso = (): string => new Date().toISOString();
const JOURNAL_TEXT_LIMIT = 4096;
const JOURNAL_IDENTITY_LIMIT = 8192;

function boundedIdentity(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim().slice(0, JOURNAL_IDENTITY_LIMIT);
	return normalized || undefined;
}

function boundedText(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const normalized = value
		.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, JOURNAL_TEXT_LIMIT);
	return normalized || undefined;
}

function peerKey(sessionId: string): string {
	return `session:${sessionId}`;
}

const NEXT_PHASES: Record<RolloutPeerPhase, Partial<Record<RolloutPeerPhase, true>>> = {
	planned: { planned: true, skipped: true, requested: true, failed: true },
	skipped: { skipped: true },
	requested: { requested: true, acknowledged: true, applied: true, failed: true },
	acknowledged: { acknowledged: true, applied: true, failed: true },
	applied: { applied: true, recovered: true, failed: true },
	recovered: { recovered: true },
	failed: { failed: true },
};

function decodeSnapshot(row: RolloutSnapshotRow): RolloutPeerSnapshot {
	return Schema.decodeUnknownSync(RolloutPeerSnapshotSchema)(
		{
			rolloutId: row.rollout_id,
			targetDigest: row.target_digest,
			targetVersion: row.target_version,
			sessionId: row.session_id,
			...(row.session_file === null ? {} : { sessionFile: row.session_file }),
			name: row.name,
			phase: row.phase,
			...(row.reason === null ? {} : { reason: row.reason }),
			...(row.error === null ? {} : { error: row.error }),
			updatedAt: row.updated_at,
		},
		{ onExcessProperty: "error" },
	);
}

export interface RolloutJournalOptions {
	readonly readonly?: boolean;
}

/** Latest-per-peer rollout state stored beside session-control commands and receipts. */
export class RolloutJournal {
	readonly #db: Database;

	constructor(
		readonly dbPath: string = SESSION_CONTROL_DB_PATH,
		options: RolloutJournalOptions = {},
	) {
		if (!options.readonly) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		this.#db = options.readonly ? new Database(dbPath, { readonly: true }) : new Database(dbPath);
		this.#db.run("PRAGMA busy_timeout = 3000");
		if (options.readonly) return;
		this.#db.run("PRAGMA journal_mode = WAL");
		this.#db.run("PRAGMA foreign_keys = ON");
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS rollout_runs (
				rollout_id TEXT PRIMARY KEY,
				target_digest TEXT NOT NULL,
				target_version TEXT NOT NULL,
				started_at TEXT NOT NULL
			)
		`);
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS rollout_peers (
				rollout_id TEXT NOT NULL REFERENCES rollout_runs(rollout_id),
				peer_key TEXT NOT NULL,
				session_id TEXT NOT NULL,
				session_file TEXT,
				name TEXT NOT NULL,
				phase TEXT NOT NULL CHECK(phase IN ('planned','skipped','requested','acknowledged','applied','recovered','failed')),
				reason TEXT,
				error TEXT,
				updated_at TEXT NOT NULL,
				PRIMARY KEY (rollout_id, peer_key)
			)
		`);
		this.#db.run(
			"CREATE INDEX IF NOT EXISTS idx_rollout_peers_session ON rollout_peers(session_id, updated_at DESC)",
		);
		this.#db.run("CREATE INDEX IF NOT EXISTS idx_rollout_peers_file ON rollout_peers(session_file, updated_at DESC)");
	}

	close(): void {
		this.#db.close();
	}

	beginRun(input: RolloutRunInput): void {
		const rolloutId = boundedIdentity(input.rolloutId);
		const targetDigest = boundedIdentity(input.targetDigest);
		const targetVersion = boundedText(input.targetVersion);
		if (!rolloutId || !targetDigest || !targetVersion)
			throw new Error("Rollout id, digest, and version are required");
		const startedAt = input.startedAt ?? nowIso();
		const existing = this.#db
			.query<RolloutRunRow, { $rolloutId: string }>(
				"SELECT target_digest,target_version,started_at FROM rollout_runs WHERE rollout_id=$rolloutId",
			)
			.get({ $rolloutId: rolloutId });
		if (existing) {
			if (
				existing.target_digest !== targetDigest ||
				existing.target_version !== targetVersion ||
				(input.startedAt !== undefined && existing.started_at !== startedAt)
			)
				throw new Error(`Conflicting reuse of rollout ${rolloutId}`);
			return;
		}
		Schema.decodeUnknownSync(TimestampSchema)(startedAt);
		this.#db
			.query(
				"INSERT INTO rollout_runs (rollout_id,target_digest,target_version,started_at) VALUES ($rolloutId,$targetDigest,$targetVersion,$startedAt)",
			)
			.run({
				$rolloutId: rolloutId,
				$targetDigest: targetDigest,
				$targetVersion: targetVersion,
				$startedAt: startedAt,
			});
	}

	updatePeer(input: RolloutPeerTransition): void {
		const rolloutId = boundedIdentity(input.rolloutId);
		const sessionId = boundedIdentity(input.sessionId);
		const sessionFile = boundedIdentity(input.sessionFile);
		const name = boundedText(input.name) ?? sessionId;
		if (!rolloutId || !sessionId || !name) throw new Error("Rollout, session, and peer name are required");
		const updatedAt = input.updatedAt ?? nowIso();
		Schema.decodeUnknownSync(TimestampSchema)(updatedAt);
		const key = peerKey(sessionId);
		const existing = this.#db
			.query<RolloutPhaseRow, { $rolloutId: string; $peerKey: string }>(
				"SELECT phase FROM rollout_peers WHERE rollout_id=$rolloutId AND peer_key=$peerKey",
			)
			.get({ $rolloutId: rolloutId, $peerKey: key });
		if (existing) {
			const current = Schema.decodeUnknownSync(RolloutPeerPhaseSchema)(existing.phase);
			if (!NEXT_PHASES[current][input.phase]) {
				throw new Error(`Invalid rollout transition ${current} -> ${input.phase}`);
			}
		} else if (input.phase !== "planned" && input.phase !== "skipped") {
			throw new Error(`Initial rollout phase must be planned or skipped, received ${input.phase}`);
		}
		const reason = boundedText(input.reason);
		const error = boundedText(input.error);
		this.#db
			.query(
				`INSERT INTO rollout_peers (rollout_id,peer_key,session_id,session_file,name,phase,reason,error,updated_at)
				 VALUES ($rolloutId,$peerKey,$sessionId,$sessionFile,$name,$phase,$reason,$error,$updatedAt)
				 ON CONFLICT(rollout_id,peer_key) DO UPDATE SET
				 session_id=excluded.session_id, session_file=excluded.session_file, name=excluded.name,
				 phase=excluded.phase, reason=excluded.reason, error=excluded.error, updated_at=excluded.updated_at`,
			)
			.run({
				$rolloutId: rolloutId,
				$peerKey: key,
				$sessionId: sessionId,
				$sessionFile: sessionFile ?? null,
				$name: name,
				$phase: input.phase,
				$reason: reason ?? null,
				$error: error ?? null,
				$updatedAt: updatedAt,
			});
	}

	latestForPeer(peer: {
		readonly sessionId?: string;
		readonly sessionFile?: string;
	}): RolloutPeerSnapshot | undefined {
		const sessionId = boundedIdentity(peer.sessionId);
		const sessionFile = boundedIdentity(peer.sessionFile);
		if (!sessionId && !sessionFile) return undefined;
		const row = this.#db
			.query<RolloutSnapshotRow, { $sessionId: string | null; $sessionFile: string | null }>(
				`SELECT p.rollout_id,r.target_digest,r.target_version,p.session_id,p.session_file,p.name,p.phase,p.reason,p.error,p.updated_at
				 FROM rollout_peers p JOIN rollout_runs r ON r.rollout_id=p.rollout_id
				 WHERE ($sessionId IS NOT NULL AND p.session_id=$sessionId)
				    OR ($sessionFile IS NOT NULL AND p.session_file=$sessionFile)
				 ORDER BY p.updated_at DESC, r.started_at DESC LIMIT 1`,
			)
			.get({ $sessionId: sessionId ?? null, $sessionFile: sessionFile ?? null });
		return row ? decodeSnapshot(row) : undefined;
	}
}
