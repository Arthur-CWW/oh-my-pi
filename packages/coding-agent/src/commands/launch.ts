/**
 * Root ("launch") command for the coding agent CLI.
 *
 * The Effect `Command` descriptor declares every launch flag/argument so the
 * shared help/version/completions machinery can introspect them. It is
 * intentionally handler-less: launch tolerates unknown extension flags at
 * startup and hands the *raw* argv to {@link runRootCommand} for the
 * post-extension two-pass reparse, neither of which Effect's strict handler
 * dispatch can express. Execution therefore forks to {@link runLaunch} in the
 * CLI entry point instead of running the descriptor via `Command.runWith`; the
 * descriptor exists only for help and completions.
 */

import { THINKING_EFFORTS } from "@oh-my-pi/pi-catalog/effort";
import { APP_NAME } from "@oh-my-pi/pi-utils";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { parseArgs } from "../cli/args";
import { runRootCommand } from "../main";
import { prepareAcpTerminalAuthArgs } from "../modes/acp/terminal-auth";

/**
 * The launch flag/argument inventory, shared with the `acp` descriptor. This is
 * the Effect-native declaration of the user-facing CLI surface; the actual
 * argv-to-`Args`-record conversion lives in {@link parseArgs}
 * (the typed dynamic boundary that preserves optional-value flags, `@file`
 * arguments, the `--` terminator, and the extension two-pass reparse).
 */
export const launchCommandConfig = {
	messages: Argument.string("messages").pipe(
		Argument.withDescription("Messages to send (prefix files with @)"),
		Argument.variadic(),
	),
	model: Flag.string("model").pipe(
		Flag.withDescription('Model to use (fuzzy match: "opus", "gpt-5.2", or "openai/gpt-5.2")'),
		Flag.optional,
	),
	smol: Flag.string("smol").pipe(
		Flag.withDescription("Smol/fast model for lightweight tasks (or PI_SMOL_MODEL env)"),
		Flag.optional,
	),
	slow: Flag.string("slow").pipe(
		Flag.withDescription("Slow/reasoning model for thorough analysis (or PI_SLOW_MODEL env)"),
		Flag.optional,
	),
	plan: Flag.string("plan").pipe(
		Flag.withDescription("Plan model for architectural planning (or PI_PLAN_MODEL env)"),
		Flag.optional,
	),
	provider: Flag.string("provider").pipe(
		Flag.withDescription("Provider to use (legacy; prefer --model)"),
		Flag.optional,
	),
	apiKey: Flag.string("api-key").pipe(Flag.withDescription("API key (defaults to env vars)"), Flag.optional),
	systemPrompt: Flag.string("system-prompt").pipe(
		Flag.withDescription("System prompt (default: coding assistant prompt)"),
		Flag.optional,
	),
	appendSystemPrompt: Flag.string("append-system-prompt").pipe(
		Flag.withDescription("Append text or file contents to the system prompt"),
		Flag.optional,
	),
	allowHome: Flag.boolean("allow-home").pipe(
		Flag.withDescription("Allow starting in ~ without auto-switching to a temp dir"),
		Flag.withDefault(false),
	),
	profile: Flag.string("profile").pipe(
		Flag.withDescription("Use an isolated profile for auth, sessions, settings, and caches"),
		Flag.optional,
	),
	alias: Flag.string("alias").pipe(
		Flag.withDescription("Create a shell shortcut for the selected profile and exit"),
		Flag.optional,
	),
	cwd: Flag.string("cwd").pipe(
		Flag.withDescription("Directory to start in (overrides the launch cwd)"),
		Flag.optional,
	),
	workstream: Flag.string("workstream").pipe(
		Flag.withDescription('Classify the session with a workstream slug or "adhoc"'),
		Flag.optional,
	),
	mode: Flag.choice("mode", ["text", "json", "rpc", "acp", "rpc-ui"]).pipe(
		Flag.withDescription("Output mode: text (default), json, rpc, or rpc-ui"),
		Flag.optional,
	),
	tuiBundleManifest: Flag.string("tui-bundle-manifest").pipe(
		Flag.withDescription("Override the default rich terminal with a hash-reloadable TUI bundle manifest"),
		Flag.optional,
	),
	headlessOwner: Flag.boolean("headless-owner").pipe(
		Flag.withDescription("Serve the persistent session owner socket without starting a terminal view"),
		Flag.withDefault(false),
	),
	localAttach: Flag.string("local-attach").pipe(
		Flag.withDescription("Attach a local controller TUI through the provided Unix socket path"),
		Flag.optional,
	),
	collabHost: Flag.boolean("collab-host").pipe(
		Flag.withDescription("Host this runner-backed session for encrypted collaboration"),
		Flag.withDefault(false),
	),
	collabRelay: Flag.string("collab-relay").pipe(
		Flag.withDescription("Relay URL for runner-backed encrypted collaboration"),
		Flag.optional,
	),
	config: Flag.string("config").pipe(
		Flag.withDescription("Load an extra config.yml-style overlay for this run (repeatable)"),
		Flag.atLeast(0),
	),
	print: Flag.boolean("print").pipe(
		Flag.withAlias("p"),
		Flag.withDescription("Non-interactive mode: process prompt and exit"),
		Flag.withDefault(false),
	),
	continue: Flag.boolean("continue").pipe(
		Flag.withAlias("c"),
		Flag.withDescription("Continue previous session"),
		Flag.withDefault(false),
	),
	resume: Flag.string("resume").pipe(
		Flag.withAlias("r"),
		Flag.withDescription("Resume a session (by ID prefix, path, or picker if omitted)"),
		Flag.optional,
	),
	sessionDir: Flag.string("session-dir").pipe(
		Flag.withDescription("Directory for session storage and lookup"),
		Flag.optional,
	),
	noSession: Flag.boolean("no-session").pipe(
		Flag.withDescription("Don't save session (ephemeral)"),
		Flag.withDefault(false),
	),
	models: Flag.string("models").pipe(
		Flag.withDescription("Comma-separated model patterns for Ctrl+P cycling"),
		Flag.optional,
	),
	noTools: Flag.boolean("no-tools").pipe(Flag.withDescription("Disable all built-in tools"), Flag.withDefault(false)),
	noLsp: Flag.boolean("no-lsp").pipe(
		Flag.withDescription("Disable LSP tools, formatting, and diagnostics"),
		Flag.withDefault(false),
	),
	noPty: Flag.boolean("no-pty").pipe(
		Flag.withDescription("Disable PTY-based interactive bash execution"),
		Flag.withDefault(false),
	),
	tools: Flag.string("tools").pipe(
		Flag.withDescription("Comma-separated list of tools to enable (default: all)"),
		Flag.optional,
	),
	thinking: Flag.choice("thinking", [...THINKING_EFFORTS]).pipe(
		Flag.withDescription(`Set thinking level: ${THINKING_EFFORTS.join(", ")}`),
		Flag.optional,
	),
	hideThinking: Flag.boolean("hide-thinking").pipe(
		Flag.withDescription("Hide thinking blocks in TUI output (display only, does not disable model thinking)"),
		Flag.withDefault(false),
	),
	hook: Flag.string("hook").pipe(
		Flag.withDescription("Load a hook/extension file (can be used multiple times)"),
		Flag.atLeast(0),
	),
	extension: Flag.string("extension").pipe(
		Flag.withAlias("e"),
		Flag.withDescription("Load an extension file (can be used multiple times)"),
		Flag.atLeast(0),
	),
	noExtensions: Flag.boolean("no-extensions").pipe(
		Flag.withDescription("Disable extension discovery (explicit -e paths still work)"),
		Flag.withDefault(false),
	),
	noSkills: Flag.boolean("no-skills").pipe(
		Flag.withDescription("Disable skills discovery and loading"),
		Flag.withDefault(false),
	),
	skills: Flag.string("skills").pipe(
		Flag.withDescription("Comma-separated glob patterns to filter skills (e.g., git-*,docker)"),
		Flag.optional,
	),
	noRules: Flag.boolean("no-rules").pipe(
		Flag.withDescription("Disable rules discovery and loading"),
		Flag.withDefault(false),
	),
	export: Flag.string("export").pipe(Flag.withDescription("Export session file to HTML and exit"), Flag.optional),
	noTitle: Flag.boolean("no-title").pipe(
		Flag.withDescription("Disable title auto-generation"),
		Flag.withDefault(false),
	),
	autoApprove: Flag.boolean("auto-approve").pipe(
		Flag.withAlias("yolo"),
		Flag.withDescription("Auto-approve all tool calls (skip approval prompts)"),
		Flag.withDefault(false),
	),
	approvalMode: Flag.choice("approval-mode", ["always-ask", "write", "yolo"]).pipe(
		Flag.withDescription("Override tools.approvalMode for this session (always-ask|write|yolo)"),
		Flag.optional,
	),
};

