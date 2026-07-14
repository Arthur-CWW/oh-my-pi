import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Schema } from "effect";

export const SESSION_CONTROL_SCHEMA_VERSION = 1 as const;

const UUIDSchema = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)),
);
const NonEmptyStringSchema = Schema.Trim.pipe(Schema.check(Schema.isMinLength(1)));
const TimestampSchema = Schema.String.pipe(
	Schema.refine((value): value is string => {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
	}),
);
const LocalSourceSchema = Schema.Struct({
	kind: Schema.Literal("local-cli"),
	instanceId: UUIDSchema,
	pid: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
	uid: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
});
const IntentSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("status") }),
	Schema.Struct({ kind: Schema.Literal("pause") }),
	Schema.Struct({ kind: Schema.Literal("resume") }),
	Schema.Struct({ kind: Schema.Literal("restart"), executable: NonEmptyStringSchema }),
	Schema.Struct({ kind: Schema.Literal("setModel"), selector: NonEmptyStringSchema }),
	Schema.Struct({ kind: Schema.Literal("compact"), instructions: Schema.optional(NonEmptyStringSchema) }),
	Schema.Struct({ kind: Schema.Literal("stop"), confirmationToken: NonEmptyStringSchema }),
]);
export const SessionControlCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(SESSION_CONTROL_SCHEMA_VERSION),
	commandId: UUIDSchema,
	source: LocalSourceSchema,
	sessionId: NonEmptyStringSchema,
	targetOwnerEpoch: NonEmptyStringSchema,
	requestedAt: TimestampSchema,
	intent: IntentSchema,
});
export type SessionControlIntent = typeof IntentSchema.Type;
export type SessionControlCommand = typeof SessionControlCommandSchema.Type;

const ReceiptStateSchema = Schema.Literals(["requested", "acknowledged", "applied", "failed"]);
export const SessionControlReceiptSchema = Schema.Struct({
	schemaVersion: Schema.Literal(SESSION_CONTROL_SCHEMA_VERSION),
	commandId: UUIDSchema,
	sessionId: NonEmptyStringSchema,
	targetOwnerEpoch: NonEmptyStringSchema,
	state: ReceiptStateSchema,
	requestedAt: TimestampSchema,
	acknowledgedAt: Schema.optional(TimestampSchema),
	completedAt: Schema.optional(TimestampSchema),
	result: Schema.optional(Schema.Unknown),
	error: Schema.optional(NonEmptyStringSchema),
});
export type SessionControlReceiptState = typeof ReceiptStateSchema.Type;
export type SessionControlReceipt = typeof SessionControlReceiptSchema.Type;
export type SessionControlResult = NonNullable<SessionControlReceipt["result"]>;

export const decodeSessionControlCommand = (input: unknown): SessionControlCommand =>
	Schema.decodeUnknownSync(SessionControlCommandSchema)(input, { onExcessProperty: "error" });
export const decodeSessionControlReceipt = (input: unknown): SessionControlReceipt =>
	Schema.decodeUnknownSync(SessionControlReceiptSchema)(input, { onExcessProperty: "error" });

export function stopConfirmationToken(sessionId: string, ownerEpoch: string): string {
	return `stop-${createHash("sha256").update(`${sessionId}\0${ownerEpoch}`, "utf8").digest("hex").slice(0, 24)}`;
}

interface CommandRow {
	command_json: string;
}
interface ReceiptRow {
	command_id: string;
	session_id: string;
	target_owner_epoch: string;
	state: string;
	requested_at: string;
	acknowledged_at: string | null;
	completed_at: string | null;
	result_json: string | null;
	error: string | null;
}
interface PausedRow {
	paused: number;
	owner_epoch: string;
}

export const SESSION_CONTROL_DB_PATH =
	process.env.OMP_SESSION_CONTROL_DB ?? path.join(os.homedir(), ".omp", "agent", "session-control.sqlite");
const nowIso = (): string => new Date().toISOString();
const currentUid = (): number | undefined => process.getuid?.();

function assertLocalSource(command: SessionControlCommand): void {
	const uid = currentUid();
	if (uid !== undefined && command.source.uid !== uid) {
		throw new Error(`Control command ${command.commandId} is not from the current local user`);
	}
}

function decodeReceiptRow(row: ReceiptRow): SessionControlReceipt {
	return decodeSessionControlReceipt({
		schemaVersion: SESSION_CONTROL_SCHEMA_VERSION,
		commandId: row.command_id,
		sessionId: row.session_id,
		targetOwnerEpoch: row.target_owner_epoch,
		state: row.state,
		requestedAt: row.requested_at,
		...(row.acknowledged_at === null ? {} : { acknowledgedAt: row.acknowledged_at }),
		...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
		...(row.result_json === null ? {} : { result: JSON.parse(row.result_json) }),
		...(row.error === null ? {} : { error: row.error }),
	});
}

export interface SessionControlWaitOptions {
	readonly timeoutMs?: number;
	readonly pollIntervalMs?: number;
	readonly onReceipt?: (receipt: SessionControlReceipt) => void;
}

