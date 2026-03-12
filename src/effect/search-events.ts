import { Effect } from "effect";
import { EventStoreError, stringifyUnknown } from "./core/Errors.js";
import {
	makeEvent,
	type ObservabilityEvent,
	type ObservabilityEventName,
} from "./core/Observability.js";
import { makeSqliteEventStore } from "./observability/EventStore.js";

export interface SearchEventsService {
	readonly emit: (
		name: ObservabilityEventName,
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
	readonly events: ReadonlyArray<ObservabilityEvent>;
}

export const NoopSearchEventsService: SearchEventsService = {
	emit: () => Effect.void,
	close: Effect.void,
};

function failOpenStoreError(error: EventStoreError): Effect.Effect<void, never> {
	return Effect.logWarning(`Search event sink error: ${error.reason}`).pipe(Effect.as(undefined));
}

function failOpenDefect(defect: unknown): Effect.Effect<void, never> {
	return Effect.logWarning(`Search event sink defect: ${stringifyUnknown(defect)}`).pipe(Effect.as(undefined));
}

export function makeInMemorySearchEvents(): InMemorySearchEvents {
	const events: ObservabilityEvent[] = [];
	return {
		service: {
			emit: (name, payload, correlationId, sessionId) =>
				Effect.sync(() => {
					events.push(makeEvent(name, payload, correlationId, sessionId));
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
				store
					.append(makeEvent(name, payload, correlationId, sessionId))
					.pipe(Effect.catch(failOpenStoreError), Effect.catchDefect(failOpenDefect)),
			close: store.close.pipe(Effect.catch(failOpenStoreError), Effect.catchDefect(failOpenDefect)),
		})),
		Effect.catch((error) =>
			Effect.logWarning(`Failed to initialize search event sqlite sink: ${error.reason}`).pipe(
				Effect.as(NoopSearchEventsService),
			),
		),
	);
}
