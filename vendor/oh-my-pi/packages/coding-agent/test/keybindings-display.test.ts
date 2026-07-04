import { describe, expect, it } from "bun:test";
import { getDefaultPasteImageKeys, KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";

describe("KeybindingsManager.getDisplayString", () => {
	it("formats a single binding as a human-readable key hint", () => {
		const keybindings = KeybindingsManager.inMemory({
			"app.message.dequeue": "alt+up",
		});

		expect(keybindings.getDisplayString("app.message.dequeue")).toBe("Alt+Up");
	});

	it("formats multiple bindings with the existing separator", () => {
		const keybindings = KeybindingsManager.inMemory({
			"app.clipboard.copyPrompt": ["alt+shift+c", "ctrl+shift+c"],
		});

		expect(keybindings.getDisplayString("app.clipboard.copyPrompt")).toBe("Alt+Shift+C/Ctrl+Shift+C");
	});

	it("returns an empty string when the action has no binding", () => {
		const keybindings = KeybindingsManager.inMemory({
			"app.clipboard.copyPrompt": [],
		});

		expect(keybindings.getDisplayString("app.clipboard.copyPrompt")).toBe("");
	});

	it("keeps session/tree defaults off editor word-navigation chords", () => {
		const keybindings = KeybindingsManager.inMemory();

		expect(keybindings.getKeys("app.session.observe")).toEqual(["ctrl+s"]);
		expect(keybindings.getKeys("app.session.toggleSort")).toEqual(["ctrl+shift+s"]);
		expect(keybindings.getKeys("app.tree.foldOrUp")).toEqual(["ctrl+shift+left"]);
		expect(keybindings.getKeys("app.tree.unfoldOrDown")).toEqual(["ctrl+shift+right"]);
	});
});

describe("getDefaultPasteImageKeys", () => {
	it("keeps Ctrl+V registered for image paste on Windows alongside the terminal-safe fallback", () => {
		expect(getDefaultPasteImageKeys("win32")).toEqual(["ctrl+v", "alt+v"]);
	});

	it("uses Ctrl+V as the image-paste shortcut on non-Windows platforms", () => {
		expect(getDefaultPasteImageKeys("linux")).toEqual(["ctrl+v"]);
		expect(getDefaultPasteImageKeys("darwin")).toEqual(["ctrl+v"]);
	});
});
