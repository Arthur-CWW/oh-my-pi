/**
 * Manage SSH host configurations.
 */
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { runSSHCommand, type SSHAction, type SSHCommandArgs } from "../cli/ssh-cli";
import { initTheme } from "../modes/theme/theme";

const ACTIONS: readonly SSHAction[] = ["add", "remove", "list"];

export default Command.make(
	"ssh",
	{
		action: Argument.choice("action", ACTIONS).pipe(
			Argument.withDescription("SSH action"),
			Argument.withDefault("list"),
		),
		targets: Argument.string("targets").pipe(
			Argument.withDescription("Host name or arguments"),
			Argument.variadic(),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON")),
		host: Flag.optional(Flag.string("host").pipe(Flag.withDescription("Host address"))),
		user: Flag.optional(Flag.string("user").pipe(Flag.withDescription("Username"))),
		port: Flag.optional(Flag.string("port").pipe(Flag.withDescription("Port number"))),
		key: Flag.optional(Flag.string("key").pipe(Flag.withDescription("Identity key path"))),
		desc: Flag.optional(Flag.string("desc").pipe(Flag.withDescription("Host description"))),
		compat: Flag.boolean("compat").pipe(Flag.withDescription("Enable compatibility mode")),
		scope: Flag.optional(
			Flag.choice("scope", ["project", "user"] as const).pipe(Flag.withDescription("Config scope (project|user)")),
		),
	},
	config =>
		Effect.promise(async () => {
			const cmd: SSHCommandArgs = {
				action: config.action,
				args: [...config.targets],
				flags: {
					json: config.json,
					host: Option.getOrUndefined(config.host),
					user: Option.getOrUndefined(config.user),
					port: Option.getOrUndefined(config.port),
					key: Option.getOrUndefined(config.key),
					desc: Option.getOrUndefined(config.desc),
					compat: config.compat,
					scope: Option.getOrUndefined(config.scope),
				},
			};

			await initTheme();
			await runSSHCommand(cmd);
		}),
).pipe(Command.withDescription("Manage SSH host configurations"));
