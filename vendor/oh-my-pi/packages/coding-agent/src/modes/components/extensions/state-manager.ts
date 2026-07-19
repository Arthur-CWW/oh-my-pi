/**
 * State manager for the Extension Control Center.
 * Handles data loading, tree building, filtering, and toggle persistence.
 */
import * as path from "node:path";
import { fuzzyMatch } from "@oh-my-pi/pi-tui";
import { logger } from "@oh-my-pi/pi-utils";
import type { ContextFile } from "../../../capability/context-file";
import type { ExtensionModule } from "../../../capability/extension-module";
import type { Hook } from "../../../capability/hook";
import type { MCPServer } from "../../../capability/mcp";
import type { Prompt } from "../../../capability/prompt";
import type { Rule } from "../../../capability/rule";
import type { Skill } from "../../../capability/skill";
import type { SlashCommand } from "../../../capability/slash-command";
import type { CustomTool } from "../../../capability/tool";
import type { SourceMeta } from "../../../capability/types";
import {
	disableProvider,
	enableProvider,
	getAllProvidersInfo,
	isProviderEnabled,
	loadCapability,
} from "../../../discovery";
import type {
	Extension,
	ExtensionKind,
	ExtensionState,
	ProviderTab,
} from "./types";
import { makeExtensionId, sourceFromMeta } from "./types";


/**
 * Load all extensions from all capabilities.
 */
