/**
 * Renderer-only multi-line editor for the hook MVU route.
 *
 * The route reducer owns text editing and settlement. This component applies a
 * committed draft to pi-tui's editor widget and never consumes terminal input.
 */
import { Container, Editor, Spacer, Text } from "@oh-my-pi/pi-tui";
import { getEditorTheme, theme } from "../../modes/theme/theme";
import { nextTextBoundary, previousTextBoundary } from "../mvu/form-input";
import { DynamicBorder } from "./dynamic-border";
import { keyHint, rawKeyHint } from "./keybinding-hints";

export interface HookEditorModel {
	readonly title: string;
	readonly text: string;
	readonly cursor: number;
	readonly promptStyle: boolean;
}

export type HookEditorMsg =
	| { readonly _tag: "ValueChanged"; readonly value: string; readonly cursor?: number }
	| { readonly _tag: "InsertText"; readonly text: string }
	| { readonly _tag: "DeleteBackward" }
	| { readonly _tag: "MoveCursor"; readonly delta: -1 | 1 }
	| { readonly _tag: "Submit" }
	| { readonly _tag: "Back" }
	| { readonly _tag: "ExternalEditor" };

export type HookEditorCommand =
	| { readonly _tag: "Resolve"; readonly value: string }
	| { readonly _tag: "Cancel" }
	| { readonly _tag: "ExternalEditorRequested"; readonly value: string };

function clampCursor(text: string, cursor: number): number {
	return Math.max(0, Math.min(text.length, cursor));
}


export function makeHookEditorModel(title: string, text = "", promptStyle = false): HookEditorModel {
	return { title, text, cursor: text.length, promptStyle };
}

export function updateHookEditor(
	model: HookEditorModel,
	message: HookEditorMsg,
): { readonly model: HookEditorModel; readonly commands: readonly HookEditorCommand[] } {
	switch (message._tag) {
		case "ValueChanged":
			return {
				model: {
					...model,
					text: message.value,
					cursor: clampCursor(message.value, message.cursor ?? message.value.length),
				},
				commands: [],
			};
		case "InsertText": {
			if (message.text.length === 0) return { model, commands: [] };
			const cursor = clampCursor(model.text, model.cursor);
			return {
				model: {
					...model,
					text: model.text.slice(0, cursor) + message.text + model.text.slice(cursor),
					cursor: cursor + message.text.length,
				},
				commands: [],
			};
		}
		case "DeleteBackward": {
			const cursor = clampCursor(model.text, model.cursor);
			const previous = previousTextBoundary(model.text, cursor);
			return previous === cursor
				? { model, commands: [] }
				: {
						model: {
							...model,
							text: model.text.slice(0, previous) + model.text.slice(cursor),
							cursor: previous,
						},
						commands: [],
					};
		}
		case "MoveCursor": {
			const cursor = message.delta < 0
				? previousTextBoundary(model.text, model.cursor)
				: nextTextBoundary(model.text, model.cursor);
			return cursor === model.cursor ? { model, commands: [] } : { model: { ...model, cursor }, commands: [] };
		}
		case "Submit":
			return { model, commands: [{ _tag: "Resolve", value: model.text }] };
		case "Back":
			return { model, commands: [{ _tag: "Cancel" }] };
		case "ExternalEditor":
			return { model, commands: [{ _tag: "ExternalEditorRequested", value: model.text }] };
	}
}


export class HookEditorComponent extends Container {
	readonly #editor = new Editor(getEditorTheme());
	readonly #title = new Text("", 1, 0);
	readonly #footer = new Text("", 1, 0);
	#model: HookEditorModel = makeHookEditorModel("");

	constructor(model?: HookEditorModel) {
		super();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(this.#title);
		this.addChild(new Spacer(1));
		this.addChild(this.#editor);
		this.addChild(new Spacer(1));
		this.addChild(this.#footer);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		if (model !== undefined) this.apply(model);
	}

	apply(model: HookEditorModel): void {
		this.#model = model;
		this.#title.setText(theme.fg("accent", model.title));
		this.#editor.setBorderVisible(!model.promptStyle);
		this.#editor.setPromptGutter(model.promptStyle ? "> " : "");
		this.#footer.setText(
			[
				rawKeyHint(model.promptStyle ? "enter" : "ctrl+enter", "submit"),
				keyHint("ui.dismiss", "cancel"),
				rawKeyHint("ctrl+g", "external editor"),
			].join("  "),
		);
		this.#editor.disableSubmit = model.promptStyle;
		if (this.#editor.getExpandedText() !== model.text) this.#editor.setText(model.text);
		this.#editor.setCursorOffset(model.cursor);
		this.invalidate();
	}

	get model(): HookEditorModel {
		return this.#model;
	}
}
