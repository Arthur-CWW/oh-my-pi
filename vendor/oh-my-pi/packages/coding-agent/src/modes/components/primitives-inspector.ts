import * as path from "node:path";
import { isZodSchema, zodToWireSchema } from "@oh-my-pi/pi-ai/utils/schema";
import type { Component, Keybinding } from "@oh-my-pi/pi-tui";
import { isEnoent, parseFrontmatter } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import { Effect, Schema, Scope } from "effect";
import { makeComponentId, type ActiveKeymapContext, type ComponentId, type KeyEvent } from "../mvu/schema";
import type { MvuEnvelope } from "../mvu/input-lease";
import { mountMvuOverlay, type MvuRouteHandle } from "../mvu/route-host";
import { SETTINGS_SCHEMA, type SettingPath } from "../../config/settings";
import { buildFeedsListViewModel, renderFeedResource, resolveFeedSurfacePaths } from "../../feeds";
import { resolveMemoryBackend } from "../../memory-backend";
import type { Tool } from "../../tools";
import { replaceTabs, truncateToWidth } from "../../tools/render-utils";
import { theme } from "../theme/theme";
import type { InteractiveModeContext } from "../types";
import { computeContextBreakdown } from "../utils/context-usage";
import { DynamicBorder } from "./dynamic-border";
import {
	createPrimitiveInspectorState,
	type PrimitiveCategoryId,
	type PrimitiveInspectorCategory,
	type PrimitiveInspectorItem,
	type PrimitiveInspectorMsg,
	type PrimitiveInspectorState,
	type PrimitiveInspectorCommand,
	selectedPrimitiveCategory,
	selectedPrimitiveItem,
	visiblePrimitiveCategories,
	visiblePrimitiveItems,
	updatePrimitiveInspector,
} from "./primitives-inspector-state";

export type { PrimitiveCategoryId } from "./primitives-inspector-state";

const CatalogStoreSchema = Schema.Struct({
	path: Schema.String,
	kind: Schema.String,
	domain: Schema.String,
	contents: Schema.optional(Schema.String),
	query: Schema.optional(Schema.String),
	size: Schema.optional(Schema.String),
	updated: Schema.optional(Schema.String),
});
const DataStoreCatalogSchema = Schema.Struct({ stores: Schema.Array(CatalogStoreSchema) });


function firstLine(value: string): string {
	return value.replace(/\s+/g, " ").trim().split(". ", 1)[0] ?? "";
}

function toolSchemaSummary(tool: Pick<Tool, "parameters">): string {
	try {
		const schema = isZodSchema(tool.parameters) ? zodToWireSchema(tool.parameters) : tool.parameters;
		return JSON.stringify(schema ?? {}, null, 2);
	} catch (error) {
		return `Schema unavailable: ${error instanceof Error ? error.message : String(error)}`;
	}
}

async function buildToolCategory(ctx: InteractiveModeContext): Promise<PrimitiveInspectorCategory> {
	const tools = ctx.session.agent.state.tools;
	return {
		id: "tools",
		label: "Tools",
		source: "live agent tool registry",
		available: true,
		items: tools.map(tool => ({
			id: tool.name,
			label: tool.name,
			summary: firstLine(tool.description) || "No description provided",
			enabled: true,
			detail: [
				`Name: ${tool.name}`,
				`Enabled: yes (visible in live registry)`,
				`Description: ${tool.description || "No description provided"}`,
				"",
				"Input schema",
				toolSchemaSummary(tool),
			].join("\n"),
		})),
	};
}

