import { parseSubcommand } from "./helpers/parse";
import type { ParsedSlashCommand, SlashCommandSpec, TuiSlashCommandRuntime } from "./types";

const VIM_USAGE = "Usage: /vim [on|off|status]";
const VIM_PERSISTENCE_HINT = "Session-local; set editor.vim: true in config.yml to persist.";

type VimAction = "toggle" | "on" | "off" | "status" | "usage";

function parseVimAction(args: string): VimAction {
	const { verb, rest } = parseSubcommand(args);
	if (rest) return "usage";
	switch (verb) {
		case "":
			return "toggle";
		case "on":
		case "off":
		case "status":
			return verb;
		default:
			return "usage";
	}
}

function formatVimStatus(runtime: TuiSlashCommandRuntime): string {
	const editor = runtime.ctx.editor;
	const enabled = editor.isVimEnabled();
	const mode = editor.getVimMode() ?? "disabled";
	return `Vim mode ${enabled ? "enabled" : "disabled"} (mode: ${mode}). ${VIM_PERSISTENCE_HINT}`;
}

function reportVimStatus(runtime: TuiSlashCommandRuntime): void {
	runtime.ctx.showStatus(formatVimStatus(runtime));
	runtime.ctx.editor.setText("");
}

export function handleVimCommand(command: ParsedSlashCommand, runtime: TuiSlashCommandRuntime): void {
	const editor = runtime.ctx.editor;
	switch (parseVimAction(command.args)) {
		case "toggle":
			editor.setVimEnabled(!editor.isVimEnabled());
			reportVimStatus(runtime);
			return;
		case "on":
			editor.setVimEnabled(true);
			reportVimStatus(runtime);
			return;
		case "off":
			editor.setVimEnabled(false);
			reportVimStatus(runtime);
			return;
		case "status":
			reportVimStatus(runtime);
			return;
		case "usage":
			runtime.ctx.showStatus(VIM_USAGE);
			editor.setText("");
	}
}

export const VIM_COMMAND_SPEC: SlashCommandSpec = {
	name: "vim",
	description: "Toggle Vim editing for the active editor",
	allowArgs: true,
	focusedViewSafe: true,
	subcommands: [
		{ name: "on", description: "Enable Vim editing" },
		{ name: "off", description: "Disable Vim editing" },
		{ name: "status", description: "Show Vim editing status" },
	],
	handleTui: handleVimCommand,
};
