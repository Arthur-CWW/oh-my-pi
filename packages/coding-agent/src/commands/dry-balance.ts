import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { runDryBalanceCommand } from "../cli/dry-balance-cli";

export default Command.make(
	"dry-balance",
	{
		model: Argument.optional(
			Argument.string("model").pipe(
				Argument.withDescription(
					"Model selector (provider/model or fuzzy id). Defaults to the configured default model.",
				),
			),
		),
		modelFlag: Flag.optional(
			Flag.string("model").pipe(Flag.withDescription("Model selector (same syntax as --model on omp)")),
		),
		count: Flag.integer("count").pipe(
			Flag.withDescription("Number of random session ids to try"),
			Flag.withDefault(100),
		),
		concurrency: Flag.integer("concurrency").pipe(
			Flag.withDescription("Maximum concurrent credential resolutions"),
			Flag.withDefault(32),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON")),
		bench: Flag.boolean("bench").pipe(Flag.withDescription("Send one live benchmark request per OAuth account")),
	},
	config =>
		Effect.promise(() =>
			runDryBalanceCommand({
				model: Option.getOrUndefined(config.model),
				flags: {
					model: Option.getOrUndefined(config.modelFlag),
					count: config.count,
					concurrency: config.concurrency,
					json: config.json,
					bench: config.bench,
				},
			}),
		),
).pipe(
	Command.withDescription("Dry-run OAuth account balancing across random session ids"),
	Command.withExamples([
		{ command: "omp dry-balance", description: "Dry-run the configured default model with 100 random session ids" },
		{ command: "omp dry-balance anthropic/claude-sonnet-4-5", description: "Dry-run a specific model" },
		{
			command: "omp dry-balance --model openai-codex/gpt-5-codex --count 1000 --concurrency 64",
			description: "Larger run with bounded concurrency",
		},
		{ command: "omp dry-balance --bench", description: "Benchmark every OAuth account in parallel" },
		{ command: "omp dry-balance --json", description: "Machine-readable output" },
	]),
);
