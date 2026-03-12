import { Effect } from "effect";
import { makeSqliteEventStore } from "./observability/EventStore.js";
import { makeSearchEvent, type SearchEvent, type SearchEventName } from "./search-event.js";

export interface SearchEventsService {
	readonly emit: (
		name: SearchEventName,
		payload: Record<string, unknown>,
		correlationId: string,
		sessionId?: string,
	) => Effect.Effect<void, never>;
	readonly close: Effect.Effect<void, never>;
}

export interface SearchEventsOptions {
	readonly dbPath?: string;
	readonly createDir?: boolean;
}

export interface InMemorySearchEvents {
	readonly service: SearchEventsService;
	readonly events: ReadonlyArray<SearchEvent>;
}

export const NoopSearchEventsService: SearchEventsService = {
	emit: () => Effect.void,
	close: Effect.void,
};

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

function logFailOpen(label: string, error: unknown): Effect.Effect<void, never> {
	return Effect.logWarning(`${label}: ${toErrorMessage(error)}`).pipe(Effect.as(undefined));
}

export function makeInMemorySearchEvents(): InMemorySearchEvents {
	const events: SearchEvent[] = [];
	return {
		service: {
			emit: (name, payload, correlationId, sessionId) =>
				Effect.sync(() => {
					events.push(makeSearchEvent(name, payload, correlationId, sessionId));
				}),
			close: Effect.void,
		},
		get events() {
			return events;
		},
	};
}

export function makeSearchEventsService(
	options: SearchEventsOptions = {},
): Effect.Effect<SearchEventsService, never> {
	if (!options.dbPath) {
		return Effect.succeed(NoopSearchEventsService);
	}

	return makeSqliteEventStore({
		dbPath: options.dbPath,
		createDir: options.createDir,
	}).pipe(
		Effect.map((store): SearchEventsService => ({
			emit: (name, payload, correlationId, sessionId) =>
				store.append(makeSearchEvent(name, payload, correlationId, sessionId)).pipe(
					Effect.catch((error) => logFailOpen("Search event sink error", error)),
					Effect.catchDefect((defect) => logFailOpen("Search event sink defect", defect)),
				),
			close: store.close.pipe(
				Effect.catch((error) => logFailOpen("Search event sink error", error)),
				Effect.catchDefect((defect) => logFailOpen("Search event sink defect", defect)),
			),
		})),
		Effect.catch((error) =>
			Effect.logWarning(
				`Failed to initialize search event sqlite sink: ${toErrorMessage(error)}`,
			).pipe(Effect.as(NoopSearchEventsService)),
		),
	);
}
