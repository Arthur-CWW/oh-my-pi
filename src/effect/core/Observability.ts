import { randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";

export type ObservabilityEventName =
	| "SearchRequested"
	| "ProviderSelected"
	| "ProviderAttempted"
	| "ProviderFailed"
	| "ProviderSucceeded"
	| "FallbackAttempted"
	| "ToolCompleted";

export interface ObservabilityEvent {
	readonly eventId: string;
	readonly timestamp: number;
	readonly correlationId: string;
	readonly sessionId?: string;
	readonly name: ObservabilityEventName;
	readonly payload: Record<string, unknown>;
}

export interface ObservabilityService {
	readonly publish: (event: ObservabilityEvent) => Effect.Effect<void, never>;
}

export class Observability extends Context.Tag("pi-web-access/Observability")<
	Observability,
	ObservabilityService
>() {}

export function makeEvent(
	name: ObservabilityEventName,
	payload: Record<string, unknown>,
	correlationId: string,
	sessionId?: string,
): ObservabilityEvent {
	return {
		eventId: randomUUID(),
		timestamp: Date.now(),
		correlationId,
		sessionId,
		name,
		payload,
	};
}

export const NoopObservability = Layer.succeed(Observability, {
	publish: () => Effect.void,
});

export interface InMemoryEventSink {
	readonly events: ReadonlyArray<ObservabilityEvent>;
}

export function makeInMemoryObservability(): {
	readonly layer: Layer.Layer<Observability>;
	readonly sink: InMemoryEventSink;
} {
	const stored: ObservabilityEvent[] = [];
	return {
		layer: Layer.succeed(Observability, {
			publish: (event) =>
				Effect.sync(() => {
					stored.push(event);
				}),
		}),
		sink: {
			get events() {
				return stored;
			},
		},
	};
}
