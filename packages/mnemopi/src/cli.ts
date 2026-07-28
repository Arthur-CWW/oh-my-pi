#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { Effect, Option } from "effect";
import * as EffConsole from "effect/Console";
import { Argument, Command, Flag } from "effect/unstable/cli";
import * as CliErr from "effect/unstable/cli/CliError";
import { NodeServices } from "@effect/platform-node";

import { dataDir as configuredDataDir, dbPath as configuredDbPath } from "./config";
import { BankManager, ValueError } from "./core/banks";
import { BeamMemory } from "./core/beam";
import type { ImportStats, RecallResult } from "./core/beam/types";
import { runDiagnostics } from "./diagnose";
import { runMcpServer } from "./mcp-server";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CliIo {
	write(data: string): void;
}

export interface CliContext {
	readonly dataDir?: string;
	readonly dbPath?: string;
	readonly memory?: BeamMemory;
	readonly createMemory?: () => BeamMemory;
	readonly stdout?: CliIo;
	readonly stderr?: CliIo;
}

export class CliError extends Error {
	constructor(
		message: string,
		readonly exitCode = 2,
	) {
		super(message);
		this.name = "CliError";
	}
}

type CommandHandler = (args: readonly string[], context?: CliContext) => number | Promise<number>;

// ── Module-level context (set by runCli, read by Effect handlers) ────────────

let _activeCtx: CliContext | undefined;

// ── Output helpers ───────────────────────────────────────────────────────────

function out(context: CliContext | undefined, text = ""): void {
	(context?.stdout ?? Bun.stdout).write(`${text}\n`);
}

function err(context: CliContext | undefined, text = ""): void {
	(context?.stderr ?? Bun.stderr).write(`${text}\n`);
}

function fail(message: string, exitCode = 2): never {
	throw new CliError(`Error: ${message}`, exitCode);
}

function usage(message: string): never {
	throw new CliError(message, 2);
}

function parseFloatArg(value: string, name: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) fail(`${name} must be a number: ${value}`);
	return parsed;
}

function parseIntArg(value: string, name: string): number {
	if (!/^[+-]?\d+$/.test(value)) fail(`${name} must be an integer: ${value}`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) fail(`${name} must be an integer: ${value}`);
	return parsed;
}

// ── Data-dir / DB resolution ─────────────────────────────────────────────────

function resolveDataDir(context?: CliContext): string {
	return context?.dataDir ?? configuredDataDir();
}

function resolveDbPath(context?: CliContext): string {
	return context?.dbPath ?? (context?.dataDir ? join(context.dataDir, "mnemopi.db") : configuredDbPath());
}

// ── Memory lifecycle ─────────────────────────────────────────────────────────

function getMemory(context?: CliContext): { memory: BeamMemory; owned: boolean } {
	if (context?.memory) return { memory: context.memory, owned: false };
	if (context?.createMemory) return { memory: context.createMemory(), owned: true };
	return { memory: new BeamMemory({ dbPath: resolveDbPath(context) }), owned: true };
}

async function withMemory<T>(context: CliContext | undefined, fn: (memory: BeamMemory) => T | Promise<T>): Promise<T> {
	const { memory, owned } = getMemory(context);
	try {
		const result = await fn(memory);
		if (owned) await memory.flushExtractions();
		return result;
	} finally {
		if (owned) memory.close();
	}
}

// ── Shared utilities ─────────────────────────────────────────────────────────

function asCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function memoryStats(memory: BeamMemory, dataDir?: string): Record<string, unknown> {
	const working = memory.getWorkingStats();
	const episodic = memory.getEpisodicStats();
	const triples = memory.db.query("SELECT COUNT(*) AS total FROM triples").get() as { total: number };
	const banks = new BankManager(dataDir).listBanks();
	return {
		total_memories: asCount(working.total) + asCount(episodic.total),
		beam: {
			working_memory: working,
			episodic_memory: episodic,
			triples: { total: asCount(triples.total) },
		},
		banks,
		database: memory.dbPath ?? ":memory:",
	};
}

function formatImportStats(stats: ImportStats): string {
	const working = stats.working_memory;
	const episodic = stats.episodic_memory;
	const scratchpad = stats.scratchpad;
	const consolidation = stats.consolidation_log;
	return [
		`${asCount(working.inserted)} working`,
		`${asCount(episodic.inserted)} episodic`,
		`${asCount(scratchpad.inserted)} scratchpad`,
		`${asCount(consolidation.inserted)} consolidation`,
		`${asCount(working.skipped) + asCount(episodic.skipped)} skipped`,
		`${asCount(working.overwritten) + asCount(episodic.overwritten)} overwritten`,
	].join(", ");
}

