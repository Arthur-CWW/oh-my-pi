/**
 * Generate and optionally push a commit with changelog updates.
 */
import { postmortem } from "@oh-my-pi/pi-utils";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { runCommitCommand } from "../commit";
import type { CommitCommandArgs } from "../commit/types";
import { initTheme } from "../modes/theme/theme";

export default Command.make(
	"commit",
	{
		push: Flag.boolean("push").pipe(Flag.withDescription("Push after committing")),
		"dry-run": Flag.boolean("dry-run").pipe(Flag.withDescription("Preview without committing")),
		"no-changelog": Flag.boolean("no-changelog").pipe(Flag.withDescription("Skip changelog updates")),
		legacy: Flag.boolean("legacy").pipe(Flag.withDescription("Use legacy deterministic pipeline")),
		context: Flag.optional(
			Flag.string("context").pipe(Flag.withAlias("c"), Flag.withDescription("Additional context for the model")),
		),
		model: Flag.optional(
			Flag.string("model").pipe(Flag.withAlias("m"), Flag.withDescription("Override model selection")),
		),
	},
	config =>
		Effect.promise(async () => {
			const cmd: CommitCommandArgs = {
				push: config.push,
				dryRun: config["dry-run"],
				noChangelog: config["no-changelog"],
				legacy: config.legacy,
				context: Option.getOrUndefined(config.context),
				model: Option.getOrUndefined(config.model),
			};

			await initTheme();
			// The agentic commit flow opens keep-alive sockets to the model provider
			// and spins up an AgentSession with background async-job + extension
			// machinery. `session.dispose()` releases what it can, but Bun's fetch
			// keeps idle connections warm and a few timers (Settings autosave, OAuth
			// refresh) stay armed long enough to pin the event loop after the commit
			// is already written. Mirror the `runPrintMode` exit pattern from
			// `main.ts` so the CLI returns to the shell instead of stranding the user
			// on Ctrl+C (issue #1041).
			await runCommitCommand(cmd);
			await postmortem.quit(0);
		}),
).pipe(Command.withDescription("Generate a commit message and update changelogs"));