async function buildSkillCategory(ctx: InteractiveModeContext): Promise<PrimitiveInspectorCategory> {
	const items = await Promise.all(
		Array.from(ctx.skillCommands.entries(), async ([commandName, filePath]): Promise<PrimitiveInspectorItem> => {
			const label = commandName.replace(/^skill:/, "");
			try {
				const source = await Bun.file(filePath).text();
				const { frontmatter } = parseFrontmatter(source, { source: filePath });
				const description = typeof frontmatter.description === "string" ? frontmatter.description : "Loaded skill";
				return {
					id: commandName,
					label,
					summary: firstLine(description),
					detail: [`Path: ${filePath}`, "", "Frontmatter", YAML.stringify(frontmatter).trim()].join("\n"),
				};
			} catch (error) {
				return {
					id: commandName,
					label,
					summary: "Loaded skill (frontmatter unavailable)",
					detail: `Path: ${filePath}\nFrontmatter unavailable: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		}),
	);
	return {
		id: "skills",
		label: "Skills",
		source: "loaded skill command set",
		available: true,
		items: items.sort((a, b) => a.label.localeCompare(b.label)),
	};
}

async function buildFeedCategory(cwd: string): Promise<PrimitiveInspectorCategory> {
	const paths = await resolveFeedSurfacePaths(cwd);
	try {
		const rows = await buildFeedsListViewModel(paths);
		const items = await Promise.all(
			rows.map(async row => {
				const digest = await renderFeedResource(row.name, paths);
				const tail = digest.split("\n").slice(-24).join("\n");
				return {
					id: row.name,
					label: row.name,
					summary: `${row.kind} · ${row.itemCount} items · ${row.lastSyncAt ?? "never synced"}`,
					detail: [
						`feed://${row.name}`,
						`Target: ${row.target}`,
						`Cadence: ${row.cadence}`,
						"",
						"Digest tail",
						tail,
					].join("\n"),
				};
			}),
		);
		return { id: "feeds", label: "Feeds", source: paths.registryPath, available: true, items };
	} catch (error) {
		return {
			id: "feeds",
			label: "Feeds",
			source: paths.registryPath,
			available: false,
			items: [],
			unavailableDetail: error instanceof Error ? error.message : String(error),
		};
	}
}

async function buildMemoryCategory(ctx: InteractiveModeContext): Promise<PrimitiveInspectorCategory> {
	const backend = await resolveMemoryBackend(ctx.settings);
	const source = path.join(ctx.settings.getAgentDir(), backend.id === "off" ? "memory" : backend.id);
	if (!backend.status) {
		return {
			id: "memories",
			label: "Memories",
			source,
			available: false,
			items: [],
			unavailableDetail: `The ${backend.id} backend exposes no readable status surface.`,
		};
	}
	try {
		const status = await backend.status({
			agentDir: ctx.settings.getAgentDir(),
			cwd: ctx.sessionManager.getCwd(),
			session: ctx.session,
		});
		const counts = [status.workingCount, status.episodicCount, status.tripleCount]
			.filter((value): value is number => value !== undefined)
			.reduce((sum, value) => sum + value, 0);
		return {
			id: "memories",
			label: "Memories",
			source: status.database ?? source,
			available: status.active,
			items: status.active
				? [
						{
							id: status.backend,
							label: status.backend,
							summary: `${counts} indexed · ${status.searchable ? "searchable" : "not searchable"}`,
							detail: YAML.stringify(status).trim(),
						},
					]
				: [],
			unavailableDetail: status.active
				? undefined
				: (status.message ?? status.error ?? "Memory backend is disabled."),
		};
	} catch (error) {
		return {
			id: "memories",
			label: "Memories",
			source,
			available: false,
			items: [],
			unavailableDetail: error instanceof Error ? error.message : String(error),
		};
	}
}

function parseDataStoreCatalog(text: string): unknown {
	const stores: Array<Record<string, string>> = [];
	let current: Record<string, string> | undefined;
	let blockKey: string | undefined;
	for (const line of text.split(/\r?\n/)) {
		const item = /^ {2}- ([\w-]+):\s*(.*)$/.exec(line);
		if (item) {
			current = {};
			stores.push(current);
			current[item[1]!] = item[2]!;
			blockKey = undefined;
			continue;
		}
		const field = /^ {4}([\w-]+):\s*(.*)$/.exec(line);
		if (field && current) {
			blockKey = field[2] === ">-" || field[2] === "|" ? field[1] : undefined;
			current[field[1]!] = blockKey ? "" : field[2]!;
			continue;
		}
		if (blockKey && current) {
			const continuation = /^ {6}(.*)$/.exec(line);
			if (continuation) {
				current[blockKey] = `${current[blockKey]}${current[blockKey] ? " " : ""}${continuation[1]}`.trim();
				continue;
			}
			if (line.trim() !== "") blockKey = undefined;
		}
	}
	return { stores };
}

