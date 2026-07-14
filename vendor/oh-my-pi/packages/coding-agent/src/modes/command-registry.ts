import type { CollabGuestLink } from "../collab/guest";
import { PRIMITIVE_CATEGORY_IDS, resolvePrimitiveCategory, type PrimitiveCategoryId } from "./components/primitives-inspector-state";
import { renderCommandShortcutSection } from "./interaction-registry";

export interface CommandModeContext {
	readonly collabGuest?: CollabGuestLink;
	toggleWrap(): boolean;
	toggleRich(): boolean;
	handleErrorsCommand(args?: string): void;
	showPrimitivesInspector(initialCategory?: PrimitiveCategoryId): Promise<void>;
	showCopySelector(): void;
	handleDumpCommand(isRaw?: boolean): void;
	handleJobsCommand(): Promise<void>;
	handleChangelogCommand(showFull?: boolean): Promise<void>;
	handleHotkeysCommand(): void;
	handleToolsCommand(): void;
	handleContextCommand(): void;
	showVersion(): void | Promise<void>;
	showFeedback(message: string): void;
}

export interface CommandModeSubcommand {
	readonly name: string;
	readonly description: string;
	readonly usage?: string;
}

export interface CommandModeCommand {
	readonly name: string;
	readonly description: string;
	readonly subcommands?: readonly CommandModeSubcommand[];
	readonly inlineHint?: string;
	readonly hostOnly?: boolean;
	run(ctx: CommandModeContext, args: readonly string[]): void | Promise<void>;
}

export interface CommandModeCompletion {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
	readonly hint?: string;
}

export interface ParsedCommandLine {
	readonly name: string;
	readonly args: readonly string[];
}

export function parseCommandLine(value: string): ParsedCommandLine {
	const words = value.trim().replace(/^:/, "").trim().split(/\s+/).filter(Boolean);
	return { name: words[0]?.toLowerCase() ?? "", args: words.slice(1) };
}

const INSPECT_SUBCOMMANDS: readonly CommandModeSubcommand[] = PRIMITIVE_CATEGORY_IDS.map(name => ({
	name,
	description: `Inspect ${name}`,
}));

function commandCompletion(command: CommandModeCommand): CommandModeCompletion {
	return {
		value: command.name,
		label: command.name,
		description: command.description,
		hint: command.inlineHint,
	};
}

function subcommandCompletion(subcommand: CommandModeSubcommand): CommandModeCompletion {
	return {
		value: subcommand.name,
		label: subcommand.name,
		description: subcommand.description,
		hint: subcommand.usage,
	};
}

export const COMMAND_MODE_COMMANDS: readonly CommandModeCommand[] = [
	{
		name: "commands",
		description: "list TUI colon commands and shortcuts",
		run(ctx) {
			ctx.showFeedback(
				`${COMMAND_MODE_COMMANDS.map(command => `:${command.name} — ${command.description}`).join("\n")}${renderCommandShortcutSection()}`,
			);
		},
	},
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
		name: "errors",
		description: "view recent errors or clear history",
		subcommands: [
			{ name: "clear", description: "clear error history" },
			{ name: "resolve", description: "resolve an error by id", usage: "<id>" },
		],
		hostOnly: true,
		run(ctx, args) {
			ctx.handleErrorsCommand(args.join(" "));
		},
	},
	{
		name: "inspect",
		description: "open the read-only primitives inspector",
		inlineHint: "[category]",
		subcommands: INSPECT_SUBCOMMANDS,
		hostOnly: true,
		run(ctx, args) {
			const argument = args.join(" ").trim();
			const initialCategory = resolvePrimitiveCategory(argument);
			if (argument && !initialCategory) {
				ctx.showFeedback(
					`Unknown inspector category "${argument}". Valid categories: ${PRIMITIVE_CATEGORY_IDS.join(", ")}.`,
				);
				return;
			}
			return ctx.showPrimitivesInspector(initialCategory);
		},
	},
	{
		name: "copy",
		description: "pick text or code from the conversation to copy",
		run(ctx) {
			ctx.showCopySelector();
		},
	},
	{
		name: "dump",
		description: "copy session transcript to clipboard",
		inlineHint: "[raw]",
		run(ctx, args) {
			if (args.length > 1 || (args.length === 1 && args[0]?.toLowerCase() !== "raw")) {
				ctx.showFeedback("Usage: :dump [raw]");
				return;
			}
			ctx.handleDumpCommand(args[0]?.toLowerCase() === "raw");
		},
	},
	{
		name: "jobs",
		description: "show async background jobs status",
		hostOnly: true,
		run(ctx) {
			return ctx.handleJobsCommand();
		},
	},
	{
		name: "version",
		description: "show OMP version information",
		hostOnly: true,
		run(ctx) {
			return ctx.showVersion();
		},
	},
	{
		name: "changelog",
		description: "show changelog entries",
		subcommands: [{ name: "full", description: "show complete changelog" }],
		inlineHint: "[full]",
		hostOnly: true,
		run(ctx, args) {
			if (args.length > 1 || (args.length === 1 && args[0]?.toLowerCase() !== "full")) {
				ctx.showFeedback("Usage: :changelog [full]");
				return;
			}
			return ctx.handleChangelogCommand(args[0]?.toLowerCase() === "full");
		},
	},
	{
		name: "hotkeys",
		description: "show all keyboard shortcuts",
		run(ctx) {
			ctx.handleHotkeysCommand();
		},
	},
	{
		name: "tools",
		description: "show tools currently visible to the agent",
		hostOnly: true,
		run(ctx) {
			ctx.handleToolsCommand();
		},
	},
	{
		name: "context",
		description: "show estimated context usage breakdown",
		hostOnly: true,
		run(ctx) {
			ctx.handleContextCommand();
		},
	},
];

