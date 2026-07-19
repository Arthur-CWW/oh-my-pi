import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { ReasoningEffort } from "@oh-my-pi/pi-ai";
import {
	type Component,
	Container,
	extractPrintableText,
	fuzzyRank,
	getKeybindings,
	getSettingItemFilterText,
	type ImageBudget,
	Input,
	matchesKey,
	parseSgrMouse,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	type SgrMouseEvent,
	Spacer,
	type Tab,
	TabBar,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import type { ShapeTarget } from "@oh-my-pi/snapcompact";
import { getDefault, type SettingPath, settings } from "../../config/settings";
import type {
	SettingTab,
	StatusLinePreset,
	StatusLineSegmentId,
	StatusLineSeparatorStyle,
} from "../../config/settings-schema";
import { SETTING_TABS, TAB_METADATA } from "../../config/settings-schema";
import { getCurrentThemeName, getSelectListTheme, getSettingsListTheme, theme } from "../../modes/theme/theme";
import { AUTO_THINKING, type ConfiguredThinkingLevel } from "../../thinking";
import { getTabBarTheme } from "../shared";
import { matchesSelectCancel, matchesUiDismiss } from "../utils/keybinding-matchers";
import { bottomBorder, divider, row, topBorder } from "./overlay-box";
import {
	handleInputOrDismiss,
	makePluginSettingsModalModel,
	makeSurfaceModalModel,
	PluginSettingsComponent,
	type PluginSettingsModalModel,
	type PluginSettingsModalMsg,
	type PluginSettingsServiceCommand,
	type SurfaceModalCommand,
	type SurfaceModalModel,
	type SurfaceModalMsg,
	updatePluginSettingsModal,
	updateSurfaceModal,
} from "./plugin-settings";
import { keyHint } from "./keybinding-hints";
import { getAllSettingDefs, getSettingDef, getSettingsForTab, type SettingDef } from "./settings-defs";
import { SnapcompactShapePreview } from "./snapcompact-shape-preview";
import { getPreset } from "./status-line/presets";
import { makeComponentId, type KeyEvent } from "../mvu/schema";

/**
 * A submenu component for selecting from a list of options.
 */
/**
 * Submenu component for free-text string settings.
 * Mirrors the ConfigInputSubmenu pattern from plugin-settings.ts.
 */
class TextInputSubmenu extends Container {
	#input: Input;

	constructor(
		label: string,
		description: string,
		currentValue: string,
		private readonly onSubmit: (value: string) => void,
		private readonly onCancel: () => void,
	) {
		super();

		this.addChild(new Text(theme.bold(theme.fg("accent", label)), 0, 0));
		if (description) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", description), 0, 0));
		}
		this.addChild(new Spacer(1));

		this.#input = new Input();
		if (currentValue) {
			this.#input.setValue(currentValue);
		}
		this.#input.onSubmit = value => {
			this.onSubmit(value); // empty string clears the setting
		};
		this.addChild(this.#input);
		this.addChild(new Spacer(1));
		this.addChild(new Text(`  ${keyHint("ui.dismiss", "cancel")} · Clear field to unset · Enter to save`, 0, 0));
	}

	handleInput(data: string): void {
		handleInputOrDismiss(data, this.#input, this.onCancel);
	}
}

class SelectSubmenu extends Container {
	#selectList: SelectList;
	#previewText: Text | null = null;
	#previewUpdateRequestId: number = 0;
	#selectListLineOffset = 0;
	#selectListLineCount = 0;

	constructor(
		title: string,
		description: string,
		options: ReadonlyArray<SelectItem>,
		currentValue: string,
		onSelect: (value: string) => void,
		private readonly onCancel: () => void,
		onSelectionChange?: (value: string) => void | Promise<void>,
		private readonly getPreview?: () => string,
		footer?: Component,
	) {
		super();

		// Title
		this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));

		// Description
		if (description) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", description), 0, 0));
		}

		// Preview (if provided)
		if (getPreview) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", "Preview:"), 0, 0));
			this.#previewText = new Text(getPreview(), 0, 0);
			this.addChild(this.#previewText);
		}

		// Spacer
		this.addChild(new Spacer(1));

		// Select list
		this.#selectList = new SelectList(options, Math.min(options.length, 10), getSelectListTheme());

		// Pre-select current value
		const currentIndex = options.findIndex(o => o.value === currentValue);
		if (currentIndex !== -1) {
			this.#selectList.setSelectedIndex(currentIndex);
		}

		this.#selectList.onSelect = item => {
			onSelect(item.value);
		};

		if (onSelectionChange) {
			this.#selectList.onSelectionChange = item => {
				const requestId = ++this.#previewUpdateRequestId;
				const result = onSelectionChange(item.value);
				if (result && typeof (result as Promise<void>).then === "function") {
					void (result as Promise<void>).finally(() => {
						if (requestId === this.#previewUpdateRequestId) {
							this.#updatePreview();
						}
					});
					return;
				}
				if (requestId === this.#previewUpdateRequestId) {
					this.#updatePreview();
				}
			};
		}

		this.addChild(this.#selectList);

		// Hint
		this.addChild(new Spacer(1));
		this.addChild(new Text("  Enter to select · Esc to go back", 0, 0));

		// Footer (e.g. the snapcompact shape preview) below the interactive rows,
		// so the list never shifts while browsing.
		if (footer) {
			this.addChild(new Spacer(1));
			this.addChild(footer);
		}
	}

	#updatePreview(): void {
		if (this.#previewText && this.getPreview) {
			this.#previewText.setText(this.getPreview());
		}
	}

	/**
	 * Concatenate children like Container.render, recording where the select
	 * list lands so routed mouse events can be hit-tested against it.
	 */
	override render(width: number): readonly string[] {
		const lines: string[] = [];
		for (const child of this.children) {
			const childLines = child.render(Math.max(1, width));
			if (child === this.#selectList) {
				this.#selectListLineOffset = lines.length;
				this.#selectListLineCount = childLines.length;
			}
			lines.push(...childLines);
		}
		return lines;
	}

	/** Mouse routed from the host: wheel steps, hover lights, click confirms. */
	routeMouse(event: SgrMouseEvent, line: number, _col: number): void {
		if (event.wheel !== null) {
			this.#selectList.handleWheel(event.wheel);
			return;
		}
		const listLine = line - this.#selectListLineOffset;
		const within = listLine >= 0 && listLine < this.#selectListLineCount;
		const index = within ? this.#selectList.hitTest(listLine) : undefined;
		if (event.motion) {
			this.#selectList.setHoverIndex(index ?? null);
			return;
		}
		if (event.leftClick && index !== undefined) {
			this.#selectList.clickItem(index);
		}
	}

	handleInput(data: string): void {
		if (matchesUiDismiss(data)) {
			this.onCancel();
			return;
		}
		if (matchesSelectCancel(data)) return;
		this.#selectList.handleInput(data);
	}
}

let cachedSidebarWidth: number | undefined;
/**
 * Split-sidebar width derived from every group name in the schema (not just
 * the visible tab), so the divider column never moves when switching tabs or
 * when condition-gated groups appear.
 */
