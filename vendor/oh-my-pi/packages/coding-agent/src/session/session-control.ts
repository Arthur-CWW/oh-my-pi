import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Schema } from "effect";
import { type PolicyApplyClass, PolicyApplyClassSchema, type PolicyApplyCommandV1 } from "../policy/policy-records";
import type { FleetProtocolRange } from "./fleet-capability";

export const SESSION_CONTROL_SCHEMA_VERSION = 1 as const;

export const CURRENT_SESSION_CONTROL_PROTOCOL: FleetProtocolRange = {
	minMajor: SESSION_CONTROL_SCHEMA_VERSION,
	maxMajor: 2,
	maxMinor: 0,
};

const UUIDSchema = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)),
);
const NonEmptyStringSchema = Schema.Trim.pipe(Schema.check(Schema.isMinLength(1)));
const SHA256DigestSchema = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)));
const PositiveIntSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)));
const ReadinessReceiptJsonSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
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
const LegacyIntentSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("status") }),
	Schema.Struct({ kind: Schema.Literal("pause") }),
	Schema.Struct({ kind: Schema.Literal("resume") }),
	Schema.Struct({ kind: Schema.Literal("restart"), executable: NonEmptyStringSchema }),
	Schema.Struct({ kind: Schema.Literal("setModel"), selector: NonEmptyStringSchema }),
	Schema.Struct({ kind: Schema.Literal("compact"), instructions: Schema.optional(NonEmptyStringSchema) }),
	Schema.Struct({ kind: Schema.Literal("stop"), confirmationToken: NonEmptyStringSchema }),
]);
const PolicyApplyIntentSchema = Schema.Struct({
	kind: Schema.Literal("policy-apply"),
	policyTransactionId: UUIDSchema,
	policySequence: PositiveIntSchema,
	policyHeadHash: SHA256DigestSchema,
	expectedAppliedSequence: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
	impactedPolicyClasses: Schema.Array(PolicyApplyClassSchema).pipe(Schema.check(Schema.isMinLength(1))),
});
const PrepareRolloutIntentSchema = Schema.Struct({
	kind: Schema.Literal("prepare-rollout"),
	rolloutId: NonEmptyStringSchema,
	expectedDigest: NonEmptyStringSchema,
	drainTimeoutMs: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
});
const RolloutRestartIntentSchema = Schema.Struct({
	kind: Schema.Literal("restart"),
	executable: NonEmptyStringSchema,
	rolloutId: NonEmptyStringSchema,
	targetDigest: NonEmptyStringSchema,
	checkpointCommandId: UUIDSchema,
});
export const FleetPinChannelSchema = Schema.Literals(["digest", "blessed", "canary"]);
export const FleetPinSelectionSchema = Schema.Struct({
	requestedChannel: FleetPinChannelSchema,
	resolvedDigest: SHA256DigestSchema,
	readinessReceipt: Schema.Struct({
		json: ReadinessReceiptJsonSchema,
		digest: SHA256DigestSchema,
	}),
});
const FleetPinIntentSchema = Schema.Struct({
	kind: Schema.Literal("fleet-pin"),
	selection: FleetPinSelectionSchema,
});
const FleetUnpinIntentSchema = Schema.Struct({
	kind: Schema.Literal("fleet-unpin"),
});
const CommandEnvelopeFields = {
	commandId: UUIDSchema,
	source: LocalSourceSchema,
	sessionId: NonEmptyStringSchema,
	targetOwnerEpoch: NonEmptyStringSchema,
	requestedAt: TimestampSchema,
};
/** Immutable strict v1 compatibility lane. */
export const SessionControlCommandV1Schema = Schema.Struct({
	schemaVersion: Schema.Literal(SESSION_CONTROL_SCHEMA_VERSION),
	...CommandEnvelopeFields,
	intent: LegacyIntentSchema,
});
export const PrepareRolloutCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(2),
	...CommandEnvelopeFields,
	intent: PrepareRolloutIntentSchema,
});
export const RolloutRestartCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(2),
	...CommandEnvelopeFields,
	intent: RolloutRestartIntentSchema,
});
export const FleetPinCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(2),
	...CommandEnvelopeFields,
	intent: FleetPinIntentSchema,
});
export const FleetUnpinCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(2),
	...CommandEnvelopeFields,
	intent: FleetUnpinIntentSchema,
});
export const PolicyApplyCommandSchema = Schema.Struct({
	schemaVersion: Schema.Literal(2),
	...CommandEnvelopeFields,
	intent: PolicyApplyIntentSchema,
});
export const SessionControlCommandSchema = Schema.Union([
	SessionControlCommandV1Schema,
	PrepareRolloutCommandSchema,
	RolloutRestartCommandSchema,
	FleetPinCommandSchema,
	FleetUnpinCommandSchema,
	PolicyApplyCommandSchema,
]);
export type LegacySessionControlIntent = typeof LegacyIntentSchema.Type;
export type PrepareRolloutIntent = typeof PrepareRolloutIntentSchema.Type;
export type RolloutRestartIntent = typeof RolloutRestartIntentSchema.Type;
export type FleetPinChannel = typeof FleetPinChannelSchema.Type;
export type FleetPinSelection = typeof FleetPinSelectionSchema.Type;
export type FleetPinIntent = typeof FleetPinIntentSchema.Type;
export type FleetUnpinIntent = typeof FleetUnpinIntentSchema.Type;
export type SessionControlIntent =
	| LegacySessionControlIntent
	| PrepareRolloutIntent
	| RolloutRestartIntent
	| FleetPinIntent
	| FleetUnpinIntent
	| PolicyApplyIntent;
