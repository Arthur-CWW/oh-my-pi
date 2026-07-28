/**
 * Run Oh My Pi as an ACP (Agent Client Protocol) server over stdio.
 *
 * Thin wrapper around the launch flow that forces `mode: "acp"` unless the
 * ACP terminal-auth flag asks the same command to open the interactive TUI.
 *
 * Like `launch`, the exported Effect `Command` is a handler-less descriptor
 * (for help/completions) and execution forks to {@link runAcp} in the CLI entry
 * point so the raw argv survives for the extension two-pass reparse.
 */
import { Command } from "effect/unstable/cli";
import { parseArgs } from "../cli/args";
import { runRootCommand } from "../main";
import { prepareAcpTerminalAuthArgs } from "../modes/acp/terminal-auth";
import { launchCommandConfig } from "./launch";

/**
 * Execute the ACP flow for the given raw argv. Forces `mode: "acp"` unless the
 * terminal-auth flag redirected the command into the interactive setup flow.
 */
export async function runAcp(rawArgs: string[]): Promise<void> {
	const { args, terminalAuth } = prepareAcpTerminalAuthArgs(rawArgs);
	const parsed = parseArgs(args);
	if (!terminalAuth) {
		parsed.mode = "acp";
	}
	await runRootCommand(parsed, args);
}

export default Command.make("acp", launchCommandConfig).pipe(
	Command.withDescription("Run Oh My Pi as an ACP (Agent Client Protocol) server over stdio"),
);
