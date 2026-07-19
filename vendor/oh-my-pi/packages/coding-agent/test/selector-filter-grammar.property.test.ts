import { describe, expect, it } from "bun:test";
import { makeSelectorModel, updateSelector } from "../src/modes/mvu/selector";

describe("selector filter grammar", () => {
	it("treats printable j/k as filter text for every list size", () => {
		for (let size = 0; size <= 32; size += 1) {
			const ids = Array.from({ length: size }, (_, index) => `item-${index}`);
			const search = new Map(ids.map(id => [id, `${id} jk`]))
			let model = makeSelectorModel(ids, 1, search);
			model = updateSelector(model, { _tag: "BeginFilter" }).model;
			model = updateSelector(model, { _tag: "FilterAppend", text: "j" }).model;
			model = updateSelector(model, { _tag: "FilterAppend", text: "k" }).model;
			expect(model.mode).toEqual({ _tag: "Filter", query: "jk" });
			expect(model.selectedId).toBe(size === 0 ? undefined : "item-0");
		}
	});

	it("moves in Browse while the same j/k keys append in Filter", () => {
		const model = makeSelectorModel(["a", "b", "c"], 1, new Map([["a", "a"], ["b", "b"], ["c", "c"]]));
		const moved = updateSelector(model, { _tag: "Move", delta: 1 }).model;
		expect(moved.selectedId).toBe("b");
		const filtered = updateSelector(updateSelector(model, { _tag: "BeginFilter" }).model, {
			_tag: "FilterAppend",
			text: "j",
		}).model;
		expect(filtered.mode).toEqual({ _tag: "Filter", query: "j" });
		expect(filtered.selectedId).toBeUndefined();
	});
});
