/**
 * List and clean up agent-managed git worktrees under `~/.omp/wt`.
 */
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { clearWorktrees, listWorktrees } from "../cli/worktree-cli";

export default Command.make(
	"worktree",
	{
		// `list` (default) inspects the worktree dir; `clear` removes entries.
		// A positional action keeps `omp worktree` (the no-arg form) useful.
		action: Argument.choice("action", ["list", "clear"] as const).pipe(
			Argument.withDescription("list (default) or clear"),
			Argument.withDefault("list"),
		),
		all: Flag.boolean("all").pipe(
			Flag.withDescription("Clear every entry, including live PR-checkout worktrees (clear)"),
			Flag.withDefault(false),
		),
		"dry-run": Flag.boolean("dry-run").pipe(
			Flag.withAlias("n"),
			Flag.withDescription("Print what would be removed without touching the filesystem (clear)"),
			Flag.withDefault(false),
		),
		json: Flag.boolean("json").pipe(
			Flag.withAlias("j"),
			Flag.withDescription("Emit machine-readable JSON"),
			Flag.withDefault(false),
		),
	},
	config =>
		Effect.promise(async () => {
			if (config.action === "clear") {
				await clearWorktrees({
					all: config.all,
					dryRun: config["dry-run"],
					json: config.json,
				});
				return;
			}
			await listWorktrees({ json: config.json });
		}),
).pipe(
	Command.withDescription("List or clear agent-managed git worktrees (~/.omp/wt)"),
	Command.withAlias("wt"),
	Command.withExamples([
		{ command: "omp worktree" },
		{ command: "omp worktree list --json" },
		{ command: "omp worktree clear" },
		{ command: "omp worktree clear --dry-run" },
		{ command: "omp worktree clear --all" },
	]),
);
