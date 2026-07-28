import * as path from "node:path";
import { isZodSchema, zodToWireSchema } from "@oh-my-pi/pi-ai/utils/schema";
import { Container, matchesKey, type OverlayHandle } from "@oh-my-pi/pi-tui";
import { isEnoent, parseFrontmatter } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import { Schema } from "effect";
import type { KeyId } from "../../config/keybindings";
import { SETTINGS_SCHEMA, type SettingPath } from "../../config/settings";
import { buildFeedsListViewModel, renderFeedResource, resolveFeedSurfacePaths } from "../../feeds";
import { resolveMemoryBackend } from "../../memory-backend";
import type { Tool } from "../../tools";
import { replaceTabs, truncateToWidth } from "../../tools/render-utils";
import { theme } from "../theme/theme";
import type { InteractiveModeContext } from "../types";
import { computeContextBreakdown } from "../utils/context-usage";
import { matchesUiDismiss } from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";
import { keyHint } from "./keybinding-hints";
import {
	beginPrimitiveFilter,
	createPrimitiveInspectorState,
	drillIntoPrimitive,
	movePrimitiveSelection,
	type PrimitiveCategoryId,
	type PrimitiveInspectorCategory,
	type PrimitiveInspectorItem,
	type PrimitiveInspectorState,
	selectedPrimitiveCategory,
	selectedPrimitiveItem,
	unwindPrimitiveInspector,
	updatePrimitiveFilter,
	visiblePrimitiveCategories,
	visiblePrimitiveItems,
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

interface InspectorDeps {
	readonly categories: readonly PrimitiveInspectorCategory[];
	readonly inspectKeys: readonly KeyId[];
	readonly onDone: () => void;
	readonly requestRender: () => void;
}

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

export class PrimitivesInspectorOverlayComponent extends Container {
	readonly #categories: readonly PrimitiveInspectorCategory[];
	readonly #inspectKeys: readonly KeyId[];
	readonly #onDone: () => void;
	readonly #requestRender: () => void;
	#state: PrimitiveInspectorState;
	#showHelp = false;

	constructor(deps: InspectorDeps, initialCategory?: PrimitiveCategoryId) {
		super();
		this.#categories = deps.categories;
		this.#inspectKeys = deps.inspectKeys;
		this.#onDone = deps.onDone;
		this.#requestRender = deps.requestRender;
		this.#state = createPrimitiveInspectorState(this.#categories, initialCategory);
	}

	handleInput(keyData: string): void {
		if (this.#showHelp) {
			this.#showHelp = false;
			this.#requestRender();
			return;
		}
		for (const key of this.#inspectKeys) {
			if (matchesKey(keyData, key)) {
				this.#onDone();
				return;
			}
		}
		if (this.#state.filterEditing) {
			if (matchesKey(keyData, "enter") || keyData === "\r" || keyData === "\n") {
				this.#state = { ...this.#state, filterEditing: false };
			} else if (matchesUiDismiss(keyData)) {
				this.#state = { ...this.#state, filterEditing: false, filterQuery: "" };
			} else if (matchesKey(keyData, "backspace")) {
				this.#state = updatePrimitiveFilter(this.#state, this.#state.filterQuery.slice(0, -1));
			} else if (keyData.length === 1 && keyData >= " ") {
				this.#state = updatePrimitiveFilter(this.#state, this.#state.filterQuery + keyData);
			}
			this.#requestRender();
			return;
		}
		if (matchesUiDismiss(keyData)) {
			const next = unwindPrimitiveInspector(this.#state);
			if (!next) this.#onDone();
			else {
				this.#state = next;
				this.#requestRender();
			}
			return;
		}
		if (keyData === "?") this.#showHelp = true;
		else if (keyData === "/") this.#state = beginPrimitiveFilter(this.#state);
		else if (keyData === "j" || matchesKey(keyData, "down")) {
			this.#state = movePrimitiveSelection(this.#categories, this.#state, 1);
		} else if (keyData === "k" || matchesKey(keyData, "up")) {
			this.#state = movePrimitiveSelection(this.#categories, this.#state, -1);
		} else if (keyData === "l" || matchesKey(keyData, "right") || matchesKey(keyData, "enter")) {
			this.#state = drillIntoPrimitive(this.#categories, this.#state);
		} else if (keyData === "h" || matchesKey(keyData, "left")) {
			const next = unwindPrimitiveInspector({ ...this.#state, filterQuery: "", filterEditing: false });
			if (next) this.#state = next;
			else this.#onDone();
		}
		this.#requestRender();
	}

	override render(width: number): readonly string[] {
		const safeWidth = Math.max(40, width);
		const innerWidth = safeWidth - 2;
		const leftWidth = Math.min(40, Math.max(24, Math.floor(innerWidth * 0.28)));
		const rightWidth = Math.max(12, innerWidth - leftWidth - 3);
		const height = Math.max(12, (process.stdout.rows || 40) - 5);
		const lines: string[] = [...new DynamicBorder().render(safeWidth)];
		const filter = this.#state.filterQuery || this.#state.filterEditing ? ` /${this.#state.filterQuery}` : "";
		lines.push(
			` ${theme.fg("accent", "Primitives Inspector")}${theme.fg("dim", " · read-only")}${theme.fg("accent", filter)}${this.#state.filterEditing ? theme.fg("dim", "▏") : ""}`,
		);
		lines.push(...new DynamicBorder().render(safeWidth));
		if (this.#showHelp) {
			const help = [
				"Normal mode (default)",
				"j/k or ↓/↑   navigate",
				"l/Enter/→    drill in",
				"h/←          back",
				"/            filter current level",
				keyHint("ui.dismiss", "clear filter, unwind one level, then close"),
				"alt+i        toggle inspector (also :inspect)",
				"?            close this help",
				"",
				"Read-only v0: this surface never mutates tools, skills, feeds, memories, stores, or settings.",
			];
			for (const line of help) lines.push(` ${plainLine(line, innerWidth)}`);
			while (lines.length < height) lines.push("");
			lines.push(...new DynamicBorder().render(safeWidth));
			return lines;
		}
		const visibleCategories = visiblePrimitiveCategories(this.#categories, this.#state);
		const activeCategory = selectedPrimitiveCategory(this.#categories, this.#state);
		const activeItem = selectedPrimitiveItem(this.#categories, this.#state);
		const left: string[] = [theme.fg("dim", "CATEGORIES")];
		for (let index = 0; index < visibleCategories.length; index++) {
			const category = visibleCategories[index]!;
			const selected = category.id === activeCategory?.id;
			const marker = selected ? theme.fg("accent", ">") : " ";
			const availability = category.available ? `${category.items.length}` : theme.fg("dim", "off");
			const label = category.available ? category.label : theme.fg("dim", category.label);
			left.push(`${marker} ${label} ${theme.fg("dim", availability)}`);
		}
		const right: string[] = [];
		if (!activeCategory) {
			right.push(theme.fg("dim", "No matching categories."));
		} else if (this.#state.depth === 0) {
			right.push(theme.fg("accent", activeCategory.label));
			right.push(theme.fg("dim", activeCategory.source));
			right.push("");
			right.push(
				activeCategory.available
					? `${activeCategory.items.length} item${activeCategory.items.length === 1 ? "" : "s"}. Press l or Enter to inspect.`
					: theme.fg("dim", activeCategory.unavailableDetail ?? "Unavailable."),
			);
		} else if (this.#state.depth === 1) {
			right.push(theme.fg("accent", activeCategory.label));
			right.push(theme.fg("dim", activeCategory.source));
			right.push("");
			const items = visiblePrimitiveItems(this.#categories, this.#state);
			if (items.length === 0) right.push(theme.fg("dim", activeCategory.unavailableDetail ?? "No matching items."));
			for (let index = 0; index < items.length; index++) {
				const item = items[index]!;
				const marker = item.id === activeItem?.id ? theme.fg("accent", ">") : " ";
				const enabled =
					item.enabled === undefined ? "" : item.enabled ? theme.fg("success", " on") : theme.fg("dim", " off");
				right.push(`${marker} ${item.label}${enabled}`);
				right.push(`    ${theme.fg("dim", item.summary)}`);
			}
		} else {
			right.push(theme.fg("accent", activeItem?.label ?? activeCategory.label));
			right.push(theme.fg("dim", activeItem?.summary ?? activeCategory.source));
			right.push("");
			right.push(...(activeItem?.detail ?? activeCategory.unavailableDetail ?? "No detail available.").split("\n"));
		}
		const bodyHeight = Math.max(6, height - lines.length - 2);
		const rightStart = this.#state.depth === 2 ? this.#state.detailOffset : 0;
		for (let row = 0; row < bodyHeight; row++) {
			const leftCell = plainLine(left[row] ?? "", leftWidth).padEnd(leftWidth);
			const rightCell = plainLine(right[rightStart + row] ?? "", rightWidth);
			lines.push(` ${leftCell} ${theme.fg("dim", "│")} ${rightCell}`);
		}
		lines.push(
			` ${theme.fg("dim", "j/k navigate · l/Enter drill · h back · / filter · ")}${keyHint("ui.dismiss", "unwind")}${theme.fg("dim", " · ? help · :inspect or alt+i toggle")}`,
		);
		lines.push(...new DynamicBorder().render(safeWidth));
		return lines;
	}
}

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
	let overlayHandle: OverlayHandle | undefined;
	const done = () => {
		overlayHandle?.hide();
		ctx.ui.setFocus(ctx.editor);
		ctx.ui.requestRender();
	};
	const inspector = new PrimitivesInspectorOverlayComponent(
		{
			categories,
			inspectKeys: ctx.keybindings.getKeys("app.primitives.inspect"),
			onDone: done,
			requestRender: () => ctx.ui.requestRender(),
		},
		initialCategory,
	);
	overlayHandle = ctx.ui.showOverlay(inspector, {
		anchor: "bottom-center",
		width: "100%",
		maxHeight: "100%",
		margin: 0,
	});
	ctx.ui.setFocus(inspector);
	ctx.ui.requestRender();
}
