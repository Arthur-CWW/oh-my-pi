import type { Transition } from "../mvu/schema";
import type { TreeModel } from "../mvu/tree";
import { makeTreeModel, updateTree } from "../mvu/tree";

export const PRIMITIVE_CATEGORY_IDS = ["tools", "skills", "feeds", "memories", "stores", "session"] as const;

export type PrimitiveCategoryId = (typeof PRIMITIVE_CATEGORY_IDS)[number];

export interface PrimitiveInspectorItem {
	readonly id: string;
	readonly label: string;
	readonly summary: string;
	readonly detail: string;
	readonly enabled?: boolean;
}

export interface PrimitiveInspectorCategory {
	readonly id: PrimitiveCategoryId;
	readonly label: string;
	readonly source: string;
	readonly items: readonly PrimitiveInspectorItem[];
	readonly available: boolean;
	readonly unavailableDetail?: string;
}

export type PrimitiveInspectorDepth = 0 | 1 | 2;

export type PrimitiveInspectorKey = `category:${PrimitiveCategoryId}` | `item:${PrimitiveCategoryId}:${string}`;

export interface PrimitiveInspectorState {
	readonly depth: PrimitiveInspectorDepth;
	readonly categoryId?: PrimitiveCategoryId;
	readonly itemId?: string;
	readonly filterQuery: string;
	readonly filterEditing: boolean;
	readonly detailOffset: number;
	/** The keyed tree is the navigation authority; category/item IDs are projections. */
	readonly tree: TreeModel<PrimitiveInspectorKey>;
	readonly helpVisible: boolean;
}

export interface PrimitiveInspectorFilterState {
	readonly filterQuery: string;
	readonly filterEditing: boolean;
}

export function primitiveCategoryKey(id: PrimitiveCategoryId): PrimitiveInspectorKey {
	return `category:${id}`;
}

export function primitiveItemKey(categoryId: PrimitiveCategoryId, itemId: string): PrimitiveInspectorKey {
	return `item:${categoryId}:${itemId}`;
}

function itemIdFromKey(key: PrimitiveInspectorKey | undefined): string | undefined {
	if (key === undefined || !key.startsWith("item:")) return undefined;
	const separator = key.indexOf(":", "item:".length);
	return separator < 0 ? undefined : key.slice(separator + 1);
}

function categoryIdFromKey(key: PrimitiveInspectorKey | undefined): PrimitiveCategoryId | undefined {
	if (key === undefined) return undefined;
	const candidate = key.startsWith("category:")
		? key.slice("category:".length)
		: key.startsWith("item:")
			? key.slice("item:".length, key.indexOf(":", "item:".length) < 0 ? undefined : key.indexOf(":", "item:".length))
			: undefined;
	return candidate === undefined ? undefined : PRIMITIVE_CATEGORY_IDS.find(id => id === candidate);
}

function matchesFilter(item: { readonly label: string; readonly summary?: string }, query: string): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return true;
	return `${item.label}\n${item.summary ?? ""}`.toLocaleLowerCase().includes(needle);
}

function buildTree(categories: readonly PrimitiveInspectorCategory[], sourceRevision: number): TreeModel<PrimitiveInspectorKey> {
	const rootIds = categories.map(category => primitiveCategoryKey(category.id));
	const childrenById = new Map<PrimitiveInspectorKey, readonly PrimitiveInspectorKey[]>();
	const labels = new Map<PrimitiveInspectorKey, string>();
	for (const category of categories) {
		const categoryKey = primitiveCategoryKey(category.id);
		labels.set(categoryKey, `${category.label}\n${category.source}`);
		childrenById.set(
			categoryKey,
			category.items.map(item => {
				const itemKey = primitiveItemKey(category.id, item.id);
				labels.set(itemKey, `${item.label}\n${item.summary}`);
				return itemKey;
			}),
		);
	}
	return makeTreeModel(rootIds, childrenById, labels, sourceRevision);
}

function withSelection(
	state: PrimitiveInspectorState,
	categoryId: PrimitiveCategoryId | undefined,
	itemId: string | undefined,
): PrimitiveInspectorState {
	const selectedKey = itemId !== undefined && categoryId !== undefined
		? primitiveItemKey(categoryId, itemId)
		: categoryId === undefined
			? undefined
			: primitiveCategoryKey(categoryId);
	const selectedPosition = selectedKey === undefined ? -1 : state.tree.indexById.get(selectedKey) ?? -1;
	return {
		...state,
		categoryId,
		itemId,
		tree: { ...state.tree, selectedId: selectedKey, selectedPosition },
	};
}

