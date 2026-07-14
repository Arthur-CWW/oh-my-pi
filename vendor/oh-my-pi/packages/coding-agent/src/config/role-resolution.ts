import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import MODEL_PRIO from "../priority.json" with { type: "json" };
import { parseThinkingLevel } from "../thinking";
import { MODEL_ROLE_IDS } from "./model-roles";
import type { Settings } from "./settings";

const PREFIX_MODEL_ROLE = "pi/";
export const DEFAULT_MODEL_ROLE = "default";

export interface ExplicitModelRoleReference {
	role: string;
	thinkingLevel?: ThinkingLevel;
}

/**
 * Split a trailing `:<level>` thinking selector off a model or role pattern.
 *
 * `level` is set only when the suffix parses as a valid thinking level, in
 * which case `base` has the suffix stripped; otherwise `base` is the input.
 * `minColonIndex` requires the colon to appear strictly after that index.
 */
export function splitThinkingSuffix(
	pattern: string,
	minColonIndex = -1,
): { base: string; level?: ThinkingLevel } {
	const colonIdx = pattern.lastIndexOf(":");
	if (colonIdx <= minColonIndex) return { base: pattern };
	const level = parseThinkingLevel(pattern.slice(colonIdx + 1));
	return level ? { base: pattern.slice(0, colonIdx), level } : { base: pattern };
}

export function parseExplicitModelRoleReference(value: string): ExplicitModelRoleReference | undefined {
	if (!value.startsWith(PREFIX_MODEL_ROLE)) return undefined;
	const { base, level } = splitThinkingSuffix(value, PREFIX_MODEL_ROLE.length);
	return { role: base.slice(PREFIX_MODEL_ROLE.length), thinkingLevel: level };
}

export function isKnownModelRole(role: string, settings: Settings | undefined): boolean {
	return MODEL_ROLE_IDS.some(candidate => candidate === role) || settings?.getModelRole(role) !== undefined;
}

function getValidModelRoleIds(settings: Settings | undefined): string[] {
	const roles: string[] = [...MODEL_ROLE_IDS];
	if (!settings) return roles;
	for (const role of Object.keys(settings.getModelRoles())) {
		if (!roles.includes(role)) roles.push(role);
	}
	return roles;
}

export function describeModelRoleSource(settings: Settings | undefined, role: string): string {
	switch (settings?.resolveModelRole(role).winningLayer) {
		case "runtime_override":
			return "the runtime override";
		case "config_overlay":
			return "--config";
		case "project":
			return "project config";
		case "global":
			return "global config";
		case "default":
			return "built-in defaults";
		default:
			return "built-in defaults";
	}
}

export function formatUnknownModelRoleError(value: string, settings: Settings | undefined): string {
	const validRoles = getValidModelRoleIds(settings)
		.map(role => `${PREFIX_MODEL_ROLE}${role}`)
		.join(", ");
	return `Unknown model role "${value}". Valid roles: ${validRoles}. Configure role selectors with modelRoles in --config, project, or global settings.`;
}

function normalizeModelPatternList(value: string | string[] | undefined): string[] {
	if (!value) return [];
	const patterns = Array.isArray(value) ? value : value.split(",");
	return patterns.map(pattern => pattern.trim()).filter(Boolean);
}

function isSessionInheritedAgentPattern(value: string): boolean {
	return value === DEFAULT_MODEL_ROLE || value === `${PREFIX_MODEL_ROLE}${DEFAULT_MODEL_ROLE}` || value === "pi/task";
}

function shouldInheritDefaultBeforePriority(role: string): boolean {
	return role === "smol" || role === "slow" || role === "designer";
}

function appendThinkingLevel(patterns: string[], thinkingLevel?: ThinkingLevel): string[] {
	return thinkingLevel ? patterns.map(pattern => `${splitThinkingSuffix(pattern).base}:${thinkingLevel}`) : patterns;
}

function getExplicitRoleAlias(
	value: string,
	settings: Settings | undefined,
): { role: string; thinkingLevel?: ThinkingLevel } | undefined {
	const reference = parseExplicitModelRoleReference(value);
	return reference && isKnownModelRole(reference.role, settings) ? reference : undefined;
}

