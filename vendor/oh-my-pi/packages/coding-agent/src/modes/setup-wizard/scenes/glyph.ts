import { type Keybinding, type SelectItem, SelectList } from "@oh-my-pi/pi-tui";
import { getSelectListTheme, type SymbolPreset, theme } from "../../theme/theme";
import type { MvuEnvelope } from "../../mvu/input-lease";
import {
	makeSelectorModel,
	type SelectorModel,
	updateSelector,
} from "../../mvu/selector";
import type { Transition } from "../../mvu/schema";
import type { SetupScene, SetupSceneController, SetupSceneHost } from "./types";

const GLYPH_PRESETS = ["nerd", "unicode", "ascii"] as const satisfies readonly SymbolPreset[];
type GlyphAction = Keybinding;

const GLYPH_LABELS: Readonly<Record<SymbolPreset, string>> = {
	nerd: "Nerd Font",
	unicode: "Unicode",
	ascii: "ASCII",
};

const GLYPH_SAMPLES: Readonly<Record<SymbolPreset, string>> = {
	nerd: "󰊢 󰘧 󰆍 󰙅",
	unicode: "◆ ✓ ✗ →",
	ascii: "* + x ->",
};

const GLYPH_ITEMS: readonly SelectItem[] = GLYPH_PRESETS.map((preset, index) => ({
	value: preset,
	label: `${index + 1}. ${GLYPH_LABELS[preset]}`,
	description: GLYPH_SAMPLES[preset],
}));

export interface GlyphSceneModel {
	readonly selector: SelectorModel<SymbolPreset, GlyphAction>;
	readonly generation: number;
	readonly previewGeneration: number;
	readonly previewing: SymbolPreset | undefined;
	readonly committing: boolean;
	readonly error: string | undefined;
}

export type GlyphSceneMessage =
	| MvuEnvelope
	| { readonly _tag: "GlyphPreviewSettled"; readonly generation: number; readonly previewGeneration: number; readonly preset: SymbolPreset; readonly error?: string }
	| { readonly _tag: "GlyphCommitSettled"; readonly generation: number; readonly previewGeneration: number; readonly preset: SymbolPreset; readonly error?: string };

export type GlyphSceneCommand =
	| { readonly _tag: "GlyphPreview"; readonly generation: number; readonly previewGeneration: number; readonly preset: SymbolPreset }
	| { readonly _tag: "GlyphCommit"; readonly generation: number; readonly previewGeneration: number; readonly preset: SymbolPreset }
	| { readonly _tag: "GlyphFinish"; readonly result: "done" | "skipped" };

export function makeGlyphSceneModel(current: SymbolPreset, generation: number): GlyphSceneModel {
	const selectedIndex = Math.max(0, GLYPH_PRESETS.indexOf(current));
	const selector = makeSelectorModel<SymbolPreset, GlyphAction>(GLYPH_PRESETS);
	return {
		selector: { ...selector, selectedId: GLYPH_PRESETS[selectedIndex], selectedIndex },
		generation,
		previewGeneration: 0,
		previewing: undefined,
		committing: false,
		error: undefined,
	};
}

function inputText(message: MvuEnvelope): string | undefined {
	const event = message.event;
	if (event._tag === "Paste") return event.text;
	if (event._tag !== "Press") return undefined;
	return event.text ?? String(event.key);
}

function moveTo(model: GlyphSceneModel, index: number): GlyphSceneModel {
	const clamped = Math.max(0, Math.min(index, GLYPH_PRESETS.length - 1));
	const current = model.selector.selectedId === undefined ? 0 : GLYPH_PRESETS.indexOf(model.selector.selectedId);
	let selector = model.selector;
	const direction = clamped < current ? -1 : 1;
	for (let remaining = Math.abs(clamped - current); remaining > 0; remaining -= 1) {
		selector = updateSelector(selector, { _tag: "Move", delta: direction }).model;
	}
	return { ...model, selector };
}

function requestPreview(model: GlyphSceneModel): Transition<GlyphSceneModel, GlyphSceneCommand> {
	const preset = model.selector.selectedId;
	if (preset === undefined) return { model, commands: [], dirtyKeys: new Set() };
	const previewGeneration = model.previewGeneration + 1;
	const next = { ...model, previewGeneration, previewing: preset, error: undefined };
	return {
		model: next,
		commands: [{ _tag: "GlyphPreview", generation: next.generation, previewGeneration, preset }],
		dirtyKeys: new Set(["setup.glyph", "setup.glyph.preview"]),
	};
}

