/**
 * Top-level CLI command table.
 *
 * Lives in its own module (importable without side effects) so that tests can
 * inspect the registered subcommands without triggering the side-effectful
 * top-level await in `cli.ts`. Adding a new subcommand here is enough to make
 * `runCli` route to it instead of forwarding the argv as a prompt to
 * `launch` — see #1496 for the original "args silently leak to the LLM"
 * regression that motivated the split.
 */
import { commandEntry, type OmpCommandEntry } from "@oh-my-pi/pi-utils/cli";

export const commands: OmpCommandEntry[] = [
	commandEntry({ name: "launch", load: () => import("./commands/launch").then(m => m.default) }),
	commandEntry({ name: "acp", load: () => import("./commands/acp").then(m => m.default) }),
	commandEntry({ name: "auth-broker", load: () => import("./commands/auth-broker").then(m => m.default) }),
	commandEntry({ name: "auth-gateway", load: () => import("./commands/auth-gateway").then(m => m.default) }),
	commandEntry({ name: "agents", load: () => import("./commands/agents").then(m => m.default) }),
	commandEntry({ name: "automations", load: () => import("./task/automations-command").then(m => m.default) }),
	commandEntry({ name: "bench", load: () => import("./commands/bench").then(m => m.default) }),
	commandEntry({ name: "commit", load: () => import("./commands/commit").then(m => m.default) }),
	commandEntry({ name: "completions", load: () => import("./commands/completions").then(m => m.default) }),
	commandEntry({ name: "__complete", load: () => import("./commands/complete").then(m => m.default) }),
	commandEntry({ name: "context-repair", load: () => import("./commands/context-repair").then(m => m.default) }),
	commandEntry({ name: "config", load: () => import("./commands/config").then(m => m.default) }),
	commandEntry({ name: "dry-balance", load: () => import("./commands/dry-balance").then(m => m.default) }),
	commandEntry({ name: "doctor", load: () => import("./commands/doctor").then(m => m.default) }),
	commandEntry({ name: "disk", load: () => import("./commands/disk").then(m => m.default) }),
	commandEntry({ name: "fleet", load: () => import("./commands/fleet").then(m => m.default) }),
	commandEntry({ name: "friction", load: () => import("./commands/friction").then(m => m.default) }),
	commandEntry({ name: "grep", load: () => import("./commands/grep").then(m => m.default) }),
	commandEntry({ name: "gallery", load: () => import("./commands/gallery").then(m => m.default) }),
	commandEntry({ name: "grievances", load: () => import("./commands/grievances").then(m => m.default) }),
	commandEntry({ name: "install", load: () => import("./commands/install").then(m => m.default) }),
	commandEntry({ name: "refusals", load: () => import("./commands/refusals").then(m => m.default) }),
	commandEntry({ name: "irc", load: () => import("./commands/irc").then(m => m.default) }),
	commandEntry({ name: "join", load: () => import("./commands/join").then(m => m.default) }),
	commandEntry({ name: "models", load: () => import("./commands/models").then(m => m.default) }),
	commandEntry({ name: "policy", load: () => import("./commands/policy").then(m => m.default) }),
	commandEntry({ name: "plugin", load: () => import("./commands/plugin").then(m => m.default) }),
	commandEntry({ name: "say", load: () => import("./commands/say").then(m => m.default) }),
	commandEntry({ name: "rollout", load: () => import("./session/rollout").then(m => m.default) }),
	commandEntry({ name: "setup", load: () => import("./commands/setup").then(m => m.default) }),
	commandEntry({ name: "sessions", load: () => import("./commands/sessions").then(m => m.default) }),
	commandEntry({ name: "shell", load: () => import("./commands/shell").then(m => m.default) }),
	commandEntry({ name: "read", load: () => import("./commands/read").then(m => m.default) }),
	commandEntry({ name: "ssh", load: () => import("./commands/ssh").then(m => m.default) }),
	commandEntry({ name: "stats", load: () => import("./commands/stats").then(m => m.default) }),
	commandEntry({ name: "update", load: () => import("./commands/update").then(m => m.default) }),
	commandEntry({ name: "usage", load: () => import("./commands/usage").then(m => m.default) }),
	commandEntry({ name: "tiny-models", load: () => import("./commands/tiny-models").then(m => m.default) }),
	commandEntry({ name: "token", load: () => import("./commands/token").then(m => m.default) }),
	commandEntry({ name: "workspace", load: () => import("./commands/workspace").then(m => m.default) }),
	commandEntry({ name: "worktree", load: () => import("./commands/worktree").then(m => m.default), aliases: ["wt"] }),
	commandEntry({ name: "search", load: () => import("./commands/web-search").then(m => m.default), aliases: ["q"] }),
];

const RESERVED_TOP_LEVEL_WORDS = new Map<string, string>([
	[
		"extensions",
		'`omp extensions` is not a management command. Use `omp plugin list` / `omp plugin install`, or run `omp launch extensions` if you meant to send "extensions" as a prompt.',
	],
]);

export function reservedTopLevelWordMessage(first: string | undefined, argc = 1): string | undefined {
	if (argc !== 1 || !first || first.startsWith("-") || first.startsWith("@")) return undefined;
	return RESERVED_TOP_LEVEL_WORDS.get(first);
}

/**
 * Return true when `first` matches a registered subcommand name or alias.
 *
 * Flags (`-…`) and `@file` arguments are never subcommands; for those the CLI
 * runner skips ahead to the default `launch` command.
 */
export function isSubcommand(first: string | undefined): boolean {
	if (!first || first.startsWith("-") || first.startsWith("@")) return false;
	return commands.some(entry => entry.name === first || entry.aliases?.includes(first));
}

export type ResolvedCliArgv = { argv: string[] } | { error: string };

/**
 * Decide what the CLI runner should do with raw argv: reject bare reserved
 * management words, pass help/version through untouched, and route everything
 * that is not a known subcommand to `launch`.
 */
export function resolveCliArgv(argv: string[]): ResolvedCliArgv {
	const first = argv[0];
	const reservedMessage = reservedTopLevelWordMessage(first, argv.length);
	if (reservedMessage) return { error: reservedMessage };
	if (first === "--help" || first === "-h" || first === "--version" || first === "-v" || first === "help") {
		return { argv };
	}
	return { argv: isSubcommand(first) ? argv : ["launch", ...argv] };
}
