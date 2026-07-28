import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { getAgentDir, isEnoent, parseJsonlLenient } from "@oh-my-pi/pi-utils";
import { Schema } from "effect";

export const REFUSAL_STORE_SCHEMA_VERSION = 2 as const;
export const REFUSAL_REDACTION_POLICY = "refusal-v2-digest-only" as const;
export const REFUSAL_DB_ENV = "OMP_REFUSALS_DB" as const;
export const REFUSAL_LEGACY_ENV = "OMP_REFUSALS_PATH" as const;
export const REFUSAL_LEGACY_FILENAME = "refusals.jsonl" as const;

export const RefusalRecoveryStateSchema = Schema.Literals([
	"observed",
	"routed",
	"resumed",
	"fallback-failed",
	"retry-requested",
	"retry-failed",
]);
export type RefusalRecoveryState = typeof RefusalRecoveryStateSchema.Type;

export const RefusalReviewStatusSchema = Schema.Literals(["unreviewed", "reviewed"]);
export type RefusalReviewStatus = typeof RefusalReviewStatusSchema.Type;

export const RefusalVerdictSchema = Schema.Literals(["false-positive", "true-positive", "ambiguous"]);
export type RefusalVerdict = typeof RefusalVerdictSchema.Type;

export const RefusalEventTypeSchema = Schema.Literals([
	"refusal-observed",
	"route-persisted",
	"resume-committed",
	"fallback-failed",
	"retry-requested",
	"retry-failed",
	"reviewed",
]);
export type RefusalEventType = typeof RefusalEventTypeSchema.Type;

export interface RefusalRecord {
	readonly schemaVersion: typeof REFUSAL_STORE_SCHEMA_VERSION;
	readonly id: string;
	readonly sessionId: string;
	readonly childId: string | null;
	readonly turnId: string;
	readonly attemptId: string;
	readonly provider: string;
	readonly model: string;
	readonly reasonClass: string;
	readonly promptDigest: string;
	readonly timestamp: number;
	readonly buildVersion: string | null;
	readonly buildDigest: string | null;
	readonly recoveryState: RefusalRecoveryState;
	readonly recoveryModel: string | null;
	readonly recoveryReceipt: string | null;
	readonly reviewStatus: RefusalReviewStatus;
	readonly verdict: RefusalVerdict | null;
	readonly redactionPolicyId: typeof REFUSAL_REDACTION_POLICY;
}

export interface RefusalEvent {
	readonly eventId: number;
	readonly recordId: string;
	readonly type: RefusalEventType;
	readonly timestamp: number;
	readonly recoveryModel: string | null;
	readonly receipt: string | null;
}

export interface RefusalRecordInput {
	readonly id?: string;
	readonly sessionId: string;
	readonly childId?: string | null;
	readonly turnId: string;
	readonly attemptId: string;
	readonly provider: string;
	readonly model: string;
	readonly reasonClass: string;
	readonly promptDigest: string;
	readonly timestamp?: number;
	readonly buildVersion?: string | null;
	readonly buildDigest?: string | null;
}

export interface RefusalListOptions {
	readonly limit?: number;
	readonly provider?: string;
	readonly model?: string;
	readonly reasonClass?: string;
	readonly recoveryState?: RefusalRecoveryState;
	readonly reviewStatus?: RefusalReviewStatus;
	readonly verdict?: RefusalVerdict;
	readonly since?: number;
}

export interface RefusalCount {
	readonly value: string | null;
	readonly count: number;
}

export interface RefusalStats {
	readonly total: number;
	readonly provider: readonly RefusalCount[];
	readonly model: readonly RefusalCount[];
	readonly reasonClass: readonly RefusalCount[];
	readonly recoveryState: readonly RefusalCount[];
	readonly reviewStatus: readonly RefusalCount[];
	readonly verdict: readonly RefusalCount[];
}

export interface RefusalRetryContext {
	readonly recordId: string;
	readonly sessionId: string;
	readonly childId: string | null;
	readonly recoveryModel: string | null;
}

export interface RefusalRetryReceipt {
	readonly accepted: boolean;
	readonly receipt: string;
}

export type RefusalRetryHandler = (context: RefusalRetryContext) => RefusalRetryReceipt | Promise<RefusalRetryReceipt>;

export interface RefusalStoreOptions {
	readonly dbPath?: string;
	readonly legacyPath?: string | null;
	readonly readonly?: boolean;
}