export function updateGlyphScene(model: GlyphSceneModel, message: GlyphSceneMessage): Transition<GlyphSceneModel, GlyphSceneCommand> {
	if (message._tag === "GlyphPreviewSettled") {
		if (message.generation !== model.generation || message.previewGeneration !== model.previewGeneration || message.preset !== model.previewing) {
			return { model, commands: [], dirtyKeys: new Set() };
		}
		return {
			model: { ...model, previewing: undefined, error: message.error },
			commands: [],
			dirtyKeys: new Set(["setup.glyph.preview"]),
		};
	}
	if (message._tag === "GlyphCommitSettled") {
		if (message.generation !== model.generation || message.previewGeneration !== model.previewGeneration || !model.committing) {
			return { model, commands: [], dirtyKeys: new Set() };
		}
		const next = { ...model, committing: false, previewing: undefined, error: message.error };
		return {
			model: next,
			commands: message.error === undefined ? [{ _tag: "GlyphFinish", result: "done" }] : [],
			dirtyKeys: new Set(["setup.glyph", "setup.glyph.preview"]),
		};
	}
	if (model.committing) return { model, commands: [], dirtyKeys: new Set() };
	const text = inputText(message);
	if (message.action === "ui.dismiss") {
		return { model, commands: [{ _tag: "GlyphFinish", result: "skipped" }], dirtyKeys: new Set() };
	}
	const indexed = /^setup\.select\.index:(\d+)$/.exec(String(message.action));
	if (indexed !== null) return requestPreview(moveTo(model, Number(indexed[1])));
	if (text !== undefined && text >= "1" && text <= "3") return requestPreview(moveTo(model, Number(text) - 1));
	if (message.action === "tui.select.up") {
		const selector = updateSelector(model.selector, { _tag: "Move", delta: -1 }).model;
		return requestPreview({ ...model, selector });
	}
	if (message.action === "tui.select.down") {
		const selector = updateSelector(model.selector, { _tag: "Move", delta: 1 }).model;
		return requestPreview({ ...model, selector });
	}
	if (message.action === "tui.select.pageUp" || message.action === "tui.select.pageDown") {
		const selector = updateSelector(model.selector, { _tag: "Page", delta: message.action === "tui.select.pageUp" ? -1 : 1 }).model;
		return requestPreview({ ...model, selector });
	}
	if (message.action === "tui.select.confirm") {
		const preset = model.selector.selectedId;
		if (preset === undefined) return { model, commands: [], dirtyKeys: new Set() };
		const previewGeneration = model.previewGeneration + 1;
		const next = { ...model, previewGeneration, previewing: preset, committing: true, error: undefined };
		return {
			model: next,
			commands: [{ _tag: "GlyphCommit", generation: next.generation, previewGeneration, preset }],
			dirtyKeys: new Set(["setup.glyph"]),
		};
	}
	return { model, commands: [], dirtyKeys: new Set() };
}

export class GlyphSceneController implements SetupSceneController {
	readonly title = "Choose glyph mode";
	readonly subtitle = "Pick the row that renders cleanly in your terminal.";
	#projection: GlyphSceneModel;
	readonly #selectList = new SelectList(GLYPH_ITEMS, GLYPH_ITEMS.length, getSelectListTheme());
	#listRowStart = 0;

	constructor(host: SetupSceneHost) {
		this.#projection = makeGlyphSceneModel(theme.getSymbolPreset(), 0);
		void host;
		this.apply(this.#projection);
	}

	apply(model: GlyphSceneModel): void {
		this.#projection = model;
		const selected = model.selector.selectedId;
		this.#selectList.setSelectedIndex(selected === undefined ? 0 : Math.max(0, GLYPH_PRESETS.indexOf(selected)));
	}

	invalidate(): void { this.#selectList.invalidate(); }

	hitTest(line: number): number | undefined { return this.#selectList.hitTest(line - this.#listRowStart); }

	render(width: number): readonly string[] {
		const lines = [theme.fg("muted", "If a row shows boxes, tofu, or misaligned icons, pick another."), ""];
		this.#listRowStart = lines.length;
		lines.push(...this.#selectList.render(width));
		if (this.#projection.previewing !== undefined) lines.push("", theme.fg("dim", "Applying preview…"));
		if (this.#projection.error !== undefined) lines.push("", theme.fg("error", this.#projection.error));
		return lines;
	}
}

export const glyphSetupScene: SetupScene = {
	id: "glyph",
	title: "Choose glyph mode",
	minVersion: 1,
	mount: host => new GlyphSceneController(host),
};
