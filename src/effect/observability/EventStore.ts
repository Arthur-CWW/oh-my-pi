import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Data, Effect, Exit, Scope } from "effect";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import { type SearchEvent, type SearchEventName } from "../search-event.js";

interface EventRow {
	readonly event_id: string;
	readonly timestamp: number | bigint;
	readonly correlation_id: string;
	readonly session_id: string | null;
	readonly name: string;
	readonly payload_json: string;
}

export class EventStoreError extends Data.TaggedError("EventStoreError")<{
	readonly reason: string;
}> {}

export interface SqliteEventStore {
	readonly append: (event: SearchEvent) => Effect.Effect<void, EventStoreError>;
	readonly listByCorrelationId: (
		correlationId: string,
	) => Effect.Effect<ReadonlyArray<SearchEvent>, EventStoreError>;
	readonly listRecent: (limit: number) => Effect.Effect<ReadonlyArray<SearchEvent>, EventStoreError>;
	readonly close: Effect.Effect<void>;
}

export interface SqliteEventStoreOptions {
	readonly dbPath: string;
	readonly createDir?: boolean;
}

const EVENT_NAMES: ReadonlySet<SearchEventName> = new Set([
	"SearchRequested",
	"ProviderSelected",
	"ProviderAttempted",
	"ProviderFailed",
	"ProviderSucceeded",
	"FallbackAttempted",
	"ToolCompleted",
]);

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (error && typeof error === "object" && "reason" in error) {
		const reason = (error as { readonly reason: unknown }).reason;
		if (typeof reason === "string") {
			return reason;
		}
	}
	return String(error);
}

function toEventStoreError(context: string, error: unknown): EventStoreError {
	return new EventStoreError({
		reason: `${context}: ${toErrorMessage(error)}`,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isEventName(value: unknown): value is SearchEventName {
	return typeof value === "string" && EVENT_NAMES.has(value as SearchEventName);
}

function toTimestampNumber(value: number | bigint): number {
	return typeof value === "bigint" ? Number(value) : value;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

const decodeRow = Effect.fn("EventStore.decodeRow")(function* (
	row: EventRow,
): Effect.fn.Return<SearchEvent, EventStoreError> {
	if (!isEventName(row.name)) {
		return yield* Effect.fail(
			new EventStoreError({
				reason: `Unknown event name: ${row.name}`,
			}),
		);
	}

	const payload = yield* Effect.try({
		try: () => JSON.parse(row.payload_json) as unknown,
		catch: (cause) => toEventStoreError("Failed to parse sqlite event payload", cause),
	});
	if (!isRecord(payload)) {
		return yield* Effect.fail(
			new EventStoreError({
				reason: "Event payload must be a JSON object",
			}),
		);
	}

	return {
		eventId: row.event_id,
		timestamp: toTimestampNumber(row.timestamp),
		correlationId: row.correlation_id,
		sessionId: row.session_id ?? undefined,
		name: row.name,
		payload,
	};
});

const decodeRows = Effect.fn("EventStore.decodeRows")(function* (
	rows: unknown,
): Effect.fn.Return<ReadonlyArray<SearchEvent>, EventStoreError> {
	if (!Array.isArray(rows)) {
		return yield* Effect.fail(
			new EventStoreError({
				reason: "Expected sqlite query rows to be an array",
			}),
		);
	}

	return yield* Effect.forEach(rows, (row) => {
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
});

export const makeSqliteEventStore = Effect.fn("EventStore.makeSqliteEventStore")(function* (
	options: SqliteEventStoreOptions,
): Effect.fn.Return<SqliteEventStore, EventStoreError> {
	if (options.createDir ?? true) {
		yield* Effect.try({
			try: () => mkdirSync(dirname(options.dbPath), { recursive: true }),
			catch: (cause) => toEventStoreError("Failed to create sqlite event-store directory", cause),
		});
	}

	const scope = yield* Scope.make();
	const sql = yield* SqliteClient.make({ filename: options.dbPath }).pipe(
		Scope.provide(scope),
		Effect.provide(Reactivity.layer),
	);

	yield* sql`PRAGMA journal_mode = WAL;`.pipe(
		Effect.as(undefined),
		Effect.mapError((cause) => toEventStoreError("Failed to enable sqlite WAL mode", cause)),
	);
	yield* sql`PRAGMA synchronous = NORMAL;`.pipe(
		Effect.as(undefined),
		Effect.mapError((cause) => toEventStoreError("Failed to configure sqlite synchronous mode", cause)),
	);
	yield* sql`
		CREATE TABLE IF NOT EXISTS events (
			event_id TEXT PRIMARY KEY,
			timestamp INTEGER NOT NULL,
			correlation_id TEXT NOT NULL,
			session_id TEXT,
			name TEXT NOT NULL,
			payload_json TEXT NOT NULL
		)
	`.pipe(
		Effect.as(undefined),
		Effect.mapError((cause) => toEventStoreError("Failed to initialize sqlite event table", cause)),
	);
	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_events_correlation_time
		ON events (correlation_id, timestamp)
	`.pipe(
		Effect.as(undefined),
		Effect.mapError((cause) =>
			toEventStoreError("Failed to initialize sqlite correlation index", cause),
		),
	);
	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_events_time
		ON events (timestamp)
	`.pipe(
		Effect.as(undefined),
		Effect.mapError((cause) => toEventStoreError("Failed to initialize sqlite time index", cause)),
	);

	const append = (event: SearchEvent): Effect.Effect<void, EventStoreError> =>
		sql`
			INSERT INTO events (event_id, timestamp, correlation_id, session_id, name, payload_json)
			VALUES (
				${event.eventId},
				${event.timestamp},
				${event.correlationId},
				${event.sessionId ?? null},
				${event.name},
				${JSON.stringify(event.payload)}
			)
		`.pipe(
			Effect.as(undefined),
			Effect.mapError((cause) => toEventStoreError("Failed to append event", cause)),
		);

	const listByCorrelationId = (
		correlationId: string,
	): Effect.Effect<ReadonlyArray<SearchEvent>, EventStoreError> =>
		sql<EventRow>`
			SELECT event_id, timestamp, correlation_id, session_id, name, payload_json
			FROM events
			WHERE correlation_id = ${correlationId}
			ORDER BY timestamp ASC
		`.pipe(
			Effect.mapError((cause) =>
				toEventStoreError("Failed to list events by correlation id", cause),
			),
			Effect.flatMap(decodeRows),
		);

	const listRecent = (limit: number): Effect.Effect<ReadonlyArray<SearchEvent>, EventStoreError> =>
		sql<EventRow>`
			SELECT event_id, timestamp, correlation_id, session_id, name, payload_json
			FROM events
			ORDER BY timestamp DESC
			LIMIT ${Math.max(0, Math.floor(limit))}
		`.pipe(
			Effect.mapError((cause) => toEventStoreError("Failed to list recent events", cause)),
			Effect.flatMap(decodeRows),
		);

	return {
		append,
		listByCorrelationId,
		listRecent,
		close: Scope.close(scope, Exit.void),
	};
});
