#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

type AstGrepFinding = {
	file: string;
	text: string;
	lines: string;
	ruleId: string;
	message: string;
	range: {
		start: {
			line: number;
			column: number;
		};
	};
};

type BaselineEntry = {
	ruleId: string;
	file: string;
	text: string;
	source: string;
	count: number;
};

type CurrentEntry = BaselineEntry & {
	lineNumber: number;
	column: number;
	message: string;
};

type BaselineFile = {
	version: 1;
	description: string;
	matches: BaselineEntry[];
};

const baselinePath = "tools/ast-grep/unsafe-types-baseline.json";
const args = new Set(process.argv.slice(2));
const update = args.has("--update");
const strict = args.has("--strict");
const scanWorktree = args.has("--worktree") || args.has("--all");
const excludedTrackedPrefixes = ["browser-extensions/", "kimi-code-usage/", "oh-my-pi/", "vendor/"];
const trackedSourceFiles = scanWorktree ? null : gitTrackedSourceFiles();
const scanArgs = [
	"scan",
	"--config",
	"sgconfig.yml",
	"--filter",
	"^no-unsafe-any",
	"--json=stream",
];
if (trackedSourceFiles && trackedSourceFiles.length === 0) {
	console.log("Unsafe type lint skipped: no git-tracked TypeScript/Python files.");
	process.exit(0);
}
if (trackedSourceFiles) scanArgs.push(...trackedSourceFiles);

const scan = runAstGrep(scanArgs);

if (scan.error) {
	console.error("Failed to run ast-grep. Install Bun or add @ast-grep/cli to this workspace.");
	console.error(scan.error.message);
	process.exit(127);
}

const findings = parseFindings(scan.stdout);

if (scan.status !== 0 && findings.length === 0) {
	console.error(scan.stderr.trim() || "ast-grep failed before producing JSON output.");
	process.exit(scan.status ?? 1);
}

const current = summarize(findings);

if (strict) {
	if (findings.length > 0) {
		console.error(`Unsafe type lint failed: ${findings.length} finding(s).`);
		printEntries(current, current.length);
		process.exit(1);
	}
	console.log("Unsafe type lint passed with zero findings.");
	process.exit(0);
}

if (update) {
	const baseline: BaselineFile = {
		version: 1,
		description:
			"Ratcheted baseline for explicit any/unknown/Any findings. Run `bun run lint:unsafe-types:update-baseline` after intentional cleanup.",
		matches: current.map(({ lineNumber: _lineNumber, column: _column, message: _message, ...entry }) =>
			entry,
		),
	};
	writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
	console.log(
		`Wrote ${baselinePath} with ${baseline.matches.length} grouped match(es), ${findings.length} raw finding(s).`,
	);
	process.exit(0);
}

if (!existsSync(baselinePath)) {
	console.error(`Missing ${baselinePath}.`);
	console.error("Run `bun run lint:unsafe-types:update-baseline` once, then commit the baseline.");
	if (current.length > 0) printEntries(current, Math.min(current.length, 25));
	process.exit(1);
}

const baseline = readBaseline(baselinePath);
const diff = diffEntries(baseline.matches, current);

if (diff.added.length === 0 && diff.removed.length === 0) {
	console.log(
		`Unsafe type lint passed: ${findings.length} known finding(s), no new any/unknown/Any usage.`,
	);
	process.exit(0);
}

if (diff.added.length > 0) {
	console.error(`Unsafe type lint failed: ${diff.addedCount} new finding(s).`);
	console.error(
		"Use a concrete type, move raw IO to a typed boundary, or decode with a schema before returning.",
	);
	printEntries(diff.added, Math.min(diff.added.length, 25));
}

if (diff.removed.length > 0) {
	console.error(
		`Baseline is stale: ${diff.removedCount} known finding(s) disappeared. Run ` +
			"`bun run lint:unsafe-types:update-baseline` to ratchet it down.",
	);
	if (diff.added.length === 0) printEntries(diff.removed, Math.min(diff.removed.length, 25));
}

process.exit(1);

function runAstGrep(args: string[]): ReturnType<typeof spawnSync> {
	const direct = spawnSync("ast-grep", args, {
		cwd: process.cwd(),
		encoding: "utf8",
		maxBuffer: 128 * 1024 * 1024,
	});
	if (!isMissingCommand(direct.error)) return direct;

	const viaBunx = spawnSync("bunx", ["--bun", "@ast-grep/cli@0.42.2", ...args], {
		cwd: process.cwd(),
		encoding: "utf8",
		maxBuffer: 128 * 1024 * 1024,
	});
	if (!isMissingCommand(viaBunx.error)) return viaBunx;

	return spawnSync("bun", ["x", "--bun", "@ast-grep/cli@0.42.2", ...args], {
		cwd: process.cwd(),
		encoding: "utf8",
		maxBuffer: 128 * 1024 * 1024,
	});
}

function isMissingCommand(error: (Error & { code?: string }) | undefined): boolean {
	return error?.code === "ENOENT";
}

