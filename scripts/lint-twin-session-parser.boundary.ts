#!/usr/bin/env bun
/**
 * Prevents duplicate session-JSONL decoders. Check with `bun run lint:twin-session-parser`;
 * intentionally refresh known offenders with `bun run lint:twin-session-parser:update-baseline`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const sourceRoot = "vendor/oh-my-pi/packages/coding-agent/src/";
const baselinePath = "tools/guardrails/twin-session-parser-allowlist.json";
const update = process.argv.slice(2).includes("--update-baseline");
type Finding = { file: string; source: string; line: number };
type BaselineFinding = Omit<Finding, "line">;
type AstFinding = { file: string; text: string; range: { start: { line: number } } };
type Baseline = { version: 1; description: string; findings: BaselineFinding[] };

const tracked = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", `${sourceRoot}*.ts`], { encoding: "utf8" });
if (tracked.status !== 0) {
	console.error("Twin-parser ban failed: git could not enumerate coding-agent worktree sources.");
	process.exit(1);
}
const files = tracked.stdout.split("\n").filter(file => file && !isApprovedLocation(file));
const scan = runAstGrep(files);
if (scan.error || (scan.status !== 0 && !scan.stdout.trim().startsWith("{"))) {
	console.error("Twin-parser ban failed: ast-grep could not scan coding-agent sources.");
	console.error(scan.error?.message ?? scan.stderr.trim());
	process.exit(1);
}
const findings = scan.stdout.split("\n").flatMap(line => {
	if (!line.startsWith("{")) return [];
	const match = JSON.parse(line) as AstFinding;
	const source = readFileSync(match.file, "utf8");
	if (!looksLikeSessionEntryDecoder(source)) return [];
	return [{
		file: match.file,
		source: match.text.replace(/\s+/g, " ").trim(),
		line: match.range.start.line + 1,
	} satisfies Finding];
}).sort((a, b) => a.file.localeCompare(b.file) || a.source.localeCompare(b.source) || a.line - b.line);

if (update) {
	const baseline: Baseline = {
		version: 1,
		description: "Exact known session-entry JSON.parse sites outside journal/ and session/session-entries.ts. New twin parsers are forbidden.",
		findings: findings.map(({ line: _line, ...finding }) => finding),
	};
	writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
	console.log(`Wrote ${baselinePath} with ${baseline.findings.length} known parser site(s).`);
	process.exit(0);
}
if (!existsSync(baselinePath)) {
	console.error(`Twin-parser ban failed: missing ${baselinePath}. Run bun run lint:twin-session-parser:update-baseline.`);
	process.exit(1);
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
const remaining = [...baseline.findings];
const violations: Finding[] = [];
for (const finding of findings) {
	const index = remaining.findIndex(known => known.file === finding.file && known.source === finding.source);
	if (index === -1) violations.push(finding);
	else remaining.splice(index, 1);
}
if (violations.length) {
	console.error(`Twin-parser ban failed: ${violations.length} new session-entry JSON.parse site(s) (limit: exact baseline only outside src/journal/ and src/session/session-entries.ts).`);
	for (const finding of violations) console.error(`  ${finding.file}:${finding.line}: ${finding.source}`);
	console.error("Fix: move session JSONL decoding into src/journal/ or reuse the canonical parser exported by src/session/session-entries.ts; do not decode SessionMessageEntry lines locally.");
	process.exit(1);
}
if (remaining.length) {
	console.error(`Twin-parser allowlist is stale: ${remaining.length} known parser site(s) disappeared. Run bun run lint:twin-session-parser:update-baseline to ratchet it down.`);
	process.exit(1);
}
console.log(`Twin-parser ban passed: ${findings.length} exact known parser site(s), no new twin parser.`);

function isApprovedLocation(file: string): boolean {
	return file.startsWith(`${sourceRoot}journal/`) || file === `${sourceRoot}session/session-entries.ts`;
}
function looksLikeSessionEntryDecoder(source: string): boolean {
	return /SessionMessageEntry|SessionEntry/.test(source) && /session(?:\.jsonl|File|Entry| transcript)/i.test(source);
}
function runAstGrep(files: string[]) {
	const args = ["run", "--pattern", "JSON.parse($ARG)", "--lang", "typescript", "--json=stream", ...files];
	const direct = spawnSync("ast-grep", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
	if (direct.error && (direct.error as NodeJS.ErrnoException).code === "ENOENT") {
		return spawnSync("bunx", ["--bun", "@ast-grep/cli@0.42.2", ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
	}
	return direct;
}
