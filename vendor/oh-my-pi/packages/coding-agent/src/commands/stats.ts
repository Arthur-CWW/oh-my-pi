/**
 * View usage statistics dashboard.
 */
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { runStatsCommand, type StatsCommandArgs } from "../cli/stats-cli";
import { initTheme } from "../modes/theme/theme";

export default Command.make(
	"stats",
	{
		port: Flag.integer("port").pipe(
			Flag.withAlias("p"),
			Flag.withDescription("Port for the dashboard server"),
			Flag.withDefault(3847),
		),
		json: Flag.boolean("json").pipe(
			Flag.withAlias("j"),
			Flag.withDescription("Output stats as JSON"),
			Flag.withDefault(false),
		),
		summary: Flag.boolean("summary").pipe(
			Flag.withAlias("s"),
			Flag.withDescription("Print summary to console"),
			Flag.withDefault(false),
		),
	},
	config =>
		Effect.promise(async () => {
			const cmd: StatsCommandArgs = {
				port: config.port,
				json: config.json,
				summary: config.summary,
			};

			await initTheme();
			await runStatsCommand(cmd);
		}),
).pipe(Command.withDescription("View usage statistics"));