export function createPrimitiveInspectorState(
	categories: readonly PrimitiveInspectorCategory[] = [],
	initialCategory?: PrimitiveCategoryId,
	sourceRevision = 0,
): PrimitiveInspectorState {
	const categoryId = initialCategory !== undefined && categories.some(category => category.id === initialCategory)
		? initialCategory
		: undefined;
	const tree = buildTree(categories, sourceRevision);
	return {
		depth: categoryId === undefined ? 0 : 1,
		categoryId,
		itemId: undefined,
		filterQuery: "",
		filterEditing: false,
		detailOffset: 0,
		tree: {
			...tree,
			selectedId: categoryId === undefined ? undefined : primitiveCategoryKey(categoryId),
			selectedPosition: categoryId === undefined ? -1 : tree.indexById.get(primitiveCategoryKey(categoryId)) ?? -1,
		},
		helpVisible: false,
	};
}

export function resolvePrimitiveCategory(input: string): PrimitiveCategoryId | undefined {
	const normalized = input.trim().toLowerCase();
	if (!normalized) return undefined;
	const matches = PRIMITIVE_CATEGORY_IDS.filter(category => category.startsWith(normalized));
	return matches.length === 1 ? matches[0] : undefined;
}

export function visiblePrimitiveCategories(
	categories: readonly PrimitiveInspectorCategory[],
	state: PrimitiveInspectorState,
): readonly PrimitiveInspectorCategory[] {
	return state.depth === 0 ? categories.filter(category => matchesFilter(category, state.filterQuery)) : categories;
}

export function selectedPrimitiveCategory(
	categories: readonly PrimitiveInspectorCategory[],
	state: PrimitiveInspectorState,
): PrimitiveInspectorCategory | undefined {
	const visible = visiblePrimitiveCategories(categories, state);
	if (visible.length === 0) return undefined;
	return visible.find(category => category.id === state.categoryId) ?? visible[0];
}

export function visiblePrimitiveItems(
	categories: readonly PrimitiveInspectorCategory[],
	state: PrimitiveInspectorState,
): readonly PrimitiveInspectorItem[] {
	const category = selectedPrimitiveCategory(categories, state);
	if (!category) return [];
	return category.items.filter(item => matchesFilter(item, state.filterQuery));
}

export function selectedPrimitiveItem(
	categories: readonly PrimitiveInspectorCategory[],
	state: PrimitiveInspectorState,
): PrimitiveInspectorItem | undefined {
	const items = visiblePrimitiveItems(categories, state);
	if (items.length === 0) return undefined;
	return items.find(item => item.id === state.itemId) ?? items[0];
}

export function movePrimitiveSelection(
	categories: readonly PrimitiveInspectorCategory[],
	state: PrimitiveInspectorState,
	delta: number,
): PrimitiveInspectorState {
	if (state.depth === 2) {
		return { ...state, detailOffset: Math.max(0, state.detailOffset + delta) };
	}
	if (state.depth === 0) {
		const visible = visiblePrimitiveCategories(categories, state);
		if (visible.length === 0) return state;
		const currentIndex = visible.findIndex(category => primitiveCategoryKey(category.id) === state.tree.selectedId);
		const current = currentIndex < 0
			? delta > 0 ? -1 : 0
			: currentIndex;
		const next = (current + delta + visible.length) % visible.length;
		const category = visible[next];
		return withSelection(state, category?.id, undefined);
	}
	const visible = visiblePrimitiveItems(categories, state);
	if (visible.length === 0 || state.categoryId === undefined) return state;
	const categoryId = state.categoryId;
	const currentIndex = visible.findIndex(item => primitiveItemKey(categoryId, item.id) === state.tree.selectedId);
	const current = Math.max(0, currentIndex);
	const next = (current + delta + visible.length) % visible.length;
	const item = visible[next];
	return withSelection(state, categoryId, item?.id);
}

export function drillIntoPrimitive(
	categories: readonly PrimitiveInspectorCategory[],
	state: PrimitiveInspectorState,
): PrimitiveInspectorState {
	if (state.depth === 0) {
		const category = selectedPrimitiveCategory(categories, state);
		if (!category) return state;
		const next = withSelection({ ...state, depth: 1, filterQuery: "", detailOffset: 0 }, category.id, undefined);
		return { ...next, filterEditing: false };
	}
	if (state.depth === 1) {
		const item = selectedPrimitiveItem(categories, state);
		if (!item || state.categoryId === undefined) return state;
		const next = withSelection({ ...state, depth: 2, filterQuery: "", detailOffset: 0 }, state.categoryId, item.id);
		return { ...next, filterEditing: false };
	}
	return state;
}

export function unwindPrimitiveInspector(state: PrimitiveInspectorState): PrimitiveInspectorState | undefined {
	if (state.filterEditing) return { ...state, filterEditing: false };
	if (state.filterQuery) return { ...state, filterQuery: "" };
	if (state.depth === 2) return { ...state, depth: 1, detailOffset: 0 };
	if (state.depth === 1) {
		const categoryKey = state.categoryId === undefined ? undefined : primitiveCategoryKey(state.categoryId);
		const selectedPosition = categoryKey === undefined ? -1 : state.tree.indexById.get(categoryKey) ?? -1;
		return { ...state, depth: 0, itemId: undefined, tree: { ...state.tree, selectedId: categoryKey, selectedPosition } };
	}
	return undefined;
}

