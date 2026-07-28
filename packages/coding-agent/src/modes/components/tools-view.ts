import {
	type Component,
	padding,
	replaceTabs,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import { Effect, Exit, Scope } from "effect";
import { theme } from "../theme/theme";
import { buildToolRows, type DisplayTool, type ToolDisplayRow } from "../utils/tools-markdown";
import { keyHint } from "./keybinding-hints";
import { TablePreviewComponent, type TablePreviewSession } from "./table-preview";

export interface ToolsViewOptions {
	readonly height: () => number;
	readonly requestRender: () => void;
	readonly onClose: () => void;
}

function fitCell(value: string, width: number): string {
	if (width <= 0) return "";
	const clipped = truncateToWidth(replaceTabs(value), width);
	return clipped + padding(Math.max(0, width - visibleWidth(clipped)));
}

function rowWidths(width: number): readonly [number, number, number, number, number] {
	const separators = 12;
	const available = Math.max(5, width - separators);
	const name = Math.max(1, Math.floor(available * 0.22));
	const kind = Math.max(1, Math.floor(available * 0.13));
	const source = Math.max(1, Math.floor(available * 0.24));
	const registeredBy = Math.max(1, Math.floor(available * 0.2));
	const description = Math.max(1, available - name - kind - source - registeredBy);
	return [name, kind, source, registeredBy, description];
}

function renderToolRow(row: ToolDisplayRow, width: number): string {
	const [nameWidth, kindWidth, sourceWidth, registeredByWidth, descriptionWidth] = rowWidths(width);
	return [
		fitCell(row.name, nameWidth),
		fitCell(row.kind, kindWidth),
		fitCell(row.source, sourceWidth),
		fitCell(row.registeredBy ?? "—", registeredByWidth),
		fitCell(row.description.replace(/[\r\n]+/g, " "), descriptionWidth),
	].join("   ");
}

function appendWrapped(lines: string[], value: string, width: number): void {
	const safe = replaceTabs(value);
	for (const line of wrapTextWithAnsi(safe, Math.max(1, width))) {
		lines.push(truncateToWidth(line, width));
	}
}

class ToolPreview implements TablePreviewSession {
	constructor(readonly row: ToolDisplayRow) {}

	render(width: number): readonly string[] {
		const lines: string[] = [theme.bold(theme.fg("accent", replaceTabs(this.row.name))), ""];
		lines.push(theme.fg("muted", "Description"));
		appendWrapped(lines, this.row.description, width);
		lines.push("", theme.fg("muted", "Provenance"));
		appendWrapped(lines, `${theme.fg("dim", "Kind:")} ${this.row.kind}`, width);
		appendWrapped(lines, `${theme.fg("dim", "Source:")} ${this.row.source}`, width);
		appendWrapped(lines, `${theme.fg("dim", "Registered by:")} ${this.row.registeredBy ?? "unknown"}`, width);
		return lines;
	}
}

/** Read-only TUI adapter for the registered-tool inventory. */
export class ToolsView implements Component {
	#rows: ToolDisplayRow[];
	readonly #scope = Scope.makeUnsafe("sequential");
	readonly #table: TablePreviewComponent<ToolDisplayRow, string>;
	#disposed = false;

	constructor(
		tools: ReadonlyArray<DisplayTool>,
		readonly options: ToolsViewOptions,
	) {
		this.#rows = buildToolRows(tools);
		this.#table = Effect.runSync(
			Scope.provide(this.#scope)(
				TablePreviewComponent.mount<ToolDisplayRow, string>({
					rows: () => this.#rows,
					keyOf: row => row.name,
					searchText: row => `${row.name} ${row.kind} ${row.source} ${row.registeredBy ?? ""} ${row.description}`,
					renderRow: (row, context) => renderToolRow(row, context.width),
					preview: { open: row => new ToolPreview(row) },
					height: () => Math.max(5, this.options.height() - 2),
					requestRender: this.options.requestRender,
					onClose: this.options.onClose,
					layout: "columns",
					tableRatio: 0.65,
					emptyMessage: "No tools are registered.",
					previewEmptyMessage: "Select a tool to inspect its description and provenance",
				}),
			),
		);
	}

	get selectedKey(): string | undefined {
		return this.#table.selectedKey;
	}

	refresh(tools: ReadonlyArray<DisplayTool>): void {
		this.#rows = buildToolRows(tools);
		this.#table.refresh({ refreshPreview: true });
	}

	render(width: number): readonly string[] {
		const title = theme.bold(theme.fg("accent", "Available Tools"));
		const footer = theme.fg(
			"dim",
			` ↑/↓: navigate  Ctrl+W: switch pane  type: filter  ${keyHint("ui.dismiss", "close")}`,
		);
		return [title, ...this.#table.render(width), truncateToWidth(footer, width)];
	}

	handleInput(data: string): void {
		this.#table.handleInput(data);
	}

	invalidate(): void {
		this.#table.invalidate();
	}

	whenPreviewSettled(): Promise<void> {
		return this.#table.whenPreviewSettled();
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		await Effect.runPromise(Scope.close(this.#scope, Exit.void));
	}
}
