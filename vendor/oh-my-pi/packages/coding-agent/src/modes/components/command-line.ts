import { Container, Input, matchesKey } from "@oh-my-pi/pi-tui";
import { executeBuiltinSlashCommand } from "../../slash-commands/builtin-registry";
import {
	COMMAND_MODE_COMMANDS,
	type CommandModeCommand,
	type CommandModeContext,
	dispatchCommandLine,
	parseCommandLine,
} from "../command-registry";
import { toggleRichTranscript, toggleTranscriptWrap } from "../transcript-commands";
import type { InteractiveModeContext } from "../types";

/** Single-line footer prompt for Vim-style colon commands. */
export class CommandLineComponent extends Container {
	readonly input = new Input();

	constructor(
		private readonly ctx: CommandModeContext,
		private readonly onDone: () => void,
		private readonly commands: readonly CommandModeCommand[] = COMMAND_MODE_COMMANDS,
	) {
		super();
		this.input.prompt = ":";
		this.input.onEscape = this.onDone;
		this.input.onSubmit = value => {
			this.onDone();
			void dispatchCommandLine(value, this.ctx, this.commands);
		};
		this.addChild(this.input);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "tab")) {
			const { name } = parseCommandLine(this.input.getValue());
			const matches = this.commands.filter(command => command.name.startsWith(name));
			if (matches.length === 1) this.input.setValue(matches[0].name);
			return;
		}
		this.input.handleInput(data);
	}
}

const installedContexts = new WeakSet<InteractiveModeContext>();

/** Install the normal-context `:` route once for a main-view input controller. */
export function installCommandLine(ctx: InteractiveModeContext): void {
	if (installedContexts.has(ctx)) return;
	installedContexts.add(ctx);
	const show = (): void => {
		if (ctx.ui.getFocused() !== ctx.editor || ctx.editor.getText().length > 0 || ctx.focusedAgentId) return;
		const done = (): void => {
			ctx.editorContainer.clear();
			ctx.editorContainer.addChild(ctx.editor);
			ctx.ui.setFocus(ctx.editor);
			ctx.ui.requestRender();
		};
		const commandLine = new CommandLineComponent(
			{
				toggleWrap: () => toggleTranscriptWrap(ctx),
				toggleRich: () => toggleRichTranscript(ctx),
				runVersion: () => executeBuiltinSlashCommand("/version", { ctx }),
				showFeedback: message => ctx.showStatus(message),
			},
			done,
		);
		ctx.editorContainer.clear();
		ctx.editorContainer.addChild(commandLine);
		ctx.ui.setFocus(commandLine.input);
		ctx.ui.requestRender();
	};
	ctx.ui.addInputListener(data => {
		if (data !== ":" || ctx.ui.getFocused() !== ctx.editor || ctx.editor.getText().length > 0 || ctx.focusedAgentId)
			return undefined;
		show();
		return { consume: true };
	});
}
