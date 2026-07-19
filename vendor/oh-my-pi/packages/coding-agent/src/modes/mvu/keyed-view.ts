import type { StatusProjection } from "./status";
import type { ViewKey } from "./schema";

export interface Viewport {
	readonly offset: number;
	readonly height: number;
}

export interface KeyedRow<Id, Row> {
	readonly key: Id;
	readonly row: Row;
}

export type ViewFocus = "table" | "preview";

export interface PreviewProjection<Preview> {
	readonly lines: (preview: Preview, viewport: Viewport) => readonly string[];
	readonly value?: Preview;
}

export interface KeyedSelectorView<Id, Row, Preview> {
	readonly visibleRows: readonly KeyedRow<Id, Row>[];
	readonly selectedKey?: Id;
	readonly focus: ViewFocus;
	readonly query?: string;
	readonly status?: StatusProjection;
	readonly preview: Preview;
	readonly previewLines: readonly string[];
	readonly dirtyKeys: ReadonlySet<ViewKey>;
}

export interface KeyedTreeView<Id, Row> {
	readonly visibleRows: readonly KeyedRow<Id, Row>[];
	readonly selectedKey?: Id;
	readonly dirtyKeys: ReadonlySet<ViewKey>;
}

export function visibleKeyedRows<Id, Row>(
	ids: readonly Id[],
	rows: ReadonlyMap<Id, Row>,
	viewport: Viewport,
): readonly KeyedRow<Id, Row>[] {
	const offset = Math.max(0, Math.min(viewport.offset, ids.length));
	const end = Math.min(ids.length, offset + Math.max(0, viewport.height));
	const result: KeyedRow<Id, Row>[] = [];
	for (let index = offset; index < end; index += 1) {
		const id = ids[index];
		if (id === undefined) continue;
		const row = rows.get(id);
		if (row !== undefined) result.push({ key: id, row });
	}
	return result;
}

export function dirtyKeySet<Id, Row, Preview>(
	previous: KeyedSelectorView<Id, Row, Preview> | undefined,
	next: KeyedSelectorView<Id, Row, Preview>,
): ReadonlySet<ViewKey> {
	if (previous === undefined) return new Set<ViewKey>(next.visibleRows.map(item => String(item.key)));
	const dirty = new Set<ViewKey>();
	const previousRows = new Map(previous.visibleRows.map(item => [String(item.key), item.row]));
	const nextRows = new Map(next.visibleRows.map(item => [String(item.key), item.row]));
	for (const [key, row] of nextRows) {
		if (previousRows.get(key) !== row) dirty.add(key);
	}
	for (const key of previousRows.keys()) {
		if (!nextRows.has(key)) dirty.add(key);
	}
	if (previous.selectedKey !== next.selectedKey) {
		if (previous.selectedKey !== undefined) dirty.add(String(previous.selectedKey));
		if (next.selectedKey !== undefined) dirty.add(String(next.selectedKey));
	}
	if (previous.query !== next.query) dirty.add("search");
	if (previous.status !== next.status) dirty.add("status");
	if (previous.focus !== next.focus) dirty.add("focus");
	if (previous.preview !== next.preview || previous.previewLines !== next.previewLines) dirty.add("preview");
	return dirty;
}

export function patchKeyedSelectorView<Id, Row, Preview>(
	previous: KeyedSelectorView<Id, Row, Preview> | undefined,
	next: Omit<KeyedSelectorView<Id, Row, Preview>, "dirtyKeys">,
): KeyedSelectorView<Id, Row, Preview> {
	const view: KeyedSelectorView<Id, Row, Preview> = {
		...next,
		dirtyKeys: new Set(),
	};
	return {
		...view,
		dirtyKeys: dirtyKeySet(previous, view),
	};
}

export function patchNavigation<Id, Row, Preview>(
	previous: KeyedSelectorView<Id, Row, Preview>,
	nextVisibleRows: readonly KeyedRow<Id, Row>[],
	nextSelectedKey: Id | undefined,
	nextPreview: Preview,
	nextPreviewLines: readonly string[],
): KeyedSelectorView<Id, Row, Preview> {
	const next: Omit<KeyedSelectorView<Id, Row, Preview>, "dirtyKeys"> = {
		visibleRows: nextVisibleRows,
		selectedKey: nextSelectedKey,
		focus: previous.focus,
		query: previous.query,
		status: previous.status,
		preview: nextPreview,
		previewLines: nextPreviewLines,
	};
	return patchKeyedSelectorView(previous, next);
}