export async function loadAllExtensions(cwd?: string, disabledIds?: string[]): Promise<Extension[]> {
	const extensions: Extension[] = [];
	const disabledExtensions = new Set<string>(disabledIds ?? []);

	// Helper to convert capability items to extensions
	function addItems<T extends { name: string; path: string; _source: SourceMeta }>(
		items: T[],
		kind: ExtensionKind,
		opts?: {
			getDescription?: (item: T) => string | undefined;
			getTrigger?: (item: T) => string | undefined;
			getShadowedBy?: (item: T) => string | undefined;
		},
	): void {
		for (const item of items) {
			const id = makeExtensionId(kind, item.name);
			const isDisabled = disabledExtensions.has(id);
			const isShadowed = (item as { _shadowed?: boolean })._shadowed;
			const providerEnabled = isProviderEnabled(item._source.provider);

			let state: ExtensionState;
			let disabledReason: "shadowed" | "provider-disabled" | "item-disabled" | undefined;

			// Item-disabled takes precedence over shadowed
			if (isDisabled) {
				state = "disabled";
				disabledReason = "item-disabled";
			} else if (isShadowed) {
				state = "shadowed";
				disabledReason = "shadowed";
			} else if (!providerEnabled) {
				state = "disabled";
				disabledReason = "provider-disabled";
			} else {
				state = "active";
			}

			extensions.push({
				id,
				kind,
				name: item.name,
				displayName: item.name,
				description: opts?.getDescription?.(item),
				trigger: opts?.getTrigger?.(item),
				path: item.path,
				source: sourceFromMeta(item._source),
				state,
				disabledReason,
				shadowedBy: opts?.getShadowedBy?.(item),
				raw: item,
			});
		}
	}

	const loadOpts = cwd ? { cwd, includeDisabled: true } : { includeDisabled: true };

	// Load skills
	try {
		const skills = await loadCapability<Skill>("skills", loadOpts);
		addItems(skills.all, "skill", {
			getDescription: s => s.frontmatter?.description,
			getTrigger: s => s.frontmatter?.globs?.join(", "),
		});
	} catch (error) {
		logger.warn("Failed to load skills capability", { error: String(error) });
	}

	// Load rules
	try {
		const rules = await loadCapability<Rule>("rules", loadOpts);
		addItems(rules.all, "rule", {
			getDescription: r => r.description,
			getTrigger: r => r.globs?.join(", ") || (r.alwaysApply ? "always" : undefined),
		});
	} catch (error) {
		logger.warn("Failed to load rules capability", { error: String(error) });
	}

	// Load custom tools
	try {
		const tools = await loadCapability<CustomTool>("tools", loadOpts);
		addItems(tools.all, "tool", {
			getDescription: t => t.description,
		});
	} catch (error) {
		logger.warn("Failed to load tools capability", { error: String(error) });
	}

	// Load extension modules
	try {
		const modules = await loadCapability<ExtensionModule>("extension-modules", loadOpts);
		const nativeModules = modules.all.filter(module => module._source.provider === "native");
		addItems(nativeModules, "extension-module");
	} catch (error) {
		logger.warn("Failed to load extension-modules capability", { error: String(error) });
	}

	// Load MCP servers
	try {
		const mcps = await loadCapability<MCPServer>("mcps", loadOpts);
		for (const server of mcps.all) {
			const id = makeExtensionId("mcp", server.name);
			const isDisabled = disabledExtensions.has(id);
			const isShadowed = (server as { _shadowed?: boolean })._shadowed;
			const providerEnabled = isProviderEnabled(server._source.provider);

			let state: ExtensionState;
			let disabledReason: "shadowed" | "provider-disabled" | "item-disabled" | undefined;

			if (isDisabled) {
				state = "disabled";
				disabledReason = "item-disabled";
			} else if (isShadowed) {
				state = "shadowed";
				disabledReason = "shadowed";
			} else if (!providerEnabled) {
				state = "disabled";
				disabledReason = "provider-disabled";
			} else {
				state = "active";
			}

			extensions.push({
				id,
				kind: "mcp",
				name: server.name,
				displayName: server.name,
				description: server.command || server.url,
				trigger: server.transport || "stdio",
				path: server._source.path,
				source: sourceFromMeta(server._source),
				state,
				disabledReason,
				raw: server,
			});
		}
	} catch (error) {
		logger.warn("Failed to load mcps capability", { error: String(error) });
	}

	// Load prompts
	try {
		const prompts = await loadCapability<Prompt>("prompts", loadOpts);
		addItems(prompts.all, "prompt", {
			getDescription: () => undefined,
			getTrigger: p => `/prompts:${p.name}`,
		});
	} catch (error) {
		logger.warn("Failed to load prompts capability", { error: String(error) });
	}

	// Load slash commands
	try {
		const commands = await loadCapability<SlashCommand>("slash-commands", loadOpts);
		addItems(commands.all, "slash-command", {
			getDescription: () => undefined,
			getTrigger: c => `/${c.name}`,
		});
	} catch (error) {
		logger.warn("Failed to load slash-commands capability", { error: String(error) });
	}

	// Load hooks
	try {
		const hooks = await loadCapability<Hook>("hooks", loadOpts);
		for (const hook of hooks.all) {
			const id = makeExtensionId("hook", `${hook.type}:${hook.tool}:${hook.name}`);
			const isDisabled = disabledExtensions.has(id);
			const isShadowed = (hook as { _shadowed?: boolean })._shadowed;
			const providerEnabled = isProviderEnabled(hook._source.provider);

			let state: ExtensionState;
			let disabledReason: "shadowed" | "provider-disabled" | "item-disabled" | undefined;

			if (isDisabled) {
				state = "disabled";
				disabledReason = "item-disabled";
			} else if (isShadowed) {
				state = "shadowed";
				disabledReason = "shadowed";
			} else if (!providerEnabled) {
				state = "disabled";
				disabledReason = "provider-disabled";
			} else {
				state = "active";
			}

			extensions.push({
				id,
				kind: "hook",
				name: hook.name,
				displayName: hook.name,
				description: `${hook.type}-${hook.tool}`,
				trigger: `${hook.type}:${hook.tool}`,
				path: hook.path,
				source: sourceFromMeta(hook._source),
				state,
				disabledReason,
				raw: hook,
			});
		}
	} catch (error) {
		logger.warn("Failed to load hooks capability", { error: String(error) });
	}

	// Load context files
	try {
		const contextFiles = await loadCapability<ContextFile>("context-files", loadOpts);
		for (const file of contextFiles.all) {
			// Extract filename from path for display
			const name = path.basename(file.path);
			const id = makeExtensionId("context-file", `${file.level}:${name}`);
			const isDisabled = disabledExtensions.has(id);
			const isShadowed = (file as { _shadowed?: boolean })._shadowed;
			const providerEnabled = isProviderEnabled(file._source.provider);

			let state: ExtensionState;
			let disabledReason: "shadowed" | "provider-disabled" | "item-disabled" | undefined;

			if (isDisabled) {
				state = "disabled";
				disabledReason = "item-disabled";
			} else if (isShadowed) {
				state = "shadowed";
				disabledReason = "shadowed";
			} else if (!providerEnabled) {
				state = "disabled";
				disabledReason = "provider-disabled";
			} else {
				state = "active";
			}

			extensions.push({
				id,
				kind: "context-file",
				name,
				displayName: name,
				description: file.level === "user" ? "User-level context" : "Project-level context",
				trigger: file.level,
				path: file.path,
				source: sourceFromMeta(file._source),
				state,
				disabledReason,
				raw: file,
			});
		}
	} catch (error) {
		logger.warn("Failed to load context-files capability", { error: String(error) });
	}

	return extensions;
}