// ── Legacy command handlers (exported for direct use by tests) ───────────────

export const cmdExport: CommandHandler = (args, context) => {
	if (args.length === 0) usage("Usage: mnemopi export <file.json>");
	const outputPath = args[0] ?? "";
	return withMemory(context, memory => {
		mkdirSync(dirname(outputPath), { recursive: true });
		const data = memory.exportToDict();
		writeFileSync(outputPath, JSON.stringify(data, null, 2));
		const working = Array.isArray(data.working_memory) ? data.working_memory.length : 0;
		const episodic = Array.isArray(data.episodic_memory) ? data.episodic_memory.length : 0;
		const scratchpad = Array.isArray(data.scratchpad) ? data.scratchpad.length : 0;
		const consolidation = Array.isArray(data.consolidation_log) ? data.consolidation_log.length : 0;
		out(context, `Exported ${working} working, ${episodic} episodic, ${scratchpad} scratchpad, ${consolidation} consolidation to ${outputPath}`);
		return 0;
	});
};

export const cmdImport: CommandHandler = (args, context) => {
	if (args.length === 0) usage("Usage: mnemopi import <file.json>");
	const inputPath = args[0] ?? "";
	if (!existsSync(inputPath)) fail(`Import file not found: ${inputPath}`, 1);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(inputPath, "utf8"));
	} catch (error) {
		if (error instanceof SyntaxError) fail(`Invalid JSON: ${error.message}`, 1);
		throw error;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
		fail("Import file must contain a Mnemopi export object", 1);
	return withMemory(context, memory => {
		const stats = memory.importFromDict(parsed as Record<string, unknown>);
		out(context, `Imported ${formatImportStats(stats)} from ${inputPath}`);
		return 0;
	});
};

export const cmdRemember: CommandHandler = (args, context) => {
	if (args.length === 0) usage("Usage: mnemopi store <content> [source] [importance]");
	const content = args[0] ?? "";
	const source = args[1] ?? "cli";
	const importance = args[2] === undefined ? 0.5 : parseFloatArg(args[2], "importance");
	return withMemory(context, memory => {
		const memoryId = memory.remember(content, { source, importance, extractEntities: true });
		out(context, `Stored: ${memoryId}`);
		return 0;
	});
};

export const cmdRecall: CommandHandler = async (args, context) => {
	if (args.length === 0) usage("Usage: mnemopi recall <query> [top_k]");
	const query = args[0] ?? "";
	const topK = args[1] === undefined ? 5 : parseIntArg(args[1], "top_k");
	const { memory, owned } = getMemory(context);
	try {
		const results = await memory.recall(query, topK);
		out(context, `\nResults for: ${query}\n`);
		for (const result of results) {
			const content = result.content ?? "";
			const score = typeof result.score === "number" ? result.score : 0;
			out(context, `  ID: ${result.id ?? "?"}`);
			out(context, `  Content: ${content.slice(0, 150)}${content.length > 150 ? "..." : ""}`);
			out(context, `  Score: ${score.toFixed(3)}`);
			if ((result as RecallResult & { entity_match?: unknown }).entity_match) out(context, "  [entity match]");
			out(context);
		}
		return 0;
	} finally {
		if (owned) memory.close();
	}
};

export const cmdUpdate: CommandHandler = (args, context) => {
	if (args.length < 2) usage("Usage: mnemopi update <memory_id> <new_content> [importance]");
	const memoryId = args[0] ?? "";
	const content = args[1] ?? "";
	const importance = args[2] === undefined ? null : parseFloatArg(args[2], "importance");
	return withMemory(context, memory => {
		if (!memory.updateWorking(memoryId, content, importance)) fail(`Memory not found: ${memoryId}`, 1);
		out(context, `Updated: ${memoryId}`);
		return 0;
	});
};

export const cmdDelete: CommandHandler = (args, context) => {
	if (args.length === 0) usage("Usage: mnemopi delete <memory_id>");
	const memoryId = args[0] ?? "";
	return withMemory(context, memory => {
		if (!memory.forgetWorking(memoryId)) fail(`Memory not found: ${memoryId}`, 1);
		out(context, `Deleted: ${memoryId}`);
		return 0;
	});
};

