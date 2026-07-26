/** Inspect and operate the host-level semantic-refusal recovery ledger. */
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { type RefusalsAction, runRefusalsCommand } from "../cli/refusals-cli";

const ACTIONS: readonly RefusalsAction[] = ["list", "show", "stats", "review", "retry"];

export default Command.make(
	"refusals",
	{
		action: Argument.choice("action", ACTIONS).pipe(
			Argument.withDescription("list (default), show, stats, review, or retry"),
			Argument.withDefault("list"),
		),
		id: Argument.optional(Argument.string("id").pipe(Argument.withDescription("Refusal record id"))),
		limit: Flag.integer("limit").pipe(
			Flag.withAlias("n"),
			Flag.withDescription("Number of records to show"),
			Flag.withDefault(50),
		),
		json: Flag.boolean("json").pipe(Flag.withAlias("j"), Flag.withDescription("Output JSON"), Flag.withDefault(false)),
		verdict: Flag.optional(Flag.string("verdict").pipe(Flag.withDescription("Human verdict for review"))),
	},
	config =>
		Effect.promise(() =>
			runRefusalsCommand({
				action: config.action,
				id: Option.getOrUndefined(config.id),
				flags: {
					limit: config.limit,
					json: config.json,
					verdict: Option.getOrUndefined(config.verdict),
				},
			}),
		),
).pipe(
	Command.withDescription("List, inspect, review, and retry semantic-refusal recoveries"),
	Command.withExamples([
		{ command: "omp refusals list" },
		{ command: "omp refusals show <id>" },
		{ command: "omp refusals stats --json" },
		{ command: "omp refusals review <id> --verdict false-positive" },
		{ command: "omp refusals retry <id>" },
	]),
);
