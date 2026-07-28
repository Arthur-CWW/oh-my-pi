import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { type PolicyCliAction, type PolicyCliRequest, runPolicyCommand } from "../cli/policy-cli";

const ACTIONS: readonly PolicyCliAction[] = [
	"get",
	"explain",
	"diff",
	"history",
	"drift",
	"impact",
	"rebuild",
	"set",
	"rollback",
	"import",
	"export",
];

export default Command.make(
	"policy",
	{
		action: Argument.choice("action", ACTIONS).pipe(Argument.withDescription("Policy action")),
		key: Argument.optional(Argument.string("key").pipe(Argument.withDescription("Routing key or transaction ID"))),
		value: Argument.string("value").pipe(
			Argument.withDescription("Value, timestamp, or source path"),
			Argument.variadic(),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON"), Flag.withDefault(false)),
		"dry-run": Flag.boolean("dry-run").pipe(
			Flag.withDescription("Preview set or rollback without appending"),
			Flag.withDefault(false),
		),
		apply: Flag.boolean("apply").pipe(
			Flag.withDescription("Commit a validated policy import (imports are dry-run by default)"),
			Flag.withDefault(false),
		),
		config: Flag.optional(Flag.string("config").pipe(Flag.withDescription("Global config.yml path"))),
		frontmatter: Flag.string("frontmatter").pipe(
			Flag.withDescription("Agent frontmatter path"),
			Flag.atLeast(0),
		),
		from: Flag.optional(Flag.string("from").pipe(Flag.withDescription("Diff start sequence or ISO timestamp"))),
		to: Flag.optional(Flag.string("to").pipe(Flag.withDescription("Diff end sequence or ISO timestamp"))),
		"effective-from": Flag.optional(
			Flag.string("effective-from").pipe(Flag.withDescription("Effective-from ISO timestamp for policy set")),
		),
		"expires-at": Flag.optional(
			Flag.string("expires-at").pipe(Flag.withDescription("Expiry ISO timestamp for policy set")),
		),
		"expires-in": Flag.optional(
			Flag.string("expires-in").pipe(
				Flag.withDescription("Positive duration from effective-from (for example 30m, 2h, 1d)"),
			),
		),
		reason: Flag.optional(Flag.string("reason").pipe(Flag.withDescription("Transaction reason"))),
		workstream: Flag.optional(Flag.string("workstream").pipe(Flag.withDescription("Workstream scope"))),
		author: Flag.optional(
			Flag.string("author").pipe(Flag.withDescription("Transaction author identity or history author filter")),
		),
		source: Flag.optional(
			Flag.string("source").pipe(Flag.withDescription("Policy transaction source or register row")),
		),
		since: Flag.optional(Flag.string("since").pipe(Flag.withDescription("History lower-bound timestamp"))),
	},
	config =>
		Effect.promise(async () => {
			const action = config.action;
			const key = Option.getOrUndefined(config.key);
			const values = [...config.value];
			const request: PolicyCliRequest = {
				action,
				key,
				value: action === "set" || (action === "impact" && values.length > 0) ? values.join(" ") : undefined,
				transactionId: action === "rollback" || (action === "impact" && values.length === 0) ? key : undefined,
				from: Option.getOrUndefined(config.from),
				to: Option.getOrUndefined(config.to),
				effectiveFrom: Option.getOrUndefined(config["effective-from"]),
				expiresAt: Option.getOrUndefined(config["expires-at"]),
				expiresIn: Option.getOrUndefined(config["expires-in"]),
				sourcePaths: action === "import" ? values : undefined,
				frontmatterPaths: config.frontmatter.length > 0 ? [...config.frontmatter] : undefined,
				dryRun: config["dry-run"],
				apply: config.apply,
				json: config.json,
				reason: Option.getOrUndefined(config.reason),
				workstream: Option.getOrUndefined(config.workstream),
				author: Option.getOrUndefined(config.author),
				source: Option.getOrUndefined(config.source),
				since: Option.getOrUndefined(config.since),
				configPath: Option.getOrUndefined(config.config),
			};
			process.stdout.write(await runPolicyCommand(request));
		}),
).pipe(Command.withDescription("Inspect and mutate the typed runtime policy journal"));
