import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { runBenchCommand } from "../cli/bench-cli";

export default Command.make(
	"bench",
	{
		models: Argument.string("models").pipe(
			Argument.withDescription("Model selectors (provider/model or fuzzy id, e.g. opus)"),
			Argument.atLeast(1),
		),
		runs: Flag.integer("runs").pipe(
			Flag.withDescription("Requests per model (results are averaged)"),
			Flag.withDefault(1),
		),
		"max-tokens": Flag.integer("max-tokens").pipe(
			Flag.withDescription("Max output tokens per request"),
			Flag.withDefault(512),
		),
		prompt: Flag.optional(
			Flag.string("prompt").pipe(Flag.withDescription("Custom prompt text (default: bundled bench prompt)")),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON")),
	},
	config =>
		Effect.promise(() =>
			runBenchCommand({
				models: [...config.models],
				flags: {
					runs: config.runs,
					maxTokens: config["max-tokens"],
					prompt: Option.getOrUndefined(config.prompt),
					json: config.json,
				},
			}),
		),
).pipe(
	Command.withDescription(
		"Benchmark models with the same prompt: time-to-first-token and generation throughput (tokens/s)",
	),
	Command.withExamples([
		{ command: "omp bench anthropic/claude-opus-4-5 openai/gpt-5.2", description: "Compare two models" },
		{ command: "omp bench opus sonnet", description: "Fuzzy selectors work" },
		{ command: "omp bench opus gpt-5.2 --runs 3", description: "Average over 3 runs each" },
		{ command: "omp bench opus --json", description: "Machine-readable output" },
	]),
);
