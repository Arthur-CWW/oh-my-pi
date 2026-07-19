import type { Keybinding } from "@oh-my-pi/pi-tui";
import type { KeyedRow, KeyedTreeView } from "./keyed-view";
import { visibleKeyedRows, type Viewport } from "./keyed-view";
import type { Transition, ViewKey } from "./schema";

export type TreeMode = "TreeBrowse" | "TreeFilter" | "TreePreview" | "TreeLabelEdit" | "TreeConfirm";

export interface TreeLabelEditDraft<Id> {
	readonly targetId: Id;
	readonly value: string;
}

export interface TreeModel<Id> {
	readonly sourceRevision: number;
	readonly rootIds: readonly Id[];
	readonly expanded: ReadonlySet<Id>;
	readonly selectedId?: Id;
	readonly selectedPosition: number;
	readonly viewportOffset: number;
	readonly mode: TreeMode;
	readonly childrenById: ReadonlyMap<Id, readonly Id[]>;
	readonly labels: ReadonlyMap<Id, string>;
	readonly flattenedIds: readonly Id[];
	readonly visibleIds: readonly Id[];
	readonly indexById: ReadonlyMap<Id, number>;
	readonly viewportSize: number;
	readonly filterQuery: string;
	readonly labelEdit?: TreeLabelEditDraft<Id>;
}

export type TreeCommand<Action extends Keybinding, Id> =
	| { readonly _tag: "CloseRequested" }
	| { readonly _tag: "Activate"; readonly id: Id }
	| { readonly _tag: "LabelCommitted"; readonly id: Id; readonly label: string }
	| { readonly _tag: "Action"; readonly action: Action; readonly id: Id };

export type TreeMsg<Id, Action extends Keybinding = Keybinding> =
	| { readonly _tag: "Move"; readonly delta: -1 | 1 }
	| { readonly _tag: "Page"; readonly delta: -1 | 1 }
	| { readonly _tag: "Jump"; readonly target: "first" | "last" }
	| { readonly _tag: "ToggleExpanded"; readonly id?: Id }
	| { readonly _tag: "BeginFilter" }
	| { readonly _tag: "FilterAppend"; readonly text: string }
	| { readonly _tag: "FilterDelete" }
	| { readonly _tag: "Back" }
	| { readonly _tag: "Activate"; readonly action?: Action }
	| { readonly _tag: "BeginLabelEdit"; readonly draft?: string }
	| { readonly _tag: "LabelAppend"; readonly text: string }
	| { readonly _tag: "LabelDelete" }
	| { readonly _tag: "CommitLabel" }
	| { readonly _tag: "SourceReplaced"; readonly sourceRevision: number; readonly rootIds: readonly Id[]; readonly childrenById: ReadonlyMap<Id, readonly Id[]>; readonly labels: ReadonlyMap<Id, string> }
	| { readonly _tag: "ViewportChanged"; readonly offset: number; readonly height: number };

function flattenTree<Id>(model: Pick<TreeModel<Id>, "rootIds" | "childrenById" | "expanded">): readonly Id[] {
	const result: Id[] = [];
	const visit = (id: Id): void => {
		result.push(id);
		if (!model.expanded.has(id)) return;
		for (const child of model.childrenById.get(id) ?? []) visit(child);
	};
	for (const root of model.rootIds) visit(root);
	return result;
}

function filterTree<Id>(ids: readonly Id[], query: string, labels: ReadonlyMap<Id, string>): readonly Id[] {
	if (query.length === 0) return ids;
	const lowered = query.toLocaleLowerCase();
	return ids.filter(id => (labels.get(id) ?? String(id)).toLocaleLowerCase().includes(lowered));
}

function indexIds<Id>(ids: readonly Id[]): ReadonlyMap<Id, number> {
	const result = new Map<Id, number>();
	for (let index = 0; index < ids.length; index++) {
		const id = ids[index];
		if (id !== undefined) result.set(id, index);
	}
	return result;
}

