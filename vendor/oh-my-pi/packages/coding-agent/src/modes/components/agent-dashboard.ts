/**
 * AgentDashboard - dedicated control center for Task subagent configuration.
 *
 * Layout:
 * - Top: source tabs (All, Project, User, Bundled)
 * - Body: two-column view (agent list + inspector)
 *
 * Controls:
 * - Up/Down or j/k: move selection
 * - Tab / Shift+Tab or Left/Right: switch source tab
 * - Space: enable/disable selected agent
 * - Enter: edit model override for selected agent
 * - N: start agent creation flow
 * - UI dismiss: clear search (if any) or close dashboard
 * - Ctrl+R: reload discovered agents
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import {
	Container,
	type Component,
	replaceTabs,
	Spacer,
	Text,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import { isEnoent, prompt } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import { Effect, Exit, Scope } from "effect";
import { getConfigDirs } from "../../config";
import type { ModelRegistry } from "../../config/model-registry";
import { formatModelString, resolveModelOverride } from "../../config/model-resolver";
import { resolveAgentModelPatterns, resolveConfiguredModelPatterns } from "../../config/role-resolution";
import { Settings } from "../../config/settings";
import agentCreationArchitectPrompt from "../../prompts/system/agent-creation-architect.md" with { type: "text" };
import agentCreationUserPrompt from "../../prompts/system/agent-creation-user.md" with { type: "text" };
import { createAgentSession } from "../../sdk";
import { discoverAgents } from "../../task/discovery";
import type { AgentDefinition, AgentSource } from "../../task/types";
import { shortenPath } from "../../tools/render-utils";
import { theme } from "../theme/theme";
import { keyHint } from "./keybinding-hints";
import { DynamicBorder } from "./dynamic-border";
import { viewSelector, type SelectorModel, type SelectorMsg, makeSelectorModel, updateSelector } from "../mvu/selector";
import { makeComponentId } from "../mvu/schema";
import { TablePreviewComponent } from "./table-preview";

export type SourceTabId = "all" | AgentSource;
export type AgentScope = "project" | "user";

export interface SourceTab {
	readonly id: SourceTabId;
	readonly label: string;
	readonly count: number;
}

export interface DashboardAgent extends AgentDefinition {
	readonly disabled: boolean;
	readonly overrideModel?: string;
}

interface ModelResolution {
	readonly resolved: string;
	readonly thinkingLevel?: string;
	readonly explicitThinkingLevel: boolean;
}

export interface GeneratedAgentSpec {
	readonly identifier: string;
	readonly whenToUse: string;
	readonly systemPrompt: string;
}

export interface AgentDashboardModelContext {
	readonly modelRegistry?: ModelRegistry;
	readonly activeModelPattern?: string;
	readonly defaultModelPattern?: string;
}

const SOURCE_ORDER: Record<AgentSource, number> = {
	project: 0,
	user: 1,
	bundled: 2,
};

const SOURCE_LABEL: Record<AgentSource, string> = {
	project: "Project",
	user: "User",
	bundled: "Bundled",
};
const AGENT_PREVIEW_PROMPT_MAX_CHARS = 32 * 1024;

const LIST_FOOTER_PREFIX = " ↑/↓: navigate  Space: toggle  Enter: model  N: new  ←/→: source  Ctrl+R: reload  ";

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+){1,5}$/;
function joinPatterns(patterns: string[]): string {
	if (patterns.length === 0) return "(session model)";
	return patterns.join(", ");
}

function formatResolution(resolution: ModelResolution): string {
	const resolved = theme.fg("success", resolution.resolved);
	if (!resolution.explicitThinkingLevel || !resolution.thinkingLevel) return resolved;
	return `${resolved} ${theme.fg("dim", `(${resolution.thinkingLevel})`)}`;
}


function extractAssistantText(messages: AgentMessage[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		const blocks = message.content;
		if (!Array.isArray(blocks)) continue;
		const text = blocks
			.map(block => {
				if (!block || typeof block !== "object") return "";
				if (!("type" in block) || (block as { type?: unknown }).type !== "text") return "";
				const value = (block as { text?: unknown }).text;
				return typeof value === "string" ? value : "";
			})
			.join("\n")
			.trim();
		if (text.length > 0) return text;
	}
	return null;
}

function extractJsonObject(raw: string): string {
	const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenceMatch?.[1]) {
		return fenceMatch[1].trim();
	}
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start >= 0 && end >= start) {
		return raw.slice(start, end + 1).trim();
	}
	return raw.trim();
}

function parseGeneratedAgentSpec(raw: string): GeneratedAgentSpec {
	const parsed = JSON.parse(extractJsonObject(raw)) as Partial<GeneratedAgentSpec>;
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Model output is not a JSON object");
	}
	if (
		typeof parsed.identifier !== "string" ||
		typeof parsed.whenToUse !== "string" ||
		typeof parsed.systemPrompt !== "string"
	) {
		throw new Error("Model output is missing required fields (identifier, whenToUse, systemPrompt)");
	}

	const identifier = parsed.identifier.trim();
	const whenToUse = parsed.whenToUse.trim();
	const systemPrompt = parsed.systemPrompt.trim();

	if (!IDENTIFIER_PATTERN.test(identifier)) {
		throw new Error("Generated identifier is invalid (must be lowercase kebab-case, 2+ words)");
	}
	if (!whenToUse.toLowerCase().startsWith("use this agent when")) {
		throw new Error("Generated whenToUse must start with 'Use this agent when...'");
	}
	if (!systemPrompt) {
		throw new Error("Generated systemPrompt is empty");
	}

	return { identifier, whenToUse, systemPrompt };
}

interface AgentInspectorProjection {
	readonly agent: DashboardAgent | null;
	readonly defaultPatterns: readonly string[];
	readonly defaultResolution?: ModelResolution;
	readonly effectivePatterns: readonly string[];
	readonly effectiveResolution?: ModelResolution;
}

function renderAgentInspector(
	projection: AgentInspectorProjection | null,
	width: number,
	height: number,
): readonly string[] {
	if (!projection?.agent) return [theme.fg("muted", "Select an agent"), theme.fg("dim", "to inspect settings")];
	const agent = projection.agent;
	const lines: string[] = [];
	const state = agent.disabled
		? theme.fg("dim", `${theme.status.disabled} Disabled`)
		: theme.fg("success", `${theme.status.enabled} Enabled`);
	lines.push(theme.bold(theme.fg("accent", replaceTabs(agent.name))), "");
	lines.push(`${theme.fg("muted", "Status:")} ${state}`);
	lines.push(`${theme.fg("muted", "Source:")} ${SOURCE_LABEL[agent.source]}`, "");
	lines.push(`${theme.fg("muted", "Default pattern:")} ${replaceTabs(joinPatterns([...projection.defaultPatterns]))}`);
	lines.push(
		`${theme.fg("muted", "Default resolves:")} ${
			projection.defaultResolution ? formatResolution(projection.defaultResolution) : theme.fg("dim", "(unresolved)")
		}`,
	);
	lines.push(
		`${theme.fg("muted", "Override:")} ${
			agent.overrideModel ? theme.fg("warning", replaceTabs(agent.overrideModel)) : theme.fg("dim", "(none)")
		}`,
	);
	lines.push(`${theme.fg("muted", "Effective pattern:")} ${replaceTabs(joinPatterns([...projection.effectivePatterns]))}`);
	lines.push(
		`${theme.fg("muted", "Effective:")} ${
			projection.effectiveResolution ? formatResolution(projection.effectiveResolution) : theme.fg("dim", "(unresolved)")
		}`,
	);
	const sourcePath = agent.filePath ?? `embedded:${agent.name}.md`;
	lines.push("", theme.fg("muted", "Path:"), theme.fg("dim", `  ${replaceTabs(shortenPath(sourcePath))}`));
	if (agent.description) {
		lines.push("", theme.fg("muted", "Description:"));
		for (const wrapped of wrapTextWithAnsi(replaceTabs(agent.description), Math.max(10, width - 2))) {
			lines.push(truncateToWidth(wrapped, width));
		}
	}
	if (agent.systemPrompt) {
		lines.push("", theme.fg("muted", "Prompt:"));
		const promptText = replaceTabs(agent.systemPrompt.slice(0, AGENT_PREVIEW_PROMPT_MAX_CHARS));
		for (const wrapped of wrapTextWithAnsi(promptText, Math.max(10, width - 2))) {
			lines.push(truncateToWidth(wrapped, width));
		}
	}
	return lines.slice(0, Math.max(1, height));
}

export type AgentDashboardScreen =
	| { readonly _tag: "Browse" }
	| { readonly _tag: "ModelEdit"; readonly agentName: string; readonly draft: string }
	| {
			readonly _tag: "CreateDraft";
			readonly description: string;
			readonly scope: AgentScope;
			readonly error?: string;
	  }
	| {
			readonly _tag: "CreatePending";
			readonly description: string;
			readonly scope: AgentScope;
			readonly requestGeneration: number;
			readonly sourceRevision: number;
			readonly operation: "Generate" | "Save";
			readonly spec?: GeneratedAgentSpec;
	  }
	| {
			readonly _tag: "CreateReview";
			readonly description: string;
			readonly scope: AgentScope;
			readonly spec: GeneratedAgentSpec;
			readonly error?: string;
	  };

export interface AgentDashboardModel {
	readonly sourceRevision: number;
	readonly requestGeneration: number;
	readonly loadState: "Idle" | "Loading" | "Failed";
	readonly loadError?: string;
	readonly notice?: string;
	readonly allAgents: readonly DashboardAgent[];
	readonly tabs: readonly SourceTab[];
	readonly activeTabIndex: number;
	readonly selector: SelectorModel<string>;
	readonly screen: AgentDashboardScreen;
}

export type AgentDashboardMessage =
	| SelectorMsg<string>
	| { readonly _tag: "ToggleSelected" }
	| { readonly _tag: "EditSelected" }
	| { readonly _tag: "ModelDraftSet"; readonly value: string }
	| { readonly _tag: "ModelSave" }
	| { readonly _tag: "BeginCreate" }
	| { readonly _tag: "CreateAppend"; readonly text: string }
	| { readonly _tag: "CreateDelete" }
	| { readonly _tag: "CreateSubmit" }
	| { readonly _tag: "CreateScopeToggle" }
	| { readonly _tag: "CreateSave" }
	| { readonly _tag: "CreateRegenerate" }
	| { readonly _tag: "CreateCancel" }
	| { readonly _tag: "SwitchSource"; readonly delta: -1 | 1 }
	| { readonly _tag: "Reload" }
	| {
			readonly _tag: "DiscoveryLoaded";
			readonly requestGeneration: number;
			readonly agents: readonly DashboardAgent[];
	  }
	| { readonly _tag: "DiscoveryFailed"; readonly requestGeneration: number; readonly error: string }
	| {
			readonly _tag: "CreateGenerated";
			readonly requestGeneration: number;
			readonly sourceRevision: number;
			readonly spec: GeneratedAgentSpec;
	  }
	| {
			readonly _tag: "CreateFailed";
			readonly requestGeneration: number;
			readonly sourceRevision: number;
			readonly error: string;
	  }
	| {
			readonly _tag: "SaveSucceeded";
			readonly requestGeneration: number;
			readonly agents: readonly DashboardAgent[];
			readonly notice: string;
	  }
	| { readonly _tag: "SaveFailed"; readonly requestGeneration: number; readonly error: string }
	| { readonly _tag: "ViewportChanged"; readonly offset: number; readonly height: number };

export type AgentDashboardCommand =
	| { readonly _tag: "CloseRequested" }
	| { readonly _tag: "PersistDisabled"; readonly disabledNames: readonly string[] }
	| { readonly _tag: "PersistOverrides"; readonly overrides: Readonly<Record<string, string>> }
	| { readonly _tag: "Discover"; readonly requestGeneration: number }
	| {
			readonly _tag: "Generate";
			readonly description: string;
			readonly requestGeneration: number;
			readonly sourceRevision: number;
	  }
	| {
			readonly _tag: "Save";
			readonly scope: AgentScope;
			readonly spec: GeneratedAgentSpec;
			readonly requestGeneration: number;
	  };

export interface AgentDashboardTransition {
	readonly model: AgentDashboardModel;
	readonly commands: readonly AgentDashboardCommand[];
}

function buildAgentTabs(agents: readonly DashboardAgent[]): readonly SourceTab[] {
	const tabs: SourceTab[] = [{ id: "all", label: "All", count: agents.length }];
	const counts: Record<AgentSource, number> = { project: 0, user: 0, bundled: 0 };
	for (const agent of agents) counts[agent.source] += 1;
	for (const source of ["project", "user", "bundled"] as const) {
		if (counts[source] > 0) tabs.push({ id: source, label: SOURCE_LABEL[source], count: counts[source] });
	}
	return tabs;
}

function agentsForTab(model: AgentDashboardModel): readonly DashboardAgent[] {
	const tab = model.tabs[model.activeTabIndex] ?? model.tabs[0];
	return tab?.id === "all" ? model.allAgents : model.allAgents.filter(agent => agent.source === tab?.id);
}

function replaceAgentSelectorSource(
	model: AgentDashboardModel,
	allAgents: readonly DashboardAgent[],
	activeTabId?: SourceTabId,
): AgentDashboardModel {
	const tabs = buildAgentTabs(allAgents);
	const currentTabId = activeTabId ?? model.tabs[model.activeTabIndex]?.id ?? "all";
	const activeTabIndex = Math.max(0, tabs.findIndex(tab => tab.id === currentTabId));
	const base = { ...model, allAgents, tabs, activeTabIndex };
	const agents = agentsForTab(base);
	const searchTextById = new Map(agents.map(agent => [
		agent.name,
		`${agent.name} ${agent.description} ${SOURCE_LABEL[agent.source]} ${agent.overrideModel ?? ""}`,
	]));
	const selector = updateSelector(model.selector, {
		_tag: "SourceReplaced",
		sourceRevision: model.selector.sourceRevision + 1,
		orderedIds: agents.map(agent => agent.name),
		searchTextById,
	}).model;
	return { ...base, sourceRevision: selector.sourceRevision, selector };
}

function selectedAgent(model: AgentDashboardModel): DashboardAgent | undefined {
	const selectedId = model.selector.selectedId;
	return selectedId === undefined ? undefined : model.allAgents.find(agent => agent.name === selectedId);
}

function modelOverrides(agents: readonly DashboardAgent[]): Readonly<Record<string, string>> {
	const overrides: Record<string, string> = {};
	for (const agent of agents) {
		const value = agent.overrideModel?.trim();
		if (value) overrides[agent.name] = value;
	}
	return overrides;
}

function beginCreateGeneration(
	model: AgentDashboardModel,
	description: string,
	scope: AgentScope,
): AgentDashboardTransition {
	const trimmed = description.trim();
	if (!trimmed) {
		return {
			model: { ...model, screen: { _tag: "CreateDraft", description, scope, error: "Description is required." } },
			commands: [],
		};
	}
	const requestGeneration = model.requestGeneration + 1;
	return {
		model: {
			...model,
			requestGeneration,
			notice: undefined,
			screen: {
				_tag: "CreatePending",
				description: trimmed,
				scope,
				requestGeneration,
				sourceRevision: model.sourceRevision,
				operation: "Generate",
			},
		},
		commands: [{ _tag: "Generate", description: trimmed, requestGeneration, sourceRevision: model.sourceRevision }],
	};
}

export function reduceAgentDashboard(
	model: AgentDashboardModel,
	message: AgentDashboardMessage,
): AgentDashboardTransition {
	switch (message._tag) {
		case "ToggleSelected": {
			if (model.screen._tag !== "Browse") return { model, commands: [] };
			const selected = selectedAgent(model);
			if (selected === undefined) return { model, commands: [] };
			const agents = model.allAgents.map(agent =>
				agent.name === selected.name ? { ...agent, disabled: !agent.disabled } : agent,
			);
			const next = replaceAgentSelectorSource(model, agents);
			return {
				model: next,
				commands: [{
					_tag: "PersistDisabled",
					disabledNames: agents.filter(agent => agent.disabled).map(agent => agent.name).sort(),
				}],
			};
		}
		case "EditSelected": {
			if (model.screen._tag !== "Browse") return { model, commands: [] };
			const selected = selectedAgent(model);
			return selected === undefined
				? { model, commands: [] }
				: {
						model: {
							...model,
							screen: { _tag: "ModelEdit", agentName: selected.name, draft: selected.overrideModel ?? "" },
						},
						commands: [],
					};
		}
		case "ModelDraftSet":
			return model.screen._tag === "ModelEdit"
				? { model: { ...model, screen: { ...model.screen, draft: message.value } }, commands: [] }
				: { model, commands: [] };
		case "ModelSave": {
			if (model.screen._tag !== "ModelEdit") return { model, commands: [] };
			const value = model.screen.draft.trim();
			const agentName = model.screen.agentName;
			const agents = model.allAgents.map(agent =>
				agent.name === agentName ? { ...agent, overrideModel: value || undefined } : agent,
			);
			const next = replaceAgentSelectorSource({ ...model, screen: { _tag: "Browse" } }, agents);
			return {
				model: { ...next, notice: `Updated model override for ${agentName}` },
				commands: [{ _tag: "PersistOverrides", overrides: modelOverrides(agents) }],
			};
		}
		case "BeginCreate":
			return model.screen._tag === "Browse"
				? {
						model: {
							...model,
							notice: undefined,
							screen: { _tag: "CreateDraft", description: "", scope: "project" },
						},
						commands: [],
					}
				: { model, commands: [] };
		case "CreateAppend":
			return model.screen._tag === "CreateDraft"
				? {
						model: {
							...model,
							screen: {
								...model.screen,
								description: `${model.screen.description}${message.text === "\r" ? "\n" : message.text}`,
								error: undefined,
							},
						},
						commands: [],
					}
				: { model, commands: [] };
		case "CreateDelete":
			return model.screen._tag === "CreateDraft"
				? {
						model: {
							...model,
							screen: { ...model.screen, description: model.screen.description.slice(0, -1), error: undefined },
						},
						commands: [],
					}
				: { model, commands: [] };
		case "CreateSubmit":
			return model.screen._tag === "CreateDraft"
				? beginCreateGeneration(model, model.screen.description, model.screen.scope)
				: { model, commands: [] };
		case "CreateScopeToggle": {
			const screen = model.screen;
			if (screen._tag !== "CreateDraft" && screen._tag !== "CreateReview") return { model, commands: [] };
			return {
				model: { ...model, screen: { ...screen, scope: screen.scope === "project" ? "user" : "project" } },
				commands: [],
			};
		}
		case "CreateRegenerate":
			return model.screen._tag === "CreateReview"
				? beginCreateGeneration(model, model.screen.description, model.screen.scope)
				: { model, commands: [] };
		case "CreateSave": {
			if (model.screen._tag !== "CreateReview") return { model, commands: [] };
			const requestGeneration = model.requestGeneration + 1;
			return {
				model: {
					...model,
					requestGeneration,
					screen: {
						_tag: "CreatePending",
						description: model.screen.description,
						scope: model.screen.scope,
						requestGeneration,
						sourceRevision: model.sourceRevision,
						operation: "Save",
						spec: model.screen.spec,
					},
				},
				commands: [{
					_tag: "Save",
					scope: model.screen.scope,
					spec: model.screen.spec,
					requestGeneration,
				}],
			};
		}
		case "CreateCancel":
			return {
				model: { ...model, requestGeneration: model.requestGeneration + 1, screen: { _tag: "Browse" } },
				commands: [],
			};
		case "SwitchSource": {
			if (model.screen._tag !== "Browse" || model.tabs.length === 0) return { model, commands: [] };
			const activeTabIndex =
				(model.activeTabIndex + message.delta + model.tabs.length) % model.tabs.length;
			return {
				model: replaceAgentSelectorSource(
					{ ...model, activeTabIndex },
					model.allAgents,
					model.tabs[activeTabIndex]?.id,
				),
				commands: [],
			};
		}
		case "Reload": {
			const requestGeneration = model.requestGeneration + 1;
			return {
				model: {
					...model,
					requestGeneration,
					loadState: "Loading",
					loadError: undefined,
				},
				commands: [{ _tag: "Discover", requestGeneration }],
			};
		}
		case "DiscoveryLoaded":
			if (message.requestGeneration !== model.requestGeneration) return { model, commands: [] };
			return {
				model: {
					...replaceAgentSelectorSource(model, message.agents),
					loadState: "Idle",
					loadError: undefined,
				},
				commands: [],
			};
		case "DiscoveryFailed":
			return message.requestGeneration === model.requestGeneration
				? { model: { ...model, loadState: "Failed", loadError: message.error }, commands: [] }
				: { model, commands: [] };
		case "CreateGenerated": {
			const screen = model.screen;
			if (
				screen._tag !== "CreatePending" ||
				screen.operation !== "Generate" ||
				message.requestGeneration !== model.requestGeneration ||
				message.requestGeneration !== screen.requestGeneration ||
				message.sourceRevision !== screen.sourceRevision ||
				message.sourceRevision !== model.sourceRevision
			) return { model, commands: [] };
			return {
				model: {
					...model,
					screen: {
						_tag: "CreateReview",
						description: screen.description,
						scope: screen.scope,
						spec: message.spec,
					},
				},
				commands: [],
			};
		}
		case "CreateFailed": {
			const screen = model.screen;
			if (
				screen._tag !== "CreatePending" ||
				screen.operation !== "Generate" ||
				message.requestGeneration !== model.requestGeneration ||
				message.sourceRevision !== model.sourceRevision
			) return { model, commands: [] };
			return {
				model: {
					...model,
					screen: {
						_tag: "CreateDraft",
						description: screen.description,
						scope: screen.scope,
						error: message.error,
					},
				},
				commands: [],
			};
		}
		case "SaveSucceeded": {
			const screen = model.screen;
			if (
				screen._tag !== "CreatePending" ||
				screen.operation !== "Save" ||
				message.requestGeneration !== model.requestGeneration
			) return { model, commands: [] };
			const next = replaceAgentSelectorSource({ ...model, screen: { _tag: "Browse" } }, message.agents);
			return { model: { ...next, notice: message.notice }, commands: [] };
		}
		case "SaveFailed": {
			const screen = model.screen;
			if (
				screen._tag !== "CreatePending" ||
				screen.operation !== "Save" ||
				screen.spec === undefined ||
				message.requestGeneration !== model.requestGeneration
			) return { model, commands: [] };
			return {
				model: {
					...model,
					screen: {
						_tag: "CreateReview",
						description: screen.description,
						scope: screen.scope,
						spec: screen.spec,
						error: message.error,
					},
				},
				commands: [],
			};
		}
		case "ViewportChanged": {
			const transition = updateSelector(model.selector, {
				_tag: "ViewportChanged",
				offset: message.offset,
				height: message.height,
			});
			return { model: { ...model, selector: transition.model }, commands: [] };
		}
		case "Back":
			if (model.screen._tag !== "Browse") {
				return {
					model: { ...model, requestGeneration: model.requestGeneration + 1, screen: { _tag: "Browse" } },
					commands: [],
				};
			}
			break;
	}
	if (model.screen._tag !== "Browse") return { model, commands: [] };
	const transition = updateSelector(model.selector, message);
	return {
		model: { ...model, selector: transition.model },
		commands: transition.commands.some(command => command._tag === "CloseRequested")
			? [{ _tag: "CloseRequested" }]
			: [],
	};
}

function dashboardAgents(
	agents: readonly AgentDefinition[],
	settings: Settings,
): readonly DashboardAgent[] {
	const disabled = new Set((settings.get("task.disabledAgents") as string[] | undefined) ?? []);
	const overrides = settings.get("task.agentModelOverrides") ?? {};
	return agents
		.slice()
		.sort((left, right) => {
			const source = SOURCE_ORDER[left.source] - SOURCE_ORDER[right.source];
			return source !== 0 ? source : left.name.localeCompare(right.name);
		})
		.map(agent => ({
			...agent,
			disabled: disabled.has(agent.name),
			overrideModel: overrides[agent.name]?.trim() || undefined,
		}));
}

export async function createAgentDashboardModel(
	cwd: string,
	settings: Settings,
	viewportSize = 10,
): Promise<AgentDashboardModel> {
	const { agents } = await discoverAgents(cwd);
	const allAgents = dashboardAgents(agents, settings);
	const tabs = buildAgentTabs(allAgents);
	const model: AgentDashboardModel = {
		sourceRevision: 0,
		requestGeneration: 0,
		loadState: "Idle",
		allAgents,
		tabs,
		activeTabIndex: 0,
		selector: { ...makeSelectorModel<string>([]), viewportSize },
		screen: { _tag: "Browse" },
	};
	return replaceAgentSelectorSource(model, allAgents, tabs[0]?.id);
}

export const AGENT_DASHBOARD_ROUTE = {
	componentId: makeComponentId("agent-dashboard"),
	context: "selector.global",
	makeInitialModel: createAgentDashboardModel,
	update: reduceAgentDashboard,
	domainActions: {
		"tui.select.confirm": "EditSelected",
		"app.selector.preview": "ToggleSelected",
		"app.agent.create": "BeginCreate",
		"app.selector.sourcePrevious": "SwitchSource",
		"app.selector.sourceNext": "SwitchSource",
		"app.selector.refresh": "Reload",
	},
} as const;

export class AgentDashboard extends Container {
	#model!: AgentDashboardModel;
	#settingsManager!: Settings;
	#tablePreview!: TablePreviewComponent<DashboardAgent, string, AgentInspectorProjection | null>;
	readonly #viewScope = Scope.makeUnsafe("sequential");
	#disposed = false;
	#builtRows = -1;
	#builtCols = -1;
	#committedRender: readonly string[] | undefined;

	onRequestComponentRender?: (component: Component) => void;

	private constructor(
		private readonly cwd: string,
		private readonly settings: Settings | null,
		private readonly terminalHeight: number,
		private readonly modelContext: AgentDashboardModelContext,
	) {
		super();
	}

	static async create(
		cwd: string,
		settings: Settings | null = null,
		terminalHeight?: number,
		modelContext: AgentDashboardModelContext = {},
	): Promise<AgentDashboard> {
		const dashboard = new AgentDashboard(cwd, settings, terminalHeight ?? process.stdout.rows ?? 24, modelContext);
		await dashboard.#init();
		return dashboard;
	}

	async #init(): Promise<void> {
		this.#settingsManager = this.settings ?? (await Settings.init());
		this.#model = await createAgentDashboardModel(
			this.cwd,
			this.#settingsManager,
			Math.max(1, this.#computeBodyHeight() - 2),
		);
		this.#tablePreview = await Effect.runPromise(
			Scope.provide(this.#viewScope)(
				TablePreviewComponent.mount<DashboardAgent, string, AgentInspectorProjection | null>({
					renderRow: agent => {
						const status = agent.disabled
							? theme.fg("dim", theme.status.disabled)
							: theme.fg("success", theme.status.enabled);
						const source = theme.fg("dim", `[${SOURCE_LABEL[agent.source]}]`);
						const override = agent.overrideModel ? ` ${theme.fg("warning", "(override)")}` : "";
						const row = ` ${status} ${replaceTabs(agent.name)} ${source}${override}`;
						return agent.disabled ? theme.fg("dim", row) : row;
					},
					renderPreview: (projection, width, height) => renderAgentInspector(projection, width, height),
					height: () => this.#computeBodyHeight(),
					requestComponentRender: () => this.onRequestComponentRender?.(this),
					layout: "columns",
					tableRatio: 0.5,
					emptyMessage: "No agents found.",
					previewEmptyMessage: "Select an agent to inspect settings",
				}),
			),
		);
		this.#applyTableProjection();
		this.#buildLayout();
	}

	get initialModel(): AgentDashboardModel {
		return this.#model;
	}

	apply(model: AgentDashboardModel): void {
		if (this.#disposed) return;
		this.#model = model;
		this.#applyTableProjection();
		this.#buildLayout();
		this.onRequestComponentRender?.(this);
	}

	async execute(command: Extract<AgentDashboardCommand, { readonly _tag: "Discover" | "Generate" | "Save" }>): Promise<AgentDashboardMessage> {
		try {
			if (command._tag === "Discover") {
				const { agents } = await discoverAgents(this.cwd);
				return {
					_tag: "DiscoveryLoaded",
					requestGeneration: command.requestGeneration,
					agents: dashboardAgents(agents, this.#settingsManager),
				};
			}
			if (command._tag === "Generate") {
				const spec = await this.#runAgentCreationArchitect(command.description);
				return {
					_tag: "CreateGenerated",
					requestGeneration: command.requestGeneration,
					sourceRevision: command.sourceRevision,
					spec,
				};
			}
			const dirs = getConfigDirs("agents", {
				user: command.scope === "user",
				project: command.scope === "project",
				cwd: this.cwd,
			});
			const targetDir = dirs[0]?.path;
			if (!targetDir) throw new Error(`Cannot resolve ${command.scope} agents directory.`);
			const filePath = path.join(targetDir, `${command.spec.identifier}.md`);
			try {
				await fs.stat(filePath);
				throw new Error(`Agent file already exists: ${shortenPath(filePath)}`);
			} catch (error) {
				if (!isEnoent(error)) throw error;
			}
			const frontmatter = YAML.stringify(
				{ name: command.spec.identifier, description: command.spec.whenToUse },
				null,
				2,
			).trimEnd();
			await Bun.write(filePath, `---\n${frontmatter}\n---\n\n${command.spec.systemPrompt.trim()}\n`);
			const { agents } = await discoverAgents(this.cwd);
			return {
				_tag: "SaveSucceeded",
				requestGeneration: command.requestGeneration,
				agents: dashboardAgents(agents, this.#settingsManager),
				notice: `Created agent ${command.spec.identifier} at ${shortenPath(filePath)}`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (command._tag === "Discover") {
				return { _tag: "DiscoveryFailed", requestGeneration: command.requestGeneration, error: message };
			}
			if (command._tag === "Generate") {
				return {
					_tag: "CreateFailed",
					requestGeneration: command.requestGeneration,
					sourceRevision: command.sourceRevision,
					error: message,
				};
			}
			return { _tag: "SaveFailed", requestGeneration: command.requestGeneration, error: message };
		}
	}

	async #runAgentCreationArchitect(description: string): Promise<GeneratedAgentSpec> {
		const modelRegistry = this.modelContext.modelRegistry;
		if (!modelRegistry) throw new Error("Model registry unavailable in current session.");
		await modelRegistry.refresh();
		const modelPatterns = resolveConfiguredModelPatterns(
			this.modelContext.activeModelPattern ??
				this.modelContext.defaultModelPattern ??
				this.#settingsManager.getModelRole("default"),
			this.#settingsManager,
		);
		const { model } = resolveModelOverride(modelPatterns, modelRegistry, this.#settingsManager);
		const selectedModel = model ?? modelRegistry.getAvailable()[0];
		if (!selectedModel) throw new Error("No available model to generate agent specification.");
		const { session } = await createAgentSession({
			cwd: this.cwd,
			authStorage: modelRegistry.authStorage,
			modelRegistry,
			settings: this.#settingsManager,
			model: selectedModel,
			systemPrompt: [prompt.render(agentCreationArchitectPrompt, {})],
			hasUI: false,
			enableLsp: false,
			enableMCP: false,
			disableExtensionDiscovery: true,
			toolNames: ["__none__"],
			customTools: [],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
		});
		try {
			await session.prompt(prompt.render(agentCreationUserPrompt, { request: description }), {
				expandPromptTemplates: false,
			});
			const raw = extractAssistantText(session.state.messages);
			if (!raw) throw new Error("No response returned by agent creation architect.");
			return parseGeneratedAgentSpec(raw);
		} finally {
			await session.dispose();
		}
	}

	#selectedAgent(): DashboardAgent | undefined {
		return selectedAgent(this.#model);
	}

	#defaultPatternsFor(agent: DashboardAgent): string[] {
		return resolveAgentModelPatterns({
			taskOrRoleModel: agent.model,
			streamModel: this.modelContext.activeModelPattern,
			globalFallbackModel: this.modelContext.defaultModelPattern,
			settings: this.#settingsManager,
		});
	}

	#effectivePatternsFor(agent: DashboardAgent, draftOverride: string | undefined): string[] {
		return resolveAgentModelPatterns({
			temporaryModel: draftOverride,
			taskOrRoleModel: agent.model,
			streamModel: this.modelContext.activeModelPattern,
			globalFallbackModel: this.modelContext.defaultModelPattern,
			settings: this.#settingsManager,
		});
	}

	#resolvePatterns(patterns: string[]): ModelResolution | undefined {
		const modelRegistry = this.modelContext.modelRegistry;
		if (!modelRegistry || patterns.length === 0) return undefined;
		const { model, thinkingLevel, explicitThinkingLevel } = resolveModelOverride(
			patterns,
			modelRegistry,
			this.#settingsManager,
		);
		return model === undefined
			? undefined
			: { resolved: formatModelString(model), thinkingLevel, explicitThinkingLevel };
	}

	#getModelSuggestions(input: string): readonly string[] {
		const modelRegistry = this.modelContext.modelRegistry;
		const query = input.trim().toLowerCase();
		if (!modelRegistry || !query) return [];
		const seen = new Set<string>();
		const matches: string[] = [];
		for (const model of modelRegistry.getAvailable()) {
			const full = `${model.provider}/${model.id}`;
			if (seen.has(full) || !full.toLowerCase().includes(query)) continue;
			seen.add(full);
			matches.push(full);
			if (matches.length >= 5) break;
		}
		return matches;
	}

	#applyTableProjection(): void {
		if (!this.#tablePreview) return;
		const agents = agentsForTab(this.#model);
		const source = new Map(agents.map(agent => [agent.name, agent]));
		const selected = this.#selectedAgent();
		const preview: AgentInspectorProjection | null = selected === undefined
			? null
			: {
					agent: selected,
					defaultPatterns: this.#defaultPatternsFor(selected),
					defaultResolution: this.#resolvePatterns(this.#defaultPatternsFor(selected)),
					effectivePatterns: this.#effectivePatternsFor(selected, selected.overrideModel),
					effectiveResolution: this.#resolvePatterns(
						this.#effectivePatternsFor(selected, selected.overrideModel),
					),
				};
		const view = viewSelector(
			this.#model.selector,
			source,
			{ offset: this.#model.selector.viewportOffset, height: this.#model.selector.viewportSize },
			{ lines: () => [] },
			preview,
		);
		this.#tablePreview.apply({
			...view,
			preview: { revision: this.#model.sourceRevision, value: preview },
		});
	}

	#terminalRows(): number {
		return process.stdout.rows || this.terminalHeight || 24;
	}

	#uiWidth(): number {
		return Math.max(40, process.stdout.columns ?? 100);
	}

	#footer(): string {
		return theme.fg("dim", LIST_FOOTER_PREFIX) + keyHint("ui.dismiss", "close");
	}

	#computeBodyHeight(): number {
		const noticeLines = this.#model?.notice
			? wrapTextWithAnsi(theme.fg("success", replaceTabs(this.#model.notice)), this.#uiWidth()).length + 1
			: 0;
		const footerLines = Math.max(1, wrapTextWithAnsi(this.#footer(), this.#uiWidth()).length);
		return Math.max(5, this.#terminalRows() - (4 + noticeLines + 1 + footerLines + 1));
	}

	#renderTabBar(): string {
		return [" ", ...this.#model.tabs.map((tab, index) => {
			const label = `${tab.label} (${tab.count})`;
			return index === this.#model.activeTabIndex
				? theme.bg("selectedBg", ` ${label} `)
				: theme.fg("muted", ` ${label} `);
		})].join("");
	}

	#renderCreateDraft(screen: Extract<AgentDashboardScreen, { readonly _tag: "CreateDraft" }>): void {
		this.addChild(new Text(theme.bold(theme.fg("accent", " Create New Agent")), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", "Describe what the new agent should do:"), 0, 0));
		this.addChild(new Spacer(1));
		const lines = screen.description.split("\n");
		for (const [index, line] of lines.entries()) {
			this.addChild(new Text(`${index === 0 ? "> " : "  "}${replaceTabs(line)}`, 0, 0));
		}
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", `Scope: ${screen.scope}`), 0, 0));
		if (screen.error) this.addChild(new Text(theme.fg("error", replaceTabs(screen.error)), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg("dim", " Ctrl+Enter: generate  Enter: newline  Tab: toggle scope  ") +
					keyHint("ui.dismiss", "cancel"),
				0,
				0,
			),
		);
	}

	#renderCreateReview(screen: Extract<AgentDashboardScreen, { readonly _tag: "CreateReview" }>): void {
		this.addChild(new Text(theme.bold(theme.fg("accent", " Review Generated Agent")), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", `Identifier: ${screen.spec.identifier}`), 0, 0));
		this.addChild(new Text(theme.fg("muted", `Scope: ${screen.scope}`), 0, 0));
		this.addChild(new Spacer(1));
		for (const line of wrapTextWithAnsi(replaceTabs(screen.spec.whenToUse), Math.max(20, this.#uiWidth() - 2)).slice(0, 8)) {
			this.addChild(new Text(truncateToWidth(line, this.#uiWidth() - 2), 0, 0));
		}
		this.addChild(new Spacer(1));
		const promptLines = screen.spec.systemPrompt.split("\n").flatMap(line =>
			wrapTextWithAnsi(replaceTabs(line), Math.max(20, this.#uiWidth() - 4)),
		);
		for (const line of promptLines.slice(0, 10)) this.addChild(new Text(`  ${line}`, 0, 0));
		if (screen.error) this.addChild(new Text(theme.fg("error", replaceTabs(screen.error)), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg("dim", " Enter: save  Tab: toggle scope  R: regenerate  ") + keyHint("ui.dismiss", "cancel"),
				0,
				0,
			),
		);
	}

	#renderModelEdit(screen: Extract<AgentDashboardScreen, { readonly _tag: "ModelEdit" }>): void {
		const agent = this.#model.allAgents.find(item => item.name === screen.agentName);
		const defaults = agent === undefined ? [] : this.#defaultPatternsFor(agent);
		const preview = agent === undefined ? [] : this.#effectivePatternsFor(agent, screen.draft);
		this.addChild(new Text(theme.bold(theme.fg("accent", `Model override: ${replaceTabs(screen.agentName)}`)), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(`> ${replaceTabs(screen.draft)}`, 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", `Default pattern: ${replaceTabs(joinPatterns(defaults))}`), 0, 0));
		const defaultResolution = this.#resolvePatterns(defaults);
		const previewResolution = this.#resolvePatterns(preview);
		this.addChild(new Text(
			`${theme.fg("muted", "Default resolves:")} ${defaultResolution ? formatResolution(defaultResolution) : theme.fg("dim", "(unresolved)")}`,
			0,
			0,
		));
		this.addChild(new Text(
			`${theme.fg("muted", "Preview effective:")} ${previewResolution ? formatResolution(previewResolution) : theme.fg("dim", "(unresolved)")}`,
			0,
			0,
		));
		for (const suggestion of this.#getModelSuggestions(screen.draft)) {
			this.addChild(new Text(theme.fg("dim", `  ${suggestion}`), 0, 0));
		}
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", " Enter: save  ") + keyHint("ui.dismiss", "cancel"), 0, 0));
	}

	#buildLayout(): void {
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.bold(theme.fg("accent", " Agent Control Center")), 0, 0));
		this.addChild(new Text(this.#renderTabBar(), 0, 0));
		this.addChild(new Spacer(1));
		if (this.#model.notice) {
			this.addChild(new Text(theme.fg("success", replaceTabs(this.#model.notice)), 0, 0));
			this.addChild(new Spacer(1));
		}
		if (this.#model.loadState === "Loading") {
			this.addChild(new Text(theme.fg("muted", "Loading agents..."), 0, 0));
		} else if (this.#model.loadState === "Failed") {
			this.addChild(new Text(theme.fg("error", `Failed to load agents: ${replaceTabs(this.#model.loadError ?? "Unknown error")}`), 0, 0));
		} else {
			switch (this.#model.screen._tag) {
				case "Browse":
					this.addChild(this.#tablePreview);
					this.addChild(new Spacer(1));
					this.addChild(new Text(this.#footer(), 0, 0));
					break;
				case "ModelEdit":
					this.#renderModelEdit(this.#model.screen);
					break;
				case "CreateDraft":
					this.#renderCreateDraft(this.#model.screen);
					break;
				case "CreatePending":
					this.addChild(new Text(theme.fg("accent", this.#model.screen.operation === "Save" ? "Saving agent..." : "Generating agent specification..."), 0, 0));
					this.addChild(new Spacer(1));
					this.addChild(new Text(keyHint("ui.dismiss", "cancel"), 0, 0));
					break;
				case "CreateReview":
					this.#renderCreateReview(this.#model.screen);
					break;
			}
		}
		this.addChild(new DynamicBorder());
		this.#builtRows = this.#terminalRows();
		this.#builtCols = this.#uiWidth();
	}

	override render(width: number): readonly string[] {
		if (this.#disposed && this.#committedRender !== undefined) return this.#committedRender;
		if (this.#terminalRows() !== this.#builtRows || this.#uiWidth() !== this.#builtCols) this.#buildLayout();
		const lines = super.render(width);
		const rows = this.#terminalRows();
		if (lines.length >= rows) {
			this.#committedRender = lines;
			return lines;
		}
		const padded = lines.slice();
		while (padded.length < rows) padded.push("");
		this.#committedRender = padded;
		return padded;
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#committedRender ??= this.render(this.#uiWidth());
		this.#disposed = true;
		await Effect.runPromise(Scope.close(this.#viewScope, Exit.void));
	}
}
