import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { runTinyModelsCommand, type TinyModelsAction, type TinyModelsCommandArgs } from "../cli/tiny-models-cli";

const ACTIONS: readonly TinyModelsAction[] = ["download", "list"];

export default Command.make(
	"tiny-models",
	{
		action: Argument.choice("action", ACTIONS).pipe(
			Argument.withDescription("Action to perform"),
			Argument.withDefault("download"),
		),
		model: Argument.optional(Argument.string("model").pipe(Argument.withDescription("Model key, or all"))),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON")),
	},
	config =>
		Effect.promise(() => {
			const command: TinyModelsCommandArgs = {
				action: config.action,
				model: Option.getOrUndefined(config.model),
				flags: {
					json: config.json,
				},
			};
			return runTinyModelsCommand(command);
		}),
).pipe(Command.withDescription("Download tiny local models (session titles + memory)"));