/**
 * Apply fuzzy filter to extensions.
 */
export function applyFilter(extensions: Extension[], query: string): Extension[] {
	if (!query.trim()) {
		return extensions;
	}

	const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return extensions;
	}

	return extensions.filter(ext => {
		const searchable = [
			ext.name,
			ext.displayName,
			ext.description || "",
			ext.trigger || "",
			ext.source.providerName,
			ext.kind,
		].join(" ");

		return tokens.every(token => fuzzyMatch(token, searchable).matches);
	});
}

/**
 * Get display name for extension kind.
 */
function getKindDisplayName(kind: ExtensionKind): string {
	switch (kind) {
		case "extension-module":
			return "Extension Modules";
		case "skill":
			return "Skills";
		case "rule":
			return "Rules";
		case "tool":
			return "Tools";
		case "mcp":
			return "MCP Servers";
		case "prompt":
			return "Prompts";
		case "instruction":
			return "Instructions";
		case "context-file":
			return "Context Files";
		case "hook":
			return "Hooks";
		case "slash-command":
			return "Slash Commands";
		default:
			return kind;
	}
}

/**
 * Build provider tabs from extensions.
 */
export function buildProviderTabs(extensions: Extension[]): ProviderTab[] {
	const providers = getAllProvidersInfo();
	const tabs: ProviderTab[] = [];

	// Count extensions per provider
	const countByProvider = new Map<string, number>();
	for (const ext of extensions) {
		const count = countByProvider.get(ext.source.provider) ?? 0;
		countByProvider.set(ext.source.provider, count + 1);
	}

	// ALL tab first
	tabs.push({
		id: "all",
		label: "ALL",
		enabled: true,
		count: extensions.length,
	});

	// Provider tabs (skip native)
	for (const provider of providers) {
		if (provider.id === "native") continue;
		const count = countByProvider.get(provider.id) ?? 0;
		tabs.push({
			id: provider.id,
			label: provider.displayName,
			enabled: provider.enabled,
			count,
		});
	}

	// Sort: ALL first, then enabled by count, then disabled by count, then empty
	tabs.sort((a, b) => {
		if (a.id === "all") return -1;
		if (b.id === "all") return 1;

		// Categorize: 0 = enabled with content, 1 = disabled, 2 = empty+enabled
		const category = (t: ProviderTab) => {
			if (t.count === 0 && t.enabled) return 2; // empty
			if (!t.enabled) return 1; // disabled
			return 0; // enabled with content
		};

		const aCat = category(a);
		const bCat = category(b);
		if (aCat !== bCat) return aCat - bCat;

		// Within same category, sort by count descending
		return b.count - a.count;
	});

	return tabs;
}

/**
 * Filter extensions by provider tab.
 */
export function filterByProvider(extensions: Extension[], providerId: string): Extension[] {
	if (providerId === "all") {
		return extensions;
	}
	return extensions.filter(ext => ext.source.provider === providerId);
}


/**
 * Toggle provider enabled state.
 */
export function toggleProvider(providerId: string): boolean {
	if (isProviderEnabled(providerId)) {
		disableProvider(providerId);
		return false;
	} else {
		enableProvider(providerId);
		return true;
	}
}

