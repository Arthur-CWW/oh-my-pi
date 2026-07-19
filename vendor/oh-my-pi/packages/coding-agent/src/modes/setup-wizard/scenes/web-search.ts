import { type Keybinding, type SelectItem, SelectList, truncateToWidth } from "@oh-my-pi/pi-tui";
import { SETTINGS_SCHEMA } from "../../../config/settings-schema";
import type { MvuEnvelope } from "../../mvu/input-lease";
import { makeSelectorModel, type SelectorModel, updateSelector } from "../../mvu/selector";
import type { Transition } from "../../mvu/schema";
import { getSelectListTheme, theme } from "../../theme/theme";
import { isSearchProviderId, isSearchProviderPreference, type SearchProviderId } from "../../../web/search/types";
import type { SetupSceneHost } from "./types";

const MAX_VISIBLE = 8;
type WebSearchAction = Keybinding;
type Availability = "checking" | boolean;

export const WEB_SEARCH_ITEMS: readonly SelectItem[] = SETTINGS_SCHEMA["providers.webSearch"].ui.options.map(option => ({
	value: option.value,
	label: option.label,
	description: option.description,
}));

export interface WebSearchModel {
	readonly selector: SelectorModel<string, WebSearchAction>;
	readonly generation: number;
	readonly sourceRevision: number;
	readonly requestGeneration: number;
	readonly availability: Partial<Readonly<Record<SearchProviderId, Availability>>>;
	readonly status: readonly string[];
}

export type WebSearchMessage =
	| MvuEnvelope
	| { readonly _tag: "WebSearchActivated" }
	| { readonly _tag: "WebSearchReadinessSettled"; readonly generation: number; readonly sourceRevision: number; readonly requestGeneration: number; readonly providerId: SearchProviderId; readonly ready: boolean }
	| { readonly _tag: "WebSearchApplySettled"; readonly generation: number; readonly sourceRevision: number; readonly requestGeneration: number; readonly value: SearchProviderId | "auto"; readonly error?: string };

export type WebSearchCommand =
	| { readonly _tag: "CheckWebSearchReadiness"; readonly model: WebSearchModel; readonly providerId: SearchProviderId }
	| { readonly _tag: "ApplyWebSearch"; readonly model: WebSearchModel; readonly value: SearchProviderId | "auto" }
	| { readonly _tag: "WebSearchFinish"; readonly result: "skipped" };

export function makeWebSearchModel(current: string, generation: number): WebSearchModel {
	const index = Math.max(0, WEB_SEARCH_ITEMS.findIndex(item => item.value === current));
	const selector = makeSelectorModel<string, WebSearchAction>(WEB_SEARCH_ITEMS.map(item => item.value));
	return {
		selector: { ...selector, selectedId: WEB_SEARCH_ITEMS[index]?.value, selectedIndex: index },
		generation,
		sourceRevision: 0,
		requestGeneration: 0,
		availability: {},
		status: [],
	};
}

function webSearchText(message: MvuEnvelope): string | undefined {
	const event = message.event;
	if (event._tag === "Paste") return event.text;
	if (event._tag !== "Press") return undefined;
	return event.text ?? String(event.key);
}

function readinessTransition(model: WebSearchModel): Transition<WebSearchModel, WebSearchCommand> {
	const selected = model.selector.selectedId;
	const requestGeneration = model.requestGeneration + 1;
	if (selected === undefined || selected === "auto" || !isSearchProviderId(selected)) {
		return { model: { ...model, requestGeneration, status: [] }, commands: [], dirtyKeys: new Set(["setup.providers.web-search"]) };
	}
	const providerId = selected;
	const next = {
		...model,
		requestGeneration,
		availability: { ...model.availability, [providerId]: "checking" as const },
		status: [],
	};
	return {
		model: next,
		commands: [{ _tag: "CheckWebSearchReadiness", model: next, providerId }],
		dirtyKeys: new Set(["setup.providers.web-search", "setup.providers.readiness"]),
	};
}

