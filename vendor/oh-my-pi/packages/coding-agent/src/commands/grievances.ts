/**
 * View, clean, and push reported tool issues from automated QA.
 */
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
	cleanGrievances,
	listGrievances,
	pushGrievances,
	setToolIssueStatus,
	triageToolIssues,
} from "../cli/grievances-cli";
import { TOOL_ISSUE_DISPOSITIONS } from "../cli/tool-issue-projection";

export default Command.make(
	"grievances",
	{
		action: Argument.choice("action", ["list", "clean", "push", "triage", "status"] as const).pipe(
			Argument.withDescription("list (default), clean, push, triage, or status"),
			Argument.withDefault("list"),
		),
		issueKey: Argument.optional(
			Argument.string("issue-key").pipe(
				Argument.withDescription("Closure projection issue key (status)"),
			),
		),
		limit: Flag.integer("limit").pipe(
			Flag.withAlias("n"),
			Flag.withDescription("Number of issues to show (list, triage)"),
			Flag.withDefault(20),
		),
		tool: Flag.optional(
			Flag.string("tool").pipe(
				Flag.withAlias("t"),
				Flag.withDescription("Filter by tool name (list, clean)"),
			),
		),
		json: Flag.boolean("json").pipe(
			Flag.withAlias("j"),
			Flag.withDescription("Output as JSON"),
			Flag.withDefault(false),
		),
		id: Flag.optional(
			Flag.integer("id").pipe(Flag.withDescription("Delete a single grievance by id (clean)")),
		),
		all: Flag.boolean("all").pipe(
			Flag.withDescription("Delete every grievance (clean)"),
			Flag.withDefault(false),
		),
		disposition: Flag.optional(
			Flag.choice("disposition", TOOL_ISSUE_DISPOSITIONS).pipe(
				Flag.withDescription("Filter triage or set status"),
			),
		),
		owner: Flag.optional(Flag.string("owner").pipe(Flag.withDescription("Disposition owner"))),
		change: Flag.optional(
			Flag.string("change").pipe(Flag.withDescription("Change, HR, issue, or PR reference")),
		),
		proof: Flag.optional(
			Flag.string("proof").pipe(Flag.withDescription("Regression proof reference")),
		),
		reason: Flag.optional(Flag.string("reason").pipe(Flag.withDescription("Disposition reason"))),
		canonical: Flag.optional(
			Flag.string("canonical").pipe(Flag.withDescription("Canonical issue key for a duplicate")),
		),
		build: Flag.optional(
			Flag.string("build").pipe(Flag.withDescription("Build carrying the disposition")),
		),
		since: Flag.optional(
			Flag.string("since").pipe(Flag.withDescription("Triage since ISO time or duration")),
		),
		session: Flag.optional(
			Flag.string("session").pipe(Flag.withDescription("Filter triage by session ID")),
		),
	},
	(config) =>
		Effect.promise(async () => {
			if (config.action === "status") {
				const issueKey = Option.getOrUndefined(config.issueKey);
				const disposition = Option.getOrUndefined(config.disposition);
				if (!issueKey || !disposition)
					throw new Error("grievances status requires ISSUE-KEY and --disposition");
				await setToolIssueStatus({
					issueKey,
					disposition,
					owner: Option.getOrUndefined(config.owner),
					change: Option.getOrUndefined(config.change),
					proof: Option.getOrUndefined(config.proof),
					reason: Option.getOrUndefined(config.reason),
					canonicalIssueKey: Option.getOrUndefined(config.canonical),
					build: Option.getOrUndefined(config.build),
					json: config.json,
				});
				return;
			}
			if (config.action === "triage") {
				if (Option.isSome(config.issueKey))
					throw new Error("grievances triage does not accept an issue key");
				await triageToolIssues({
					limit: config.limit,
					tool: Option.getOrUndefined(config.tool),
					disposition: Option.getOrUndefined(config.disposition),
					since: Option.getOrUndefined(config.since),
					session: Option.getOrUndefined(config.session),
					json: config.json,
				});
				return;
			}
			if (config.action === "clean") {
				await cleanGrievances({
					id: Option.getOrUndefined(config.id),
					tool: Option.getOrUndefined(config.tool),
					all: config.all,
					json: config.json,
				});
				return;
			}
			if (config.action === "push") {
				await pushGrievances({ json: config.json });
				return;
			}
			await listGrievances({
				limit: config.limit,
				tool: Option.getOrUndefined(config.tool),
				json: config.json,
			});
		}),
).pipe(
	Command.withDescription("View, clean, or push reported tool issues (auto-QA grievances)"),
	Command.withExamples([
		{ command: "omp grievances" },
		{ command: "omp grievances list --tool find" },
		{ command: "omp grievances clean --id 209" },
		{ command: "omp grievances clean --tool find" },
		{ command: "omp grievances clean --all" },
		{ command: "omp grievances push" },
		{ command: "omp grievances triage --json" },
		{
			command:
				"omp grievances status <issue-key> --disposition fixed --change <change> --proof <artifact>",
		},
	]),
);
