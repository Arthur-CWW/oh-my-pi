import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { type IrcCliAction, runIrcCommand } from "../cli/irc-cli";

const ACTIONS: IrcCliAction[] = ["list", "send", "inbox"];

export default Command.make(
	"irc",
	{
		action: Argument.choice("action", ACTIONS).pipe(Argument.withDescription("IRC action")),
		values: Argument.string("values").pipe(
			Argument.withDescription("Peer name and message text"),
			Argument.variadic(),
		),
		from: Flag.string("from").pipe(Flag.withDescription("Sender name for send"), Flag.withDefault("human")),
		peek: Flag.boolean("peek").pipe(
			Flag.withDescription("Read inbox without marking messages delivered"),
			Flag.withDefault(false),
		),
	},
	config =>
		Effect.sync(() => {
			const result = runIrcCommand({
				action: config.action,
				args: [...config.values],
				flags: {
					from: config.from,
					peek: config.peek,
				},
			});
			process.exitCode = result.exitCode;
		}),
).pipe(
	Command.withDescription("Send and receive messages on the OMP cross-session IRC bus"),
	Command.withExamples([
		{ command: "omp irc list", description: "List running sessions registered on the IRC bus" },
		{
			command: "omp irc send harness-abc123 'please check your inbox'",
			description: "Send a message from a human/script to a running session",
		},
		{ command: "omp irc inbox harness-abc123", description: "Drain a peer inbox" },
		{ command: "omp irc inbox harness-abc123 --peek", description: "Preview a peer inbox without consuming messages" },
	]),
);
