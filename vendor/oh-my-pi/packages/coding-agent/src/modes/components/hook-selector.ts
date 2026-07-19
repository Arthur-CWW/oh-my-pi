/**
 * Hook selector MVU surface.
 *
 * The reducer below owns selection, filtering, focus depth, and settlement
 * commands. HookSelectorComponent is deliberately renderer-only: it applies a
 * committed HookModalModel and never handles terminal input itself.
 */
import {
	Container,
	Ellipsis,
	fuzzyMatch,
	Markdown,
	renderInlineMarkdown,
	replaceTabs,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type MarkdownTheme,
} from "@oh-my-pi/pi-tui";
import { getMarkdownTheme, type ThemeColor, theme } from "../../modes/theme/theme";
import { makeComponentId } from "../mvu/schema";
import {
	makeSurfaceModalModel,
	type SurfaceModalModel,
	type SurfaceModalMsg,
	updateSurfaceModal,
} from "./plugin-settings";
import { DynamicBorder } from "./dynamic-border";
import { renderSegmentTrack } from "./segment-track";
import { editorKey } from "./keybinding-hints";

export interface HookSelectorSliderSegment {
	readonly label: string;
	readonly detail?: string;
}

export interface HookSelectorSlider {
	readonly caption?: string;
	readonly segments: readonly HookSelectorSliderSegment[];
	readonly index: number;
	readonly onChange?: (index: number) => void;
}

export interface HookSelectorOptions {
	readonly initialIndex?: number;
	readonly outline?: boolean;
	readonly maxVisible?: number;
	readonly helpText?: string;
	readonly slider?: HookSelectorSlider;
	readonly disabledIndices?: readonly number[];
	readonly selectionMarker?: "radio" | "checkbox";
	readonly checkedIndices?: readonly number[];
	readonly markableCount?: number;
}

export interface HookSelectorOption {
	readonly label: string;
	readonly description?: string;
}

export type HookSelectorOptionInput = string | HookSelectorOption;

function normalizeHookSelectorOption(option: HookSelectorOptionInput): HookSelectorOption {
	if (typeof option === "string") return { label: option };
	const description = option.description?.trim();
	return description === undefined || description.length === 0
		? { label: option.label }
		: { label: option.label, description };
}

function splitLeadingSpacesForWrap(line: string, width: number): { readonly indent: string; readonly body: string } {
	let indentLength = 0;
	while (indentLength < line.length && line.charCodeAt(indentLength) === 32) indentLength += 1;
	const clamped = Math.min(indentLength, Math.max(0, width - 1));
	return { indent: line.slice(0, clamped), body: line.slice(indentLength) };
}

class OutlinedList extends Container {
	#lines: readonly string[] = [];

	setLines(lines: readonly string[]): void {
		this.#lines = lines;
		this.invalidate();
	}

	override render(width: number): readonly string[] {
		const borderColor = (text: string) => theme.fg("border", text);
		const horizontal = borderColor(theme.boxSharp.horizontal.repeat(Math.max(1, width)));
		const innerWidth = Math.max(1, width - 2);
		const content: string[] = [];
		for (const line of this.#lines) {
			const { indent, body } = splitLeadingSpacesForWrap(replaceTabs(line), innerWidth);
			const wrapped = wrapTextWithAnsi(body, Math.max(1, innerWidth - visibleWidth(indent)));
			for (const bodyLine of wrapped.length > 0 ? wrapped : [""]) {
				const value = `${indent}${bodyLine}`;
				content.push(
					`${borderColor(theme.boxSharp.vertical)}${value}${" ".repeat(Math.max(0, innerWidth - visibleWidth(value)))}${borderColor(theme.boxSharp.vertical)}`,
				);
			}
		}
		return [horizontal, ...content, horizontal];
	}
}

export interface HookModalOption {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly disabled: boolean;
}

export type HookModalRegion = "options" | "filter";
export type HookModalLayer = { readonly _tag: "Filter" };

