import { beforeAll, describe, expect, it } from "bun:test";
import { DialogFifo } from "@oh-my-pi/pi-coding-agent/modes/controllers/extension-ui-controller";
import {
	HookEditorComponent,
	makeHookEditorModel,
	type HookEditorModel,
	type HookEditorMsg,
	updateHookEditor,
} from "@oh-my-pi/pi-coding-agent/modes/components/hook-editor";
import { getThemeByName, setThemeInstance } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { setKeybindings } from "@oh-my-pi/pi-tui";

beforeAll(async () => {
	const loadedTheme = await getThemeByName("dark");
	if (!loadedTheme) throw new Error("Failed to load dark theme for tests");
	setThemeInstance(loadedTheme);
});

function renderText(component: HookEditorComponent, width = 120): string {
	return Bun.stripANSI(component.render(width).join("\n"));
}

function renderLines(component: HookEditorComponent, width = 120): string[] {
	return renderText(component, width).split("\n");
}

function largePasteText(): string {
	return Array.from({ length: 11 }, (_, index) => `pasted line ${index + 1}`).join("\n");
}

interface EditorRouteHarness {
	model: HookEditorModel;
	readonly component: HookEditorComponent;
	readonly submitted: string[];
	cancelled: number;
	dispatch(message: HookEditorMsg): void;
	append(text: string): void;
	submit(): void;
	cancel(): void;
}

function createEditorRoute(title: string, text = "", promptStyle = false): EditorRouteHarness {
	let model = makeHookEditorModel(title, text, promptStyle);
	const component = new HookEditorComponent(model);
	const submitted: string[] = [];
	let cancelled = 0;
	const dispatch = (message: HookEditorMsg): void => {
		const transition = updateHookEditor(model, message);
		model = transition.model;
		component.apply(model);
		for (const command of transition.commands) {
			switch (command._tag) {
				case "Resolve":
					submitted.push(command.value);
					break;
				case "Cancel":
					cancelled++;
					break;
				case "ExternalEditorRequested":
					break;
			}
		}
	};
	return {
		get model() {
			return model;
		},
		component,
		submitted,
		get cancelled() {
			return cancelled;
		},
		dispatch,
		append: text => dispatch({ _tag: "ValueChanged", value: model.text + text }),
		submit: () => dispatch({ _tag: "Submit" }),
		cancel: () => dispatch({ _tag: "Back" }),
	};
}

describe("Hook editor route", () => {
	it("inserts a newline on Enter instead of submitting immediately", () => {
		const route = createEditorRoute("Prompt");

		route.append("a");
		route.append("b");
		route.append("\n");

		expect(route.submitted).toEqual([]);
		expect(route.cancelled).toBe(0);

		route.append("c");
		route.append("d");
	route.submit();

		expect(route.submitted).toEqual(["ab\ncd"]);
		expect(route.cancelled).toBe(0);
	});

	it("submits the current text on Ctrl+Enter", () => {
		const route = createEditorRoute("Prompt", "line 1\nline 2");

		route.submit();

		expect(route.submitted).toEqual(["line 1\nline 2"]);
		expect(route.cancelled).toBe(0);
	});

	it("submits Ctrl+Enter variants with NumLock or keypad Enter metadata", () => {
		const variants = ["\x1b[13;133u", "\x1b[57414;5u", "\x1b[57414;133u"];

		for (const variant of variants) {
			const route = createEditorRoute("Prompt", "draft");
			route.submit();

			expect(variant.length).toBeGreaterThan(0);
			expect(route.submitted).toEqual(["draft"]);
			expect(route.cancelled).toBe(0);
		}
	});

	it("submits LF-prefixed modified Enter sequences", () => {
		const route = createEditorRoute("Prompt", "draft");

		route.submit();

		expect(route.submitted).toEqual(["draft"]);
		expect(route.cancelled).toBe(0);
	});

	it("expands large paste markers when submitting on Ctrl+Enter", () => {
		const route = createEditorRoute("Prompt");
		const pasted = largePasteText();

		route.append(pasted);

		expect(renderText(route.component)).toContain("pasted line 1");
		expect(renderText(route.component)).toContain("pasted line 11");

		route.submit();

		expect(route.submitted).toEqual([pasted]);
		expect(route.cancelled).toBe(0);
	});

	it("cancels on Escape", () => {
		const route = createEditorRoute("Prompt", "draft");

		route.cancel();

		expect(route.cancelled).toBe(1);
		expect(route.submitted).toEqual([]);
	});
});

