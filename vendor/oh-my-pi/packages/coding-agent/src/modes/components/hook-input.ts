/**
 * Renderer-only single-line input for the hook MVU route.
 *
 * Input ownership lives in the route runtime. This component only applies a
 * committed value and renders it; terminal input never reaches this widget.
 */
import { Container, Input, Markdown, Spacer, Text } from "@oh-my-pi/pi-tui";
import { getMarkdownTheme, theme } from "../../modes/theme/theme";
import { DynamicBorder } from "./dynamic-border";
import { keyHint, rawKeyHint } from "./keybinding-hints";

export interface HookInputModel {
	readonly title: string;
	readonly placeholder?: string;
	readonly value: string;
}

export type HookInputMsg =
	| { readonly _tag: "ValueChanged"; readonly value: string }
	| { readonly _tag: "Submit" }
	| { readonly _tag: "Back" };

export type HookInputCommand =
	| { readonly _tag: "Resolve"; readonly value: string }
	| { readonly _tag: "Cancel" };

export function makeHookInputModel(title: string, placeholder?: string): HookInputModel {
	return { title, ...(placeholder === undefined ? {} : { placeholder }), value: "" };
}

export function updateHookInput(
	model: HookInputModel,
	message: HookInputMsg,
): { readonly model: HookInputModel; readonly commands: readonly HookInputCommand[] } {
	switch (message._tag) {
		case "ValueChanged":
			return { model: { ...model, value: message.value }, commands: [] };
		case "Submit":
			return { model, commands: [{ _tag: "Resolve", value: model.value }] };
		case "Back":
			return { model, commands: [{ _tag: "Cancel" }] };
	}
}

export class HookInputComponent extends Container {
	readonly #input = new Input();
	readonly #titleComponent = new Markdown("", 1, 0, getMarkdownTheme(), { color: text => theme.fg("accent", text) });
	#model: HookInputModel = makeHookInputModel("");

	constructor(model?: HookInputModel) {
		super();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(this.#titleComponent);
		this.addChild(new Spacer(1));
		this.addChild(this.#input);
		this.addChild(new Spacer(1));
		this.addChild(new Text([rawKeyHint("enter", "submit"), keyHint("ui.dismiss", "cancel")].join("  "), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		if (model !== undefined) this.apply(model);
	}

	apply(model: HookInputModel): void {
		this.#model = model;
		this.#titleComponent.setText(theme.fg("accent", model.title));
		if (this.#input.getValue() !== model.value) this.#input.setValue(model.value);
		this.invalidate();
	}

	get model(): HookInputModel {
		return this.#model;
	}
}
