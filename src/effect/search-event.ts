import { randomUUID } from "node:crypto";

export type SearchEventName =
	| "SearchRequested"
	| "ProviderSelected"
	| "ProviderAttempted"
	| "ProviderFailed"
	| "ProviderSucceeded"
	| "FallbackAttempted"
	| "ToolCompleted";

export interface SearchEvent {
	readonly eventId: string;
	readonly timestamp: number;
	readonly correlationId: string;
	readonly sessionId?: string;
	readonly name: SearchEventName;
	readonly payload: Record<string, unknown>;
}

export function makeSearchEvent(
	name: SearchEventName,
	payload: Record<string, unknown>,
	correlationId: string,
	sessionId?: string,
): SearchEvent {
	return {
		eventId: randomUUID(),
		timestamp: Date.now(),
		correlationId,
		sessionId,
		name,
		payload,
	};
}
