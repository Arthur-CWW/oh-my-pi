#!/usr/bin/env bun
/**
 * Ratchets tracked TypeScript source file sizes. Check with `bun run lint:file-size`;
 * intentionally refresh limits with `bun run lint:file-size:update-baseline`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const baselinePath = "tools/guardrails/file-size-baseline.json";
const hardLimit = 800;
const update = process.argv.slice(2).includes("--update-baseline");

type Baseline = { version: 1; description: string; limits: Record<string, number> };

const git = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.ts", "*.tsx"], { encoding: "utf8" });
if (git.status !== 0) {
	console.error("File-size ratchet failed: git ls-files could not enumerate repository sources.");
	process.exit(1);
}

const files = git.stdout.split("\n").filter(file => isSourceFile(file) && existsSync(file));
const counts = new Map(files.map(file => [file, lineCount(readFileSync(file, "utf8"))]));

if (update) {
	const limits = Object.fromEntries([...counts].filter(([, lines]) => lines > hardLimit).sort(([a], [b]) => a.localeCompare(b)));
	const baseline: Baseline = {
		version: 1,
		description: "Frozen line counts for tracked TypeScript source files already above 800 lines; entries may shrink but never grow.",
		limits,
	};
	writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
	console.log(`Wrote ${baselinePath} with ${Object.keys(limits).length} frozen oversized source file(s).`);
	process.exit(0);
}

if (!existsSync(baselinePath)) {
	console.error(`File-size ratchet failed: missing ${baselinePath}. Run bun run lint:file-size:update-baseline.`);
	process.exit(1);
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
const violations: string[] = [];
for (const [file, lines] of counts) {
	const limit = baseline.limits[file] ?? hardLimit;
	if (lines > limit) violations.push(`${file}: ${lines} lines (limit ${limit})`);
}
if (violations.length) {
	console.error(`File-size ratchet failed: ${violations.length} source file(s) exceed their limit.`);
	for (const violation of violations) console.error(`  ${violation}`);
	console.error("Fix: split the file along an existing module boundary or shrink it below its named limit; refresh the baseline only after intentional cleanup.");
	process.exit(1);
}
console.log(`File-size ratchet passed: ${files.length} tracked source file(s), ${Object.keys(baseline.limits).length} frozen oversized file(s).`);

function isSourceFile(file: string): boolean {
	if (!file || (!file.endsWith(".ts") && !file.endsWith(".tsx"))) return false;
	if (file.startsWith("vendor/") && !file.startsWith("vendor/oh-my-pi/packages/coding-agent/src/") && !file.startsWith("vendor/oh-my-pi/packages/tui/src/")) return false;
	if (file.includes("/node_modules/") || file.startsWith("node_modules/")) return false;
	if (/(^|\/)(generated|fixtures?|__fixtures__)(\/|$)/i.test(file)) return false;
	if (/(\.test|\.spec|\.fixture)\.(ts|tsx)$/.test(file) || /(^|\/)(test|tests|__tests__)(\/|$)/.test(file)) return false;
	return file.includes("/src/") || file.startsWith("src/") || file.startsWith("scripts/");
}

function lineCount(text: string): number {
	if (text.length === 0) return 0;
	return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}