export interface HookModalModel extends SurfaceModalModel<HookModalRegion, HookModalLayer> {
	readonly title: string;
	readonly options: readonly HookModalOption[];
	readonly selectedId?: string;
	readonly query: string;
	readonly sliderIndex: number;
	readonly sliderCount: number;
	readonly sliderCaption?: string;
	readonly sliderSegments: readonly HookSelectorSliderSegment[];
	readonly helpText?: string;
	readonly outline: boolean;
	readonly maxVisible: number;
	readonly selectionMarker?: "radio" | "checkbox";
	readonly checkedIndices: readonly number[];
	readonly markableCount: number;
}

export type HookModalMsg =
	| SurfaceModalMsg<HookModalRegion, HookModalLayer>
	| { readonly _tag: "Move"; readonly delta: -1 | 1 }
	| { readonly _tag: "BeginFilter" }
	| { readonly _tag: "FilterChanged"; readonly query: string }
	| { readonly _tag: "MoveSlider"; readonly delta: -1 | 1 }
	| { readonly _tag: "Select" }
	| { readonly _tag: "ExternalEditor" };

export type HookModalCommand =
	| { readonly _tag: "CloseRequested" }
	| { readonly _tag: "SelectionRequested"; readonly id: string; readonly label: string }
	| { readonly _tag: "SliderChanged"; readonly index: number }
	| { readonly _tag: "ExternalEditorRequested" };

export const HOOK_SELECTOR_ROUTE = {
	componentId: makeComponentId("hook-selector"),
	context: "selector.global",
	makeInitialModel: makeHookModalModel,
	update: updateHookModal,
} as const;

function matchesHookQuery(option: HookModalOption, query: string): boolean {
	const searchable = `${option.label} ${option.id} ${option.description ?? ""}`.toLocaleLowerCase();
	return fuzzyMatch(query, searchable).matches;
}

function visibleHookOptions(model: HookModalModel): readonly HookModalOption[] {
	const query = model.query.trim().toLocaleLowerCase();
	return query.length === 0 ? model.options : model.options.filter(option => matchesHookQuery(option, query));
}

function nearestEnabledHookId(options: readonly HookModalOption[], start: number, delta: -1 | 1): string | undefined {
	if (options.length === 0) return undefined;
	for (let step = 0; step < options.length; step += 1) {
		const index = (start + step * delta + options.length) % options.length;
		const option = options[index];
		if (option !== undefined && !option.disabled) return option.id;
	}
	return undefined;
}

export function makeHookModalModel(
	options: readonly HookModalOption[],
	initialIndex = 0,
	sliderIndex = 0,
	sliderCount = 0,
	display: {
		readonly title?: string;
		readonly sliderCaption?: string;
		readonly sliderSegments?: readonly HookSelectorSliderSegment[];
		readonly helpText?: string;
		readonly outline?: boolean;
		readonly maxVisible?: number;
		readonly selectionMarker?: "radio" | "checkbox";
		readonly checkedIndices?: readonly number[];
		readonly markableCount?: number;
	} = {},
): HookModalModel {
	const safeIndex = Math.max(0, Math.min(initialIndex, Math.max(0, options.length - 1)));
	const sliderSegments = display.sliderSegments ?? [];
	return {
		...makeSurfaceModalModel<HookModalRegion, HookModalLayer>("options", safeIndex),
		title: display.title ?? "",
		options,
		selectedId: nearestEnabledHookId(options, safeIndex, 1),
		query: "",
		sliderIndex: Math.max(0, Math.min(sliderIndex, Math.max(0, sliderCount - 1))),
		sliderCount,
		...(display.sliderCaption === undefined ? {} : { sliderCaption: display.sliderCaption }),
		sliderSegments,
		...(display.helpText === undefined ? {} : { helpText: display.helpText }),
		outline: display.outline ?? false,
		maxVisible: Math.max(3, display.maxVisible ?? 12),
		...(display.selectionMarker === undefined ? {} : { selectionMarker: display.selectionMarker }),
		checkedIndices: display.checkedIndices ?? [],
		markableCount: Math.max(0, Math.min(display.markableCount ?? options.length, options.length)),
	};
}

