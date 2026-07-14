export interface CommandModeContext {
	toggleWrap(): boolean;
	toggleRich(): boolean;
	runVersion(): unknown | Promise<unknown>;
	showFeedback(message: string): void;
}

export interface CommandModeCommand {
	readonly name: string;
	readonly description: string;
	run(ctx: CommandModeContext): void | Promise<void>;
}

export interface ParsedCommandLine {
	readonly name: string;
	readonly args: readonly string[];
}

export function parseCommandLine(value: string): ParsedCommandLine {
	const words = value.trim().replace(/^:/, "").trim().split(/\s+/).filter(Boolean);
	return { name: words[0]?.toLowerCase() ?? "", args: words.slice(1) };
}

export const COMMAND_MODE_COMMANDS: readonly CommandModeCommand[] = [
	{
		name: "wrap",
		description: "toggle wrapping for transcript body rows",
		run(ctx) {
			ctx.showFeedback(`Transcript wrapping: ${ctx.toggleWrap() ? "on" : "off"}`);
		},
	},
	{
		name: "rich",
		description: "toggle rich Markdown rendering for the main transcript",
		run(ctx) {
			ctx.showFeedback(`Rich transcript: ${ctx.toggleRich() ? "on" : "off"}`);
		},
	},
	{
		name: "version",
		description: "show OMP version information",
		run(ctx) {
			return ctx.runVersion();
		},
	},
];

export async function dispatchCommandLine(
	value: string,
	ctx: CommandModeContext,
	commands: readonly CommandModeCommand[] = COMMAND_MODE_COMMANDS,
): Promise<boolean> {
	const parsed = parseCommandLine(value);
	const command = commands.find(candidate => candidate.name === parsed.name);
	if (!command) {
		const entered = parsed.name ? ` "${parsed.name}"` : "";
		ctx.showFeedback(
			`Unknown command${entered}. Known commands: ${commands.map(candidate => candidate.name).join(", ")}`,
		);
		return false;
	}
	await command.run(ctx);
	return true;
}
