/** Manage the local Fable refusal corpus and replay history. */
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { type RefusalsAction, runRefusalsCommand } from "../cli/refusals-cli";

const ACTIONS: readonly RefusalsAction[] = ["list", "show", "stats", "mark", "replay"];

export default Command.make(
	"refusals",
	{
		action: Argument.choice("action", ACTIONS).pipe(
			Argument.withDescription("list (default), show, stats, mark, or replay"),
			Argument.withDefault("list"),
		),
		id: Argument.optional(Argument.string("id").pipe(Argument.withDescription("Refusal case id"))),
		limit: Flag.integer("limit").pipe(
			Flag.withAlias("n"),
			Flag.withDescription("Number of cases to show"),
			Flag.withDefault(50),
		),
		json: Flag.boolean("json").pipe(Flag.withAlias("j"), Flag.withDescription("Output JSON"), Flag.withDefault(false)),
		verdict: Flag.optional(Flag.string("verdict").pipe(Flag.withDescription("Human verdict for mark"))),
		note: Flag.optional(Flag.string("note").pipe(Flag.withDescription("Remediation note for mark"))),
		falsePositives: Flag.boolean("false-positives").pipe(
			Flag.withDescription("Replay every false-positive case"),
			Flag.withDefault(false),
		),
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
					note: Option.getOrUndefined(config.note),
					falsePositives: config.falsePositives,
				},
			}),
		),
).pipe(
	Command.withDescription("List, review, and replay Fable refusal cases"),
	Command.withExamples([
		{ command: "omp refusals list" },
		{ command: "omp refusals show <id>" },
		{ command: "omp refusals stats --json" },
		{ command: "omp refusals mark <id> --verdict false-positive --note 'safe local request'" },
		{ command: "omp refusals replay <id>" },
		{ command: "omp refusals replay --false-positives" },
	]),
);