export function updateHookModal(
	model: HookModalModel,
	msg: HookModalMsg,
): { readonly model: HookModalModel; readonly commands: readonly HookModalCommand[] } {
	switch (msg._tag) {
		case "Move": {
			const visible = visibleHookOptions(model);
			if (visible.length === 0) return { model, commands: [] };
			const current = Math.max(0, visible.findIndex(option => option.id === model.selectedId));
			const selectedId = nearestEnabledHookId(visible, (current + msg.delta + visible.length) % visible.length, msg.delta);
			return {
				model: { ...model, selectedId, focusIndex: Math.max(0, visible.findIndex(option => option.id === selectedId)) },
				commands: [],
			};
		}
		case "BeginFilter":
			return model.region === "filter"
				? { model, commands: [] }
				: {
						model: {
							...model,
							region: "filter",
							focusIndex: 0,
							depth: [
								...model.depth,
								{ layer: { _tag: "Filter" }, returnRegion: model.region, returnFocusIndex: model.focusIndex },
							],
						},
						commands: [],
					};
		case "FilterChanged": {
			const next = { ...model, query: msg.query };
			const visible = visibleHookOptions(next);
			return { model: { ...next, selectedId: nearestEnabledHookId(visible, 0, 1), focusIndex: 0 }, commands: [] };
		}
		case "MoveSlider": {
			if (model.sliderCount <= 0) return { model, commands: [] };
			const sliderIndex = Math.max(0, Math.min(model.sliderCount - 1, model.sliderIndex + msg.delta));
			return sliderIndex === model.sliderIndex
				? { model, commands: [] }
				: { model: { ...model, sliderIndex }, commands: [{ _tag: "SliderChanged", index: sliderIndex }] };
		}
		case "Select": {
			const option = model.options.find(candidate => candidate.id === model.selectedId);
			return !option || option.disabled
				? { model, commands: [] }
				: { model, commands: [{ _tag: "SelectionRequested", id: option.id, label: option.label }] };
		}
		case "ExternalEditor":
			return { model, commands: [{ _tag: "ExternalEditorRequested" }] };
		default: {
			const transition = updateSurfaceModal(model, msg);
			const backedModel =
				msg._tag === "Back" && model.region === "filter"
					? { ...model, ...transition.model, query: "" }
					: { ...model, ...transition.model };
			return { model: backedModel, commands: transition.commands };
		}
	}
}

export class HookSelectorComponent extends Container {
	#model: HookModalModel = makeHookModalModel([]);
	#options: readonly HookModalOption[] = [];
	#filteredOptions: readonly { readonly option: HookModalOption; readonly index: number }[] = [];
	#selectedIndex = -1;
	#disabledIndices = new Set<number>();
	#selectionMarker: "radio" | "checkbox" | undefined;
	#checkedIndices = new Set<number>();
	#markableCount = 0;
	#maxVisible = 12;
	#listContainer: Container | undefined;
	#outlinedList: OutlinedList | undefined;
	#titleComponent: Markdown | undefined;
	#sliderComponent: Text | undefined;
	#controlsHint: Text | undefined;
	#lastRenderWidth: number | undefined;

	constructor(model?: HookModalModel) {
		super();
		if (model !== undefined) this.apply(model);
	}

