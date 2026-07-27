import { Container, type SelectItem, SelectList, Spacer, Text } from "@oh-my-pi/pi-tui";
import type { BookmarkRecord } from "../../session/bookmarks";
import { getSelectListTheme, theme } from "../theme/theme";
import { matchesUiDismiss } from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";
import { keyHint } from "./keybinding-hints";

export interface BookmarksSelectorOptions {
	readonly now?: () => number;
}

function formatAge(createdAt: string, now: number): string {
	const elapsed = Math.max(0, now - Date.parse(createdAt));
	if (elapsed < 60_000) return "just now";
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
	if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
	return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

export function formatBookmarkLabel(record: BookmarkRecord, now = Date.now()): string {
	const tag = record.tag ? ` [${record.tag}]` : "";
	return `${record.target.title}${tag} · ${formatAge(record.createdAt, now)}`;
}

export function formatBookmarkDescription(record: BookmarkRecord): string {
	const origin = `origin: ${record.target.sessionId}`;
	return record.note ? `${origin} · ${record.note}` : origin;
}

export class BookmarksSelectorComponent extends Container {
	readonly #selectList: SelectList;
	readonly #onDismiss: () => void;

	constructor(
		entries: ReadonlyArray<BookmarkRecord>,
		onJump: (record: BookmarkRecord) => void,
		onDismiss: () => void,
		options: BookmarksSelectorOptions = {},
	) {
		super();
		this.#onDismiss = onDismiss;
		const byId = new Map(entries.map(record => [record.id, record]));
		const now = options.now?.() ?? Date.now();
		const items: SelectItem[] = entries.map(record => ({
			value: record.id,
			label: formatBookmarkLabel(record, now),
			description: formatBookmarkDescription(record),
		}));
		if (items.length === 0) items.push({ value: "none", label: "No bookmarks" });

		this.#selectList = new SelectList(items, Math.min(items.length, 12), getSelectListTheme());
		this.#selectList.onSelect = item => {
			const record = byId.get(item.value);
			if (record) onJump(record);
		};

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(
			new Text(theme.bold("Bookmarks") + theme.fg("dim", "  Enter jump · ") + keyHint("ui.dismiss", "close"), 1, 0),
		);
		this.addChild(this.#selectList);
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(new Spacer(1));
	}

	handleInput(data: string): void {
		if (matchesUiDismiss(data)) {
			this.#onDismiss();
			return;
		}
		this.#selectList.handleInput(data);
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}
}
