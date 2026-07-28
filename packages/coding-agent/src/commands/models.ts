/**
 * List, search, and refresh available models.
 */
import { APP_NAME } from "@oh-my-pi/pi-utils";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { resolveModelsArgs, runModelsCommand } from "../cli/models-cli";

export default Command.make(
	"models",
	{
		action: Argument.optional(
			Argument.string("action").pipe(
				Argument.withDescription("ls (default) | find | refresh | canonical | <provider>"),
			),
		),
		pattern: Argument.optional(
			Argument.string("pattern").pipe(
				Argument.withDescription("Filter/search substring, or provider name (required for find)"),
			),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON")),
		extension: Flag.string("extension").pipe(
			Flag.withAlias("e"),
			Flag.withDescription("Load an extension file before listing (repeatable)"),
			Flag.atLeast(0),
		),
		"no-extensions": Flag.boolean("no-extensions").pipe(
			Flag.withDescription("Disable extension discovery (explicit -e paths still work)"),
		),
		config: Flag.string("config").pipe(
			Flag.withDescription("Load an extra config.yml-style overlay for this run (repeatable)"),
			Flag.atLeast(0),
		),
	},
	config =>
		Effect.promise(() => {
			const { action, pattern } = resolveModelsArgs(
				Option.getOrUndefined(config.action),
				Option.getOrUndefined(config.pattern),
			);
			return runModelsCommand({
				action,
				pattern,
				flags: {
					json: config.json,
					extensions: config.extension.length > 0 ? [...config.extension] : undefined,
					noExtensions: config["no-extensions"],
					config: config.config.length > 0 ? [...config.config] : undefined,
				},
			});
		}),
).pipe(
	Command.withDescription("List, search, and refresh available models"),
	Command.withExamples([
		{ command: `${APP_NAME} models`, description: "List every available model, grouped by provider" },
		{ command: `${APP_NAME} models openai-codex`, description: "List one provider's models (any provider name works)" },
		{ command: `${APP_NAME} models find minimax`, description: "Find models by substring" },
		{
			command: `${APP_NAME} models refresh`,
			description: "Force a fresh catalog fetch (replaces rm -rf ~/.omp/models.db)",
		},
		{ command: `${APP_NAME} models canonical`, description: "Show the coalesced canonical model view" },
		{ command: `${APP_NAME} models --json`, description: "Machine-readable output" },
	]),
);