function settingsSidebarWidth(): number {
	if (cachedSidebarWidth === undefined) {
		let nameWidth = 0;
		for (const tab of SETTING_TABS) {
			for (const def of getSettingsForTab(tab)) {
				if (def.group) nameWidth = Math.max(nameWidth, visibleWidth(def.group));
			}
		}
		cachedSidebarWidth = Math.min(22, nameWidth) + 4;
	}
	return cachedSidebarWidth;
}

function getSettingsTabs(): Tab[] {
	return [
		...SETTING_TABS.map(id => {
			const meta = TAB_METADATA[id];
			const icon = theme.symbol(meta.icon as Parameters<typeof theme.symbol>[0]);
			return { id, label: `${icon} ${meta.label}`, short: icon };
		}),
		{ id: "plugins", label: `${theme.icon.package} Plugins`, short: theme.icon.package },
	];
}

/**
 * Dynamic context for settings that need runtime data.
 * Some settings (like thinking level) are managed by the session, not Settings.
 */
export interface SettingsRuntimeContext {
	/** Exact model-supported thinking efforts (from session). */
	availableThinkingLevels: ReasoningEffort[];
	/** Current thinking level (from session) */
	thinkingLevel: ThinkingLevel | undefined;
	/** Available themes */
	availableThemes: string[];
	/** Active model (api + id); resolves what the snapcompact `auto` shape maps to. */
	model?: ShapeTarget;
	/** Shared TUI image budget (graphics ids + transmit-once) for image previews. */
	imageBudget?: ImageBudget;
	/** Schedules a re-render after async preview work completes. */
	requestRender?: () => void;
}

/** Status line settings subset for preview */
export interface StatusLinePreviewSettings {
	preset?: StatusLinePreset;
	leftSegments?: StatusLineSegmentId[];
	rightSegments?: StatusLineSegmentId[];
	separator?: StatusLineSeparatorStyle;
	sessionAccent?: boolean;
	transparent?: boolean;
}

export const SETTINGS_MODAL_COMPONENT_ID = makeComponentId("settings-selector");

export type SettingsModalRegion = "settings" | "search" | "plugins" | "submenu";
export type SettingsModalLayer =
	| { readonly _tag: "Search" }
	| { readonly _tag: "Plugins" }
	| { readonly _tag: "Setting"; readonly path: SettingPath };

export interface SettingsRuntimeOptions {
	readonly values?: Readonly<Partial<Record<SettingPath, readonly string[]>>>;
}

export interface SettingsSubmenuState {
	readonly path: SettingPath;
	readonly kind: "select" | "text";
	readonly selectedIndex: number;
	readonly draft: string;
	readonly cursor: number;
	readonly originalValue: unknown;
}

export interface SettingsModalModel extends SurfaceModalModel<SettingsModalRegion, SettingsModalLayer> {
	readonly originalTheme: string;
	readonly previewTheme: string;
	readonly activeTabId: SettingTab | "plugins";
	readonly preSearchTabId: SettingTab | "plugins";
	readonly searchQuery: string;
	readonly searchCursor: number;
	readonly sectionFocused: boolean;
	readonly submenu?: SettingsSubmenuState;
	readonly plugins: PluginSettingsModalModel;
	readonly values: Readonly<Record<string, unknown>>;
	readonly runtimeOptions: Readonly<Partial<Record<SettingPath, readonly string[]>>>;
}

export type SettingsModalMsg =
	| SurfaceModalMsg<SettingsModalRegion, SettingsModalLayer>
	| { readonly _tag: "Input"; readonly action: string; readonly event: KeyEvent }
	| { readonly _tag: "PluginSettings"; readonly message: PluginSettingsModalMsg }
	| { readonly _tag: "MoveSelection"; readonly delta: -1 | 1 }
	| { readonly _tag: "SelectTab"; readonly tabId: SettingTab | "plugins" }
	| { readonly _tag: "SelectPath"; readonly path: SettingPath; readonly activate: boolean }
	| { readonly _tag: "PointerObserved" }
	| { readonly _tag: "PreviewTheme"; readonly theme: string }
	| { readonly _tag: "PersistSetting"; readonly path: SettingPath; readonly value: unknown };

export type SettingsModalCommand =
	| SurfaceModalCommand
	| { readonly _tag: "RenderSettings"; readonly model: SettingsModalModel }
	| { readonly _tag: "ThemePreviewRequested"; readonly theme: string }
	| { readonly _tag: "ThemeRollbackRequested"; readonly theme: string }
	| { readonly _tag: "PersistSettingRequested"; readonly path: SettingPath; readonly value: unknown }
	| { readonly _tag: "PluginSettingsCommand"; readonly command: PluginSettingsServiceCommand };

const settingsTabs = (): readonly (SettingTab | "plugins")[] => [...SETTING_TABS, "plugins"];

function settingsValueSnapshot(): Readonly<Record<string, unknown>> {
	const values: Record<string, unknown> = {};
	for (const def of getAllSettingDefs()) values[def.path] = settings.get(def.path);
	return values;
}

export function makeSettingsModalModel(
	originalTheme: string,
	runtimeOptions: SettingsRuntimeOptions = {},
): SettingsModalModel {
	return {
		...makeSurfaceModalModel<SettingsModalRegion, SettingsModalLayer>("settings"),
		originalTheme,
		previewTheme: originalTheme,
		activeTabId: "appearance",
		preSearchTabId: "appearance",
		searchQuery: "",
		searchCursor: 0,
		sectionFocused: false,
		plugins: makePluginSettingsModalModel(),
		values: settingsValueSnapshot(),
		runtimeOptions: runtimeOptions.values ?? {},
	};
}

function settingVisible(model: SettingsModalModel, def: SettingDef): boolean {
	if (!def.condition) return true;
	const backend = model.values["memory.backend"];
	if (def.path.startsWith("hindsight.")) return backend === "hindsight";
	if (def.path.startsWith("mnemopi.")) return backend === "mnemopi";
	if (def.path.startsWith("autolearn.") && def.path !== "autolearn.enabled") {
		return model.values["autolearn.enabled"] === true;
	}
	if (def.path.startsWith("plan.") && def.path !== "plan.enabled") {
		return model.values["plan.enabled"] === true;
	}
	if (def.path === "providers.autoThinkingModel") return model.values.defaultThinkingLevel === AUTO_THINKING;
	return def.condition();
}

function visibleDefs(model: SettingsModalModel, tab = model.activeTabId): readonly SettingDef[] {
	if (tab === "plugins") return [];
	return getSettingsForTab(tab).filter(def => settingVisible(model, def));
}

