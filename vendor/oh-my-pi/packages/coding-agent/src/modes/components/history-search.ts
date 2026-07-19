import { Container, Ellipsis, padding, truncateToWidth, type Keybinding, Spacer, Text, visibleWidth } from "@oh-my-pi/pi-tui";
import * as Schema from "effect/Schema";
import type { HistoryEntry, HistoryStorage } from "../../session/history-storage";
import { makeComponentId } from "../mvu/schema";
import { theme } from "../../modes/theme/theme";
import { DynamicBorder } from "./dynamic-border";
import { keyHint, rawKeyHint } from "./keybinding-hints";
import { SelectorSurface, type SelectorSurfaceMountSpec } from "./selector-adapter";

const MAX_RESULTS = 100;
const HistoryEntrySchema = Schema.Struct({
	id: Schema.Number,
	prompt: Schema.String,
	created_at: Schema.Number,
	cwd: Schema.optional(Schema.String),
	sessionId: Schema.optional(Schema.String),
});
const HistoryEntriesFromJsonSchema = Schema.fromJsonString(Schema.Array(HistoryEntrySchema));

function queryTokens(query: string): string[] {
	return query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 0);
}

function highlightTokens(text: string, tokens: string[]): string {
	if (tokens.length === 0) return text;
	const lower = text.toLowerCase();
	const ranges: Array<[number, number]> = [];
	for (const token of tokens) {
		let start = 0;
		while (start < lower.length) {
			const index = lower.indexOf(token, start);
			if (index < 0) break;
			ranges.push([index, index + token.length]);
			start = index + token.length;
		}
	}
	if (ranges.length === 0) return text;
	ranges.sort((left, right) => left[0] - right[0]);
	let output = "";
	let position = 0;
	for (const [start, end] of ranges) {
		if (start < position) continue;
		output += text.slice(position, start) + theme.fg("accent", text.slice(start, end));
		position = end;
	}
	return output + text.slice(position);
}

function relativeTime(epochSeconds: number): string {
	const seconds = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
	if (seconds < 60) return "now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	if (days < 30) return `${Math.floor(days / 7)}w`;
	if (days < 365) return `${Math.floor(days / 30)}mo`;
	return `${Math.floor(days / 365)}y`;
}

export class HistorySearchComponent extends Container {
	readonly #surface: SelectorSurface<number, HistoryEntry>;

	constructor(
		historyStorage: HistoryStorage,
		onSelect: (prompt: string) => void,
		onCancel: () => void,
		initialQuery = "",
	) {
		super();
		const initialEntries = initialQuery.trim() ? historyStorage.search(initialQuery.trim(), MAX_RESULTS) : historyStorage.getRecent(MAX_RESULTS);
		this.#surface = new SelectorSurface<number, HistoryEntry, Keybinding>({
			componentId: makeComponentId("history-search"),
			items: initialEntries,
			keyOf: entry => entry.id,
			searchText: entry => entry.prompt,
			initialQuery: initialQuery.trim(),
			renderRow: (entry, context, width) => {
				const tokens = queryTokens(context.query);
				const time = relativeTime(entry.created_at);
				const cursor = context.selected ? theme.fg("accent", `${theme.nav.cursor} `) : "  ";
				const rowWidth = Math.max(0, width - visibleWidth(time) - 1);
				const prompt = truncateToWidth(entry.prompt.replace(/\s+/g, " ").trim(), Math.max(4, rowWidth - 2));
				const line = `${cursor}${context.selected ? theme.bold(highlightTokens(prompt, tokens)) : highlightTokens(prompt, tokens)}`;
				const content = truncateToWidth(`${line} ${theme.fg("dim", time)}`, width, Ellipsis.Omit);
				const row = `${content}${padding(width - visibleWidth(content))}`;
				return [context.selected ? theme.bg("selectedBg", row) : row];
			},
			renderEmpty: query => [theme.fg("muted", query ? "  No matching history" : "  No history yet")],
			onSelect: entry => onSelect(entry.prompt),
			onCancel,
			onFilterChanged: query => query.trim() ? historyStorage.search(query.trim(), MAX_RESULTS) : historyStorage.getRecent(MAX_RESULTS),
			encodeItems: entries => JSON.stringify(entries),
			decodeItems: encoded => Schema.decodeSync(HistoryEntriesFromJsonSchema)(encoded, { onExcessProperty: "error" }),
			viewportSize: 10,
			closeOnFilterDismiss: true,
		});
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold(theme.fg("accent", `${theme.icon.rewind} Search History`)), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(this.#surface);
		this.addChild(new Spacer(1));
		this.addChild(new Text([rawKeyHint("↑↓", "navigate"), rawKeyHint("enter", "select"), keyHint("ui.dismiss", "cancel")].join(theme.fg("dim", theme.sep.dot)), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
	}

	get mountSpec(): SelectorSurfaceMountSpec<number, HistoryEntry> {
		return this.#surface.mountSpec;
	}
}

