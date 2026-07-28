/**
 * Manage plugins (install, uninstall, list, etc.).
 */
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { type PluginAction, type PluginCommandArgs, runPluginCommand } from "../cli/plugin-cli";
import { initTheme } from "../modes/theme/theme";

const ACTIONS: readonly PluginAction[] = [
	"install",
	"uninstall",
	"list",
	"link",
	"doctor",
	"features",
	"config",
	"enable",
	"disable",
	"marketplace",
	"discover",
	"upgrade",
];

export default Command.make(
	"plugin",
	{
		action: Argument.choice("action", ACTIONS).pipe(
			Argument.withDescription("Plugin action"),
			Argument.withDefault("list"),
		),
		targets: Argument.string("targets").pipe(
			Argument.withDescription("Packages, paths, or plugin names"),
			Argument.variadic(),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON")),
		fix: Flag.boolean("fix").pipe(Flag.withDescription("Attempt to fix issues (doctor)")),
		force: Flag.boolean("force").pipe(Flag.withDescription("Force install")),
		"dry-run": Flag.boolean("dry-run").pipe(Flag.withDescription("Show actions without applying changes")),
		local: Flag.boolean("local").pipe(
			Flag.withAlias("l"),
			Flag.withDescription("Operate on local plugin directory"),
		),
		enable: Flag.optional(Flag.string("enable").pipe(Flag.withDescription("Enable a feature"))),
		disable: Flag.optional(Flag.string("disable").pipe(Flag.withDescription("Disable a feature"))),
		set: Flag.optional(Flag.string("set").pipe(Flag.withDescription("Set plugin config (key=value)"))),
		scope: Flag.optional(
			Flag.choice("scope", ["user", "project"] as const).pipe(
				Flag.withDescription('Install scope: "user" (default) or "project"'),
			),
		),
	},
	config =>
		Effect.promise(async () => {
			const cmd: PluginCommandArgs = {
				action: config.action,
				args: [...config.targets],
				flags: {
					json: config.json,
					fix: config.fix,
					force: config.force,
					dryRun: config["dry-run"],
					local: config.local,
					enable: Option.getOrUndefined(config.enable),
					disable: Option.getOrUndefined(config.disable),
					set: Option.getOrUndefined(config.set),
					scope: Option.getOrUndefined(config.scope),
				},
			};

			await initTheme();
			await runPluginCommand(cmd);
		}),
).pipe(Command.withDescription("Manage plugins (install, uninstall, list, etc.)"));