/**
 * MVU-owned dashboard model. Filtering and selection are derived from one
 * source collection; renderers receive only bounded projections.
 */
export type ExtensionDashboardMode = "Browse" | "Filter" | "PreviewFocus";

export interface ExtensionDashboardModel {
	readonly sourceRevision: number;
	readonly requestGeneration: number;
	readonly loadState: "Idle" | "Loading" | "Failed";
	readonly loadError?: string;
	readonly tabs: readonly ProviderTab[];
	readonly activeTabId: string;
	readonly extensions: readonly Extension[];
	readonly disabledIds: readonly string[];
	readonly query: string;
	readonly selectedKey?: string;
	readonly viewportOffset: number;
	readonly viewportSize: number;
	readonly mode: ExtensionDashboardMode;
}

export type ExtensionDashboardMessage =
	| { readonly _tag: "Move"; readonly delta: -1 | 1 }
	| { readonly _tag: "BeginFilter" }
	| { readonly _tag: "FilterAppend"; readonly text: string }
	| { readonly _tag: "FilterDelete" }
	| { readonly _tag: "Activate" }
	| { readonly _tag: "ToggleSelected" }
	| { readonly _tag: "Back" }
	| { readonly _tag: "ProviderSelected"; readonly providerId: string }
	| { readonly _tag: "ProviderMove"; readonly delta: -1 | 1 }
	| { readonly _tag: "RefreshRequested" }
	| {
			readonly _tag: "SourceLoaded";
			readonly requestGeneration: number;
			readonly extensions: readonly Extension[];
			readonly disabledIds: readonly string[];
	  }
	| { readonly _tag: "SourceFailed"; readonly requestGeneration: number; readonly error: string }
	| { readonly _tag: "ViewportChanged"; readonly offset: number; readonly height: number };

export type ExtensionDashboardCommand =
	| { readonly _tag: "CloseRequested" }
	| { readonly _tag: "RefreshSource"; readonly requestGeneration: number }
	| { readonly _tag: "ToggleProvider"; readonly providerId: string; readonly requestGeneration: number }
	| {
			readonly _tag: "ToggleExtension";
			readonly extensionId: string;
			readonly disabled: boolean;
			readonly requestGeneration: number;
	  };

export interface ExtensionDashboardTransition {
	readonly model: ExtensionDashboardModel;
	readonly commands: readonly ExtensionDashboardCommand[];
}

export interface ExtensionProjectionRow {
	readonly _tag: "Master" | "Kind" | "Extension";
	readonly key: string;
	readonly providerId?: string;
	readonly providerName?: string;
	readonly enabled?: boolean;
	readonly kind?: ExtensionKind;
	readonly label?: string;
	readonly icon?: string;
	readonly count?: number;
	readonly extension?: Extension;
}

function extensionRows(model: ExtensionDashboardModel): readonly Extension[] {
	const tabFiltered = filterByProvider([...model.extensions], model.activeTabId);
	return applyFilter(tabFiltered, model.query);
}

function projectionKeys(model: ExtensionDashboardModel): readonly string[] {
	const rows = extensionRows(model);
	const keys: string[] = [];
	if (model.activeTabId !== "all") keys.push(`provider:${model.activeTabId}:master`);
	if (model.activeTabId === "all" && model.query.length === 0) {
		for (const extension of rows) keys.push(extension.id);
		return keys;
	}
	for (const extension of rows) keys.push(extension.id);
	return keys;
}