export type SessionControlCommand = typeof SessionControlCommandSchema.Type;
export type PrepareRolloutCommand = typeof PrepareRolloutCommandSchema.Type;
export type RolloutRestartCommand = typeof RolloutRestartCommandSchema.Type;
export type FleetPinCommand = typeof FleetPinCommandSchema.Type;
export type FleetUnpinCommand = typeof FleetUnpinCommandSchema.Type;
export type PolicyApplyIntent = typeof PolicyApplyIntentSchema.Type;
export type PolicyApplyControlCommand = Extract<
	SessionControlCommand,
	{ readonly intent: { readonly kind: "policy-apply" } }
>;
export type { PolicyApplyClass, PolicyApplyCommandV1 };
export type FleetPinControlCommand = FleetPinCommand | FleetUnpinCommand;
export type FleetPinSource = "explicit-digest" | "registry-stable" | "registry-candidate" | "unpin";
export type FleetPinJournalRecord =
	| {
			readonly version: 2;
			readonly action: "pin";
			readonly channel: FleetPinChannel;
			readonly source: Exclude<FleetPinSource, "unpin">;
			readonly digest: string;
			readonly commandId: string;
			readonly recordedAt: string;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: 2;
			readonly action: "unpin";
			readonly channel: "blessed";
			readonly source: "unpin";
			readonly commandId: string;
			readonly recordedAt: string;
			readonly ownerEpoch: string;
	  };
export interface FleetPinControlResult {
	readonly channel: FleetPinChannel;
	readonly digest: string;
	readonly pinned: boolean;
	readonly source: FleetPinSource;
}

const SESSION_CONTROL_INTENT_MAJOR: Record<SessionControlIntent["kind"], number> = {
	status: 1,
	pause: 1,
	resume: 1,
	restart: 1,
	setModel: 1,
	compact: 1,
	stop: 1,
	"prepare-rollout": 2,
	"fleet-pin": 2,
	"fleet-unpin": 2,
	"policy-apply": 2,
};

export function selectSessionControlCommandKind(
	requested: string,
	controller: FleetProtocolRange,
	peer: FleetProtocolRange,
): SessionControlIntent["kind"] | undefined {
	if (!(requested in SESSION_CONTROL_INTENT_MAJOR)) return undefined;
	const kind = requested as SessionControlIntent["kind"];
	const requiredMajor = SESSION_CONTROL_INTENT_MAJOR[kind];
	return requiredMajor >= controller.minMajor &&
		requiredMajor <= controller.maxMajor &&
		requiredMajor >= peer.minMajor &&
		requiredMajor <= peer.maxMajor
		? kind
		: undefined;
}

