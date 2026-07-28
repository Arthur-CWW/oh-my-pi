import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { resumeIdleSession } from "../resource/idle-reclaimer";

export default Command.make(
	"sessions",
	{
		action: Argument.choice("action", ["resume"] as const).pipe(Argument.withDescription("Session lifecycle action")),
		session: Argument.string("session").pipe(Argument.withDescription("Session id or unique id prefix")),
		print: Flag.boolean("print").pipe(Flag.withDescription("Print the exact relaunch command without executing it")),
	},
	config =>
		Effect.promise(async () => {
			const result = await resumeIdleSession(config.session, { execute: !config.print });
			if (result.exitCode !== undefined && result.exitCode !== 0) process.exitCode = result.exitCode;
		}),
).pipe(
	Command.withDescription("Resume sessions parked by the idle reclaimer"),
	Command.withExamples([
		{ command: "omp sessions resume <session-id>", description: "Print and execute the recorded relaunch" },
		{ command: "omp sessions resume <session-id> --print", description: "Print the relaunch without executing it" },
	]),
);
