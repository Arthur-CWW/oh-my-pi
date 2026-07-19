import {
	type Component,
	padding,
	replaceTabs,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import { Effect, Exit, Scope } from "effect";
import { viewSelector, type SelectorModel, makeSelectorModel, updateSelector } from "../mvu/selector";
import { makeComponentId, type ViewKey } from "../mvu/schema";
import type { Viewport } from "../mvu/keyed-view";
import { theme } from "../theme/theme";
import {
	buildToolRows,
	type DisplayTool,
	type ToolDisplayRow,
} from "../utils/tools-markdown";
import { TablePreviewComponent } from "./table-preview";

export interface ToolsViewOptions {
	readonly height: () => number;
	readonly requestComponentRender: (component: Component) => void;
}

export interface ToolsViewProjection {
	readonly model: SelectorModel<string>;
	readonly dirtyKeys: ReadonlySet<ViewKey>;
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
	].join(theme.fg("dim", " │ "));
}

function renderToolPreview(row: ToolDisplayRow | null, width: number, height: number): readonly string[] {
	if (!row) return [theme.fg("muted", "Select a tool to inspect its description and provenance")];
	const lines: string[] = [theme.bold(theme.fg("accent", replaceTabs(row.name))), ""];
	lines.push(theme.fg("muted", "Description"));
	for (const line of wrapTextWithAnsi(replaceTabs(row.description), Math.max(1, width))) {
		lines.push(truncateToWidth(line, width));
	}
	lines.push("", theme.fg("muted", "Provenance"));
	for (const value of [
		`${theme.fg("dim", "Kind:")} ${row.kind}`,
		`${theme.fg("dim", "Source:")} ${row.source}`,
		`${theme.fg("dim", "Registered by:")} ${row.registeredBy ?? "unknown"}`,
	]) {
		for (const line of wrapTextWithAnsi(replaceTabs(value), Math.max(1, width))) {
			lines.push(truncateToWidth(line, width));
		}
	}
	return lines.slice(0, Math.max(1, height));
}

export const TOOLS_VIEW_ROUTE = {
	componentId: makeComponentId("tools-view"),
	context: "selector.global",
	makeInitialModel: makeSelectorModel<string>,
	update: updateSelector<string>,
	actions: {
		"tui.select.confirm": "Activate",
		"app.selector.preview": "Activate",
		"ui.dismiss": "Back",
	},
} as const;

/** Renderer adapter for the registered-tool inventory. MVU owns all route state. */
export class ToolsView implements Component {
	readonly #rows: ReadonlyMap<string, ToolDisplayRow>;
	readonly #scope = Scope.makeUnsafe("sequential");
	readonly #table: TablePreviewComponent<ToolDisplayRow, string, ToolDisplayRow | null>;
	#disposed = false;

	constructor(
		tools: ReadonlyArray<DisplayTool>,
		readonly options: ToolsViewOptions,
	) {
		const rows = buildToolRows(tools);
		this.#rows = new Map(rows.map(row => [row.name, row]));
		this.#table = Effect.runSync(
			Scope.provide(this.#scope)(
				TablePreviewComponent.mount<ToolDisplayRow, string, ToolDisplayRow | null>({
					renderRow: (row, context) => renderToolRow(row, context.width),
					renderPreview: (preview, width, height) => renderToolPreview(preview, width, height),
					height: () => Math.max(5, this.options.height() - 1),
					requestComponentRender: () => this.options.requestComponentRender(this),
					layout: "columns",
					tableRatio: 0.65,
					emptyMessage: "No tools are registered.",
					previewEmptyMessage: "Select a tool to inspect its description and provenance",
				}),
			),
		);
	}

	/** Apply a projection from the committed runtime model. */
	apply(projection: ToolsViewProjection): void {
		if (this.#disposed) return;
		const { model, dirtyKeys } = projection;
		const viewport: Viewport = {
			offset: model.viewportOffset,
			height: Math.max(1, model.viewportSize),
		};
		const selected = model.selectedId ? this.#rows.get(model.selectedId) ?? null : null;
		const view = viewSelector(
			model,
			this.#rows,
			viewport,
			{ lines: () => [] },
			selected,
		);
		this.#table.apply({
			...view,
			preview: {
				revision: model.sourceRevision,
				value: selected,
			},
			dirtyKeys,
		});
	}

	render(width: number): readonly string[] {
		const title = theme.bold(theme.fg("accent", "Available Tools"));
		return [title, ...this.#table.render(width)];
	}

	invalidate(): void {
		this.#table.invalidate();
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		await Effect.runPromise(Scope.close(this.#scope, Exit.void));
	}

}