export const cmdStats: CommandHandler = (_args, context) =>
	withMemory(context, memory => {
		const stats = memoryStats(memory, resolveDataDir(context));
		const beam = stats.beam as Record<string, Record<string, unknown>>;
		const wm = beam.working_memory ?? {};
		const ep = beam.episodic_memory ?? {};
		const triples = beam.triples ?? {};
		out(context, "\nMnemopi Stats\n");
		out(context, `  Total memories: ${asCount(stats.total_memories)}`);
		out(context, `  Working memory: ${asCount(wm.total)}`);
		out(context, `  Episodic memory: ${asCount(ep.total)}`);
		out(context, `  Knowledge triples: ${asCount(triples.total)}`);
		const banks = Array.isArray(stats.banks) ? stats.banks : [];
		if (banks.length > 0) out(context, `\n  Banks: ${banks.join(", ")}`);
		out(context, `  DB path: ${typeof stats.database === "string" ? stats.database : "N/A"}`);
		return 0;
	});

export const cmdSleep: CommandHandler = (_args, context) =>
	withMemory(context, memory => {
		const result = memory.sleepAllSessions(false);
		out(context, `Consolidation complete: ${JSON.stringify(result)}`);
		return 0;
	});

export const cmdScratchpad: CommandHandler = (args, context) => {
	if (args.length === 0) usage("Usage: mnemopi scratchpad <read|write|clear> [content]");
	const subcmd = args[0];
	return withMemory(context, memory => {
		if (subcmd === "read") {
			for (const item of memory.scratchpadRead() as Array<{ id?: string; content?: string }>) {
				out(context, `  ID: ${item.id ?? "?"}`);
				out(context, `  Content: ${item.content ?? ""}`);
			}
			return 0;
		}
		if (subcmd === "write") {
			if (args.length < 2) usage("Usage: mnemopi scratchpad write <content>");
			const id = memory.scratchpadWrite(args[1] ?? "");
			out(context, `Scratchpad stored: ${id}`);
			return 0;
		}
		if (subcmd === "clear") {
			memory.scratchpadClear();
			out(context, "Scratchpad cleared");
			return 0;
		}
		fail(`Unknown scratchpad command: ${subcmd}`);
	});
};

export const cmdBank: CommandHandler = (args, context) => {
	if (args.length === 0) usage("Usage: mnemopi bank <list|create|delete> [name]");
	const manager = new BankManager(resolveDataDir(context));
	const subcmd = args[0];
	try {
		if (subcmd === "list") {
			out(context, "\nMemory Banks:\n");
			for (const bank of manager.listBanks()) out(context, `  - ${bank}`);
			return 0;
		}
		if (subcmd === "create") {
			if (args.length < 2) fail("Usage: mnemopi bank create <name>");
			const name = args[1] ?? "";
			manager.createBank(name);
			out(context, `Created bank: ${name}`);
			return 0;
		}
		if (subcmd === "delete") {
			if (args.length < 2) fail("Usage: mnemopi bank delete <name>");
			const name = args[1] ?? "";
			if (!manager.deleteBank(name)) fail(`Bank not found: ${name}`, 1);
			out(context, `Deleted bank: ${name}`);
			return 0;
		}
		fail(`Unknown bank command: ${subcmd}`);
	} catch (error) {
		if (error instanceof CliError) throw error;
		if (error instanceof ValueError) fail(error.message);
		throw error;
	}
};

export const cmdDiagnose: CommandHandler = (_args, context) => {
	const result = runDiagnostics({
		dbPath: resolveDbPath(context),
		dataDir: resolveDataDir(context),
	});
	out(context, "\nMnemopi Diagnostics\n");
	out(context, `  Checks passed: ${result.checks_passed}/${result.checks_total}`);
	if (result.key_findings.length > 0) {
		out(context, "\n  Key findings:");
		for (const finding of result.key_findings) out(context, `    - ${finding}`);
	} else {
		out(context, "\n  No issues detected");
	}
	return result.checks_failed === 0 ? 0 : 1;
};

// ── Effect CLI: handler wrapper ──────────────────────────────────────────────

/** Wraps a legacy handler call into an Effect, lifting non-zero exit codes to CliError failures. */
function wrapHandler(fn: () => number | void | Promise<number | void>): Effect.Effect<void, CliError> {
	return Effect.tryPromise({
		try: async () => {
			const code = await fn();
			if (typeof code === "number" && code !== 0) throw new CliError("", code);
		},
		catch: (e) => (e instanceof CliError ? e : new CliError(String(e), 1)),
	});
}