export const TUI_COLON_COMMAND_NAMES: ReadonlySet<string> = new Set(
	COMMAND_MODE_COMMANDS.map(command => command.name),
);

function splitCommandValue(value: string): { prefix: string; body: string; tokens: string[] } {
	const prefix = value.startsWith(":") ? ":" : "";
	const body = prefix ? value.slice(1) : value;
	return { prefix, body, tokens: body.trim().split(/\s+/).filter(Boolean) };
}

export function getCommandModeCompletions(
	value: string,
	commands: readonly CommandModeCommand[] = COMMAND_MODE_COMMANDS,
): readonly CommandModeCompletion[] {
	const { body, tokens } = splitCommandValue(value);
	const commandToken = tokens[0]?.toLowerCase() ?? "";
	const command = commands.find(candidate => candidate.name.toLowerCase() === commandToken);
	const hasWhitespace = /\s/.test(body);
	if (!command || !hasWhitespace) {
		const prefix = commandToken;
		return commands
			.filter(candidate => candidate.name.toLowerCase().startsWith(prefix))
			.map(commandCompletion);
	}

	if (!command.subcommands || tokens.length > 2) return [];
	const subcommandPrefix = tokens[1]?.toLowerCase() ?? "";
	return command.subcommands
		.filter(subcommand => subcommand.name.toLowerCase().startsWith(subcommandPrefix))
		.map(subcommandCompletion);
}

export function applyCommandModeCompletion(value: string, completion: CommandModeCompletion): string {
	const { prefix, body } = splitCommandValue(value);
	const commandMatch = /^(\S+)(\s+)(.*)$/s.exec(body);
	if (!commandMatch) return `${prefix}${completion.value}`;
	const commandName = commandMatch[1]!;
	const separator = commandMatch[2]!;
	const rest = commandMatch[3]!;
	if (!rest) return `${prefix}${commandName}${separator}${completion.value}`;
	const subcommandMatch = /^(\S+)(.*)$/s.exec(rest);
	if (!subcommandMatch) return `${prefix}${commandName}${separator}${completion.value}`;
	return `${prefix}${commandName}${separator}${completion.value}${subcommandMatch[2]}`;
}

export async function dispatchCommandLine(
	value: string,
	ctx: CommandModeContext,
	commands: readonly CommandModeCommand[] = COMMAND_MODE_COMMANDS,
): Promise<boolean> {
	const parsed = parseCommandLine(value);
	const command = commands.find(candidate => candidate.name.toLowerCase() === parsed.name);
	if (!command) {
		const entered = parsed.name ? ` "${parsed.name}"` : "";
		ctx.showFeedback(
			`Unknown command${entered}. Known commands: ${commands.map(candidate => `:${candidate.name}`).join(", ")}`,
		);
		return false;
	}
	if (command.hostOnly && ctx.collabGuest) {
		ctx.showFeedback(`:${command.name} is host-only during a collab session`);
		return true;
	}
	await command.run(ctx, parsed.args);
	return true;
}