export function beginPrimitiveFilter(state: PrimitiveInspectorState): PrimitiveInspectorState {
	return { ...state, filterEditing: true };
}

export function updatePrimitiveFilter(state: PrimitiveInspectorState, query: string): PrimitiveInspectorState {
	return { ...state, filterQuery: query, filterEditing: true, detailOffset: 0 };
}

export function togglePrimitiveHelp(state: PrimitiveInspectorState): PrimitiveInspectorState {
	return { ...state, helpVisible: !state.helpVisible };
}

export type PrimitiveInspectorMsg =
	| { readonly _tag: "Move"; readonly delta: -1 | 1 }
	| { readonly _tag: "Page"; readonly delta: -1 | 1 }
	| { readonly _tag: "BeginFilter" }
	| { readonly _tag: "FilterAppend"; readonly text: string }
	| { readonly _tag: "FilterDelete" }
	| { readonly _tag: "Back" }
	| { readonly _tag: "Activate" }
	| { readonly _tag: "ToggleHelp" };

export type PrimitiveInspectorCommand = { readonly _tag: "CloseRequested" };

export function updatePrimitiveInspector(
	categories: readonly PrimitiveInspectorCategory[],
	state: PrimitiveInspectorState,
	message: PrimitiveInspectorMsg,
): Transition<PrimitiveInspectorState, PrimitiveInspectorCommand> {
	switch (message._tag) {
		case "Move":
			return { model: movePrimitiveSelection(categories, state, message.delta), commands: [], dirtyKeys: new Set(["selection", "preview"]) };
		case "Page":
			return { model: movePrimitiveSelection(categories, state, message.delta), commands: [], dirtyKeys: new Set(["selection", "preview"]) };
		case "BeginFilter":
			return { model: beginPrimitiveFilter(state), commands: [], dirtyKeys: new Set(["search"]) };
		case "FilterAppend":
			return { model: updatePrimitiveFilter(state, `${state.filterQuery}${message.text}`), commands: [], dirtyKeys: new Set(["search"]) };
		case "FilterDelete":
			return { model: updatePrimitiveFilter(state, state.filterQuery.slice(0, -1)), commands: [], dirtyKeys: new Set(["search"]) };
		case "Activate":
			return { model: drillIntoPrimitive(categories, state), commands: [], dirtyKeys: new Set(["focus", "selection", "preview"]) };
		case "ToggleHelp":
			return { model: togglePrimitiveHelp(state), commands: [], dirtyKeys: new Set(["help"]) };
		case "Back": {
			const next = unwindPrimitiveInspector(state);
			return next === undefined
				? { model: state, commands: [{ _tag: "CloseRequested" }], dirtyKeys: new Set(["focus"]) }
				: { model: next, commands: [], dirtyKeys: new Set(["focus", "search", "preview"]) };
		}
	}
}


/** Apply a keyed source refresh without mutating any projected category/item. */
export function replacePrimitiveSource(
	state: PrimitiveInspectorState,
	categories: readonly PrimitiveInspectorCategory[],
	sourceRevision: number,
): PrimitiveInspectorState {
	const tree = buildTree(categories, sourceRevision);
	const replaced = updateTree(state.tree, {
		_tag: "SourceReplaced",
		sourceRevision,
		rootIds: tree.rootIds,
		childrenById: tree.childrenById,
		labels: tree.labels,
	}).model;
	const selectedKey = state.tree.selectedId;
	const selectedCategory = categoryIdFromKey(selectedKey) ?? state.categoryId;
	const categoryKey = selectedCategory === undefined ? undefined : primitiveCategoryKey(selectedCategory);
	const containsKey = (key: PrimitiveInspectorKey | undefined): key is PrimitiveInspectorKey =>
		key !== undefined && (
			replaced.rootIds.includes(key) ||
			[...replaced.childrenById.values()].some(ids => ids.includes(key))
		);
	// A removed item still owns the reversible item/detail layer; clamp its projection without skipping that layer.
	const selectedItemRemoved = selectedKey?.startsWith("item:") === true && !containsKey(selectedKey);
	const nextKey = containsKey(selectedKey)
		? selectedKey
		: containsKey(categoryKey)
			? categoryKey
			: replaced.rootIds[0];
	const selectedPosition = nextKey === undefined ? -1 : replaced.indexById.get(nextKey) ?? -1;
	return {
		...state,
		depth: selectedItemRemoved ? 2 : state.depth,
		detailOffset: selectedItemRemoved ? 0 : state.detailOffset,
		tree: { ...replaced, selectedId: nextKey, selectedPosition },
		categoryId: categoryIdFromKey(nextKey),
		itemId: itemIdFromKey(nextKey),
	};
}