// ── Effect CLI: subcommand definitions ───────────────────────────────────────
//
// Each user-facing command forwards its raw positional arguments to the matching
// business handler, which owns all validation, usage text, and exit codes.  The
// Effect command tree is responsible only for routing (command lookup, aliases,
// help); every legacy message and exit code is reproduced verbatim by the
// handlers, so behaviour is identical to the previous hand-rolled dispatcher.

const storeCmd = Command.make("store", { args: Argument.variadic(Argument.string("args")) }, config =>
	wrapHandler(() => cmdRemember(config.args, _activeCtx)),
).pipe(Command.withAlias("remember"), Command.withShortDescription("Store a memory"));

const recallCmd = Command.make("recall", { args: Argument.variadic(Argument.string("args")) }, config =>
	wrapHandler(() => cmdRecall(config.args, _activeCtx)),
).pipe(Command.withAlias("search"), Command.withShortDescription("Search memories"));

const updateCmd = Command.make("update", { args: Argument.variadic(Argument.string("args")) }, config =>
	wrapHandler(() => cmdUpdate(config.args, _activeCtx)),
).pipe(Command.withAlias("edit"), Command.withShortDescription("Update a memory"));

const deleteCmd = Command.make("delete", { args: Argument.variadic(Argument.string("args")) }, config =>
	wrapHandler(() => cmdDelete(config.args, _activeCtx)),
).pipe(Command.withAlias("forget"), Command.withShortDescription("Delete a memory"));

const exportCmd = Command.make("export", { args: Argument.variadic(Argument.string("args")) }, config =>
	wrapHandler(() => cmdExport(config.args, _activeCtx)),
).pipe(Command.withShortDescription("Export memories"));

const importCmd = Command.make("import", { args: Argument.variadic(Argument.string("args")) }, config =>
	wrapHandler(() => cmdImport(config.args, _activeCtx)),
).pipe(Command.withShortDescription("Import memories"));

const statsCmd = Command.make("stats", { args: Argument.variadic(Argument.string("args")) }, config =>
	wrapHandler(() => cmdStats(config.args, _activeCtx)),
).pipe(Command.withShortDescription("Show statistics"));

const sleepCmd = Command.make("sleep", { args: Argument.variadic(Argument.string("args")) }, config =>
	wrapHandler(() => cmdSleep(config.args, _activeCtx)),
).pipe(Command.withAlias("consolidate"), Command.withShortDescription("Run consolidation"));

const scratchpadCmd = Command.make("scratchpad", { args: Argument.variadic(Argument.string("args")) }, config =>
	wrapHandler(() => cmdScratchpad(config.args, _activeCtx)),
).pipe(Command.withAlias("sp"), Command.withShortDescription("Manage scratchpad"));

const bankCmd = Command.make("bank", { args: Argument.variadic(Argument.string("args")) }, config =>
	wrapHandler(() => cmdBank(config.args, _activeCtx)),
).pipe(Command.withShortDescription("Manage memory banks"));

const diagnoseCmd = Command.make("diagnose", { args: Argument.variadic(Argument.string("args")) }, config =>
	wrapHandler(() => cmdDiagnose(config.args, _activeCtx)),
).pipe(Command.withAlias("doctor"), Command.withShortDescription("Run diagnostics"));

// ── MCP subcommand ───────────────────────────────────────────────────────────

const mcpCmd = Command.make(
	"mcp",
	{
		transport: Flag.string("transport").pipe(Flag.withDefault("stdio"), Flag.withDescription("Transport protocol")),
		port: Flag.integer("port").pipe(Flag.optional, Flag.withDescription("Server port")),
		bank: Flag.string("bank").pipe(Flag.optional, Flag.withDescription("Memory bank")),
		host: Flag.string("host").pipe(Flag.optional, Flag.withDescription("Server host")),
	},
	config =>
		Effect.promise(() =>
			runMcpServer(config.transport, {
				port: Option.getOrUndefined(config.port),
				bank: Option.getOrUndefined(config.bank),
				host: Option.getOrUndefined(config.host),
			}),
		),
).pipe(Command.withShortDescription("Run MCP server"));

// ── Hidden help subcommand (backward compat: `mnemopi help`) ─────────────────

const helpCmd = Command.make("help", {}, () =>
	Effect.fail(new CliErr.ShowHelp({ commandPath: ["mnemopi"], errors: [] })),
).pipe(Command.withHidden);