export function projectExtensionRows(model: ExtensionDashboardModel): readonly ExtensionProjectionRow[] {
	const rows = extensionRows(model);
	const result: ExtensionProjectionRow[] = [];
	if (model.activeTabId !== "all") {
		const tab = model.tabs.find(item => item.id === model.activeTabId);
		result.push({
			_tag: "Master",
			key: `provider:${model.activeTabId}:master`,
			providerId: model.activeTabId,
			providerName: rows[0]?.source.providerName ?? tab?.label ?? model.activeTabId,
			enabled: tab?.enabled ?? false,
		});
	}
	if (model.activeTabId === "all" && model.query.length === 0) {
		const seen = new Set<ExtensionKind>();
		for (const extension of rows) {
			if (seen.has(extension.kind)) continue;
			seen.add(extension.kind);
			const items = rows.filter(item => item.kind === extension.kind);
			result.push({
				_tag: "Kind",
				key: `kind:${extension.kind}`,
				kind: extension.kind,
				label: getKindDisplayName(extension.kind),
				icon: extensionIcon(extension.kind),
				count: items.length,
			});
			for (const item of items) result.push({ _tag: "Extension", key: item.id, extension: item });
		}
		return result;
	}
	for (const extension of rows) result.push({ _tag: "Extension", key: extension.id, extension });
	return result;
}

function extensionIcon(kind: ExtensionKind): string {
	switch (kind) {
		case "extension-module":
		case "tool":
			return "⚙";
		case "skill":
			return "✦";
		case "rule":
			return "◆";
		case "mcp":
			return "↔";
		case "prompt":
			return "¶";
		case "instruction":
			return "▸";
		case "context-file":
			return "□";
		case "hook":
			return "⌁";
		case "slash-command":
			return "/";
	}
}

function firstSelection(model: ExtensionDashboardModel): string | undefined {
	return projectionKeys(model)[0];
}

export async function createExtensionDashboardModel(
	cwd?: string,
	disabledIds: readonly string[] = [],
): Promise<ExtensionDashboardModel> {
	const extensions = await loadAllExtensions(cwd, [...disabledIds]);
	const tabs = buildProviderTabs(extensions);
	const model: ExtensionDashboardModel = {
		sourceRevision: 0,
		requestGeneration: 0,
		loadState: "Idle",
		tabs,
		activeTabId: tabs[0]?.id ?? "all",
		extensions,
		disabledIds: [...disabledIds],
		query: "",
		selectedKey: undefined,
		viewportOffset: 0,
		viewportSize: 10,
		mode: "Browse",
	};
	return { ...model, selectedKey: firstSelection(model) };
}

export function replaceExtensionSource(
	model: ExtensionDashboardModel,
	extensions: readonly Extension[],
	disabledIds: readonly string[],
	sourceRevision = model.sourceRevision + 1,
): ExtensionDashboardModel {
	if (sourceRevision <= model.sourceRevision) return model;
	const tabs = buildProviderTabs([...extensions]);
	const activeTabId = tabs.some(tab => tab.id === model.activeTabId) ? model.activeTabId : tabs[0]?.id ?? "all";
	const next: ExtensionDashboardModel = {
		...model,
		sourceRevision,
		loadState: "Idle",
		loadError: undefined,
		tabs,
		activeTabId,
		extensions,
		disabledIds: [...disabledIds],
		viewportOffset: 0,
	};
	const keys = projectionKeys(next);
	const selectedKey = model.selectedKey && keys.includes(model.selectedKey) ? model.selectedKey : keys[0];
	return { ...next, selectedKey };
}