export class SessionControlBus {
	readonly #db: Database;

	constructor(readonly dbPath: string = SESSION_CONTROL_DB_PATH) {
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		this.#db = new Database(dbPath);
		this.#db.run("PRAGMA busy_timeout = 3000");
		this.#db.run("PRAGMA journal_mode = WAL");
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS control_commands (
				command_id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				target_owner_epoch TEXT NOT NULL,
				command_json TEXT NOT NULL,
				requested_at TEXT NOT NULL
			)
		`);
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS control_receipts (
				command_id TEXT PRIMARY KEY REFERENCES control_commands(command_id),
				session_id TEXT NOT NULL,
				target_owner_epoch TEXT NOT NULL,
				state TEXT NOT NULL CHECK(state IN ('requested','acknowledged','applied','failed')),
				requested_at TEXT NOT NULL,
				acknowledged_at TEXT,
				completed_at TEXT,
				result_json TEXT,
				error TEXT
			)
		`);
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS control_targets (
				session_id TEXT PRIMARY KEY,
				owner_epoch TEXT NOT NULL,
				bound_at TEXT NOT NULL
			)
		`);
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS control_state (
				session_id TEXT PRIMARY KEY,
				owner_epoch TEXT NOT NULL,
				paused INTEGER NOT NULL CHECK(paused IN (0,1)),
				updated_at TEXT NOT NULL
			)
		`);
		this.#db.run(
			"CREATE INDEX IF NOT EXISTS idx_control_receipts_target ON control_receipts(session_id, target_owner_epoch, state, requested_at)",
		);
	}

	close(): void {
		this.#db.close();
	}

	bindTarget(sessionId: string, ownerEpoch: string): void {
		if (!sessionId.trim() || !ownerEpoch.trim()) throw new Error("Session id and owner epoch are required");
		const at = nowIso();
		this.#db.transaction(() => {
			this.#db
				.query(
					`INSERT INTO control_targets (session_id, owner_epoch, bound_at) VALUES ($sessionId, $ownerEpoch, $at)
					 ON CONFLICT(session_id) DO UPDATE SET owner_epoch=excluded.owner_epoch, bound_at=excluded.bound_at`,
				)
				.run({ $sessionId: sessionId, $ownerEpoch: ownerEpoch, $at: at });
			this.#db
				.query(
					`INSERT INTO control_state (session_id, owner_epoch, paused, updated_at) VALUES ($sessionId, $ownerEpoch, 0, $at)
					 ON CONFLICT(session_id) DO UPDATE SET owner_epoch=excluded.owner_epoch, updated_at=excluded.updated_at`,
				)
				.run({ $sessionId: sessionId, $ownerEpoch: ownerEpoch, $at: at });
		})();
	}

	releaseTarget(sessionId: string, ownerEpoch: string): void {
		this.#db
			.query("DELETE FROM control_targets WHERE session_id=$sessionId AND owner_epoch=$ownerEpoch")
			.run({ $sessionId: sessionId, $ownerEpoch: ownerEpoch });
	}

	request(input: unknown): SessionControlReceipt {
		const command = decodeSessionControlCommand(input);
		assertLocalSource(command);
		const commandJson = JSON.stringify(command);
		return this.#db.transaction(() => {
			const existing = this.#db
				.query<CommandRow, { $commandId: string }>(
					"SELECT command_json FROM control_commands WHERE command_id=$commandId",
				)
				.get({ $commandId: command.commandId });
			if (existing) {
				if (existing.command_json !== commandJson)
					throw new Error(`Conflicting reuse of control command ${command.commandId}`);
				const receipt = this.getReceipt(command.commandId);
				if (!receipt) throw new Error(`Control command ${command.commandId} is missing its receipt`);
				return receipt;
			}
			this.#db
				.query(
					"INSERT INTO control_commands (command_id, session_id, target_owner_epoch, command_json, requested_at) VALUES ($commandId,$sessionId,$ownerEpoch,$json,$requestedAt)",
				)
				.run({
					$commandId: command.commandId,
					$sessionId: command.sessionId,
					$ownerEpoch: command.targetOwnerEpoch,
					$json: commandJson,
					$requestedAt: command.requestedAt,
				});
			this.#db
				.query(
					"INSERT INTO control_receipts (command_id, session_id, target_owner_epoch, state, requested_at) VALUES ($commandId,$sessionId,$ownerEpoch,'requested',$requestedAt)",
				)
				.run({
					$commandId: command.commandId,
					$sessionId: command.sessionId,
					$ownerEpoch: command.targetOwnerEpoch,
					$requestedAt: command.requestedAt,
				});
			return this.getReceipt(command.commandId)!;
		})();
	}

	claimNext(sessionId: string, ownerEpoch: string): SessionControlCommand | undefined {
		return this.#db.transaction(() => {
			const target = this.#db
				.query<{ owner_epoch: string }, { $sessionId: string }>(
					"SELECT owner_epoch FROM control_targets WHERE session_id=$sessionId",
				)
				.get({ $sessionId: sessionId });
			if (target?.owner_epoch !== ownerEpoch) return undefined;
			const row = this.#db
				.query<{ command_id: string; command_json: string }, { $sessionId: string; $ownerEpoch: string }>(
					`SELECT c.command_id, c.command_json FROM control_commands c
					 JOIN control_receipts r ON r.command_id=c.command_id
					 WHERE r.session_id=$sessionId AND r.target_owner_epoch=$ownerEpoch AND r.state='requested'
					 ORDER BY r.requested_at, r.rowid LIMIT 1`,
				)
				.get({ $sessionId: sessionId, $ownerEpoch: ownerEpoch });
			if (!row) return undefined;
			const command = decodeSessionControlCommand(JSON.parse(row.command_json));
			assertLocalSource(command);
			const acknowledgedAt = nowIso();
			const updated = this.#db
				.query(
					"UPDATE control_receipts SET state='acknowledged', acknowledged_at=$at WHERE command_id=$commandId AND state='requested' AND target_owner_epoch=$ownerEpoch",
				)
				.run({ $at: acknowledgedAt, $commandId: row.command_id, $ownerEpoch: ownerEpoch });
			return updated.changes === 1 ? command : undefined;
		})();
	}

	complete(commandId: string, ownerEpoch: string, result: SessionControlResult): SessionControlReceipt {
		const completedAt = nowIso();
		const updated = this.#db
			.query(
				"UPDATE control_receipts SET state='applied', completed_at=$at, result_json=$result, error=NULL WHERE command_id=$commandId AND target_owner_epoch=$ownerEpoch AND state='acknowledged'",
			)
			.run({ $at: completedAt, $result: JSON.stringify(result), $commandId: commandId, $ownerEpoch: ownerEpoch });
		if (updated.changes !== 1)
			throw new Error(`Control command ${commandId} is not acknowledged by owner ${ownerEpoch}`);
		return this.getReceipt(commandId)!;
	}

	fail(commandId: string, ownerEpoch: string, error: unknown): SessionControlReceipt {
		const completedAt = nowIso();
		const message = error instanceof Error ? error.message : String(error);
		const updated = this.#db
			.query(
				"UPDATE control_receipts SET state='failed', completed_at=$at, result_json=NULL, error=$error WHERE command_id=$commandId AND target_owner_epoch=$ownerEpoch AND state='acknowledged'",
			)
			.run({
				$at: completedAt,
				$error: message || "Unknown control failure",
				$commandId: commandId,
				$ownerEpoch: ownerEpoch,
			});
		if (updated.changes !== 1)
			throw new Error(`Control command ${commandId} is not acknowledged by owner ${ownerEpoch}`);
		return this.getReceipt(commandId)!;
	}

	getReceipt(commandId: string): SessionControlReceipt | undefined {
		const row = this.#db
			.query<ReceiptRow, { $commandId: string }>(
				"SELECT command_id,session_id,target_owner_epoch,state,requested_at,acknowledged_at,completed_at,result_json,error FROM control_receipts WHERE command_id=$commandId",
			)
			.get({ $commandId: commandId });
		return row ? decodeReceiptRow(row) : undefined;
	}

	async waitForTerminal(commandId: string, options: SessionControlWaitOptions = {}): Promise<SessionControlReceipt> {
		const timeoutMs = options.timeoutMs ?? 30_000;
		const intervalMs = options.pollIntervalMs ?? 25;
		const deadline = Date.now() + timeoutMs;
		let previousState: SessionControlReceiptState | undefined;
		for (;;) {
			const receipt = this.getReceipt(commandId);
			if (!receipt) throw new Error(`Unknown control command ${commandId}`);
			if (receipt.state !== previousState) {
				previousState = receipt.state;
				options.onReceipt?.(receipt);
			}
			if (receipt.state === "applied" || receipt.state === "failed") return receipt;
			if (Date.now() >= deadline) throw new Error(`Timed out waiting for control command ${commandId}`);
			await Bun.sleep(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
		}
	}

	getPaused(sessionId: string): boolean {
		const row = this.#db
			.query<PausedRow, { $sessionId: string }>(
				"SELECT paused, owner_epoch FROM control_state WHERE session_id=$sessionId",
			)
			.get({ $sessionId: sessionId });
		return row?.paused === 1;
	}

	setPaused(sessionId: string, ownerEpoch: string, paused: boolean): void {
		const result = this.#db
			.query(
				`UPDATE control_state SET paused=$paused, updated_at=$at
				 WHERE session_id=$sessionId AND owner_epoch=$ownerEpoch
				 AND EXISTS (SELECT 1 FROM control_targets WHERE session_id=$sessionId AND owner_epoch=$ownerEpoch)`,
			)
			.run({ $paused: paused ? 1 : 0, $at: nowIso(), $sessionId: sessionId, $ownerEpoch: ownerEpoch });
		if (result.changes !== 1) throw new Error(`Owner ${ownerEpoch} is not the bound control target for ${sessionId}`);
	}
}