const RefusalRecordSchema = Schema.Struct({
	schemaVersion: Schema.Literal(REFUSAL_STORE_SCHEMA_VERSION),
	id: Schema.String,
	sessionId: Schema.String,
	childId: Schema.NullOr(Schema.String),
	turnId: Schema.String,
	attemptId: Schema.String,
	provider: Schema.String,
	model: Schema.String,
	reasonClass: Schema.String,
	promptDigest: Schema.String,
	timestamp: Schema.Number,
	buildVersion: Schema.NullOr(Schema.String),
	buildDigest: Schema.NullOr(Schema.String),
	recoveryState: RefusalRecoveryStateSchema,
	recoveryModel: Schema.NullOr(Schema.String),
	recoveryReceipt: Schema.NullOr(Schema.String),
	reviewStatus: RefusalReviewStatusSchema,
	verdict: Schema.NullOr(RefusalVerdictSchema),
	redactionPolicyId: Schema.Literal(REFUSAL_REDACTION_POLICY),
});

const LegacyRefusalSchema = Schema.Struct({
	id: Schema.optional(Schema.String),
	caseId: Schema.optional(Schema.String),
	timestamp: Schema.optional(Schema.Number),
	provider: Schema.optional(Schema.String),
	model: Schema.optional(Schema.String),
	modelVersion: Schema.optional(Schema.String),
	version: Schema.optional(Schema.String),
	role: Schema.optional(Schema.String),
	category: Schema.optional(Schema.String),
	sessionId: Schema.optional(Schema.NullOr(Schema.String)),
	turnId: Schema.optional(Schema.NullOr(Schema.String)),
	correlationId: Schema.optional(Schema.NullOr(Schema.String)),
	promptFingerprint: Schema.optional(Schema.String),
	promptExcerpt: Schema.optional(Schema.String),
	safeExcerpt: Schema.optional(Schema.String),
	refusalText: Schema.optional(Schema.String),
	rerouteOutcome: Schema.optional(Schema.NullOr(Schema.String)),
	verdict: Schema.optional(Schema.String),
});

type LegacyRefusal = typeof LegacyRefusalSchema.Type;

interface RefusalRow {
	readonly schema_version: number;
	readonly id: string;
	readonly session_id: string;
	readonly child_id: string | null;
	readonly turn_id: string;
	readonly attempt_id: string;
	readonly provider: string;
	readonly model: string;
	readonly reason_class: string;
	readonly prompt_digest: string;
	readonly occurred_at: number;
	readonly build_version: string | null;
	readonly build_digest: string | null;
	readonly recovery_state: string;
	readonly recovery_model: string | null;
	readonly recovery_receipt: string | null;
	readonly review_status: string;
	readonly verdict: string | null;
	readonly redaction_policy_id: string;
}

interface RefusalEventRow {
	readonly event_id: number;
	readonly record_id: string;
	readonly event_type: string;
	readonly occurred_at: number;
	readonly recovery_model: string | null;
	readonly receipt: string | null;
}

const RECORD_COLUMNS = `schema_version,id,session_id,child_id,turn_id,attempt_id,provider,model,reason_class,prompt_digest,
 occurred_at,build_version,build_digest,recovery_state,recovery_model,recovery_receipt,review_status,verdict,redaction_policy_id`;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function bounded(value: string | null | undefined, maximum = 256): string {
	const normalized = value?.trim() || "unknown";
	return normalized.length <= maximum ? normalized : normalized.slice(0, maximum);
}

function nullable(value: string | null | undefined, maximum = 256): string | null {
	if (value == null || value.trim().length === 0) return null;
	return bounded(value, maximum);
}

export function digestRefusalPrompt(prompt: string): string {
	return createHash("sha256").update(prompt).digest("hex");
}

export function defaultRefusalDatabasePath(): string {
	return (
		Bun.env[REFUSAL_DB_ENV]?.trim() ||
		Bun.env.OMP_SESSION_CONTROL_DB?.trim() ||
		path.join(getAgentDir(), "session-control.sqlite")
	);
}

export function defaultLegacyRefusalPath(): string {
	return Bun.env[REFUSAL_LEGACY_ENV]?.trim() || path.join(getAgentDir(), REFUSAL_LEGACY_FILENAME);
}

