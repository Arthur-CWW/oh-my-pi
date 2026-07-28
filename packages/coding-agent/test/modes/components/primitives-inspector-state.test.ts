import { describe, expect, test } from "bun:test";
import {
	beginPrimitiveFilter,
	createPrimitiveInspectorState,
	drillIntoPrimitive,
	movePrimitiveSelection,
	type PrimitiveInspectorCategory,
	resolvePrimitiveCategory,
	selectedPrimitiveCategory,
	selectedPrimitiveItem,
	unwindPrimitiveInspector,
	updatePrimitiveFilter,
	visiblePrimitiveCategories,
	visiblePrimitiveItems,
} from "../../../src/modes/components/primitives-inspector-state";

const categories: readonly PrimitiveInspectorCategory[] = [
	{
		id: "tools",
		label: "Tools",
		source: "live registry",
		available: true,
		items: [
			{ id: "read", label: "read", summary: "Read files and URLs", detail: "schema: path", enabled: true },
			{ id: "bash", label: "bash", summary: "Execute commands", detail: "schema: command", enabled: true },
		],
	},
	{
		id: "feeds",
		label: "Feeds",
		source: "feed://",
		available: true,
		items: [
			{ id: "omp", label: "omp", summary: "rss · 4 items", detail: "Digest tail" },
			{ id: "codex", label: "codex", summary: "page-hash · 2 items", detail: "Digest tail" },
		],
	},
	{
		id: "memories",
		label: "Memories",
		source: "~/.omp/agent/memory",
		available: false,
		items: [],
		unavailableDetail: "Memory backend is disabled.",
	},
];

describe("primitives inspector category projection", () => {
	test("projects live and unavailable categories without inventing rows", () => {
		const state = createPrimitiveInspectorState();
		expect(
			visiblePrimitiveCategories(categories, state).map(category => [category.label, category.items.length]),
		).toEqual([
			["Tools", 2],
			["Feeds", 2],
			["Memories", 0],
		]);
		expect(selectedPrimitiveCategory(categories, state)?.source).toBe("live registry");
	});

	test("filters categories at the root and items after drill-in", () => {
		const rootFiltered = updatePrimitiveFilter(createPrimitiveInspectorState(), "feed");
		expect(visiblePrimitiveCategories(categories, rootFiltered).map(category => category.id)).toEqual(["feeds"]);

		const feeds = drillIntoPrimitive(categories, rootFiltered);
		const itemFiltered = updatePrimitiveFilter(feeds, "page-hash");
		expect(visiblePrimitiveItems(categories, itemFiltered).map(item => item.id)).toEqual(["codex"]);
		expect(selectedPrimitiveItem(categories, itemFiltered)?.summary).toContain("2 items");
	});
});

describe("primitives inspector opening", () => {
	test("resolves unique category prefixes case-insensitively", () => {
		expect(resolvePrimitiveCategory("TOO")).toBe("tools");
		expect(resolvePrimitiveCategory("SeSs")).toBe("session");
		expect(resolvePrimitiveCategory("not-a-category")).toBeUndefined();
	});

	test("starts drilled into the requested category", () => {
		const state = createPrimitiveInspectorState(categories, "feeds");
		expect(state.depth).toBe(1);
		expect(selectedPrimitiveCategory(categories, state)?.id).toBe("feeds");
		expect(visiblePrimitiveItems(categories, state).map(item => item.id)).toEqual(["omp", "codex"]);
	});

	test("keeps the category list open for unknown categories", () => {
		const category = resolvePrimitiveCategory("bogus");
		const state = createPrimitiveInspectorState(categories, category);
		expect(category).toBeUndefined();
		expect(state.depth).toBe(0);
		expect(visiblePrimitiveCategories(categories, state).map(candidate => candidate.id)).toEqual([
			"tools",
			"feeds",
			"memories",
		]);
	});
});

describe("primitives inspector vim state", () => {
	test("j/k wraps selection at each navigable level", () => {
		const root = createPrimitiveInspectorState();
		const wrappedRoot = movePrimitiveSelection(categories, root, -1);
		expect(selectedPrimitiveCategory(categories, wrappedRoot)?.id).toBe("memories");

		const tools = drillIntoPrimitive(categories, root);
		const wrappedItems = movePrimitiveSelection(categories, tools, -1);
		expect(selectedPrimitiveItem(categories, wrappedItems)?.id).toBe("bash");
	});

	test("drills category to item to detail, then unwinds one level per escape", () => {
		const root = createPrimitiveInspectorState();
		const items = drillIntoPrimitive(categories, root);
		const detail = drillIntoPrimitive(categories, items);
		expect([root.depth, items.depth, detail.depth]).toEqual([0, 1, 2]);

		const backToItems = unwindPrimitiveInspector(detail);
		const backToRoot = unwindPrimitiveInspector(backToItems!);
		expect(backToItems?.depth).toBe(1);
		expect(backToRoot?.depth).toBe(0);
		expect(unwindPrimitiveInspector(backToRoot!)).toBeUndefined();
	});

	test("escape exits filter editing, then clears the query before unwinding", () => {
		const items = drillIntoPrimitive(categories, createPrimitiveInspectorState());
		const editing = updatePrimitiveFilter(beginPrimitiveFilter(items), "read");
		const normal = unwindPrimitiveInspector(editing)!;
		const cleared = unwindPrimitiveInspector(normal)!;
		const root = unwindPrimitiveInspector(cleared)!;
		expect(normal).toMatchObject({ depth: 1, filterEditing: false, filterQuery: "read" });
		expect(cleared).toMatchObject({ depth: 1, filterQuery: "" });
		expect(root.depth).toBe(0);
	});
});
