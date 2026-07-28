import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as natives from "@oh-my-pi/pi-natives";
import { formatBytes, getWorktreeDir, hashPath, isEnoent, logger, Snowflake } from "@oh-my-pi/pi-utils";
import * as git from "../utils/git";
import { mapWithConcurrencyLimit } from "./parallel";

const { IsoBackendKind } = natives;
type IsoBackendKind = natives.IsoBackendKind;

/** Why an untracked path was left out of a capture. */
export type BaselineExclusionReason =
	| "file-too-large"
	| "budget-exhausted"
	| "capture-gated"
	| "excluded-at-baseline"
	| "not-regular";

/** An untracked path deliberately left out of a capture instead of being encoded into a patch. */
export interface BaselineExclusion {
	readonly path: string;
	readonly bytes: number;
	readonly reason: BaselineExclusionReason;
}

/** Capture failed because current task output could not fit in the bounded snapshot. */
export class CurrentSnapshotExclusionError extends Error {
	readonly _tag = "CurrentSnapshotExclusion";

	constructor(
		readonly repoRoot: string,
		readonly excluded: readonly BaselineExclusion[],
		readonly excludedCount: number,
		readonly excludedBytes: number,
	) {
		const sample = excluded
			.slice(0, 5)
			.map(entry => entry.path)
			.join(", ");
		const moreCount = excludedCount - Math.min(5, excluded.length);
		const more = moreCount > 0 ? `, +${moreCount} more` : "";
		super(
			`Current task snapshot excluded ${excludedCount} untracked file(s) totalling ${formatBytes(excludedBytes)} (${sample}${more}). Task output was not captured.`,
		);
		this.name = "CurrentSnapshotExclusionError";
	}
}

/**
 * Bounds applied while snapshotting a dirty working tree. Capture runs in the
 * coordinator, so an unbounded capture is an unbounded coordinator heap: every
 * limit here exists to keep peak memory independent of how dirty the tree is.
 */
export interface BaselineLimits {
	/** Untracked files above this are excluded rather than base85-encoded at ~1.25x. */
	readonly maxUntrackedFileBytes: number;
	/** Total source bytes of the untracked files encoded into one capture. */
	readonly maxUntrackedTotalBytes: number;
	/** Untracked path count above which the untracked capture is skipped wholesale. */
	readonly maxUntrackedPaths: number;
	/** Untracked diffs in flight at once — also the number of part files on disk at once. */
	readonly untrackedConcurrency: number;
	/** Nested repositories captured at once. */
	readonly nestedConcurrency: number;
}

export const DEFAULT_BASELINE_LIMITS: BaselineLimits = {
	maxUntrackedFileBytes: 4 * 1024 * 1024,
	maxUntrackedTotalBytes: 64 * 1024 * 1024,
	maxUntrackedPaths: 5_000,
	untrackedConcurrency: 8,
	nestedConcurrency: 4,
};

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

async function createPrivateTempDir(prefix: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	try {
		await fs.chmod(dir, PRIVATE_DIR_MODE);
		return dir;
	} catch (error) {
		await fs.rm(dir, { recursive: true, force: true });
		throw error;
	}
}

async function createPrivateDirectory(dir: string): Promise<void> {
	await fs.mkdir(dir, { mode: PRIVATE_DIR_MODE });
	await fs.chmod(dir, PRIVATE_DIR_MODE);
}

async function reservePrivateFile(filePath: string): Promise<void> {
	const file = await fs.open(filePath, "wx", PRIVATE_FILE_MODE);
	try {
		await file.chmod(PRIVATE_FILE_MODE);
	} finally {
		await file.close();
	}
}

/** Untracked working-tree state captured for one repository. */
export interface UntrackedCapture {
	/** Patch file holding the concatenated diffs of {@link captured}, or null when empty. */
	readonly patchPath: string | null;
	/**
	 * Every untracked path git listed. Retained (paths only, never contents) so a
	 * later snapshot of the same repo can tell the task's new files apart from
	 * pre-existing dirt it must keep ignoring.
	 */
	readonly listed: readonly string[];
	/** Paths encoded into {@link patchPath}, in git's listing order. */
	readonly captured: readonly string[];
	/** Bounded sample of what was left out; {@link excludedCount} is the real total. */
	readonly excluded: readonly BaselineExclusion[];
	readonly excludedCount: number;
	/** Source bytes of the excluded files whose size was measured. */
	readonly excludedBytes: number;
	/** Set when the candidate count alone tripped the limit and no candidate was encoded. */
	readonly gated: boolean;
}

/** Baseline state for a single git repository. Patches live on disk, never in the heap. */
export interface RepoBaseline {
	readonly repoRoot: string;
	readonly headCommit: string;
	/** Patch file for `git diff --cached --binary`, or null when the index is clean. */
	readonly stagedPatchPath: string | null;
	/** Patch file for `git diff --binary`, or null when tracked files are clean. */
	readonly unstagedPatchPath: string | null;
	readonly untracked: UntrackedCapture;
}

/** Baseline state for the project, including any nested git repos. */
export interface WorktreeBaseline {
	readonly root: RepoBaseline;
	/** Nested git repos (path relative to root.repoRoot). */
	readonly nested: ReadonlyArray<{ readonly relativePath: string; readonly baseline: RepoBaseline }>;
	/** Temp directory owning every patch file above. Freed by {@link releaseBaseline}. */
	readonly patchDir: string;
	/** User-facing notes when capture had to degrade. Empty after a complete capture. */
	readonly warnings: readonly string[];
}

/** Thrown by {@link getRepoRoot} when the cwd is not inside a git repository. */
export class MissingGitRepositoryError extends Error {
	readonly _tag = "MissingGitRepository";
	constructor(cwd: string) {
		super(`Git repository not found for isolated task execution (cwd: ${cwd}).`);
		this.name = "MissingGitRepositoryError";
	}
}

/** Narrow to {@link MissingGitRepositoryError} without relying on cross-realm `instanceof`. */
export function isMissingGitRepositoryError(err: unknown): err is MissingGitRepositoryError {
	return err instanceof Error && (err as { _tag?: string })._tag === "MissingGitRepository";
}

/**
 * Format the one setup failure isolated execution handles locally.
 * All other capture failures are rethrown unchanged.
 */
export function isolatedRepositoryFailureMessage(err: unknown): string {
	if (!isMissingGitRepositoryError(err)) throw err;
	return `Isolated task execution requires a git repository. ${err.message}`;
}

export async function getRepoRoot(cwd: string): Promise<string> {
	const repoRoot = await git.repo.root(cwd);
	if (!repoRoot) {
		throw new MissingGitRepositoryError(cwd);
	}

	return repoRoot;
}

const GIT_NO_INDEX_NULL_PATH = process.platform === "win32" ? "NUL" : "/dev/null";

export function getGitNoIndexNullPath(): string {
	return GIT_NO_INDEX_NULL_PATH;
}

/** Locale-independent ascending order for repository-relative paths. */
function compareRelativePaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Find nested git repositories (non-submodule) under the given root.
 *
 * Returned in ascending code-unit order, never in directory-entry order:
 * downstream transactions apply nested repositories in this sequence, and a
 * partial result must name the same prefix on every filesystem. Code units,
 * not `localeCompare`, so the order does not depend on the active locale.
 */
async function discoverNestedRepos(repoRoot: string, signal?: AbortSignal): Promise<string[]> {
	signal?.throwIfAborted();
	// Get submodule paths so we can exclude them
	const submodulePaths = new Set(await git.ls.submodules(repoRoot, signal));
	signal?.throwIfAborted();

	// Find all .git dirs/files that aren't the root or known submodules
	const result: string[] = [];
	async function walk(dir: string): Promise<void> {
		signal?.throwIfAborted();
		let entries: fsSync.Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			signal?.throwIfAborted();
			return;
		}
		for (const entry of entries) {
			signal?.throwIfAborted();
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			if (!entry.isDirectory()) continue;
			const full = path.join(dir, entry.name);
			const rel = path.relative(repoRoot, full);
			// Check if this directory is itself a git repo
			const gitDir = path.join(full, ".git");
			let hasGit = false;
			try {
				await fs.access(gitDir);
				hasGit = true;
			} catch {}
			if (hasGit && !submodulePaths.has(rel)) {
				result.push(rel);
				// Don't recurse into nested repos — they manage their own tree
				continue;
			}
			await walk(full);
		}
	}
	await walk(repoRoot);
	result.sort(compareRelativePaths);
	return result;
}

