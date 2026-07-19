import { type Component, Container, Markdown, Spacer, Text } from "@oh-my-pi/pi-tui";
import { replaceTabs } from "../../tools/render-utils";
import { getMarkdownTheme, theme } from "../theme/theme";
import type { MvuEnvelope } from "../mvu/input-lease";
import type { Transition } from "../mvu/schema";
import { DynamicBorder } from "./dynamic-border";
import { keyHint } from "./keybinding-hints";

export type BtwPanelState = "running" | "complete" | "aborted" | "error";

export interface BtwPanelModel {
	readonly question: string;
	readonly answer: string;
	readonly state: BtwPanelState;
	readonly errorMessage?: string;
}

export type BtwPanelMsg =
	| { readonly _tag: "StreamDelta"; readonly delta: string }
	| { readonly _tag: "Answer"; readonly text: string }
	| { readonly _tag: "Complete" }
	| { readonly _tag: "Aborted" }
	| { readonly _tag: "Error"; readonly message: string }
	| { readonly _tag: "Input"; readonly envelope: MvuEnvelope };

export type BtwPanelCommand =
	| { readonly _tag: "Render"; readonly model: BtwPanelModel }
	| { readonly _tag: "CancelRequested" }
	| { readonly _tag: "CloseRequested" };

const dirtyKeys = new Set(["btw.panel"]);

export function makeBtwPanelModel(question: string): BtwPanelModel {
	return { question, answer: "", state: "running" };
}

export function updateBtwPanel(
	model: BtwPanelModel,
	msg: BtwPanelMsg,
): Transition<BtwPanelModel, BtwPanelCommand> {
	let next: BtwPanelModel | undefined;
	let command: BtwPanelCommand | undefined;
	switch (msg._tag) {
		case "StreamDelta":
			next = msg.delta ? { ...model, answer: model.answer + msg.delta } : model;
			break;
		case "Answer":
			next = { ...model, answer: msg.text };
			break;
		case "Complete":
			next = { ...model, state: "complete", errorMessage: undefined };
			break;
		case "Aborted":
			next = { ...model, state: "aborted", errorMessage: undefined };
			break;
		case "Error":
			next = { ...model, state: "error", errorMessage: msg.message };
			break;
		case "Input": {
			const action = String(msg.envelope.action);
			if (action === "app.interrupt" || (action === "ui.dismiss" && model.state === "running")) {
				command = { _tag: "CancelRequested" };
				next = { ...model, state: "aborted", errorMessage: undefined };
			} else if (action === "ui.dismiss") {
				command = { _tag: "CloseRequested" };
				next = model;
			} else {
				next = model;
			}
			break;
		}
	}
	return {
		model: next ?? model,
		commands: [
			...(command === undefined ? [] : [command]),
			{ _tag: "Render", model: next ?? model },
		],
		dirtyKeys,
	};
}

export interface BtwPanelComponentOptions {
	readonly requestComponentRender: (component: Component) => void;
}

/** Renderer for the committed /btw route model. It never receives terminal bytes. */
export class BtwPanelComponent extends Container {
	readonly #requestComponentRender: (component: Component) => void;
	#model: BtwPanelModel;
	#disposed = false;

	constructor(options: BtwPanelComponentOptions, model: BtwPanelModel) {
		super();
		this.#requestComponentRender = options.requestComponentRender;
		this.#model = model;
		this.#rebuild();
	}

	apply(model: BtwPanelModel): void {
		if (this.#disposed) return;
		this.#model = model;
		this.#rebuild();
	}

	override dispose(): void {
		this.#disposed = true;
		super.dispose?.();
	}

	#rebuild(): void {
		this.clear();
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", replaceTabs(this.#model.question)), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.#contentComponent());
		this.addChild(new Spacer(1));
		this.addChild(new Text(this.#footerLine(), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.#requestComponentRender(this);
	}

	#footerLine(): string {
		switch (this.#model.state) {
			case "running":
				return keyHint("app.interrupt", "cancel /btw");
			case "complete":
				return keyHint("ui.dismiss", "dismiss");
			case "aborted":
				return `${theme.fg("warning", `${theme.status.warning} Cancelled · `)}${keyHint("ui.dismiss", "dismiss")}`;
			case "error":
				return `${theme.fg("error", `${theme.status.error} Error · `)}${keyHint("ui.dismiss", "dismiss")}`;
		}
	}

	#contentComponent(): Component {
		if (this.#model.state === "error") {
			return new Text(theme.fg("error", replaceTabs(this.#model.errorMessage ?? "Unknown error")), 1, 0);
		}
		const text = replaceTabs(this.#model.answer).trim();
		if (!text) {
			const waiting = this.#model.state === "running" ? `${theme.status.pending} Waiting for response…` : "No text returned.";
			return new Text(theme.fg("dim", waiting), 1, 0);
		}
		return new Markdown(text, 1, 0, getMarkdownTheme());
	}
}