function select<Id>(model: TreeModel<Id>, index: number): TreeModel<Id> {
	const ids = model.visibleIds;
	if (ids.length === 0) return { ...model, selectedId: undefined, selectedPosition: -1, viewportOffset: 0 };
	const selectedPosition = Math.max(0, Math.min(index, ids.length - 1));
	const selectedId = ids[selectedPosition];
	if (selectedId === undefined) return { ...model, selectedId: undefined, selectedPosition: -1, viewportOffset: 0 };
	const height = Math.max(1, model.viewportSize);
	const limit = Math.max(0, ids.length - height);
	let viewportOffset = Math.max(0, Math.min(model.viewportOffset, limit));
	if (selectedPosition < viewportOffset) viewportOffset = selectedPosition;
	if (selectedPosition >= viewportOffset + height) viewportOffset = Math.min(limit, selectedPosition - height + 1);
	return { ...model, selectedId, selectedPosition, viewportOffset };
}

function project<Id>(model: TreeModel<Id>, flattenedIds: readonly Id[], filterQuery: string): TreeModel<Id> {
	const visibleIds = model.mode === "TreeFilter"
		? filterTree(flattenedIds, filterQuery, model.labels)
		: flattenedIds;
	const indexById = indexIds(visibleIds);
	const retainedPosition = model.selectedId === undefined ? undefined : indexById.get(model.selectedId);
	const selectedPosition = retainedPosition ?? Math.max(0, Math.min(model.selectedPosition, visibleIds.length - 1));
	return select({ ...model, flattenedIds, visibleIds, indexById, filterQuery }, selectedPosition);
}

function transition<Id, Action extends Keybinding>(
	before: TreeModel<Id>,
	after: TreeModel<Id>,
	commands: readonly TreeCommand<Action, Id>[] = [],
	keys: readonly ViewKey[] = [],
): Transition<TreeModel<Id>, TreeCommand<Action, Id>> {
	const dirty = new Set<ViewKey>(keys);
	if (before.selectedId !== after.selectedId) {
		if (before.selectedId !== undefined) dirty.add(String(before.selectedId));
		if (after.selectedId !== undefined) dirty.add(String(after.selectedId));
	}
	if (before.mode !== after.mode) dirty.add("focus");
	if (before.viewportOffset !== after.viewportOffset) dirty.add("viewport");
	return { model: after, commands, dirtyKeys: dirty };
}

export function makeTreeModel<Id>(
	rootIds: readonly Id[],
	childrenById: ReadonlyMap<Id, readonly Id[]> = new Map(),
	labels: ReadonlyMap<Id, string> = new Map(),
	sourceRevision = 0,
	expanded: ReadonlySet<Id> = new Set(),
): TreeModel<Id> {
	const flattenedIds = flattenTree({ rootIds, childrenById, expanded });
	const visibleIds = flattenedIds;
	return {
		sourceRevision,
		rootIds,
		expanded,
		selectedId: visibleIds[0],
		selectedPosition: visibleIds.length === 0 ? -1 : 0,
		viewportOffset: 0,
		mode: "TreeBrowse",
		childrenById,
		labels,
		flattenedIds,
		visibleIds,
		indexById: indexIds(visibleIds),
		viewportSize: 10,
		filterQuery: "",
	};
}

