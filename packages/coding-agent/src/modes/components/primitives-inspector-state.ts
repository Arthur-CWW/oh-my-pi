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

export interface PrimitiveInspectorState {
	readonly depth: PrimitiveInspectorDepth;
	readonly categoryIndex: number;
	readonly itemIndex: number;
	readonly filterQuery: string;
	readonly filterEditing: boolean;
	readonly detailOffset: number;
}

export function createPrimitiveInspectorState(
	categories: readonly PrimitiveInspectorCategory[] = [],
	initialCategory?: PrimitiveCategoryId,
): PrimitiveInspectorState {
	const categoryIndex =
		initialCategory === undefined ? 0 : categories.findIndex(category => category.id === initialCategory);
	return {
		depth: categoryIndex >= 0 && initialCategory !== undefined ? 1 : 0,
		categoryIndex: categoryIndex >= 0 ? categoryIndex : 0,
		itemIndex: 0,
		filterQuery: "",
		filterEditing: false,
		detailOffset: 0,
	};
}

export function resolvePrimitiveCategory(input: string): PrimitiveCategoryId | undefined {
	const normalized = input.trim().toLowerCase();
	if (!normalized) return undefined;
	const matches = PRIMITIVE_CATEGORY_IDS.filter(category => category.startsWith(normalized));
	return matches.length === 1 ? matches[0] : undefined;
}

function matchesFilter(item: { readonly label: string; readonly summary?: string }, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return `${item.label}\n${item.summary ?? ""}`.toLowerCase().includes(needle);
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
	return visible[Math.min(state.categoryIndex, Math.max(0, visible.length - 1))];
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
	return items[Math.min(state.itemIndex, Math.max(0, items.length - 1))];
}

export function movePrimitiveSelection(
	categories: readonly PrimitiveInspectorCategory[],
	state: PrimitiveInspectorState,
	delta: number,
): PrimitiveInspectorState {
	if (state.depth === 2) {
		return { ...state, detailOffset: Math.max(0, state.detailOffset + delta) };
	}
	const count =
		state.depth === 0
			? visiblePrimitiveCategories(categories, state).length
			: visiblePrimitiveItems(categories, state).length;
	if (count === 0) return state;
	const current = state.depth === 0 ? state.categoryIndex : state.itemIndex;
	const next = (current + delta + count) % count;
	return state.depth === 0
		? { ...state, categoryIndex: next, itemIndex: 0, detailOffset: 0 }
		: { ...state, itemIndex: next, detailOffset: 0 };
}

export function drillIntoPrimitive(
	categories: readonly PrimitiveInspectorCategory[],
	state: PrimitiveInspectorState,
): PrimitiveInspectorState {
	if (state.depth === 0) {
		const category = selectedPrimitiveCategory(categories, state);
		if (!category) return state;
		return {
			...state,
			depth: 1,
			categoryIndex: categories.findIndex(candidate => candidate.id === category.id),
			itemIndex: 0,
			filterQuery: "",
			detailOffset: 0,
		};
	}
	if (state.depth === 1 && selectedPrimitiveItem(categories, state)) {
		return { ...state, depth: 2, filterQuery: "", detailOffset: 0 };
	}
	return state;
}

export function unwindPrimitiveInspector(state: PrimitiveInspectorState): PrimitiveInspectorState | undefined {
	if (state.filterEditing) return { ...state, filterEditing: false };
	if (state.filterQuery) return { ...state, filterQuery: "", itemIndex: 0, categoryIndex: 0 };
	if (state.depth === 2) return { ...state, depth: 1, detailOffset: 0 };
	if (state.depth === 1) return { ...state, depth: 0, itemIndex: 0 };
	return undefined;
}

export function beginPrimitiveFilter(state: PrimitiveInspectorState): PrimitiveInspectorState {
	return { ...state, filterEditing: true };
}

export function updatePrimitiveFilter(state: PrimitiveInspectorState, query: string): PrimitiveInspectorState {
	return {
		...state,
		filterQuery: query,
		categoryIndex: state.depth === 0 ? 0 : state.categoryIndex,
		itemIndex: 0,
		detailOffset: 0,
	};
}