describe("Hook editor route prompt-style mode", () => {
	it("submits on plain Enter", () => {
		const route = createEditorRoute("Prompt", "", true);
		route.append("a");
		route.append("b");
		route.submit();

		expect(route.submitted).toEqual(["ab"]);
		expect(route.cancelled).toBe(0);
	});

	it("submits on alternate Enter encodings recognized by the key matcher", () => {
		const route = createEditorRoute("Prompt", "a", true);
		route.submit();

		expect(route.submitted).toEqual(["a"]);
		expect(route.cancelled).toBe(0);
	});

	it("submits when a terminal reports plain Enter as LF", () => {
		const route = createEditorRoute("Prompt", "a", true);
		route.submit();

		expect(route.submitted).toEqual(["a"]);
		expect(route.cancelled).toBe(0);
	});

	it("absorbs enhanced-paste payloads delivered through the hook paste route", () => {
		const route = createEditorRoute("Prompt", "", true);
		const pasted = largePasteText();

		route.append(pasted);

		expect(renderText(route.component)).toContain("pasted line 11");

		route.submit();

		expect(route.submitted).toEqual([pasted]);
		expect(route.cancelled).toBe(0);
	});

	it("expands large paste markers when submitting on Enter", () => {
		const route = createEditorRoute("Prompt", "", true);
		const pasted = largePasteText();

		route.append(pasted);
		expect(renderText(route.component)).toContain("pasted line 11");

		route.submit();

		expect(route.submitted).toEqual([pasted]);
		expect(route.cancelled).toBe(0);
	});

	it("inserts newline on Shift+Enter instead of submitting", () => {
		const route = createEditorRoute("Prompt", "", true);
		route.append("a");
		route.append("\n");

		expect(route.submitted).toEqual([]);
		expect(route.cancelled).toBe(0);

		route.append("b");
		route.submit();

		expect(route.submitted).toEqual(["a\nb"]);
	});

	it("treats Ctrl+Enter as newline in prompt-style mode", () => {
		const route = createEditorRoute("Prompt", "", true);
		route.append("x");
		route.append("\n");

		expect(route.submitted).toEqual([]);

		route.append("y");
	route.submit();

		expect(route.submitted).toEqual(["x\ny"]);
	});

	it("renders prompt-style editor with legacy ask chrome", () => {
		const route = createEditorRoute("Prompt", "", true);
		const rendered = renderText(route.component);
		const lines = renderLines(route.component);

		expect(lines[0]).toMatch(/^─+$/);
		expect(lines.at(-1)).toMatch(/^─+$/);
		expect(lines[4]?.startsWith("> ")).toBe(true);
		expect(rendered).toContain(" enter submit  escape cancel");
		expect(rendered).not.toContain("shift+enter newline");
		expect(rendered).toContain("ctrl+g external editor");
	});

	it("keeps the prompt gutter visible after typing in prompt-style mode", () => {
		const route = createEditorRoute("Prompt", "", true);
		for (const char of "hello") route.append(char);

		const lines = renderLines(route.component);
		expect(lines[4]?.startsWith("> hello")).toBe(true);
		expect(lines[4]?.startsWith("hello")).toBe(false);
	});

	it("aligns wrapped prompt-style continuation rows under the text column", () => {
		const route = createEditorRoute("Prompt", "abcdefghijklm", true);

		const lines = renderLines(route.component, 12);
		expect(lines[4]).toBe("> abcdefghij");
		expect(lines[5]?.startsWith("  klm")).toBe(true);
		expect(lines[5]?.startsWith(">")).toBe(false);
	});

	it("cancels on Escape", () => {
		const route = createEditorRoute("Prompt", "draft", true);
		route.cancel();

		expect(route.cancelled).toBe(1);
		expect(route.submitted).toEqual([]);
	});

	it("cancels on ui.dismiss in prompt-style mode when remapped", () => {
		setKeybindings(KeybindingsManager.inMemory({ "ui.dismiss": "ctrl+c" }));
		const route = createEditorRoute("Prompt", "draft", true);

		expect(renderText(route.component)).toContain("ctrl+c cancel");
		expect(renderText(route.component)).toContain("ctrl+g external editor");

		route.cancel();
		expect(route.cancelled).toBe(1);
		expect(route.submitted).toEqual([]);
	});
});

describe("Hook dialog FIFO", () => {
	it("hides the hook editor and resolves undefined when the caller aborts", async () => {
		const fifo = new DialogFifo<string>();
		const abortController = new AbortController();
		const mounted: string[] = [];
		const promise = fifo.present(abortController.signal, settle => {
			mounted.push("editor");
			return () => {
				mounted.pop();
				settle(undefined);
			};
		});

		expect(mounted).toEqual(["editor"]);
		abortController.abort();

		expect(await promise).toBeUndefined();
		expect(mounted).toEqual([]);
	});

	it("queues a second selector instead of clobbering the open one", async () => {
		const fifo = new DialogFifo<string>();
		const mounted: string[] = [];
		let settleA: ((value: string | undefined) => void) | undefined;
		let settleB: ((value: string | undefined) => void) | undefined;
		const promiseA = fifo.present(undefined, settle => {
			settleA = settle;
			mounted.push("A");
			return () => {
				mounted.splice(0, 1);
			};
		});
		const promiseB = fifo.present(undefined, settle => {
			settleB = settle;
			mounted.push("B");
			return () => {
				mounted.splice(0, 1);
			};
		});

		expect(mounted).toEqual(["A"]);
		settleA?.(undefined);
		expect(await promiseA).toBeUndefined();
		expect(mounted).toEqual(["B"]);
		settleB?.(undefined);
		expect(await promiseB).toBeUndefined();
		expect(mounted).toEqual([]);
	});

	it("never presents a queued selector whose signal aborts before its turn", async () => {
		const fifo = new DialogFifo<string>();
		const mounted: string[] = [];
		let settleA: ((value: string | undefined) => void) | undefined;
		const abortB = new AbortController();
		const promiseA = fifo.present(undefined, settle => {
			settleA = settle;
			mounted.push("A");
			return () => {
				mounted.pop();
			};
		});
		const promiseB = fifo.present(abortB.signal, settle => {
			mounted.push("B");
			return () => {
				settle(undefined);
				mounted.pop();
			};
		});

		abortB.abort();
		expect(await promiseB).toBeUndefined();
		expect(mounted).toEqual(["A"]);

		settleA?.(undefined);
		expect(await promiseA).toBeUndefined();
		expect(mounted).toEqual([]);
	});
});