function decodeRow(row: RefusalRow): RefusalRecord {
	return Schema.decodeUnknownSync(RefusalRecordSchema)(
		{
			schemaVersion: row.schema_version,
			id: row.id,
			sessionId: row.session_id,
			childId: row.child_id,
			turnId: row.turn_id,
			attemptId: row.attempt_id,
			provider: row.provider,
			model: row.model,
			reasonClass: row.reason_class,
			promptDigest: row.prompt_digest,
			timestamp: row.occurred_at,
			buildVersion: row.build_version,
			buildDigest: row.build_digest,
			recoveryState: row.recovery_state,
			recoveryModel: row.recovery_model,
			recoveryReceipt: row.recovery_receipt,
			reviewStatus: row.review_status,
			verdict: row.verdict,
			redactionPolicyId: row.redaction_policy_id,
		},
		{ onExcessProperty: "error" },
	);
}

function decodeEventRow(row: RefusalEventRow): RefusalEvent {
	const type = Schema.decodeUnknownSync(RefusalEventTypeSchema)(row.event_type);
	return {
		eventId: row.event_id,
		recordId: row.record_id,
		type,
		timestamp: row.occurred_at,
		recoveryModel: row.recovery_model,
		receipt: row.receipt,
	};
}

function normalizeInput(input: RefusalRecordInput): Required<Omit<RefusalRecordInput, "childId" | "buildVersion" | "buildDigest">> & {
	readonly childId: string | null;
	readonly buildVersion: string | null;
	readonly buildDigest: string | null;
} {
	if (!SHA256_PATTERN.test(input.promptDigest)) throw new Error("Refusal promptDigest must be a lowercase SHA-256 digest");
	return {
		id: input.id?.trim() || randomUUID(),
		sessionId: bounded(input.sessionId),
		childId: nullable(input.childId),
		turnId: bounded(input.turnId),
		attemptId: bounded(input.attemptId),
		provider: bounded(input.provider, 128),
		model: bounded(input.model),
		reasonClass: bounded(input.reasonClass, 128),
		promptDigest: input.promptDigest,
		timestamp: input.timestamp ?? Date.now(),
		buildVersion: nullable(input.buildVersion),
		buildDigest: nullable(input.buildDigest),
	};
}

function legacyPromptDigest(record: LegacyRefusal): string {
	if (record.promptFingerprint && SHA256_PATTERN.test(record.promptFingerprint)) return record.promptFingerprint;
	return digestRefusalPrompt(record.promptExcerpt ?? record.safeExcerpt ?? "");
}

function legacyVerdict(record: LegacyRefusal): RefusalVerdict | null {
	if (record.verdict === "false-positive" || record.verdict === "true-positive" || record.verdict === "ambiguous") {
		return record.verdict;
	}
	if (record.verdict === "confirmed") return "true-positive";
	return null;
}

export class RefusalStore {
	readonly #db: Database;
	readonly #readonly: boolean;
	readonly #dbPath: string;