export function updateTree<Id, Action extends Keybinding = Keybinding>(
	model: TreeModel<Id>,
	msg: TreeMsg<Id, Action>,
): Transition<TreeModel<Id>, TreeCommand<Action, Id>> {
	switch (msg._tag) {
		case "Move": {
			const mode = model.mode === "TreeFilter"
				? "TreeFilter"
				: model.mode === "TreePreview"
					? "TreePreview"
					: "TreeBrowse";
			return transition(model, select({ ...model, mode, labelEdit: mode === "TreeBrowse" ? undefined : model.labelEdit }, model.selectedPosition + msg.delta));
		}
		case "Page": {
			const mode = model.mode === "TreeFilter"
				? "TreeFilter"
				: model.mode === "TreePreview"
					? "TreePreview"
					: "TreeBrowse";
			return transition(model, select({ ...model, mode, labelEdit: mode === "TreeBrowse" ? undefined : model.labelEdit }, model.selectedPosition + msg.delta * Math.max(1, model.viewportSize)));
		}
		case "Jump":
			return transition(model, select(model, msg.target === "first" ? 0 : model.visibleIds.length - 1));
		case "ToggleExpanded": {
			const id = msg.id ?? model.selectedId;
			if (id === undefined) return transition(model, model);
			const expanded = new Set(model.expanded);
			if (expanded.has(id)) expanded.delete(id);
			else expanded.add(id);
			const next = { ...model, expanded };
			return transition(model, project(next, flattenTree(next), model.filterQuery), [], [String(id)]);
		}
		case "BeginFilter": {
			const next = { ...model, mode: "TreeFilter" as const, filterQuery: "", labelEdit: undefined };
			return transition(model, project(next, model.flattenedIds, ""));
		}
		case "FilterAppend": {
			const query = `${model.mode === "TreeFilter" ? model.filterQuery : ""}${msg.text}`;
			const next = { ...model, mode: "TreeFilter" as const, labelEdit: undefined };
			return transition(model, project(next, model.flattenedIds, query), [], ["search"]);
		}
		case "FilterDelete": {
			if (model.mode !== "TreeFilter") return transition(model, model);
			const query = model.filterQuery.slice(0, -1);
			return transition(model, project(model, model.flattenedIds, query), [], ["search"]);
		}
		case "Back":
			switch (model.mode) {
				case "TreeConfirm": return transition(model, { ...model, mode: "TreePreview" });
				case "TreePreview": return transition(model, { ...model, mode: "TreeBrowse" });
				case "TreeLabelEdit": return transition(model, { ...model, mode: "TreeBrowse", labelEdit: undefined });
				case "TreeFilter": {
					const next = { ...model, mode: "TreeBrowse" as const, filterQuery: "" };
					return transition(model, project(next, model.flattenedIds, ""));
				}
				case "TreeBrowse": return transition(model, model, [{ _tag: "CloseRequested" }]);
			}
		case "Activate": {
			if (model.selectedId === undefined) return transition(model, model);
			if (msg.action !== undefined) return transition(model, model, [{ _tag: "Action", action: msg.action, id: model.selectedId }]);
			return transition(model, { ...model, mode: "TreePreview" }, [{ _tag: "Activate", id: model.selectedId }]);
		}
		case "BeginLabelEdit": {
			if (model.selectedId === undefined) return transition(model, model);
			const labelEdit: TreeLabelEditDraft<Id> = {
				targetId: model.selectedId,
				value: msg.draft ?? model.labels.get(model.selectedId) ?? "",
			};
			return transition(model, { ...model, mode: "TreeLabelEdit", labelEdit }, [], ["label"]);
		}
		case "LabelAppend":
			if (model.mode !== "TreeLabelEdit" || model.labelEdit === undefined) return transition(model, model);
			return transition(model, { ...model, labelEdit: { ...model.labelEdit, value: `${model.labelEdit.value}${msg.text}` } }, [], ["label"]);
		case "LabelDelete":
			if (model.mode !== "TreeLabelEdit" || model.labelEdit === undefined) return transition(model, model);
			return transition(model, { ...model, labelEdit: { ...model.labelEdit, value: model.labelEdit.value.slice(0, -1) } }, [], ["label"]);
		case "CommitLabel": {
			if (model.mode !== "TreeLabelEdit" || model.labelEdit === undefined) return transition(model, model);
			const draft = model.labelEdit;
			return transition(
				model,
				{ ...model, mode: "TreeBrowse", labelEdit: undefined },
				[{ _tag: "LabelCommitted", id: draft.targetId, label: draft.value.trim() }],
				["label"],
			);
		}
		case "SourceReplaced": {
			const nextBase: TreeModel<Id> = {
				...model,
				sourceRevision: msg.sourceRevision,
				rootIds: msg.rootIds,
				childrenById: msg.childrenById,
				labels: msg.labels,
				labelEdit: model.labelEdit !== undefined && msg.labels.has(model.labelEdit.targetId) ? model.labelEdit : undefined,
			};
			return transition(model, project(nextBase, flattenTree(nextBase), model.filterQuery));
		}
		case "ViewportChanged":
			return transition(model, select({ ...model, viewportSize: Math.max(1, msg.height), viewportOffset: msg.offset }, model.selectedPosition));
	}
}

export function viewTree<Id, Row>(
	model: TreeModel<Id>,
	rows: ReadonlyMap<Id, Row>,
	viewport: Viewport,
): KeyedTreeView<Id, Row> {
	const visibleRows: readonly KeyedRow<Id, Row>[] = visibleKeyedRows(model.visibleIds, rows, viewport);
	return {
		visibleRows,
		selectedKey: model.selectedId,
		dirtyKeys: new Set<ViewKey>(),
	};
}