function gitTrackedSourceFiles(): string[] | null {
	const git = spawnSync("git", ["ls-files", "--", "*.ts", "*.tsx", "*.py"], {
		cwd: process.cwd(),
		encoding: "utf8",
	});
	if (git.status !== 0) return null;
	return git.stdout
		.split("\n")
		.map((file) => file.trim())
		.filter((file) => file.length > 0 && !excludedTrackedPrefixes.some((prefix) => file.startsWith(prefix)));
}

function parseFindings(stdout: string): AstGrepFinding[] {
	const findings: AstGrepFinding[] = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || !trimmed.startsWith("{")) continue;
		const parsed = JSON.parse(trimmed) as unknown;
		const finding = asAstGrepFinding(parsed);
		if (finding) findings.push(finding);
	}
	return findings;
}

function summarize(findings: AstGrepFinding[]): CurrentEntry[] {
	const byKey = new Map<string, CurrentEntry>();
	for (const finding of findings) {
		const entry: CurrentEntry = {
			ruleId: finding.ruleId,
			file: normalizePath(finding.file),
			text: finding.text,
			source: normalizeSource(finding.lines),
			count: 1,
			lineNumber: finding.range.start.line + 1,
			column: finding.range.start.column + 1,
			message: finding.message,
		};
		const key = entryKey(entry);
		const existing = byKey.get(key);
		if (existing) {
			existing.count += 1;
			existing.lineNumber = Math.min(existing.lineNumber, entry.lineNumber);
			existing.column = Math.min(existing.column, entry.column);
		} else {
			byKey.set(key, entry);
		}
	}
	return [...byKey.values()].sort(compareEntries);
}

function diffEntries(baseline: BaselineEntry[], current: CurrentEntry[]) {
	const currentByKey = countByKey(current);
	const baselineByKey = countByKey(baseline);
	const currentExample = new Map(current.map((entry) => [entryKey(entry), entry]));
	const baselineExample = new Map(baseline.map((entry) => [entryKey(entry), entry]));
	const added: CurrentEntry[] = [];
	const removed: CurrentEntry[] = [];
	let addedCount = 0;
	let removedCount = 0;

	for (const [key, count] of currentByKey) {
		const delta = count - (baselineByKey.get(key) ?? 0);
		if (delta <= 0) continue;
		const example = currentExample.get(key);
		if (!example) continue;
		added.push({ ...example, count: delta });
		addedCount += delta;
	}

	for (const [key, count] of baselineByKey) {
		const delta = count - (currentByKey.get(key) ?? 0);
		if (delta <= 0) continue;
		const example = baselineExample.get(key);
		if (!example) continue;
		removed.push({ ...example, count: delta, lineNumber: 0, column: 0, message: "baseline entry" });
		removedCount += delta;
	}

	return {
		added: added.sort(compareEntries),
		removed: removed.sort(compareEntries),
		addedCount,
		removedCount,
	};
}

function countByKey(entries: BaselineEntry[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const entry of entries) counts.set(entryKey(entry), (counts.get(entryKey(entry)) ?? 0) + entry.count);
	return counts;
}

function readBaseline(path: string): BaselineFile {
	const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.matches)) {
		throw new Error(`${path} is not a version 1 unsafe-types baseline.`);
	}
	return parsed as BaselineFile;
}

function printEntries(entries: CurrentEntry[], limit: number): void {
	for (const entry of entries.slice(0, limit)) {
		const location = entry.lineNumber > 0 ? `${entry.file}:${entry.lineNumber}:${entry.column}` : entry.file;
		const count = entry.count > 1 ? ` x${entry.count}` : "";
		console.error(`- ${location} ${entry.ruleId} ${JSON.stringify(entry.text)}${count}`);
		console.error(`  ${entry.source}`);
	}
	if (entries.length > limit) console.error(`...and ${entries.length - limit} more grouped finding(s).`);
}

function entryKey(entry: BaselineEntry): string {
	return JSON.stringify([entry.ruleId, entry.file, entry.text, entry.source]);
}

function compareEntries(a: BaselineEntry, b: BaselineEntry): number {
	return (
		a.file.localeCompare(b.file) ||
		a.source.localeCompare(b.source) ||
		a.ruleId.localeCompare(b.ruleId) ||
		a.text.localeCompare(b.text)
	);
}

function normalizePath(file: string): string {
	const normalized = isAbsolute(file) ? relative(process.cwd(), file) : file;
	return normalized.split("\\").join("/");
}

function normalizeSource(source: string): string {
	return source.trim().replace(/\s+/g, " ");
}

function asAstGrepFinding(value: unknown): AstGrepFinding | null {
	if (!isRecord(value)) return null;
	if (
		typeof value.file !== "string" ||
		typeof value.text !== "string" ||
		typeof value.lines !== "string" ||
		typeof value.ruleId !== "string" ||
		typeof value.message !== "string" ||
		!isRecord(value.range) ||
		!isRecord(value.range.start) ||
		typeof value.range.start.line !== "number" ||
		typeof value.range.start.column !== "number"
	) {
		return null;
	}
	return value as AstGrepFinding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
