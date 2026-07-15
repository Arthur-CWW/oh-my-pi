import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { type PolicyCliAction, type PolicyCliRequest, runPolicyCommand } from "../cli/policy-cli";

const ACTIONS: readonly PolicyCliAction[] = ["get", "explain", "diff", "set", "rollback", "import", "export"];

export default class Policy extends Command {
	static description = "Inspect and mutate the typed runtime policy journal";

	static args = {
		action: Args.string({ description: "Policy action", required: true, options: ACTIONS }),
		key: Args.string({ description: "Routing key or transaction ID", required: false }),
		value: Args.string({ description: "Value, timestamp, or source path", required: false, multiple: true }),
	};

	static flags = {
		json: Flags.boolean({ description: "Output JSON", default: false }),
		"dry-run": Flags.boolean({ description: "Preview import without appending", default: false }),
		config: Flags.string({ description: "Global config.yml path" }),
		frontmatter: Flags.string({ description: "Agent frontmatter path", multiple: true }),
		from: Flags.string({ description: "Diff start ISO timestamp" }),
		to: Flags.string({ description: "Diff end ISO timestamp" }),
		reason: Flags.string({ description: "Transaction reason" }),
		workstream: Flags.string({ description: "Workstream scope" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Policy);
		const action = args.action as PolicyCliAction;
		const values = Array.isArray(args.value) ? args.value : args.value === undefined ? [] : [args.value];
		const request: PolicyCliRequest = {
			action,
			key: args.key,
			value: action === "set" ? values.join(" ") : undefined,
			transactionId: action === "rollback" ? args.key : undefined,
			from: flags.from,
			to: flags.to,
			sourcePaths: action === "import" ? values : undefined,
			frontmatterPaths: flags.frontmatter,
			dryRun: flags["dry-run"],
			json: flags.json,
			reason: flags.reason,
			workstream: flags.workstream,
			configPath: flags.config,
		};
		process.stdout.write(await runPolicyCommand(request));
	}
}
