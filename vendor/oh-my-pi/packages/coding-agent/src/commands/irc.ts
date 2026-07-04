import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { type IrcCliAction, runIrcCommand } from "../cli/irc-cli";

const ACTIONS: IrcCliAction[] = ["list", "send", "inbox"];

export default class Irc extends Command {
	static description = "Send and receive messages on the OMP cross-session IRC bus";

	static args = {
		action: Args.string({
			description: "IRC action",
			required: true,
			options: ACTIONS,
		}),
		values: Args.string({
			description: "Peer name and message text",
			required: false,
			multiple: true,
		}),
	};

	static flags = {
		from: Flags.string({ description: "Sender name for send", default: "human" }),
		peek: Flags.boolean({ description: "Read inbox without marking messages delivered", default: false }),
	};

	static examples = [
		"# List running sessions registered on the IRC bus\n  omp irc list",
		"# Send a message from a human/script to a running session\n  omp irc send harness-abc123 'please check your inbox'",
		"# Drain a peer inbox\n  omp irc inbox harness-abc123",
		"# Preview a peer inbox without consuming messages\n  omp irc inbox harness-abc123 --peek",
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Irc);
		const values = Array.isArray(args.values) ? args.values : args.values ? [args.values] : [];
		const result = runIrcCommand({
			action: args.action as IrcCliAction,
			args: values,
			flags: {
				from: flags.from ?? "human",
				peek: flags.peek,
			},
		});
		process.exitCode = result.exitCode;
	}
}
