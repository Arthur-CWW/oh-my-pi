import { describe, expect, it } from "bun:test";
import {
	createVimState,
	reduceVimKey,
	type VimEffect,
	type VimKey,
	type VimMode,
} from "../src/vim-grammar";

const key = (char: string): VimKey => ({ char });
const ctrl = (char: string): VimKey => ({ char, ctrl: true });

function step(mode: VimMode, ...keys: VimKey[]) {
	let state = createVimState(mode);
	let effects: VimEffect[] = [];
	for (const input of keys) {
		const result = reduceVimKey(state, input);
		state = result.state;
		effects = result.effects;
	}
	return { state, effects };
}

function firstEffect(mode: VimMode, ...keys: VimKey[]): VimEffect {
	const result = step(mode, ...keys).effects[0];
	expect(result).toBeDefined();
	return result as VimEffect;
}

describe("pure Vim grammar reducer", () => {
	it("passes ordinary insert input through and closes an insert session on Escape", () => {
		const typed = firstEffect("insert", key("x"));
		expect(typed.type).toBe("passthrough");
		if (typed.type === "passthrough") expect(typed.key.char).toBe("x");

		const escaped = step("insert", key("escape"));
		expect(escaped.state.mode).toBe("normal");
		expect(escaped.effects.map((effect) => effect.type)).toEqual(["end-insert-session", "mode"]);
	});

	it("covers every normal motion family", () => {
		for (const motion of ["h", "j", "k", "l", "w", "W", "b", "B", "e", "E", "0", "^", "$"] as const) {
			const effect = firstEffect("normal", key(motion));
			expect(effect).toMatchObject({ type: "motion", motion, count: 1, explicit: false });
		}
		expect(firstEffect("normal", key("g"), key("g"))).toMatchObject({ type: "motion", motion: "gg", count: 1 });
		expect(firstEffect("normal", key("G"))).toMatchObject({ type: "motion", motion: "G", count: 1, explicit: false });
	});

	it("supports counts and multiplies operator and motion counts", () => {
		expect(firstEffect("normal", key("3"), key("w"))).toMatchObject({ type: "motion", motion: "w", count: 3, explicit: true });
		expect(firstEffect("normal", key("2"), key("g"), key("g"))).toMatchObject({ type: "motion", motion: "gg", count: 2, explicit: true });
		expect(firstEffect("normal", key("2"), key("d"), key("3"), key("w"))).toMatchObject({
		 type: "delete",
		target: { kind: "motion", motion: "w", count: 6, linewise: false },
		});
		expect(firstEffect("normal", key("2"), key("d"), key("d"))).toMatchObject({ type: "delete", target: { kind: "line", count: 2, linewise: true } });
	});

	it("emits all insert-entry variants", () => {
		const variants = [
			["i", "cursor"],
			["I", "line-start"],
			["a", "after-cursor"],
			["A", "line-end"],
			["o", "open-below"],
			["O", "open-above"],
		] as const;
		for (const [input, variant] of variants) {
			const result = step("normal", key(input));
			expect(result.state.mode).toBe("insert");
			expect(result.effects).toContainEqual({ type: "enter-insert", variant, count: 1 });
			expect(result.effects).toContainEqual({ type: "mode", mode: "insert" });
		}
		expect(firstEffect("normal", key("2"), key("o"))).toEqual({ type: "enter-insert", variant: "open-below", count: 2 });
	});

	it("covers direct edits, line edits, replacement, undo, redo, and puts", () => {
		expect(firstEffect("normal", key("x"))).toMatchObject({ type: "delete", target: { kind: "characters", direction: "forward", count: 1 } });
		expect(firstEffect("normal", key("X"))).toMatchObject({ type: "delete", target: { kind: "characters", direction: "backward", count: 1 } });
		expect(firstEffect("normal", key("D"))).toMatchObject({ type: "delete", target: { kind: "line-end" } });
		expect(firstEffect("normal", key("Y"))).toMatchObject({ type: "yank", target: { kind: "line", linewise: true } });
		expect(firstEffect("normal", key("C"))).toMatchObject({ type: "change", target: { kind: "line-end" } });
		expect(firstEffect("normal", key("s"))).toMatchObject({ type: "delete", target: { kind: "characters", direction: "forward", count: 1 } });
		expect(firstEffect("normal", key("S"))).toMatchObject({ type: "change", target: { kind: "line", linewise: true } });
		expect(firstEffect("normal", key("u"))).toEqual({ type: "undo", count: 1 });
		expect(firstEffect("normal", ctrl("r"))).toEqual({ type: "redo", count: 1 });
		expect(step("normal", key("r")).state.pendingR).toBe(1);
		expect(firstEffect("normal", key("2"), key("r"), key("q"))).toEqual({ type: "replace-char", char: "q", count: 2 });
	});

	it("preserves charwise and linewise register metadata for put effects", () => {
		const charwise = createVimState("normal", { text: "abc", linewise: false });
		const charPut = reduceVimKey(charwise, key("p")).effects[0];
		expect(charPut).toEqual({ type: "put", before: false, count: 1, register: { text: "abc", linewise: false } });

		const linewise = createVimState("normal", { text: "one\ntwo", linewise: true });
		const linePut = reduceVimKey(linewise, key("P")).effects[0];
		expect(linePut).toEqual({ type: "put", before: true, count: 1, register: { text: "one\ntwo", linewise: true } });

		const selected = step("normal", key('"'), key("+"), key("p"));
		expect(selected.effects[0]).toMatchObject({ type: "put", registerName: "+" });
	});

	it("supports visual selection modes and selection operations", () => {
		const visual = step("normal", key("v"));
		expect(visual.state.mode).toBe("visual");
		expect(visual.state.visualAnchor).toBe("cursor");
		expect(visual.effects).toContainEqual({ type: "set-visual-anchor", anchor: "cursor" });
		expect(step("normal", key("V")).state.mode).toBe("visualLine");
		expect(firstEffect("visual", key("h"))).toMatchObject({ type: "motion", motion: "h" });
		expect(firstEffect("visual", key("o"))).toEqual({ type: "swap-visual-anchor" });
		expect(firstEffect("visual", key("d"))).toMatchObject({ type: "delete", target: { kind: "visual", linewise: false } });
		expect(firstEffect("visual", key("c"))).toMatchObject({ type: "change", target: { kind: "visual", linewise: false } });
		expect(firstEffect("visual", key("y"))).toMatchObject({ type: "yank", target: { kind: "visual", linewise: false } });
		expect(firstEffect("visualLine", key("D"))).toMatchObject({ type: "delete", target: { kind: "visual", linewise: true } });
		expect(firstEffect("visual", key("C"))).toMatchObject({ type: "change", target: { kind: "visual", linewise: true } });
		expect(firstEffect("visual", key("Y"))).toMatchObject({ type: "yank", target: { kind: "visual", linewise: true } });
		expect(step("visual", key("v")).state.mode).toBe("normal");
		expect(step("visualLine", key("V")).state.mode).toBe("normal");
		expect(step("visual", key("escape")).state.mode).toBe("normal");
	});

	it("cancels every pending grammar sequence with Escape", () => {
		expect(step("normal", key("2"), key("escape")).state.pendingCount).toBe(0);
		expect(step("normal", key("d"), key("escape")).state.pendingOperator).toBeUndefined();
		expect(step("normal", key("g"), key("escape")).state.pendingG).toBe(false);
		expect(step("normal", key("r"), key("escape")).state.pendingR).toBe(0);
		expect(step("normal", key('"'), key("escape")).state.pendingRegisterQuote).toBe(false);
	});

	it("classifies app-level control input as passthrough", () => {
		const control = firstEffect("normal", ctrl("c"));
		expect(control.type).toBe("passthrough");
		const visualControl = firstEffect("visual", ctrl("p"));
		expect(visualControl.type).toBe("passthrough");
		const insertControl = firstEffect("insert", ctrl("k"));
		expect(insertControl.type).toBe("passthrough");
	});
});