export function updateWebSearch(model: WebSearchModel, message: WebSearchMessage): Transition<WebSearchModel, WebSearchCommand> {
	if (message._tag === "WebSearchActivated") {
		return readinessTransition({ ...model, sourceRevision: model.sourceRevision + 1, availability: {}, status: [] });
	}
	if (message._tag === "WebSearchReadinessSettled") {
		if (message.generation !== model.generation || message.sourceRevision !== model.sourceRevision || message.requestGeneration !== model.requestGeneration || model.selector.selectedId !== message.providerId) return { model, commands: [], dirtyKeys: new Set() };
		return {
			model: { ...model, availability: { ...model.availability, [message.providerId]: message.ready } },
			commands: [],
			dirtyKeys: new Set(["setup.providers.readiness"]),
		};
	}
	if (message._tag === "WebSearchApplySettled") {
		if (message.generation !== model.generation || message.sourceRevision !== model.sourceRevision || message.requestGeneration !== model.requestGeneration || model.selector.selectedId !== message.value) return { model, commands: [], dirtyKeys: new Set() };
		if (message.error !== undefined) return { model: { ...model, status: [`Failed to save: ${message.error}`] }, commands: [], dirtyKeys: new Set(["setup.providers.web-search"]) };
		const label = WEB_SEARCH_ITEMS.find(item => item.value === message.value)?.label ?? message.value;
		const unavailable = message.value !== "auto" && model.availability[message.value] === false;
		return {
			model: {
				...model,
				status: [
					`${theme.status.success} Web search set to ${label}`,
					...(unavailable ? ["Not configured yet — add its API key or sign in to enable it."] : []),
				],
			},
			commands: [],
			dirtyKeys: new Set(["setup.providers.web-search"]),
		};
	}
	const text = webSearchText(message);
	if (message.action === "ui.dismiss") return { model, commands: [{ _tag: "WebSearchFinish", result: "skipped" }], dirtyKeys: new Set() };
	let next = model;
	const indexed = /^setup\.select\.index:(\d+)$/.exec(String(message.action));
	if (indexed !== null) {
		const target = Math.max(0, Math.min(Number(indexed[1]), WEB_SEARCH_ITEMS.length - 1));
		const current = model.selector.selectedId === undefined ? 0 : Math.max(0, model.selector.filteredIds.indexOf(model.selector.selectedId));
		let selector = model.selector;
		const direction = target < current ? -1 : 1;
		for (let remaining = Math.abs(target - current); remaining > 0; remaining -= 1) selector = updateSelector(selector, { _tag: "Move", delta: direction }).model;
		next = { ...model, selector };
	}
	if (message.action === "tui.select.up" || message.action === "tui.select.down") {
		next = { ...model, selector: updateSelector(model.selector, { _tag: "Move", delta: message.action === "tui.select.up" ? -1 : 1 }).model };
	} else if (text !== undefined && text >= "1" && text <= "9") {
		const target = Math.max(0, Math.min(Number(text) - 1, WEB_SEARCH_ITEMS.length - 1));
		const current = model.selector.selectedId === undefined ? 0 : Math.max(0, model.selector.filteredIds.indexOf(model.selector.selectedId));
		let selector = model.selector;
		const direction = target < current ? -1 : 1;
		for (let remaining = Math.abs(target - current); remaining > 0; remaining -= 1) selector = updateSelector(selector, { _tag: "Move", delta: direction }).model;
		next = { ...model, selector };
	}
	if (next !== model) return readinessTransition(next);
	if (message.action !== "tui.select.confirm") return { model, commands: [], dirtyKeys: new Set() };
	const value = model.selector.selectedId;
	if (value === undefined || !isSearchProviderPreference(value)) return { model, commands: [], dirtyKeys: new Set() };
	const commandModel = { ...model, requestGeneration: model.requestGeneration + 1 };
	return { model: commandModel, commands: [{ _tag: "ApplyWebSearch", model: commandModel, value }], dirtyKeys: new Set(["setup.providers.web-search"]) };
}

export class WebSearchTab {
	readonly id = "web-search";
	readonly label = "Web search";
	readonly modal = false;
	#projection: WebSearchModel;
	readonly #list = new SelectList(WEB_SEARCH_ITEMS, MAX_VISIBLE, getSelectListTheme());
	#listRowStart = 0;

	constructor(readonly host: SetupSceneHost) {
		this.#projection = makeWebSearchModel(host.ctx.settings.get("providers.webSearch"), 0);
		this.apply(this.#projection);
	}

	apply(model: WebSearchModel): void {
		this.#projection = model;
		const selected = model.selector.selectedId;
		this.#list.setSelectedIndex(selected === undefined ? 0 : Math.max(0, model.selector.filteredIds.indexOf(selected)));
	}
	invalidate(): void { this.#list.invalidate(); }
	hitTest(line: number): number | undefined { return this.#list.hitTest(line - this.#listRowStart); }
	render(width: number): readonly string[] {
		const model = this.#projection;
		const lines = [theme.fg("muted", "Choose the provider the web_search tool should prefer."), ""];
		this.#listRowStart = lines.length;
		lines.push(...this.#list.render(width));
		const selected = model.selector.selectedId;
		if (selected !== undefined) {
			lines.push("");
			if (selected === "auto") lines.push(theme.fg("dim", "Automatically uses the first configured provider."));
			else if (isSearchProviderId(selected)) {
				const state = model.availability[selected];
				if (state === undefined || state === "checking") lines.push(theme.fg("dim", "Checking availability…"));
				else if (state) lines.push(theme.fg("success", `${theme.status.success} Ready to use`));
				else lines.push(theme.fg("warning", `${theme.status.pending} Needs credentials`));
			}
		}
		if (model.status.length > 0) lines.push("", ...model.status.map(line => truncateToWidth(line, width)));
		return lines;
	}
}
