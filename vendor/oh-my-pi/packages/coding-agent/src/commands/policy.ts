import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
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

export default class Policy extends Command {
	static description = "Inspect and mutate the typed runtime policy journal";

	static args = {
		action: Args.string({ description: "Policy action", required: true, options: ACTIONS }),
		key: Args.string({ description: "Routing key or transaction ID", required: false }),
		value: Args.string({ description: "Value, timestamp, or source path", required: false, multiple: true }),
	};

	static flags = {
		json: Flags.boolean({ description: "Output JSON", default: false }),
		"dry-run": Flags.boolean({ description: "Preview set or rollback without appending", default: false }),
		apply: Flags.boolean({
			description: "Commit a validated policy import (imports are dry-run by default)",
			default: false,
		}),
		config: Flags.string({ description: "Global config.yml path" }),
		frontmatter: Flags.string({ description: "Agent frontmatter path", multiple: true }),
		from: Flags.string({ description: "Diff start sequence or ISO timestamp" }),
		to: Flags.string({ description: "Diff end sequence or ISO timestamp" }),
		"effective-from": Flags.string({ description: "Effective-from ISO timestamp for policy set" }),
		"expires-at": Flags.string({ description: "Expiry ISO timestamp for policy set" }),
		"expires-in": Flags.string({ description: "Positive duration from effective-from (for example 30m, 2h, 1d)" }),
		reason: Flags.string({ description: "Transaction reason" }),
		workstream: Flags.string({ description: "Workstream scope" }),
		author: Flags.string({ description: "History author kind, UID, or session ID" }),
		since: Flags.string({ description: "History lower-bound timestamp" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Policy);
		const action = args.action as PolicyCliAction;
		const values = Array.isArray(args.value) ? args.value : args.value === undefined ? [] : [args.value];
		const request: PolicyCliRequest = {
			action,
			key: args.key,
			value: action === "set" || (action === "impact" && values.length > 0) ? values.join(" ") : undefined,
			transactionId: action === "rollback" || (action === "impact" && values.length === 0) ? args.key : undefined,
			from: flags.from,
			to: flags.to,
			effectiveFrom: flags["effective-from"],
			expiresAt: flags["expires-at"],
			expiresIn: flags["expires-in"],
			sourcePaths: action === "import" ? values : undefined,
			frontmatterPaths: flags.frontmatter,
			dryRun: flags["dry-run"],
			apply: flags.apply,
			json: flags.json,
			reason: flags.reason,
			workstream: flags.workstream,
			author: flags.author,
			since: flags.since,
			configPath: flags.config,
		};
		process.stdout.write(await runPolicyCommand(request));
	}
}
