import type { Component } from "@oh-my-pi/pi-tui";
import type { StatusProjection } from "./status";
import type { ViewKey } from "./schema";

/** Focus is supplied by the committed MVU view; the renderer never changes it. */
export type TablePreviewFocus = "table" | "preview";
export type TablePreviewLayout = "columns" | "stacked";
export type PreviewRevision = string | number;

export type { ViewKey } from "./schema";


/**
 * Immutable cache key for preview content. `value` may retain renderer-owned
 * resources, but callers must publish a new descriptor revision whenever the
 * rendered content changes.
 */
export interface RevisionedPreviewDescriptor<Preview> {
	readonly revision: PreviewRevision;
	readonly value: Preview;
}

export interface TablePreviewRowRenderContext {
	readonly selected: boolean;
	readonly focused: boolean;
	readonly width: number;
}

export interface TablePreviewSectionContext {
	readonly index: number;
	readonly firstVisible: boolean;
	readonly width: number;
}

export interface TablePreviewEmptyContext {
	readonly query: string;
	readonly width: number;
}

export interface TablePreviewPatch<Row, Key, Preview> {
	readonly visibleRows: readonly { readonly key: Key; readonly row: Row }[];
	readonly selectedKey?: Key;
	readonly focus: TablePreviewFocus;
	readonly query?: string;
	readonly status?: StatusProjection;
	readonly preview: RevisionedPreviewDescriptor<Preview>;
	readonly dirtyKeys: ReadonlySet<ViewKey>;
}

/**
 * Renderer-only options. The route owns rows, selection, filtering, offsets,
 * and async preview work; this adapter receives only the committed projection.
 */
export interface TablePreviewRendererOptions<Row, Key, Preview> {
	readonly renderRow: (row: Row, context: TablePreviewRowRenderContext) => string;
	readonly renderPreview: (preview: Preview, width: number, height: number) => readonly string[];
	readonly height: () => number;
	readonly requestComponentRender: (component: Component) => void;
	readonly layout?: TablePreviewLayout;
	readonly tableRatio?: number;
	readonly tableHeight?: () => number;
	readonly betweenPanes?: (width: number) => readonly string[];
	readonly showTableHeader?: boolean;
	readonly decorateSelectedRow?: boolean;
	readonly showTableScrollbar?: boolean;
	readonly fitTableHeight?: boolean;
	readonly sectionLabel?: (row: Row, context: TablePreviewSectionContext) => string | undefined;
	readonly renderSectionLabel?: (label: string, width: number) => string;
	readonly renderEmpty?: (context: TablePreviewEmptyContext) => readonly string[];
	readonly renderOverflow?: (remaining: number, width: number) => string;
	readonly emptyMessage?: string;
	readonly previewEmptyMessage?: string;
	/** Release renderer-owned resources when its mount Scope closes. */
	readonly dispose?: () => void | Promise<void>;
}
