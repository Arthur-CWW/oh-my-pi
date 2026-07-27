/**
 * Show provider usage limits for every authenticated account.
 */
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { runUsageCommand } from "../cli/usage-cli";

export default Command.make(
	"usage",
	{
		json: Flag.boolean("json").pipe(
			Flag.withAlias("j"),
			Flag.withDescription("Output usage reports as JSON"),
			Flag.withDefault(false),
		),
		provider: Flag.optional(
			Flag.string("provider").pipe(
				Flag.withAlias("p"),
				Flag.withDescription("Only show usage for this provider id (e.g. anthropic)"),
			),
		),
		redact: Flag.boolean("redact").pipe(
			Flag.withAlias("r"),
			Flag.withDescription("Redact account emails/ids (shortest unique prefix) for sharing screenshots"),
			Flag.withDefault(false),
		),
		history: Flag.boolean("history").pipe(
			Flag.withDescription(
				"Show recorded usage-limit history (hourly snapshots) instead of a live snapshot",
			),
			Flag.withDefault(false),
		),
		days: Flag.integer("days").pipe(
			Flag.withAlias("d"),
			Flag.withDescription("History window in days (with --history)"),
			Flag.withDefault(7),
		),
	},
	config =>
		Effect.promise(() =>
			runUsageCommand({
				json: config.json,
				provider: Option.getOrUndefined(config.provider),
				redact: config.redact,
				history: config.history,
				days: config.days,
			}),
		),
).pipe(
	Command.withDescription("Show provider usage limits for every authenticated account"),
	Command.withExamples([
		{ command: "omp usage", description: "Detailed per-account usage breakdown across all providers" },
		{ command: "omp usage --provider anthropic", description: "Only Anthropic accounts" },
		{ command: "omp usage --redact", description: "Redact account identifiers for screenshots" },
		{ command: "omp usage --json", description: "Machine-readable output" },
		{ command: "omp usage --history --days 30", description: "Usage-limit trend over the last 30 days" },
	]),
);