	constructor(options: RefusalStoreOptions = {}) {
		this.#readonly = options.readonly ?? false;
		this.#dbPath = options.dbPath ?? defaultRefusalDatabasePath();
		if (!this.#readonly) fs.mkdirSync(path.dirname(this.#dbPath), { recursive: true });
		this.#db = this.#readonly ? new Database(this.#dbPath, { readonly: true }) : new Database(this.#dbPath);
		this.#db.run("PRAGMA busy_timeout = 5000");
		if (!this.#readonly) {
			this.#initialize();
			const legacyPath = options.legacyPath === undefined ? defaultLegacyRefusalPath() : options.legacyPath;
			if (legacyPath) this.migrateLegacy(legacyPath);
		}
	}

	get dbPath(): string {
		return this.#dbPath;
	}

	close(): void {
		this.#db.close();
	}

	#initialize(): void {
		this.#db.run("PRAGMA journal_mode = WAL");
		this.#db.run("PRAGMA synchronous = FULL");
		this.#db.run(`CREATE TABLE IF NOT EXISTS refusal_records (
			schema_version INTEGER NOT NULL,
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			child_id TEXT,
			turn_id TEXT NOT NULL,
			attempt_id TEXT NOT NULL,
			provider TEXT NOT NULL,
			model TEXT NOT NULL,
			reason_class TEXT NOT NULL,
			prompt_digest TEXT NOT NULL,
			occurred_at INTEGER NOT NULL,
			build_version TEXT,
			build_digest TEXT,
			recovery_state TEXT NOT NULL,
			recovery_model TEXT,
			recovery_receipt TEXT,
			review_status TEXT NOT NULL,
			verdict TEXT,
			redaction_policy_id TEXT NOT NULL,
			UNIQUE(session_id, attempt_id)
		)`);
		this.#db.run(`CREATE TABLE IF NOT EXISTS refusal_events (
			event_id INTEGER PRIMARY KEY AUTOINCREMENT,
			record_id TEXT NOT NULL REFERENCES refusal_records(id),
			event_type TEXT NOT NULL,
			occurred_at INTEGER NOT NULL,
			recovery_model TEXT,
			receipt TEXT
		)`);
		this.#db.run(`CREATE TABLE IF NOT EXISTS refusal_migrations (
			source_path TEXT NOT NULL,
			source_digest TEXT NOT NULL,
			migrated_at INTEGER NOT NULL,
			row_count INTEGER NOT NULL,
			PRIMARY KEY(source_path, source_digest)
		)`);
		this.#db.run("CREATE INDEX IF NOT EXISTS idx_refusals_time ON refusal_records(occurred_at DESC)");
		this.#db.run("CREATE INDEX IF NOT EXISTS idx_refusals_session ON refusal_records(session_id, occurred_at DESC)");
		this.#db.run("CREATE INDEX IF NOT EXISTS idx_refusal_events_record ON refusal_events(record_id, event_id)");
	}

	record(input: RefusalRecordInput): RefusalRecord {
		if (this.#readonly) throw new Error("Refusal store is read-only");
		const normalized = normalizeInput(input);
		this.#db.transaction(() => {
			const inserted = this.#db
				.query(`INSERT OR IGNORE INTO refusal_records (${RECORD_COLUMNS}) VALUES (
					$schemaVersion,$id,$sessionId,$childId,$turnId,$attemptId,$provider,$model,$reasonClass,$promptDigest,
					$timestamp,$buildVersion,$buildDigest,'observed',NULL,NULL,'unreviewed',NULL,$redactionPolicyId)`)
				.run({
					$schemaVersion: REFUSAL_STORE_SCHEMA_VERSION,
					$id: normalized.id,
					$sessionId: normalized.sessionId,
					$childId: normalized.childId,
					$turnId: normalized.turnId,
					$attemptId: normalized.attemptId,
					$provider: normalized.provider,
					$model: normalized.model,
					$reasonClass: normalized.reasonClass,
					$promptDigest: normalized.promptDigest,
					$timestamp: normalized.timestamp,
					$buildVersion: normalized.buildVersion,
					$buildDigest: normalized.buildDigest,
					$redactionPolicyId: REFUSAL_REDACTION_POLICY,
				});
			if (inserted.changes === 1) {
				this.#insertEvent(normalized.id, "refusal-observed", normalized.timestamp, null, null);
			}
		})();
		const existing = this.#db
			.query<RefusalRow, { $sessionId: string; $attemptId: string }>(
				`SELECT ${RECORD_COLUMNS} FROM refusal_records WHERE session_id=$sessionId AND attempt_id=$attemptId`,
			)
			.get({ $sessionId: normalized.sessionId, $attemptId: normalized.attemptId });
		if (!existing) throw new Error("Failed to record refusal");
		return decodeRow(existing);
	}

	persistRoute(id: string, recoveryModel: string, receipt: string, timestamp = Date.now()): RefusalRecord {
		return this.#transition(id, "routed", recoveryModel, receipt, "route-persisted", timestamp);
	}

	commitResume(id: string, recoveryModel: string, receipt: string, timestamp = Date.now()): RefusalRecord {
		return this.#transition(id, "resumed", recoveryModel, receipt, "resume-committed", timestamp);
	}

	failRecovery(id: string, recoveryModel: string | null, receipt: string, timestamp = Date.now()): RefusalRecord {
		return this.#transition(id, "fallback-failed", recoveryModel, receipt, "fallback-failed", timestamp);
	}

	#transition(
		id: string,
		state: RefusalRecoveryState,
		recoveryModel: string | null,
		receipt: string,
		event: RefusalEventType,
		timestamp: number,
	): RefusalRecord {
		if (this.#readonly) throw new Error("Refusal store is read-only");
		this.#db.transaction(() => {
			const result = this.#db
				.query("UPDATE refusal_records SET recovery_state=$state,recovery_model=$model,recovery_receipt=$receipt WHERE id=$id")
				.run({ $state: state, $model: recoveryModel, $receipt: bounded(receipt, 512), $id: id });
			if (result.changes !== 1) throw new Error(`Refusal record not found: ${id}`);
			this.#insertEvent(id, event, timestamp, recoveryModel, receipt);
		})();
		const record = this.get(id);
		if (!record) throw new Error(`Refusal record not found: ${id}`);
		return record;
	}

	#insertEvent(
		recordId: string,
		type: RefusalEventType,
		timestamp: number,
		recoveryModel: string | null,
		receipt: string | null,
	): void {
		this.#db
			.query("INSERT INTO refusal_events (record_id,event_type,occurred_at,recovery_model,receipt) VALUES ($recordId,$type,$timestamp,$model,$receipt)")
			.run({
				$recordId: recordId,
				$type: type,
				$timestamp: timestamp,
				$model: recoveryModel,
				$receipt: receipt === null ? null : bounded(receipt, 512),
			});
	}

	get(id: string): RefusalRecord | undefined {
		const row = this.#db
			.query<RefusalRow, { $id: string }>(`SELECT ${RECORD_COLUMNS} FROM refusal_records WHERE id=$id`)
			.get({ $id: id });
		return row ? decodeRow(row) : undefined;
	}

	events(id: string): readonly RefusalEvent[] {
		return this.#db
			.query<RefusalEventRow, { $id: string }>(
				"SELECT event_id,record_id,event_type,occurred_at,recovery_model,receipt FROM refusal_events WHERE record_id=$id ORDER BY event_id",
			)
			.all({ $id: id })
			.map(decodeEventRow);
	}

	list(options: RefusalListOptions = {}): readonly RefusalRecord[] {
		const clauses: string[] = [];
		const bindings: Record<string, string | number> = {};
		const add = (column: string, key: string, value: string | number | undefined): void => {
			if (value === undefined) return;
			clauses.push(`${column}=$${key}`);
			bindings[`$${key}`] = value;
		};
		add("provider", "provider", options.provider);
		add("model", "model", options.model);
		add("reason_class", "reasonClass", options.reasonClass);
		add("recovery_state", "recoveryState", options.recoveryState);
		add("review_status", "reviewStatus", options.reviewStatus);
		add("verdict", "verdict", options.verdict);
		if (options.since !== undefined) {
			clauses.push("occurred_at >= $since");
			bindings.$since = options.since;
		}
		const limit = Math.max(0, Math.min(500, options.limit ?? 50));
		bindings.$limit = limit;
		const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
		return this.#db
			.query<RefusalRow, Record<string, string | number>>(
				`SELECT ${RECORD_COLUMNS} FROM refusal_records${where} ORDER BY occurred_at DESC,id LIMIT $limit`,
			)
			.all(bindings)
			.map(decodeRow);
	}

	stats(): RefusalStats {
		return {
			total: this.#countTotal(),
			provider: this.#counts("provider"),
			model: this.#counts("model"),
			reasonClass: this.#counts("reason_class"),
			recoveryState: this.#counts("recovery_state"),
			reviewStatus: this.#counts("review_status"),
			verdict: this.#counts("verdict"),
		};
	}

	#countTotal(): number {
		return this.#db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM refusal_records").get()?.count ?? 0;
	}

	#counts(column: "provider" | "model" | "reason_class" | "recovery_state" | "review_status" | "verdict"): RefusalCount[] {
		return this.#db
			.query<{ value: string | null; count: number }, []>(
				`SELECT ${column} AS value,COUNT(*) AS count FROM refusal_records GROUP BY ${column} ORDER BY count DESC,value`,
			)
			.all();
	}

	countAutomaticRecoveries(sessionId: string): number {
		return (
			this.#db
				.query<{ count: number }, { $sessionId: string }>(
					"SELECT COUNT(*) AS count FROM refusal_records WHERE session_id=$sessionId AND recovery_state IN ('routed','resumed','fallback-failed')",
				)
				.get({ $sessionId: sessionId })?.count ?? 0
		);
	}

	review(id: string, verdict: RefusalVerdict, timestamp = Date.now()): RefusalRecord {
		if (this.#readonly) throw new Error("Refusal store is read-only");
		this.#db.transaction(() => {
			const result = this.#db
				.query("UPDATE refusal_records SET review_status='reviewed',verdict=$verdict WHERE id=$id")
				.run({ $verdict: verdict, $id: id });
			if (result.changes !== 1) throw new Error(`Refusal record not found: ${id}`);
			this.#insertEvent(id, "reviewed", timestamp, null, null);
		})();
		const record = this.get(id);
		if (!record) throw new Error(`Refusal record not found: ${id}`);
		return record;
	}

	async retry(id: string, handler?: RefusalRetryHandler): Promise<RefusalRecord> {
		const current = this.get(id);
		if (!current) throw new Error(`Refusal record not found: ${id}`);
		const context: RefusalRetryContext = {
			recordId: current.id,
			sessionId: current.sessionId,
			childId: current.childId,
			recoveryModel: current.recoveryModel,
		};
		const result = handler
			? await handler(context)
			: { accepted: true, receipt: `manual-retry:${randomUUID()}` } satisfies RefusalRetryReceipt;
		return this.#transition(
			id,
			result.accepted ? "retry-requested" : "retry-failed",
			current.recoveryModel,
			result.receipt,
			result.accepted ? "retry-requested" : "retry-failed",
			Date.now(),
		);
	}

	migrateLegacy(legacyPath: string): number {
		if (this.#readonly) throw new Error("Refusal store is read-only");
		let raw: string;
		try {
			raw = fs.readFileSync(legacyPath, "utf8");
		} catch (error) {
			if (isEnoent(error)) return 0;
			throw error;
		}
		const sourcePath = path.resolve(legacyPath);
		const sourceDigest = createHash("sha256").update(raw).digest("hex");
		const migrated = this.#db
			.query<{ row_count: number }, { $sourcePath: string; $sourceDigest: string }>(
				"SELECT row_count FROM refusal_migrations WHERE source_path=$sourcePath AND source_digest=$sourceDigest",
			)
			.get({ $sourcePath: sourcePath, $sourceDigest: sourceDigest });
		if (migrated) return migrated.row_count;

		const decoded: LegacyRefusal[] = [];
		for (const value of parseJsonlLenient<unknown>(raw)) {
			try {
				decoded.push(Schema.decodeUnknownSync(LegacyRefusalSchema)(value));
			} catch {
				// Malformed historical rows are skipped without hiding later valid rows.
			}
		}
		let rowCount = 0;
		this.#db.transaction(() => {
			for (let index = 0; index < decoded.length; index++) {
				const record = decoded[index];
				const sourceId = record.id?.trim() || record.caseId?.trim() || `${sourceDigest}:${index}`;
				const id = `legacy:${createHash("sha256").update(`${sourcePath}\0${sourceId}`).digest("hex")}`;
				const sessionId = record.sessionId?.trim() || `legacy:${sourceDigest}`;
				const attemptId = record.correlationId?.trim() || sourceId;
				const inserted = this.#db
					.query(`INSERT OR IGNORE INTO refusal_records (${RECORD_COLUMNS}) VALUES (
						$schemaVersion,$id,$sessionId,NULL,$turnId,$attemptId,$provider,$model,$reasonClass,$promptDigest,
						$timestamp,$buildVersion,NULL,$state,NULL,NULL,$reviewStatus,$verdict,$redactionPolicyId)`)
					.run({
						$schemaVersion: REFUSAL_STORE_SCHEMA_VERSION,
						$id: id,
						$sessionId: sessionId,
						$turnId: record.turnId?.trim() || sourceId,
						$attemptId: attemptId,
						$provider: bounded(record.provider, 128),
						$model: bounded(record.model),
						$reasonClass: bounded(record.category, 128),
						$promptDigest: legacyPromptDigest(record),
						$timestamp: record.timestamp ?? 0,
						$buildVersion: nullable(record.modelVersion ?? record.version),
						$state: record.rerouteOutcome ? "resumed" : "observed",
						$reviewStatus: legacyVerdict(record) ? "reviewed" : "unreviewed",
						$verdict: legacyVerdict(record),
						$redactionPolicyId: REFUSAL_REDACTION_POLICY,
					});
				if (inserted.changes === 1) {
					rowCount++;
					this.#insertEvent(id, "refusal-observed", record.timestamp ?? 0, null, null);
				}
			}
			this.#db
				.query("INSERT INTO refusal_migrations (source_path,source_digest,migrated_at,row_count) VALUES ($sourcePath,$sourceDigest,$migratedAt,$rowCount)")
				.run({
					$sourcePath: sourcePath,
					$sourceDigest: sourceDigest,
					$migratedAt: Date.now(),
					$rowCount: rowCount,
				});
		})();
		return rowCount;
	}
}
