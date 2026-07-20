#!/usr/bin/env bun
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

type Scalar = string | null;
export type VendorPolicy = "track" | "pin";

type CommonVendorEntry = {
	path: string;
	lastSync: string;
	reason: string;
};

export type TrackedVendorEntry = CommonVendorEntry & {
	policy: "track";
	upstream: string;
	remote: string;
	branch: string;
};

export type PinnedVendorEntry = CommonVendorEntry & {
	policy: "pin";
	upstream: string | null;
	remote: null;
	branch: null;
};

export type VendorEntry = TrackedVendorEntry | PinnedVendorEntry;
export type VendorManifest = { schemaVersion: 2; vendors: VendorEntry[] };

export type CommandResult = { status: number; stdout: string; stderr: string };
export type GitRunner = (repo: string, args: string[]) => Promise<CommandResult>;

export type SyncDisposition = "skipped" | "eligible" | "unchanged" | "updated" | "blocked" | "failed";
export type SyncCode =
	| "pinned"
	| "dry-run"
	| "missing-repository"
	| "not-git-repository"
	| "unsafe-path"
	| "path-escape"
	| "dirty"
	| "detached"
	| "branch-mismatch"
	| "tracking-remote-mismatch"
	| "tracking-branch-mismatch"
	| "remote-url-mismatch"
	| "fetch-failed"
	| "merge-failed"
	| "ahead"
	| "diverged"
	| "state-changed"
	| "up-to-date"
	| "fast-forwarded"
	| "git-command-failed"
	| "manifest-conflict"
	| "manifest-write-failed"
	| "lock-held";

export type SyncResult = {
	path: string;
	policy: VendorPolicy;
	before: string | null;
	after: string | null;
	disposition: SyncDisposition;
	code: SyncCode;
	detail: string;
};

export type SyncReport = {
	apply: boolean;
	results: SyncResult[];
	updated: number;
	unchanged: number;
	blocked: number;
	failed: number;
	ok: boolean;
};

export type SyncOptions = {
	root: string;
	manifestPath: string;
	apply: boolean;
	runGit?: GitRunner;
	now?: () => string;
};

const entryKeys: Record<string, true> = {
	path: true,
	upstream: true,
	policy: true,
	lastSync: true,
	reason: true,
	remote: true,
	branch: true,
};
const topLevelKeys: Record<string, true> = { schemaVersion: true, vendors: true };
const safeRemote = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const safeBranch = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const safePathSegment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const shaPattern = /^[0-9a-f]{40,64}$/;
const scalarEscapes: Record<string, string> = { '"': '"', "\\": "\\", n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };

function stripComment(line: string): string {
	let quote: '"' | "'" | null = null;
	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (quote === '"' && character === "\\") {
			index += 1;
			continue;
		}
		if (quote === "'" && character === "'" && line[index + 1] === "'") {
			index += 1;
			continue;
		}
		if (character === '"' || character === "'") {
			if (quote === null) quote = character;
			else if (quote === character) quote = null;
			continue;
		}
		if (character === "#" && quote === null && (index === 0 || /\s/.test(line[index - 1] ?? ""))) return line.slice(0, index).trimEnd();
	}
	return line.trimEnd();
}

