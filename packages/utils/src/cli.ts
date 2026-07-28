/**
 * OMP-specific CLI dispatcher built on Effect v4's `effect/unstable/cli`.
 *
 * This is deliberately thin: Effect owns per-command flag/argument parsing,
 * help/version rendering, and completions. All this module adds is OMP's
 * two-phase lazy dispatch, which Effect's static `Command.withSubcommands`
 * cannot express:
 *
 *   1. Match `argv[0]` against the registry (by name or alias) *before*
 *      importing anything.
 *   2. Import only the matched command module and run its own descriptor
 *      through `Command.runWith`.
 *
 * Effect v4 beta erases a heterogeneous `Command.Command.Any` back to
 * `unknown` error/environment channels the moment it flows through
 * `Command.runWith` or `Command.withSubcommands`, which then fails to satisfy
 * `Effect.runPromise` (its requirement channel must be `never`). To keep the
 * dispatch typed without casts, each command is registered through the
 * {@link commandEntry} factory: the factory captures the command's concrete
 * type *before* it is widened to `OmpCommand`, so the `execute` closure runs
 * `Command.runWith` on the fully-typed descriptor and discharges its
 * environment with `NodeServices.layer`. The registry only ever sees the
 * erased `OmpCommand` metadata; the typed run stays sealed inside the closure.
 *
 * Root help is the one path that must load every visible descriptor. Rather
 * than build a `bin` root over `Command.Command.Any[]` (which erases the
 * channels), it renders the usage/subcommand listing directly from descriptor
 * metadata and appends any caller-supplied extra help text. `--version` and
 * unknown commands stay synchronous fast paths so neither loads a module.
 *
 * Design goals:
 *   - Lazy command imports (only the invoked command is loaded for dispatch)
 *   - No filesystem scanning, no manifest files, no plugin loading
 *   - A single Effect run boundary per command, fed the Node platform services
 */
import * as fs from "node:fs";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { CliError, Command } from "effect/unstable/cli";

/**
 * Streaming startup marker, enabled by `PI_DEBUG_STARTUP`. Local copy of
 * `logger.startupMarker` so the minimal `--version`/bootstrap import graph
 * stays free of the winston-backed logger module. Synchronous on purpose:
 * a command module whose import hangs (dlopen, fs on a dead mount) must
 * still leave its `:start` marker behind.
 */
