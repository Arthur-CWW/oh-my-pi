import type { Model } from "@oh-my-pi/pi-ai";
import type { SessionEntry } from "../session/session-entries";
import type { SessionManager } from "../session/session-manager";
import type { SpawnRouteReceipt } from "./route-resolution";

export const ROUTE_TIMELINE_ENTRY = "omp:agent-timeline:v1";
export const ROUTE_RESOLUTION_ENTRY = "omp:route-resolution:v1";

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

type Linkage = {
	agentId: string;
	agentSeq: number;
	agentSessionId: string | null;
	parentSessionId: string | null;
	parentAgentId: string | null;
	taskId: string | null;
	packetId: string | null;
	branchId: string | null;
	turnId: string | null;
};

export type SpawnRouteLinkage = Omit<Linkage, "agentSeq" | "agentSessionId"> & {
	readonly agentSessionId?: string | null;
};

export type LifecycleSource = Linkage & {
	payloadVersion: 1;
	eventId: string;
	occurredAt: number;
	kind: "idle" | "park" | "revive";
	fromState: "idle" | "parked";
	toState: "idle" | "parked";
	reason: string | null;
	errorClass: null;
	detail: { readonly [key: string]: JsonValue };
	artifacts: readonly [];
};

export type RouteResolutionSource = Linkage & {
	payloadVersion: 1;
	resolutionId: string;
	occurredAt: number;
	changeKind: "spawn_resolved" | "model_change" | "thinking_change" | "account_change" | "hotswap" | "fallback" | "revert" | "advisor_change";
	reason: string | null;
	route: {
		lane: string;
		provider: string;
		upstreamProvider: string | null;
		model: string;
		account: { kind: "configured" | "ambient" | "none"; ref: string | null; provenance: { readonly [key: string]: JsonValue } };
		effort: string;
	};
	provenance: {
		winningLayer:
			| "spawn_explicit"
			| "session_explicit"
			| "session_temporary"
			| "agent_model_override"
			| "agent_frontmatter"
			| "session_inherited"
			| "global_default"
			| "automatic_reroute"
			| "hard_constraint"
			| "session_strategy"
			| "workspace_policy"
			| "global_policy";
		constraints: readonly string[];
		consultedSources: readonly string[];
		overriddenValues: readonly string[];
	};
	candidates: readonly {
		ordinal: number;
		lane: string;
		provider: string;
		model: string;
		account: { kind: "configured" | "ambient" | "none"; ref: string | null; provenance: { readonly [key: string]: JsonValue } };
		effort: string;
		disposition: "selected" | "rerouted";
		fallbackOrdinal: number | null;
		rejectionCode: null;
		rejectionReason: null;
		failedConstraintIds: readonly string[];
	}[];
	fallbackFromResolutionId: null;
	revertedFromResolutionId: string | null;
	advisors: readonly [];
	rawDecisionArtifactId: null;
	artifacts: readonly [];
};

function isRouteSource(value: JsonValue | undefined): value is { readonly agentId: string; readonly agentSeq: number } {
	if (value === undefined || Array.isArray(value) || typeof value !== "object" || value === null) return false;
	const record = value as { readonly [key: string]: JsonValue };
	return typeof record.agentId === "string" && typeof record.agentSeq === "number";
}

function nextAgentSeq(entries: readonly SessionEntry[], agentId: string): number {
	let next = 0;
	for (const entry of entries) {
		if (entry.type !== "custom" || (entry.customType !== ROUTE_TIMELINE_ENTRY && entry.customType !== ROUTE_RESOLUTION_ENTRY)) continue;
		const data = entry.data as JsonValue | undefined;
		if (!isRouteSource(data) || data.agentId !== agentId) continue;
		next = Math.max(next, data.agentSeq + 1);
	}
	return next;
}

export function createEffectiveHotswapRoute(
	sessionManager: SessionManager,
	agentId: string,
	model: Model,
	reason: string | undefined,
	effort: string | undefined = undefined,
): RouteResolutionSource {
	const agentSeq = nextAgentSeq(sessionManager.getEntries(), agentId);
	const sessionId = sessionManager.getSessionId();
	const provider = model.provider;
	const route: RouteResolutionSource["route"] = {
		lane: `${provider}/${model.id}`,
		provider,
		upstreamProvider: null,
		model: model.id,
		account: { kind: "ambient", ref: null, provenance: { resolver: "active-session-model" } },
		effort: effort ?? "none",
	};
	const event: RouteResolutionSource = {
		agentId,
		agentSeq,
		agentSessionId: sessionId,
		parentSessionId: null,
		parentAgentId: null,
		taskId: null,
		packetId: null,
		branchId: null,
		turnId: null,
		payloadVersion: 1,
		resolutionId: `${agentId}:route:${agentSeq}`,
		occurredAt: Date.now(),
		changeKind: "hotswap",
		reason: reason ?? null,
		route,
		provenance: { winningLayer: "session_strategy", constraints: [], consultedSources: [], overriddenValues: [] },
		candidates: [{ ordinal: 0, lane: route.lane, provider, model: model.id, account: route.account, effort: route.effort, disposition: "selected", fallbackOrdinal: null, rejectionCode: null, rejectionReason: null, failedConstraintIds: [] }],
		fallbackFromResolutionId: null,
		revertedFromResolutionId: null,
		advisors: [],
		rawDecisionArtifactId: null,
		artifacts: [],
	};
	return event;
}