async function readDataStoreCatalog(
	cwd: string,
): Promise<{ readonly path: string; readonly value: unknown } | undefined> {
	let directory = path.resolve(cwd);
	for (;;) {
		const catalogPath = path.join(directory, "catalog", "data-stores.yml");
		try {
			return { path: catalogPath, value: parseDataStoreCatalog(await Bun.file(catalogPath).text()) };
		} catch (error) {
			if (!isEnoent(error)) throw error;
		}
		const parent = path.dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
}

async function buildDataStoreCategory(cwd: string): Promise<PrimitiveInspectorCategory> {
	const catalog = await readDataStoreCatalog(cwd);
	if (!catalog) {
		return {
			id: "stores",
			label: "Data stores",
			source: path.join(cwd, "catalog", "data-stores.yml"),
			available: false,
			items: [],
			unavailableDetail: "No catalog/data-stores.yml was reachable from the session cwd.",
		};
	}
	try {
		const decoded = Schema.decodeUnknownSync(DataStoreCatalogSchema)(catalog.value);
		return {
			id: "stores",
			label: "Data stores",
			source: catalog.path,
			available: true,
			items: decoded.stores.map((store, index) => ({
				id: `${store.path}:${index}`,
				label: store.path,
				summary: `${store.kind} · ${store.domain}${store.size ? ` · ${store.size}` : ""}`,
				detail: [
					`Path: ${store.path}`,
					`Kind: ${store.kind}`,
					`Domain: ${store.domain}`,
					store.size ? `Size: ${store.size}` : undefined,
					store.updated ? `Updated: ${store.updated}` : undefined,
					"",
					"Catalog row counts / contents",
					store.contents ?? "No row-count summary recorded.",
					store.query ? `\nQuery\n${store.query}` : undefined,
				]
					.filter((line): line is string => line !== undefined)
					.join("\n"),
			})),
		};
	} catch (error) {
		return {
			id: "stores",
			label: "Data stores",
			source: catalog.path,
			available: false,
			items: [],
			unavailableDetail: `Catalog schema error: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function buildSessionCategory(ctx: InteractiveModeContext): PrimitiveInspectorCategory {
	const model = ctx.session.model;
	const breakdown = computeContextBreakdown(ctx.session);
	const contextPercent = breakdown.contextWindow > 0 ? (breakdown.usedTokens / breakdown.contextWindow) * 100 : 0;
	const lane = ctx.focusedAgentId ? `agent:${ctx.focusedAgentId}` : "Main";
	const settingsLines = (Object.keys(SETTINGS_SCHEMA) as SettingPath[]).sort().map(key => {
		const value = /(?:key|token|secret|password|credential)/i.test(key) ? "<redacted>" : ctx.settings.get(key);
		return `${key}: ${JSON.stringify(value)}`;
	});
	return {
		id: "session",
		label: "Session",
		source: ctx.sessionManager.getSessionFile() ?? "in-memory session",
		available: true,
		items: [
			{
				id: "runtime",
				label: "Runtime",
				summary: `${model ? `${model.provider}/${model.id}` : "no model"} · ${lane} · ${contextPercent.toFixed(1)}% context`,
				detail: [
					`Model: ${model ? `${model.provider}/${model.id}` : "none"}`,
					`Lane: ${lane}`,
					`Context: ${breakdown.usedTokens} / ${breakdown.contextWindow} tokens (${contextPercent.toFixed(1)}%)`,
				].join("\n"),
			},
			{
				id: "settings",
				label: "Settings snapshot",
				summary: `${settingsLines.length} effective settings · secret-like fields redacted`,
				detail: settingsLines.join("\n"),
			},
		],
	};
}

export async function projectPrimitivesInspectorCategories(
	ctx: InteractiveModeContext,
): Promise<readonly PrimitiveInspectorCategory[]> {
	const cwd = ctx.sessionManager.getCwd();
	return Promise.all([
		buildToolCategory(ctx),
		buildSkillCategory(ctx),
		buildFeedCategory(cwd),
		buildMemoryCategory(ctx),
		buildDataStoreCategory(cwd),
		Promise.resolve(buildSessionCategory(ctx)),
	]);
}

function plainLine(value: string, width: number): string {
	return truncateToWidth(replaceTabs(value), Math.max(1, width));
}

export interface PrimitiveInspectorPatch {
	readonly categories: readonly PrimitiveInspectorCategory[];
	readonly state: PrimitiveInspectorState;
	readonly dirtyKeys: ReadonlySet<string>;
}

export function viewPrimitivesInspector(
	categories: readonly PrimitiveInspectorCategory[],
	state: PrimitiveInspectorState,
	dirtyKeys: ReadonlySet<string> = new Set(),
): PrimitiveInspectorPatch {
	return { categories, state, dirtyKeys };
}

function primitiveMode(state: PrimitiveInspectorState): "TreeBrowse" | "TreeFilter" | "TreePreview" | "TreeLabelEdit" | "TreeConfirm" {
	if (state.filterEditing || state.filterQuery.length > 0) return "TreeFilter";
	if (state.depth === 2) return "TreePreview";
	return "TreeBrowse";
}

export function primitivesInspectorActionToMsg(action: string, event: KeyEvent): PrimitiveInspectorMsg | undefined {
	if (event._tag !== "Press" && event._tag !== "Paste") return undefined;
	const text = event._tag === "Paste" ? event.text : event.text ?? String(event.key);
	switch (action) {
		case "app.navigation.up": return { _tag: "Move", delta: -1 };
		case "app.navigation.down": return { _tag: "Move", delta: 1 };
		case "tui.select.pageUp": return { _tag: "Page", delta: -1 };
		case "tui.select.pageDown": return { _tag: "Page", delta: 1 };
		case "app.selector.filter": return { _tag: "BeginFilter" };
		case "app.selector.filterAppend":
			return text.length > 0 ? { _tag: "FilterAppend", text } : undefined;
		case "app.selector.filterDelete": return { _tag: "FilterDelete" };
		case "ui.dismiss": return { _tag: "Back" };
		case "tui.select.confirm": return { _tag: "Activate" };
		case "app.primitives.help": return { _tag: "ToggleHelp" };
		default: return undefined;
	}
}

/** Renderer-only read-only primitives inspector. */
export class PrimitivesInspectorOverlayComponent implements Component {
	#patch: PrimitiveInspectorPatch | undefined;
	#cached: { readonly width: number; readonly patch: PrimitiveInspectorPatch; readonly lines: readonly string[] } | undefined;

	constructor(categories: readonly PrimitiveInspectorCategory[], initialCategory?: PrimitiveCategoryId) {
		this.#patch = viewPrimitivesInspector(categories, createPrimitiveInspectorState(categories, initialCategory));
	}

	apply(patch: PrimitiveInspectorPatch): void {
		if (this.#patch === patch) return;
		this.#patch = patch;
		this.#cached = undefined;
	}

	invalidate(): void {
		this.#cached = undefined;
	}

	render(width: number): readonly string[] {
		const patch = this.#patch;
		if (patch === undefined) return [];
		if (this.#cached?.width === width && this.#cached.patch === patch) return this.#cached.lines;
		const safeWidth = Math.max(40, width);
		const innerWidth = safeWidth - 2;
		const leftWidth = Math.min(40, Math.max(24, Math.floor(innerWidth * 0.28)));
		const rightWidth = Math.max(12, innerWidth - leftWidth - 3);
		const height = Math.max(12, (process.stdout.rows || 40) - 5);
		const state = patch.state;
		const lines: string[] = [...new DynamicBorder().render(safeWidth)];
		const filter = state.filterQuery || state.filterEditing ? ` /${state.filterQuery}` : "";
		lines.push(` ${theme.fg("accent", "Primitives Inspector")}${theme.fg("dim", " · read-only")}${theme.fg("accent", filter)}${state.filterEditing ? theme.fg("dim", "▏") : ""}`);
		lines.push(...new DynamicBorder().render(safeWidth));
		if (state.helpVisible) {
			for (const line of [
				"Normal mode (default)",
				"j/k or ↓/↑   navigate",
				"l/Enter/→    drill in",
				"h/←          back",
				"/            filter current level",
				"Esc          unwind one reversible layer",
				"?            close this help",
				"",
				"Read-only: this surface never mutates primitive domains.",
			]) lines.push(` ${plainLine(line, innerWidth)}`);
			while (lines.length < height) lines.push("");
			lines.push(...new DynamicBorder().render(safeWidth));
			this.#cached = { width, patch, lines };
			return lines;
		}

		const activeCategory = selectedPrimitiveCategory(patch.categories, state);
		const activeItem = selectedPrimitiveItem(patch.categories, state);
		const visibleCategories = visiblePrimitiveCategories(patch.categories, state);
		const left: string[] = [theme.fg("dim", "CATEGORIES")];
		for (const category of visibleCategories) {
			const selected = category.id === activeCategory?.id;
			const availability = category.available ? `${category.items.length}` : theme.fg("dim", "off");
			left.push(`${selected ? theme.fg("accent", ">") : " "} ${category.available ? category.label : theme.fg("dim", category.label)} ${theme.fg("dim", availability)}`);
		}

		const right: string[] = [];
		if (!activeCategory) {
			right.push(theme.fg("dim", "No matching categories."));
		} else if (state.depth === 0) {
			right.push(theme.fg("accent", activeCategory.label), theme.fg("dim", activeCategory.source), "");
			right.push(activeCategory.available
				? `${activeCategory.items.length} item${activeCategory.items.length === 1 ? "" : "s"}. Press Enter to inspect.`
				: theme.fg("dim", activeCategory.unavailableDetail ?? "Unavailable."));
		} else if (state.depth === 1) {
			right.push(theme.fg("accent", activeCategory.label), theme.fg("dim", activeCategory.source), "");
			const items = visiblePrimitiveItems(patch.categories, state);
			if (items.length === 0) right.push(theme.fg("dim", activeCategory.unavailableDetail ?? "No matching items."));
			for (const item of items) {
				const enabled = item.enabled === undefined ? "" : item.enabled ? theme.fg("success", " on") : theme.fg("dim", " off");
				right.push(`${item.id === activeItem?.id ? theme.fg("accent", ">") : " "} ${item.label}${enabled}`, `    ${theme.fg("dim", item.summary)}`);
			}
		} else {
			right.push(theme.fg("accent", activeItem?.label ?? activeCategory.label), theme.fg("dim", activeItem?.summary ?? activeCategory.source), "");
			right.push(...(activeItem?.detail ?? activeCategory.unavailableDetail ?? "No detail available.").split("\n"));
		}

		const bodyHeight = Math.max(6, height - lines.length - 2);
		const rightStart = state.depth === 2 ? state.detailOffset : 0;
		for (let rowIndex = 0; rowIndex < bodyHeight; rowIndex++) {
			lines.push(` ${plainLine(left[rowIndex] ?? "", leftWidth).padEnd(leftWidth)} ${theme.fg("dim", "│")} ${plainLine(right[rightStart + rowIndex] ?? "", rightWidth)}`);
		}
		lines.push(theme.fg("dim", " j/k navigate · Enter drill · / filter · Esc back · ? help"));
		lines.push(...new DynamicBorder().render(safeWidth));
		this.#cached = { width, patch, lines };
		return lines;
	}
}

export interface PrimitivesInspectorRouteSpec {
	readonly componentId: ComponentId;
	readonly focusedRoot: PrimitivesInspectorOverlayComponent;
	readonly categories: readonly PrimitiveInspectorCategory[];
	readonly initialModel: PrimitiveInspectorState;
	readonly context: (model: PrimitiveInspectorState) => ActiveKeymapContext;
	readonly actionToMsg: (action: Keybinding, event: KeyEvent) => PrimitiveInspectorMsg | undefined;
}

export function createPrimitivesInspectorRoute(
	categories: readonly PrimitiveInspectorCategory[],
	initialCategory?: PrimitiveCategoryId,
): PrimitivesInspectorRouteSpec {
	const componentId = makeComponentId("primitives-inspector");
	return {
		componentId,
		focusedRoot: new PrimitivesInspectorOverlayComponent(categories, initialCategory),
		categories,
		initialModel: createPrimitiveInspectorState(categories, initialCategory),
		context: model => ({ contexts: ["selector.global", "selector.filter"], mode: primitiveMode(model), focus: model.depth === 2 ? "preview" : "list", capabilities: new Set(["selector.filter"]) }),
		actionToMsg: (action, event) => primitivesInspectorActionToMsg(String(action), event),
	};
}

type PrimitivesRouteCommand =
	| PrimitiveInspectorCommand
	| {
			readonly _tag: "RenderPrimitives";
			readonly model: PrimitiveInspectorState;
			readonly dirtyKeys: ReadonlySet<string>;
	  };

const activePrimitivesRoutes = new WeakMap<InteractiveModeContext, MvuRouteHandle>();

export async function showPrimitivesInspectorOverlay(
	ctx: InteractiveModeContext,
	initialCategory?: PrimitiveCategoryId,
): Promise<void> {
	let categories: readonly PrimitiveInspectorCategory[];
	try {
		categories = await projectPrimitivesInspectorCategories(ctx);
	} catch (error) {
		ctx.showError(`Failed to open primitives inspector: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	const previous = activePrimitivesRoutes.get(ctx);
	if (previous !== undefined) {
		activePrimitivesRoutes.delete(ctx);
		await Effect.runPromise(previous.close());
	}
	const spec = createPrimitivesInspectorRoute(categories, initialCategory);
	spec.focusedRoot.apply(viewPrimitivesInspector(spec.categories, spec.initialModel));
	const close = (): void => {
		const handle = activePrimitivesRoutes.get(ctx);
		if (handle === undefined) return;
		activePrimitivesRoutes.delete(ctx);
		void Effect.runPromise(handle.close());
	};
	const handle = await Effect.runPromise(
		Scope.provide(ctx.mvuScope)(
			mountMvuOverlay({
				tui: ctx.ui,
				leaseManager: ctx.mvuInputLeaseManager,
				route: {
					componentId: spec.componentId,
					focusedRoot: spec.focusedRoot,
					context: spec.context,
					actionToMsg: (action, event) =>
						spec.actionToMsg(action, event) === undefined ? undefined : { _tag: "MvuInput", action, event },
				},
				component: spec.focusedRoot,
				runtimeConfig: {
					componentId: spec.componentId,
					initialModel: spec.initialModel,
					update: (model: PrimitiveInspectorState, envelope: MvuEnvelope) => {
						const message = spec.actionToMsg(envelope.action, envelope.event);
						if (message === undefined) return { model, commands: [], dirtyKeys: new Set<string>() };
						const transition = updatePrimitiveInspector(spec.categories, model, message);
						return {
							model: transition.model,
							commands: [
								...transition.commands,
								{ _tag: "RenderPrimitives", model: transition.model, dirtyKeys: transition.dirtyKeys } as const,
							],
							dirtyKeys: transition.dirtyKeys,
						};
					},
					interpret: (command: PrimitivesRouteCommand) =>
						Effect.sync(() => {
							if (command._tag === "CloseRequested") close();
							else {
								spec.focusedRoot.apply(viewPrimitivesInspector(spec.categories, command.model, command.dirtyKeys));
								ctx.ui.requestComponentRender(spec.focusedRoot);
							}
							return [];
						}),
					inputCapacity: 256,
					messageCapacity: 256,
					commandCapacity: 64,
				},
				overlayOptions: { anchor: "bottom-center", width: "100%", maxHeight: "100%", margin: 0 },
				restoreFocus: Effect.sync(() => {
					ctx.ui.setFocus(ctx.editor);
					ctx.ui.requestRender();
				}),
			}),
		),
	);
	activePrimitivesRoutes.set(ctx, handle);
	ctx.ui.setFocus(spec.focusedRoot);
	ctx.ui.requestRender();
}
