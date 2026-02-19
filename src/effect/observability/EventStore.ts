import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Effect } from "effect";
import { EventStoreError, stringifyUnknown } from "../core/Errors.js";
import { type ObservabilityEvent, type ObservabilityEventName } from "../core/Observability.js";

type SqliteParam = string | number | bigint | boolean | Uint8Array | null;

interface SqliteStatement {
	readonly run: (...params: ReadonlyArray<SqliteParam>) => unknown;
	readonly all: (...params: ReadonlyArray<SqliteParam>) => unknown;
}

interface SqliteDatabase {
	readonly exec: (sql: string) => unknown;
	readonly prepare: (sql: string) => SqliteStatement;
	readonly close: () => void;
}

interface EventRow {
	readonly event_id: string;
	readonly timestamp: number | bigint;
	readonly correlation_id: string;
	readonly session_id: string | null;
	readonly name: string;
	readonly payload_json: string;
}

export interface SqliteEventStore {
	readonly append: (event: ObservabilityEvent) => Effect.Effect<void, EventStoreError>;
	readonly listByCorrelationId: (
		correlationId: string,
	) => Effect.Effect<ReadonlyArray<ObservabilityEvent>, EventStoreError>;
	readonly listRecent: (limit: number) => Effect.Effect<ReadonlyArray<ObservabilityEvent>, EventStoreError>;
	readonly close: Effect.Effect<void, EventStoreError>;
}

export interface SqliteEventStoreOptions {
	readonly dbPath: string;
	readonly createDir?: boolean;
}