export function appendEffectiveHotswapRoute(
	sessionManager: SessionManager,
	agentId: string,
	model: Model,
	reason: string | undefined,
	effort?: string,
): RouteResolutionSource {
	const event = createEffectiveHotswapRoute(sessionManager, agentId, model, reason, effort);
	sessionManager.appendCustomEntry(ROUTE_RESOLUTION_ENTRY, event);
	return event;
}

function routeRecord(route: SpawnRouteReceipt["route"]): RouteResolutionSource["route"] {
	return {
		lane: route.selector,
		provider: route.provider,
		upstreamProvider: null,
		model: route.model,
		account: { kind: "none", ref: null, provenance: {} },
		effort: route.thinking ?? "none",
	};
}

export function createSpawnRouteResolution(
	sessionManager: SessionManager,
	linkage: SpawnRouteLinkage,
	receipt: SpawnRouteReceipt,
): RouteResolutionSource {
	const agentSeq = nextAgentSeq(sessionManager.getEntries(), linkage.agentId);
	const route = routeRecord(receipt.route);
	const original = receipt.originalRoute ? routeRecord(receipt.originalRoute) : undefined;
	const candidates: RouteResolutionSource["candidates"] = [
		{
			ordinal: 0,
			lane: route.lane,
			provider: route.provider,
			model: route.model,
			account: route.account,
			effort: route.effort,
			disposition: "selected",
			fallbackOrdinal: null,
			rejectionCode: null,
			rejectionReason: null,
			failedConstraintIds: [],
		},
		...(original
			? [{
					ordinal: 1,
					lane: original.lane,
					provider: original.provider,
					model: original.model,
					account: original.account,
					effort: original.effort,
					disposition: "rerouted" as const,
					fallbackOrdinal: 0,
					rejectionCode: null,
					rejectionReason: null,
					failedConstraintIds: [],
				}]
			: []),
	];
	return {
		...linkage,
		agentSeq,
		agentSessionId: linkage.agentSessionId ?? sessionManager.getSessionId(),
		payloadVersion: 1,
		resolutionId: `${linkage.agentId}:route:${agentSeq}`,
		occurredAt: Date.now(),
		changeKind: "spawn_resolved",
		reason: receipt.reason ?? null,
		route,
		provenance: {
			winningLayer: receipt.source,
			constraints: [],
			consultedSources: receipt.consulted.map(input => input.source),
			overriddenValues: receipt.overridden.flatMap(input => input.patterns),
		},
		candidates,
		fallbackFromResolutionId: null,
		revertedFromResolutionId: null,
		advisors: [],
		rawDecisionArtifactId: null,
		artifacts: [],
	};
}

export function appendSpawnRouteResolution(
	sessionManager: SessionManager,
	linkage: SpawnRouteLinkage,
	receipt: SpawnRouteReceipt,
): RouteResolutionSource {
	const event = createSpawnRouteResolution(sessionManager, linkage, receipt);
	sessionManager.appendCustomEntry(ROUTE_RESOLUTION_ENTRY, event);
	return event;
}


export function appendLifecycleEvent(sessionManager: SessionManager, agentId: string, kind: LifecycleSource["kind"], fromState: LifecycleSource["fromState"], toState: LifecycleSource["toState"]): LifecycleSource {
	const agentSeq = nextAgentSeq(sessionManager.getEntries(), agentId);
	const event: LifecycleSource = {
		agentId,
		agentSeq,
		agentSessionId: sessionManager.getSessionId(),
		parentSessionId: null,
		parentAgentId: null,
		taskId: null,
		packetId: null,
		branchId: null,
		turnId: null,
		payloadVersion: 1,
		eventId: `${agentId}:event:${agentSeq}`,
		occurredAt: Date.now(),
		kind,
		fromState,
		toState,
		reason: null,
		errorClass: null,
		detail: {},
		artifacts: [],
	};
	sessionManager.appendCustomEntry(ROUTE_TIMELINE_ENTRY, event);
	return event;
}

