/**
 * Check for and install updates.
 */
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { runUpdateCommand } from "../cli/update-cli";
import { initTheme } from "../modes/theme/theme";

export default Command.make(
	"update",
	{
		force: Flag.boolean("force").pipe(
			Flag.withAlias("f"),
			Flag.withDescription("Force update"),
			Flag.withDefault(false),
		),
		check: Flag.boolean("check").pipe(
			Flag.withAlias("c"),
			Flag.withDescription("Check for updates without installing"),
			Flag.withDefault(false),
		),
	},
	config =>
		Effect.promise(async () => {
			await initTheme();
			await runUpdateCommand({ force: config.force, check: config.check });
		}),
).pipe(Command.withDescription("Check for and install updates"));
