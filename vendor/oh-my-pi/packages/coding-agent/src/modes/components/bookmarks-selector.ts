import { Container, truncateToWidth, type Keybinding, Spacer, Text } from "@oh-my-pi/pi-tui";
import type { BookmarkRecord } from "../../session/bookmarks";
import { makeComponentId } from "../mvu/schema";
import { theme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";
import { SelectorSurface, type SelectorSurfaceMountSpec } from "./selector-adapter";

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
	readonly #surface: SelectorSurface<string, BookmarkRecord>;

	constructor(
		entries: ReadonlyArray<BookmarkRecord>,
		onJump: (record: BookmarkRecord) => void,
		onDismiss: () => void,
		options: BookmarksSelectorOptions = {},
	) {
		super();
		const now = options.now?.() ?? Date.now();
		this.#surface = new SelectorSurface<string, BookmarkRecord, Keybinding>({
			componentId: makeComponentId("bookmarks-selector"),
			items: entries,
			keyOf: record => record.id,
			searchText: record => `${record.target.title} ${record.target.sessionId} ${record.tag ?? ""} ${record.note ?? ""}`,
			renderRow: (record, context, width) => {
				const cursor = context.selected ? theme.fg("accent", `${theme.nav.cursor} `) : "  ";
				const label = formatBookmarkLabel(record, now);
				const description = theme.fg("dim", formatBookmarkDescription(record));
				return [
					truncateToWidth(cursor + (context.selected ? theme.bold(label) : label), width),
					truncateToWidth(`  ${description}`, width),
				];
			},
			renderEmpty: () => [theme.fg("muted", "  No bookmarks")],
			onSelect: onJump,
			onCancel: onDismiss,
			viewportSize: 12,
		});
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(new Text(theme.bold("Bookmarks"), 1, 0));
		this.addChild(this.#surface);
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(new Spacer(1));
	}
	get mountSpec(): SelectorSurfaceMountSpec<string, BookmarkRecord> {
		return this.#surface.mountSpec;
	}
}

