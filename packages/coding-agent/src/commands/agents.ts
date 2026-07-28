/**
 * Manage bundled task agents.
 */
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { type AgentsAction, type AgentsCommandArgs, runAgentsCommand } from "../cli/agents-cli";
import { initTheme } from "../modes/theme/theme";

const ACTIONS: readonly AgentsAction[] = ["unpack"];

export default Command.make(
	"agents",
	{
		action: Argument.choice("action", ACTIONS).pipe(Argument.withDescription("Agents action")),
		force: Flag.boolean("force").pipe(Flag.withAlias("f"), Flag.withDescription("Overwrite existing agent files")),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON")),
		dir: Flag.optional(
			Flag.string("dir").pipe(Flag.withDescription("Output directory (overrides --user/--project)")),
		),
		user: Flag.boolean("user").pipe(Flag.withDescription("Write to ~/.omp/agent/agents (default)")),
		project: Flag.boolean("project").pipe(Flag.withDescription("Write to ./.omp/agents")),
	},
	config =>
		Effect.promise(async () => {
			const cmd: AgentsCommandArgs = {
				action: config.action,
				flags: {
					force: config.force,
					json: config.json,
					dir: Option.getOrUndefined(config.dir),
					user: config.user,
					project: config.project,
				},
			};

			await initTheme();
			await runAgentsCommand(cmd);
		}),
).pipe(
	Command.withDescription("Manage bundled task agents"),
	Command.withExamples([
		{ command: "omp agents unpack", description: "Export bundled agents into user config (default)" },
		{ command: "omp agents unpack --project", description: "Export bundled agents into project config" },
		{ command: "omp agents unpack --project --force", description: "Overwrite existing local agent files" },
		{ command: "omp agents unpack --dir ./tmp/agents --json", description: "Export into a custom directory" },
	]),
);
