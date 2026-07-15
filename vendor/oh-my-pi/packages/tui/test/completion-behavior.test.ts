import { describe, expect, it } from "bun:test";
import { CompletionBehavior } from "@oh-my-pi/pi-tui/completion-behavior";

describe("CompletionBehavior", () => {
	it("wraps selection in both directions and clamps page movement", () => {
		const behavior = new CompletionBehavior(["one", "two", "three"]);

		expect(behavior.selectedItem).toBe("one");
		expect(behavior.cycle(-1)).toBe("three");
		expect(behavior.selectedIndex).toBe(2);
		expect(behavior.cycle(1)).toBe("one");
		expect(behavior.page(1, 2)).toBe("three");
		expect(behavior.page(1, 2)).toBe("three");
		expect(behavior.page(-1, 20)).toBe("one");
	});

	it("uses open navigation for selection and closed navigation for history", () => {
		const behavior = new CompletionBehavior(["alpha", "beta"]);
		behavior.loadHistory(["old", "new"]);

		expect(behavior.navigate(1, "draft")).toEqual({ kind: "selection", item: "beta", index: 1 });
		expect(behavior.historyCursor).toBe(2);

		behavior.dismiss();
		expect(behavior.navigate(-1, "draft")).toEqual({ kind: "history", value: "new" });
		expect(behavior.selectedIndex).toBe(1);
	});

	it("recalls newest history first, restores the draft, and stays within bounds", () => {
		const behavior = new CompletionBehavior<string>();
		behavior.loadHistory(["first", "second", "third"]);

		expect(behavior.navigate(-1, "unfinished")).toEqual({ kind: "history", value: "third" });
		expect(behavior.draft).toBe("unfinished");
		expect(behavior.navigate(-1, "third")).toEqual({ kind: "history", value: "second" });
		expect(behavior.navigate(-1, "second")).toEqual({ kind: "history", value: "first" });
		expect(behavior.navigate(-1, "first")).toEqual({ kind: "history", value: "first" });
		expect(behavior.historyCursor).toBe(0);

		expect(behavior.navigate(1, "first")).toEqual({ kind: "history", value: "second" });
		expect(behavior.navigate(1, "second")).toEqual({ kind: "history", value: "third" });
		expect(behavior.navigate(1, "third")).toEqual({ kind: "history", value: "unfinished" });
		expect(behavior.navigate(1, "unfinished")).toEqual({ kind: "history", value: "unfinished" });
		expect(behavior.historyCursor).toBe(3);
	});

	it("records history in recall order and resets navigation", () => {
		const behavior = new CompletionBehavior<string>();
		behavior.loadHistory(["one"]);
		behavior.recordHistory("two");
		behavior.recordHistory("two");

		expect(behavior.history).toEqual(["one", "two"]);
		expect(behavior.historyCursor).toBe(2);
		expect(behavior.navigate(-1, "draft")).toEqual({ kind: "history", value: "two" });
	});

	it("accepts the selected item and closes the menu", () => {
		const behavior = new CompletionBehavior(["one", "two"]);
		behavior.cycle(1);

		expect(behavior.accept()).toBe("two");
		expect(behavior.isOpen).toBe(false);
		expect(behavior.accept()).toBeUndefined();
	});

	it("dismisses without clearing items and can reopen them", () => {
		const behavior = new CompletionBehavior(["one", "two"]);

		expect(behavior.dismiss()).toBe(true);
		expect(behavior.dismiss()).toBe(false);
		expect(behavior.items).toEqual(["one", "two"]);
		expect(behavior.open()).toBe(true);
		expect(behavior.selectedItem).toBe("one");

		behavior.setItems([]);
		expect(behavior.isOpen).toBe(false);
		expect(behavior.open()).toBe(false);
	});
});
