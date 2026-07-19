import { type Component, Container, Markdown, Spacer, Text } from "@oh-my-pi/pi-tui";
import { replaceTabs } from "../../tools/render-utils";
import { getMarkdownTheme, theme } from "../theme/theme";
import type { MvuEnvelope } from "../mvu/input-lease";
import type { Transition } from "../mvu/schema";
import { DynamicBorder } from "./dynamic-border";
import { keyHint } from "./keybinding-hints";

export type OmfgPanelState =
	| "generating"
	| "validating"
	| "confirming"
	| "saving"
	| "saved"
	| "rejected"
	| "aborted"
	| "error";

export interface OmfgPanelModel {
	readonly complaint: string;
	readonly state: OmfgPanelState;
	readonly status: string;
	readonly preview: string;
	readonly savedPath?: string;
	readonly errorMessage?: string;
}

export type OmfgPanelMsg =
	| { readonly _tag: "DraftDelta"; readonly delta: string }
	| { readonly _tag: "Rule"; readonly text: string }
	| { readonly _tag: "Status"; readonly state: OmfgPanelState; readonly status: string }
	| { readonly _tag: "Saved"; readonly path: string }
	| { readonly _tag: "Rejected" }
	| { readonly _tag: "Aborted" }
	| { readonly _tag: "Error"; readonly message: string }
	| { readonly _tag: "Input"; readonly envelope: MvuEnvelope };

export type OmfgPanelCommand =
	| { readonly _tag: "Render"; readonly model: OmfgPanelModel }
	| { readonly _tag: "CancelRequested" }
	| { readonly _tag: "CloseRequested" };

const dirtyKeys = new Set(["omfg.panel"]);

export function makeOmfgPanelModel(complaint: string): OmfgPanelModel {
	return { complaint, state: "generating", status: "Generating TTSR rule…", preview: "" };
}

export function updateOmfgPanel(
	model: OmfgPanelModel,
	msg: OmfgPanelMsg,
): Transition<OmfgPanelModel, OmfgPanelCommand> {
	let next: OmfgPanelModel = model;
	let command: OmfgPanelCommand | undefined;
	switch (msg._tag) {
		case "DraftDelta":
			next = msg.delta ? { ...model, preview: model.preview + msg.delta } : model;
			break;
		case "Rule":
			next = { ...model, preview: msg.text };
			break;
		case "Status":
			next = { ...model, state: msg.state, status: msg.status, errorMessage: undefined };
			break;
		case "Saved":
			next = { ...model, state: "saved", savedPath: msg.path, errorMessage: undefined };
			break;
		case "Rejected":
			next = { ...model, state: "rejected", errorMessage: undefined };
			break;
		case "Aborted":
			next = { ...model, state: "aborted", errorMessage: undefined };
			break;
		case "Error":
			next = { ...model, state: "error", errorMessage: msg.message };
			break;
		case "Input": {
			const action = String(msg.envelope.action);
			if (action === "app.interrupt" || action === "ui.dismiss") {
				command = model.state === "saved" || model.state === "rejected" || model.state === "aborted" || model.state === "error"
					? { _tag: "CloseRequested" }
					: { _tag: "CancelRequested" };
				next = model.state === "saved" || model.state === "rejected" || model.state === "aborted" || model.state === "error"
					? model
					: { ...model, state: "aborted", errorMessage: undefined };
			}
			break;
		}
	}
	return {
		model: next,
		commands: [
			...(command === undefined ? [] : [command]),
			{ _tag: "Render", model: next },
		],
		dirtyKeys,
	};
}

export interface OmfgPanelComponentOptions {
	readonly requestComponentRender: (component: Component) => void;
}

/** Renderer for the committed /omfg route model. It never receives terminal bytes. */
export class OmfgPanelComponent extends Container {
	readonly #requestComponentRender: (component: Component) => void;
	#model: OmfgPanelModel;
	#disposed = false;

	constructor(options: OmfgPanelComponentOptions, model: OmfgPanelModel) {
		super();
		this.#requestComponentRender = options.requestComponentRender;
		this.#model = model;
		this.#rebuild();
	}

	apply(model: OmfgPanelModel): void {
		if (this.#disposed) return;
		this.#model = model;
		this.#rebuild();
	}

	dispose(): void {
		this.#disposed = true;
		super.dispose?.();
	}

	#rebuild(): void {
		this.clear();
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", replaceTabs(this.#model.complaint)), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", replaceTabs(this.#model.status)), 1, 0));
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
			case "generating":
			case "validating":
			case "confirming":
			case "saving":
				return keyHint("app.interrupt", "cancel /omfg");
			case "saved":
				return `${theme.fg("success", `${theme.status.success} Saved to ${replaceTabs(this.#model.savedPath ?? "rule")}`)} · ${keyHint("ui.dismiss", "dismiss")}`;
			case "rejected":
				return `${theme.fg("warning", `${theme.status.warning} Not saved · `)}${keyHint("ui.dismiss", "dismiss")}`;
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
		const text = replaceTabs(this.#model.preview).trim();
		if (!text) return new Text(theme.fg("dim", "Waiting for generated rule…"), 1, 0);
		return new Markdown(text, 1, 0, getMarkdownTheme());
	}
}
