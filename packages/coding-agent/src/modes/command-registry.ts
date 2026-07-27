import type { CollabGuestLink } from "../collab/guest";
import {
	PRIMITIVE_CATEGORY_IDS,
	type PrimitiveCategoryId,
	resolvePrimitiveCategory,
} from "./components/primitives-inspector-state";
import { renderCommandShortcutSection } from "./interaction-registry";
import { formatSessionIdentity, type SessionIdentity, sessionIdentityHandle } from "./session-identity";

export interface CommandModeContext {
	readonly collabGuest?: CollabGuestLink;
	toggleWrap(): boolean;
	toggleRich(): boolean;
	handleErrorsCommand(args?: string): void;
	handleRouteCommand(args: readonly string[]): void | Promise<void>;
	showPrimitivesInspector(initialCategory?: PrimitiveCategoryId): Promise<void>;
	showCopySelector(): void;
	handleDumpCommand(isRaw?: boolean): void;
	handleJobsCommand(): Promise<void>;
	handleChangelogCommand(showFull?: boolean): Promise<void>;
	handleHotkeysCommand(): void;
	handleToolsCommand(showOutput?: (message: string) => void): void;
	handleContextCommand(): void;
	showVersion(): void | Promise<void>;
	showLoopStats(): void | Promise<void>;
	showTabs(): void | Promise<void>;
	getSessionIdentity(): SessionIdentity;
	copyIdentityHandle(handle: string): void | Promise<void>;
	bookmarkCurrent?(args: readonly string[]): void | Promise<void>;
	showBookmarks?(): void;
	readonly commands?: readonly CommandModeCommand[];
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
	readonly aliases?: readonly string[];
	/** Safe to expose while the transcript/editor is attached to a child agent. */
	readonly viewLocal?: boolean;
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

function commandNames(command: CommandModeCommand): readonly string[] {
	return [command.name, ...(command.aliases ?? [])];
}

export function commandModeCommandsForView(childFocused: boolean): readonly CommandModeCommand[] {
	return childFocused ? COMMAND_MODE_COMMANDS.filter(command => command.viewLocal) : COMMAND_MODE_COMMANDS;
}

function subcommandCompletion(subcommand: CommandModeSubcommand): CommandModeCompletion {
	return {
		value: subcommand.name,
		label: subcommand.name,
		description: subcommand.description,
		hint: subcommand.usage,
	};
}

function showGlobalCommandHelp(ctx: CommandModeContext): void {
	const commands = ctx.commands ?? COMMAND_MODE_COMMANDS;
	ctx.showFeedback(
		`${commands
			.map(command => {
				const aliases = command.aliases?.length
					? ` (alias ${command.aliases.map(alias => `:${alias}`).join(", ")})`
					: "";
				return `:${command.name}${aliases} — ${command.description}`;
			})
			.join("\n")}${renderCommandShortcutSection()}\n\nInside Agent Hub, press ? for selected-agent metadata and contextual keys.`,
	);
}

export const COMMAND_MODE_COMMANDS: readonly CommandModeCommand[] = [
	{
		name: "commands",
		description: "list TUI colon commands and shortcuts",
		viewLocal: true,
		run: showGlobalCommandHelp,
	},
	{
		name: "id",
		aliases: ["whoami"],
		description: "show and copy the focused session/agent identity",
		viewLocal: true,
		async run(ctx) {
			const identity = ctx.getSessionIdentity();
			await ctx.copyIdentityHandle(sessionIdentityHandle(identity));
			ctx.showFeedback(formatSessionIdentity(identity));
		},
	},
	{
		name: "help",
		description: "show global TUI commands and keyboard shortcuts",
		viewLocal: true,
		run: showGlobalCommandHelp,
	},
	{
		name: "route",
		description: "explain a current or previewed model route",
		inlineHint: "[agentId | preview <selector-or-role>]",
		subcommands: [{ name: "preview", description: "dry-run a spawn route", usage: "<selector-or-role>" }],
		viewLocal: true,
		hostOnly: true,
		run(ctx, args) {
			return ctx.handleRouteCommand(args);
		},
	},
	{
		name: "wrap",
		description: "toggle wrapping for transcript body rows",
		viewLocal: true,
		run(ctx) {
			ctx.showFeedback(`Transcript wrapping: ${ctx.toggleWrap() ? "on" : "off"}`);
		},
	},
	{
		name: "rich",
		description: "toggle rich Markdown rendering for the focused transcript",
		viewLocal: true,
		run(ctx) {
			ctx.showFeedback(`Rich transcript: ${ctx.toggleRich() ? "on" : "off"}`);
		},
	},
	{
		name: "errors",
		description: "view recent errors or clear history",
		viewLocal: true,
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
		viewLocal: true,
		hostOnly: true,
		run(ctx) {
			return ctx.showVersion();
		},
	},
	{
		name: "loopstats",
		description: "show event-loop watchdog violations and retained records",
		viewLocal: true,
		hostOnly: true,
		run(ctx) {
			return ctx.showLoopStats();
		},
	},
	{
		name: "tabs",
		description: "show the browser tab pool and ownership labels",
		viewLocal: true,
		hostOnly: true,
		run(ctx) {
			return ctx.showTabs();
		},
	},
	{
		name: "changelog",
		description: "show changelog entries",
		viewLocal: true,
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
		viewLocal: true,
		run(ctx) {
			ctx.handleHotkeysCommand();
		},
	},
	{
		name: "tools",
		description: "inspect registered tools and provenance",
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
	{
		name: "bookmark",
		description: "bookmark the current session or Hub selection",
		inlineHint: "[tag words…] [--note text]",
		viewLocal: true,
		run(ctx, args) {
			if (!ctx.bookmarkCurrent) {
				ctx.showFeedback("Bookmarks are unavailable in this view.");
				return;
			}
			return ctx.bookmarkCurrent(args);
		},
	},
	{
		name: "bookmarks",
		description: "list saved bookmarks and jump to one",
		viewLocal: true,
		run(ctx) {
			if (!ctx.showBookmarks) {
				ctx.showFeedback("Bookmarks are unavailable in this view.");
				return;
			}
			ctx.showBookmarks();
		},
	},
];

export const TUI_COLON_COMMAND_NAMES: ReadonlySet<string> = new Set(
	COMMAND_MODE_COMMANDS.flatMap(command => commandNames(command)),
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
	const hasWhitespace = /\s/.test(body);
	const resolved = commands
		.flatMap(command => commandNames(command).map(name => ({ command, name })))
		.find(candidate => candidate.name.toLowerCase() === commandToken);
	const command = resolved?.command;
	if (!command || !hasWhitespace) {
		const prefix = commandToken;
		return commands.flatMap(command =>
			commandNames(command)
				.filter(name => name.toLowerCase().startsWith(prefix))
				.map(name => commandCompletion({ ...command, name })),
		);
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
	const command = commands.find(candidate => commandNames(candidate).some(name => name.toLowerCase() === parsed.name));
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
