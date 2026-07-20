#!/usr/bin/env bun
/**
 * Edit benchmark CLI entry point.
 *
 * Usage:
 *   bun run bench:edit --model anthropic/claude-sonnet-4-5
 *   bun run bench:edit --tasks core-memory-recall,operations-division
 *   bun run bench:edit --runs 5 --output report.md
 *   bun run bench:edit --fixtures fixtures.tar.gz
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Effect, Option } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Command, Flag } from "effect/unstable/cli";
import { type ResolvedThinkingLevel, ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { Effort, THINKING_EFFORTS } from "@oh-my-pi/pi-ai";
import { padding, visibleWidth } from "@oh-my-pi/pi-tui";
import { postmortem, TempDir } from "@oh-my-pi/pi-utils";
import { generateJsonReport, generateReport } from "./report";
import {
	type BenchmarkConfig,
	type BenchmarkResult,
	buildBenchmarkResult,
	type ProgressEvent,
	percentile,
	runBenchmark,
} from "./runner";
import { type EditTask, loadTasksFromDir, validateFixturesFromDir } from "./tasks";

const COLOR_ENABLED = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
} as const;

const RUNS_DIR = path.resolve(import.meta.dir, "..", "..", "..", "runs");

fs.mkdirSync(RUNS_DIR, { recursive: true });

function paint(code: string, text: string): string {
	return COLOR_ENABLED ? `${code}${text}${ANSI.reset}` : text;
}

function rateColor(percent: number): string {
	if (percent >= 80) return ANSI.green;
	if (percent >= 50) return ANSI.yellow;
	return ANSI.red;
}

function parseThinkingLevel(value: string | null | undefined): ResolvedThinkingLevel | undefined {
	return value !== undefined &&
		value !== null &&
		[ThinkingLevel.Off, ...THINKING_EFFORTS].includes(value as ResolvedThinkingLevel)
		? (value as ResolvedThinkingLevel)
		: undefined;
}

function generateReportFilename(config: BenchmarkConfig, format: "markdown" | "json"): string {
	const modelName = config.model
		.split("/")
		.pop()!
		.replace(/[^a-zA-Z0-9-]/g, "_");
	const variant = config.editVariant ?? "replace";
	const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "").replace(/Z$/, "Z");
	const ext = format === "json" ? "json" : "md";
	return path.join(RUNS_DIR, `${modelName}_${variant}_${timestamp}.${ext}`);
}

async function resolveConversationDumpDir(outputPath: string): Promise<string> {
	const parsed = path.parse(outputPath);
	const preferredPath = path.join(parsed.dir, `${parsed.name}.dump`);
	try {
		await fs.promises.stat(preferredPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return preferredPath;
		}
		throw error;
	}
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return path.join(parsed.dir, `${parsed.name}.${timestamp}.dump`);
}

async function conversationDumpStatus(dumpDir: string): Promise<string> {
	try {
		const stat = await fs.promises.stat(dumpDir);
		if (stat.isDirectory()) {
			return `Conversation dumps written to: ${dumpDir}`;
		}
		return `Conversation dump path is not a directory: ${dumpDir}`;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return `No conversation dumps written: ${dumpDir}`;
		}
		throw error;
	}
}

async function resolveExtractedDir(tempDir: string): Promise<string> {
	const entries = await fs.promises.readdir(tempDir, { withFileTypes: true });
	const dirs = entries.filter(entry => entry.isDirectory());
	const files = entries.filter(entry => entry.isFile());
	if (dirs.length === 1 && files.length === 0) {
		return path.join(tempDir, dirs[0]!.name);
	}
	return tempDir;
}

async function extractTarGz(archivePath: string): Promise<{ dir: string; cleanupDir: string }> {
	const tempDirObj = await TempDir.create("@reach-benchmark-fixtures-");
	const tempDir = tempDirObj.path();
	try {
		const bytes = await Bun.file(archivePath).arrayBuffer();
		const archive = new Bun.Archive(bytes);
		const files = await archive.files();

		for (const [filePath, file] of files) {
			const destPath = path.join(tempDir, filePath);
			await Bun.write(destPath, file);
		}
	} catch (error) {
		await tempDirObj.remove();
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to extract archive: ${message}`, { cause: error });
	}

	return { dir: await resolveExtractedDir(tempDir), cleanupDir: tempDir };
}

async function resolveFixtures(fixturesArg?: string): Promise<{ tasks: EditTask[]; cleanup?: () => Promise<void> }> {
	fixturesArg ??= path.join(import.meta.dir, "../fixtures.tar.gz");

	if (fixturesArg.endsWith(".tar.gz") || fixturesArg.endsWith(".tgz")) {
		const extracted = await extractTarGz(fixturesArg);
		return {
			tasks: await loadTasksFromDir(extracted.dir),
			cleanup: () => fs.promises.rm(extracted.cleanupDir, { recursive: true, force: true }),
		};
	}

	return { tasks: await loadTasksFromDir(fixturesArg) };
}

// ---------------------------------------------------------------------------
// Effect CLI flag descriptors
// ---------------------------------------------------------------------------

const VALID_THINKING_LEVELS = [ThinkingLevel.Off, ...THINKING_EFFORTS] as [string, ...string[]];

const benchmarkCommand = Command.make(
	"typescript-edit-benchmark",
	{
		model: Flag.string("model").pipe(
			Flag.withDescription("Provider/model ID, e.g. anthropic/claude-sonnet-4-20250514"),
			Flag.withDefault("anthropic/claude-sonnet-4-20250514"),
		),
		provider: Flag.optional(
			Flag.string("provider").pipe(
				Flag.withDescription("Override provider (auto-detected from model prefix if omitted)"),
			),
		),
		thinking: Flag.choice("thinking", VALID_THINKING_LEVELS).pipe(
			Flag.withDescription("Thinking level: off, minimal, low, medium, high, xhigh"),
			Flag.withDefault("low" as string),
		),
		runs: Flag.integer("runs").pipe(
			Flag.withDescription("Runs per task"),
			Flag.withDefault(2),
		),
		timeout: Flag.integer("timeout").pipe(
			Flag.withDescription("Timeout per run in ms"),
			Flag.withDefault(120_000),
		),
		connectionTimeout: Flag.integer("connection-timeout").pipe(
			Flag.withDescription("Timeout for first event before fast-retry"),
			Flag.withDefault(30_000),
		),
		maxTurns: Flag.integer("max-turns").pipe(
			Flag.withDescription("Max turn_start events per attempt before failing"),
			Flag.withDefault(30),
		),
		taskConcurrency: Flag.integer("task-concurrency").pipe(
			Flag.withDescription("Max tasks to run in parallel"),
			Flag.withDefault(32),
		),
		tasks: Flag.optional(
			Flag.string("tasks").pipe(
				Flag.withDescription("Comma-separated task IDs to run (default: all)"),
			),
		),
		fixtures: Flag.optional(
			Flag.string("fixtures").pipe(
				Flag.withDescription("Fixtures directory or .tar.gz archive (default: built-in)"),
			),
		),
		output: Flag.optional(
			Flag.string("output").pipe(
				Flag.withDescription("Output file"),
			),
		),
		format: Flag.choice("format", ["markdown", "json"] as const).pipe(
			Flag.withDescription("Output format: markdown, json"),
			Flag.withDefault("markdown" as string),
		),
		checkFixtures: Flag.boolean("check-fixtures").pipe(
			Flag.withDescription("Validate fixtures and exit"),
			Flag.withDefault(false),
		),
		autoFormat: Flag.boolean("auto-format").pipe(
			Flag.withDescription("Auto-format output files after verify (debug only)"),
			Flag.withDefault(false),
		),
		guided: Flag.boolean("guided").pipe(
			Flag.withDescription("Include an authoritative suggested edit payload"),
			Flag.withDefault(false),
		),
		maxAttempts: Flag.integer("max-attempts").pipe(
			Flag.withDescription("Max prompt attempts per run (1-5)"),
			Flag.withDefault(1),
		),
		noOpRetryLimit: Flag.integer("no-op-retry-limit").pipe(
			Flag.withDescription("Stop after repeated preventable no-op failures"),
			Flag.withDefault(2),
		),
		maxTimeoutRetries: Flag.integer("max-timeout-retries").pipe(
			Flag.withDescription("Max timeout retries"),
			Flag.withDefault(3),
		),
		maxProviderRetries: Flag.integer("max-provider-retries").pipe(
			Flag.withDescription("Max provider failure retries"),
			Flag.withDefault(3),
		),
		mutationScopeWindow: Flag.integer("mutation-scope-window").pipe(
			Flag.withDescription("Allowed line-distance from mutation target for hashline refs"),
			Flag.withDefault(20),
		),
		requireEditToolCall: Flag.boolean("require-edit-tool-call").pipe(
			Flag.withDescription("Require edit tool usage for success"),
			Flag.withDefault(false),
		),
		requireReadToolCall: Flag.boolean("require-read-tool-call").pipe(
			Flag.withDescription("Require read tool usage for success"),
			Flag.withDefault(false),
		),
		noEditRequired: Flag.boolean("no-edit-required").pipe(
			Flag.withDescription("Remove 'must edit' prompt requirement"),
			Flag.withDefault(false),
		),
		editVariant: Flag.optional(
			Flag.string("edit-variant").pipe(
				Flag.withDescription("Edit variant: replace, patch, hashline, vim, atom, apply_patch, or auto"),
			),
		),
		editFuzzy: Flag.optional(
			Flag.string("edit-fuzzy").pipe(
				Flag.withDescription("Fuzzy matching: true, false, auto"),
			),
		),
		editFuzzyThreshold: Flag.optional(
			Flag.string("edit-fuzzy-threshold").pipe(
				Flag.withDescription("Fuzzy threshold 0-1 or auto"),
			),
		),
		inProcess: Flag.boolean("in-process").pipe(
			Flag.withDescription("Run benchmark in-process"),
			Flag.withDefault(true),
		),
		earlyStopOnMatch: Flag.boolean("early-stop-on-match").pipe(
			Flag.withDescription("Short-circuit the run when output matches expected"),
			Flag.withDefault(true),
		),
		maxTasks: Flag.integer("max-tasks").pipe(
			Flag.withDescription("Max tasks to sample (0 = all)"),
			Flag.withDefault(80),
		),
		list: Flag.boolean("list").pipe(
			Flag.withDescription("List available tasks and exit"),
			Flag.withDefault(false),
		),
	},
	(flags) =>
		Effect.gen(function* () {
			yield* Effect.promise(() => runBenchmarkCli(flags));
		}),
).pipe(
	Command.withDescription("Edit Benchmark - Evaluate patch application success rates"),
);

// ---------------------------------------------------------------------------
// CLI handler — mirrors the original main() with typed flag values
// ---------------------------------------------------------------------------

interface ParsedFlags {
	readonly model: string;
	readonly provider: Option.Option<string>;
	readonly thinking: string;
	readonly runs: number;
	readonly timeout: number;
	readonly connectionTimeout: number;
	readonly maxTurns: number;
	readonly taskConcurrency: number;
	readonly tasks: Option.Option<string>;
	readonly fixtures: Option.Option<string>;
	readonly output: Option.Option<string>;
	readonly format: string;
	readonly checkFixtures: boolean;
	readonly autoFormat: boolean;
	readonly guided: boolean;
	readonly maxAttempts: number;
	readonly noOpRetryLimit: number;
	readonly maxTimeoutRetries: number;
	readonly maxProviderRetries: number;
	readonly mutationScopeWindow: number;
	readonly requireEditToolCall: boolean;
	readonly requireReadToolCall: boolean;
	readonly noEditRequired: boolean;
	readonly editVariant: Option.Option<string>;
	readonly editFuzzy: Option.Option<string>;
	readonly editFuzzyThreshold: Option.Option<string>;
	readonly inProcess: boolean;
	readonly earlyStopOnMatch: boolean;
	readonly maxTasks: number;
	readonly list: boolean;
}

async function runBenchmarkCli(flags: ParsedFlags): Promise<void> {
	const model = flags.model;
	const slashIndex = model.indexOf("/");
	const provider = Option.getOrElse(flags.provider, () =>
		slashIndex !== -1 ? model.slice(0, slashIndex) : "anthropic",
	);

	const fixturesArg = Option.getOrUndefined(flags.fixtures);

	if (flags.checkFixtures && fixturesArg) {
		const issues = await validateFixturesFromDir(fixturesArg);
		if (issues.length === 0) {
			console.log("Fixtures OK");
			process.exit(0);
		}
		console.error("Fixture validation failed:");
		for (const issue of issues) {
			console.error(`  - ${issue.taskId}: ${issue.message}`);
		}
		process.exit(1);
	}

	const { tasks: allTasks, cleanup } = await resolveFixtures(fixturesArg);

	if (flags.list) {
		console.log("Available Tasks:\n");
		for (const task of allTasks) {
			console.log(`  ${task.id}`);
			console.log(`    Name: ${task.name}`);
			console.log(`    Files: ${task.files.join(", ")}`);
			console.log("");
		}
		process.exit(0);
	}

	let thinkingLevel: ResolvedThinkingLevel = Effort.Low;
	const level = parseThinkingLevel(flags.thinking);
	if (!level) {
		console.error(`Invalid thinking level: ${flags.thinking}`);
		console.error(`Valid levels: ${[ThinkingLevel.Off, ...THINKING_EFFORTS].join(", ")}`);
		process.exit(1);
	}
	thinkingLevel = level;

	const runsPerTask = flags.runs;
	if (runsPerTask < 1) {
		console.error(`Invalid runs value: ${runsPerTask}`);
		process.exit(1);
	}

	const timeout = flags.timeout;
	if (timeout < 1000) {
		console.error(`Invalid timeout value: ${timeout}`);
		process.exit(1);
	}

	const maxTurns = flags.maxTurns;
	if (maxTurns < 1) {
		console.error(`Invalid max-turns value: ${maxTurns}. Must be >= 1.`);
		process.exit(1);
	}

	const taskConcurrency = flags.taskConcurrency;
	if (taskConcurrency < 1) {
		console.error(`Invalid task concurrency value: ${taskConcurrency}`);
		process.exit(1);
	}

	const maxAttempts = flags.maxAttempts;
	if (maxAttempts < 1 || maxAttempts > 5) {
		console.error(`Invalid max-attempts value: ${maxAttempts}. Must be 1-5.`);
		process.exit(1);
	}

	const tasksFilter = Option.getOrUndefined(flags.tasks);
	let tasksToRun = allTasks;
	if (tasksFilter) {
		const taskIds = tasksFilter.split(",").map(s => s.trim());
		tasksToRun = [];
		for (const id of taskIds) {
			const task = allTasks.find(t => t.id === id);
			if (!task) {
				console.error(`Unknown task ID: ${id}`);
				console.error(`Available tasks: ${allTasks.map(t => t.id).join(", ")}`);
				process.exit(1);
			}
			tasksToRun.push(task);
		}
	}

	// Apply --max-tasks sampling (deterministic by sorting on id)
	const maxTasks = flags.maxTasks;
	if (maxTasks > 0 && tasksToRun.length > maxTasks && !tasksFilter) {
		// Evenly sample across mutation categories for representative coverage
		const sorted = tasksToRun.slice().sort((a, b) => a.id.localeCompare(b.id));
		const step = sorted.length / maxTasks;
		tasksToRun = Array.from({ length: maxTasks }, (_, i) => sorted[Math.floor(i * step)]!);
	}

	const rawEditVariant = Option.getOrUndefined(flags.editVariant);
	const editVariant = rawEditVariant === "" ? undefined : rawEditVariant;

	let editFuzzy: boolean | "auto" | undefined;
	const editFuzzyRaw = Option.getOrUndefined(flags.editFuzzy);
	if (editFuzzyRaw !== undefined) {
		if (editFuzzyRaw === "auto") {
			editFuzzy = "auto";
		} else if (editFuzzyRaw === "true" || editFuzzyRaw === "1") {
			editFuzzy = true;
		} else if (editFuzzyRaw === "false" || editFuzzyRaw === "0") {
			editFuzzy = false;
		} else {
			console.error(`Invalid edit-fuzzy: ${editFuzzyRaw}. Must be true, false, 1, 0, or auto.`);
			process.exit(1);
		}
	}

	let editFuzzyThreshold: number | "auto" | undefined;
	const editFuzzyThresholdRaw = Option.getOrUndefined(flags.editFuzzyThreshold);
	if (editFuzzyThresholdRaw !== undefined) {
		if (editFuzzyThresholdRaw === "auto") {
			editFuzzyThreshold = "auto";
		} else {
			const parsed = parseFloat(editFuzzyThresholdRaw);
			if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
				console.error(`Invalid edit-fuzzy-threshold: ${editFuzzyThresholdRaw}. Must be 0-1 or auto.`);
				process.exit(1);
			}
			editFuzzyThreshold = parsed;
		}
	}

	const formatType = flags.format === "json" ? "json" : "markdown";
	const config: BenchmarkConfig = {
		provider,
		model,
		thinkingLevel,
		runsPerTask,
		timeout,
		maxTurns,
		taskConcurrency,
		autoFormat: flags.autoFormat,
		guided: flags.guided,
		maxAttempts,
		requireEditToolCall: flags.requireEditToolCall,
		requireReadToolCall: flags.requireReadToolCall,
		noEditRequired: flags.noEditRequired,
		editVariant,
		editFuzzy,
		editFuzzyThreshold,
		noOpRetryLimit: flags.noOpRetryLimit,
		maxTimeoutRetries: flags.maxTimeoutRetries,
		maxProviderFailureRetries: flags.maxProviderRetries,
		mutationScopeWindow: flags.mutationScopeWindow,
		connectionTimeout: flags.connectionTimeout,
		inProcess: flags.inProcess,
		earlyStopOnMatch: flags.earlyStopOnMatch,
	};
	const outputPath = Option.getOrElse(flags.output, () => generateReportFilename(config, formatType));
	config.conversationDumpDir = await resolveConversationDumpDir(outputPath);

	console.log("Edit Benchmark");
	console.log("==============");
	console.log(`Provider: ${config.provider}`);
	console.log(`Model: ${config.model}`);
	if (config.thinkingLevel) {
		console.log(`Thinking: ${config.thinkingLevel}`);
	}
	console.log(`Runs per task: ${config.runsPerTask}`);
	console.log(`Timeout: ${config.timeout}ms`);
	console.log(`Task concurrency: ${config.taskConcurrency}`);
	if (config.autoFormat) {
		console.log("Auto-format: enabled");
	}
	console.log(`Guided mode: ${config.guided ? "enabled" : "disabled"}`);
	console.log(`Max attempts: ${config.maxAttempts}`);
	if (config.maxTurns !== undefined) {
		console.log(`Max turns per attempt: ${config.maxTurns}`);
	}
	if (config.requireEditToolCall) {
		console.log("Require edit tool call: yes");
	}
	if (config.requireReadToolCall) {
		console.log("Require read tool call: yes");
	}
	if (config.noEditRequired) {
		console.log("No-edit-required baseline: yes");
	}
	if (config.editVariant) {
		console.log(`Edit variant: ${config.editVariant}`);
	}
	if (config.editFuzzy !== undefined) {
		console.log(`Edit fuzzy: ${config.editFuzzy}`);
	}
	if (config.editFuzzyThreshold !== undefined) {
		console.log(`Edit fuzzy threshold: ${config.editFuzzyThreshold}`);
	}
	console.log(`Tasks: ${tasksToRun.length}`);
	console.log(`Conversation dumps: ${config.conversationDumpDir}`);
	console.log("");

	const progress = new LiveProgress(tasksToRun.length * config.runsPerTask, config.runsPerTask);
	let latestResult = buildBenchmarkResult({
		tasks: tasksToRun,
		config,
		resultsByTask: new Map(),
		startTime: new Date().toISOString(),
	});
	let progressFinished = false;
	let reportWritePromise: Promise<void> | undefined;
	const finishProgress = () => {
		if (progressFinished) return;
		progress.finish();
		progressFinished = true;
	};
	const writeReport = async (result: BenchmarkResult, interrupted: boolean) => {
		if (reportWritePromise) return reportWritePromise;
		reportWritePromise = (async () => {
			if (interrupted) {
				console.log("");
				console.log("Benchmark interrupted; writing partial report...");
			}
			const report = formatType === "json" ? generateJsonReport(result) : generateReport(result);
			await Bun.write(outputPath, report);
			console.log(`Report written to: ${outputPath}`);
			if (config.conversationDumpDir) {
				console.log(await conversationDumpStatus(config.conversationDumpDir));
			}
		})();
		return reportWritePromise;
	};
	const unregisterReportCleanup = postmortem.register("typescript-edit-benchmark-report", async reason => {
		if (reason === postmortem.Reason.EXIT) return;
		finishProgress();
		await writeReport(latestResult, true);
		if (cleanup) {
			await cleanup();
		}
	});
	const result = await runBenchmark(
		tasksToRun,
		config,
		event => {
			progress.handleEvent(event);
		},
		snapshot => {
			latestResult = snapshot;
		},
	);
	latestResult = result;
	finishProgress();

	console.log("");
	console.log("Benchmark complete!");
	console.log(
		`  Task success rate (best of ${config.runsPerTask}): ${(result.summary.taskSuccessRate * 100).toFixed(1)}% (${result.summary.successfulTasks}/${result.summary.totalTasks})`,
	);
	console.log(
		`  Total tokens (best): ${result.summary.totalTokens.input} in / ${result.summary.totalTokens.output} out`,
	);
	console.log(
		`  Tokens/task (best total): mean=${result.summary.avgTokensPerTask.total} median=${result.summary.medianTokensPerTask.total} p1=${result.summary.p1TokensPerTask.total} p99=${result.summary.p99TokensPerTask.total}`,
	);
	if (result.summary.ghostRuns > 0) {
		console.log(`  Ghost runs (0/0/0): ${result.summary.ghostRuns}`);
	}
	if (result.summary.timeoutRuns > 0) {
		console.log(`  Timeout runs: ${result.summary.timeoutRuns}`);
	}
	console.log("");

	await writeReport(result, false);
	unregisterReportCleanup();

	if (cleanup) {
		await cleanup();
	}

	// In-process benchmark runs can leave provider keep-alive sockets and
	// background AgentSession timers alive after the report is written. Treat the
	// final report as the CLI boundary so the command returns to the shell.
	await postmortem.quit(0);
}

// ---------------------------------------------------------------------------
// LiveProgress — unchanged
// ---------------------------------------------------------------------------

class LiveProgress {
	readonly #totalRuns: number;
	readonly #runsPerTask: number;
	readonly #isTty: boolean;
	#started = 0;
	#completed = 0;
	#success = 0;
	#totalInput = 0;
	#totalOutput = 0;
	#totalDuration = 0;
	#totalReads = 0;
	#totalEdits = 0;
	#totalWrites = 0;
	#totalEditSuccesses = 0;
	#totalToolInputChars = 0;
	#indentScores: number[] = [];
	#inputTokens: number[] = [];
	#outputTokens: number[] = [];
	#totalTokens: number[] = [];
	#lastLineLength = 0;

	constructor(totalRuns: number, runsPerTask: number) {
		this.#totalRuns = totalRuns;
		this.#runsPerTask = runsPerTask;
		this.#isTty = Boolean(process.stdout.isTTY);
	}

	handleEvent(event: ProgressEvent): void {
		if (event.status === "started") {
			this.#started += 1;
			if (!this.#isTty) {
				console.log(`  [${event.taskId}] Run ${event.runIndex + 1}/${this.#runsPerTask} started...`);
			}
			this.#renderLine();
			return;
		}

		this.#completed += 1;
		if (event.result) {
			if (event.result.success) {
				this.#success += 1;
			}
			this.#totalInput += event.result.tokens.input;
			this.#totalOutput += event.result.tokens.output;
			this.#inputTokens.push(event.result.tokens.input);
			this.#outputTokens.push(event.result.tokens.output);
			this.#totalTokens.push(event.result.tokens.total);
			this.#totalDuration += event.result.duration;
			this.#totalReads += event.result.toolCalls.read;
			this.#totalEdits += event.result.toolCalls.edit;
			this.#totalWrites += event.result.toolCalls.write;
			this.#totalEditSuccesses += event.result.toolCalls.editSuccesses;
			this.#totalToolInputChars += event.result.toolCalls.totalInputChars;
			if (typeof event.result.indentScore === "number") {
				this.#indentScores.push(event.result.indentScore);
			}
		}

		const result = event.result;
		if (result && !result.success && result.error) {
			this.#flushLine();
			const header = paint(ANSI.red, `[${event.taskId}] Run ${event.runIndex + 1}/${this.#runsPerTask} failed:`);
			console.log(`  ${header} ${result.error}`);
			if (result.diff) {
				const changeLines = result.diff
					.split("\n")
					.filter(line => /^[-+@]/.test(line) && !/^(---|\+\+\+)/.test(line));
				const maxLines = 40;
				const shown = changeLines.slice(0, maxLines);
				for (const line of shown) {
					let color: string | undefined;
					if (line.startsWith("@@")) color = ANSI.cyan;
					else if (line.startsWith("-")) color = ANSI.red;
					else if (line.startsWith("+")) color = ANSI.green;
					console.log(`    ${color ? paint(color, line) : line}`);
				}
				if (changeLines.length > maxLines) {
					console.log(paint(ANSI.dim, `    ... (${changeLines.length - maxLines} more change lines)`));
				}
			}
		}

		if (result?.editFailures && result.editFailures.length > 0) {
			this.#flushLine();
			for (const [i, failure] of result.editFailures.entries()) {
				const args = (failure.args ?? {}) as Record<string, unknown>;
				const target =
					typeof args.path === "string" ? args.path : typeof args.file === "string" ? args.file : undefined;
				const op = typeof args.operation === "string" ? args.operation : undefined;
				const oneLine = failure.error.replace(/\s+/g, " ").trim();
				const clipped = oneLine.length > 240 ? `${oneLine.slice(0, 237)}...` : oneLine;
				const tag = paint(ANSI.yellow, `[${event.taskId}] schema #${i + 1}`);
				const metaParts = [op, target].filter((v): v is string => Boolean(v));
				const meta = metaParts.length > 0 ? paint(ANSI.dim, metaParts.join(" ")) : "";
				console.log(`  ${tag}${meta ? ` ${meta}` : ""} ${clipped}`);
				if (failure.rawBlock) {
					const rawLine = failure.rawBlock.replace(/\s+/g, " ").trim();
					const clippedRaw = rawLine.length > 240 ? `${rawLine.slice(0, 237)}...` : rawLine;
					console.log(`    ${paint(ANSI.dim, "raw")} ${clippedRaw}`);
				}
			}
		}

		if (!this.#isTty) {
			const status = event.result?.success ? "completed" : "failed";
			console.log(`  [${event.taskId}] Run ${event.runIndex + 1}/${this.#runsPerTask} ${status}`);
		}

		this.#renderLine();
	}

	finish(): void {
		this.#flushLine();
		this.#printSummary();
	}

	#printSummary(): void {
		const n = this.#completed;
		const denom = n || 1;

		const successRate = (this.#success / denom) * 100;
		const editSuccessRate = this.#totalEdits > 0 ? (this.#totalEditSuccesses / this.#totalEdits) * 100 : 100;
		const avgIndent =
			this.#indentScores.length > 0 ? this.#indentScores.reduce((a, b) => a + b, 0) / this.#indentScores.length : 0;

		console.log("");
		console.log(paint(ANSI.bold, "Runtime Stats:"));
		console.log(
			`  Task success:     ${paint(rateColor(successRate), `${successRate.toFixed(1)}% (${this.#success}/${n})`)}`,
		);
		console.log(
			`  Edit success:     ${paint(rateColor(editSuccessRate), `${editSuccessRate.toFixed(1)}% (${this.#totalEditSuccesses}/${this.#totalEdits})`)}`,
		);
		console.log(`  Avg indent score: ${avgIndent.toFixed(2)}`);
		console.log(`  Tool calls:       read=${this.#totalReads} edit=${this.#totalEdits} write=${this.#totalWrites}`);
		console.log(`  Tool input chars: ${this.#totalToolInputChars.toLocaleString()}`);
		const fmtTokens = (samples: number[]): string => {
			if (samples.length === 0) return "mean=0 median=0 p1=0 p99=0";
			const sorted = [...samples].sort((a, b) => a - b);
			const mean = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
			return `mean=${mean} median=${Math.round(percentile(sorted, 50))} p1=${Math.round(percentile(sorted, 1))} p99=${Math.round(percentile(sorted, 99))}`;
		};
		console.log(`  Tokens/task in:   ${fmtTokens(this.#inputTokens)}`);
		console.log(`  Tokens/task out:  ${fmtTokens(this.#outputTokens)}`);
		console.log(`  Tokens/task tot:  ${fmtTokens(this.#totalTokens)}`);
		console.log(`  Avg time/task:    ${Math.round(this.#totalDuration / denom)}ms`);
	}

	#renderLine(): void {
		if (!this.#isTty) {
			return;
		}
		const successRate = this.#completed > 0 ? (this.#success / this.#completed) * 100 : 0;
		const editRate = this.#totalEdits > 0 ? (this.#totalEditSuccesses / this.#totalEdits) * 100 : 100;
		const avgInput = this.#completed > 0 ? Math.round(this.#totalInput / this.#completed) : 0;
		const avgOutput = this.#completed > 0 ? Math.round(this.#totalOutput / this.#completed) : 0;
		const avgDuration = this.#completed > 0 ? Math.round(this.#totalDuration / this.#completed) : 0;
		const inFlight = this.#started - this.#completed;
		const bar = this.#renderBar(this.#completed, this.#totalRuns, 20);
		const progress = paint(ANSI.bold, `${this.#completed}/${this.#totalRuns}`);
		const taskCol = `task=${paint(rateColor(successRate), `${successRate.toFixed(0)}%`)}`;
		const editCol = `edit=${paint(rateColor(editRate), `${editRate.toFixed(0)}%`)}`;
		const tokCol = paint(ANSI.dim, `tok=${avgInput}/${avgOutput}`);
		const durCol = paint(ANSI.dim, `${avgDuration}ms`);
		const rewCol = paint(ANSI.dim, `r/e/w=${this.#totalReads}/${this.#totalEdits}/${this.#totalWrites}`);
		const flyCol = `fly=${paint(ANSI.cyan, String(inFlight))}`;
		const line = `  ${bar} ${progress} ${taskCol} ${editCol} ${tokCol} ${durCol} ${rewCol} ${flyCol}`;
		this.#writeLine(line);
	}

	#renderBar(done: number, total: number, width: number): string {
		const ratio = total === 0 ? 0 : done / total;
		const filled = Math.round(ratio * width);
		const empty = Math.max(0, width - filled);
		const filledPart = paint(ANSI.green, "#".repeat(filled));
		const emptyPart = paint(ANSI.dim, "-".repeat(empty));
		return `[${filledPart}${emptyPart}]`;
	}

	#writeLine(line: string): void {
		const lineWidth = visibleWidth(line);
		const pad = this.#lastLineLength > lineWidth ? padding(this.#lastLineLength - lineWidth) : "";
		process.stdout.write(`\r${line}${pad}`);
		this.#lastLineLength = lineWidth;
	}

	#flushLine(): void {
		if (!this.#isTty) {
			return;
		}
		if (this.#lastLineLength > 0) {
			process.stdout.write(`\r${padding(this.#lastLineLength)}\r`);
			this.#lastLineLength = 0;
		}
	}
}

// ---------------------------------------------------------------------------
// Entry point — single Effect.runPromise boundary
// ---------------------------------------------------------------------------

Effect.runPromise(
	Command.run(benchmarkCommand, { version: "0.0.1" }).pipe(
		Effect.provide(NodeServices.layer),
	),
).catch(async (err) => {
	console.error("Benchmark failed:", err);
	await postmortem.quit(1);
});