// ── Root command ─────────────────────────────────────────────────────────────

export const mnemopiCommand = Command.make("mnemopi", {}, () =>
	Effect.fail(new CliErr.ShowHelp({ commandPath: ["mnemopi"], errors: [] })),
).pipe(
	Command.withDescription("Mnemopi - Local AI Memory System"),
	Command.withSubcommands([
		storeCmd,
		recallCmd,
		updateCmd,
		deleteCmd,
		exportCmd,
		importCmd,
		statsCmd,
		sleepCmd,
		scratchpadCmd,
		bankCmd,
		diagnoseCmd,
		mcpCmd,
		helpCmd,
	]),
);

// ── Effect CLI output capture ────────────────────────────────────────────────

interface CapturedOutput {
	readonly stdout: string[];
	readonly stderr: string[];
}

/**
 * A Console that buffers the Effect CLI's help/error rendering instead of writing
 * it immediately.  The runCli boundary then decides whether to replay the buffer
 * (genuine `--help` / `--version` / help screens) or discard it in favour of the
 * legacy message (unknown command), which keeps stdout/stderr byte-compatible.
 */
function makeCaptureConsole(sink: CapturedOutput): EffConsole.Console {
	const toStdout = (...args: Array<unknown>) => {
		sink.stdout.push(args.map(String).join(" "));
	};
	const toStderr = (...args: Array<unknown>) => {
		sink.stderr.push(args.map(String).join(" "));
	};
	return {
		assert: console.assert.bind(console),
		clear: console.clear.bind(console),
		count: console.count.bind(console),
		countReset: console.countReset.bind(console),
		debug: toStdout,
		dir: console.dir.bind(console),
		dirxml: console.dirxml.bind(console),
		error: toStderr,
		group: console.group.bind(console),
		groupCollapsed: console.groupCollapsed.bind(console),
		groupEnd: console.groupEnd.bind(console),
		info: toStdout,
		log: toStdout,
		table: console.table.bind(console),
		time: console.time.bind(console),
		timeEnd: console.timeEnd.bind(console),
		timeLog: console.timeLog.bind(console),
		trace: console.trace.bind(console),
		warn: toStderr,
	};
}

/** Extracts the offending name from an unknown-subcommand failure, if present. */
function unknownSubcommandName(error: unknown): string | undefined {
	if (!CliErr.isCliError(error)) return undefined;
	if (error._tag === "UnknownSubcommand") return error.subcommand;
	if (error._tag === "ShowHelp") {
		for (const inner of error.errors) {
			if (inner._tag === "UnknownSubcommand") return inner.subcommand;
		}
	}
	return undefined;
}

// ── Public runCli entry point ────────────────────────────────────────────────

export async function runCli(args: readonly string[] = Bun.argv.slice(2), context?: CliContext): Promise<number> {
	_activeCtx = context;
	const captured: CapturedOutput = { stdout: [], stderr: [] };
	const replay = (): void => {
		for (const line of captured.stdout) out(context, line);
		for (const line of captured.stderr) err(context, line);
	};
	try {
		const program = Command.runWith(mnemopiCommand, { version: "16.0.1" })(args).pipe(
			Effect.provideService(EffConsole.Console, makeCaptureConsole(captured)),
			Effect.provide(NodeServices.layer),
		);
		await Effect.runPromise(program);
		// Success covers real commands plus the built-in --help/--version actions;
		// replay any buffered help so those flags still print.
		replay();
		return 0;
	} catch (error: unknown) {
		if (error instanceof CliError) {
			if (error.message) err(context, error.message);
			return error.exitCode;
		}
		const unknownCommand = unknownSubcommandName(error);
		if (unknownCommand !== undefined) {
			err(context, `Unknown command: ${unknownCommand}`);
			err(context, "Run 'mnemopi --help' for usage.");
			return 2;
		}
		if (CliErr.isCliError(error) && error._tag === "ShowHelp") {
			// A bare help request (no parse errors) exits 0; a parse failure the
			// handlers did not own exits 2.  Either way the buffered help/errors are
			// the right thing to surface.
			replay();
			return error.errors.length === 0 ? 0 : 2;
		}
		throw error;
	} finally {
		_activeCtx = undefined;
	}
}

// ── Binary entry point ───────────────────────────────────────────────────────

if (import.meta.main) {
	const code = await runCli();
	process.exit(code);
}
