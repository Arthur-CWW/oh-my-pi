#!/usr/bin/env bun
/**
 * Rejects unapproved repository-root litter. Check with `bun run lint:root-litter`;
 * intentionally refresh placement approvals with `bun run lint:root-litter:update-baseline`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const baselinePath = "tools/guardrails/root-entry-allowlist.json";
const doctrinePath = "docs/fable/agent-system-overview.md#artifact-placement-doctrine";
const update = process.argv.slice(2).includes("--update-baseline");
type Baseline = { version: 1; description: string; entries: string[] };

if (update) {
	const tracked = gitLines(["ls-files"]);
	const untracked = gitLines(["ls-files", "--others", "--exclude-standard"]);
	const present = readdirSync(".").filter(name => name !== ".git");
	const entries = [...new Set([...tracked, ...untracked].map(rootEntry).filter(Boolean).concat(present))].sort();
	const baseline: Baseline = {
		version: 1,
		description: "Repository-root entries present when the root-litter ratchet was seeded. New non-ignored entries require correct placement, not casual allowlisting.",
		entries,
	};
	writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
	console.log(`Wrote ${baselinePath} with ${entries.length} permitted root entries.`);
	process.exit(0);
}

if (!existsSync(baselinePath)) {
	console.error(`Root-litter check failed: missing ${baselinePath}. Run bun run lint:root-litter:update-baseline.`);
	process.exit(1);
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
const allowed = new Set([".git", ...baseline.entries]);
const violations = readdirSync(".", { withFileTypes: true })
	.map(entry => entry.name)
	.filter(name => !allowed.has(name) && !isIgnored(name))
	.sort();
if (violations.length) {
	console.error(`Root-litter check failed: ${violations.length} unapproved root entry/entries (limit: allowlist only).`);
	for (const file of violations) console.error(`  ${file}`);
	console.error(`Fix: place handoffs in docs/fable/handoffs/, durable architecture/analysis in docs/fable/ (or stream docs), and proof artifacts in local/proofs/<feature>/ per ${doctrinePath}; then remove the root entry.`);
	process.exit(1);
}
console.log(`Root-litter check passed: ${baseline.entries.length} permitted root entries; no new non-ignored litter.`);

function gitLines(args: string[]): string[] {
	const result = spawnSync("git", args, { encoding: "utf8" });
	if (result.status !== 0) {
		console.error(`Root-litter check failed: git ${args.join(" ")} could not enumerate the worktree.`);
		process.exit(1);
	}
	return result.stdout.split("\n").filter(Boolean);
}
function rootEntry(file: string): string {
	return file.split("/", 1)[0] ?? "";
}
function isIgnored(name: string): boolean {
	return spawnSync("git", ["check-ignore", "-q", "--", name], { stdio: "ignore" }).status === 0;
}
