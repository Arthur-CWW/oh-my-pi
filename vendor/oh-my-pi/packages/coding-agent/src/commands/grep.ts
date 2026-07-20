/**
 * Test grep tool.
 */
import { Effect, Option } from "effect";
import { GrepOutputMode } from "@oh-my-pi/pi-natives";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { type GrepCommandArgs, runGrepCommand } from "../cli/grep-cli";
import { initTheme } from "../modes/theme/theme";

export default Command.make(
	"grep",
	{
		pattern: Argument.optional(Argument.string("pattern").pipe(Argument.withDescription("Regex pattern to search for"))),
		path: Argument.optional(Argument.string("path").pipe(Argument.withDescription("Directory or file to search"))),
		glob: Flag.optional(
			Flag.string("glob").pipe(Flag.withAlias("g"), Flag.withDescription("Filter files by glob pattern")),
		),
		limit: Flag.integer("limit").pipe(Flag.withAlias("l"), Flag.withDescription("Max matches"), Flag.withDefault(20)),
		context: Flag.integer("context").pipe(
			Flag.withAlias("C"),
			Flag.withDescription("Context lines"),
			Flag.withDefault(2),
		),
		files: Flag.boolean("files").pipe(Flag.withAlias("f"), Flag.withDescription("Output file names only")),
		count: Flag.boolean("count").pipe(Flag.withAlias("c"), Flag.withDescription("Output match counts per file")),
		"no-gitignore": Flag.boolean("no-gitignore").pipe(
			Flag.withDescription("Include files excluded by .gitignore"),
		),
	},
	config =>
		Effect.promise(async () => {
			const mode: GrepCommandArgs["mode"] = config.count
				? GrepOutputMode.Count
				: config.files
					? GrepOutputMode.FilesWithMatches
					: GrepOutputMode.Content;

			const cmd: GrepCommandArgs = {
				pattern: Option.getOrUndefined(config.pattern) ?? "",
				path: Option.getOrUndefined(config.path) ?? ".",
				glob: Option.getOrUndefined(config.glob),
				limit: config.limit,
				context: config.context,
				mode,
				gitignore: !config["no-gitignore"],
			};

			await initTheme();
			await runGrepCommand(cmd);
		}),
).pipe(Command.withDescription("Test grep tool"));
