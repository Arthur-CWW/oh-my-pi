import { type Component, type Keybinding, padding, Text, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { replaceTabs } from "../../tools/render-utils";
import { highlightCode, theme } from "../theme/theme";
import { makeComponentId, type ActiveKeymapContext, type ComponentId, type KeyEvent } from "../mvu/schema";
import { makeTreeModel, type TreeCommand, type TreeModel, type TreeMsg, updateTree, viewTree } from "../mvu/tree";
import type { Viewport } from "../mvu/keyed-view";
import type { CopyTarget } from "../utils/copy-targets";
import { bottomBorder, divider, row, topBorder } from "./overlay-box";

const MIN_TREE_ROWS = 3;
const CHROME_ROWS = 5;

export type CopySelectorMsg = TreeMsg<string, Keybinding> | {
	readonly _tag: "TargetsReplaced";
	readonly sourceRevision: number;
	readonly targets: readonly CopyTarget[];
};

export type CopySelectorCommand = TreeCommand<Keybinding, string> | {
	readonly _tag: "CopyRequested";
	readonly target: CopyTarget;
};

export interface CopyTargetRow {
	readonly target: CopyTarget;
	readonly prefix: string;
	readonly depth: number;
}

export interface CopyPreview {
	readonly target?: CopyTarget;
	readonly language?: string;
	readonly status?: string;
}

export interface CopySelectorModel {
	readonly tree: TreeModel<string>;
	readonly targetsById: ReadonlyMap<string, CopyTarget>;
	readonly rowsById: ReadonlyMap<string, CopyTargetRow>;
}

export interface CopySelectorPatch {
	readonly visibleRows: readonly { readonly key: string; readonly row: CopyTargetRow }[];
	readonly selectedKey?: string;
	readonly focus: "table" | "preview";
	readonly query?: string;
	readonly preview: CopyPreview;
	readonly dirtyKeys: ReadonlySet<string>;
}

function sourceMaps(targets: readonly CopyTarget[]): {
	readonly roots: readonly string[];
	readonly childrenById: ReadonlyMap<string, readonly string[]>;
	readonly labels: ReadonlyMap<string, string>;
	readonly targetsById: ReadonlyMap<string, CopyTarget>;
	readonly rowsById: ReadonlyMap<string, CopyTargetRow>;
} {
	const targetsById = new Map<string, CopyTarget>();
	const childrenById = new Map<string, readonly string[]>();
	const labels = new Map<string, string>();
	const rowsById = new Map<string, CopyTargetRow>();
	const visit = (items: readonly CopyTarget[], depth: number, parentPrefix: string): readonly string[] => {
		const ids: string[] = [];
		items.forEach((target, index) => {
			const isLast = index === items.length - 1;
			const prefix = depth === 0 ? "" : `${parentPrefix}${isLast ? theme.tree.last : theme.tree.branch}`;
			targetsById.set(target.id, target);
			labels.set(target.id, `${target.label}\n${target.hint ?? ""}\n${target.preview}`);
			rowsById.set(target.id, { target, prefix, depth });
			const children = target.children === undefined
				? []
				: visit(target.children, depth + 1, `${parentPrefix}${isLast ? "   " : `${theme.tree.vertical}  `}`);
			childrenById.set(target.id, children);
			ids.push(target.id);
		});
		return ids;
	};
	const roots = visit(targets, 0, "");
	return { roots, childrenById, labels, targetsById, rowsById };
}

function withSelectedId(tree: TreeModel<string>, selectedId: string | undefined): TreeModel<string> {
	return {
		...tree,
		selectedId,
		selectedPosition: selectedId === undefined ? -1 : tree.indexById.get(selectedId) ?? -1,
	};
}

export function createCopySelectorModel(targets: readonly CopyTarget[], sourceRevision = 0): CopySelectorModel {
	const maps = sourceMaps(targets);
	const expanded = new Set(maps.childrenById.keys());
	const tree = makeTreeModel(maps.roots, maps.childrenById, maps.labels, sourceRevision, expanded);
	return { tree, targetsById: maps.targetsById, rowsById: maps.rowsById };
}

export function updateCopySelector(
	model: CopySelectorModel,
	message: CopySelectorMsg,
): { readonly model: CopySelectorModel; readonly commands: readonly CopySelectorCommand[]; readonly dirtyKeys: ReadonlySet<string> } {
	if (message._tag === "TargetsReplaced") {
		const next = createCopySelectorModel(message.targets, message.sourceRevision);
		const source = updateTree(model.tree, {
			_tag: "SourceReplaced",
			sourceRevision: message.sourceRevision,
			rootIds: next.tree.rootIds,
			childrenById: next.tree.childrenById,
			labels: next.tree.labels,
		});
		const selectedId = source.model.selectedId;
		const preserved = selectedId !== undefined && next.targetsById.has(selectedId) ? selectedId : next.tree.selectedId;
		return {
			model: { ...next, tree: withSelectedId(source.model, preserved) },
			commands: [],
			dirtyKeys: source.dirtyKeys,
		};
	}

	const transition = updateTree(model.tree, message);
	let nextTree = transition.model;
	let dirtyKeys = transition.dirtyKeys;
	if ((message._tag === "Move" || message._tag === "Page" || message._tag === "Jump") && transition.model.mode === "TreeBrowse") {
		const selected = transition.model.selectedId === undefined ? undefined : model.rowsById.get(transition.model.selectedId);
		if (model.tree.mode === "TreePreview" || (selected?.depth ?? 0) > 0) {
			nextTree = { ...transition.model, mode: "TreePreview" };
			dirtyKeys = new Set(transition.dirtyKeys).add("focus");
		}
	}
	const commands: CopySelectorCommand[] = [...transition.commands];
	if (message._tag === "Activate" && model.tree.selectedId !== undefined) {
		const target = model.targetsById.get(model.tree.selectedId);
		if (target?.content !== undefined) commands.push({ _tag: "CopyRequested", target });
	}
	return { model: { ...model, tree: nextTree }, commands, dirtyKeys };
}

export function viewCopySelector(model: CopySelectorModel, viewport: Viewport, dirtyKeys: ReadonlySet<string> = new Set()): CopySelectorPatch {
	const view = viewTree(model.tree, model.rowsById, viewport);
	const target = model.tree.selectedId === undefined ? undefined : model.targetsById.get(model.tree.selectedId);
	return {
		visibleRows: view.visibleRows,
		selectedKey: view.selectedKey,
		focus: model.tree.mode === "TreePreview" || model.tree.mode === "TreeConfirm" ? "preview" : "table",
		query: model.tree.mode === "TreeFilter" ? model.tree.filterQuery : undefined,
		preview: { target, language: target?.language, status: target?.copyMessage },
		dirtyKeys,
	};
}

/** Maps canonical MVU actions to pure tree messages; terminal bytes are decoded by the route. */
export function copySelectorActionToMsg(action: string, event: KeyEvent): CopySelectorMsg | undefined {
	if (event._tag !== "Press" && event._tag !== "Paste") return undefined;
	const text = event._tag === "Paste" ? event.text : event.text ?? String(event.key);
	switch (action) {
		case "app.navigation.up":
		case "tui.select.up": return { _tag: "Move", delta: -1 };
		case "app.navigation.down":
		case "tui.select.down": return { _tag: "Move", delta: 1 };
		case "tui.select.pageUp": return { _tag: "Page", delta: -1 };
		case "tui.select.pageDown": return { _tag: "Page", delta: 1 };
		case "app.selector.filter": return { _tag: "BeginFilter" };
		case "app.selector.filterAppend":
			return text.length > 0 ? { _tag: "FilterAppend", text } : undefined;
		case "app.selector.filterDelete": return { _tag: "FilterDelete" };
		case "ui.dismiss": return { _tag: "Back" };
		case "tui.select.confirm": return { _tag: "Activate" };
		default: return undefined;
	}
}

/** Renderer-only keyed tree/preview component. */
export class CopySelectorComponent implements Component {
	#patch: CopySelectorPatch | undefined;
	#previewText = new Text("", 0, 0);
	#cached: { readonly width: number; readonly patch: CopySelectorPatch; readonly lines: readonly string[] } | undefined;

	apply(patch: CopySelectorPatch): void {
		if (this.#patch === patch) return;
		this.#patch = patch;
		this.#cached = undefined;
	}

	invalidate(): void {
		this.#cached = undefined;
		this.#previewText = new Text("", 0, 0);
	}

	render(width: number): readonly string[] {
		const patch = this.#patch;
		if (patch === undefined) return [];
		if (this.#cached?.width === width && this.#cached.patch === patch) return this.#cached.lines;
		const height = process.stdout.rows || 40;
		const available = Math.max(MIN_TREE_ROWS + 1, height - CHROME_ROWS);
		const treeRows = Math.max(1, Math.min(patch.visibleRows.length, Math.floor(available / 2)));
		const previewRows = Math.max(1, available - treeRows);
		const lines = [
			topBorder(width, "Copy to clipboard"),
			...this.#renderTree(width, patch, treeRows),
			divider(width),
			...this.#renderPreview(width, patch.preview, previewRows),
			divider(width),
			row("j/k move · / filter · Enter copy · Esc back", width),
			bottomBorder(width),
		];
		this.#cached = { width, patch, lines };
		return lines;
	}

	#renderTree(width: number, patch: CopySelectorPatch, rows: number): readonly string[] {
		const inner = Math.max(0, width - 4);
		const output: string[] = [];
		for (let index = 0; index < rows; index++) {
			const entry = patch.visibleRows[index];
			if (entry === undefined) {
				output.push(row("", width));
				continue;
			}
			const selected = entry.key === patch.selectedKey;
			const cursor = selected ? theme.fg("accent", "❯ ") : "  ";
			const prefix = theme.fg("dim", entry.row.prefix);
			const hint = entry.row.target.hint ?? "";
			const labelWidth = Math.max(1, inner - visibleWidth(cursor) - visibleWidth(entry.row.prefix) - visibleWidth(hint) - 2);
			const label = truncateToWidth(entry.row.target.label, labelWidth);
			const left = selected ? theme.bold(theme.fg("accent", label)) : label;
			const gap = Math.max(1, inner - visibleWidth(cursor) - visibleWidth(entry.row.prefix) - visibleWidth(label) - visibleWidth(hint));
			output.push(row(cursor + prefix + left + padding(gap) + (hint ? theme.fg("dim", hint) : ""), width));
		}
		return output;
	}

	#renderPreview(width: number, preview: CopyPreview, rows: number): readonly string[] {
		const target = preview.target;
		const heading = target?.hint ? `Preview · ${target.hint}` : "Preview";
		const output = [row(theme.fg("dim", heading), width)];
		const contentRows = rows - 1;
		if (target === undefined || contentRows <= 0) {
			while (output.length < rows) output.push(row("", width));
			return output;
		}
		const source = target.language ? highlightCode(replaceTabs(target.preview), target.language).join("\n") : replaceTabs(target.preview);
		this.#previewText.setText(source);
		const wrapped = this.#previewText.render(Math.max(1, width - 4));
		const visible = Math.min(wrapped.length, contentRows);
		for (let index = 0; index < contentRows; index++) {
			output.push(index < visible ? row(target.language ? wrapped[index]! : theme.fg("muted", wrapped[index]!), width) : row("", width));
		}
		return output;
	}
}

export interface CopySelectorRouteSpec {
	readonly componentId: ComponentId;
	readonly focusedRoot: CopySelectorComponent;
	readonly initialModel: CopySelectorModel;
	readonly context: (model: CopySelectorModel) => ActiveKeymapContext;
	readonly actionToMsg: (action: Keybinding, event: KeyEvent) => CopySelectorMsg | undefined;
}

export function createCopySelectorRoute(targets: readonly CopyTarget[], sourceRevision = 0): CopySelectorRouteSpec {
	const componentId = makeComponentId("copy-selector");
	const focusedRoot = new CopySelectorComponent();
	return {
		componentId,
		focusedRoot,
		initialModel: createCopySelectorModel(targets, sourceRevision),
		context: model => ({
			contexts: ["selector.global", "selector.filter"],
			mode: model.tree.mode === "TreeFilter" ? "TreeFilter" : "TreeBrowse",
			focus: "list",
			capabilities: new Set(["selector.filter"]),
		}),
		actionToMsg: (action, event) => copySelectorActionToMsg(String(action), event),
	};
}
