/**
 * Interactive shell console.
 */
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { runShellCommand, type ShellCommandArgs } from "../cli/shell-cli";
import { initTheme } from "../modes/theme/theme";

export default Command.make(
	"shell",
	{
		cwd: Flag.optional(
			Flag.string("cwd").pipe(
				Flag.withAlias("C"),
				Flag.withDescription("Set working directory for commands"),
			),
		),
		timeout: Flag.optional(
			Flag.integer("timeout").pipe(
				Flag.withAlias("t"),
				Flag.withDescription("Timeout per command in milliseconds"),
			),
		),
		"no-snapshot": Flag.boolean("no-snapshot").pipe(
			Flag.withDescription("Skip sourcing snapshot from user shell"),
		),
	},
	config =>
		Effect.promise(async () => {
			const cmd: ShellCommandArgs = {
				cwd: Option.getOrUndefined(config.cwd),
				timeoutMs: Option.getOrUndefined(config.timeout),
				noSnapshot: config["no-snapshot"],
			};

			await initTheme();
			await runShellCommand(cmd);
		}),
).pipe(Command.withDescription("Interactive shell console"));
