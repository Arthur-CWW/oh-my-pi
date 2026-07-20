/**
 * Join a shared collab session from the CLI: launches the interactive TUI and
 * immediately runs `/join <link>`.
 */
import { APP_NAME } from "@oh-my-pi/pi-utils";
import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { parseArgs } from "../cli/args";
import { runRootCommand } from "../main";

export default Command.make(
	"join",
	{
		link: Argument.string("link").pipe(Argument.withDescription("Collab link shared by the host (/collab)")),
	},
	(config) =>
		Effect.gen(function* () {
			const link = config.link.trim();
			if (!link) {
				yield* Effect.sync(() => {
					process.stderr.write(`Usage: ${APP_NAME} join <link>\n`);
					process.exitCode = 1;
				});
				return;
			}
			if (!process.stdin.isTTY || !process.stdout.isTTY) {
				yield* Effect.sync(() => {
					process.stderr.write(`${APP_NAME} join requires an interactive terminal\n`);
					process.exitCode = 1;
				});
				return;
			}
			const parsed = parseArgs([]);
			parsed.join = link;
			yield* Effect.promise(() => runRootCommand(parsed, []));
		}),
).pipe(
	Command.withDescription("Join a shared collab session (same as /join)"),
	Command.withExamples([{ command: `${APP_NAME} join "relay.example.sh/abc123#key"` }]),
);