export const SessionControlFailureCodeSchema = Schema.Literal("session_state_command_in_flight");
export type SessionControlFailureCode = typeof SessionControlFailureCodeSchema.Type;

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
	failureCode: Schema.optional(SessionControlFailureCodeSchema),
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

export function toPolicyApplyCommandV1(command: PolicyApplyControlCommand): PolicyApplyCommandV1 {
	return {
		recordType: "policy-apply-command",
		schemaVersion: 1,
		commandId: command.commandId,
		targetSessionId: command.sessionId,
		targetOwnerEpoch: command.targetOwnerEpoch,
		policyTransactionId: command.intent.policyTransactionId,
		policySequence: command.intent.policySequence,
		policyHeadHash: command.intent.policyHeadHash,
		expectedAppliedSequence: command.intent.expectedAppliedSequence,
		impactedPolicyClasses: command.intent.impactedPolicyClasses,
	};
}
export function isPolicyApplyControlCommand(command: SessionControlCommand): command is PolicyApplyControlCommand {
	return command.intent.kind === "policy-apply";
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
	failure_code: string | null;
}
interface PausedRow {
	paused: number;
	owner_epoch: string;
}

export interface SessionSpawnCordon {
	readonly kind: "SpawnCordoned";
	readonly sessionId: string;
	readonly ownerEpoch: string;
	readonly rolloutId: string;
	readonly expectedDigest: string;
	readonly pauseProvenance: "manual" | "rollout";
	readonly cordonedAt: string;
	readonly checkpointId?: string;
}

interface CordonRow {
	session_id: string;
	owner_epoch: string;
	rollout_id: string;
	expected_digest: string;
	pause_provenance: string;
	cordoned_at: string;
	checkpoint_id: string | null;
}

const activeSpawnCordons = new Map<string, SessionSpawnCordon>();

function decodeCordonRow(row: CordonRow): SessionSpawnCordon {
	if (row.pause_provenance !== "manual" && row.pause_provenance !== "rollout") {
		throw new Error(`Invalid rollout pause provenance ${row.pause_provenance}`);
	}
	return {
		kind: "SpawnCordoned",
		sessionId: row.session_id,
		ownerEpoch: row.owner_epoch,
		rolloutId: row.rollout_id,
		expectedDigest: row.expected_digest,
		pauseProvenance: row.pause_provenance,
		cordonedAt: row.cordoned_at,
		...(row.checkpoint_id === null ? {} : { checkpointId: row.checkpoint_id }),
	};
}

/** Process-local admission projection, hydrated from durable control state when a target binds. */
export function getSessionSpawnCordon(sessionId: string): SessionSpawnCordon | undefined {
	return activeSpawnCordons.get(sessionId);
}

export const SESSION_CONTROL_DB_PATH =
	process.env.OMP_SESSION_CONTROL_DB ?? path.join(os.homedir(), ".omp", "agent", "session-control.sqlite");
const nowIso = (): string => new Date().toISOString();
const MAX_CONTROL_FAILURE_LENGTH = 1024;