export function reduceExtensionDashboard(
	model: ExtensionDashboardModel,
	message: ExtensionDashboardMessage,
): ExtensionDashboardTransition {
	switch (message._tag) {
		case "Move": {
			const keys = projectionKeys(model);
			const current = model.selectedKey === undefined ? -1 : keys.indexOf(model.selectedKey);
			const nextIndex = Math.max(0, Math.min(keys.length - 1, (current < 0 ? 0 : current) + message.delta));
			const nextKey = keys[nextIndex];
			const maxOffset = Math.max(0, keys.length - model.viewportSize);
			const nextOffset = Math.max(0, Math.min(maxOffset, nextIndex - Math.max(0, model.viewportSize - 1)));
			return { model: { ...model, selectedKey: nextKey, viewportOffset: nextOffset, mode: model.mode === "PreviewFocus" ? "PreviewFocus" : "Browse" }, commands: [] };
		}
		case "BeginFilter":
			return { model: { ...model, mode: "Filter", query: "" }, commands: [] };
		case "FilterAppend":
			if (model.mode !== "Filter") return { model, commands: [] };
			return replaceAfterQuery(model, `${model.query}${message.text}`);
		case "FilterDelete":
			if (model.mode !== "Filter") return { model, commands: [] };
			return replaceAfterQuery(model, model.query.slice(0, -1));
		case "Activate": {
			if (model.selectedKey === undefined) return { model, commands: [] };
			if (model.mode === "Browse" || model.mode === "Filter") {
				return { model: { ...model, mode: "PreviewFocus" }, commands: [] };
			}
			return beginToggle(model);
		}
		case "ToggleSelected":
			return beginToggle(model);
		case "Back":
			if (model.mode === "PreviewFocus") return { model: { ...model, mode: model.query ? "Filter" : "Browse" }, commands: [] };
			if (model.mode === "Filter") return { model: { ...model, mode: "Browse", query: "" }, commands: [] };
			return { model, commands: [{ _tag: "CloseRequested" }] };
		case "ProviderSelected": {
			if (!model.tabs.some(tab => tab.id === message.providerId)) return { model, commands: [] };
			const next = { ...model, activeTabId: message.providerId, mode: "Browse" as const, viewportOffset: 0 };
			return { model: { ...next, selectedKey: firstSelection(next) }, commands: [] };
		}
		case "ProviderMove": {
			const current = Math.max(0, model.tabs.findIndex(tab => tab.id === model.activeTabId));
			const index = (current + message.delta + model.tabs.length) % model.tabs.length;
			const activeTabId = model.tabs[index]?.id;
			if (activeTabId === undefined) return { model, commands: [] };
			const next = { ...model, activeTabId, mode: "Browse" as const, viewportOffset: 0 };
			return { model: { ...next, selectedKey: firstSelection(next) }, commands: [] };
		}
		case "RefreshRequested":
			return beginRefresh(model);
		case "SourceLoaded":
			if (message.requestGeneration !== model.requestGeneration) return { model, commands: [] };
			return {
				model: replaceExtensionSource(model, message.extensions, message.disabledIds),
				commands: [],
			};
		case "SourceFailed":
			if (message.requestGeneration !== model.requestGeneration) return { model, commands: [] };
			return {
				model: { ...model, loadState: "Failed", loadError: message.error },
				commands: [],
			};
		case "ViewportChanged":
			return {
				model: {
					...model,
					viewportOffset: Math.max(0, message.offset),
					viewportSize: Math.max(1, message.height),
				},
				commands: [],
			};
	}
}

function beginRefresh(model: ExtensionDashboardModel): ExtensionDashboardTransition {
	const requestGeneration = model.requestGeneration + 1;
	return {
		model: { ...model, requestGeneration, loadState: "Loading", loadError: undefined },
		commands: [{ _tag: "RefreshSource", requestGeneration }],
	};
}

function beginToggle(model: ExtensionDashboardModel): ExtensionDashboardTransition {
	const selectedKey = model.selectedKey;
	if (selectedKey === undefined) return { model, commands: [] };
	const requestGeneration = model.requestGeneration + 1;
	const nextModel = { ...model, requestGeneration, loadState: "Loading" as const, loadError: undefined };
	if (selectedKey.startsWith("provider:")) {
		return {
			model: nextModel,
			commands: [{ _tag: "ToggleProvider", providerId: model.activeTabId, requestGeneration }],
		};
	}
	const extension = model.extensions.find(item => item.id === selectedKey);
	if (extension === undefined) return { model, commands: [] };
	const disabled = extension.state !== "disabled" || extension.disabledReason !== "item-disabled";
	return {
		model: nextModel,
		commands: [{ _tag: "ToggleExtension", extensionId: extension.id, disabled, requestGeneration }],
	};
}

function replaceAfterQuery(model: ExtensionDashboardModel, query: string): ExtensionDashboardTransition {
	const next = { ...model, query };
	const keys = projectionKeys(next);
	const selectedKey = model.selectedKey && keys.includes(model.selectedKey) ? model.selectedKey : keys[0];
	return { model: { ...next, selectedKey, viewportOffset: 0 }, commands: [] };
}
