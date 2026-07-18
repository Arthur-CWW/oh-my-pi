import { beforeAll, describe, expect, it } from "bun:test";
import { getEditorTheme, initTheme } from "../../../src/modes/theme/theme";
import { CustomEditor } from "../../../src/modes/components/custom-editor";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

function editor(): CustomEditor {
	const value = new CustomEditor(getEditorTheme());
	value.setVimEnabled(true);
	return value;
}

function press(value: CustomEditor, keys: string): void {
	for (const key of keys) value.handleInput(key);
}

function paste(value: CustomEditor, text: string): void {
	value.handleInput(`${PASTE_START}${text}${PASTE_END}`);
}

describe("CustomEditor Vim integration", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("supports counted h/j/k/l motion", () => {
		const value = editor();
		value.setText("abcd\nefgh\nijkl");
		press(value, "\u001b");
		press(value, "0");
		press(value, "2l");
		press(value, "2j");
		expect(value.getCursor()).toEqual({ line: 2, col: 2 });
		press(value, "k");
		expect(value.getCursor()).toEqual({ line: 1, col: 2 });
	});

	it("round-trips linewise yy/dd/p and charwise d-motion", () => {
		const value = editor();
		value.setText("one\ntwo\nthree");
		press(value, "\u001bggyy p".replaceAll(" ", ""));
		expect(value.getText()).toBe("one\none\ntwo\nthree");

		const chars = editor();
		chars.setText("abc def");
		press(chars, "\u001b0dl");
		expect(chars.getText()).toBe("bc def");
	});

	it("groups insert sessions into one undo and supports undo/redo", () => {
		const value = editor();
		value.setText("a");
		press(value, "xyz\u001b");
		expect(value.getText()).toBe("axyz");
		press(value, "u");
		expect(value.getText()).toBe("a");
		press(value, "\u0012");
		expect(value.getText()).toBe("axyz");
	});

	it("supports visual delete/yank, x, and open-line variants", () => {
		const value = editor();
		value.setText("abcd");
		press(value, "\u001b0vld");
		expect(value.getText()).toBe("cd");

		const yank = editor();
		yank.setText("one\ntwo");
		press(yank, "\u001bggV y".replaceAll(" ", ""));
		press(yank, "p");
		expect(yank.getText()).toBe("one\none\ntwo");

		const open = editor();
		open.setText("a");
		press(open, "\u001b0oX\u001b");
		expect(open.getText()).toBe("a\nX");
		press(open, "OY\u001b");
		expect(open.getText()).toBe("a\nY\nX");
	});

	it("keeps bracketed paste in the insert session and normal paste atomic", () => {
		const insert = editor();
		paste(insert, "hello");
		press(insert, "\u001b");
		press(insert, "u");
		expect(insert.getText()).toBe("");

		const normal = editor();
		normal.setText("a");
		press(normal, "\u001b0");
		paste(normal, "X");
		expect(normal.getText()).toBe("Xa");
		press(normal, "u");
		expect(normal.getText()).toBe("a");
	});

	it("preserves paste undo across a vim toggle", () => {
		const value = editor();
		value.setText("a");
		press(value, "\u001b0");
		paste(value, "X");
		value.setVimEnabled(false);
		expect(value.getVimMode()).toBeNull();
		value.setVimEnabled(true);
		press(value, "u");
		expect(value.getText()).toBe("a");
	});

	it("lets configured app shortcuts win in normal mode", () => {
		const value = editor();
		press(value, "\u001b");
		let fired = 0;
		value.onCycleModelForward = () => fired++;
		press(value, "\u0010");
		expect(fired).toBe(1);
		expect(value.getVimMode()).toBe("normal");
	});
});
