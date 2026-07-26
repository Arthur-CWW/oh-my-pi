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
	changeKind:
		| "spawn_resolved"
		| "model_change"
		| "thinking_change"
		| "account_change"
		| "hotswap"
		| "fallback"
		| "revert"
		| "advisor_change";
	reason: string | null;
	responsibility: string | null;
	alias: "deprecated-alias" | null;
	route: {
		lane: string;
		provider: string;
		upstreamProvider: string | null;
		model: string;
		account: {
			kind: "configured" | "ambient" | "none";
			ref: string | null;
			provenance: { readonly [key: string]: JsonValue };
		};
		effort: string;
	};
	provenance: {
		resolutionSource:
			| "spawn_explicit"
			| "session_explicit"
			| "session_temporary"
			| "agent_model_override"
			| "responsibility_default"
			| "policy"
			| "policy_enforced"
			| "agent_frontmatter"
			| "session_inherited"
			| "global_default"
			| "automatic_reroute"
			| "auth_fallback"
			| "hard_constraint"
			| "session_strategy"
			| "workspace_policy"
			| "global_policy";
		resolvedLane: string;
		winningLayer:
			| "spawn_explicit"
			| "session_explicit"
			| "session_temporary"
			| "policy"
			| "policy_enforced"
			| "agent_model_override"
			| "responsibility_default"
			| "agent_frontmatter"
			| "session_inherited"
			| "global_default"
			| "automatic_reroute"
			| "auth_fallback"
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
		account: {
			kind: "configured" | "ambient" | "none";
			ref: string | null;
			provenance: { readonly [key: string]: JsonValue };
		};
		effort: string;
		disposition: "selected" | "rerouted";
		fallbackOrdinal: number | null;
		rejectionCode: "quota_admission" | "auth_fallback" | "policy_enforcement" | null;
		rejectionReason: string | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decode durable route events before projecting them into observability views. */
export function isRouteResolutionSource(value: unknown): value is RouteResolutionSource {
	if (!isRecord(value) || !isRecord(value.route) || !isRecord(value.provenance)) return false;
	return (
		value.payloadVersion === 1 &&
		typeof value.agentId === "string" &&
		typeof value.agentSeq === "number" &&
		typeof value.resolutionId === "string" &&
		typeof value.occurredAt === "number" &&
		typeof value.changeKind === "string" &&
		typeof value.route.lane === "string" &&
		typeof value.route.provider === "string" &&
		typeof value.route.model === "string" &&
		typeof value.route.effort === "string" &&
		(value.reason === null || typeof value.reason === "string") &&
		(value.responsibility === null || typeof value.responsibility === "string") &&
		Array.isArray(value.candidates)
	);
}

/** Return one agent's ordered route timeline from the canonical session entries. */
export function routeResolutionEvents(
	entries: readonly SessionEntry[],
	agentId?: string,
): RouteResolutionSource[] {
	const events: RouteResolutionSource[] = [];
	for (const entry of entries) {
		if (
			entry.type !== "custom" ||
			entry.customType !== ROUTE_RESOLUTION_ENTRY ||
			!isRouteResolutionSource(entry.data) ||
			(agentId !== undefined && entry.data.agentId !== agentId)
		)
			continue;
		events.push(entry.data);
	}
	return events.sort((left, right) => left.agentSeq - right.agentSeq || left.occurredAt - right.occurredAt);
}

function nextAgentSeq(entries: readonly SessionEntry[], agentId: string): number {
	let next = 0;
	for (const entry of entries) {
		if (
			entry.type !== "custom" ||
			(entry.customType !== ROUTE_TIMELINE_ENTRY && entry.customType !== ROUTE_RESOLUTION_ENTRY)
		)
			continue;
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
		responsibility: null,
		alias: null,
		route,
		provenance: {
			winningLayer: "session_strategy",
			resolutionSource: "session_strategy",
			resolvedLane: route.lane,
			constraints: [],
			consultedSources: [],
			overriddenValues: [],
		},
		candidates: [
			{
				ordinal: 0,
				lane: route.lane,
				provider,
				model: model.id,
				account: route.account,
				effort: route.effort,
				disposition: "selected",
				fallbackOrdinal: null,
				rejectionCode: null,
				rejectionReason: null,
				failedConstraintIds: [],
			},
		],
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
		...(receipt.priorAttempts ?? [])
			.slice()
			.reverse()
			.map((attempt, index) => {
				const attemptedRoute = routeRecord(attempt.route);
				const quota = attempt.quotaAdmission;
				return {
					ordinal: index + 1,
					lane: attemptedRoute.lane,
					provider: attemptedRoute.provider,
					model: attemptedRoute.model,
					account: attemptedRoute.account,
					effort: attemptedRoute.effort,
					disposition: "rerouted" as const,
					fallbackOrdinal: index,
					rejectionCode: quota
						? ("quota_admission" as const)
						: receipt.routeEnforcement
							? ("policy_enforcement" as const)
							: ("auth_fallback" as const),
					rejectionReason: quota?.decisionReason ?? attempt.reason ?? null,
					failedConstraintIds: [
						quota?.quotaPoolId,
						quota?.limitWindowId,
						receipt.routeEnforcement?.transactionId,
					].filter((value): value is string => value !== undefined),
				};
			}),
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
		responsibility: receipt.responsibility ?? null,
		alias: receipt.alias ?? null,
		route,
		provenance: {
			winningLayer: receipt.source,
			resolutionSource: receipt.resolutionSource,
			resolvedLane: receipt.resolvedLane,
			constraints:
				receipt.source === "automatic_reroute"
					? [receipt.quotaAdmission?.quotaPoolId, receipt.quotaAdmission?.limitWindowId].filter(
							(value): value is string => value !== undefined,
						)
					: receipt.routeEnforcement
						? [receipt.routeEnforcement.transactionId]
						: [],
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

export function appendLifecycleEvent(
	sessionManager: SessionManager,
	agentId: string,
	kind: LifecycleSource["kind"],
	fromState: LifecycleSource["fromState"],
	toState: LifecycleSource["toState"],
): LifecycleSource {
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