const EVENT_NAMES: ReadonlySet<ObservabilityEventName> = new Set([
	"SearchRequested",
	"ProviderSelected",
	"ProviderAttempted",
	"ProviderFailed",
	"ProviderSucceeded",
	"FallbackAttempted",
	"ToolCompleted",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isEventName(value: string): value is ObservabilityEventName {
	return EVENT_NAMES.has(value as ObservabilityEventName);
}

function toTimestampNumber(value: number | bigint): number {
	return typeof value === "bigint" ? Number(value) : value;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

async function loadSqliteDatabase(dbPath: string): Promise<SqliteDatabase> {
	const errors: string[] = [];

	try {
		const bunSqlite = (await import("bun:sqlite")) as typeof import("bun:sqlite");
		const db = new bunSqlite.Database(dbPath);
		return {
			exec: (sql) => db.exec(sql),
			prepare: (sql) => {
				const statement = db.prepare(sql);
				return {
					run: (...params: ReadonlyArray<SqliteParam>) => statement.run(...params),
					all: (...params: ReadonlyArray<SqliteParam>) => statement.all(...params),
				};
			},
			close: () => db.close(),
		};
	} catch (cause) {
		errors.push(`bun:sqlite unavailable: ${stringifyUnknown(cause)}`);
	}

	try {
		const nodeSqlite = (await import("node:sqlite")) as typeof import("node:sqlite");
		const db = new nodeSqlite.DatabaseSync(dbPath);
		return {
			exec: (sql) => db.exec(sql),
			prepare: (sql) => {
				const statement = db.prepare(sql);
				return {
					run: (...params: ReadonlyArray<SqliteParam>) =>
						statement.run(...(params as ReadonlyArray<import("node:sqlite").SQLInputValue>)),
					all: (...params: ReadonlyArray<SqliteParam>) =>
						statement.all(...(params as ReadonlyArray<import("node:sqlite").SQLInputValue>)),
				};
			},
			close: () => db.close(),
		};
	} catch (cause) {
		errors.push(`node:sqlite unavailable: ${stringifyUnknown(cause)}`);
	}

	throw new Error(`No sqlite driver available (${errors.join("; ")})`);
}

function decodeRow(row: EventRow): Effect.Effect<ObservabilityEvent, EventStoreError> {
	return Effect.try({
		try: () => {
			const eventName = row.name;
			if (!isEventName(eventName)) {
				throw new Error(`Unknown event name: ${row.name}`);
			}

			const payload = JSON.parse(row.payload_json) as unknown;
			if (!isRecord(payload)) {
				throw new Error("Event payload must be a JSON object");
			}

			return {
				eventId: row.event_id,
				timestamp: toTimestampNumber(row.timestamp),
				correlationId: row.correlation_id,
				sessionId: row.session_id ?? undefined,
				name: eventName,
				payload,
			};
		},
		catch: (cause) =>
			new EventStoreError({
				reason: `Failed to decode event row: ${stringifyUnknown(cause)}`,
			}),
	});
}

function decodeRows(rows: unknown): Effect.Effect<ReadonlyArray<ObservabilityEvent>, EventStoreError> {
	if (!Array.isArray(rows)) {
		return Effect.fail(
			new EventStoreError({
				reason: "Expected sqlite query rows to be an array",
			}),
		);
	}

	return Effect.forEach(rows, (row) => {
		if (!isRecord(row)) {
			return Effect.fail(
				new EventStoreError({
					reason: "Encountered non-record sqlite row",
				}),
			);
		}

		const eventRow: EventRow = {
			event_id: asString(row.event_id) ?? "",
			timestamp:
				typeof row.timestamp === "bigint" || typeof row.timestamp === "number"
					? row.timestamp
					: Number.NaN,
			correlation_id: asString(row.correlation_id) ?? "",
			session_id: asString(row.session_id) ?? null,
			name: asString(row.name) ?? "",
			payload_json: asString(row.payload_json) ?? "",
		};

		if (!eventRow.event_id || !eventRow.correlation_id || !eventRow.name || !eventRow.payload_json) {
			return Effect.fail(
				new EventStoreError({
					reason: "Missing required sqlite event row fields",
				}),
			);
		}
		if (!Number.isFinite(toTimestampNumber(eventRow.timestamp))) {
			return Effect.fail(
				new EventStoreError({
					reason: "Event row has invalid timestamp",
				}),
			);
		}

		return decodeRow(eventRow);
	});
}

export function makeSqliteEventStore(
	options: SqliteEventStoreOptions,
): Effect.Effect<SqliteEventStore, EventStoreError> {
	return Effect.tryPromise({
		try: async () => {
			if (options.createDir ?? true) {
				mkdirSync(dirname(options.dbPath), { recursive: true });
			}

			const db = await loadSqliteDatabase(options.dbPath);

			db.exec("PRAGMA journal_mode = WAL;");
			db.exec("PRAGMA synchronous = NORMAL;");
			db.exec(`
				CREATE TABLE IF NOT EXISTS events (
					event_id TEXT PRIMARY KEY,
					timestamp INTEGER NOT NULL,
					correlation_id TEXT NOT NULL,
					session_id TEXT,
					name TEXT NOT NULL,
					payload_json TEXT NOT NULL
				);
				CREATE INDEX IF NOT EXISTS idx_events_correlation_time
					ON events (correlation_id, timestamp);
				CREATE INDEX IF NOT EXISTS idx_events_time
					ON events (timestamp);
			`);

			const insert = db.prepare(`
				INSERT INTO events (event_id, timestamp, correlation_id, session_id, name, payload_json)
				VALUES (?, ?, ?, ?, ?, ?)
			`);
			const byCorrelation = db.prepare(`
				SELECT event_id, timestamp, correlation_id, session_id, name, payload_json
				FROM events
				WHERE correlation_id = ?
				ORDER BY timestamp ASC
			`);
			const recent = db.prepare(`
				SELECT event_id, timestamp, correlation_id, session_id, name, payload_json
				FROM events
				ORDER BY timestamp DESC
				LIMIT ?
			`);

			const append = (event: ObservabilityEvent): Effect.Effect<void, EventStoreError> =>
				Effect.try({
					try: () => {
						insert.run(
							event.eventId,
							event.timestamp,
							event.correlationId,
							event.sessionId ?? null,
							event.name,
							JSON.stringify(event.payload),
						);
					},
					catch: (cause) =>
						new EventStoreError({
							reason: `Failed to append event: ${stringifyUnknown(cause)}`,
						}),
				});

			const listByCorrelationId = (
				correlationId: string,
			): Effect.Effect<ReadonlyArray<ObservabilityEvent>, EventStoreError> =>
				Effect.flatMap(
					Effect.try({
						try: () => byCorrelation.all(correlationId) as unknown,
						catch: (cause) =>
							new EventStoreError({
								reason: `Failed to list events by correlation id: ${stringifyUnknown(cause)}`,
							}),
					}),
					decodeRows,
				);

			const listRecent = (
				limit: number,
			): Effect.Effect<ReadonlyArray<ObservabilityEvent>, EventStoreError> =>
				Effect.flatMap(
					Effect.try({
						try: () => recent.all(Math.max(0, Math.floor(limit))) as unknown,
						catch: (cause) =>
							new EventStoreError({
								reason: `Failed to list recent events: ${stringifyUnknown(cause)}`,
							}),
					}),
					decodeRows,
				);

			const close = Effect.try({
				try: () => {
					db.close();
				},
				catch: (cause) =>
					new EventStoreError({
						reason: `Failed to close sqlite database: ${stringifyUnknown(cause)}`,
					}),
			});

			return {
				append,
				listByCorrelationId,
				listRecent,
				close,
			};
		},
		catch: (cause) =>
			new EventStoreError({
				reason: `Failed to initialize sqlite event store: ${stringifyUnknown(cause)}`,
			}),
	});
}
