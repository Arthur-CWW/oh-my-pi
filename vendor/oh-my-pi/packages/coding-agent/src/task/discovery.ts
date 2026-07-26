/**
 * Agent discovery from filesystem.
 *
 * Discovers agent definitions from OMP-native task-agent roots:
 *   - ~/.omp/agent/agents/*.md (user-level)
 *   - .omp/agents/*.md (project-level)
 *
 * Claude Code marketplace plugin agents are discovered separately via the
 * claude-plugins provider. Direct cross-harness roots such as .claude/agents
 * are intentionally skipped because their frontmatter schema is not the OMP
 * task-agent contract.
 *
 * Agent files use markdown with YAML frontmatter.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { isProviderEnabled } from "../capability";
import { findAllNearestProjectConfigDirs, getConfigDirs } from "../config";
import { listClaudePluginRoots } from "../discovery/helpers";
import { loadBundledAgents, parseAgent } from "./agents";
import type { AgentDefinition, AgentSource } from "./types";

const TASK_AGENT_CONFIG_SOURCE = ".omp";

/** Result of agent discovery */
export interface DiscoveryResult {
	agents: AgentDefinition[];
	projectAgentsDir: string | null;
}

/** Agent capabilities advertised and resolved by one TaskTool generation. */
export interface TaskCapabilitySnapshot {
	readonly agents: readonly AgentDefinition[];
	readonly projectAgentsDir: string | null;
	readonly spawningDisabled: boolean;
}

export interface TaskCapabilitySnapshotOptions {
	readonly disabledAgents: readonly string[];
	readonly parentSpawns: string;
	readonly blockedAgent?: string;
}

/**
 * Freeze the executable responsibility set for one TaskTool instance.
 *
 * Discovery results may be reused by callers, so clone every mutable array
 * before freezing. Settings changes belong to the next tool generation; the
 * current prompt and execution path must keep resolving this exact set.
 */
export function createTaskCapabilitySnapshot(
	discovery: DiscoveryResult,
	options: TaskCapabilitySnapshotOptions,
): TaskCapabilitySnapshot {
	const disabled = new Set(options.disabledAgents);
	const allowed =
		options.parentSpawns === "*"
			? undefined
			: new Set(
					options.parentSpawns
						.split(",")
						.map(name => name.trim())
						.filter(Boolean),
				);
	const agents = discovery.agents
		.filter(agent => !disabled.has(agent.name))
		.filter(agent => allowed === undefined || allowed.has(agent.name))
		.filter(agent => agent.name !== options.blockedAgent)
		.map(agent =>
			Object.freeze({
				...agent,
				tools: agent.tools ? [...agent.tools] : undefined,
				spawns: Array.isArray(agent.spawns) ? [...agent.spawns] : agent.spawns,
				model: agent.model ? [...agent.model] : undefined,
				autoloadSkills: agent.autoloadSkills ? [...agent.autoloadSkills] : undefined,
			}),
		);
	return Object.freeze({
		agents: Object.freeze(agents),
		projectAgentsDir: discovery.projectAgentsDir,
		spawningDisabled: options.parentSpawns === "",
	});
}


/** Stable data projection consumed by agent pickers and preview surfaces. */
export interface AgentPickerEntry {
	name: string;
	description: string;
	source: AgentSource;
	definitionSourcePath: string;
	fullPrompt: string;
}

export function getAgentPickerData(agents: readonly AgentDefinition[]): AgentPickerEntry[] {
	return agents.map(agent => ({
		name: agent.name,
		description: agent.description,
		source: agent.source,
		definitionSourcePath: agent.filePath ?? `embedded:${agent.name}.md`,
		fullPrompt: agent.systemPrompt,
	}));
}

/**
 * Load agents from a directory.
 */
async function loadAgentsFromDir(dir: string, source: AgentSource): Promise<AgentDefinition[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
	const files = entries
		.filter(entry => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md"))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(file => {
			const filePath = path.join(dir, file.name);
			return fs
				.readFile(filePath, "utf-8")
				.then(content => parseAgent(filePath, content, source, "warn"))
				.catch(error => {
					logger.warn("Failed to read agent file", { filePath, error });
					return null;
				});
		});

	return (await Promise.all(files)).filter(Boolean) as AgentDefinition[];
}

/**
 * Discover agents from filesystem and merge with bundled agents.
 *
 * Precedence (highest wins): project .omp, user .omp, Claude plugin agents, then bundled
 * @param cwd - Current working directory for project agent discovery
 */
export async function discoverAgents(cwd: string, home: string = os.homedir()): Promise<DiscoveryResult> {
	const resolvedCwd = path.resolve(cwd);

	const userDirs = getConfigDirs("agents", { project: false })
		.filter(entry => entry.source === TASK_AGENT_CONFIG_SOURCE)
		.map(entry => ({
			...entry,
			path: path.resolve(entry.path),
		}));

	const projectDirs = findAllNearestProjectConfigDirs("agents", resolvedCwd)
		.filter(entry => entry.source === TASK_AGENT_CONFIG_SOURCE)
		.map(entry => ({
			...entry,
			path: path.resolve(entry.path),
		}));

	const orderedDirs: Array<{ dir: string; source: AgentSource }> = [];
	const project = projectDirs[0];
	if (project) orderedDirs.push({ dir: project.path, source: "project" });
	const user = userDirs[0];
	if (user) orderedDirs.push({ dir: user.path, source: "user" });

	// Load agents from Claude Code marketplace plugins (respects disabledProviders)
	const { roots: pluginRoots } = isProviderEnabled("claude-plugins")
		? await listClaudePluginRoots(home, resolvedCwd)
		: { roots: [] };
	const sortedPluginRoots = [...pluginRoots].sort((a, b) => {
		if (a.scope === b.scope) return 0;
		return a.scope === "project" ? -1 : 1;
	});
	for (const plugin of sortedPluginRoots) {
		const agentsDir = path.join(plugin.path, "agents");
		orderedDirs.push({ dir: agentsDir, source: plugin.scope === "project" ? "project" : "user" });
	}

	const seen = new Set<string>();
	const loadedAgents = (await Promise.all(orderedDirs.map(({ dir, source }) => loadAgentsFromDir(dir, source))))
		.flat()
		.filter(agent => {
			if (seen.has(agent.name)) return false;
			seen.add(agent.name);
			return true;
		});

	const bundledAgents = loadBundledAgents().filter(agent => {
		if (seen.has(agent.name)) return false;
		seen.add(agent.name);
		return true;
	});

	const projectAgentsDir = projectDirs.length > 0 ? projectDirs[0].path : null;

	return { agents: [...loadedAgents, ...bundledAgents], projectAgentsDir };
}

/**
 * Get an agent by name from discovered agents.
 */
export function getAgent(agents: readonly AgentDefinition[], name: string): AgentDefinition | undefined {
	return agents.find(a => a.name === name);
}

