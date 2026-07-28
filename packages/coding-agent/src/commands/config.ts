/**
 * Manage configuration settings.
 */
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { type ConfigAction, type ConfigCommandArgs, runConfigCommand } from "../cli/config-cli";
import { initTheme } from "../modes/theme/theme";

const ACTIONS: readonly ConfigAction[] = ["list", "get", "set", "reset", "path", "init-xdg"];

export default Command.make(
	"config",
	{
		action: Argument.choice("action", ACTIONS).pipe(
			Argument.withDescription("Config action"),
			Argument.withDefault("list"),
		),
		key: Argument.optional(Argument.string("key").pipe(Argument.withDescription("Setting key"))),
		value: Argument.string("value").pipe(
			Argument.withDescription("Value (for set/reset)"),
			Argument.variadic(),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON")),
	},
	config =>
		Effect.promise(async () => {
			const value = config.value.length > 0 ? [...config.value].join(" ") : undefined;
			const cmd: ConfigCommandArgs = {
				action: config.action,
				key: Option.getOrUndefined(config.key),
				value,
				flags: {
					json: config.json,
				},
			};

			await initTheme();
			await runConfigCommand(cmd);
		}),
).pipe(Command.withDescription("Manage configuration settings"));
