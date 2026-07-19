import {
	type Component,
	padding,
	replaceTabs,
	ScrollView,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import { Effect, type Scope } from "effect";
import { theme } from "../theme/theme";
import type {
	PreviewRevision,
	RevisionedPreviewDescriptor,
	TablePreviewPatch,
	TablePreviewRendererOptions,
	ViewKey,
} from "../mvu/renderer-adapter";

export type {
	TablePreviewEmptyContext,
	TablePreviewFocus,
	TablePreviewLayout,
	TablePreviewPatch,
	TablePreviewRendererOptions,
	TablePreviewRowRenderContext,
	PreviewRevision,
	RevisionedPreviewDescriptor,
	TablePreviewSectionContext,
	ViewKey,
} from "../mvu/renderer-adapter";


interface CachedRow<Row> {
	readonly row: Row;
	readonly selected: boolean;
	readonly focused: boolean;
	readonly width: number;
	readonly line: string;
}

interface CachedPreview<Preview> {
	readonly value: Preview;
	readonly revision: PreviewRevision;
	readonly width: number;
	readonly height: number;
	readonly lines: readonly string[];
}

interface CachedRender<Row, Key, Preview> {
	readonly patch: TablePreviewPatch<Row, Key, Preview> | undefined;
	readonly layout: "columns" | "stacked";
	readonly width: number;
	readonly height: number;
	readonly lines: readonly string[];
}

function containsDirtyKey<Key>(dirtyKeys: ReadonlySet<ViewKey>, key: Key): boolean {
	for (const dirtyKey of dirtyKeys) {
		if (Object.is(dirtyKey, key)) return true;
	}
	return false;
}

/**
 * Long-lived pi-tui renderer for a keyed table and preview projection.
 *
 * All selection, filtering, focus, offsets, and preview loading belong to the
 * route reducer/runtime. This component accepts only committed patches and
 * synchronously maps them to physical rows. A mount Scope owns renderer
 * teardown; it never receives terminal input or invokes domain actions.
 */
export class TablePreviewComponent<Row, Key, Preview = string> implements Component {
	readonly #options: TablePreviewRendererOptions<Row, Key, Preview>;
	#patch: TablePreviewPatch<Row, Key, Preview> | undefined;
	#rowCache = new Map<Key, CachedRow<Row>>();
	#previewCache: CachedPreview<Preview> | undefined;
	#cachedRender: CachedRender<Row, Key, Preview> | undefined;
	#disposed = false;

	private constructor(options: TablePreviewRendererOptions<Row, Key, Preview>) {
		this.#options = options;
	}

	static mount<Row, Key, Preview>(
		options: TablePreviewRendererOptions<Row, Key, Preview>,
	): Effect.Effect<TablePreviewComponent<Row, Key, Preview>, never, Scope.Scope> {
		return Effect.acquireRelease(
			Effect.sync(() => new TablePreviewComponent<Row, Key, Preview>(options)),
			component => Effect.promise(() => component.#dispose()),
		);
	}

	apply(patch: TablePreviewPatch<Row, Key, Preview>): void {
		if (this.#disposed || this.#patch === patch) return;
		this.#patch = patch;
		const visibleKeys = new Set<Key>();
		for (const entry of patch.visibleRows) visibleKeys.add(entry.key);
		for (const key of this.#rowCache.keys()) {
			if (!visibleKeys.has(key)) this.#rowCache.delete(key);
		}
		this.#cachedRender = undefined;
		this.#options.requestComponentRender(this);
	}

	render(width: number): readonly string[] {
		const renderWidth = Math.max(1, width);
		const renderHeight = Math.max(1, this.#options.height());
		const layout = this.#options.layout ?? "stacked";
		const patch = this.#patch;
		const cached = this.#cachedRender;
		if (
			cached &&
			cached.patch === patch &&
			cached.layout === layout &&
			cached.width === renderWidth &&
			cached.height === renderHeight
		) {
			return cached.lines;
		}
		if (!patch) {
			const lines = this.#fit([], renderWidth, renderHeight);
			this.#cachedRender = {
				patch: undefined,
				layout,
				width: renderWidth,
				height: renderHeight,
				lines,
			};
			return lines;
		}

		const lines = layout === "columns"
			? this.#renderColumns(patch, renderWidth, renderHeight)
			: this.#renderStacked(patch, renderWidth, renderHeight);
		this.#cachedRender = {
			patch,
			layout,
			width: renderWidth,
			height: renderHeight,
			lines,
		};
		return lines;
	}


	invalidate(): void {
		this.#cachedRender = undefined;
		this.#rowCache.clear();
		this.#previewCache = undefined;
	}

	dispose(): void {
		void this.#dispose();
	}

	#renderColumns(
		patch: TablePreviewPatch<Row, Key, Preview>,
		width: number,
		height: number,
	): readonly string[] {
		const ratio = Math.max(0.25, Math.min(0.75, this.#options.tableRatio ?? 0.5));
		const tableWidth = Math.max(1, Math.floor(width * ratio));
		const previewWidth = Math.max(1, width - tableWidth - 3);
		const table = this.#renderTable(patch, tableWidth, height);
		const preview = this.#renderPreview(patch.preview, previewWidth, height);
		const separator = theme.fg("dim", ` ${theme.boxSharp.vertical} `);
		const output: string[] = [];
		for (let index = 0; index < height; index++) {
			const left = truncateToWidth(replaceTabs(table[index] ?? ""), tableWidth);
			const padded = left + padding(Math.max(0, tableWidth - visibleWidth(left)));
			output.push(padded + separator + truncateToWidth(replaceTabs(preview[index] ?? ""), previewWidth));
		}
		return output;
	}

	#renderStacked(
		patch: TablePreviewPatch<Row, Key, Preview>,
		width: number,
		height: number,
	): readonly string[] {
		const configuredTableHeight = this.#options.tableHeight?.();
		const tableHeight = Math.max(
			1,
			Math.min(height, configuredTableHeight ?? Math.max(1, Math.floor(height / 2))),
		);
		const previewHeight = Math.max(1, height - tableHeight);
		return [
			...this.#renderPreview(patch.preview, width, previewHeight),
			...(this.#options.betweenPanes?.(width) ?? []),
			...this.#renderTable(patch, width, tableHeight),
		].slice(0, height);
	}

	#renderTable(patch: TablePreviewPatch<Row, Key, Preview>, width: number, height: number): readonly string[] {
		const lines: string[] = [];
		const focused = patch.focus === "table";
		const showHeader = this.#options.showTableHeader !== false;
		if (showHeader) {
			const label = focused ? theme.bold(theme.fg("accent", "Table")) : theme.fg("muted", "Table");
			const query = patch.query || theme.fg("dim", "type to filter");
			lines.push(`${label} ${theme.fg("muted", "Search:")} ${query}`);
			// Keep actionable status separate from the filter query so truncation cannot hide it.
		}
		if (patch.status) {
			lines.push(...wrapTextWithAnsi(theme.fg("muted", patch.status.label), Math.max(1, width)));
		}
		if (showHeader) lines.push("");
		if (patch.visibleRows.length === 0) {
			lines.push(
				...(this.#options.renderEmpty?.({ query: patch.query ?? "", width }) ?? [
					theme.fg("muted", this.#options.emptyMessage ?? "No rows"),
				]),
			);
			return this.#options.fitTableHeight === false ? lines : this.#fit(lines, width, height);
		}

		const rowBudget = Math.max(1, height - lines.length);
		const overflow = patch.visibleRows.length > rowBudget;
		const showScrollbar = this.#options.showTableScrollbar !== false;
		const rowWidth = Math.max(0, width - (overflow && showScrollbar ? 1 : 0));
		const rows: string[] = [];
		const end = Math.min(rowBudget, patch.visibleRows.length);
		for (let index = 0; index < end; index++) {
			const entry = patch.visibleRows[index]!;
			const section = this.#options.sectionLabel?.(entry.row, {
				index,
				firstVisible: index === 0,
				width: rowWidth,
			});
			if (section) rows.push(this.#options.renderSectionLabel?.(section, rowWidth) ?? section);
			const selected = Object.is(entry.key, patch.selectedKey);
			const line = this.#rowLine(entry.key, entry.row, selected, focused, rowWidth, patch.dirtyKeys);
			rows.push(line);
		}
		if (end < patch.visibleRows.length && this.#options.renderOverflow) {
			rows.push(this.#options.renderOverflow(patch.visibleRows.length - end, rowWidth));
		}
		if (showScrollbar && patch.visibleRows.length > rowBudget) {
			const scroll = new ScrollView(rows, {
				height: rows.length,
				scrollbar: "auto",
				totalRows: patch.visibleRows.length,
				theme: { track: text => theme.fg("muted", text), thumb: text => theme.fg("accent", text) },
			});
			lines.push(...scroll.render(width));
		} else {
			lines.push(...rows);
		}
		return this.#options.fitTableHeight === false ? lines : this.#fit(lines, width, height);
	}

	#rowLine(
		key: Key,
		row: Row,
		selected: boolean,
		focused: boolean,
		width: number,
		dirtyKeys: ReadonlySet<ViewKey>,
	): string {
		const cached = this.#rowCache.get(key);
		const dirty = containsDirtyKey(dirtyKeys, key);
		if (
			cached &&
			!dirty &&
			Object.is(cached.row, row) &&
			cached.selected === selected &&
			cached.focused === focused &&
			cached.width === width
		) {
			return cached.line;
		}
		let line = replaceTabs(this.#options.renderRow(row, { selected, focused, width }));
		if (selected && this.#options.decorateSelectedRow !== false) {
			line = theme.bg("selectedBg", theme.bold(theme.fg(focused ? "accent" : "muted", line)));
		}
		line = truncateToWidth(line, width);
		this.#rowCache.set(key, { row, selected, focused, width, line });
		return line;
	}

	#renderPreview(
		descriptor: RevisionedPreviewDescriptor<Preview>,
		width: number,
		height: number,
	): readonly string[] {
		const cached = this.#previewCache;
		if (
			cached &&
			Object.is(cached.value, descriptor.value) &&
			Object.is(cached.revision, descriptor.revision) &&
			cached.width === width &&
			cached.height === height
		) {
			return cached.lines;
		}
		const lines = this.#fit(this.#options.renderPreview(descriptor.value, width, height), width, height);
		this.#previewCache = {
			value: descriptor.value,
			revision: descriptor.revision,
			width,
			height,
			lines,
		};
		return lines;
	}

	#fit(lines: readonly string[], width: number, height: number): readonly string[] {
		const output: string[] = [];
		for (let index = 0; index < height; index++) {
			output.push(truncateToWidth(replaceTabs(lines[index] ?? ""), width));
		}
		return output;
	}

	async #dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#patch = undefined;
		this.#rowCache.clear();
		this.#previewCache = undefined;
		this.#cachedRender = undefined;
		await this.#options.dispose?.();
	}
}
