import {
	Ellipsis,
	padding,
	type Keybinding,
	type SelectItem,
	SelectList,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import { keyHint } from "../../components/keybinding-hints";
import type { MvuEnvelope } from "../../mvu/input-lease";
import { makeSelectorModel, type SelectorModel, updateSelector } from "../../mvu/selector";
import type { Transition } from "../../mvu/schema";
import {
	enableAutoTheme,
	getAvailableThemes,
	getColorBlindMode,
	getCurrentThemeName,
	getSelectListTheme,
	isLightTheme,
	previewTheme,
	type SymbolPreset,
	setColorBlindMode,
	setSymbolPreset,
	theme,
} from "../../theme/theme";
import type { SetupScene, SetupSceneController, SetupSceneHost } from "./types";

type ThemeMode = "curated" | "all";
type ThemeAction = Keybinding;

const CURATED_ITEMS: readonly SelectItem[] = [
	{ value: "auto", label: "1. Automatic", description: "Follow terminal light/dark appearance" },
	{ value: "theme:titanium", label: "2. Titanium", description: "Balanced dark theme" },
	{ value: "theme:light", label: "3. Light", description: "Bright background" },
	{ value: "colorblind", label: "4. Color-blind", description: "Color-blind-friendly status colors" },
	{ value: "ansi", label: "5. ANSI", description: "ASCII glyphs and terminal-safe colors" },
	{ value: "browse", label: "6. Browse all themes", description: "Load every installed theme" },
];

function fitLine(line: string, width: number): string {
	return truncateToWidth(line, Math.max(1, width), Ellipsis.Omit);
}

function fillStyledLine(content: string, width: number): string {
	return content + padding(Math.max(0, width - visibleWidth(content)));
}

function renderMockStatusLine(width: number): string {
	const left = theme.fg("accent", " NORMAL ");
	const right = theme.fg("muted", " setup preview ");
	const gap = padding(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
	return fitLine(theme.bg("selectedBg", `${left}${gap}${right}`), width);
}

function renderMockEditor(width: number): string[] {
	const prompt = theme.fg("accent", "❯ ");
	const line = prompt + theme.fg("text", "Ask anything, or type / for commands");
	return [
		fillStyledLine(theme.fg("border", "─".repeat(Math.max(1, width))), width),
		fillStyledLine(line, width),
		fillStyledLine(theme.fg("dim", "  shift+tab thinking · ctrl+c stop"), width),
	];
}

function renderThemePreview(width: number): string[] {
	return [
		fitLine(theme.bold(theme.fg("accent", "Theme preview")), width),
		fitLine(`${theme.status.success} ${theme.fg("success", "Success")}  ${theme.status.pending} ${theme.fg("warning", "Pending")}  ${theme.status.error} ${theme.fg("error", "Error")}`, width),
		...renderMockEditor(width),
		renderMockStatusLine(width),
	];
}

export interface ThemeSceneModel {
	readonly selector: SelectorModel<string, ThemeAction>;
	readonly items: readonly SelectItem[];
	readonly mode: ThemeMode;
	readonly generation: number;
	readonly sourceRevision: number;
	readonly requestGeneration: number;
	readonly loadingAllThemes: boolean;
	readonly previewDirty: boolean;
	readonly committing: boolean;
	readonly restoring: boolean;
	readonly message: string | undefined;
	readonly originalTheme: string | undefined;
	readonly originalSymbolPreset: SymbolPreset;
	readonly originalColorBlindMode: boolean;
}

export type ThemeSceneMessage =
	| MvuEnvelope
	| { readonly _tag: "ThemePreviewSettled"; readonly generation: number; readonly sourceRevision: number; readonly requestGeneration: number; readonly value: string; readonly error?: string }
	| { readonly _tag: "ThemeThemesLoaded"; readonly generation: number; readonly sourceRevision: number; readonly requestGeneration: number; readonly themes?: readonly string[]; readonly error?: string }
	| { readonly _tag: "ThemeCommitSettled"; readonly generation: number; readonly sourceRevision: number; readonly requestGeneration: number; readonly error?: string }
	| { readonly _tag: "ThemeRestoreSettled"; readonly generation: number; readonly sourceRevision: number; readonly requestGeneration: number; readonly finish: boolean; readonly error?: string };

export type ThemeSceneCommand =
	| { readonly _tag: "ThemePreview"; readonly model: ThemeSceneModel; readonly value: string }
	| { readonly _tag: "ThemeLoadAll"; readonly model: ThemeSceneModel }
	| { readonly _tag: "ThemeCommit"; readonly model: ThemeSceneModel; readonly value: string }
	| { readonly _tag: "ThemeRestore"; readonly model: ThemeSceneModel; readonly finish: boolean }
	| { readonly _tag: "ThemeFinish"; readonly result: "done" | "skipped" };

export function makeThemeSceneModel(host: SetupSceneHost, generation: number): ThemeSceneModel {
	const originalTheme = getCurrentThemeName();
	const currentIndex = originalTheme === "titanium" ? 1 : originalTheme === "light" ? 2 : 0;
	const selector = makeSelectorModel<string, ThemeAction>(CURATED_ITEMS.map(item => item.value));
	return {
		selector: { ...selector, selectedId: CURATED_ITEMS[currentIndex]?.value ?? "auto", selectedIndex: currentIndex },
		items: CURATED_ITEMS,
		mode: "curated",
		generation,
		sourceRevision: 0,
		requestGeneration: 0,
		loadingAllThemes: false,
		previewDirty: false,
		committing: false,
		restoring: false,
		message: undefined,
		originalTheme,
		originalSymbolPreset: host.ctx.settings.get("symbolPreset"),
		originalColorBlindMode: host.ctx.settings.get("colorBlindMode"),
	};
}

function themeInputText(message: MvuEnvelope): string | undefined {
	const event = message.event;
	if (event._tag === "Paste") return event.text;
	if (event._tag !== "Press") return undefined;
	return event.text ?? String(event.key);
}

function themeMoveTo(model: ThemeSceneModel, index: number): ThemeSceneModel {
	if (model.items.length === 0) return model;
	const clamped = Math.max(0, Math.min(index, model.items.length - 1));
	const current = model.selector.selectedId === undefined ? 0 : Math.max(0, model.selector.filteredIds.indexOf(model.selector.selectedId));
	let selector = model.selector;
	const direction = clamped < current ? -1 : 1;
	for (let remaining = Math.abs(clamped - current); remaining > 0; remaining -= 1) {
		selector = updateSelector(selector, { _tag: "Move", delta: direction }).model;
	}
	return { ...model, selector };
}

function themePreviewTransition(model: ThemeSceneModel): Transition<ThemeSceneModel, ThemeSceneCommand> {
	const value = model.selector.selectedId;
	if (value === undefined || value === "browse") return { model, commands: [], dirtyKeys: new Set() };
	const next = { ...model, requestGeneration: model.requestGeneration + 1, previewDirty: true, message: undefined };
	return {
		model: next,
		commands: [{ _tag: "ThemePreview", model: next, value }],
		dirtyKeys: new Set(["setup.theme", "setup.theme.preview"]),
	};
}

export function updateThemeScene(model: ThemeSceneModel, message: ThemeSceneMessage): Transition<ThemeSceneModel, ThemeSceneCommand> {
	if (message._tag === "ThemePreviewSettled") {
		if (message.generation !== model.generation || message.sourceRevision !== model.sourceRevision || message.requestGeneration !== model.requestGeneration) return { model, commands: [], dirtyKeys: new Set() };
		return { model: { ...model, message: message.error }, commands: [], dirtyKeys: new Set(["setup.theme.preview"]) };
	}
	if (message._tag === "ThemeThemesLoaded") {
		if (message.generation !== model.generation || message.sourceRevision !== model.sourceRevision || message.requestGeneration !== model.requestGeneration || !model.loadingAllThemes) return { model, commands: [], dirtyKeys: new Set() };
		if (message.themes === undefined) {
			return { model: { ...model, loadingAllThemes: false, message: message.error ?? "Failed to load themes" }, commands: [], dirtyKeys: new Set(["setup.theme"]) };
		}
		const items = message.themes.map(name => ({ value: `theme:${name}`, label: name, description: name === model.originalTheme ? "current" : undefined }));
		const selectedIndex = Math.max(0, message.themes.indexOf(model.originalTheme ?? ""));
		const selector = makeSelectorModel<string, ThemeAction>(items.map(item => item.value), model.sourceRevision);
		return {
			model: { ...model, mode: "all", items, selector: { ...selector, selectedId: items[selectedIndex]?.value, selectedIndex }, loadingAllThemes: false, message: undefined },
			commands: [],
			dirtyKeys: new Set(["setup.theme"]),
		};
	}
	if (message._tag === "ThemeCommitSettled") {
		if (message.generation !== model.generation || message.sourceRevision !== model.sourceRevision || message.requestGeneration !== model.requestGeneration || !model.committing) return { model, commands: [], dirtyKeys: new Set() };
		const next = { ...model, committing: false, previewDirty: message.error !== undefined, message: message.error };
		return { model: next, commands: message.error === undefined ? [{ _tag: "ThemeFinish", result: "done" }] : [], dirtyKeys: new Set(["setup.theme"]) };
	}
	if (message._tag === "ThemeRestoreSettled") {
		if (message.generation !== model.generation || message.sourceRevision !== model.sourceRevision || message.requestGeneration !== model.requestGeneration || !model.restoring) return { model, commands: [], dirtyKeys: new Set() };
		const next = { ...model, restoring: false, previewDirty: false, message: message.error };
		return { model: next, commands: message.finish && message.error === undefined ? [{ _tag: "ThemeFinish", result: "skipped" }] : [], dirtyKeys: new Set(["setup.theme", "setup.theme.preview"]) };
	}
	if (model.loadingAllThemes || model.committing || model.restoring) return { model, commands: [], dirtyKeys: new Set() };
	const text = themeInputText(message);
	if (message.action === "ui.dismiss") {
		const requestGeneration = model.requestGeneration + 1;
		if (model.mode === "all") {
			const currentIndex = model.originalTheme === "titanium" ? 1 : model.originalTheme === "light" ? 2 : 0;
			const selector = makeSelectorModel<string, ThemeAction>(CURATED_ITEMS.map(item => item.value), model.sourceRevision + 1);
			const next: ThemeSceneModel = {
				...model,
				mode: "curated",
				items: CURATED_ITEMS,
				selector: { ...selector, selectedId: CURATED_ITEMS[currentIndex]?.value ?? "auto", selectedIndex: currentIndex },
				sourceRevision: model.sourceRevision + 1,
				requestGeneration,
				restoring: true,
			};
			return { model: next, commands: [{ _tag: "ThemeRestore", model: next, finish: false }], dirtyKeys: new Set(["setup.theme"]) };
		}
		const next = { ...model, requestGeneration, restoring: true };
		return { model: next, commands: [{ _tag: "ThemeRestore", model: next, finish: true }], dirtyKeys: new Set(["setup.theme"]) };
	}
	let selectedModel = model;
	const indexed = /^setup\.select\.index:(\d+)$/.exec(String(message.action));
	if (indexed !== null) selectedModel = themeMoveTo(model, Number(indexed[1]));
	if (text !== undefined && text >= "1" && text <= "9") selectedModel = themeMoveTo(model, Number(text) - 1);
	else if (message.action === "tui.select.up" || message.action === "tui.select.down") {
		selectedModel = { ...model, selector: updateSelector(model.selector, { _tag: "Move", delta: message.action === "tui.select.up" ? -1 : 1 }).model };
	} else if (message.action === "tui.select.pageUp" || message.action === "tui.select.pageDown") {
		selectedModel = { ...model, selector: updateSelector(model.selector, { _tag: "Page", delta: message.action === "tui.select.pageUp" ? -1 : 1 }).model };
	}
	if (selectedModel !== model) return themePreviewTransition(selectedModel);
	if (message.action !== "tui.select.confirm") return { model, commands: [], dirtyKeys: new Set() };
	const selected = model.selector.selectedId;
	if (selected === undefined) return { model, commands: [], dirtyKeys: new Set() };
	if (selected === "browse") {
		const next = { ...model, loadingAllThemes: true, message: undefined, sourceRevision: model.sourceRevision + 1, requestGeneration: model.requestGeneration + 1 };
		return { model: next, commands: [{ _tag: "ThemeLoadAll", model: next }], dirtyKeys: new Set(["setup.theme"]) };
	}
	const next = { ...model, committing: true, requestGeneration: model.requestGeneration + 1, message: undefined };
	return { model: next, commands: [{ _tag: "ThemeCommit", model: next, value: selected }], dirtyKeys: new Set(["setup.theme"]) };
}

async function applyThemePresentation(symbolPreset: SymbolPreset, colorBlindMode: boolean): Promise<void> {
	if (theme.getSymbolPreset() !== symbolPreset) await setSymbolPreset(symbolPreset);
	if (getColorBlindMode() !== colorBlindMode) await setColorBlindMode(colorBlindMode);
}

export async function previewThemeSceneValue(model: ThemeSceneModel, value: string): Promise<void> {
	if (value === "auto") {
		await applyThemePresentation(model.originalSymbolPreset, model.originalColorBlindMode);
		enableAutoTheme();
		return;
	}
	if (value === "colorblind") {
		await applyThemePresentation(model.originalSymbolPreset, true);
		return;
	}
	if (value === "ansi") {
		await applyThemePresentation("ascii", model.originalColorBlindMode);
		const result = await previewTheme("dark-terminal");
		if (!result.success) throw new Error(result.error ?? "Theme preview failed");
		return;
	}
	if (!value.startsWith("theme:")) return;
	await applyThemePresentation(model.originalSymbolPreset, model.originalColorBlindMode);
	const result = await previewTheme(value.slice("theme:".length));
	if (!result.success) throw new Error(result.error ?? "Theme preview failed");
}

export async function loadThemeSceneChoices(): Promise<readonly string[]> {
	return getAvailableThemes();
}

export async function restoreThemeScene(model: ThemeSceneModel): Promise<void> {
	await applyThemePresentation(model.originalSymbolPreset, model.originalColorBlindMode);
	if (model.originalTheme !== undefined) {
		const result = await previewTheme(model.originalTheme);
		if (!result.success) throw new Error(result.error ?? "Theme restore failed");
	}
}

export async function commitThemeSceneValue(host: SetupSceneHost, model: ThemeSceneModel, value: string): Promise<void> {
	if (value === "auto") {
		host.ctx.settings.set("theme.dark", "titanium");
		host.ctx.settings.set("theme.light", "light");
		await applyThemePresentation(model.originalSymbolPreset, model.originalColorBlindMode);
		enableAutoTheme();
		return;
	}
	if (value === "colorblind") {
		host.ctx.settings.set("colorBlindMode", true);
		await applyThemePresentation(model.originalSymbolPreset, true);
		return;
	}
	if (value === "ansi") {
		host.ctx.settings.set("symbolPreset", "ascii");
		host.ctx.settings.set("theme.dark", "dark-terminal");
		await applyThemePresentation("ascii", model.originalColorBlindMode);
		enableAutoTheme();
		return;
	}
	if (!value.startsWith("theme:")) return;
	const themeName = value.slice("theme:".length);
	await applyThemePresentation(model.originalSymbolPreset, model.originalColorBlindMode);
	if (isLightTheme(themeName)) host.ctx.settings.set("theme.light", themeName);
	else host.ctx.settings.set("theme.dark", themeName);
	const result = await previewTheme(themeName);
	if (!result.success) throw new Error(result.error ?? "Theme commit failed");
}

export class ThemeSceneController implements SetupSceneController {
	readonly title = "Pick a theme";
	readonly subtitle = "Move through the list to preview; Enter saves the highlighted choice.";
	#projection: ThemeSceneModel;
	#selectList: SelectList;
	#itemsKey = "";
	#listRowStart = -1;

	constructor(readonly host: SetupSceneHost) {
		this.#projection = makeThemeSceneModel(host, 0);
		this.#selectList = new SelectList(CURATED_ITEMS, CURATED_ITEMS.length, getSelectListTheme());
		this.apply(this.#projection);
	}

	apply(model: ThemeSceneModel): void {
		this.#projection = model;
		const itemsKey = model.items.map(item => item.value).join("\u0000");
		if (itemsKey !== this.#itemsKey) {
			this.#itemsKey = itemsKey;
			this.#selectList = new SelectList(model.items, Math.min(10, Math.max(1, model.items.length)), getSelectListTheme());
		}
		const selected = model.selector.selectedId;
		this.#selectList.setSelectedIndex(selected === undefined ? 0 : Math.max(0, model.selector.filteredIds.indexOf(selected)));
	}

	invalidate(): void { this.#selectList.invalidate(); }
	hitTest(line: number): number | undefined { return this.#listRowStart < 0 ? undefined : this.#selectList.hitTest(line - this.#listRowStart); }

	render(width: number): readonly string[] {
		const model = this.#projection;
		const lines = [
			theme.fg("muted", "Theme changes preview live. Nothing is saved until you press Enter."),
			model.mode === "all" ? theme.fg("dim", "Browsing all themes · ") + keyHint("ui.dismiss", "returns to curated choices") : keyHint("ui.dismiss", "skips this step"),
			"",
			...renderThemePreview(width),
			"",
		];
		if (model.loadingAllThemes) {
			this.#listRowStart = -1;
			lines.push(theme.fg("dim", "Loading themes…"));
		} else {
			this.#listRowStart = lines.length;
			lines.push(...this.#selectList.render(width));
		}
		if (model.message !== undefined) lines.push("", theme.fg("error", model.message));
		return lines;
	}
}

export const themeSetupScene: SetupScene = {
	id: "theme",
	title: "Pick a theme",
	minVersion: 1,
	mount: host => new ThemeSceneController(host),
};