/** Size on disk, or 0 when the path vanished between listing and stat. */
async function fileSize(filePath: string, signal?: AbortSignal): Promise<number> {
	signal?.throwIfAborted();
	try {
		const size = (await fs.lstat(filePath)).size;
		signal?.throwIfAborted();
		return size;
	} catch (err) {
		signal?.throwIfAborted();
		if (isEnoent(err)) return 0;
		throw err;
	}
}

/**
 * Run one diff straight to disk via `--output`. Nothing is buffered in this
 * process. Returns the path, or null when git produced an empty patch.
 */
async function diffToFile(
	repoDir: string,
	outputPath: string,
	options: git.DiffOptions,
	signal?: AbortSignal,
): Promise<string | null> {
	signal?.throwIfAborted();
	await reservePrivateFile(outputPath);
	try {
		await git.diff(repoDir, { ...options, output: outputPath, signal });
		signal?.throwIfAborted();
		if ((await fileSize(outputPath, signal)) > 0) return outputPath;
		await fs.rm(outputPath, { force: true });
		return null;
	} catch (error) {
		await fs.rm(outputPath, { force: true });
		throw error;
	}
}

/** An earlier capture's decisions, replayed so a later snapshot stays comparable to it. */
interface UntrackedCarry {
	readonly include: ReadonlySet<string>;
	readonly exclude: ReadonlySet<string>;
}

interface UntrackedPlan {
	readonly capture: string[];
	readonly excluded: BaselineExclusion[];
	readonly excludedCount: number;
	readonly excludedBytes: number;
	readonly currentExcluded: BaselineExclusion[];
	readonly currentExcludedCount: number;
	readonly currentExcludedBytes: number;
	readonly gated: boolean;
}

/** Exclusions retained for reporting. The count and byte total stay exact. */
const EXCLUSION_SAMPLE = 20;

const SNAPSHOT_COPY_BUFFER_BYTES = 64 * 1024;
const UNTRACKED_OPEN_FLAGS = fsSync.constants.O_RDONLY | fsSync.constants.O_NONBLOCK | fsSync.constants.O_NOFOLLOW;

type SnapshotDecision =
	| { readonly captured: true; readonly bytes: number }
	| { readonly captured: false; readonly bytes: number; readonly reason: BaselineExclusionReason };

/** Optional operation observer used by deterministic race tests and diagnostics. */
export interface WorktreeOperationObserver {
	beforeSnapshotOpen?: (repoRoot: string, entry: string) => Promise<void> | void;
	commitPoint?: (kind: RepositoryMutationKind, repoRoot: string) => Promise<void> | void;
}

export type RepositoryMutationKind = "branch-capture" | "branch-merge" | "nested-apply" | "root-apply";

