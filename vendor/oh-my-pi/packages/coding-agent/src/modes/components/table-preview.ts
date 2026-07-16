import {
	type Component,
	extractPrintableText,
	matchesKey,
	padding,
	ScrollView,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import { Effect, type Scope } from "effect";
import { theme } from "../theme/theme";
import {
	matchesNavigationDown,
	matchesNavigationUp,
	matchesSelectDown,
	matchesSelectUp,
	matchesUiDismiss,
} from "../utils/keybinding-matchers";

export type TablePreviewFocus = "table" | "preview";
export type TablePreviewLayout = "columns" | "stacked";

export interface TablePreviewSession {
	render(width: number, height: number): readonly string[];
	handleInput?(data: string): boolean;
	dispose?(): void | Promise<void>;
}

export interface TablePreviewProvider<Row> {
	open(row: Row): TablePreviewSession | Promise<TablePreviewSession>;
	dispose?(): void | Promise<void>;
}

export interface TablePreviewRowRenderContext {
	readonly selected: boolean;
	readonly focused: boolean;
	readonly width: number;
}

export interface TablePreviewKeyContext<Row> {
	readonly focus: TablePreviewFocus;
	readonly selected: Row | undefined;
}

export interface TablePreviewOptions<Row, Key> {
	readonly rows: () => readonly Row[];
	readonly keyOf: (row: Row) => Key;
	readonly renderRow: (row: Row, context: TablePreviewRowRenderContext) => string;
	readonly preview: TablePreviewProvider<Row>;
	readonly height: () => number;
	readonly requestRender: () => void;
	readonly onClose: () => void;
	readonly flush?: () => void;
	readonly matchesRow?: (row: Row, query: string) => boolean;
	readonly searchText?: (row: Row) => string;
	readonly onSelectionChange?: (row: Row | undefined) => void;
	readonly handleKey?: (data: string, context: TablePreviewKeyContext<Row>) => boolean;
	readonly layout?: TablePreviewLayout;
	readonly tableRatio?: number;
	readonly emptyMessage?: string;
	readonly previewEmptyMessage?: string;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return typeof value === "object" && value !== null && "then" in value;
}

/**
 * A keyed table and selection-driven preview surface.
 *
 * Mount this component inside an Effect Scope. Closing the Scope disposes the
 * active preview before the provider, so subscriptions and timers cannot
 * outlive the overlay that owns them.
 */
export class TablePreviewComponent<Row, Key> implements Component {
	readonly #options: TablePreviewOptions<Row, Key>;
	#rows: readonly Row[] = [];
	#selectedIndex = 0;
	#selectedKey: Key | undefined;
	#selectedRow: Row | undefined;
	#scrollOffset = 0;
	#previewOffset = 0;
	#query = "";
	#focus: TablePreviewFocus = "table";
	#previewSession: TablePreviewSession | undefined;
	#previewError: string | undefined;
	#previewGeneration = 0;
	#pendingTransitions = new Set<Promise<void>>();
	#disposed = false;

	private constructor(options: TablePreviewOptions<Row, Key>) {
		this.#options = options;
		this.#syncRows();
	}

	static mount<Row, Key>(
		options: TablePreviewOptions<Row, Key>,
	): Effect.Effect<TablePreviewComponent<Row, Key>, never, Scope.Scope> {
		return Effect.acquireRelease(
			Effect.sync(() => new TablePreviewComponent(options)),
			component => Effect.promise(() => component.#dispose()),
		);
	}

	get selected(): Row | undefined {
		this.#syncRows();
		return this.#selectedRow;
	}

	get selectedKey(): Key | undefined {
		this.#syncRows();
		return this.#selectedKey;
	}

	get searchQuery(): string {
		return this.#query;
	}

	get focus(): TablePreviewFocus {
		return this.#focus;
	}

	refresh(options: { resetSelection?: boolean; refreshPreview?: boolean } = {}): void {
		if (options.resetSelection) {
			this.#selectedIndex = 0;
			this.#selectedKey = undefined;
			this.#scrollOffset = 0;
		}
		this.#syncRows(options.refreshPreview ?? false);
		this.#options.requestRender();
	}

	clearSearch(): void {
		if (!this.#query) return;
		this.#query = "";
		this.#syncRows();
		this.#options.requestRender();
	}

	selectKey(key: Key): boolean {
		this.#syncRows();
		const index = this.#rows.findIndex(row => Object.is(this.#options.keyOf(row), key));
		if (index < 0) return false;
		this.#selectIndex(index);
		return true;
	}

	render(width: number): readonly string[] {
		this.#syncRows();
		const height = Math.max(1, this.#options.height());
		return (this.#options.layout ?? "stacked") === "columns"
			? this.#renderColumns(width, height)
			: this.#renderStacked(width, height);
	}

	handleInput(data: string): void {
		if (this.#disposed) return;
		this.#syncRows();

		if (matchesUiDismiss(data)) {
			if (this.#query) {
				this.clearSearch();
			} else {
				this.#options.onClose();
			}
			return;
		}

		if (matchesKey(data, "ctrl+w")) {
			this.#focus = this.#focus === "table" ? "preview" : "table";
			this.#options.requestRender();
			return;
		}

		if (this.#focus === "preview") {
			if (this.#previewSession?.handleInput?.(data)) return;
			if (matchesNavigationUp(data) || matchesSelectUp(data)) {
				this.#previewOffset = Math.max(0, this.#previewOffset - 1);
				this.#options.requestRender();
				return;
			}
			if (matchesNavigationDown(data) || matchesSelectDown(data)) {
				this.#previewOffset += 1;
				this.#options.requestRender();
				return;
			}
		}

		if (this.#focus === "table") {
			if (matchesNavigationUp(data) || matchesSelectUp(data)) {
				this.#moveSelection(-1);
				return;
			}
			if (matchesNavigationDown(data) || matchesSelectDown(data)) {
				this.#moveSelection(1);
				return;
			}
			if (matchesKey(data, "home")) {
				this.#selectIndex(0);
				return;
			}
			if (matchesKey(data, "end")) {
				this.#selectIndex(this.#rows.length - 1);
				return;
			}
		}

		if (this.#options.handleKey?.(data, { focus: this.#focus, selected: this.#selectedRow })) return;

		if (this.#focus !== "table") return;
		if (matchesKey(data, "backspace")) {
			if (this.#query) {
				this.#query = this.#query.slice(0, -1);
				this.#syncRows();
				this.#options.requestRender();
			}
			return;
		}

		const printable = extractPrintableText(data);
		if (!printable || printable.length !== 1 || printable === "j" || printable === "k") return;
		const code = printable.charCodeAt(0);
		if (code <= 32 || code >= 127) return;
		this.#query += printable;
		this.#syncRows();
		this.#options.requestRender();
	}

	invalidate(): void {}

	async whenPreviewSettled(): Promise<void> {
		while (this.#pendingTransitions.size > 0) {
			await Promise.all([...this.#pendingTransitions]);
		}
	}

	#syncRows(refreshPreview = false): void {
		if (this.#disposed) return;
		this.#options.flush?.();
		const source = this.#options.rows();
		const query = this.#query.trim();
		if (!query) {
			this.#rows = source;
		} else if (this.#options.matchesRow) {
			this.#rows = source.filter(row => this.#options.matchesRow?.(row, query));
		} else {
			const needle = query.toLowerCase();
			this.#rows = source.filter(row => (this.#options.searchText?.(row) ?? "").toLowerCase().includes(needle));
		}

		let nextIndex = -1;
		if (this.#selectedKey !== undefined) {
			nextIndex = this.#rows.findIndex(row => Object.is(this.#options.keyOf(row), this.#selectedKey));
		}
		if (nextIndex < 0 && this.#rows.length > 0) {
			nextIndex = Math.min(this.#selectedIndex, this.#rows.length - 1);
		}
		this.#selectedIndex = Math.max(0, nextIndex);
		const nextRow = nextIndex >= 0 ? this.#rows[nextIndex] : undefined;
		const nextKey = nextRow === undefined ? undefined : this.#options.keyOf(nextRow);
		const changed = !Object.is(nextKey, this.#selectedKey) || nextRow !== this.#selectedRow;
		this.#selectedKey = nextKey;
		this.#selectedRow = nextRow;
		this.#clampScroll();
		if (changed || refreshPreview) this.#selectionChanged();
	}

	#moveSelection(delta: -1 | 1): void {
		if (this.#rows.length === 0) return;
		this.#selectIndex(this.#selectedIndex + delta);
	}

	#selectIndex(index: number): void {
		if (this.#rows.length === 0) return;
		const nextIndex = Math.max(0, Math.min(this.#rows.length - 1, index));
		if (nextIndex === this.#selectedIndex && this.#selectedRow === this.#rows[nextIndex]) return;
		this.#selectedIndex = nextIndex;
		this.#selectedRow = this.#rows[nextIndex];
		this.#selectedKey = this.#options.keyOf(this.#selectedRow);
		this.#previewOffset = 0;
		this.#clampScroll();
		this.#selectionChanged();
		this.#options.requestRender();
	}

	#selectionChanged(): void {
		this.#previewOffset = 0;
		this.#options.onSelectionChange?.(this.#selectedRow);
		this.#replacePreview(this.#selectedRow);
	}

	#replacePreview(row: Row | undefined): void {
		const generation = ++this.#previewGeneration;
		const previous = this.#previewSession;
		this.#previewSession = undefined;
		this.#previewError = undefined;

		const open = (): void => {
			if (this.#disposed || generation !== this.#previewGeneration || row === undefined) return;
			try {
				const opened = this.#options.preview.open(row);
				if (isPromiseLike(opened)) {
					this.#trackTransition(
						Promise.resolve(opened).then(async session => {
							if (this.#disposed || generation !== this.#previewGeneration) {
								await session.dispose?.();
								return;
							}
							this.#previewSession = session;
							this.#options.requestRender();
						}),
					);
				} else {
					this.#previewSession = opened;
				}
			} catch (error) {
				this.#recordPreviewError(error, generation);
			}
		};

		try {
			const disposed = previous?.dispose?.();
			if (isPromiseLike(disposed)) {
				this.#trackTransition(Promise.resolve(disposed).then(open));
			} else {
				open();
			}
		} catch (error) {
			this.#recordPreviewError(error, generation);
		}
	}

	#trackTransition(promise: Promise<unknown>): void {
		const tracked = promise
			.catch(error => this.#recordPreviewError(error, this.#previewGeneration))
			.then(() => undefined);
		this.#pendingTransitions.add(tracked);
		void tracked.finally(() => this.#pendingTransitions.delete(tracked));
	}

	#recordPreviewError(error: unknown, generation: number): void {
		if (this.#disposed || generation !== this.#previewGeneration) return;
		this.#previewError = error instanceof Error ? error.message : String(error);
		this.#options.requestRender();
	}

	#clampScroll(): void {
		const visible = this.#tableRowBudget();
		if (this.#selectedIndex < this.#scrollOffset) {
			this.#scrollOffset = this.#selectedIndex;
		} else if (this.#selectedIndex >= this.#scrollOffset + visible) {
			this.#scrollOffset = this.#selectedIndex - visible + 1;
		}
		const maxOffset = Math.max(0, this.#rows.length - visible);
		this.#scrollOffset = Math.max(0, Math.min(this.#scrollOffset, maxOffset));
	}

	#tableRowBudget(): number {
		const height = Math.max(1, this.#options.height());
		const tableHeight =
			(this.#options.layout ?? "stacked") === "columns" ? height : Math.max(3, Math.floor(height / 2));
		return Math.max(1, tableHeight - 2);
	}

	#renderColumns(width: number, height: number): readonly string[] {
		const ratio = Math.max(0.25, Math.min(0.75, this.#options.tableRatio ?? 0.5));
		const tableWidth = Math.max(1, Math.floor(width * ratio));
		const previewWidth = Math.max(1, width - tableWidth - 3);
		const table = this.#renderTable(tableWidth, height);
		const preview = this.#renderPreview(previewWidth, height);
		const separator = theme.fg("dim", ` ${theme.boxSharp.vertical} `);
		const output: string[] = [];
		for (let index = 0; index < height; index++) {
			const left = truncateToWidth(table[index] ?? "", tableWidth);
			const padded = left + padding(Math.max(0, tableWidth - visibleWidth(left)));
			output.push(padded + separator + truncateToWidth(preview[index] ?? "", previewWidth));
		}
		return output;
	}

	#renderStacked(width: number, height: number): readonly string[] {
		const previewHeight = Math.max(1, Math.ceil(height / 2));
		const tableHeight = Math.max(1, height - previewHeight);
		return [...this.#renderPreview(width, previewHeight), ...this.#renderTable(width, tableHeight)];
	}

	#renderTable(width: number, height: number): readonly string[] {
		const lines: string[] = [];
		const focused = this.#focus === "table";
		const label = focused ? theme.bold(theme.fg("accent", "Table")) : theme.fg("muted", "Table");
		const query = this.#query || theme.fg("dim", "type to filter");
		lines.push(`${label} ${theme.fg("muted", "Search:")} ${query}`);
		lines.push("");
		if (this.#rows.length === 0) {
			lines.push(theme.fg("muted", this.#options.emptyMessage ?? "No rows"));
			return this.#fit(lines, width, height);
		}

		const rowBudget = Math.max(1, height - 2);
		const overflow = this.#rows.length > rowBudget;
		const rowWidth = Math.max(0, width - (overflow ? 1 : 0));
		const end = Math.min(this.#scrollOffset + rowBudget, this.#rows.length);
		const rows: string[] = [];
		for (let index = this.#scrollOffset; index < end; index++) {
			const selected = index === this.#selectedIndex;
			let line = this.#options.renderRow(this.#rows[index], { selected, focused, width: rowWidth });
			if (selected) {
				line = theme.bg("selectedBg", theme.bold(theme.fg(focused ? "accent" : "muted", line)));
			}
			rows.push(truncateToWidth(line, rowWidth));
		}
		const scroll = new ScrollView(rows, {
			height: rows.length,
			scrollbar: "auto",
			totalRows: this.#rows.length,
			theme: { track: text => theme.fg("muted", text), thumb: text => theme.fg("accent", text) },
		});
		scroll.setScrollOffset(this.#scrollOffset);
		lines.push(...scroll.render(width));
		return this.#fit(lines, width, height);
	}

	#renderPreview(width: number, height: number): readonly string[] {
		let lines: readonly string[];
		if (this.#previewError) {
			lines = [theme.fg("error", "Preview unavailable"), theme.fg("muted", this.#previewError)];
		} else if (!this.#selectedRow) {
			lines = [theme.fg("muted", this.#options.previewEmptyMessage ?? "Select a row to preview")];
		} else if (!this.#previewSession) {
			lines = [theme.fg("muted", "Loading preview...")];
		} else {
			lines = this.#previewSession.render(width, height);
		}
		const maxOffset = Math.max(0, lines.length - height);
		this.#previewOffset = Math.min(this.#previewOffset, maxOffset);
		return this.#fit(lines.slice(this.#previewOffset, this.#previewOffset + height), width, height);
	}

	#fit(lines: readonly string[], width: number, height: number): readonly string[] {
		const output: string[] = [];
		for (let index = 0; index < height; index++) {
			output.push(truncateToWidth(lines[index] ?? "", width));
		}
		return output;
	}

	async #dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#previewGeneration += 1;
		await this.#previewSession?.dispose?.();
		this.#previewSession = undefined;
		await this.whenPreviewSettled();
		await this.#options.preview.dispose?.();
	}
}
