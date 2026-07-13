/** Manage the local Fable refusal corpus and replay history. */
import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { type RefusalsAction, runRefusalsCommand } from "../cli/refusals-cli";

export default class Refusals extends Command {
	static description = "List, review, and replay Fable refusal cases";

	static args = {
		action: Args.string({
			description: "list (default), show, stats, mark, or replay",
			required: false,
			options: ["list", "show", "stats", "mark", "replay"],
			default: "list",
		}),
		id: Args.string({ description: "Refusal case id", required: false }),
	};

	static flags = {
		limit: Flags.integer({ char: "n", description: "Number of cases to show", default: 50 }),
		json: Flags.boolean({ char: "j", description: "Output JSON", default: false }),
		verdict: Flags.string({ description: "Human verdict for mark" }),
		note: Flags.string({ description: "Remediation note for mark" }),
		falsePositives: Flags.boolean({ description: "Replay every false-positive case", default: false }),
	};

	static examples = [
		"omp refusals list",
		"omp refusals show <id>",
		"omp refusals stats --json",
		"omp refusals mark <id> --verdict false-positive --note 'safe local request'",
		"omp refusals replay <id>",
		"omp refusals replay --false-positives",
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Refusals);
		await runRefusalsCommand({
			action: args.action as RefusalsAction,
			id: args.id,
			flags: {
				limit: flags.limit,
				json: flags.json,
				verdict: flags.verdict,
				note: flags.note,
				falsePositives: flags.falsePositives,
			},
		});
	}
}
