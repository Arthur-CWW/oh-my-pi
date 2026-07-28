/**
 * `omp auth-broker` — manage the omp credential vault.
 */
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
	AUTH_BROKER_ACTIONS,
	type AuthBrokerCommandArgs,
	runAuthBrokerCommand,
} from "../cli/auth-broker-cli";
import { initTheme } from "../modes/theme/theme";

export default Command.make(
	"auth-broker",
	{
		action: Argument.choice("action", AUTH_BROKER_ACTIONS).pipe(Argument.withDescription("Sub-command")),
		// Second positional: provider id (login/logout) or filesystem path (import).
		source: Argument.optional(
			Argument.string("source").pipe(
				Argument.withDescription("OAuth provider id (login/logout) or path (import)"),
			),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON")),
		bind: Flag.optional(
			Flag.string("bind").pipe(Flag.withAlias("b"), Flag.withDescription("Bind address for `serve` (host:port)")),
		),
		regenerate: Flag.boolean("regenerate").pipe(Flag.withDescription("Regenerate the bearer token")),
		via: Flag.optional(
			Flag.string("via").pipe(Flag.withDescription("SSH user@host for remote login (login --via=user@host)")),
		),
		provider: Flag.optional(
			Flag.string("provider").pipe(
				Flag.withDescription("Override provider id for `import` (e.g. when JSON `type` is unrecognized)"),
			),
		),
		"include-disabled": Flag.boolean("include-disabled").pipe(
			Flag.withDescription("Import credentials whose JSON has `disabled: true` (import)"),
		),
		"from-local": Flag.boolean("from-local").pipe(
			Flag.withDescription("migrate source: local SQLite + env vars (required for `migrate`)"),
		),
		"include-env": Flag.boolean("include-env").pipe(
			Flag.withDescription("Capture env-var API keys for providers not yet on broker (migrate)"),
		),
		"include-oauth": Flag.boolean("include-oauth").pipe(
			Flag.withDescription("Also upload OAuth from local SQLite during migrate (default skips them)"),
		),
		"dry-run": Flag.boolean("dry-run").pipe(
			Flag.withDescription("Print actions without executing (import / login --via / migrate)"),
		),
	},
	config =>
		Effect.promise(async () => {
			const action = config.action;
			const source = Option.getOrUndefined(config.source);
			const provider = Option.getOrUndefined(config.provider);
			const cmd: AuthBrokerCommandArgs = {
				action,
				flags: {
					json: config.json,
					bind: Option.getOrUndefined(config.bind),
					regenerate: config.regenerate,
					via: Option.getOrUndefined(config.via),
					// `login`/`logout` reuse the legacy `provider` slot; `import` keeps `source` separate
					// so `provider` flag (used as an override) is unambiguous.
					provider: action === "import" ? provider : (source ?? provider),
					source,
					includeDisabled: config["include-disabled"],
					fromLocal: config["from-local"],
					includeEnv: config["include-env"],
					includeOauth: config["include-oauth"],
					dryRun: config["dry-run"],
				},
			};
			await initTheme();
			await runAuthBrokerCommand(cmd);
		}),
).pipe(
	Command.withDescription("Manage the omp auth-broker (credential vault)"),
	Command.withExamples([
		{ command: "omp auth-broker serve", description: "Boot the broker against the local SQLite store" },
		{ command: "omp auth-broker serve --bind=127.0.0.1:9000", description: "Boot on a non-default port" },
		{ command: "omp auth-broker token", description: "Print the bearer token" },
		{ command: "omp auth-broker token --regenerate", description: "Rotate the bearer token" },
		{ command: "omp auth-broker list", description: "List supported OAuth providers" },
		{ command: "omp auth-broker login anthropic", description: "Local login (run on the broker host)" },
		{ command: "omp auth-broker login", description: "Interactive provider selection" },
		{ command: "omp auth-broker login anthropic --via=user@broker", description: "Remote login over SSH tunnel" },
		{
			command: "omp auth-broker logout anthropic",
			description: "Log out of a provider (interactive without provider arg)",
		},
		{ command: "omp auth-broker import ~/.cliproxy/auth", description: "Import a CLIProxyAPI auth dump" },
		{
			command: "omp auth-broker import ~/.cliproxy/auth/claude-foo.json --provider anthropic",
			description: "Import a single CLIProxyAPI JSON, overriding the provider mapping",
		},
		{
			command: "omp auth-broker migrate --from-local --include-env --dry-run",
			description: "Preview a migration from local store + env vars to the configured broker",
		},
		{ command: "omp auth-broker migrate --from-local --include-env", description: "Apply the migration" },
		{ command: "omp auth-broker status", description: "Health-check the configured remote broker" },
	]),
);