function getRolePriorityPatterns(role: string): string[] {
	return normalizeModelPatternList(MODEL_PRIO[role as keyof typeof MODEL_PRIO]);
}

function resolveRolePatterns(role: string, settings: Settings | undefined, visited: ReadonlySet<string>): string[] {
	if (visited.has(role)) return getRolePriorityPatterns(role);

	const nextVisited = new Set(visited);
	nextVisited.add(role);
	const configured = normalizeModelPatternList(settings?.getModelRole(role));
	if (configured.length > 0) return resolveConfiguredModelPatterns(configured, settings, nextVisited);

	if (role === "task") return [];
	if (shouldInheritDefaultBeforePriority(role)) {
		const inherited = normalizeModelPatternList(settings?.getModelRole(DEFAULT_MODEL_ROLE));
		if (inherited.length > 0) {
			const resolved = resolveConfiguredModelPatterns(inherited, settings, nextVisited);
			if (resolved.length > 0) return resolved;
		}
	}
	return getRolePriorityPatterns(role);
}

/**
 * Expand a role alias like "pi/smol" to configured or deterministic fallback
 * model patterns. Only an explicit `pi/<role>` is a role alias here; bare
 * model strings remain concrete selectors for the task-input boundary.
 */
export function expandRoleAlias(value: string, settings?: Settings): string {
	const resolved = resolveConfiguredModelPatterns(value, settings);
	return resolved[0] ?? value;
}

export function resolveConfiguredModelPatterns(
	value: string | string[] | undefined,
	settings?: Settings,
	visited: ReadonlySet<string> = new Set(),
): string[] {
	return normalizeModelPatternList(value).flatMap(pattern => {
		const alias = getExplicitRoleAlias(pattern, settings);
		if (!alias) return [pattern];
		return appendThinkingLevel(resolveRolePatterns(alias.role, settings, visited), alias.thinkingLevel);
	});
}

/** Distinct model-routing inputs in descending precedence. */
export interface AgentModelPatternResolutionOptions {
	explicitModel?: string | string[];
	temporaryModel?: string | string[];
	taskOrRoleModel?: string | string[];
	streamModel?: string | string[];
	globalFallbackModel?: string | string[];
	settings?: Settings;
}

export function resolveAgentModelPatterns(options: AgentModelPatternResolutionOptions): string[] {
	const { explicitModel, temporaryModel, taskOrRoleModel, streamModel, globalFallbackModel, settings } = options;

	for (const value of [explicitModel, temporaryModel]) {
		const patterns = resolveConfiguredModelPatterns(value, settings);
		if (patterns.length > 0) return patterns;
	}

	const normalizedTaskOrRolePatterns = normalizeModelPatternList(taskOrRoleModel);
	const taskOrRolePatterns = resolveConfiguredModelPatterns(taskOrRoleModel, settings);
	const singleTaskOrRolePattern =
		normalizedTaskOrRolePatterns.length === 1 ? normalizedTaskOrRolePatterns[0] : undefined;
	const taskOrRoleInheritsSessionModel = singleTaskOrRolePattern
		? isSessionInheritedAgentPattern(singleTaskOrRolePattern)
		: false;
	if (taskOrRolePatterns.length > 0) {
		if (!taskOrRoleInheritsSessionModel || singleTaskOrRolePattern === "pi/task") return taskOrRolePatterns;
	}

	for (const value of [streamModel, globalFallbackModel]) {
		const patterns = resolveConfiguredModelPatterns(value, settings);
		if (patterns.length > 0) return patterns;
	}

	return [];
}

export function extractExplicitThinkingSelector(
	value: string | undefined,
	settings?: Settings,
): ThinkingLevel | undefined {
	if (!value) return undefined;
	const normalized = value.trim();
	if (!normalized || normalized === DEFAULT_MODEL_ROLE) return undefined;

	const visited = new Set<string>();
	let current = normalized;
	while (!visited.has(current)) {
		visited.add(current);
		const thinkingSelector = splitThinkingSuffix(current, PREFIX_MODEL_ROLE.length).level;
		if (thinkingSelector) return thinkingSelector;
		const expanded = expandRoleAlias(current, settings).trim();
		if (!expanded || expanded === current) break;
		if (expanded === DEFAULT_MODEL_ROLE) return undefined;
		current = expanded;
	}

	return undefined;
}
