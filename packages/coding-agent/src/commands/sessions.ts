import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { resumeIdleSession } from "../resource/idle-reclaimer";
import { collectSessionHealth, formatSessionHealthJson, formatSessionHealthTable } from "../resource/session-health";

export default Command.make(
	"sessions",
	{
		action: Argument.choice("action", ["health", "resume"] as const).pipe(
			Argument.withDescription("Session lifecycle action"),
		),
		session: Argument.optional(
			Argument.string("session").pipe(Argument.withDescription("Session id or unique id prefix")),
		),
		print: Flag.boolean("print").pipe(Flag.withDescription("Print the exact relaunch command without executing it")),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output session health as JSON")),
	},
	config =>
		Effect.promise(async () => {
			const session = Option.getOrUndefined(config.session);
			if (config.action === "health") {
				if (session) throw new Error("sessions health does not accept a session selector");
				if (config.print) throw new Error("--print is accepted only by sessions resume");
				const report = await collectSessionHealth();
				process.stdout.write(config.json ? formatSessionHealthJson(report) : formatSessionHealthTable(report));
				return;
			}
			if (!session) throw new Error("sessions resume requires a session id");
			if (config.json) throw new Error("--json is accepted only by sessions health");
			const result = await resumeIdleSession(session, { execute: !config.print });
			if (result.exitCode !== undefined && result.exitCode !== 0) process.exitCode = result.exitCode;
		}),
).pipe(
	Command.withDescription("Inspect session health and resume sessions parked by the idle reclaimer"),
	Command.withExamples([
		{ command: "omp sessions health", description: "Inspect health evidence for every known local session" },
		{ command: "omp sessions health --json", description: "Output versioned machine-readable health evidence" },
		{ command: "omp sessions resume <session-id>", description: "Print and execute the recorded relaunch" },
		{ command: "omp sessions resume <session-id> --print", description: "Print the relaunch without executing it" },
	]),
);
