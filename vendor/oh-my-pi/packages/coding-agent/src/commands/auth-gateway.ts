/**
 * `omp auth-gateway` — run a forward proxy that injects auth from the broker.
 */
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
	AUTH_GATEWAY_ACTIONS,
	type AuthGatewayCommandArgs,
	runAuthGatewayCommand,
} from "../cli/auth-gateway-cli";
import { initTheme } from "../modes/theme/theme";

export default Command.make(
	"auth-gateway",
	{
		action: Argument.choice("action", AUTH_GATEWAY_ACTIONS).pipe(Argument.withDescription("Sub-command")),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON (token/status/check)")),
		bind: Flag.optional(
			Flag.string("bind").pipe(Flag.withAlias("b"), Flag.withDescription("Bind address for `serve` (host:port)")),
		),
		regenerate: Flag.boolean("regenerate").pipe(
			Flag.withDescription("Regenerate the gateway bearer token (token)"),
		),
		"no-auth": Flag.boolean("no-auth").pipe(
			Flag.withDescription(
				"Disable inbound bearer-token auth (serve). Useful when bound to loopback — any caller is allowed.",
			),
		),
		strict: Flag.boolean("strict").pipe(
			Flag.withDescription(
				"For `check`: additionally probe each credential against its provider's chat-completion endpoint. Slower; consumes a tiny amount of quota per credential.",
			),
		),
	},
	config =>
		Effect.promise(async () => {
			const cmd: AuthGatewayCommandArgs = {
				action: config.action,
				flags: {
					json: config.json,
					bind: Option.getOrUndefined(config.bind),
					regenerate: config.regenerate,
					noAuth: config["no-auth"],
					strict: config.strict,
				},
			};
			await initTheme();
			await runAuthGatewayCommand(cmd);
		}),
).pipe(
	Command.withDescription("Run an auth-gateway forward proxy backed by the configured broker"),
	Command.withExamples([
		{ command: "omp auth-gateway serve", description: "Boot the gateway against the configured broker" },
		{ command: "omp auth-gateway serve --bind=127.0.0.1:4000", description: "Boot on a non-default port" },
		{ command: "omp auth-gateway token", description: "Print the gateway bearer token (creates one on first run)" },
		{ command: "omp auth-gateway token --regenerate", description: "Rotate the gateway bearer token" },
		{
			command: "omp auth-gateway serve --no-auth",
			description: "Run on loopback without any bearer (anyone on this host can call)",
		},
		{ command: "omp auth-gateway status", description: "Show local gateway + broker config status" },
		{ command: "omp auth-gateway check", description: "Probe each broker credential to see which one is producing 401s" },
		{ command: "omp auth-gateway check --json", description: "Same, machine-readable for scripts" },
		{
			command: "omp auth-gateway check --strict",
			description: "Strict check — also exercises each credential with a real chat-completion ping",
		},
	]),
);