function parseScalar(value: string): Scalar {
	const trimmed = value.trim();
	if (!trimmed) throw new Error("manifest scalar cannot be empty");
	if (trimmed === "null") return null;
	if (trimmed.startsWith('"')) {
		if (!trimmed.endsWith('"') || trimmed.length < 2) throw new Error(`invalid quoted scalar: ${trimmed}`);
		const body = trimmed.slice(1, -1);
		let parsed = "";
		for (let index = 0; index < body.length; index += 1) {
			const character = body[index];
			if (character !== "\\") {
				parsed += character;
				continue;
			}
			const escape = body[index + 1];
			if (escape === undefined) throw new Error(`invalid quoted scalar: ${trimmed}`);
			if (escape === "u") {
				const code = body.slice(index + 2, index + 6);
				if (!/^[0-9A-Fa-f]{4}$/.test(code)) throw new Error(`invalid quoted scalar: ${trimmed}`);
				parsed += String.fromCharCode(Number.parseInt(code, 16));
				index += 5;
				continue;
			}
			if (scalarEscapes[escape] === undefined) throw new Error(`invalid quoted scalar escape: ${escape}`);
			parsed += scalarEscapes[escape];
			index += 1;
		}
		return parsed;
	}
	if (trimmed.startsWith("'")) {
		if (!trimmed.endsWith("'") || trimmed.length < 2) throw new Error(`invalid quoted scalar: ${trimmed}`);
		return trimmed.slice(1, -1).replace(/''/g, "'");
	}
	if (/[\"']/.test(trimmed)) throw new Error(`invalid unquoted scalar: ${trimmed}`);
	return trimmed;
}

function readField(target: Record<string, Scalar>, key: string, rawValue: string): void {
	if (!entryKeys[key]) throw new Error(`unknown manifest field: ${key}`);
	if (Object.prototype.hasOwnProperty.call(target, key)) throw new Error(`duplicate manifest field: ${key}`);
	target[key] = parseScalar(rawValue);
}

function validDate(value: Scalar): value is string {
	if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [yearText, monthText, dayText] = value.split("-");
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeVendorPath(value: Scalar): string {
	if (value === null || !value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) throw new Error("vendor path must be normalized and relative");
	const segments = value.split("/");
	if (segments.some(segment => !segment || segment === "." || segment === ".." || !safePathSegment.test(segment))) throw new Error(`unsafe vendor path: ${value}`);
	if (path.posix.normalize(value) !== value) throw new Error(`vendor path is not normalized: ${value}`);
	return value;
}

function normalizeUpstream(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`invalid upstream URL: ${value}`);
	}
	if (parsed.protocol.toLowerCase() !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.hostname || parsed.port && parsed.port !== "443") {
		throw new Error(`invalid upstream URL: ${value}`);
	}
	const hostname = parsed.hostname.toLowerCase();
	let pathname = parsed.pathname.replace(/\/+$/, "");
	if (!pathname) throw new Error(`invalid upstream URL: ${value}`);
	if (pathname.endsWith(".git")) pathname = pathname.slice(0, -4);
	pathname = pathname.replace(/\/+$/, "");
	if (!pathname) throw new Error(`invalid upstream URL: ${value}`);
	return `https://${hostname}${pathname}`;
}

function validateRefName(value: Scalar, kind: "remote" | "branch"): string {
	const pattern = kind === "remote" ? safeRemote : safeBranch;
	if (value === null || !value || !pattern.test(value) || value.includes("..") || value.includes("@{")) throw new Error(`unsafe ${kind} name: ${value ?? "null"}`);
	return value;
}

function validateEntry(fields: Record<string, Scalar>): VendorEntry {
	const actualKeys = Object.keys(fields);
	if (actualKeys.length !== Object.keys(entryKeys).length || actualKeys.some(key => !entryKeys[key])) throw new Error("vendor entry has an inexact key set");
	const vendorPath = normalizeVendorPath(fields.path);
	const policy = fields.policy;
	if (policy !== "track" && policy !== "pin") throw new Error(`invalid policy for ${vendorPath}`);
	if (!validDate(fields.lastSync)) throw new Error(`invalid lastSync for ${vendorPath}`);
	if (fields.reason === null || !fields.reason.trim()) throw new Error(`missing reason for ${vendorPath}`);
	if (fields.upstream !== null) normalizeUpstream(fields.upstream);
	if (policy === "track") {
		if (fields.upstream === null) throw new Error(`track entry requires upstream: ${vendorPath}`);
		const upstream = fields.upstream;
		const remote = validateRefName(fields.remote, "remote");
		const branch = validateRefName(fields.branch, "branch");
		return { path: vendorPath, upstream, policy, remote, branch, lastSync: fields.lastSync, reason: fields.reason };
	}
	if (fields.remote !== null || fields.branch !== null) throw new Error(`pin entry requires null remote/branch: ${vendorPath}`);
	return { path: vendorPath, upstream: fields.upstream, policy, remote: null, branch: null, lastSync: fields.lastSync, reason: fields.reason };
}

export function decodeManifest(text: string): VendorManifest {
	const lines = text.split(/\r?\n/);
	let schemaVersion: Scalar = null;
	let sawSchemaVersion = false;
	let sawVendors = false;
	const values: Array<Record<string, Scalar>> = [];
	let current: Record<string, Scalar> | null = null;
	for (const rawLine of lines) {
		if (/\t/.test(rawLine)) throw new Error("manifest must not use tabs for indentation");
		const line = stripComment(rawLine);
		if (!line.trim()) continue;
		const topLevel = /^(\w+):(?:\s*(.*))?$/.exec(line);
		if (topLevel) {
			if (current) {
				values.push(current);
				current = null;
			}
			const key = topLevel[1];
			if (!topLevelKeys[key]) throw new Error(`unknown manifest key: ${key}`);
			if (key === "schemaVersion") {
				if (sawSchemaVersion) throw new Error("duplicate schemaVersion");
				sawSchemaVersion = true;
				schemaVersion = parseScalar(topLevel[2] ?? "");
			} else {
				if (sawVendors) throw new Error("duplicate vendors list");
				if (topLevel[2]?.trim()) throw new Error("vendors must be a block list");
				sawVendors = true;
			}
			continue;
		}
		const item = /^ {2}-\s+([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/.exec(line);
		if (item) {
			if (!sawVendors) throw new Error("vendor list appears before vendors key");
			if (current) values.push(current);
			current = {};
			readField(current, item[1], item[2] ?? "");
			continue;
		}
		const field = /^ {4}([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/.exec(line);
		if (field && current) {
			readField(current, field[1], field[2] ?? "");
			continue;
		}
		throw new Error(`unsupported manifest syntax: ${rawLine}`);
	}
	if (current) values.push(current);
	if (!sawSchemaVersion || schemaVersion !== "2") throw new Error("manifest schemaVersion must be 2");
	if (!sawVendors || values.length === 0) throw new Error("manifest vendors list is empty");
	const vendors = values.map(validateEntry);
	const seen = new Set<string>();
	for (const vendor of vendors) {
		if (seen.has(vendor.path)) throw new Error(`duplicate vendor path: ${vendor.path}`);
		seen.add(vendor.path);
	}
	return { schemaVersion: 2, vendors };
}

function updateLastSync(text: string, vendorPath: string, nextDate: string): string {
	const chunks = text.split(/(\r\n|\n)/);
	const lines: string[] = [];
	const endings: string[] = [];
	for (let index = 0; index < chunks.length; index += 2) {
		const line = chunks[index];
		if (line === undefined) continue;
		lines.push(line);
		endings.push(chunks[index + 1] ?? "");
	}
	const itemPattern = /^ {2}-\s+([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/;
	let sectionStart = -1;
	let matchFound = false;
	const replaceSection = (sectionEnd: number): void => {
		if (sectionStart < 0 || matchFound) return;
		let sectionPath: Scalar | undefined;
		let lastSyncIndex = -1;
		for (let index = sectionStart; index < sectionEnd; index += 1) {
			const stripped = stripComment(lines[index]);
			const item = itemPattern.exec(stripped);
			const field = /^ {4}([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/.exec(stripped);
			const key = item?.[1] ?? field?.[1];
			if (key === "path") {
				const rawValue = item?.[2] ?? field?.[2];
				sectionPath = parseScalar(rawValue ?? "");
			}
			if (key === "lastSync") lastSyncIndex = index;
		}
		if (sectionPath !== vendorPath || lastSyncIndex < 0) return;
		const lastSync = /^(\s{2}-\s+lastSync:\s*|\s{4}lastSync:\s*)(.*?)(\s+#.*)?$/.exec(lines[lastSyncIndex]);
		if (!lastSync) throw new Error(`cannot locate lastSync for ${vendorPath}`);
		const rawValue = lastSync[2].trim();
		const serialized = rawValue.startsWith('"') ? JSON.stringify(nextDate) : rawValue.startsWith("'") ? `'${nextDate}'` : nextDate;
		lines[lastSyncIndex] = `${lastSync[1]}${serialized}${lastSync[3] ?? ""}`;
		matchFound = true;
	};
	for (let index = 0; index < lines.length; index += 1) {
		if (!itemPattern.test(stripComment(lines[index]))) continue;
		replaceSection(index);
		sectionStart = index;
	}
	replaceSection(lines.length);
	if (!matchFound) throw new Error(`cannot locate lastSync for ${vendorPath}`);
	return lines.map((line, index) => line + (endings[index] ?? "")).join("");
}

async function runGit(repo: string, args: string[]): Promise<CommandResult> {
	const child = Bun.spawn(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, status] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { status, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function safeRunGit(run: GitRunner, repo: string, args: string[]): Promise<CommandResult> {
	try {
		return await run(repo, args);
	} catch (error) {
		return { status: -1, stdout: "", stderr: error instanceof Error ? error.message : "git command failed" };
	}
}

function shortSha(sha: string | null): string {
	return sha && sha !== "-" ? sha.slice(0, 12) : "-";
}

function makeResult(vendor: VendorEntry, disposition: SyncDisposition, code: SyncCode, before: string | null, after: string | null, detail: string): SyncResult {
	return { path: vendor.path, policy: vendor.policy, before, after, disposition, code, detail };
}

function commandDetail(result: CommandResult, fallback: string): string {
	return result.stderr || result.stdout || fallback;
}

function isSha(value: string): boolean {
	return shaPattern.test(value);
}

type RepoLocation = { repo: string };
type TrackInspection = { repo: string; before: string };

type InspectionResult = { inspection: TrackInspection } | { result: SyncResult };

async function locateRepository(vendor: TrackedVendorEntry, root: string, rootReal: string, run: GitRunner): Promise<RepoLocation | SyncResult> {
	const declared = path.resolve(root, vendor.path);
	let repoReal: string;
	try {
		repoReal = await fs.realpath(declared);
	} catch {
		return makeResult(vendor, "blocked", "missing-repository", null, null, "declared repository path is missing or unreadable");
	}
	const relative = path.relative(rootReal, repoReal);
	if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		return makeResult(vendor, "blocked", "path-escape", null, null, "realpath escapes the configured sync root");
	}
	const topLevel = await safeRunGit(run, repoReal, ["rev-parse", "--show-toplevel"]);
	if (topLevel.status !== 0) return makeResult(vendor, "blocked", "not-git-repository", null, null, commandDetail(topLevel, "cannot resolve Git top-level"));
	let topReal: string;
	try {
		topReal = await fs.realpath(topLevel.stdout);
	} catch {
		return makeResult(vendor, "blocked", "not-git-repository", null, null, "Git top-level is not readable");
	}
	if (topReal !== repoReal) return makeResult(vendor, "blocked", "not-git-repository", null, null, "Git top-level differs from declared repository path");
	return { repo: repoReal };
}

async function inspectTrack(vendor: TrackedVendorEntry, repo: string, run: GitRunner, expectedBefore: string | null): Promise<InspectionResult> {
	const head = await safeRunGit(run, repo, ["rev-parse", "HEAD"]);
	if (head.status !== 0 || !isSha(head.stdout)) return { result: makeResult(vendor, "failed", "not-git-repository", null, null, commandDetail(head, "cannot read HEAD")) };
	const before = head.stdout;
	const status = await safeRunGit(run, repo, ["status", "--porcelain=v1", "--untracked-files=normal", "--ignore-submodules=none"]);
	if (status.status !== 0) return { result: makeResult(vendor, "failed", "git-command-failed", before, before, commandDetail(status, "cannot inspect worktree status")) };
	if (status.stdout) return { result: makeResult(vendor, "blocked", "dirty", before, before, "worktree has tracked, untracked, or submodule changes") };
	const branch = await safeRunGit(run, repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
	if (branch.status === 1) return { result: makeResult(vendor, "blocked", "detached", before, before, "HEAD is detached") };
	if (branch.status !== 0) return { result: makeResult(vendor, "failed", "git-command-failed", before, before, commandDetail(branch, "cannot inspect current branch")) };
	if (branch.stdout !== vendor.branch) return { result: makeResult(vendor, "blocked", "branch-mismatch", before, before, `current branch is ${branch.stdout || "empty"}, expected ${vendor.branch}`) };
	const trackingRemote = await safeRunGit(run, repo, ["config", "--get", `branch.${vendor.branch}.remote`]);
	if (trackingRemote.status !== 0 || trackingRemote.stdout !== vendor.remote) {
		const disposition = trackingRemote.status > 1 || trackingRemote.status < 0 ? "failed" : "blocked";
		const code: SyncCode = disposition === "failed" ? "git-command-failed" : "tracking-remote-mismatch";
		return { result: makeResult(vendor, disposition, code, before, before, disposition === "failed" ? commandDetail(trackingRemote, "cannot inspect tracking remote") : `tracking remote is ${trackingRemote.stdout || "unset"}, expected ${vendor.remote}`) };
	}
	const trackingBranch = await safeRunGit(run, repo, ["config", "--get", `branch.${vendor.branch}.merge`]);
	const expectedMerge = `refs/heads/${vendor.branch}`;
	if (trackingBranch.status !== 0 || trackingBranch.stdout !== expectedMerge) {
		const disposition = trackingBranch.status > 1 || trackingBranch.status < 0 ? "failed" : "blocked";
		const code: SyncCode = disposition === "failed" ? "git-command-failed" : "tracking-branch-mismatch";
		return { result: makeResult(vendor, disposition, code, before, before, disposition === "failed" ? commandDetail(trackingBranch, "cannot inspect tracking branch") : `tracking branch is ${trackingBranch.stdout || "unset"}, expected ${expectedMerge}`) };
	}
	const remoteUrl = await safeRunGit(run, repo, ["config", "--get-all", `remote.${vendor.remote}.url`]);
	const urls = remoteUrl.stdout ? remoteUrl.stdout.split(/\r?\n/).filter(Boolean) : [];
	let matches = false;
	if (urls.length === 1) {
		try {
			matches = normalizeUpstream(urls[0]) === normalizeUpstream(vendor.upstream);
		} catch {
			matches = false;
		}
	}
	if (remoteUrl.status !== 0 || !matches) {
		const disposition = remoteUrl.status > 1 || remoteUrl.status < 0 ? "failed" : "blocked";
		const code: SyncCode = disposition === "failed" ? "git-command-failed" : "remote-url-mismatch";
		return { result: makeResult(vendor, disposition, code, before, before, disposition === "failed" ? commandDetail(remoteUrl, "cannot inspect configured remote URL") : "configured remote URL does not match declared upstream") };
	}
	if (expectedBefore !== null && before !== expectedBefore) return { result: makeResult(vendor, "blocked", "state-changed", expectedBefore, before, "HEAD changed during synchronization") };
	return { inspection: { repo, before } };
}

async function classifyRelationship(local: string, upstream: string, run: GitRunner, repo: string): Promise<"equal" | "behind" | "ahead" | "diverged" | "failed"> {
	if (local === upstream) return "equal";
	const localAncestor = await safeRunGit(run, repo, ["merge-base", "--is-ancestor", local, upstream]);
	if (localAncestor.status === 0) return "behind";
	if (localAncestor.status !== 1) return "failed";
	const upstreamAncestor = await safeRunGit(run, repo, ["merge-base", "--is-ancestor", upstream, local]);
	if (upstreamAncestor.status === 0) return "ahead";
	if (upstreamAncestor.status === 1) return "diverged";
	return "failed";
}

class ManifestConflictError extends Error {}
class ManifestWriteError extends Error {}

async function persistManifest(manifestPath: string, expectedText: string, nextText: string): Promise<string> {
	let currentText: string;
	try {
		currentText = await fs.readFile(manifestPath, "utf8");
	} catch (error) {
		throw new ManifestWriteError(error instanceof Error ? error.message : "cannot reread manifest before write");
	}
	if (currentText !== expectedText) throw new ManifestConflictError("manifest changed during synchronization; refusing to overwrite it");
	const directory = path.dirname(manifestPath);
	const temporary = path.join(directory, `.${path.basename(manifestPath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
	let renamed = false;
	let file: fs.FileHandle | null = null;
	try {
		file = await fs.open(temporary, "wx");
		await file.writeFile(nextText, "utf8");
		await file.sync();
		await file.close();
		file = null;
		await fs.rename(temporary, manifestPath);
		renamed = true;
		let directoryHandle: fs.FileHandle | null = null;
		try {
			directoryHandle = await fs.open(directory, "r");
			await directoryHandle.sync();
		} finally {
			if (directoryHandle) await directoryHandle.close();
		}
	} catch (error) {
		if (file) await file.close().catch(() => undefined);
		if (!renamed) await fs.unlink(temporary).catch(() => undefined);
		if (error instanceof ManifestConflictError || error instanceof ManifestWriteError) throw error;
		throw new ManifestWriteError(error instanceof Error ? error.message : "atomic manifest write failed");
	}
	return nextText;
}

type Lock = { release: () => Promise<void> };

async function acquireLock(manifestPath: string): Promise<Lock | null> {
	const lockPath = `${manifestPath}.lock`;
	let file: fs.FileHandle | null = null;
	try {
		file = await fs.open(lockPath, "wx");
		const metadata = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), manifest: path.resolve(manifestPath) });
		await file.writeFile(metadata, "utf8");
		await file.sync();
		await file.close();
		file = null;
	} catch (error) {
		if (file) await file.close().catch(() => undefined);
		if (error instanceof Error && "code" in error && (error as { code?: string }).code === "EEXIST") return null;
		await fs.unlink(lockPath).catch(() => undefined);
		throw error;
	}
	return {
		release: async () => {
			await fs.unlink(lockPath).catch(() => undefined);
		},
	};
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function buildReport(apply: boolean, slots: Array<SyncResult | undefined>): SyncReport {
	const results = slots.map(result => result ?? {
		path: "<internal>",
		policy: "track" as const,
		before: null,
		after: null,
		disposition: "failed" as const,
		code: "git-command-failed" as const,
		detail: "entry was not processed",
	});
	const updated = results.filter(result => result.disposition === "updated").length;
	const unchanged = results.filter(result => result.disposition === "unchanged").length;
	const blocked = results.filter(result => result.disposition === "blocked").length;
	const failed = results.filter(result => result.disposition === "failed").length;
	return { apply, results, updated, unchanged, blocked, failed, ok: blocked === 0 && failed === 0 };
}

async function processTrack(
	candidate: TrackInspection,
	vendor: TrackedVendorEntry,
	run: GitRunner,
	manifestPath: string,
	expectedManifestText: string,
	now: () => string,
): Promise<{ result: SyncResult; manifestText: string; fatal: boolean }> {
	const fetched = await safeRunGit(run, candidate.repo, [
		"fetch",
		"--no-tags",
		"--no-recurse-submodules",
		vendor.remote,
		`refs/heads/${vendor.branch}:refs/remotes/${vendor.remote}/${vendor.branch}`,
	]);
	if (fetched.status !== 0) return { result: makeResult(vendor, "failed", "fetch-failed", candidate.before, candidate.before, commandDetail(fetched, "declared branch fetch failed")), manifestText: expectedManifestText, fatal: false };
	const fetchedRef = `refs/remotes/${vendor.remote}/${vendor.branch}`;
	const targetResult = await safeRunGit(run, candidate.repo, ["rev-parse", "--verify", `${fetchedRef}^{commit}`]);
	if (targetResult.status !== 0 || !isSha(targetResult.stdout)) return { result: makeResult(vendor, "failed", "fetch-failed", candidate.before, candidate.before, commandDetail(targetResult, "cannot resolve fetched branch")), manifestText: expectedManifestText, fatal: false };
	const target = targetResult.stdout;
	const relationship = await classifyRelationship(candidate.before, target, run, candidate.repo);
	if (relationship === "ahead") return { result: makeResult(vendor, "blocked", "ahead", candidate.before, candidate.before, "local branch is ahead of the declared upstream"), manifestText: expectedManifestText, fatal: false };
	if (relationship === "diverged") return { result: makeResult(vendor, "blocked", "diverged", candidate.before, candidate.before, "local and declared upstream histories diverged"), manifestText: expectedManifestText, fatal: false };
	if (relationship === "failed") return { result: makeResult(vendor, "failed", "git-command-failed", candidate.before, candidate.before, "cannot classify local and upstream history"), manifestText: expectedManifestText, fatal: false };
	const revalidated = await inspectTrack(vendor, candidate.repo, run, candidate.before);
	if ("result" in revalidated) return { result: revalidated.result, manifestText: expectedManifestText, fatal: false };
	let mergeSucceeded = false;
	if (relationship === "behind") {
		const merged = await safeRunGit(run, candidate.repo, ["merge", "--ff-only", target]);
		if (merged.status !== 0) return { result: makeResult(vendor, "failed", "merge-failed", candidate.before, candidate.before, commandDetail(merged, "fast-forward merge failed")), manifestText: expectedManifestText, fatal: false };
		mergeSucceeded = true;
	}
	const expectedAfter = relationship === "equal" ? candidate.before : target;
	const afterCheck = await inspectTrack(vendor, candidate.repo, run, expectedAfter);
	if ("result" in afterCheck) return { result: afterCheck.result, manifestText: expectedManifestText, fatal: mergeSucceeded };
	if (afterCheck.inspection.before !== target) return { result: makeResult(vendor, "failed", "state-changed", candidate.before, afterCheck.inspection.before, "post-sync HEAD does not equal fetched upstream"), manifestText: expectedManifestText, fatal: mergeSucceeded };
	const priorLastSync = vendor.lastSync;
	const nextDate = now();
	if (!validDate(nextDate)) return { result: makeResult(vendor, "failed", "manifest-write-failed", candidate.before, afterCheck.inspection.before, "clock returned an invalid lastSync date"), manifestText: expectedManifestText, fatal: true };
	vendor.lastSync = nextDate;
	let nextManifestText = expectedManifestText;
	try {
		nextManifestText = updateLastSync(expectedManifestText, vendor.path, nextDate);
		nextManifestText = await persistManifest(manifestPath, expectedManifestText, nextManifestText);
	} catch (error) {
		vendor.lastSync = priorLastSync;
		const code: SyncCode = error instanceof ManifestConflictError ? "manifest-conflict" : "manifest-write-failed";
		return { result: makeResult(vendor, "failed", code, candidate.before, afterCheck.inspection.before, "checkout updated but manifest metadata was not durably recorded: " + (error instanceof Error ? error.message : "manifest write failed")), manifestText: expectedManifestText, fatal: true };
	}
	const disposition: SyncDisposition = relationship === "equal" ? "unchanged" : "updated";
	const code: SyncCode = relationship === "equal" ? "up-to-date" : "fast-forwarded";
	const detail = relationship === "equal" ? "declared upstream verified; lastSync refreshed" : "fast-forwarded to the resolved declared upstream commit";
	return { result: makeResult(vendor, disposition, code, candidate.before, afterCheck.inspection.before, detail), manifestText: nextManifestText, fatal: false };
}

export async function syncManifest(options: SyncOptions): Promise<SyncReport> {
	const manifestPath = path.resolve(options.manifestPath);
	const manifestText = await fs.readFile(manifestPath, "utf8");
	const manifest = decodeManifest(manifestText);
	const run = options.runGit ?? runGit;
	const now = options.now ?? today;
	const slots: Array<SyncResult | undefined> = new Array(manifest.vendors.length).fill(undefined);
	for (let index = 0; index < manifest.vendors.length; index += 1) {
		const vendor = manifest.vendors[index];
		if (vendor.policy === "pin") slots[index] = makeResult(vendor, "skipped", "pinned", null, null, vendor.reason);
	}
	let lock: Lock | null = null;
	if (options.apply) lock = await acquireLock(manifestPath);
	if (options.apply && lock === null) {
		for (let index = 0; index < manifest.vendors.length; index += 1) {
			const vendor = manifest.vendors[index];
			if (vendor.policy === "track") slots[index] = makeResult(vendor, "failed", "lock-held", null, null, "another vendor-sync run holds the adjacent lock");
		}
		return buildReport(true, slots);
	}
	try {
		let rootReal: string | null = null;
		let rootFailure: string | null = null;
		const candidates: Array<{ index: number; vendor: TrackedVendorEntry; inspection: TrackInspection }> = [];
		for (let index = 0; index < manifest.vendors.length; index += 1) {
			const vendor = manifest.vendors[index];
			if (vendor.policy === "pin") continue;
			if (rootReal === null && rootFailure === null) {
				try {
					rootReal = await fs.realpath(options.root);
				} catch {
					rootFailure = "configured sync root is missing or unreadable";
				}
			}
			if (rootFailure !== null || rootReal === null) {
				slots[index] = makeResult(vendor, "failed", "missing-repository", null, null, rootFailure ?? "configured sync root is unavailable");
				continue;
			}
			const location = await locateRepository(vendor, options.root, rootReal, run);
			if ("path" in location) {
				slots[index] = location;
				continue;
			}
			const inspected = await inspectTrack(vendor, location.repo, run, null);
			if ("result" in inspected) slots[index] = inspected.result;
			else candidates.push({ index, vendor, inspection: inspected.inspection });
		}
		if (!options.apply) {
			for (const candidate of candidates) slots[candidate.index] = makeResult(candidate.vendor, "eligible", "dry-run", candidate.inspection.before, null, "preflight passed; dry-run performs no fetch, merge, or manifest write");
			return buildReport(false, slots);
		}
		let expectedManifestText = manifestText;
		let stopAfterFailure = false;
		for (const candidate of candidates) {
			if (stopAfterFailure) {
				slots[candidate.index] = makeResult(candidate.vendor, "failed", "manifest-write-failed", candidate.inspection.before, candidate.inspection.before, "not attempted after a prior manifest persistence failure");
				continue;
			}
			const processed = await processTrack(candidate.inspection, candidate.vendor, run, manifestPath, expectedManifestText, now);
			slots[candidate.index] = processed.result;
			expectedManifestText = processed.manifestText;
			if (processed.fatal) stopAfterFailure = true;
		}
		return buildReport(true, slots);
	} finally {
		if (lock) await lock.release();
	}
}

function printReport(report: SyncReport): void {
	console.log(`vendor-sync ok=${report.ok} updated=${report.updated} unchanged=${report.unchanged} blocked=${report.blocked} failed=${report.failed}`);
	console.log(`mode=${report.apply ? "apply" : "dry-run"}`);
	console.log("path\tpolicy\tbefore\tafter\tdisposition\tcode\tdetail");
	for (const result of report.results) {
		const detail = result.detail.replace(/[\r\n\t]+/g, " ");
		console.log(`${result.path}\t${result.policy}\t${shortSha(result.before)}\t${shortSha(result.after)}\t${result.disposition}\t${result.code}\t${detail}`);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.some(arg => arg !== "--dry-run" && arg !== "--apply") || (args.includes("--dry-run") && args.includes("--apply")) || new Set(args).size !== args.length) throw new Error("usage: bun scripts/vendor-sync.ts [--dry-run|--apply]");
	const apply = args.includes("--apply");
	const root = process.cwd();
	const report = await syncManifest({ root, manifestPath: path.join(root, "catalog/vendors.yml"), apply });
	printReport(report);
	if (!report.ok) process.exitCode = 1;
}

if (import.meta.main) {
	main().catch(error => {
		console.error(`vendor-sync fatal: ${error instanceof Error ? error.message : "unexpected failure"}`);
		process.exitCode = 1;
	});
}
