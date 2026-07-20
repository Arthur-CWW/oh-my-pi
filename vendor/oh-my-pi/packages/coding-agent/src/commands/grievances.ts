/**
 * View, clean, and push reported tool issues from automated QA.
 */
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { cleanGrievances, listGrievances, pushGrievances } from "../cli/grievances-cli";

export default Command.make(
	"grievances",
	{
		// Positional action: "list" (default), "clean", or "push". A positional
		// arg keeps the historical `omp grievances` invocation working unchanged
		// while reusing the same command surface for the clean/push verbs.
		action: Argument.choice("action", ["list", "clean", "push"] as const).pipe(
			Argument.withDescription("list (default), clean, or push"),
			Argument.withDefault("list"),
		),
		limit: Flag.integer("limit").pipe(
			Flag.withAlias("n"),
			Flag.withDescription("Number of recent issues to show (list)"),
			Flag.withDefault(20),
		),
		tool: Flag.optional(
			Flag.string("tool").pipe(Flag.withAlias("t"), Flag.withDescription("Filter by tool name (list, clean)")),
		),
		json: Flag.boolean("json").pipe(
			Flag.withAlias("j"),
			Flag.withDescription("Output as JSON"),
			Flag.withDefault(false),
		),
		id: Flag.optional(Flag.integer("id").pipe(Flag.withDescription("Delete a single grievance by id (clean)"))),
		all: Flag.boolean("all").pipe(
			Flag.withDescription("Delete every grievance (clean)"),
			Flag.withDefault(false),
		),
	},
	config =>
		Effect.promise(async () => {
			if (config.action === "clean") {
				await cleanGrievances({
					id: Option.getOrUndefined(config.id),
					tool: Option.getOrUndefined(config.tool),
					all: config.all,
					json: config.json,
				});
				return;
			}
			if (config.action === "push") {
				await pushGrievances({ json: config.json });
				return;
			}
			await listGrievances({ limit: config.limit, tool: Option.getOrUndefined(config.tool), json: config.json });
		}),
).pipe(
	Command.withDescription("View, clean, or push reported tool issues (auto-QA grievances)"),
	Command.withExamples([
		{ command: "omp grievances" },
		{ command: "omp grievances list --tool find" },
		{ command: "omp grievances clean --id 209" },
		{ command: "omp grievances clean --tool find" },
		{ command: "omp grievances clean --all" },
		{ command: "omp grievances push" },
	]),
);