/** Render one bounded terminal-receipt failure without discarding Effect tagged-error details. */
export function formatSessionControlFailure(error: unknown): string {
	if (typeof error === "string") {
		const message = error.trim();
		return (message || "ThrownValue: empty string").slice(0, MAX_CONTROL_FAILURE_LENGTH);
	}
	const record = typeof error === "object" && error !== null ? (error as Record<PropertyKey, unknown>) : undefined;
	const taggedName = typeof record?._tag === "string" ? record._tag.trim() : "";
	const errorName = error instanceof Error ? error.name.trim() : "";
	const name = taggedName || errorName || "ThrownValue";
	const directMessage = error instanceof Error ? error.message.trim() : "";
	const issue = typeof record?.issue === "string" ? record.issue.trim() : "";
	const rendered = String(error).trim();
	const fallback =
		rendered && rendered !== name && rendered !== `[object ${name}]` && rendered !== "[object Object]"
			? rendered
			: "";
	const message = directMessage || issue || fallback || "No error message was provided";
	return `${name}: ${message}`.slice(0, MAX_CONTROL_FAILURE_LENGTH);
}

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
		...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
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
				error TEXT,
				failure_code TEXT CHECK(failure_code IS NULL OR failure_code='session_state_command_in_flight')
			)
		`);
		const receiptColumns = new Set(
			this.#db
				.query<{ name: string }, []>("PRAGMA table_info(control_receipts)")
				.all()
				.map(column => column.name),
		);
		if (!receiptColumns.has("failure_code")) {
			this.#db.run(
				"ALTER TABLE control_receipts ADD COLUMN failure_code TEXT CHECK(failure_code IS NULL OR failure_code='session_state_command_in_flight')",
			);
		}
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
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS rollout_cordons (
				session_id TEXT PRIMARY KEY,
				owner_epoch TEXT NOT NULL,
				rollout_id TEXT NOT NULL,
				expected_digest TEXT NOT NULL,
				pause_provenance TEXT NOT NULL CHECK(pause_provenance IN ('manual','rollout')),
				cordoned_at TEXT NOT NULL,
				checkpoint_id TEXT
			)
		`);
		const cordonColumns = new Set(
			this.#db
				.query<{ name: string }, []>("PRAGMA table_info(rollout_cordons)")
				.all()
				.map(column => column.name),
		);
		if (!cordonColumns.has("checkpoint_id")) {
			this.#db.run("ALTER TABLE rollout_cordons ADD COLUMN checkpoint_id TEXT");
		}
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
		const cordon = this.getCordon(sessionId);
		if (cordon) activeSpawnCordons.set(sessionId, cordon);
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
				"UPDATE control_receipts SET state='applied', completed_at=$at, result_json=$result, error=NULL, failure_code=NULL WHERE command_id=$commandId AND target_owner_epoch=$ownerEpoch AND state='acknowledged'",
			)
			.run({ $at: completedAt, $result: JSON.stringify(result), $commandId: commandId, $ownerEpoch: ownerEpoch });
		if (updated.changes !== 1)
			throw new Error(`Control command ${commandId} is not acknowledged by owner ${ownerEpoch}`);
		return this.getReceipt(commandId)!;
	}

	fail(
		commandId: string,
		ownerEpoch: string,
		error: unknown,
		failureCode?: SessionControlFailureCode,
	): SessionControlReceipt {
		const completedAt = nowIso();
		const message = formatSessionControlFailure(error);
		const updated = this.#db
			.query(
				"UPDATE control_receipts SET state='failed', completed_at=$at, result_json=NULL, error=$error, failure_code=$failureCode WHERE command_id=$commandId AND target_owner_epoch=$ownerEpoch AND state='acknowledged'",
			)
			.run({
				$at: completedAt,
				$error: message,
				$failureCode: failureCode ?? null,
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
				"SELECT command_id,session_id,target_owner_epoch,state,requested_at,acknowledged_at,completed_at,result_json,error,failure_code FROM control_receipts WHERE command_id=$commandId",
			)
			.get({ $commandId: commandId });
		return row ? decodeReceiptRow(row) : undefined;
	}
	listReceipts(): SessionControlReceipt[] {
		return this.#db
			.query<ReceiptRow, []>(
				"SELECT command_id,session_id,target_owner_epoch,state,requested_at,acknowledged_at,completed_at,result_json,error,failure_code FROM control_receipts ORDER BY requested_at, rowid",
			)
			.all()
			.map(decodeReceiptRow);
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

	listPaused(): { readonly sessionId: string; readonly ownerEpoch: string; readonly updatedAt: string }[] {
		return this.#db
			.query<{ session_id: string; owner_epoch: string; updated_at: string }, []>(
				"SELECT session_id, owner_epoch, updated_at FROM control_state WHERE paused=1 ORDER BY updated_at",
			)
			.all()
			.map(row => ({ sessionId: row.session_id, ownerEpoch: row.owner_epoch, updatedAt: row.updated_at }));
	}

	getCordon(sessionId: string): SessionSpawnCordon | undefined {
		const row = this.#db
			.query<CordonRow, { $sessionId: string }>(
				`SELECT session_id,owner_epoch,rollout_id,expected_digest,pause_provenance,cordoned_at,checkpoint_id
				 FROM rollout_cordons WHERE session_id=$sessionId`,
			)
			.get({ $sessionId: sessionId });
		return row ? decodeCordonRow(row) : undefined;
	}

	cordon(
		sessionId: string,
		ownerEpoch: string,
		rolloutId: string,
		expectedDigest: string,
		pauseProvenance: "manual" | "rollout",
	): SessionSpawnCordon {
		const cordonedAt = nowIso();
		const updated = this.#db
			.query(
				`INSERT INTO rollout_cordons
				 (session_id,owner_epoch,rollout_id,expected_digest,pause_provenance,cordoned_at,checkpoint_id)
				 SELECT $sessionId,$ownerEpoch,$rolloutId,$expectedDigest,$pauseProvenance,$cordonedAt,NULL
				 WHERE EXISTS (
				 	SELECT 1 FROM control_targets WHERE session_id=$sessionId AND owner_epoch=$ownerEpoch
				 )
				 ON CONFLICT(session_id) DO UPDATE SET
				 	owner_epoch=excluded.owner_epoch,
				 	rollout_id=excluded.rollout_id,
				 	expected_digest=excluded.expected_digest,
				 	pause_provenance=excluded.pause_provenance,
				 	cordoned_at=excluded.cordoned_at,
				 	checkpoint_id=NULL`,
			)
			.run({
				$sessionId: sessionId,
				$ownerEpoch: ownerEpoch,
				$rolloutId: rolloutId,
				$expectedDigest: expectedDigest,
				$pauseProvenance: pauseProvenance,
				$cordonedAt: cordonedAt,
			});
		if (updated.changes !== 1)
			throw new Error(`Owner ${ownerEpoch} is not the bound control target for ${sessionId}`);
		const cordon = this.getCordon(sessionId);
		if (!cordon) throw new Error(`Failed to cordon session ${sessionId}`);
		activeSpawnCordons.set(sessionId, cordon);
		return cordon;
	}
	recordCordonCheckpoint(input: {
		readonly sessionId: string;
		readonly expectedOwnerEpoch: string;
		readonly fleetRolloutId: string;
		readonly checkpointId: string;
	}): SessionSpawnCordon {
		const updated = this.#db
			.query(
				`UPDATE rollout_cordons SET checkpoint_id=$checkpointId
				 WHERE session_id=$sessionId AND owner_epoch=$ownerEpoch AND rollout_id=$rolloutId`,
			)
			.run({
				$sessionId: input.sessionId,
				$ownerEpoch: input.expectedOwnerEpoch,
				$rolloutId: input.fleetRolloutId,
				$checkpointId: input.checkpointId,
			});
		if (updated.changes !== 1) {
			throw new Error(
				`No matching rollout cordon ${input.fleetRolloutId} for owner ${input.expectedOwnerEpoch} of ${input.sessionId}`,
			);
		}
		const cordon = this.getCordon(input.sessionId);
		if (!cordon) throw new Error(`Failed to record checkpoint for cordon ${input.sessionId}`);
		activeSpawnCordons.set(input.sessionId, cordon);
		return cordon;
	}

	releaseCordon(input: {
		readonly sessionId: string;
		readonly expectedOwnerEpoch: string;
		readonly fleetRolloutId: string;
		readonly checkpointId: string;
	}): void {
		const removed = this.#db
			.query(
				`DELETE FROM rollout_cordons
				 WHERE session_id=$sessionId
				   AND owner_epoch=$ownerEpoch
				   AND rollout_id=$rolloutId
				   AND checkpoint_id=$checkpointId
				   AND pause_provenance='rollout'`,
			)
			.run({
				$sessionId: input.sessionId,
				$ownerEpoch: input.expectedOwnerEpoch,
				$rolloutId: input.fleetRolloutId,
				$checkpointId: input.checkpointId,
			});
		if (removed.changes !== 1) {
			throw new Error(
				`No releasable rollout cordon ${input.fleetRolloutId}/${input.checkpointId} for owner ${input.expectedOwnerEpoch} of ${input.sessionId}`,
			);
		}
		activeSpawnCordons.delete(input.sessionId);
	}
}