	apply(model: HookModalModel): void {
		this.#model = model;
		this.#options = model.options;
		this.#filteredOptions = model.options.map((option, index) => ({ option, index }));
		this.#disabledIndices = new Set(model.options.flatMap((option, index) => option.disabled ? [index] : []));
		this.#selectionMarker = model.selectionMarker;
		this.#checkedIndices = new Set(model.checkedIndices);
		this.#markableCount = model.markableCount;
		this.#maxVisible = model.maxVisible;
		this.#selectedIndex = Math.max(0, this.#filteredOptions.findIndex(item => item.option.id === model.selectedId));
		if (this.#filteredOptions.length === 0) this.#selectedIndex = -1;
		if (model.query.trim().length > 0) {
			const query = model.query.trim().toLocaleLowerCase();
			this.#filteredOptions = this.#filteredOptions.filter(item => matchesHookQuery(item.option, query));
			this.#selectedIndex = Math.max(0, this.#filteredOptions.findIndex(item => item.option.id === model.selectedId));
		}
		this.#lastRenderWidth = undefined;
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.#titleComponent = new Markdown(model.title, 1, 0, getMarkdownTheme(), { color: text => theme.fg("accent", text) });
		this.addChild(this.#titleComponent);
		this.addChild(new Spacer(1));
		if (model.sliderSegments.length > 0) {
			this.#sliderComponent = new Text(this.#renderSliderLine(model), 1, 0);
			this.addChild(this.#sliderComponent);
			this.addChild(new Spacer(1));
		} else {
			this.#sliderComponent = undefined;
		}
		if (model.outline) {
			this.#outlinedList = new OutlinedList();
			this.#listContainer = undefined;
			this.addChild(this.#outlinedList);
		} else {
			this.#outlinedList = undefined;
			this.#listContainer = new Container();
			this.addChild(this.#listContainer);
		}
		this.addChild(new Spacer(1));
		this.#controlsHint = new Text(theme.fg("dim", model.helpText ?? `up/down navigate  enter select  ${editorKey("ui.dismiss")} cancel`), 1, 0);
		this.addChild(this.#controlsHint);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.#updateList();
		this.invalidate();
	}

	#renderOptionLines(
		option: HookModalOption,
		selected: boolean,
		disabled: boolean,
		mdTheme: MarkdownTheme,
		descRows: number | "full",
		width?: number,
		index?: number,
	): string[] {
		const textColor = disabled ? "dim" : selected ? "accent" : "text";
		const prefix = index !== undefined ? this.#markerPrefix(index, selected, disabled) : undefined;
		const label = renderInlineMarkdown(option.label, mdTheme, text => theme.fg(textColor, text));
		const lines = [prefix ?? (selected ? theme.fg("accent", `${theme.nav.cursor} `) : "  ") + label];
		if (prefix !== undefined) lines[0] = prefix + label;
		if (option.description !== undefined && descRows !== 0) {
			const color: ThemeColor = disabled ? "dim" : "muted";
			const description = renderInlineMarkdown(option.description, mdTheme, text => theme.fg(color, text));
			if (descRows === "full") lines.push(`    ${description}`);
			else {
				const bodyWidth = Math.max(1, (width ?? 80) - 6);
				const wrapped = wrapTextWithAnsi(description, bodyWidth);
				const rows = wrapped.length <= descRows ? wrapped : [...wrapped.slice(0, descRows - 1), truncateToWidth(wrapped.slice(descRows - 1).join(" "), bodyWidth, Ellipsis.Unicode)];
				lines.push(...rows.map(row => `    ${row}`));
			}
		}
		return lines;
	}

	#markerPrefix(index: number, selected: boolean, disabled: boolean): string | undefined {
		if (this.#selectionMarker === undefined || index >= this.#markableCount) return undefined;
		if (this.#selectionMarker === "radio") {
			const glyph = selected ? theme.radio.selected : theme.radio.unselected;
			return theme.fg(disabled ? "dim" : selected ? "accent" : "dim", `${glyph} `);
		}
		const checked = this.#checkedIndices.has(index);
		const glyph = checked ? theme.checkbox.checked : theme.checkbox.unchecked;
		return theme.fg(disabled ? "dim" : selected ? "accent" : checked ? "success" : "dim", `${glyph} `);
	}

	#rowCount(line: string, width: number): number {
		const normalized = replaceTabs(line);
		if (this.#outlinedList !== undefined) {
			const inner = Math.max(1, width - 2);
			const { indent, body } = splitLeadingSpacesForWrap(normalized, inner);
			return Math.max(1, wrapTextWithAnsi(body, Math.max(1, inner - visibleWidth(indent))).length);
		}
		return Math.max(1, wrapTextWithAnsi(normalized, Math.max(1, width - 2)).length);
	}

	#updateList(width = this.#lastRenderWidth): void {
		const lines: string[] = [];
		const mdTheme = getMarkdownTheme();
		const total = this.#filteredOptions.length;
		const renderWidth = width ?? 80;
		const compact = this.#options.reduce((rows, option) => rows + this.#renderOptionLines(option, false, option.disabled, mdTheme, "full", renderWidth).reduce((n, line) => n + this.#rowCount(line, renderWidth), 0), 0) > this.#maxVisible;
		const selected = Math.max(0, Math.min(this.#selectedIndex, Math.max(0, total - 1)));
		let start = selected;
		let end = Math.min(total, selected + 1);
		let rows = total === 0 ? 0 : this.#renderOptionLines(this.#filteredOptions[selected]!.option, true, this.#filteredOptions[selected]!.option.disabled, mdTheme, compact ? 0 : "full", renderWidth, this.#filteredOptions[selected]!.index).reduce((n, line) => n + this.#rowCount(line, renderWidth), 0);
		while (start > 0) {
			const candidate = this.#filteredOptions[start - 1]!;
			const cost = this.#renderOptionLines(candidate.option, false, candidate.option.disabled, mdTheme, compact ? 0 : "full", renderWidth, candidate.index).reduce((n, line) => n + this.#rowCount(line, renderWidth), 0);
			if (rows + cost > this.#maxVisible) break;
			start -= 1;
			rows += cost;
		}
		while (end < total) {
			const candidate = this.#filteredOptions[end]!;
			const cost = this.#renderOptionLines(candidate.option, false, candidate.option.disabled, mdTheme, compact ? 0 : "full", renderWidth, candidate.index).reduce((n, line) => n + this.#rowCount(line, renderWidth), 0);
			if (rows + cost > this.#maxVisible) break;
			end += 1;
			rows += cost;
		}
		for (let index = start; index < end; index += 1) {
			const item = this.#filteredOptions[index];
			if (item === undefined) continue;
			lines.push(...this.#renderOptionLines(item.option, index === this.#selectedIndex, item.option.disabled, mdTheme, compact && index !== this.#selectedIndex ? 0 : compact ? Math.max(0, this.#maxVisible - rows - 1) : "full", renderWidth, item.index));
		}
		if (total === 0) lines.push(theme.fg("dim", "  No matching options"));
		if (start > 0 || end < total || this.#model.query.length > 0 || compact) {
			const selectedCount = total === 0 ? 0 : this.#selectedIndex + 1;
			lines.push(theme.fg("dim", `  (${selectedCount}/${total})${this.#model.query.trim().length > 0 ? `  Search: ${this.#model.query}` : "  Type to search"}`));
		}
		if (this.#outlinedList !== undefined) this.#outlinedList.setLines(lines);
		else {
			this.#listContainer?.clear();
			for (const line of lines) this.#listContainer?.addChild(new Text(line, 1, 0));
		}
	}

	#renderSliderLine(model: HookModalModel): string {
		const active = Math.max(0, Math.min(model.sliderIndex, model.sliderSegments.length - 1));
		const track = renderSegmentTrack([...model.sliderSegments], active);
		const left = theme.fg(active > 0 ? "accent" : "dim", "◂");
		const right = theme.fg(active < model.sliderSegments.length - 1 ? "accent" : "dim", "▸");
		const caption = model.sliderCaption === undefined ? "" : `${theme.fg("dim", model.sliderCaption)}  `;
		const detail = model.sliderSegments[active]?.detail;
		return detail === undefined
			? `${caption}${left}  ${track}  ${right}`
			: `${caption}${left}  ${track}  ${right}\n  ${theme.fg("dim", "↳")} ${theme.fg("muted", detail)}`;
	}

	override render(width: number): readonly string[] {
		const renderWidth = Math.max(1, width);
		if (this.#lastRenderWidth !== renderWidth) {
			this.#lastRenderWidth = renderWidth;
			this.#updateList(renderWidth);
		}
		return super.render(renderWidth);
	}
}
