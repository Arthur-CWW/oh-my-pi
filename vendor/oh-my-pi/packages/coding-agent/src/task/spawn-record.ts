import type { SpawnRouteReceipt } from "./route-resolution";

export const SPAWN_RECORD_VERSION = 1 as const;

/** Durable evidence for one task spawn, stored in the child's session_init entry. */
export interface SpawnRecord {
	readonly version: typeof SPAWN_RECORD_VERSION;
	readonly agentId: string;
	readonly spawnerId: string;
	readonly agentType: string;
	readonly definitionSourcePath: string;
	readonly assignment: string;
	readonly context: string;
	/** Exact assignment and shared context as supplied to the spawn boundary. */
	readonly fullPrompt: string;
	readonly resolvedModel?: string;
	/** Complete resolution receipt, including consulted/overridden layers and fallback attempts. */
	readonly route?: SpawnRouteReceipt;
}

export function composeSpawnPrompt(context: string | undefined, assignment: string): string {
	const normalizedContext = context?.trim() ?? "";
	const normalizedAssignment = assignment.trim();
	if (!normalizedContext) return normalizedAssignment;
	if (!normalizedAssignment) return normalizedContext;
	return `${normalizedContext}\n\n${normalizedAssignment}`;
}

export function createSpawnRecord(input: {
	agentId: string;
	spawnerId: string;
	agentType: string;
	definitionSourcePath: string;
	assignment: string;
	context?: string;
	resolvedModel?: string;
	route?: SpawnRouteReceipt;
}): SpawnRecord {
	const context = input.context?.trim() ?? "";
	const assignment = input.assignment.trim();
	return {
		version: SPAWN_RECORD_VERSION,
		agentId: input.agentId,
		spawnerId: input.spawnerId,
		agentType: input.agentType,
		definitionSourcePath: input.definitionSourcePath,
		assignment,
		context,
		fullPrompt: composeSpawnPrompt(context, assignment),
		...(input.resolvedModel ? { resolvedModel: input.resolvedModel } : {}),
		...(input.route ? { route: input.route } : {}),
	};
}

export function isSpawnRecord(value: unknown): value is SpawnRecord {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === SPAWN_RECORD_VERSION &&
		typeof record.agentId === "string" &&
		typeof record.spawnerId === "string" &&
		typeof record.agentType === "string" &&
		typeof record.definitionSourcePath === "string" &&
		typeof record.assignment === "string" &&
		typeof record.context === "string" &&
		typeof record.fullPrompt === "string" &&
		(record.resolvedModel === undefined || typeof record.resolvedModel === "string")
	);
}
