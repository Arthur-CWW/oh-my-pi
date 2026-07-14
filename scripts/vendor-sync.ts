#!/usr/bin/env bun
import * as fs from "node:fs/promises";
import * as path from "node:path";

type Policy = "track" | "pin";
export type VendorEntry = {
	path: string;
	upstream: string | null;
	policy: Policy;
	lastSync: string;
	reason: string;
};
export type VendorManifest = { vendors: VendorEntry[] };

export type CommandResult = { status: number; stdout: string; stderr: string };
export type GitRunner = (repo: string, args: string[]) => Promise<CommandResult>;
export type FastForwardDecision = "fast-forward" | "diverged" | "failed";
export type SyncOptions = { root: string; manifestPath: string; apply: boolean; runGit?: GitRunner };
export type SyncResult = {
	path: string;
	policy: Policy;
	before: string;
	after: string;
	action: string;
	why: string;
};

const scalarKeys: Record<string, true> = { path: true, upstream: true, policy: true, lastSync: true, reason: true };

export function decodeManifest(text: string): VendorManifest {
	const lines = text.split(/\r?\n/);
	if (!lines.some(line => /^vendors:\s*$/.test(line.trim()))) throw new Error("manifest must contain a vendors list");
	const values: Array<Record<string, string | null>> = [];
	let current: Record<string, string | null> | undefined;
	for (const rawLine of lines) {
		const line = rawLine.replace(/\s+#.*$/, "");
		const item = /^\s*-\s+([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/.exec(line);
		if (item) {
			if (current) values.push(current);
			current = {};
			readField(current, item[1], item[2]);
			continue;
		}
		const field = /^\s{4,}([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/.exec(line);
		if (field && current) readField(current, field[1], field[2]);
	}
	if (current) values.push(current);
	if (values.length === 0) throw new Error("manifest vendors list is empty");
	const vendors = values.map(validateEntry);
	const paths = new Set<string>();
	for (const vendor of vendors) {
		if (paths.has(vendor.path)) throw new Error(`duplicate vendor path: ${vendor.path}`);
		paths.add(vendor.path);
	}
	return { vendors };
}

function readField(target: Record<string, string | null>, key: string, rawValue: string): void {
	if (!scalarKeys[key]) throw new Error(`unknown manifest field: ${key}`);
	target[key] = parseScalar(rawValue);
}

function parseScalar(value: string): string | null {
	if (value === "null") return null;
	if (value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
	return value;
}

function validateEntry(fields: Record<string, string | null>): VendorEntry {
	const vendorPath = fields.path;
	const upstream = fields.upstream;
	const policy = fields.policy;
	const lastSync = fields.lastSync;
	const reason = fields.reason;
	if (!vendorPath || vendorPath.startsWith("/") || vendorPath.split("/").includes("..")) throw new Error("vendor path must be relative");
	if (upstream !== null && (!upstream || !/^https?:\/\//.test(upstream))) throw new Error(`invalid upstream for ${vendorPath}`);
	if (policy !== "track" && policy !== "pin") throw new Error(`invalid policy for ${vendorPath}`);
	if (!lastSync || !reason) throw new Error(`missing lastSync/reason for ${vendorPath}`);
	return { path: vendorPath, upstream, policy, lastSync, reason };
}

function encodeManifest(manifest: VendorManifest): string {
	return ["vendors:", ...manifest.vendors.flatMap(vendor => [
		`  - path: ${quote(vendor.path)}`,
		`    upstream: ${vendor.upstream === null ? "null" : quote(vendor.upstream)}`,
		`    policy: ${quote(vendor.policy)}`,
		`    lastSync: ${quote(vendor.lastSync)}`,
		`    reason: ${quote(vendor.reason)}`,
	]), ""].join("\n");
}

function quote(value: string): string {
	return JSON.stringify(value);
}

export function decideFastForward(mergeExitCode: number): FastForwardDecision {
	if (mergeExitCode === 0) return "fast-forward";
	if (mergeExitCode === 1) return "diverged";
	return "failed";
}
async function runGit(repo: string, args: string[]): Promise<CommandResult> {
	const process = Bun.spawn(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, status] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	return { status, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function hasGitMetadata(repo: string): Promise<boolean> {
	try {
		await fs.stat(path.join(repo, ".git"));
		return true;
	} catch {
		return false;
	}
}

function shortSha(sha: string): string {
	return sha && sha !== "-" ? sha.slice(0, 12) : "-";
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}
export async function syncManifest(options: SyncOptions): Promise<SyncResult[]> {
	const manifestText = await fs.readFile(options.manifestPath, "utf8");
	const manifest = decodeManifest(manifestText);
	const run = options.runGit ?? runGit;
	const results: SyncResult[] = [];
	let changed = false;
	for (const vendor of manifest.vendors) {
		const repo = path.resolve(options.root, vendor.path);
		if (!(await hasGitMetadata(repo))) {
			results.push({ path: vendor.path, policy: vendor.policy, before: "-", after: "-", action: "snapshot report-only", why: vendor.reason });
			continue;
		}
		const beforeResult = await run(repo, ["rev-parse", "HEAD"]);
		if (beforeResult.status !== 0) {
			results.push({ path: vendor.path, policy: vendor.policy, before: "-", after: "-", action: "unreadable — pinned", why: beforeResult.stderr || "cannot read HEAD" });
			if (vendor.policy !== "pin") { vendor.policy = "pin"; vendor.reason = "nested git repository cannot report HEAD"; changed = true; }
			continue;
		}
		const before = beforeResult.stdout;
		if (vendor.policy === "pin") {
			results.push({ path: vendor.path, policy: vendor.policy, before: shortSha(before), after: shortSha(before), action: "pinned — skipped", why: vendor.reason });
			continue;
		}
		const dirty = await run(repo, ["status", "--porcelain"]);
		if (dirty.status !== 0) throw new Error(`${vendor.path}: git status failed: ${dirty.stderr}`);
		if (dirty.stdout) {
			vendor.policy = "pin";
			vendor.reason = "local modifications detected; refusing to touch dirty vendor path";
			changed = true;
			results.push({ path: vendor.path, policy: vendor.policy, before: shortSha(before), after: shortSha(before), action: "dirty — flipped to pin", why: vendor.reason });
			continue;
		}
		const branch = await run(repo, ["symbolic-ref", "--short", "HEAD"]);
		if (branch.status !== 0) {
			vendor.policy = "pin";
			vendor.reason = "detached HEAD; refusing to auto-sync without a branch";
			changed = true;
			results.push({ path: vendor.path, policy: vendor.policy, before: shortSha(before), after: shortSha(before), action: "detached — flipped to pin", why: vendor.reason });
			continue;
		}
		if (!options.apply) {
			results.push({ path: vendor.path, policy: vendor.policy, before: shortSha(before), after: shortSha(before), action: "dry-run — fetch/ff skipped", why: vendor.reason });
			continue;
		}
		const remote = await run(repo, ["config", "--get", "remote.origin.url"]);
		if (remote.status !== 0 || !remote.stdout) throw new Error(`${vendor.path}: no origin remote; refusing to sync`);
		const fetched = await run(repo, ["fetch", "--no-tags", "origin"]);
		if (fetched.status !== 0) throw new Error(`${vendor.path}: fetch failed: ${fetched.stderr || fetched.stdout}`);
		const ancestor = await run(repo, ["merge-base", "--is-ancestor", before, "FETCH_HEAD"]);
		const decision = decideFastForward(ancestor.status);
		if (decision === "diverged") {
			vendor.policy = "pin";
			vendor.reason = "local and upstream histories diverged; ff-only sync refused";
			changed = true;
			results.push({ path: vendor.path, policy: vendor.policy, before: shortSha(before), after: shortSha(before), action: "diverged — flipped to pin", why: vendor.reason });
			continue;
		}
		if (decision === "failed") throw new Error(`${vendor.path}: cannot determine fast-forward safety: ${ancestor.stderr}`);
		const merged = await run(repo, ["merge", "--ff-only", "FETCH_HEAD"]);
		if (merged.status !== 0) throw new Error(`${vendor.path}: ff-only merge failed: ${merged.stderr || merged.stdout}`);
		const afterResult = await run(repo, ["rev-parse", "HEAD"]);
		if (afterResult.status !== 0) throw new Error(`${vendor.path}: cannot read post-sync HEAD: ${afterResult.stderr}`);
		vendor.lastSync = today();
		changed = true;
		results.push({ path: vendor.path, policy: vendor.policy, before: shortSha(before), after: shortSha(afterResult.stdout), action: "fast-forwarded", why: vendor.reason });
	}
	if (options.apply && changed) await fs.writeFile(options.manifestPath, encodeManifest(manifest));
	return results;
}

function printSummary(results: SyncResult[], apply: boolean): void {
	console.log(`Vendor sync (${apply ? "apply" : "dry-run"})`);
	console.log("vendor\tpolicy\tbefore\tafter\taction\twhy");
	for (const result of results) console.log(`${result.path}\t${result.policy}\t${result.before}\t${result.after}\t${result.action}\t${result.why}`);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.some(arg => arg !== "--dry-run" && arg !== "--apply") || (args.includes("--dry-run") && args.includes("--apply"))) {
		throw new Error("usage: bun scripts/vendor-sync.ts [--dry-run|--apply]");
	}
	const apply = args.includes("--apply");
	const root = process.cwd();
	const results = await syncManifest({ root, manifestPath: path.join(root, "catalog/vendors.yml"), apply });
	printSummary(results, apply);
}

if (import.meta.main) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