function startupMarker(text: string): void {
	if (!process.env.PI_DEBUG_STARTUP) return;
	try {
		fs.writeSync(2, `[startup] ${text}\n`);
	} catch {
		// stderr unavailable; markers are best-effort
	}
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A fully-built Effect CLI command, erased to Effect's own top type. Command
 * modules construct these with `Command.make(...).pipe(...)` and export them as
 * their default; the registry only reads their name/description/alias/hidden
 * metadata, so the heterogeneous collection is typed as `Command.Command.Any`.
 * The typed run of each command is captured separately by {@link commandEntry}.
 */
export type OmpCommand = Command.Command.Any;

/**
 * A lazily-loaded command registry entry. `load` yields the command's erased
 * metadata (for root help and shell completions); `execute` imports the module
 * and runs its concrete descriptor. Construct entries with {@link commandEntry}
 * so the concrete error/environment channels are preserved through the run.
 */
export interface OmpCommandEntry {
	readonly name: string;
	readonly aliases?: readonly string[];
	/** Import the command module and return its descriptor as erased metadata. */
	readonly load: () => Promise<OmpCommand>;
	/** Import the command module and run its descriptor with the given argv. */
	readonly execute: (argv: readonly string[], version: string) => Promise<void>;
}

export interface OmpRunOptions {
	readonly bin: string;
	readonly version: string;
	readonly argv: readonly string[];
	readonly commands: readonly OmpCommandEntry[];
	/**
	 * Extra help text appended after the root usage/subcommand listing. Invoked
	 * only on the root-help path; the returned text is printed verbatim (behind a
	 * leading blank line) when non-empty. Kept as a lazy callback so callers can
	 * defer importing heavy help modules until root help actually runs.
	 */
	readonly extraHelp?: () => string | Promise<string>;
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

/**
 * Register a command with its lazy loader. The loader's concrete
 * `Command.Command<Name, Input, ContextInput, E, ...>` type is captured here so
 * the returned `execute` closure can run `Command.runWith` with the descriptor's
 * real error channel intact and discharge its environment with
 * `NodeServices.layer` — the erasure that `OmpCommand` (`Command.Command.Any`)
 * would otherwise force onto `Effect.runPromise` never escapes this function.
 *
 * The command's requirement is pinned to `NodeServices.NodeServices`: that is
 * exactly the set of services `NodeServices.layer` provides (the CLI
 * `Command.Environment` plus `Crypto`), so `Command.runWith`'s `R | Environment`
 * result reduces to a concrete union that `Effect.provide` fully discharges to
 * `never`. A command needing services outside that set is rejected here at the
 * call site rather than failing at runtime.
 */
export function commandEntry<Name extends string, Input, ContextInput, E>(config: {
	readonly name: string;
	readonly aliases?: readonly string[];
	readonly load: () => Promise<Command.Command<Name, Input, ContextInput, E, NodeServices.NodeServices>>;
}): OmpCommandEntry {
	const loadConcrete = async (): Promise<Command.Command<Name, Input, ContextInput, E, NodeServices.NodeServices>> => {
		startupMarker(`cli:load:${config.name}:start`);
		const command = await config.load();
		startupMarker(`cli:load:${config.name}:done`);
		return command;
	};
	return {
		name: config.name,
		aliases: config.aliases,
		load: loadConcrete,
		execute: async (argv, version) => {
			const command = await loadConcrete();
			// The single Effect run boundary. CLI errors (bad flags, missing args,
			// unknown subcommands) are already rendered by Effect before failing, so
			// we only translate them into `exitCode = 1`. Handler failures are left
			// to reject so the entry point can report them.
			await Effect.runPromise(
				Command.runWith(command, { version })(argv).pipe(
					Effect.catchIf(CliError.isCliError, () =>
						Effect.sync(() => {
							process.exitCode = 1;
						}),
					),
					Effect.provide(NodeServices.layer),
				),
			);
		},
	};
}

// ---------------------------------------------------------------------------
// Root help
// ---------------------------------------------------------------------------

/** `name` plus the descriptor's own alias, matching Effect's `name, alias` form. */
function subcommandLabel(name: string, alias: string | undefined): string {
	return alias ? `${name}, ${alias}` : name;
}

/**
 * Render the root usage and subcommand listing from descriptor metadata,
 * mirroring the layout Effect's built-in `--help` produces for a `bin` root
 * (USAGE line, then a padded SUBCOMMANDS table). Hidden commands are omitted,
 * exactly as the built-in renderer drops them.
 */
function renderRootHelp(bin: string, descriptors: readonly { entry: OmpCommandEntry; command: OmpCommand }[]): string {
	const visible = descriptors.filter(({ command }) => !command.hidden);
	const sections: string[] = ["USAGE", `  ${bin}${visible.length > 0 ? " <subcommand>" : ""} [flags]`];
	if (visible.length > 0) {
		const labels = visible.map(({ entry, command }) => subcommandLabel(entry.name, command.alias));
		// Effect pads the name column to `max(label length) + 4`, capped at 20.
		const column = Math.min(Math.max(...labels.map(label => label.length)) + 4, 20);
		sections.push("", "SUBCOMMANDS");
		visible.forEach(({ command }, index) => {
			const description = command.shortDescription ?? command.description ?? "";
			sections.push(`  ${labels[index].padEnd(column)}${description}`);
		});
	}
	return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Main entry point. Each command is registered with a lazy loader; only the
 * matched command (or, for root help, every visible descriptor) is imported.
 */
export async function run(opts: OmpRunOptions): Promise<void> {
	const { bin, version, argv, commands } = opts;
	const commandId = argv[0] ?? "";
	const rest = argv.slice(1);

	// Root help: no command, `help`, or a top-level help flag. Needs the full
	// tree to list subcommands, so it loads every visible descriptor's metadata.
	if (commandId === "" || commandId === "help" || commandId === "--help" || commandId === "-h") {
		const descriptors = await Promise.all(commands.map(async entry => ({ entry, command: await entry.load() })));
		console.log(renderRootHelp(bin, descriptors));
		if (opts.extraHelp) {
			const extra = await opts.extraHelp();
			if (extra.trim().length > 0) process.stdout.write(`\n${extra}\n`);
		}
		return;
	}

	// Version: fast path, loads nothing.
	if (commandId === "--version" || commandId === "-v") {
		process.stdout.write(`${bin}/${version}\n`);
		return;
	}

	// Dispatch: resolve by name or alias, then import only the matched module.
	const entry = commands.find(e => e.name === commandId) ?? commands.find(e => e.aliases?.includes(commandId));
	if (!entry) {
		process.stderr.write(`Error: command ${commandId} not found\n`);
		process.exitCode = 1;
		return;
	}

	await entry.execute(rest, version);
}
