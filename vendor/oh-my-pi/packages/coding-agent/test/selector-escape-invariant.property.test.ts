import { describe, expect, it } from "bun:test";
import { makeSelectorModel, updateSelector } from "../src/modes/mvu/selector";

describe("selector Back invariant", () => {
	it("unwinds Confirm, PreviewFocus, and Filter one layer at a time", () => {
		let model = makeSelectorModel(["first", "second"], 1);
		model = updateSelector(model, { _tag: "BeginFilter" }).model;
		model = updateSelector(model, { _tag: "Activate" }).model;
		model = updateSelector(model, { _tag: "Arm", action: "tui.select.confirm", nonce: "n1" }).model;
		const confirmBack = updateSelector(model, { _tag: "Back" });
		expect(confirmBack.model.mode._tag).toBe("PreviewFocus");
		expect(confirmBack.commands).toEqual([]);
		const previewBack = updateSelector(confirmBack.model, { _tag: "Back" });
		expect(previewBack.model.mode._tag).toBe("Filter");
		expect(previewBack.commands).toEqual([]);
		const filterBack = updateSelector(previewBack.model, { _tag: "Back" });
		expect(filterBack.model.mode._tag).toBe("Browse");
		expect(filterBack.commands).toEqual([]);
	});

	it("does not replace an active confirmation with a nested confirmation", () => {
		let model = makeSelectorModel(["first"], 1);
		model = updateSelector(model, { _tag: "Activate" }).model;
		model = updateSelector(model, { _tag: "Arm", action: "tui.select.confirm", nonce: "n1" }).model;
		const nested = updateSelector(model, { _tag: "Arm", action: "tui.select.confirm", nonce: "n2" });
		expect(nested.model).toBe(model);
		expect(nested.model.mode).toMatchObject({
			_tag: "Confirm",
			arm: { nonce: "n1" },
		});
	});

	it("only requests close at the root and never emits a destructive command", () => {
		const model = makeSelectorModel(["one"], 1);
		const result = updateSelector(model, { _tag: "Back" });
		expect(result.commands).toEqual([{ _tag: "CloseRequested" }]);
		expect(result.commands.some(command => command._tag === "SpendReset")).toBe(false);
	});
	it("rejects a settled preview from an earlier request for the same target", () => {
		const initial = makeSelectorModel(["same"], 9);
		const first = updateSelector(initial, { _tag: "Activate" });
		expect(first.commands).toEqual([{ _tag: "PreviewRequested", id: "same", requestGeneration: 1 }]);
		const backed = updateSelector(first.model, { _tag: "Back" }).model;
		const second = updateSelector(backed, { _tag: "Activate" });
		expect(second.commands).toEqual([{ _tag: "PreviewRequested", id: "same", requestGeneration: 2 }]);

		const stale = updateSelector(second.model, {
			_tag: "PreviewLoaded",
			id: "same",
			sourceRevision: 9,
			requestGeneration: 1,
			key: "stale",
		});
		expect(stale.model).toBe(second.model);

		const current = updateSelector(second.model, {
			_tag: "PreviewLoaded",
			id: "same",
			sourceRevision: 9,
			requestGeneration: 2,
			key: "current",
		});
		expect(current.model.preview).toMatchObject({ _tag: "Ready", key: "current", requestGeneration: 2 });
	});

});