/**
 * Execute the launch flow for the given raw argv. Called by the CLI entry point
 * (which forks execution here for the default/`launch` path) rather than the
 * Effect handler dispatch, so the raw argv survives for the extension reparse.
 */
export async function runLaunch(rawArgs: string[]): Promise<void> {
	const { args } = prepareAcpTerminalAuthArgs(rawArgs);
	const parsed = parseArgs(args);
	await runRootCommand(parsed, args);
}

export default Command.make("launch", launchCommandConfig).pipe(
	Command.withDescription("AI coding assistant"),
	Command.withExamples([
		{ command: APP_NAME, description: "Interactive mode" },
		{ command: `${APP_NAME} "List all .ts files in src/"`, description: "Interactive mode with initial prompt" },
		{ command: `${APP_NAME} @prompt.md @image.png "What color is the sky?"`, description: "Include files in initial message" },
		{ command: `${APP_NAME} -p "List all .ts files in src/"`, description: "Non-interactive mode (process and exit)" },
		{ command: `${APP_NAME} --continue "What did we discuss?"`, description: "Continue previous session" },
		{ command: `${APP_NAME} --profile work --alias omp-work`, description: "Create a shell shortcut for a work profile" },
		{ command: `${APP_NAME} --model opus "Help me refactor this code"`, description: "Use different model (fuzzy matching)" },
		{ command: `${APP_NAME} --models claude-sonnet,claude-haiku,gpt-4o`, description: "Limit model cycling to specific models" },
		{
			command: `${APP_NAME} --export ~/.omp/agent/sessions/--path--/session.jsonl`,
			description: "Export a session file to HTML",
		},
	]),
	Command.withHidden,
);