function isContainedPath(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function canonicalContainedPath(repoRoot: string, sourcePath: string, entry: string): Promise<string> {
	const [canonicalRoot, canonicalSource] = await Promise.all([fs.realpath(repoRoot), fs.realpath(sourcePath)]);
	if (!isContainedPath(canonicalRoot, canonicalSource)) {
		throw new Error(`Untracked path resolves outside repository: ${entry}`);
	}
	return canonicalSource;
}

function isVanishedOrSymlinkLoop(error: unknown): boolean {
	const code =
		typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
			? error.code
			: undefined;
	return code === "ELOOP" || isEnoent(error);
}

async function observeCommitPoint(
	observer: WorktreeOperationObserver | undefined,
	kind: RepositoryMutationKind,
	repoRoot: string,
): Promise<void> {
	if (!observer?.commitPoint) return;
	try {
		await observer.commitPoint(kind, repoRoot);
	} catch (error) {
		logger.warn("Repository commit-point observer failed after cancellation became non-actionable", {
			kind,
			repoRoot,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Copy one pathname through a stable, nonblocking descriptor into private
 * storage. The pathname is never reopened by git. Descriptor and pathname
 * identity, metadata, and the exact byte count are revalidated before the
 * snapshot is accepted.
 */
async function snapshotRegularFile(
	repoRoot: string,
	snapshotRoot: string,
	entry: string,
	limits: BaselineLimits,
	remainingBytes: number,
	signal?: AbortSignal,
	observer?: WorktreeOperationObserver,
): Promise<SnapshotDecision> {
	signal?.throwIfAborted();
	await observer?.beforeSnapshotOpen?.(repoRoot, entry);
	signal?.throwIfAborted();
	const sourcePath = path.join(repoRoot, entry);
	let canonicalSourceBefore: string;
	try {
		canonicalSourceBefore = await canonicalContainedPath(repoRoot, sourcePath, entry);
	} catch (error) {
		if (isVanishedOrSymlinkLoop(error)) return { captured: false, bytes: 0, reason: "not-regular" };
		throw error;
	}
	signal?.throwIfAborted();
	let source: fs.FileHandle;
	try {
		source = await fs.open(sourcePath, UNTRACKED_OPEN_FLAGS);
	} catch (error) {
		if (isVanishedOrSymlinkLoop(error)) {
			return { captured: false, bytes: 0, reason: "not-regular" };
		}
		throw new Error(`Unable to open untracked file safely: ${entry}`, { cause: error });
	}

	try {
		const before = await source.stat({ bigint: true });
		signal?.throwIfAborted();
		if (!before.isFile()) {
			return { captured: false, bytes: 0, reason: "not-regular" };
		}
		if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new Error(`Untracked file size is not safely representable: ${entry}`);
		}
		const bytes = Number(before.size);
		if (bytes > limits.maxUntrackedFileBytes) {
			return { captured: false, bytes, reason: "file-too-large" };
		}
		if (bytes > remainingBytes) {
			return { captured: false, bytes, reason: "budget-exhausted" };
		}

		const resolvedSnapshotRoot = path.resolve(snapshotRoot);
		const snapshotPath = path.resolve(resolvedSnapshotRoot, entry);
		if (!snapshotPath.startsWith(`${resolvedSnapshotRoot}${path.sep}`)) {
			throw new Error(`Untracked path escapes private snapshot storage: ${entry}`);
		}
		await fs.mkdir(path.dirname(snapshotPath), { recursive: true, mode: PRIVATE_DIR_MODE });

		let target: fs.FileHandle | undefined;
		let snapshotComplete = false;
		try {
			target = await fs.open(snapshotPath, "wx", PRIVATE_FILE_MODE);
			await target.chmod(PRIVATE_FILE_MODE);
			const buffer = Buffer.allocUnsafe(Math.max(1, Math.min(SNAPSHOT_COPY_BUFFER_BYTES, bytes)));
			let offset = 0;
			while (offset < bytes) {
				signal?.throwIfAborted();
				const length = Math.min(buffer.byteLength, bytes - offset);
				const { bytesRead } = await source.read(buffer, 0, length, offset);
				if (bytesRead === 0) {
					throw new Error(`Untracked file shrank while capturing snapshot: ${entry}`);
				}
				await target.write(buffer, 0, bytesRead, offset);
				offset += bytesRead;
			}
			signal?.throwIfAborted();
			if ((await source.read(buffer, 0, 1, bytes)).bytesRead !== 0) {
				throw new Error(`Untracked file grew while capturing snapshot: ${entry}`);
			}

			const [after, pathname, canonicalSourceAfter] = await Promise.all([
				source.stat({ bigint: true }),
				fs.lstat(sourcePath, { bigint: true }),
				canonicalContainedPath(repoRoot, sourcePath, entry),
			]);
			signal?.throwIfAborted();
			const descriptorChanged =
				!after.isFile() ||
				after.dev !== before.dev ||
				after.ino !== before.ino ||
				after.mode !== before.mode ||
				after.size !== before.size ||
				after.mtimeNs !== before.mtimeNs ||
				after.ctimeNs !== before.ctimeNs;
			const pathnameChanged =
				!pathname.isFile() ||
				pathname.dev !== before.dev ||
				pathname.ino !== before.ino ||
				pathname.mode !== before.mode ||
				pathname.size !== before.size ||
				pathname.mtimeNs !== before.mtimeNs ||
				pathname.ctimeNs !== before.ctimeNs;
			if (descriptorChanged || pathnameChanged || canonicalSourceAfter !== canonicalSourceBefore) {
				throw new Error(`Untracked file changed while capturing snapshot: ${entry}`);
			}

			await target.close();
			target = undefined;
			snapshotComplete = true;
			return { captured: true, bytes };
		} finally {
			if (target) {
				await target.close().catch(() => {});
			}
			if (!snapshotComplete) {
				await fs.rm(snapshotPath, { force: true });
			}
		}
	} finally {
		await source.close();
	}
}

/**
 * Decide which untracked paths to encode, in git's listing order so the same
 * tree always yields the same decisions.
 *
 * `carry` replays the baseline's decisions into a later snapshot of the same
 * repo. Previously captured paths are re-statted and consume the per-file,
 * path-count, and total-byte budgets before new task paths. Paths omitted at
 * baseline stay omitted. If either carried or new task state no longer fits,
 * the current capture fails rather than returning an incomplete delta.
 */
async function planUntracked(
	repoRoot: string,
	snapshotRoot: string,
	untracked: readonly string[],
	limits: BaselineLimits,
	carry: UntrackedCarry | undefined,
	signal?: AbortSignal,
	observer?: WorktreeOperationObserver,
): Promise<UntrackedPlan> {
	signal?.throwIfAborted();
	const forced: string[] = [];
	const candidates: string[] = [];
	const excluded: BaselineExclusion[] = [];
	const currentExcluded: BaselineExclusion[] = [];
	let excludedCount = 0;
	let excludedBytes = 0;
	let currentExcludedCount = 0;
	let currentExcludedBytes = 0;
	const exclude = (entry: string, bytes: number, reason: BaselineExclusionReason, current: boolean): void => {
		excludedCount += 1;
		excludedBytes += bytes;
		const value = { path: entry, bytes, reason } as const;
		if (excluded.length < EXCLUSION_SAMPLE) excluded.push(value);
		if (!current) return;
		currentExcludedCount += 1;
		currentExcludedBytes += bytes;
		if (currentExcluded.length < EXCLUSION_SAMPLE) currentExcluded.push(value);
	};

	for (const entry of untracked) {
		signal?.throwIfAborted();
		if (carry?.include.has(entry)) forced.push(entry);
		else if (carry?.exclude.has(entry)) exclude(entry, 0, "excluded-at-baseline", false);
		else candidates.push(entry);
	}

	const keep = new Set<string>();
	let used = 0;
	const consider = async (entry: string): Promise<void> => {
		const decision = await snapshotRegularFile(
			repoRoot,
			snapshotRoot,
			entry,
			limits,
			limits.maxUntrackedTotalBytes - used,
			signal,
			observer,
		);
		if (!decision.captured) {
			exclude(entry, decision.bytes, decision.reason, true);
			return;
		}
		used += decision.bytes;
		keep.add(entry);
	};

	// Carried paths consume every budget first. This is bounded by the baseline's
	// own path limit and prevents a 64 MiB baseline plus 64 MiB of new task files.
	// A caller may tighten limits between captures, so enforce the path budget
	// explicitly instead of assuming every prior include still fits it.
	const forcedPathLimit = Math.max(0, limits.maxUntrackedPaths);
	const forcedWithinPathBudget = forced.slice(0, forcedPathLimit);
	for (const entry of forced.slice(forcedPathLimit)) {
		exclude(entry, 0, "capture-gated", true);
	}
	for (const entry of forcedWithinPathBudget) {
		await consider(entry);
	}

	// Gate before opening new paths: never touch an unbounded candidate set.
	if (forcedWithinPathBudget.length + candidates.length > limits.maxUntrackedPaths) {
		for (const entry of candidates) exclude(entry, 0, "capture-gated", true);
		return {
			capture: untracked.filter(entry => keep.has(entry)),
			excluded,
			excludedCount,
			excludedBytes,
			currentExcluded,
			currentExcludedCount,
			currentExcludedBytes,
			gated: true,
		};
	}

	for (const entry of candidates) {
		await consider(entry);
	}
	// Listing order, not candidate order: the patch must read the same either way.
	return {
		capture: untracked.filter(entry => keep.has(entry)),
		excluded,
		excludedCount,
		excludedBytes,
		currentExcluded,
		currentExcludedCount,
		currentExcludedBytes,
		gated: false,
	};
}

/**
 * Encode each path as a `git diff --no-index --binary` part and stream the
 * non-empty parts into one patch file separated by a single newline — byte for
 * byte what joining the diffs in memory produced, without ever holding more
 * than one chunk of one part.
 */
async function writeUntrackedPatch(
	snapshotRoot: string,
	patchPath: string,
	partsDir: string,
	entries: readonly string[],
	limits: BaselineLimits,
	signal?: AbortSignal,
): Promise<string | null> {
	if (entries.length === 0) return null;
	signal?.throwIfAborted();
	await reservePrivateFile(patchPath);
	const nullPath = getGitNoIndexNullPath();
	const sink = Bun.file(patchPath).writer();
	let sinkClosed = false;
	let wrote = false;
	try {
		// Diff a chunk concurrently, then append that chunk in listing order: the
		// patch stays ordered and at most `untrackedConcurrency` parts exist at once.
		for (let start = 0; start < entries.length; start += limits.untrackedConcurrency) {
			signal?.throwIfAborted();
			const chunk = entries.slice(start, start + limits.untrackedConcurrency);
			const { results: parts, aborted } = await mapWithConcurrencyLimit(
				chunk.map((entry, offset) => ({ entry, part: path.join(partsDir, `${start + offset}.patch`) })),
				limits.untrackedConcurrency,
				({ entry, part }, _index, workerSignal) =>
					diffToFile(
						snapshotRoot,
						part,
						{
							allowFailure: true,
							binary: true,
							noIndex: { left: nullPath, right: entry },
						},
						workerSignal,
					),
				signal,
			);
			if (aborted) signal?.throwIfAborted();
			for (const part of parts) {
				signal?.throwIfAborted();
				if (!part) continue;
				if (wrote) sink.write("\n");
				wrote = true;
				for await (const piece of Bun.file(part).stream()) {
					signal?.throwIfAborted();
					sink.write(piece);
				}
				await sink.flush();
				await fs.rm(part, { force: true });
			}
		}
		await sink.end();
		sinkClosed = true;
		signal?.throwIfAborted();
		if (wrote) return patchPath;
		await fs.rm(patchPath, { force: true });
		return null;
	} catch (error) {
		if (!sinkClosed) {
			try {
				await sink.end();
			} catch {}
		}
		await fs.rm(patchPath, { force: true });
		throw error;
	} finally {
		await fs.rm(partsDir, { recursive: true, force: true });
	}
}

async function captureRepoBaseline(
	repoRoot: string,
	patchDir: string,
	slot: string,
	limits: BaselineLimits,
	carry?: UntrackedCarry,
	signal?: AbortSignal,
	observer?: WorktreeOperationObserver,
): Promise<RepoBaseline> {
	signal?.throwIfAborted();
	const partsDir = path.join(patchDir, `${slot}-parts`);
	const snapshotDir = path.join(patchDir, `${slot}-snapshots`);
	await Promise.all([createPrivateDirectory(partsDir), createPrivateDirectory(snapshotDir)]);
	try {
		const headCommit = (await git.head.sha(repoRoot, signal)) ?? "";
		signal?.throwIfAborted();
		const stagedPatchPath = await diffToFile(
			repoRoot,
			path.join(patchDir, `${slot}-staged.patch`),
			{
				binary: true,
				cached: true,
			},
			signal,
		);
		const unstagedPatchPath = await diffToFile(
			repoRoot,
			path.join(patchDir, `${slot}-unstaged.patch`),
			{
				binary: true,
			},
			signal,
		);
		const listed = await git.ls.untracked(repoRoot, signal);
		signal?.throwIfAborted();
		const fileEntries = listed.filter(entry => !entry.endsWith("/"));
		const plan = await planUntracked(repoRoot, snapshotDir, fileEntries, limits, carry, signal, observer);
		if (carry && plan.currentExcludedCount > 0) {
			throw new CurrentSnapshotExclusionError(
				repoRoot,
				plan.currentExcluded,
				plan.currentExcludedCount,
				plan.currentExcludedBytes,
			);
		}
		const untrackedPatchPath = await writeUntrackedPatch(
			snapshotDir,
			path.join(patchDir, `${slot}-untracked.patch`),
			partsDir,
			plan.capture,
			limits,
			signal,
		);
		return {
			repoRoot,
			headCommit,
			stagedPatchPath,
			unstagedPatchPath,
			untracked: {
				patchPath: untrackedPatchPath,
				listed,
				captured: plan.capture,
				excluded: plan.excluded,
				excludedCount: plan.excludedCount,
				excludedBytes: plan.excludedBytes,
				gated: plan.gated,
			},
		};
	} finally {
		await Promise.all([
			fs.rm(partsDir, { recursive: true, force: true }),
			fs.rm(snapshotDir, { recursive: true, force: true }),
		]);
	}
}

/** One user-facing line per repo whose capture degraded, or null when it was complete. */
function describeDegradation(label: string, untracked: UntrackedCapture, limits: BaselineLimits): string | null {
	if (untracked.excludedCount === 0) return null;
	const sample = untracked.excluded
		.slice(0, 5)
		.map(entry => entry.path)
		.join(", ");
	const rest = untracked.excludedCount - Math.min(5, untracked.excluded.length);
	const more = rest > 0 ? `, +${rest} more` : "";
	const cause = untracked.gated
		? `exceeds the ${limits.maxUntrackedPaths}-path capture limit`
		: `totalling ${formatBytes(untracked.excludedBytes)} exceeds the capture limits`;
	return `${label}: ${untracked.excludedCount} untracked file(s) excluded from the baseline — ${cause} (${sample}${more}). Task edits to those files will not be carried back.`;
}

async function writeSyntheticTree(
	repoDir: string,
	baseTreeish: string,
	patchPaths: readonly (string | null)[],
	tempDir: string,
	signal?: AbortSignal,
): Promise<string> {
	signal?.throwIfAborted();
	const tempIndex = path.join(tempDir, `index-${Snowflake.next()}`);
	try {
		await git.readTree(repoDir, baseTreeish, {
			env: { GIT_INDEX_FILE: tempIndex },
			signal,
		});
		signal?.throwIfAborted();
		await fs.chmod(tempIndex, PRIVATE_FILE_MODE);
		for (const patchPath of patchPaths) {
			signal?.throwIfAborted();
			if (!patchPath) continue;
			await git.patch.apply(repoDir, patchPath, {
				cached: true,
				env: { GIT_INDEX_FILE: tempIndex },
				signal,
			});
		}
		const tree = await git.writeTree(repoDir, {
			env: { GIT_INDEX_FILE: tempIndex },
			signal,
		});
		signal?.throwIfAborted();
		return tree;
	} finally {
		await fs.rm(tempIndex, { force: true });
	}
}

export async function captureBaseline(
	repoRoot: string,
	limits: BaselineLimits = DEFAULT_BASELINE_LIMITS,
	signal?: AbortSignal,
	observer?: WorktreeOperationObserver,
): Promise<WorktreeBaseline> {
	signal?.throwIfAborted();
	const patchDir = await createPrivateTempDir("omp-task-baseline-");
	try {
		const [root, nestedPaths] = await Promise.all([
			captureRepoBaseline(repoRoot, patchDir, "root", limits, undefined, signal, observer),
			discoverNestedRepos(repoRoot, signal),
		]);
		const { results, aborted } = await mapWithConcurrencyLimit(
			nestedPaths,
			limits.nestedConcurrency,
			async (relativePath, index, workerSignal) => {
				const nestedDir = path.join(repoRoot, relativePath);
				return {
					relativePath,
					baseline: await captureRepoBaseline(
						nestedDir,
						patchDir,
						`n${index}`,
						limits,
						undefined,
						workerSignal,
						observer,
					),
				};
			},
			signal,
		);
		if (aborted) signal?.throwIfAborted();
		const nested = results.filter((entry): entry is { relativePath: string; baseline: RepoBaseline } => !!entry);
		const warnings: string[] = [];
		const rootWarning = describeDegradation(".", root.untracked, limits);
		if (rootWarning) warnings.push(rootWarning);
		for (const entry of nested) {
			const warning = describeDegradation(entry.relativePath, entry.baseline.untracked, limits);
			if (warning) warnings.push(warning);
		}
		if (warnings.length > 0) {
			logger.warn("captureBaseline: degraded baseline capture", { repoRoot, warnings });
		}
		return { root, nested, patchDir, warnings };
	} catch (err) {
		await fs.rm(patchDir, { recursive: true, force: true });
		throw err;
	}
}

/** Delete the temp patch files a baseline owns. Idempotent. */
export async function releaseBaseline(baseline: WorktreeBaseline): Promise<void> {
	await fs.rm(baseline.patchDir, { recursive: true, force: true });
}

async function captureRepoDeltaPatch(
	repoDir: string,
	rb: RepoBaseline,
	limits: BaselineLimits,
	signal?: AbortSignal,
	observer?: WorktreeOperationObserver,
): Promise<string> {
	signal?.throwIfAborted();
	const patchDir = await createPrivateTempDir("omp-task-delta-");
	try {
		const include = new Set(rb.untracked.captured);
		const current = await captureRepoBaseline(
			repoDir,
			patchDir,
			"current",
			limits,
			{
				include,
				exclude: new Set(rb.untracked.listed.filter(entry => !include.has(entry))),
			},
			signal,
			observer,
		);

		const baselineTree = await writeSyntheticTree(
			repoDir,
			rb.headCommit,
			[rb.stagedPatchPath, rb.unstagedPatchPath, rb.untracked.patchPath],
			patchDir,
			signal,
		);
		const currentTree = await writeSyntheticTree(
			repoDir,
			current.headCommit,
			[current.stagedPatchPath, current.unstagedPatchPath, current.untracked.patchPath],
			patchDir,
			signal,
		);

		const patch = await git.diff.tree(repoDir, baselineTree, currentTree, {
			allowFailure: true,
			binary: true,
			signal,
		});
		signal?.throwIfAborted();
		return patch;
	} finally {
		await fs.rm(patchDir, { recursive: true, force: true });
	}
}

export interface NestedRepoPatch {
	relativePath: string;
	patch: string;
}

export interface DeltaPatchResult {
	rootPatch: string;
	nestedPatches: NestedRepoPatch[];
}

export async function captureDeltaPatch(
	isolationDir: string,
	baseline: WorktreeBaseline,
	limits: BaselineLimits = DEFAULT_BASELINE_LIMITS,
	signal?: AbortSignal,
	observer?: WorktreeOperationObserver,
): Promise<DeltaPatchResult> {
	signal?.throwIfAborted();
	const rootPatch = await captureRepoDeltaPatch(isolationDir, baseline.root, limits, signal, observer);
	const nestedPatches: NestedRepoPatch[] = [];

	for (const { relativePath, baseline: nb } of baseline.nested) {
		signal?.throwIfAborted();
		const nestedDir = path.join(isolationDir, relativePath);
		try {
			await fs.access(path.join(nestedDir, ".git"));
			signal?.throwIfAborted();
		} catch (error) {
			signal?.throwIfAborted();
			if (isEnoent(error)) continue;
			throw error;
		}
		const patch = await captureRepoDeltaPatch(nestedDir, nb, limits, signal, observer);
		if (patch.trim()) nestedPatches.push({ relativePath, patch });
	}

	return { rootPatch, nestedPatches };
}

export interface IsolatedPatchCaptureOptions {
	readonly isolationDir: string;
	readonly baseline: WorktreeBaseline;
	readonly artifactsDir: string;
	readonly agentId: string;
	readonly signal?: AbortSignal;
}

export type IsolatedPatchCaptureResult =
	| { readonly ok: true; readonly patchPath: string; readonly nestedPatches: NestedRepoPatch[] }
	| { readonly ok: false; readonly error: string; readonly aborted: boolean };

/** Capture one successful isolated task without ever treating exclusions as an empty delta. */
export async function captureIsolatedPatchResult(
	options: IsolatedPatchCaptureOptions,
): Promise<IsolatedPatchCaptureResult> {
	let artifact: fs.FileHandle | undefined;
	let ownedPatchPath: string | undefined;
	try {
		const delta = await captureDeltaPatch(options.isolationDir, options.baseline, undefined, options.signal);
		options.signal?.throwIfAborted();
		const patchPath = path.join(options.artifactsDir, `${options.agentId}.patch`);
		artifact = await fs.open(patchPath, "wx", PRIVATE_FILE_MODE);
		ownedPatchPath = patchPath;
		await artifact.chmod(PRIVATE_FILE_MODE);
		await artifact.writeFile(delta.rootPatch, { signal: options.signal });
		options.signal?.throwIfAborted();
		await artifact.close();
		artifact = undefined;
		return { ok: true, patchPath, nestedPatches: delta.nestedPatches };
	} catch (error) {
		if (artifact) {
			await artifact.close().catch(() => {});
		}
		if (ownedPatchPath) {
			await fs.rm(ownedPatchPath, { force: true });
		}
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			error: `Patch capture failed: ${message}`,
			aborted: options.signal?.aborted ?? false,
		};
	}
}

export interface RootPatchApplyResult {
	readonly applied: boolean;
	readonly hadChanges: boolean;
	readonly commitPointCrossed: boolean;
	readonly lateAbort: boolean;
	readonly error?: string;
}

export interface NestedRepoApplyStatus {
	readonly relativePath: string;
	readonly applied: boolean;
	readonly committed: boolean;
	readonly commitPointCrossed: boolean;
	readonly error?: string;
}

export interface NestedPatchesApplyResult {
	readonly repos: NestedRepoApplyStatus[];
	readonly completed: boolean;
	readonly commitPointCrossed: boolean;
	readonly lateAbort: boolean;
}

export interface TaskPatchesApplyResult {
	readonly root: RootPatchApplyResult | null;
	readonly nested: NestedPatchesApplyResult;
	readonly changesApplied: boolean;
	readonly hadChanges: boolean;
	readonly commitPointCrossed: boolean;
	readonly lateAbort: boolean;
}

function normalizedPatch(patchText: string): string {
	return patchText.endsWith("\n") ? patchText : `${patchText}\n`;
}

/**
 * Apply one root patch under the canonical repository write lease.
 *
 * Cancellation is actionable through the final can-apply check. The following
 * signal check is the explicit commit point: once crossed, apply runs without
 * the task signal and its outcome is reported honestly even if cancellation
 * arrives while git is mutating the worktree.
 */
export async function applyRootPatch(
	repoRoot: string,
	patchText: string,
	signal?: AbortSignal,
	observer?: WorktreeOperationObserver,
): Promise<RootPatchApplyResult> {
	if (!patchText.trim()) {
		return { applied: true, hadChanges: false, commitPointCrossed: false, lateAbort: false };
	}
	const patch = normalizedPatch(patchText);
	return git.withRepoLock(
		repoRoot,
		async () => {
			signal?.throwIfAborted();
			const canApply = await git.patch.canApplyText(repoRoot, patch, { signal });
			signal?.throwIfAborted();
			if (!canApply) {
				return {
					applied: false,
					hadChanges: false,
					commitPointCrossed: false,
					lateAbort: false,
					error: "Patch does not apply cleanly.",
				};
			}

			// COMMIT POINT: no task AbortSignal may reach mutation or cleanup below.
			signal?.throwIfAborted();
			await observeCommitPoint(observer, "root-apply", repoRoot);
			try {
				await git.patch.applyText(repoRoot, patch);
				return {
					applied: true,
					hadChanges: true,
					commitPointCrossed: true,
					lateAbort: signal?.aborted ?? false,
				};
			} catch (error) {
				return {
					applied: false,
					hadChanges: false,
					commitPointCrossed: true,
					lateAbort: signal?.aborted ?? false,
					error: errorMessage(error),
				};
			}
		},
		signal,
	);
}

/**
 * Apply and commit nested repositories in deterministic path order.
 *
 * Each repository has its own lease and commit point. Once any repository
 * crosses that point, cancellation is late for the whole patch set: remaining
 * nested repositories complete without the task signal, preventing a
 * cancellation-only partial state. Non-cancellation failures stop sequencing
 * and are returned with the exact repositories already applied.
 */
export async function applyNestedPatches(
	repoRoot: string,
	patches: readonly NestedRepoPatch[],
	commitMessage?: (diff: string) => Promise<string | null>,
	signal?: AbortSignal,
	observer?: WorktreeOperationObserver,
): Promise<NestedPatchesApplyResult> {
	signal?.throwIfAborted();
	const byRepo = new Map<string, string[]>();
	for (const patch of patches) {
		signal?.throwIfAborted();
		if (!patch.patch.trim()) continue;
		const group = byRepo.get(patch.relativePath);
		if (group) group.push(patch.patch);
		else byRepo.set(patch.relativePath, [patch.patch]);
	}

	// Sequence the transactions in path order rather than in the order the
	// patches arrived. Which repositories precede a failure is part of the
	// reported partial result, so it must not depend on how the caller
	// collected the patches or on directory-entry order during discovery.
	const ordered = [...byRepo].sort(([left], [right]) => compareRelativePaths(left, right));
	const repos: NestedRepoApplyStatus[] = [];
	let commitPointCrossed = false;
	for (const [relativePath, repoPatches] of ordered) {
		const transactionSignal: AbortSignal | undefined = commitPointCrossed ? undefined : signal;
		transactionSignal?.throwIfAborted();
		const nestedDir = path.join(repoRoot, relativePath);
		try {
			await fs.access(path.join(nestedDir, ".git"));
		} catch (error) {
			if (transactionSignal?.aborted) transactionSignal.throwIfAborted();
			repos.push({
				relativePath,
				applied: false,
				committed: false,
				commitPointCrossed: false,
				error: isEnoent(error) ? "Nested repository is missing." : errorMessage(error),
			});
			break;
		}

		let status: NestedRepoApplyStatus;
		try {
			const combinedDiff = repoPatches.map(normalizedPatch).join("\n");
			const message = (await commitMessage?.(combinedDiff)) ?? "changes from isolated task(s)";
			transactionSignal?.throwIfAborted();
			status = await git.withRepoLock(
				nestedDir,
				async (): Promise<NestedRepoApplyStatus> => {
					transactionSignal?.throwIfAborted();
					const canApply = await git.patch.canApplyText(nestedDir, combinedDiff, { signal: transactionSignal });
					transactionSignal?.throwIfAborted();
					if (!canApply) {
						return {
							relativePath,
							applied: false,
							committed: false,
							commitPointCrossed: false,
							error: "Nested patch does not apply cleanly.",
						};
					}

					// COMMIT POINT: apply, stage, commit, and their cleanup are noncancellable.
					transactionSignal?.throwIfAborted();
					await observeCommitPoint(observer, "nested-apply", nestedDir);
					let applied = false;
					try {
						await git.patch.applyText(nestedDir, combinedDiff);
						applied = true;
						if ((await git.status(nestedDir)).trim().length > 0) {
							await git.stage.files(nestedDir);
							await git.commit(nestedDir, message);
						}
						return {
							relativePath,
							applied: true,
							committed: true,
							commitPointCrossed: true,
						};
					} catch (error) {
						return {
							relativePath,
							applied,
							committed: false,
							commitPointCrossed: true,
							error: errorMessage(error),
						};
					}
				},
				transactionSignal,
			);
		} catch (error) {
			// Message generation and lease acquisition both run before this
			// repository's commit point, so this repository was not mutated. While
			// no commit point has been crossed the caller must still see the raw
			// failure — that is the zero-mutation cancellation path. Once one has
			// been crossed, throwing would erase the record of what already landed,
			// so the failure becomes the last entry of a truthful partial result.
			if (!commitPointCrossed) throw error;
			repos.push({
				relativePath,
				applied: false,
				committed: false,
				commitPointCrossed: false,
				error: errorMessage(error),
			});
			break;
		}
		repos.push(status);
		commitPointCrossed ||= status.commitPointCrossed;
		if (status.error) break;
	}

	return {
		repos,
		completed: repos.every(status => !status.error) && repos.length === byRepo.size,
		commitPointCrossed,
		lateAbort: commitPointCrossed && (signal?.aborted ?? false),
	};
}

/** Apply nested repositories before the root so non-atomic failures are exact and visible. */
export async function applyTaskPatches(
	repoRoot: string,
	rootPatch: string,
	nestedPatches: readonly NestedRepoPatch[],
	commitMessage?: (diff: string) => Promise<string | null>,
	signal?: AbortSignal,
	observer?: WorktreeOperationObserver,
): Promise<TaskPatchesApplyResult> {
	const nested = await applyNestedPatches(repoRoot, nestedPatches, commitMessage, signal, observer);
	if (!nested.completed) {
		return {
			root: null,
			nested,
			changesApplied: false,
			hadChanges: nested.repos.some(status => status.applied),
			commitPointCrossed: nested.commitPointCrossed,
			lateAbort: nested.lateAbort,
		};
	}

	const root = await applyRootPatch(repoRoot, rootPatch, nested.commitPointCrossed ? undefined : signal, observer);
	const commitPointCrossed = nested.commitPointCrossed || root.commitPointCrossed;
	return {
		root,
		nested,
		changesApplied: root.applied,
		hadChanges: root.hadChanges || nested.repos.some(status => status.applied),
		commitPointCrossed,
		lateAbort: nested.lateAbort || root.lateAbort || (commitPointCrossed && (signal?.aborted ?? false)),
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// Unified isolation lifecycle — picks the best backend via the PAL and
// returns the merged-view path together with the resolved kind.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * User-facing isolation mode names exposed by the `task.isolation.mode`
 * setting. Mapped to a backend-kind hint via {@link parseIsolationMode};
 * the PAL's `iso_resolve` then falls back through the kind order
 * whenever the hint isn't available on the current host.
 */
export type TaskIsolationMode =
	| "none"
	| "auto"
	| "apfs"
	| "btrfs"
	| "zfs"
	| "reflink"
	| "overlayfs"
	| "projfs"
	| "block-clone"
	| "rcopy"
	// Legacy values, accepted for back-compat with pre-PAL settings files.
	| "worktree"
	| "fuse-overlay"
	| "fuse-projfs";

/**
 * Translate a {@link TaskIsolationMode} string to an [`IsoBackendKind`]
 * the PAL can act on. `"none"` returns `null` (caller skips isolation
 * entirely); `"auto"` returns `undefined` (no hint — let the resolver
 * pick). Anything else returns the matching kind.
 */
export function parseIsolationMode(mode: TaskIsolationMode): IsoBackendKind | undefined {
	switch (mode) {
		case "none":
		case "auto":
			return undefined;
		case "apfs":
			return IsoBackendKind.Apfs;
		case "btrfs":
			return IsoBackendKind.Btrfs;
		case "zfs":
			return IsoBackendKind.Zfs;
		case "reflink":
			return IsoBackendKind.LinuxReflink;
		case "overlayfs":
		case "fuse-overlay":
			return IsoBackendKind.Overlayfs;
		case "projfs":
		case "fuse-projfs":
			return IsoBackendKind.Projfs;
		case "block-clone":
			return IsoBackendKind.WindowsBlockClone;
		case "rcopy":
		case "worktree":
			return IsoBackendKind.Rcopy;
	}
}

export interface IsolationHandle {
	/** Merged view materialised by the backend; pass this to the task. */
	mergedDir: string;
	/** Backend the PAL actually used. */
	backend: IsoBackendKind;
	/** True when the resolver downgraded from `preferred` to `backend`. */
	fellBack: boolean;
	/** Optional reason associated with `fellBack`. */
	fallbackReason: string | null;
}

/**
 * Materialise `merged` for a single task. `preferred` is a hint — when
 * its prerequisites are missing the PAL silently falls back, and the
 * caller learns about that through `IsolationHandle.fellBack` +
 * `fallbackReason`.
 */

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export async function ensureIsolation(
	baseCwd: string,
	id: string,
	preferred?: IsoBackendKind,
): Promise<IsolationHandle> {
	const repoRoot = await getRepoRoot(baseCwd);
	const baseDir = getWorktreeDir(`${id}-${hashPath(repoRoot)}`);
	const mergedDir = path.join(baseDir, "merged");

	const resolution = natives.isoResolve(preferred ?? null);
	const candidates = resolution.candidates.length > 0 ? resolution.candidates : [resolution.kind];
	let fallbackReason = resolution.reason ?? null;

	for (const candidate of candidates) {
		await fs.rm(baseDir, { recursive: true, force: true });
		try {
			await natives.isoStart(candidate, repoRoot, mergedDir);
			return {
				mergedDir,
				backend: candidate,
				fellBack: candidate !== resolution.kind || resolution.fellBack,
				fallbackReason,
			};
		} catch (err) {
			await fs.rm(baseDir, { recursive: true, force: true });
			const message = errorMessage(err);
			if (!natives.isoIsUnavailableError(message)) {
				throw err;
			}
			fallbackReason ??= message;
		}
	}

	throw new Error(fallbackReason ?? "No isolation backend is available.");
}

/** Tear down a handle returned by {@link ensureIsolation}. */
export async function cleanupIsolation(handle: IsolationHandle): Promise<void> {
	try {
		try {
			await natives.isoStop(handle.backend, handle.mergedDir);
		} catch (err) {
			logger.warn("isolation backend stop failed during cleanup", {
				backend: handle.backend,
				mergedDir: handle.mergedDir,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	} finally {
		// baseDir is the parent of the merged directory
		const baseDir = path.dirname(handle.mergedDir);
		await fs.rm(baseDir, { recursive: true, force: true });
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Branch-mode isolation
// ═══════════════════════════════════════════════════════════════════════════

export interface TaskBranchToken {
	readonly branchName: string;
	readonly commitSha: string;
	readonly ownershipId: string;
}

export interface CommitToBranchResult {
	readonly branch?: TaskBranchToken;
	readonly nestedPatches: NestedRepoPatch[];
	readonly cleanupErrors: string[];
	readonly commitPointCrossed: boolean;
	readonly lateAbort: boolean;
}

/** Outcome of retiring this invocation's temporary worktree. */
interface OwnedWorktreeCleanup {
	/** Proven gone: no longer registered with git and no longer present on disk. */
	readonly removed: boolean;
	readonly errors: string[];
}

/**
 * `git worktree list` reports the path git canonicalised when the worktree was
 * added, so on macOS (`/var` → `/private/var`) a plain `path.resolve`
 * comparison reports a still-registered worktree as gone. Canonicalise the
 * leaf while it survives and its parent once it does not, so the comparison
 * holds on both sides of the removal.
 */
async function canonicalWorktreePath(target: string): Promise<string> {
	const resolved = path.resolve(target);
	try {
		return await fs.realpath(resolved);
	} catch {
		try {
			return path.join(await fs.realpath(path.dirname(resolved)), path.basename(resolved));
		} catch {
			return resolved;
		}
	}
}

/**
 * Retire this invocation's temporary worktree. Never throws.
 *
 * Every step is attempted regardless of what the previous one did — a failed
 * `git worktree remove` must not skip the directory removal, and a failed
 * directory removal must not skip the prune. Each failure becomes a returned
 * string so the caller can finish the rest of its cleanup and still report a
 * landed result.
 *
 * `removed` is never inferred from the absence of an error. Both the
 * registration and the directory are re-read afterwards, because the caller
 * spends that answer deciding whether deleting the branch would strand a live
 * worktree on a ref that no longer exists.
 */
async function cleanupOwnedWorktree(repoRoot: string, worktreePath: string): Promise<OwnedWorktreeCleanup> {
	const errors: string[] = [];
	let removeFailed = false;
	let directoryReported = false;
	try {
		removeFailed = !(await git.worktree.tryRemove(repoRoot, worktreePath));
	} catch {
		removeFailed = true;
	}
	try {
		await fs.rm(worktreePath, { recursive: true, force: true });
	} catch (error) {
		removeFailed = true;
		directoryReported = true;
		errors.push(`Temporary worktree directory could not be removed: ${worktreePath}: ${errorMessage(error)}`);
	}
	if (removeFailed) {
		try {
			await git.worktree.prune(repoRoot);
		} catch (error) {
			errors.push(`Temporary worktree prune failed for ${worktreePath}: ${errorMessage(error)}`);
		}
	}

	let removed = true;
	try {
		const target = await canonicalWorktreePath(worktreePath);
		const entries = await git.worktree.list(repoRoot);
		const registered = await Promise.all(entries.map(entry => canonicalWorktreePath(entry.path)));
		if (registered.includes(target)) {
			removed = false;
			errors.push(`Temporary worktree remains registered: ${worktreePath}`);
		}
	} catch (error) {
		removed = false;
		errors.push(`Temporary worktree registration could not be verified for ${worktreePath}: ${errorMessage(error)}`);
	}
	try {
		await fs.stat(worktreePath);
		removed = false;
		if (!directoryReported) errors.push(`Temporary worktree directory remains: ${worktreePath}`);
	} catch (error) {
		if (!isEnoent(error)) {
			removed = false;
			errors.push(`Temporary worktree directory could not be verified: ${worktreePath}: ${errorMessage(error)}`);
		}
	}
	return { removed, errors };
}

/**
 * Compare-and-delete one owned ref against the sha this invocation proved it
 * owns. Never throws: a Git or I/O failure is classified, not propagated, so
 * cleanup of the remaining artifacts always runs.
 */
async function deleteOwnedRef(
	repoRoot: string,
	branchName: string,
	expectedSha: string,
): Promise<git.RefDeleteOutcome> {
	try {
		return await git.ref.deleteExact(repoRoot, `refs/heads/${branchName}`, expectedSha);
	} catch (error) {
		return { kind: "failed", detail: errorMessage(error) };
	}
}

/**
 * Ref names a registered worktree currently has checked out.
 *
 * `git update-ref` deliberately bypasses `git branch -D`'s checked-out
 * refusal, so this list is the only thing keeping cleanup from deleting a ref
 * out from under a live worktree. A list that cannot be read blocks deletion
 * rather than permitting it: not seeing a worktree is not proof there is none.
 */
async function checkedOutRefs(repoRoot: string): Promise<{ refs: ReadonlySet<string> } | { error: string }> {
	try {
		const refs = new Set<string>();
		for (const entry of await git.worktree.list(repoRoot)) {
			if (entry.branch) refs.add(entry.branch);
		}
		return { refs };
	} catch (error) {
		return { error: errorMessage(error) };
	}
}

/**
 * Delete each owned ref at exactly its token commit. Never throws; every
 * branch is attempted even when an earlier one fails.
 */
async function cleanupOwnedBranchesUnlocked(repoRoot: string, branches: readonly TaskBranchToken[]): Promise<string[]> {
	const errors: string[] = [];
	if (branches.length === 0) return errors;
	const checkedOut = await checkedOutRefs(repoRoot);
	for (const branch of branches) {
		if ("error" in checkedOut) {
			errors.push(
				`Refusing to delete ${branch.branchName}: registered worktrees could not be listed (${checkedOut.error}), ` +
					`so this cannot prove no worktree still has it checked out.`,
			);
			continue;
		}
		if (checkedOut.refs.has(`refs/heads/${branch.branchName}`)) {
			errors.push(
				`Refusing to delete ${branch.branchName}: a registered worktree still has it checked out, ` +
					`and deleting the ref would strand that worktree.`,
			);
			continue;
		}
		const outcome = await deleteOwnedRef(repoRoot, branch.branchName, branch.commitSha);
		if (outcome.kind === "mismatch") {
			errors.push(
				`Refusing to delete ${branch.branchName}: owned commit changed from ${branch.commitSha} to ${outcome.actual}.`,
			);
		} else if (outcome.kind === "symbolic") {
			errors.push(
				`Refusing to delete ${branch.branchName}: it is now a symbolic ref to ${outcome.target}, ` +
					`not the owned commit ${branch.commitSha}.`,
			);
		} else if (outcome.kind === "failed") {
			errors.push(`Failed to delete owned task branch ${branch.branchName}: ${outcome.detail}`);
		}
	}
	return errors;
}

/**
 * Commit task-only changes to an invocation-unique owned branch.
 *
 * Message generation and cancellation happen before the repository lease.
 * After the explicit commit point, branch/worktree/apply/stage/commit and
 * cleanup are deliberately noncancellable. The returned token binds cleanup
 * to both the unique ref name and its exact commit.
 */
export async function commitToBranch(
	isolationDir: string,
	baseline: WorktreeBaseline,
	taskId: string,
	description: string | undefined,
	commitMessage?: (diff: string) => Promise<string | null>,
	signal?: AbortSignal,
	observer?: WorktreeOperationObserver,
): Promise<CommitToBranchResult | null> {
	signal?.throwIfAborted();
	const { rootPatch, nestedPatches } = await captureDeltaPatch(
		isolationDir,
		baseline,
		DEFAULT_BASELINE_LIMITS,
		signal,
		observer,
	);
	signal?.throwIfAborted();
	if (!rootPatch.trim() && nestedPatches.length === 0) return null;
	if (!rootPatch.trim()) {
		return {
			nestedPatches,
			cleanupErrors: [],
			commitPointCrossed: false,
			lateAbort: false,
		};
	}

	const repoRoot = baseline.root.repoRoot;
	const ownershipId = Snowflake.next();
	const branchName = `omp/task/${taskId}-${ownershipId}`;
	const worktreePath = path.join(os.tmpdir(), `omp-branch-${ownershipId}`);
	const message = (await commitMessage?.(rootPatch)) ?? description ?? taskId;
	signal?.throwIfAborted();

	return git.withRepoLock(
		repoRoot,
		async () => {
			const startSha = await git.head.sha(repoRoot, signal);
			signal?.throwIfAborted();
			if (!startSha) throw new Error(`Cannot create task branch without HEAD for ${repoRoot}`);

			// COMMIT POINT: branch mutation and ownership cleanup are noncancellable.
			signal?.throwIfAborted();
			await observeCommitPoint(observer, "branch-capture", repoRoot);
			let branchCreated = false;
			let worktreeStarted = false;
			let branch: TaskBranchToken | undefined;
			let operationError: unknown;
			const cleanupErrors: string[] = [];
			try {
				await git.branch.create(repoRoot, branchName, startSha);
				branchCreated = true;
				worktreeStarted = true;
				await git.worktree.add(repoRoot, worktreePath, branchName);
				try {
					await git.patch.applyText(worktreePath, rootPatch);
				} catch (error) {
					if (error instanceof git.GitCommandError) {
						const stderr = error.result.stderr.slice(0, 2000);
						logger.error("commitToBranch: git apply failed", {
							taskId,
							exitCode: error.result.exitCode,
							stderr,
							patchSize: rootPatch.length,
							patchHead: rootPatch.slice(0, 500),
						});
						throw new Error(`git apply failed for task ${taskId}: ${stderr}`);
					}
					throw error;
				}
				await git.stage.files(worktreePath);
				await git.commit(worktreePath, message);
				const commitSha = await git.head.sha(worktreePath);
				if (!commitSha) throw new Error(`Task branch ${branchName} has no commit after commit.`);
				branch = { branchName, commitSha, ownershipId };
			} catch (error) {
				operationError = error;
			} finally {
				let worktreeRemoved = true;
				if (worktreeStarted) {
					const cleanup = await cleanupOwnedWorktree(repoRoot, worktreePath);
					worktreeRemoved = cleanup.removed;
					cleanupErrors.push(...cleanup.errors);
				}
				if (branchCreated && !branch) {
					if (!worktreeRemoved) {
						// `git update-ref -d` does not refuse a ref a linked worktree has
						// checked out, so deleting now would strand the worktree this
						// invocation just failed to retire on a ref that no longer exists.
						cleanupErrors.push(
							`Task branch ${branchName} is retained for manual cleanup: its temporary worktree ` +
								`${worktreePath} could not be retired, and deleting a ref a registered worktree ` +
								`has checked out would strand it.`,
						);
					} else {
						// `git branch <name> <start>` fails when the ref already exists, so a
						// successful create proves this invocation owns this unique ref name
						// at exactly `startSha`. That is the only sha this path can prove:
						// once the ref has moved, our own landed commit and a user's
						// force-move are indistinguishable from here, and re-reading the ref
						// to build a token would authorise deleting whatever a third party
						// just wrote. So compare-and-delete against `startSha` and, on
						// mismatch, retain the ref and say so.
						const outcome = await deleteOwnedRef(repoRoot, branchName, startSha);
						if (outcome.kind === "mismatch") {
							cleanupErrors.push(
								`Task branch ${branchName} was created at ${startSha} but now points at ${outcome.actual}; ` +
									`this invocation cannot prove it owns that commit, so the branch is retained for manual cleanup.`,
							);
						} else if (outcome.kind === "symbolic") {
							cleanupErrors.push(
								`Task branch ${branchName} was created at ${startSha} but is now a symbolic ref to ` +
									`${outcome.target}; this invocation cannot prove it owns that ref, so the branch is ` +
									`retained for manual cleanup.`,
							);
						} else if (outcome.kind === "failed") {
							cleanupErrors.push(`Failed to clean up partially created branch ${branchName}: ${outcome.detail}`);
						}
					}
				}
			}

			if (operationError) {
				const cleanup = cleanupErrors.length > 0 ? ` Cleanup: ${cleanupErrors.join(" ")}` : "";
				throw new Error(`${errorMessage(operationError)}${cleanup}`, { cause: operationError });
			}
			return {
				branch,
				nestedPatches,
				cleanupErrors,
				commitPointCrossed: true,
				lateAbort: signal?.aborted ?? false,
			};
		},
		signal,
	);
}

export interface MergeBranchResult {
	readonly merged: string[];
	readonly failed: string[];
	readonly conflict?: string;
	/** Set when commits landed but restoring the stashed working tree failed. */
	readonly stashConflict?: string;
	readonly cleanupErrors: string[];
	readonly commitPointCrossed: boolean;
	readonly lateAbort: boolean;
}

/**
 * Cherry-pick owned task commits sequentially under the canonical repo lease.
 * Cancellation is checked immediately before the explicit commit point. After
 * it, stash/cherry-pick/abort/pop/owned-branch cleanup never receive the task
 * signal. Successful commits are never hard-reset on late cancellation.
 */
export async function mergeTaskBranches(
	repoRoot: string,
	branches: readonly TaskBranchToken[],
	signal?: AbortSignal,
	observer?: WorktreeOperationObserver,
): Promise<MergeBranchResult> {
	signal?.throwIfAborted();
	if (branches.length === 0) {
		return {
			merged: [],
			failed: [],
			cleanupErrors: [],
			commitPointCrossed: false,
			lateAbort: false,
		};
	}

	return git.withRepoLock(
		repoRoot,
		async () => {
			for (const branch of branches) {
				const current = await git.ref.resolve(repoRoot, `refs/heads/${branch.branchName}`, signal);
				signal?.throwIfAborted();
				if (current !== branch.commitSha) {
					return {
						merged: [],
						failed: branches.map(candidate => candidate.branchName),
						conflict: `${branch.branchName}: owned branch no longer points at ${branch.commitSha}`,
						cleanupErrors: [],
						commitPointCrossed: false,
						lateAbort: false,
					};
				}
			}

			// COMMIT POINT: all repository mutations and cleanup below are noncancellable.
			signal?.throwIfAborted();
			await observeCommitPoint(observer, "branch-merge", repoRoot);
			const merged: string[] = [];
			const failed: string[] = [];
			const mergedTokens: TaskBranchToken[] = [];
			const cleanupErrors: string[] = [];
			let conflict: string | undefined;
			let stashConflict: string | undefined;
			let didStash = false;
			try {
				didStash = await git.stash.push(repoRoot, "omp-task-merge");
				for (const branch of branches) {
					try {
						await git.cherryPick(repoRoot, branch.commitSha);
						merged.push(branch.branchName);
						mergedTokens.push(branch);
					} catch (error) {
						try {
							await git.cherryPick.abort(repoRoot);
						} catch {
							// No in-progress cherry-pick.
						}
						failed.push(
							branch.branchName,
							...branches.slice(merged.length + failed.length + 1).map(candidate => candidate.branchName),
						);
						const detail =
							error instanceof git.GitCommandError ? error.result.stderr.trim() : errorMessage(error);
						conflict = `${branch.branchName}: ${detail}`;
						break;
					}
				}
			} finally {
				if (didStash) {
					try {
						await git.stash.pop(repoRoot, { index: true });
					} catch {
						logger.warn("Failed to restore stashed changes after task merge; stash entry preserved");
						stashConflict =
							"stash pop: cherry-picked changes conflict with uncommitted edits. The merged commits are on HEAD; run `git stash pop` and resolve manually.";
					}
				}
				// Total by contract: the cherry-picks above are already on HEAD, so a
				// ref or Git failure here is reported, never thrown. Rejecting would
				// turn a landed merge into a reported merge failure.
				cleanupErrors.push(...(await cleanupOwnedBranchesUnlocked(repoRoot, mergedTokens)));
			}

			return {
				merged,
				failed,
				...(conflict ? { conflict } : {}),
				...(stashConflict ? { stashConflict } : {}),
				cleanupErrors,
				commitPointCrossed: true,
				lateAbort: signal?.aborted ?? false,
			};
		},
		signal,
	);
}

/**
 * Delete each owned ref by atomic compare-and-delete against its token commit.
 * Noncancellable, and never throws: refs it cannot prove it owns are reported.
 */
export async function cleanupTaskBranches(repoRoot: string, branches: readonly TaskBranchToken[]): Promise<string[]> {
	return git.withRepoLock(repoRoot, () => cleanupOwnedBranchesUnlocked(repoRoot, branches));
}