function displayValue(model: SettingsModalModel, path: SettingPath): string {
	const value = model.values[path];
	return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

function searchPaths(model: SettingsModalModel): readonly SettingPath[] {
	if (model.searchQuery.length === 0) return [];
	const rankedTabs: { readonly tab: SettingTab; readonly score: number; readonly paths: readonly SettingPath[] }[] = [];
	for (const tab of SETTING_TABS) {
		const defs = visibleDefs(model, tab);
		const items = defs.map(def => ({
			id: def.path,
			label: def.label,
			description: def.description,
			currentValue: displayValue(model, def.path),
			...(def.type === "enum" ? { values: [...def.values] } : {}),
		} satisfies SettingItem));
		const ranked = fuzzyRank(items, model.searchQuery, getSettingItemFilterText);
		if (ranked.length === 0) continue;
		rankedTabs.push({
			tab,
			score: ranked[0]?.score ?? 0,
			paths: ranked.map(result => result.item.id as SettingPath),
		});
	}
	rankedTabs.sort((left, right) => left.score - right.score || SETTING_TABS.indexOf(left.tab) - SETTING_TABS.indexOf(right.tab));
	return rankedTabs.flatMap(result => result.paths);
}

function activePaths(model: SettingsModalModel): readonly SettingPath[] {
	return model.region === "search" ? searchPaths(model) : visibleDefs(model).map(def => def.path);
}

function selectedPath(model: SettingsModalModel): SettingPath | undefined {
	const paths = activePaths(model);
	return paths[Math.max(0, Math.min(model.focusIndex, paths.length - 1))];
}

function moveSelection(model: SettingsModalModel, delta: -1 | 1): SettingsModalModel {
	const paths = activePaths(model);
	if (paths.length === 0) return model;
	const focusIndex = (model.focusIndex + delta + paths.length) % paths.length;
	return { ...model, focusIndex, sectionFocused: false };
}

function jumpSection(model: SettingsModalModel, delta: -1 | 1): SettingsModalModel {
	if (model.region === "search") {
		const paths = searchPaths(model);
		if (paths.length === 0) return model;
		return { ...model, focusIndex: Math.max(0, Math.min(paths.length - 1, model.focusIndex + delta * 10)) };
	}
	const defs = visibleDefs(model);
	if (defs.length === 0) return model;
	const groups = defs.reduce<{ readonly name: string; readonly index: number }[]>((result, def, index) => {
		const name = def.group ?? "";
		if (result.at(-1)?.name !== name) result.push({ name, index });
		return result;
	}, []);
	if (groups.length < 2) return moveSelection(model, delta);
	let groupIndex = groups.findLastIndex(group => group.index <= model.focusIndex);
	if (groupIndex < 0) groupIndex = 0;
	groupIndex = (groupIndex + delta + groups.length) % groups.length;
	return { ...model, focusIndex: groups[groupIndex]?.index ?? 0 };
}

function submenuOptions(model: SettingsModalModel, def: Extract<SettingDef, { readonly type: "submenu" }>) {
	const runtime = model.runtimeOptions[def.path];
	return runtime === undefined
		? def.options
		: runtime.map(value => ({ value, label: value }));
}

function convertedSettingValue(model: SettingsModalModel, path: SettingPath, value: string): unknown {
	const currentValue = model.values[path];
	if ((path === "compaction.thresholdPercent" || path === "compaction.thresholdTokens") && value === "default") return -1;
	if (typeof currentValue === "number") return Number(value);
	if (typeof currentValue === "boolean") return value === "true";
	return value;
}

function rendered(
	model: SettingsModalModel,
	commands: readonly SettingsModalCommand[] = [],
): { readonly model: SettingsModalModel; readonly commands: readonly SettingsModalCommand[] } {
	return { model, commands: [...commands, { _tag: "RenderSettings", model }] };
}

function reducePluginSettings(
	model: SettingsModalModel,
	message: PluginSettingsModalMsg,
): { readonly model: SettingsModalModel; readonly commands: readonly SettingsModalCommand[] } {
	const transition = updatePluginSettingsModal(model.plugins, message);
	const next = { ...model, plugins: transition.model };
	if (transition.commands.some(command => command._tag === "CloseRequested")) return backSettings(next);
	const commands: SettingsModalCommand[] = [];
	for (const command of transition.commands) {
		if (command._tag !== "CloseRequested") commands.push({ _tag: "PluginSettingsCommand", command });
	}
	return rendered(next, commands);
}

function selectSettingsTab(
	model: SettingsModalModel,
	activeTabId: SettingTab | "plugins",
): { readonly model: SettingsModalModel; readonly commands: readonly SettingsModalCommand[] } {
	const next: SettingsModalModel = {
		...model,
		activeTabId,
		region: activeTabId === "plugins" ? "plugins" : "settings",
		focusIndex: 0,
		sectionFocused: false,
	};
	return activeTabId === "plugins"
		? reducePluginSettings(next, { _tag: "LoadEntries" })
		: rendered(next);
}

function persistAndRender(
	model: SettingsModalModel,
	path: SettingPath,
	value: unknown,
): { readonly model: SettingsModalModel; readonly commands: readonly SettingsModalCommand[] } {
	const values = { ...model.values, [path]: value };
	const committedTheme = path === "theme.dark" || path === "theme.light" ? String(value) : undefined;
	const next = {
		...model,
		values,
		...(committedTheme === undefined
			? {}
			: { originalTheme: committedTheme, previewTheme: committedTheme }),
	};
	return rendered(next, [{ _tag: "PersistSettingRequested", path, value }]);
}

function openSelected(model: SettingsModalModel) {
	const path = selectedPath(model);
	if (path === undefined) return rendered(model);
	const def = getSettingDef(path);
	if (def === undefined) return rendered(model);
	if (def.type === "boolean") {
		return persistAndRender(model, path, model.values[path] !== true);
	}
	if (def.type === "enum") {
		const current = String(model.values[path] ?? "");
		const index = def.values.indexOf(current);
		const value = def.values[(index + 1) % Math.max(1, def.values.length)];
		return value === undefined ? rendered(model) : persistAndRender(model, path, value);
	}
	const pushed = updateSurfaceModal(model, {
		_tag: "Push",
		region: "submenu",
		layer: { _tag: "Setting", path },
	}).model;
	if (def.type === "text") {
		const draft = String(model.values[path] ?? "");
		return rendered({
			...model,
			...pushed,
			submenu: {
				path,
				kind: "text",
				selectedIndex: 0,
				draft,
				cursor: draft.length,
				originalValue: model.values[path],
			},
		});
	}
	const options = submenuOptions(model, def);
	const selectedIndex = Math.max(0, options.findIndex(option => option.value === String(model.values[path] ?? "")));
	return rendered({
		...model,
		...pushed,
		submenu: {
			path,
			kind: "select",
			selectedIndex,
			draft: "",
			cursor: 0,
			originalValue: model.values[path],
		},
	});
}

function backSettings(model: SettingsModalModel) {
	if (model.sectionFocused && model.depth.length === 0) {
		return rendered({ ...model, sectionFocused: false });
	}
	const leaving = model.region;
	const submenu = model.submenu;
	const transition = updateSurfaceModal(model, { _tag: "Back" });
	if (transition.commands.some(command => command._tag === "CloseRequested")) {
		const commands: SettingsModalCommand[] = [];
		if (model.previewTheme !== model.originalTheme) {
			commands.push({ _tag: "ThemeRollbackRequested", theme: model.originalTheme });
		}
		commands.push(...transition.commands);
		return { model, commands };
	}
	let next: SettingsModalModel = { ...model, ...transition.model };
	const commands: SettingsModalCommand[] = [];
	if (leaving === "submenu") {
		next = { ...next, submenu: undefined };
		if (
			submenu !== undefined &&
			(submenu.path === "theme.dark" || submenu.path === "theme.light") &&
			model.previewTheme !== String(submenu.originalValue ?? "")
		) {
			const themeName = String(submenu.originalValue ?? model.originalTheme);
			next = { ...next, previewTheme: themeName };
			commands.push({ _tag: "ThemePreviewRequested", theme: themeName });
		}
	}
	if (leaving === "search") {
		next = {
			...next,
			activeTabId: model.preSearchTabId,
			searchQuery: "",
			searchCursor: 0,
			sectionFocused: false,
		};
	}
	return rendered(next, commands);
}

function editDraft(value: string, cursor: number, key: string, text: string | undefined) {
	if (text !== undefined && text.length > 0) {
		return { value: `${value.slice(0, cursor)}${text}${value.slice(cursor)}`, cursor: cursor + text.length };
	}
	switch (key) {
		case "left": return { value, cursor: Math.max(0, cursor - 1) };
		case "right": return { value, cursor: Math.min(value.length, cursor + 1) };
		case "home":
		case "ctrl+a": return { value, cursor: 0 };
		case "end":
		case "ctrl+e": return { value, cursor: value.length };
		case "backspace":
			return cursor === 0
				? { value, cursor }
				: { value: `${value.slice(0, cursor - 1)}${value.slice(cursor)}`, cursor: cursor - 1 };
		case "delete":
			return { value: `${value.slice(0, cursor)}${value.slice(cursor + 1)}`, cursor };
		case "ctrl+u":
			return { value: value.slice(cursor), cursor: 0 };
		case "alt+backspace":
		case "ctrl+w": {
			let start = cursor;
			while (start > 0 && /\s/.test(value[start - 1] ?? "")) start -= 1;
			while (start > 0 && !/\s/.test(value[start - 1] ?? "")) start -= 1;
			return { value: `${value.slice(0, start)}${value.slice(cursor)}`, cursor: start };
		}
		default:
			return { value, cursor };
	}
}

function updateSettingsInput(model: SettingsModalModel, action: string, event: KeyEvent) {
	if (action === "ui.dismiss") return backSettings(model);
	if (event._tag === "Release" || event._tag === "Resize" || event._tag === "Mouse") return rendered(model);
	const key = event._tag === "Press" ? String(event.key) : "";
	const text = event._tag === "Paste" ? event.text : event.text;

	if (model.submenu !== undefined) {
		const submenu = model.submenu;
		if (submenu.kind === "text") {
			if (key === "enter") {
				const popped = updateSurfaceModal(model, { _tag: "Back" }).model;
				const value = convertedSettingValue(model, submenu.path, submenu.draft);
				return persistAndRender({ ...model, ...popped, submenu: undefined }, submenu.path, value);
			}
			const edited = editDraft(submenu.draft, submenu.cursor, key, text);
			return rendered({ ...model, submenu: { ...submenu, draft: edited.value, cursor: edited.cursor } });
		}
		const def = getSettingDef(submenu.path);
		if (def?.type !== "submenu") return backSettings(model);
		const options = submenuOptions(model, def);
		if (options.length === 0) return rendered(model);
		let selectedIndex = submenu.selectedIndex;
		if (key === "up") selectedIndex = (selectedIndex - 1 + options.length) % options.length;
		else if (key === "down") selectedIndex = (selectedIndex + 1) % options.length;
		else if (key === "pageUp") selectedIndex = Math.max(0, selectedIndex - 10);
		else if (key === "pageDown") selectedIndex = Math.min(options.length - 1, selectedIndex + 10);
		else if (key === "home") selectedIndex = 0;
		else if (key === "end") selectedIndex = options.length - 1;
		else if (key === "enter") {
			const option = options[selectedIndex];
			if (option === undefined) return rendered(model);
			const popped = updateSurfaceModal(model, { _tag: "Back" }).model;
			const value = convertedSettingValue(model, submenu.path, option.value);
			return persistAndRender({ ...model, ...popped, submenu: undefined }, submenu.path, value);
		}
		const next = { ...model, submenu: { ...submenu, selectedIndex } };
		const option = options[selectedIndex];
		if (
			option !== undefined &&
			(submenu.path === "theme.dark" || submenu.path === "theme.light") &&
			option.value !== model.previewTheme
		) {
			const previewed = { ...next, previewTheme: option.value };
			return rendered(previewed, [{ _tag: "ThemePreviewRequested", theme: option.value }]);
		}
		return rendered(next);
	}

	if (model.region === "search") {
		if (key === "up") return rendered(moveSelection(model, -1));
		if (key === "down") return rendered(moveSelection(model, 1));
		if (key === "pageUp") return rendered(jumpSection(model, -1));
		if (key === "pageDown") return rendered(jumpSection(model, 1));
		if (key === "enter") return openSelected(model);
		if (key === "tab" || key === "shift+tab") {
			const paths = searchPaths(model);
			if (paths.length === 0) return rendered(model);
			const current = selectedPath(model);
			const currentTab = current === undefined ? undefined : getSettingDef(current)?.tab;
			const matchingTabs = SETTING_TABS.filter(tab => paths.some(path => getSettingDef(path)?.tab === tab));
			const tabIndex = Math.max(0, matchingTabs.indexOf(currentTab ?? matchingTabs[0]!));
			const delta = key === "shift+tab" ? -1 : 1;
			const nextTab = matchingTabs[(tabIndex + delta + matchingTabs.length) % matchingTabs.length];
			const focusIndex = paths.findIndex(path => getSettingDef(path)?.tab === nextTab);
			return rendered({ ...model, focusIndex: Math.max(0, focusIndex) });
		}
		const edited = editDraft(model.searchQuery, model.searchCursor, key, text);
		if (edited.value.length === 0) return backSettings(model);
		return rendered({ ...model, searchQuery: edited.value, searchCursor: edited.cursor, focusIndex: 0 });
	}

	if (
		model.activeTabId === "plugins" &&
		(model.plugins.region !== "list" || (key !== "left" && key !== "right" && key !== "tab" && key !== "shift+tab"))
	) {
		return reducePluginSettings(model, { _tag: "Input", action, event });
	}

	if (key === "tab" || key === "shift+tab") {
		const groups = visibleDefs(model).reduce<string[]>((result, def) => {
			const group = def.group ?? "";
			if (result.at(-1) !== group) result.push(group);
			return result;
		}, []);
		if (groups.length >= 2) return rendered({ ...model, sectionFocused: !model.sectionFocused });
	}
	if (key === "left" || key === "right" || key === "tab" || key === "shift+tab") {
		const tabs = settingsTabs();
		const delta = key === "left" || key === "shift+tab" ? -1 : 1;
		const index = tabs.indexOf(model.activeTabId);
		const activeTabId = tabs[(index + delta + tabs.length) % tabs.length] ?? "appearance";
		return selectSettingsTab(model, activeTabId);
	}
	if (key === "up") return rendered(model.sectionFocused ? jumpSection(model, -1) : moveSelection(model, -1));
	if (key === "down") return rendered(model.sectionFocused ? jumpSection(model, 1) : moveSelection(model, 1));
	if (key === "pageUp") return rendered(jumpSection(model, -1));
	if (key === "pageDown") return rendered(jumpSection(model, 1));
	if (key === "home") return rendered({ ...model, focusIndex: 0, sectionFocused: false });
	if (key === "end") return rendered({ ...model, focusIndex: Math.max(0, activePaths(model).length - 1), sectionFocused: false });
	if (key === "enter" || key === "space") return openSelected(model);
	if (model.activeTabId !== "plugins" && text !== undefined && text.trim().length > 0) {
		const pushed = updateSurfaceModal(model, { _tag: "Push", region: "search", layer: { _tag: "Search" } }).model;
		return rendered({
			...model,
			...pushed,
			preSearchTabId: model.activeTabId,
			searchQuery: text,
			searchCursor: text.length,
			focusIndex: 0,
			sectionFocused: false,
		});
	}
	return rendered(model);
}

export function updateSettingsModal(
	model: SettingsModalModel,
	msg: SettingsModalMsg,
): { readonly model: SettingsModalModel; readonly commands: readonly SettingsModalCommand[] } {
	switch (msg._tag) {
		case "Input":
			return updateSettingsInput(model, msg.action, msg.event);
		case "PluginSettings":
			return reducePluginSettings(model, msg.message);
		case "MoveSelection": {
			const submenu = model.submenu;
			if (submenu?.kind !== "select") return rendered(moveSelection(model, msg.delta));
			const def = getSettingDef(submenu.path);
			if (def?.type !== "submenu") return rendered(model);
			const options = submenuOptions(model, def);
			if (options.length === 0) return rendered(model);
			const selectedIndex = (submenu.selectedIndex + msg.delta + options.length) % options.length;
			return rendered({ ...model, submenu: { ...submenu, selectedIndex } });
		}
		case "SelectTab":
			return selectSettingsTab(model, msg.tabId);
		case "SelectPath": {
			const paths = activePaths(model);
			const focusIndex = paths.indexOf(msg.path);
			if (focusIndex < 0) return rendered(model);
			const selected = { ...model, focusIndex, sectionFocused: false };
			return msg.activate ? openSelected(selected) : rendered(selected);
		}
		case "PointerObserved":
			return rendered(model);
		case "PreviewTheme":
			return {
				model: { ...model, previewTheme: msg.theme },
				commands: [{ _tag: "ThemePreviewRequested", theme: msg.theme }],
			};
		case "PersistSetting":
			return persistAndRender(model, msg.path, msg.value);
		default: {
			const transition = updateSurfaceModal(model, msg);
			const closing = transition.commands.some(command => command._tag === "CloseRequested");
			return {
				model: { ...model, ...transition.model },
				commands:
					closing && model.previewTheme !== model.originalTheme
						? [
								{ _tag: "ThemeRollbackRequested", theme: model.originalTheme },
								...transition.commands,
							]
						: transition.commands,
			};
		}
	}
}

export interface SettingsCallbacks {
	/** Called when any setting value changes */
	onChange: (path: SettingPath, newValue: unknown) => void;
	/** Called for theme preview while browsing */
	onThemePreview?: (theme: string) => void | Promise<void>;
	/** Called for status line preview while configuring */
	onStatusLinePreview?: (settings: StatusLinePreviewSettings) => void;
	/** Get current rendered status line for inline preview */
	getStatusLinePreview?: () => string;
	/** Called when settings panel is closed */
	onCancel: () => void;
}

/**
 * Main tabbed settings selector component.
 * Uses declarative settings definitions from settings-defs.ts.
 */
export class SettingsSelectorComponent implements Component {
	#tabBar: TabBar;
	#currentList: SettingsList | null = null;
	#searchList: SettingsList | null = null;
	readonly #pluginComponent = new PluginSettingsComponent();
	#projectedSubmenu: Component | null = null;
	#projection: SettingsModalModel;
	#currentTabId: SettingTab | "plugins" = "appearance";
	#preSearchTabId: SettingTab | "plugins" = "appearance";
	#searchQuery = "";
	/** Single-line editor backing the search banner (cursor, word ops, paste). */
	#searchInput = new Input();
	#searchMatchCount = 0;
	/** First matching item id per tab id, for Tab-key jumps while searching. */
	#searchFirstMatch = new Map<string, string>();
	#textInputActive = false;
	#hasSectionJump = false;
	// Frame geometry from the last render, for mouse hit-testing (the
	// fullscreen overlay paints from screen row 0, so mouse rows map 1:1).
	#tabRowStart = 0;
	#tabRowCount = 0;
	#contentRowStart = 0;
	#contentRowCount = 0;

	constructor(
		private readonly context: SettingsRuntimeContext,
		private readonly callbacks: SettingsCallbacks,
	) {
		// No label prefix (the frame title already says Settings) and no
		// "(tab to cycle)" hint (folded into the footer hint line).
		this.#tabBar = new TabBar("", getSettingsTabs(), getTabBarTheme());
		this.#tabBar.showHint = false;
		this.#projection = makeSettingsModalModel(
			getCurrentThemeName() ?? settings.get("theme.dark") ?? "titanium",
			{
				values: {
					defaultThinkingLevel: [AUTO_THINKING, ...context.availableThinkingLevels],
					"theme.dark": context.availableThemes,
					"theme.light": context.availableThemes,
				},
			},
		);
		this.apply(this.#projection);
	}
	/** Apply one committed route model. Terminal input never mutates this renderer. */
	apply(model: SettingsModalModel): void {
		this.#projection = model;
		this.#pluginComponent.apply(model.plugins);
		this.#projectedSubmenu = null;
		this.#tabBar.setTabs(getSettingsTabs(), model.activeTabId);
		this.#tabBar.setActiveById(model.activeTabId);

		if (model.region === "search") {
			this.#currentTabId = model.activeTabId;
			this.#startSearch(model.searchQuery);
			const path = selectedPath(model);
			if (path !== undefined) this.#searchList?.selectItem(path);
			for (let count = model.searchQuery.length - model.searchCursor; count > 0; count -= 1) {
				this.#searchInput.handleInput("\x1b[D");
			}
		} else {
			this.#switchToTab(model.activeTabId);
			const path = selectedPath(model);
			if (path !== undefined) this.#currentList?.selectItem(path);
			if (model.sectionFocused && this.#currentList?.hasSectionFocusTargets()) {
				this.#currentList.toggleSectionFocus();
			}
		}

		const submenu = model.submenu;
		const def = submenu === undefined ? undefined : getSettingDef(submenu.path);
		if (submenu !== undefined && def?.type === "text") {
			this.#projectedSubmenu = new TextInputSubmenu(
				def.label,
				def.description,
				submenu.draft,
				() => {},
				() => {},
			);
		} else if (submenu !== undefined && def?.type === "submenu") {
			const options = submenuOptions(model, def);
			const currentValue = options[submenu.selectedIndex]?.value ?? String(submenu.originalValue ?? "");
			this.#projectedSubmenu = new SelectSubmenu(
				def.label,
				def.description,
				options,
				currentValue,
				() => {},
				() => {},
			);
		}
	}

	invalidate(): void {
		this.#tabBar.invalidate();
		this.#currentList?.invalidate();
		this.#searchList?.invalidate();
		this.#pluginComponent.invalidate();
	}

	/** Swap the active content (per-tab list, search list, or plugins). */
	#setContent(build: () => void): void {
		this.#currentList = null;
		this.#searchList = null;
		build();
	}

	#switchToTab(tabId: SettingTab | "plugins"): void {
		this.#currentTabId = tabId;
		this.#setContent(() => {
			if (tabId === "plugins") {
				this.#hasSectionJump = false;
			} else {
				this.#showSettingsTab(tabId);
			}
		});
	}

	#footerHintText(): string {
		if (this.#projectedSubmenu) {
			return `Enter to save · ${keyHint("ui.dismiss", "back")}`;
		}
		if (this.#searchList) {
			return `Enter to change · Tab to jump tabs · ${keyHint("ui.dismiss", "exit search")}`;
		}
		if (this.#currentTabId === "plugins") {
			const action = this.#projection.plugins.region === "list" ? "configure" : "edit";
			return `Enter to ${action} · ↑/↓ to navigate · ←/→ to switch tabs at plugin list · ${keyHint("ui.dismiss", "back")}`;
		}
		if (this.#projection.sectionFocused) {
			return `↑/↓ to jump sections · Tab/Enter to settings · ←/→ to switch tabs · ${keyHint("ui.dismiss", "close")}`;
		}
		const nav = this.#hasSectionJump ? "Tab to jump sections · ←/→ to switch tabs" : "Tab to switch tabs";
		return `Enter/Space to change · ${nav} · Type to search · Esc to close`;
	}

	/** Single-line search banner: accent icon, editable query with live cursor, right-aligned match count. */
	#renderSearchBanner(width: number): string {
		const icon = theme.symbol("icon.search");
		const countText = this.#searchMatchCount === 1 ? "1 match" : `${this.#searchMatchCount} matches`;
		const rightWidth = visibleWidth(countText) + 1; // trailing margin
		const prefix = ` ${theme.fg("accent", icon)} `;
		// The input pads itself to exactly this width and keeps the cursor in view.
		const inputWidth = Math.max(4, width - visibleWidth(prefix) - rightWidth - 1);
		const inputLine = this.#searchInput.render(inputWidth)[0] ?? "";
		const count = theme.fg(this.#searchMatchCount > 0 ? "dim" : "warning", countText);
		return truncateToWidth(`${prefix}${theme.bold(inputLine)} ${count} `, width);
	}

	/**
	 * Fullscreen frame: title border, tab row, divider, optional search banner,
	 * the active content sized to fill the terminal, the appearance preview,
	 * then a footer hint pinned above the bottom border.
	 */
	render(width: number): readonly string[] {
		const height = Math.max(14, process.stdout.rows || 40);
		const innerWidth = Math.max(1, width - 4);

		const tabLines = this.#tabBar.render(innerWidth);
		const searching = this.#searchList !== null;
		const showPreview = !searching && this.#projectedSubmenu === null && this.#currentTabId === "appearance";
		const previewLines = showPreview ? ["", theme.fg("muted", "Preview:"), this.#getStatusPreviewString()] : [];

		// Fixed chrome: top border, tabs, divider, [search row], divider, hint, bottom border.
		const fixedRows = 1 + tabLines.length + 1 + (searching ? 1 : 0) + 1 + 1 + 1;
		const contentRows = Math.max(7, height - fixedRows - previewLines.length);

		const list = this.#searchList ?? this.#currentList;
		let contentLines: readonly string[];
		if (this.#projectedSubmenu) {
			contentLines = this.#projectedSubmenu.render(innerWidth);
		} else if (list) {
			// SettingsList pads itself to viewport + blank + 3 description rows.
			list.setMaxVisible(contentRows - 4);
			contentLines = list.render(innerWidth);
		} else if (this.#currentTabId === "plugins") {
			contentLines = this.#pluginComponent.render(innerWidth);
		} else {
			contentLines = [];
		}

		const out: string[] = [];
		out.push(topBorder(width, "Settings"));
		this.#tabRowStart = out.length;
		this.#tabRowCount = tabLines.length;
		for (const line of tabLines) {
			out.push(row(line, width));
		}
		out.push(divider(width));
		if (searching) {
			out.push(row(this.#renderSearchBanner(innerWidth), width));
		}
		this.#contentRowStart = out.length;
		this.#contentRowCount = contentRows;
		for (let i = 0; i < contentRows; i++) {
			out.push(row(contentLines[i] ?? "", width));
		}
		for (const line of previewLines) {
			out.push(row(line, width));
		}
		out.push(divider(width));
		out.push(row(theme.fg("dim", this.#footerHintText()), width));
		out.push(bottomBorder(width));
		return out;
	}

	/**
	 * Resolve a pointer against the last rendered geometry without mutating the
	 * projection. The returned semantic message is committed by the route reducer.
	 */
	pointerMessage(model: SettingsModalModel, event: SgrMouseEvent): SettingsModalMsg {
		const list = this.#searchList ?? this.#currentList;
		const innerCol = event.col - 2;
		const contentLine = event.row - this.#contentRowStart;
		const tabLine = event.row - this.#tabRowStart;
		const overTabs = tabLine >= 0 && tabLine < this.#tabRowCount;
		const overContent = contentLine >= 0 && contentLine < this.#contentRowCount;
		if (event.leftClick && overTabs) {
			const tab = this.#tabBar.tabAt(tabLine, innerCol);
			if (tab && !tab.muted) return { _tag: "SelectTab", tabId: tab.id as SettingTab | "plugins" };
		}
		if (model.activeTabId === "plugins" && overContent) {
			return {
				_tag: "PluginSettings",
				message: this.#pluginComponent.pointerMessage(model.plugins, {
					...event,
					row: contentLine,
					col: innerCol,
				}),
			};
		}
		if (event.wheel !== null) return { _tag: "MoveSelection", delta: event.wheel };
		if (event.leftClick && overContent && list && this.#projectedSubmenu === null) {
			const id = list.hitTest(contentLine, innerCol) as SettingPath | undefined;
			if (id !== undefined) {
				return { _tag: "SelectPath", path: id, activate: selectedPath(model) === id };
			}
		}
		return { _tag: "PointerObserved" };
	}

	// ═══════════════════════════════════════════════════════════════════════
	// Global search (type-to-search across every tab)
	// ═══════════════════════════════════════════════════════════════════════

	/** Swap the tab content for the global search result list. */
	#startSearch(initialQuery: string): void {
		this.#preSearchTabId = this.#currentTabId;
		this.#searchInput = new Input();
		this.#searchInput.prompt = "";
		this.#searchInput.setValue(initialQuery);
		const list = new SettingsList(
			[],
			10,
			getSettingsListTheme(),
			(id, newValue) => this.#onSearchSettingChange(id as SettingPath, newValue),
			() => this.callbacks.onCancel(),
			{
				layout: "flat",
				typeToSearch: false,
				emptyText: "No matching settings",
				hint: "",
			},
		);
		// Keep the footer tab highlight on the tab owning the selected result.
		list.onSelectionChange = item => this.#syncTabBarToSelection(item);
		this.#setContent(() => {
			this.#searchList = list;
		});
		this.#setSearchQuery(initialQuery);
	}

	/**
	 * Recompute matches across every settings tab. Results render as one flat
	 * list with a heading row per tab; the footer tab bar reorders to show
	 * matching tabs (with counts) first and the rest muted at the end.
	 */
	#setSearchQuery(query: string): void {
		if (!this.#searchList) return;
		if (query.length === 0) {
			this.#endSearch(false);
			return;
		}
		this.#searchQuery = query;

		const counts = new Map<SettingTab, number>();
		const items: SettingItem[] = [];
		const tabResults: { tab: SettingTab; matched: SettingItem[]; bestScore: number; order: number }[] = [];
		this.#searchFirstMatch.clear();
		let total = 0;
		for (const tab of SETTING_TABS) {
			const candidates: SettingItem[] = [];
			for (const def of getSettingsForTab(tab)) {
				const item = this.#defToItem(def);
				if (item) candidates.push(item);
			}
			const ranked = fuzzyRank(candidates, query, getSettingItemFilterText);
			const matched = ranked.map(result => result.item);
			counts.set(tab, matched.length);
			if (matched.length === 0) continue;
			total += matched.length;
			tabResults.push({
				tab,
				matched,
				bestScore: ranked[0]?.score ?? 0,
				order: SETTING_TABS.indexOf(tab),
			});
		}

		tabResults.sort((a, b) => a.bestScore - b.bestScore || a.order - b.order);
		for (const result of tabResults) {
			const meta = TAB_METADATA[result.tab];
			items.push({
				id: `__tab:${result.tab}`,
				label: `${theme.symbol(meta.icon as Parameters<typeof theme.symbol>[0])} ${meta.label}`,
				currentValue: "",
				heading: true,
			});
			this.#searchFirstMatch.set(result.tab, result.matched[0]?.id ?? "");
			items.push(...result.matched);
		}

		this.#searchList.setItems(items);
		this.#searchMatchCount = total;
		this.#tabBar.setTabs(
			this.#buildSearchTabs(
				counts,
				tabResults.map(result => result.tab),
			),
		);
		this.#syncTabBarToSelection(this.#searchList.getSelectedItem());
	}

	/**
	 * Leave search mode. With `jumpToSelection`, land on the tab containing
	 * the selected result and keep it selected there — search doubles as
	 * navigation. Otherwise restore the pre-search tab.
	 */
	#endSearch(jumpToSelection: boolean): void {
		if (!this.#searchList) return;
		const selected = jumpToSelection ? this.#searchList.getSelectedItem() : undefined;
		const selectedDef = selected ? getSettingDef(selected.id as SettingPath) : undefined;
		const targetTab: SettingTab | "plugins" = selectedDef?.tab ?? this.#preSearchTabId;

		this.#searchQuery = "";
		this.#searchFirstMatch.clear();
		this.#searchMatchCount = 0;
		this.#tabBar.setTabs(getSettingsTabs(), targetTab);
		this.#switchToTab(targetTab);
		if (selectedDef) {
			this.#currentList?.selectItem(selectedDef.path);
		}
	}

	/** Matching tabs first (counts attached), ordered by best result score; the rest stay muted at the end. */
	#buildSearchTabs(counts: Map<SettingTab, number>, matchedTabOrder: readonly SettingTab[]): Tab[] {
		const matched: Tab[] = [];
		const empty: Tab[] = [];
		const matchedIds = new Set<SettingTab>(matchedTabOrder);
		for (const id of matchedTabOrder) {
			const meta = TAB_METADATA[id];
			const icon = theme.symbol(meta.icon as Parameters<typeof theme.symbol>[0]);
			const count = counts.get(id) ?? 0;
			if (count > 0) {
				matched.push({ id, label: `${icon} ${meta.label} (${count})`, short: `${icon} ${count}` });
			}
		}
		for (const id of SETTING_TABS) {
			if (matchedIds.has(id)) continue;
			const meta = TAB_METADATA[id];
			const icon = theme.symbol(meta.icon as Parameters<typeof theme.symbol>[0]);
			empty.push({ id, label: `${icon} ${meta.label}`, short: icon, muted: true });
		}
		// Plugins hosts its own UI; it is not part of the schema-backed search.
		empty.push({ id: "plugins", label: `${theme.icon.package} Plugins`, short: theme.icon.package, muted: true });
		return [...matched, ...empty];
	}

	#syncTabBarToSelection(item: SettingItem | undefined): void {
		if (!this.#searchList || !item) return;
		const def = getSettingDef(item.id as SettingPath);
		if (def) this.#tabBar.setActiveById(def.tab);
	}

	/** Value-change dispatch for the search result list (any tab's setting). */
	#onSearchSettingChange(path: SettingPath, newValue: string): void {
		const def = getSettingDef(path);
		if (!def) return;
		if (def.type === "boolean") {
			const boolValue = newValue === "true";
			settings.set(path, boolValue as never);
			this.callbacks.onChange(path, boolValue);
		} else if (def.type === "enum") {
			settings.set(path, newValue as never);
			this.callbacks.onChange(path, newValue);
		}
		// Submenu/text types already persisted inside their own done callbacks.
		if (def.tab === "appearance") {
			this.#triggerStatusLinePreview();
		}
		// Values feed the searchable text and condition gates may have flipped:
		// recompute results in place (selection is preserved by item id).
		this.#setSearchQuery(this.#searchQuery);
	}

	/**
	 * Convert a setting definition to a SettingItem for the UI.
	 */
	#defToItem(def: SettingDef): SettingItem | null {
		if (!settingVisible(this.#projection, def)) return null;

		const currentValue = this.#getCurrentValue(def);
		const changed = this.#isChanged(def, currentValue);

		switch (def.type) {
			case "boolean":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: currentValue ? "true" : "false",
					values: ["true", "false"],
					changed,
				};

			case "enum":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: currentValue as string,
					values: [...def.values],
					changed,
				};

			case "submenu":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: this.#getSubmenuCurrentValue(def.path, currentValue),
					submenu: (cv, done) => this.#createSubmenu(def, cv, done),
					changed,
				};

			case "text":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: (currentValue as string) ?? "",
					submenu: (cv, done) => this.#createTextInput(def, cv, done),
					changed,
				};
		}
	}

	/**
	 * Get the current value for a setting.
	 */
	#getCurrentValue(def: SettingDef): unknown {
		return this.#projection.values[def.path];
	}

	#isChanged(def: SettingDef, currentValue: unknown): boolean {
		return !Object.is(currentValue, getDefault(def.path));
	}

	#getSubmenuCurrentValue(path: SettingPath, value: unknown): string {
		const rawValue = String(value ?? "");
		if (path === "compaction.thresholdPercent" && (rawValue === "-1" || rawValue === "")) {
			return "default";
		}
		if (path === "compaction.thresholdTokens" && (rawValue === "-1" || rawValue === "")) {
			return "default";
		}
		return rawValue;
	}

	/**
	 * Create a submenu for a submenu-type setting.
	 */
	#createSubmenu(
		def: SettingDef & { type: "submenu" },
		currentValue: string,
		done: (value?: string) => void,
	): Container {
		let options = def.options;

		// Special case: inject runtime options for thinking level
		if (def.path === "defaultThinkingLevel") {
			// Prepend `auto`; the rest are the model's runtime-supported efforts.
			const levels: ConfiguredThinkingLevel[] = [AUTO_THINKING, ...this.context.availableThinkingLevels];
			options = levels.map(level => {
				const baseOpt = options.find(o => o.value === level);
				return baseOpt || { value: level, label: level };
			});
		} else if (def.path === "theme.dark" || def.path === "theme.light") {
			options = this.context.availableThemes.map(t => ({ value: t, label: t }));
		}

		// Preview handlers
		let onPreview: ((value: string) => void | Promise<void>) | undefined;
		let onPreviewCancel: (() => void) | undefined;
		let footer: Component | undefined;

		const activeThemeBeforePreview = getCurrentThemeName() ?? currentValue;
		if (def.path === "theme.dark" || def.path === "theme.light") {
			onPreview = value => {
				return this.callbacks.onThemePreview?.(value);
			};
			onPreviewCancel = () => {
				this.callbacks.onThemePreview?.(activeThemeBeforePreview);
			};
		} else if (def.path === "statusLine.preset") {
			onPreview = value => {
				const presetDef = getPreset(
					value as "default" | "minimal" | "compact" | "full" | "nerd" | "ascii" | "custom",
				);
				this.callbacks.onStatusLinePreview?.({
					preset: value as StatusLinePreset,
					leftSegments: presetDef.leftSegments,
					rightSegments: presetDef.rightSegments,
					separator: presetDef.separator,
				});
			};
			onPreviewCancel = () => {
				const currentPreset = settings.get("statusLine.preset");
				const presetDef = getPreset(currentPreset);
				this.callbacks.onStatusLinePreview?.({
					preset: currentPreset,
					leftSegments: presetDef.leftSegments,
					rightSegments: presetDef.rightSegments,
					separator: presetDef.separator,
				});
			};
		} else if (def.path === "statusLine.separator") {
			onPreview = value => {
				this.callbacks.onStatusLinePreview?.({ separator: value as StatusLineSeparatorStyle });
			};
			onPreviewCancel = () => {
				const separator = settings.get("statusLine.separator");
				this.callbacks.onStatusLinePreview?.({ separator });
			};
		} else if (def.path === "snapcompact.shape") {
			const shapePreview = new SnapcompactShapePreview(currentValue, {
				model: this.context.model,
				imageBudget: this.context.imageBudget,
				requestRender: this.context.requestRender,
			});
			onPreview = value => shapePreview.setValue(value);
			footer = shapePreview;
		}

		// Provide status line preview for theme selection
		const isThemeSetting = def.path === "theme.dark" || def.path === "theme.light";
		const getPreview = isThemeSetting ? this.callbacks.getStatusLinePreview : undefined;

		return new SelectSubmenu(
			def.label,
			def.description,
			options,
			currentValue,
			value => {
				this.#setSettingValue(def.path, value);
				this.callbacks.onChange(def.path, value);
				done(value);
			},
			() => {
				onPreviewCancel?.();
				done();
			},
			onPreview,
			getPreview,
			footer,
		);
	}

	/**
	 * Create a text input submenu for a plain string setting.
	 */
	#createTextInput(
		def: SettingDef & { type: "text" },
		currentValue: string,
		done: (value?: string) => void,
	): Container {
		this.#textInputActive = true;
		const wrappedDone = (value?: string) => {
			this.#textInputActive = false;
			done(value);
		};
		return new TextInputSubmenu(
			def.label,
			def.description,
			currentValue,
			value => {
				// Empty string clears the setting; undefined-typed string settings
				// store "" which the browser.ts expandPath ignores (no-op fallback).
				this.#setSettingValue(def.path, value);
				this.callbacks.onChange(def.path, value);
				wrappedDone(value);
			},
			() => wrappedDone(),
		);
	}

	/**
	 * Set a setting value, handling type conversion.
	 */
	#setSettingValue(path: SettingPath, value: string): void {
		// Handle number conversions
		const currentValue = settings.get(path);
		if (path === "compaction.thresholdPercent" && value === "default") {
			settings.set(path, -1 as never);
		} else if (path === "compaction.thresholdTokens" && value === "default") {
			settings.set(path, -1 as never);
		} else if (typeof currentValue === "number") {
			settings.set(path, Number(value) as never);
		} else if (typeof currentValue === "boolean") {
			settings.set(path, (value === "true") as never);
		} else {
			settings.set(path, value as never);
		}
	}

	/**
	 * Show a settings tab using definitions.
	 */
	#showSettingsTab(tabId: SettingTab): void {
		const defs = getSettingsForTab(tabId);

		const items = this.#buildItemsForDefs(defs);
		// Mirror SettingsList's section detection (leading ungrouped items form
		// an implicit section) so the footer hint only advertises PgUp/PgDn
		// when the jump actually changes sections.
		const sectionCount = items.filter(item => item.heading).length + (items.length > 0 && !items[0].heading ? 1 : 0);
		this.#hasSectionJump = sectionCount >= 2;

		this.#currentList = new SettingsList(
			items,
			10,
			getSettingsListTheme(),
			() => {},
			() => {},
			// The selector owns type-to-search and the footer hint; pin the
			// split sidebar width so the divider never jumps between tabs.
			{ typeToSearch: false, hint: "", sidebarWidth: settingsSidebarWidth() },
		);
	}

	/**
	 * Map a definition list to UI items, dropping any whose condition is false.
	 * Inserts a heading row whenever the (group-sorted) definition list crosses
	 * into a new group; groups whose items are all condition-hidden emit none.
	 */
	#buildItemsForDefs(defs: SettingDef[]): SettingItem[] {
		const items: SettingItem[] = [];
		let lastGroup: string | undefined;
		for (const def of defs) {
			const item = this.#defToItem(def);
			if (!item) continue;
			if (def.group && def.group !== lastGroup) {
				items.push({ id: `__heading:${def.group}`, label: def.group, currentValue: "", heading: true });
				lastGroup = def.group;
			}
			items.push(item);
		}
		return items;
	}

	/** Re-evaluate condition gates against the current settings and refresh the active list. */
	#refreshCurrentTabItems(defs: SettingDef[]): void {
		if (this.#currentTabId === "plugins" || !this.#currentList) return;
		this.#currentList.setItems(this.#buildItemsForDefs(defs));
	}

	/**
	 * Get the status line preview string.
	 */
	#getStatusPreviewString(): string {
		if (this.callbacks.getStatusLinePreview) {
			return this.callbacks.getStatusLinePreview();
		}
		return theme.fg("dim", "(preview not available)");
	}

	/**
	 * Trigger status line preview with current settings.
	 */
	#triggerStatusLinePreview(): void {
		const statusLineSettings: StatusLinePreviewSettings = {
			preset: settings.get("statusLine.preset"),
			leftSegments: settings.get("statusLine.leftSegments"),
			rightSegments: settings.get("statusLine.rightSegments"),
			separator: settings.get("statusLine.separator"),
			sessionAccent: settings.get("statusLine.sessionAccent"),
			transparent: settings.get("statusLine.transparent"),
		};
		this.callbacks.onStatusLinePreview?.(statusLineSettings);
	}


}
