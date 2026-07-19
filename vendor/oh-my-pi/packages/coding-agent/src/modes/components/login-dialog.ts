import { truncateToWidth, type Component, type TUI, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import { theme } from "../../modes/theme/theme";
import { keyHint } from "./keybinding-hints";

export type OAuthPromptStage = "starting" | "auth" | "prompt" | "waiting" | "progress";

export interface OAuthPromptModel {
	readonly stage: OAuthPromptStage;
	readonly url: string | undefined;
	readonly instructions: string | undefined;
	readonly message: string | undefined;
	readonly placeholder: string | undefined;
	readonly draft: string;
}

export const EMPTY_OAUTH_PROMPT: OAuthPromptModel = {
	stage: "starting",
	url: undefined,
	instructions: undefined,
	message: undefined,
	placeholder: undefined,
	draft: "",
};

/** Renderer-only OAuth prompt. The owning setup reducer supplies every visible field. */
export class LoginDialogComponent implements Component {
	#projection: OAuthPromptModel = EMPTY_OAUTH_PROMPT;

	constructor(_tui?: TUI, _providerId?: string) {}

	apply(model: OAuthPromptModel): void {
		this.#projection = model;
	}

	render(width: number): readonly string[] {
		const model = this.#projection;
		const lines: string[] = [];
		if (model.url !== undefined) {
			lines.push(theme.bold("Browser login"));
			lines.push(`\x1b]8;;${model.url}\x07${theme.fg("accent", "Open login URL")}\x1b]8;;\x07`);
			lines.push(...wrapTextWithAnsi(theme.fg("dim", model.url), width));
		}
		if (model.instructions !== undefined) lines.push(...wrapTextWithAnsi(theme.fg("warning", model.instructions), width));
		if (model.message !== undefined) lines.push(...wrapTextWithAnsi(model.message, width));
		if (model.stage === "prompt") {
			const shown = model.draft.length === 0 && model.placeholder !== undefined
				? theme.fg("dim", model.placeholder)
				: model.draft;
			lines.push(truncateToWidth(`${theme.fg("accent", "> ")}${shown}`, width));
			lines.push(theme.fg("dim", `${keyHint("tui.select.confirm", "submit")} · ${keyHint("ui.dismiss", "cancel")}`));
		}
		if (model.stage === "starting" && lines.length === 0) lines.push(theme.fg("dim", "Starting OAuth flow…"));
		return lines;
	}
}
