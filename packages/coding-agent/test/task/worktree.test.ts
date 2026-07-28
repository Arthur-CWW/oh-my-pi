import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	applyNestedPatches,
	applyRootPatch,
	applyTaskPatches,
	type BaselineLimits,
	CurrentSnapshotExclusionError,
	captureBaseline,
	captureDeltaPatch,
	cleanupTaskBranches,
	commitToBranch,
	DEFAULT_BASELINE_LIMITS,
	ensureIsolation,
	getGitNoIndexNullPath,
	mergeTaskBranches,
	parseIsolationMode,
	releaseBaseline,
} from "@oh-my-pi/pi-coding-agent/task/worktree";
import * as git from "@oh-my-pi/pi-coding-agent/utils/git";
import * as natives from "@oh-my-pi/pi-natives";

async function runGit(repo: string, args: string[]): Promise<string> {
	const proc = Bun.spawn(["git", ...args], {
		cwd: repo,
		stderr: "pipe",
		stdout: "pipe",
		windowsHide: true,
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if ((exitCode ?? 0) !== 0) {
		throw new Error(stderr.trim() || stdout.trim() || `git ${args.join(" ")} failed with exit code ${exitCode ?? 0}`);
	}
	return stdout.trim();
}

const GIT_SOURCE_URL = new URL("../../src/utils/git.ts", import.meta.url).href;
const WORKTREE_SOURCE_URL = new URL("../../src/task/worktree.ts", import.meta.url).href;

interface ExternalGitOptions {
	readonly failApply?: boolean;
}

/**
 * Run a child against a real Git shim without changing this test process's
 * PATH. Only `worktree list --porcelain` is synthetic: it emits a valid entry,
 * then more than the production stdout cap before the real list. The real
 * entries therefore exist beyond the retained prefix.
 */
async function runWithOverflowingGit(
	program: string,
	args: readonly string[],
	options: ExternalGitOptions = {},
): Promise<string> {
	const realGit = Bun.which("git");
	if (!realGit) throw new Error("git is not installed");
	const shimRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-git-overflow-"));
	const shimPath = path.join(shimRoot, "git");
	try {
		await fs.writeFile(
			shimPath,
			`#!/bin/sh
set -eu
saw_worktree=0
saw_list=0
saw_porcelain=0
saw_apply=0
for argument in "$@"; do
	case "$argument" in
		worktree) saw_worktree=1 ;;
		list) saw_list=1 ;;
		--porcelain) saw_porcelain=1 ;;
		apply) saw_apply=1 ;;
	esac
done
if [ "\${OMP_TEST_FAIL_APPLY:-}" = "1" ] && [ "$saw_apply" = "1" ]; then
	case "$PWD" in
		*/omp-branch-*)
			printf '%s\\n' 'controlled git apply failure' >&2
			exit 1
			;;
	esac
fi
if [ "$saw_worktree" = "1" ] && [ "$saw_list" = "1" ] && [ "$saw_porcelain" = "1" ]; then
	printf '%s\\n' 'worktree /controlled-overflow' 'HEAD 0000000000000000000000000000000000000000' 'detached'
	printf 'padding '
	dd if=/dev/zero bs=1048576 count=9 2>/dev/null | tr '\\000' x
	printf '\\n\\n'
fi
exec "$OMP_TEST_REAL_GIT" "$@"
`,
			{ mode: 0o755 },
		);
		const child = Bun.spawn([process.execPath, "-e", program, ...args], {
			cwd: path.resolve(import.meta.dir, "../.."),
			env: {
				...process.env,
				PATH: `${shimRoot}${path.delimiter}${process.env.PATH ?? ""}`,
				OMP_TEST_REAL_GIT: realGit,
				...(options.failApply ? { OMP_TEST_FAIL_APPLY: "1" } : {}),
			},
			stderr: "pipe",
			stdout: "pipe",
			windowsHide: true,
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		if ((exitCode ?? 0) !== 0) {
			throw new Error(stderr.trim() || stdout.trim() || `overflow child exited ${exitCode ?? 0}`);
		}
		return stdout;
	} finally {
		await fs.rm(shimRoot, { recursive: true, force: true });
	}
}

describe("worktree isolation helpers", () => {
	it("returns platform-specific null path for git --no-index diffs", () => {
		const expected = process.platform === "win32" ? "NUL" : "/dev/null";
		expect(getGitNoIndexNullPath()).toBe(expected);
	});

	it("maps every isolation mode to the native backend contract", () => {
		expect(parseIsolationMode("none")).toBeUndefined();
		expect(parseIsolationMode("auto")).toBeUndefined();
		expect(parseIsolationMode("apfs")).toBe(natives.IsoBackendKind.Apfs);
		expect(parseIsolationMode("btrfs")).toBe(natives.IsoBackendKind.Btrfs);
		expect(parseIsolationMode("zfs")).toBe(natives.IsoBackendKind.Zfs);
		expect(parseIsolationMode("reflink")).toBe(natives.IsoBackendKind.LinuxReflink);
		expect(parseIsolationMode("overlayfs")).toBe(natives.IsoBackendKind.Overlayfs);
		expect(parseIsolationMode("fuse-overlay")).toBe(natives.IsoBackendKind.Overlayfs);
		expect(parseIsolationMode("projfs")).toBe(natives.IsoBackendKind.Projfs);
		expect(parseIsolationMode("fuse-projfs")).toBe(natives.IsoBackendKind.Projfs);
		expect(parseIsolationMode("block-clone")).toBe(natives.IsoBackendKind.WindowsBlockClone);
		expect(parseIsolationMode("rcopy")).toBe(natives.IsoBackendKind.Rcopy);
		expect(parseIsolationMode("worktree")).toBe(natives.IsoBackendKind.Rcopy);
	});

	// Real git worktree/stash/merge I/O is the contract under test and cannot be
	// faked. One initialized fixture repo is built once in `beforeAll` (whose time
	// is excluded from per-test body time) and shared: the costly `git init`,
	// initial commit, and one mergeable owned branch are set up there. Successful
	// merge cleanup deletes that branch, so only one test consumes it.
	// Tests that rewind the fixture do so with a cheap `reset --hard`.
	describe("git-backed worktree helpers", () => {
		const BASE_BRANCH = "main";
		const TASK_BRANCH = "task/merge-staged";
		let repo: string;
		let initialSha: string;
		let taskSha: string;

		beforeAll(async () => {
			repo = await fs.mkdtemp(path.join(os.tmpdir(), "omp-worktree-"));
			await runGit(repo, ["init", "-q", "-b", BASE_BRANCH]);
			await runGit(repo, ["config", "user.email", "test@example.com"]);
			await runGit(repo, ["config", "user.name", "Test User"]);
			await runGit(repo, ["config", "core.pager", ""]);
			await runGit(repo, ["config", "diff.external", ""]);
			await Promise.all([
				fs.writeFile(path.join(repo, "merged.txt"), "base version\n"),
				fs.writeFile(path.join(repo, "staged.txt"), "base staged\n"),
			]);
			await runGit(repo, ["add", "."]);
			await runGit(repo, ["commit", "-q", "-m", "initial"]);
			initialSha = await runGit(repo, ["rev-parse", "HEAD"]);

			// Owned fixture branch with a single mergeable commit. The successful
			// merge test consumes it and proves ownership cleanup.
			await runGit(repo, ["checkout", "-q", "-b", TASK_BRANCH]);
			await fs.writeFile(path.join(repo, "merged.txt"), "task branch change\n");
			await runGit(repo, ["commit", "-q", "-am", "task-change"]);
			taskSha = await runGit(repo, ["rev-parse", "HEAD"]);
			await runGit(repo, ["checkout", "-q", BASE_BRANCH]);
		});

		afterAll(async () => {
			await fs.rm(repo, { recursive: true, force: true });
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("retries isoResolve candidates when a backend is path-unavailable", async () => {
			const unavailable = new Error("ISO_UNAVAILABLE: btrfs source is not a subvolume");
			const isoResolve = vi.spyOn(natives, "isoResolve").mockReturnValue({
				kind: natives.IsoBackendKind.Btrfs,
				candidates: [natives.IsoBackendKind.Btrfs, natives.IsoBackendKind.Rcopy],
				fellBack: false,
				reason: undefined,
			});
			const isoStart = vi
				.spyOn(natives, "isoStart")
				.mockRejectedValueOnce(unavailable)
				.mockResolvedValueOnce(undefined);
			vi.spyOn(natives, "isoIsUnavailableError").mockImplementation(message =>
				message.startsWith("ISO_UNAVAILABLE:"),
			);

			const handle = await ensureIsolation(repo, "retry-path-unavailable");

			expect(isoResolve).toHaveBeenCalledWith(null);
			expect(isoStart.mock.calls.map(call => call[0])).toEqual([
				natives.IsoBackendKind.Btrfs,
				natives.IsoBackendKind.Rcopy,
			]);
			expect(handle.backend).toBe(natives.IsoBackendKind.Rcopy);
			expect(handle.fellBack).toBe(true);
			expect(handle.fallbackReason).toBe(unavailable.message);
		});

		// First mutator: runs on the pristine fixture, so no reset is needed. Leaves
		// behind a stash that the next test's reset clears.
		it("does not pop an unrelated pre-existing stash when the working tree is clean", async () => {
			// A tracked-file edit makes the cheapest possible "unrelated" stash; the
			// kind of stash is irrelevant — mergeTaskBranches must not pop one it did
			// not create. Stashing restores the working tree to clean.
			await fs.writeFile(path.join(repo, "merged.txt"), "unrelated user change\n");
			await runGit(repo, ["stash", "push", "-m", "preexisting-user-stash"]);

			const result = await mergeTaskBranches(repo, []);

			const [stashList, status] = await Promise.all([
				runGit(repo, ["stash", "list"]),
				runGit(repo, ["status", "--porcelain=v1"]),
			]);
			expect(result).toEqual({
				failed: [],
				merged: [],
				cleanupErrors: [],
				commitPointCrossed: false,
				lateAbort: false,
			});
			const stashEntries = stashList.split("\n").filter(Boolean);
			expect(stashEntries).toHaveLength(1);
			expect(stashEntries[0]).toContain("preexisting-user-stash");
			expect(status).toBe("");
		});

		// These rewind the fixture so each starts from the pristine post-`initial`
		// state: `reset --hard` restores HEAD + index + tracked files and the parallel
		// `stash clear` drops any leftover stash. No `git clean` is needed — none of
		// these tests leave untracked files behind (the baseline test commits its own).
		// The fixture branch is consumed by the merge test.
		describe("after rewinding the shared fixture", () => {
			beforeEach(async () => {
				await Promise.all([runGit(repo, ["reset", "-q", "--hard", initialSha]), runGit(repo, ["stash", "clear"])]);
			});

			it("restores staged changes with index preservation after merging task branches", async () => {
				await fs.writeFile(path.join(repo, "staged.txt"), "local staged change\n");
				await runGit(repo, ["add", "staged.txt"]);

				const result = await mergeTaskBranches(repo, [
					{ branchName: TASK_BRANCH, commitSha: taskSha, ownershipId: "fixture" },
				]);

				const [mergedContent, status, cached, stashList] = await Promise.all([
					fs.readFile(path.join(repo, "merged.txt"), "utf8"),
					runGit(repo, ["status", "--porcelain=v1"]),
					git.diff(repo, { cached: true, files: ["staged.txt"] }),
					runGit(repo, ["stash", "list"]),
				]);
				expect(result).toEqual({
					failed: [],
					merged: [TASK_BRANCH],
					cleanupErrors: [],
					commitPointCrossed: true,
					lateAbort: false,
				});
				expect(mergedContent).toBe("task branch change\n");
				expect(status).toBe("M  staged.txt");
				expect(cached).toContain("+local staged change");
				expect(stashList).toBe("");
			});

			it("subtracts baseline dirty state even when the task commits it", async () => {
				await Promise.all([
					fs.writeFile(path.join(repo, "merged.txt"), "baseline dirty change\n"),
					fs.writeFile(path.join(repo, "preexisting.txt"), "baseline untracked\n"),
				]);
				const baseline = await captureBaseline(repo);

				// The task produces new output and commits everything — baseline dirt
				// included. The delta must still subtract the baseline (both the tracked
				// edit and the untracked file) and surface only the task's own addition.
				await fs.writeFile(path.join(repo, "task.txt"), "task output\n");
				await runGit(repo, ["add", "-A"]);
				await runGit(repo, ["commit", "-q", "-m", "committed inside isolation"]);

				const delta = await captureDeltaPatch(repo, baseline);

				expect(delta.nestedPatches).toEqual([]);
				expect(delta.rootPatch).toContain("task.txt");
				expect(delta.rootPatch).toContain("+task output");
				expect(delta.rootPatch).not.toContain("baseline dirty change");
				expect(delta.rootPatch).not.toContain("preexisting.txt");
			});
		});
	});

	// Baseline capture runs in the coordinator process, so its cost must not scale
	// with how dirty the tree is. These prove the bounding rules by their
	// observable effects: what lands in the patch files, what is reported as
	// excluded, and that an excluded file never turns into a deletion in the delta.
	describe("bounded baseline capture", () => {
		const repos: string[] = [];

		async function initRepo(): Promise<string> {
			const repo = await fs.mkdtemp(path.join(os.tmpdir(), "omp-baseline-"));
			repos.push(repo);
			await runGit(repo, ["init", "-q", "-b", "main"]);
			await runGit(repo, ["config", "user.email", "test@example.com"]);
			await runGit(repo, ["config", "user.name", "Test User"]);
			await runGit(repo, ["config", "core.pager", ""]);
			await runGit(repo, ["config", "diff.external", ""]);
			await fs.writeFile(path.join(repo, "tracked.txt"), "base\n");
			await runGit(repo, ["add", "."]);
			await runGit(repo, ["commit", "-q", "-m", "initial"]);
			return repo;
		}

		/** The pre-bounding shape: every per-file `--no-index` diff joined in memory. */
		async function joinedUntrackedDiffs(repo: string, entries: readonly string[]): Promise<string> {
			const diffs: string[] = [];
			for (const entry of entries) {
				diffs.push(
					await git.diff(repo, {
						allowFailure: true,
						binary: true,
						noIndex: { left: getGitNoIndexNullPath(), right: entry },
					}),
				);
			}
			return diffs.filter(diff => !!diff.trim()).join("\n");
		}

		function limits(overrides: Partial<BaselineLimits>): BaselineLimits {
			return { ...DEFAULT_BASELINE_LIMITS, ...overrides };
		}

		async function writeSparseFile(filePath: string, bytes: number): Promise<void> {
			const file = await fs.open(filePath, "w");
			try {
				await file.truncate(bytes);
			} finally {
				await file.close();
			}
		}

		async function makeTrackedPatch(repo: string, content: string): Promise<string> {
			await fs.writeFile(path.join(repo, "tracked.txt"), content);
			const patch = await git.diff(repo, { binary: true });
			await runGit(repo, ["checkout", "--", "tracked.txt"]);
			return patch;
		}

		/** Current sha of a fully-qualified ref, or null when it does not exist. */
		async function refSha(repo: string, refName: string): Promise<string | null> {
			return (await runGit(repo, ["for-each-ref", "--format=%(objectname)", refName])) || null;
		}

		/** A nested repository with one committed `tracked.txt`. */
		async function initNested(repo: string, name: string): Promise<string> {
			const nested = path.join(repo, name);
			await fs.mkdir(nested);
			await runGit(nested, ["init", "-q", "-b", "main"]);
			await runGit(nested, ["config", "user.email", "test@example.com"]);
			await runGit(nested, ["config", "user.name", "Test User"]);
			await fs.writeFile(path.join(nested, "tracked.txt"), "base\n");
			await runGit(nested, ["add", "."]);
			await runGit(nested, ["commit", "-q", "-m", "initial"]);
			return nested;
		}

		afterAll(async () => {
			await Promise.all(repos.map(repo => fs.rm(repo, { recursive: true, force: true })));
		});

		it("writes every small-fixture patch to disk byte-for-byte like the old implementation", async () => {
			const repo = await initRepo();
			await Promise.all([
				fs.writeFile(path.join(repo, "a.txt"), "alpha\n"),
				fs.writeFile(path.join(repo, "b.txt"), "beta\nsecond line\n"),
				// A binary payload forces git's base85 literal encoding into the patch.
				fs.writeFile(path.join(repo, "c.bin"), Buffer.from([0, 1, 2, 253, 254, 255, 0, 7])),
				fs.writeFile(path.join(repo, "tracked.txt"), "staged\n"),
			]);
			await runGit(repo, ["add", "tracked.txt"]);
			await fs.writeFile(path.join(repo, "tracked.txt"), "unstaged\n");
			const [expectedStaged, expectedUnstaged] = await Promise.all([
				git.diff(repo, { binary: true, cached: true }),
				git.diff(repo, { binary: true }),
			]);

			const baseline = await captureBaseline(repo);
			const expectedUntracked = await joinedUntrackedDiffs(repo, baseline.root.untracked.captured);

			expect(baseline.root.untracked.captured).toEqual(["a.txt", "b.txt", "c.bin"]);
			expect(await Bun.file(baseline.root.stagedPatchPath!).text()).toBe(expectedStaged);
			expect(await Bun.file(baseline.root.unstagedPatchPath!).text()).toBe(expectedUnstaged);
			expect(await Bun.file(baseline.root.untracked.patchPath!).text()).toBe(expectedUntracked);
			expect(expectedUntracked).toContain("GIT binary patch");
			await releaseBaseline(baseline);
		});

		it("keeps diffs out of the returned object and frees the patch files on release", async () => {
			const repo = await initRepo();
			await fs.writeFile(path.join(repo, "tracked.txt"), "modified\n");
			await fs.writeFile(path.join(repo, "fresh.txt"), "new\n");

			const baseline = await captureBaseline(repo);
			const patchPaths = [baseline.root.unstagedPatchPath, baseline.root.untracked.patchPath];

			expect(patchPaths.every(entry => typeof entry === "string")).toBe(true);
			expect(JSON.stringify(baseline)).not.toContain("modified");
			for (const patchPath of patchPaths) {
				expect(await Bun.file(patchPath!).exists()).toBe(true);
				expect(patchPath!.startsWith(baseline.patchDir)).toBe(true);
			}

			await releaseBaseline(baseline);

			for (const patchPath of patchPaths) {
				expect(await Bun.file(patchPath!).exists()).toBe(false);
			}
		});

		it("excludes untracked files over the per-file limit and never deletes them in the delta", async () => {
			const repo = await initRepo();
			await Promise.all([
				fs.writeFile(path.join(repo, "big.bin"), Buffer.alloc(4096, 7)),
				fs.writeFile(path.join(repo, "small.txt"), "small\n"),
			]);
			const bounded = limits({ maxUntrackedFileBytes: 1024 });

			const baseline = await captureBaseline(repo, bounded);

			expect(baseline.root.untracked.captured).toEqual(["small.txt"]);
			expect(baseline.root.untracked.excluded).toEqual([{ path: "big.bin", bytes: 4096, reason: "file-too-large" }]);
			expect(baseline.root.untracked.excludedCount).toBe(1);
			expect(baseline.warnings).toHaveLength(1);
			expect(baseline.warnings[0]).toContain("big.bin");
			expect(await Bun.file(baseline.root.untracked.patchPath!).text()).not.toContain("big.bin");

			// The task adds its own file; the excluded baseline file must not show up
			// as a deletion just because the baseline never encoded it.
			await fs.writeFile(path.join(repo, "task.txt"), "task output\n");
			const delta = await captureDeltaPatch(repo, baseline, bounded);

			expect(delta.rootPatch).toContain("task.txt");
			expect(delta.rootPatch).not.toContain("big.bin");
		});

		it("excludes the tail once the total byte budget is spent", async () => {
			const repo = await initRepo();
			await Promise.all([
				fs.writeFile(path.join(repo, "a.bin"), Buffer.alloc(600, 1)),
				fs.writeFile(path.join(repo, "b.bin"), Buffer.alloc(600, 2)),
				fs.writeFile(path.join(repo, "c.bin"), Buffer.alloc(600, 3)),
			]);

			const baseline = await captureBaseline(repo, limits({ maxUntrackedTotalBytes: 1200 }));

			expect(baseline.root.untracked.captured).toEqual(["a.bin", "b.bin"]);
			expect(baseline.root.untracked.excluded).toEqual([{ path: "c.bin", bytes: 600, reason: "budget-exhausted" }]);
			expect(baseline.warnings[0]).toContain("c.bin");
		});

		it("counts a 64 MiB carried snapshot before 64 MiB of new task output", async () => {
			const repo = await initRepo();
			const fileBytes = 4 * 1024 * 1024;
			const filesPerHalf = 16;
			for (let index = 0; index < filesPerHalf; index += 1) {
				await writeSparseFile(path.join(repo, `carried-${index.toString().padStart(2, "0")}.bin`), fileBytes);
			}
			const baseline = await captureBaseline(repo);
			try {
				for (let index = 0; index < filesPerHalf; index += 1) {
					await writeSparseFile(path.join(repo, `new-${index.toString().padStart(2, "0")}.bin`), fileBytes);
				}

				let captureError: unknown;
				try {
					await captureDeltaPatch(repo, baseline);
				} catch (error) {
					captureError = error;
				}

				expect(captureError).toBeInstanceOf(CurrentSnapshotExclusionError);
				const exclusion = captureError as CurrentSnapshotExclusionError;
				expect(exclusion.excludedCount).toBe(filesPerHalf);
				expect(exclusion.excludedBytes).toBe(64 * 1024 * 1024);
				expect(exclusion.excluded.every(entry => entry.reason === "budget-exhausted")).toBe(true);
			} finally {
				await releaseBaseline(baseline);
			}
		}, 120_000);

		it("re-stats carried paths against per-file and path-count budgets", async () => {
			const perFileRepo = await initRepo();
			await Promise.all([
				fs.writeFile(path.join(perFileRepo, "a.bin"), Buffer.alloc(32, 1)),
				fs.writeFile(path.join(perFileRepo, "b.bin"), Buffer.alloc(32, 2)),
			]);
			const bounded = limits({
				maxUntrackedFileBytes: 64,
				maxUntrackedTotalBytes: 128,
				maxUntrackedPaths: 2,
			});
			const perFileBaseline = await captureBaseline(perFileRepo, bounded);
			try {
				await fs.writeFile(path.join(perFileRepo, "a.bin"), Buffer.alloc(65, 1));

				let captureError: unknown;
				try {
					await captureDeltaPatch(perFileRepo, perFileBaseline, bounded);
				} catch (error) {
					captureError = error;
				}

				expect(captureError).toBeInstanceOf(CurrentSnapshotExclusionError);
				const exclusion = captureError as CurrentSnapshotExclusionError;
				expect(exclusion.excluded).toContainEqual({
					path: "a.bin",
					bytes: 65,
					reason: "file-too-large",
				});
			} finally {
				await releaseBaseline(perFileBaseline);
			}

			const pathRepo = await initRepo();
			await Promise.all([
				fs.writeFile(path.join(pathRepo, "a.bin"), Buffer.alloc(32, 1)),
				fs.writeFile(path.join(pathRepo, "b.bin"), Buffer.alloc(32, 2)),
			]);
			const pathBaseline = await captureBaseline(pathRepo, bounded);
			try {
				let captureError: unknown;
				try {
					await captureDeltaPatch(pathRepo, pathBaseline, { ...bounded, maxUntrackedPaths: 1 });
				} catch (error) {
					captureError = error;
				}

				expect(captureError).toBeInstanceOf(CurrentSnapshotExclusionError);
				const exclusion = captureError as CurrentSnapshotExclusionError;
				expect(exclusion.excludedCount).toBe(1);
				expect(exclusion.excluded).toContainEqual({
					path: "b.bin",
					bytes: 0,
					reason: "capture-gated",
				});
			} finally {
				await releaseBaseline(pathBaseline);
			}
		});

		it("fails capture when a successful task creates one oversized output file", async () => {
			const repo = await initRepo();
			const baseline = await captureBaseline(repo);
			try {
				const oversizedBytes = DEFAULT_BASELINE_LIMITS.maxUntrackedFileBytes + 1;
				await writeSparseFile(path.join(repo, "task-oversized.bin"), oversizedBytes);

				let captureError: unknown;
				try {
					await captureDeltaPatch(repo, baseline);
				} catch (error) {
					captureError = error;
				}

				expect(captureError).toBeInstanceOf(CurrentSnapshotExclusionError);
				const exclusion = captureError as CurrentSnapshotExclusionError;
				expect(exclusion.excludedCount).toBe(1);
				expect(exclusion.excludedBytes).toBe(oversizedBytes);
				expect(exclusion.excluded).toEqual([
					{ path: "task-oversized.bin", bytes: oversizedBytes, reason: "file-too-large" },
				]);
				expect(exclusion.message).toContain("Task output was not captured");
			} finally {
				await releaseBaseline(baseline);
			}
		});

		it("skips the untracked capture above the path limit but still carries new task files back", async () => {
			const repo = await initRepo();
			await Promise.all(
				Array.from({ length: 5 }, (_unused, index) =>
					fs.writeFile(path.join(repo, `dirt-${index}.txt`), `dirt ${index}\n`),
				),
			);
			const bounded = limits({ maxUntrackedPaths: 2 });

			const baseline = await captureBaseline(repo, bounded);

			expect(baseline.root.untracked.gated).toBe(true);
			expect(baseline.root.untracked.listed).toHaveLength(5);
			expect(baseline.root.untracked.captured).toEqual([]);
			expect(baseline.root.untracked.patchPath).toBeNull();
			expect(baseline.root.untracked.excludedCount).toBe(5);
			expect(baseline.warnings[0]).toContain("5 untracked file(s) excluded");
			expect(baseline.warnings[0]).toContain("exceeds the 2-path capture limit");

			// Gating the pre-existing dirt must not swallow what the task produced:
			// a new untracked file is a fresh candidate, well under the limit.
			await fs.writeFile(path.join(repo, "task.txt"), "task output\n");
			const delta = await captureDeltaPatch(repo, baseline, bounded);

			expect(delta.rootPatch).toContain("task.txt");
			expect(delta.rootPatch).toContain("+task output");
			expect(delta.rootPatch).not.toContain("dirt-0.txt");
			expect(delta.rootPatch).not.toContain("deleted file");
		});

		it("rejects a symlink-to-FIFO replacement without reopening the path", async () => {
			if (process.platform === "win32") return;
			const replacedRepo = await initRepo();
			const targetFifo = path.join(replacedRepo, "target.fifo");
			const replacement = path.join(replacedRepo, "replaced.txt");
			await fs.writeFile(replacement, "regular before replacement\n");
			const replacementMkfifo = Bun.spawn(["mkfifo", targetFifo], { stderr: "pipe", stdout: "pipe" });
			expect(await replacementMkfifo.exited).toBe(0);
			await fs.rm(replacement);
			await fs.symlink("target.fifo", replacement);

			const replacementStart = performance.now();
			const baseline = await captureBaseline(replacedRepo);
			expect(performance.now() - replacementStart).toBeLessThan(1_000);
			expect(baseline.root.untracked.captured).toEqual([]);
			expect(baseline.root.untracked.excluded).toEqual([{ path: "replaced.txt", bytes: 0, reason: "not-regular" }]);
			await releaseBaseline(baseline);
		});

		it("fails a current symlink-to-FIFO output closed without blocking", async () => {
			if (process.platform === "win32") return;
			const repo = await initRepo();
			const baseline = await captureBaseline(repo);
			try {
				const fifo = path.join(repo, "task-target.fifo");
				const mkfifo = Bun.spawn(["mkfifo", fifo], { stderr: "pipe", stdout: "pipe" });
				expect(await mkfifo.exited).toBe(0);
				await fs.symlink("task-target.fifo", path.join(repo, "task-output.txt"));

				const captureStart = performance.now();
				let captureError: unknown;
				try {
					await captureDeltaPatch(repo, baseline);
				} catch (error) {
					captureError = error;
				}
				expect(performance.now() - captureStart).toBeLessThan(1_000);
				expect(captureError).toBeInstanceOf(CurrentSnapshotExclusionError);
				expect((captureError as CurrentSnapshotExclusionError).excluded).toEqual([
					{ path: "task-output.txt", bytes: 0, reason: "not-regular" },
				]);
			} finally {
				await releaseBaseline(baseline);
			}
		});

		it("aborts after delta capture without committing or retaining the task branch", async () => {
			const repo = await initRepo();
			const baseline = await captureBaseline(repo);
			const controller = new AbortController();
			try {
				await fs.writeFile(path.join(repo, "tracked.txt"), "task change\n");
				let commitError: unknown;
				try {
					await commitToBranch(
						repo,
						baseline,
						"abort-after-capture",
						undefined,
						async () => {
							controller.abort(new Error("abort-after-capture barrier"));
							return null;
						},
						controller.signal,
					);
				} catch (error) {
					commitError = error;
				}

				expect(commitError).toBeInstanceOf(Error);
				expect((commitError as Error).message).toBe("abort-after-capture barrier");
				expect(await runGit(repo, ["branch", "--list", "omp/task/abort-after-capture"])).toBe("");
			} finally {
				await releaseBaseline(baseline);
			}
		});

		it("rejects an untracked file whose parent is replaced by an outside symlink", async () => {
			if (process.platform === "win32") return;
			const repo = await initRepo();
			const outside = await fs.mkdtemp(path.join(os.tmpdir(), "omp-baseline-outside-"));
			repos.push(outside);
			await fs.mkdir(path.join(repo, "parent"));
			await fs.writeFile(path.join(repo, "parent", "secret.txt"), "inside\n");
			await fs.writeFile(path.join(outside, "secret.txt"), "outside secret\n");
			let captureError: unknown;
			try {
				await captureBaseline(repo, DEFAULT_BASELINE_LIMITS, undefined, {
					beforeSnapshotOpen: async (_repoRoot, entry) => {
						if (entry !== "parent/secret.txt") return;
						await fs.rm(path.join(repo, "parent"), { recursive: true });
						await fs.symlink(outside, path.join(repo, "parent"));
					},
				});
			} catch (error) {
				captureError = error;
			}

			expect(captureError).toBeInstanceOf(Error);
			expect((captureError as Error).message).toContain("Untracked path resolves outside repository");
			expect((captureError as Error).message).toContain("parent/secret.txt");
		});

		it("aborts while waiting for the repository lease with zero mutation", async () => {
			const repo = await initRepo();
			const patch = await makeTrackedPatch(repo, "lease-controlled change\n");
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const heldLease = git.withRepoLock(repo, async () => {
				entered.resolve();
				await release.promise;
			});
			await entered.promise;

			const controller = new AbortController();
			const pending = applyRootPatch(repo, patch, controller.signal);
			controller.abort(new Error("cancelled-before-lease"));
			release.resolve();
			await heldLease;
			let applyError: unknown;
			try {
				await pending;
			} catch (error) {
				applyError = error;
			}

			expect(applyError).toBeInstanceOf(Error);
			expect(await fs.readFile(path.join(repo, "tracked.txt"), "utf8")).toBe("base\n");
			expect(await runGit(repo, ["status", "--porcelain=v1"])).toBe("");
		});

		it("finishes nested then root mutation after cancellation at the first commit point", async () => {
			const repo = await initRepo();
			const nested = path.join(repo, "nested");
			await fs.mkdir(nested);
			await runGit(nested, ["init", "-q", "-b", "main"]);
			await runGit(nested, ["config", "user.email", "test@example.com"]);
			await runGit(nested, ["config", "user.name", "Test User"]);
			await fs.writeFile(path.join(nested, "tracked.txt"), "base\n");
			await runGit(nested, ["add", "."]);
			await runGit(nested, ["commit", "-q", "-m", "initial"]);
			const rootPatch = await makeTrackedPatch(repo, "root transaction change\n");
			const nestedPatch = await makeTrackedPatch(nested, "nested transaction change\n");
			const controller = new AbortController();
			const commitPoints: string[] = [];

			const result = await applyTaskPatches(
				repo,
				rootPatch,
				[{ relativePath: "nested", patch: nestedPatch }],
				async () => "nested transaction",
				controller.signal,
				{
					commitPoint: kind => {
						commitPoints.push(kind);
						if (kind === "nested-apply") controller.abort(new Error("late-cancellation"));
					},
				},
			);

			expect(result.changesApplied).toBe(true);
			expect(result.hadChanges).toBe(true);
			expect(result.lateAbort).toBe(true);
			expect(result.nested.repos).toEqual([
				{
					relativePath: "nested",
					applied: true,
					committed: true,
					commitPointCrossed: true,
				},
			]);
			expect(result.root?.applied).toBe(true);
			expect(commitPoints).toEqual(["nested-apply", "root-apply"]);
			expect(await fs.readFile(path.join(repo, "tracked.txt"), "utf8")).toBe("root transaction change\n");
			expect(await fs.readFile(path.join(nested, "tracked.txt"), "utf8")).toBe("nested transaction change\n");
			expect(await runGit(nested, ["log", "-1", "--format=%s"])).toBe("nested transaction");
		});

		it("preserves an unrelated edit arriving at the root commit point", async () => {
			const repo = await initRepo();
			const patch = await makeTrackedPatch(repo, "task patch change\n");

			const result = await applyRootPatch(repo, patch, undefined, {
				commitPoint: async () => {
					await fs.writeFile(path.join(repo, "unrelated.txt"), "concurrent user edit\n");
				},
			});

			expect(result).toEqual({
				applied: true,
				hadChanges: true,
				commitPointCrossed: true,
				lateAbort: false,
			});
			expect(await fs.readFile(path.join(repo, "tracked.txt"), "utf8")).toBe("task patch change\n");
			expect(await fs.readFile(path.join(repo, "unrelated.txt"), "utf8")).toBe("concurrent user edit\n");
		});

		it("never deletes a stale same-task branch it does not own", async () => {
			const repo = await initRepo();
			const staleBranch = "omp/task/stale-token";
			await runGit(repo, ["branch", staleBranch]);
			const staleSha = await runGit(repo, ["rev-parse", staleBranch]);
			const baseline = await captureBaseline(repo);
			try {
				await fs.writeFile(path.join(repo, "tracked.txt"), "owned branch change\n");
				const commitResult = await commitToBranch(repo, baseline, "stale-token", undefined);
				const ownedBranch = commitResult?.branch;
				if (!ownedBranch) throw new Error("Expected an owned task branch");

				expect(ownedBranch.branchName).not.toBe(staleBranch);
				expect(ownedBranch.branchName.startsWith(`${staleBranch}-`)).toBe(true);
				expect(await runGit(repo, ["rev-parse", staleBranch])).toBe(staleSha);
				expect(await cleanupTaskBranches(repo, [ownedBranch])).toEqual([]);
				expect(await runGit(repo, ["rev-parse", staleBranch])).toBe(staleSha);
			} finally {
				await releaseBaseline(baseline);
			}
		});

		it("ignores cleanup-time aborts without stranding owned branches or worktrees", async () => {
			const repo = await initRepo();
			const baseline = await captureBaseline(repo);
			try {
				await fs.writeFile(path.join(repo, "tracked.txt"), "late abort branch change\n");
				const captureController = new AbortController();
				const commitResult = await commitToBranch(
					repo,
					baseline,
					"cleanup-late-abort",
					undefined,
					undefined,
					captureController.signal,
					{
						commitPoint: kind => {
							if (kind === "branch-capture") captureController.abort(new Error("abort-during-capture-cleanup"));
						},
					},
				);
				const ownedBranch = commitResult?.branch;
				if (!ownedBranch) throw new Error("Expected an owned task branch");
				expect(commitResult?.lateAbort).toBe(true);
				expect(commitResult?.cleanupErrors).toEqual([]);
				expect(await runGit(repo, ["worktree", "list", "--porcelain"])).not.toContain(
					`omp-branch-${ownedBranch.ownershipId}`,
				);

				await runGit(repo, ["checkout", "--", "tracked.txt"]);
				const mergeController = new AbortController();
				const mergeResult = await mergeTaskBranches(repo, [ownedBranch], mergeController.signal, {
					commitPoint: kind => {
						if (kind === "branch-merge") mergeController.abort(new Error("abort-during-merge-cleanup"));
					},
				});

				expect(mergeResult.merged).toEqual([ownedBranch.branchName]);
				expect(mergeResult.failed).toEqual([]);
				expect(mergeResult.lateAbort).toBe(true);
				expect(mergeResult.cleanupErrors).toEqual([]);
				expect(await runGit(repo, ["branch", "--list", ownedBranch.branchName])).toBe("");
				expect(await runGit(repo, ["worktree", "list", "--porcelain"])).not.toContain(
					`omp-branch-${ownedBranch.ownershipId}`,
				);
			} finally {
				await releaseBaseline(baseline);
			}
		});

		it("deletes a ref only while it still points at the expected commit", async () => {
			const repo = await initRepo();
			const first = await runGit(repo, ["rev-parse", "HEAD"]);
			await fs.writeFile(path.join(repo, "tracked.txt"), "second\n");
			await runGit(repo, ["commit", "-q", "-am", "second"]);
			const second = await runGit(repo, ["rev-parse", "HEAD"]);
			await runGit(repo, ["branch", "owned", first]);

			expect(await git.ref.deleteExact(repo, "refs/heads/owned", second)).toEqual({
				kind: "mismatch",
				actual: first,
			});
			expect(await refSha(repo, "refs/heads/owned")).toBe(first);

			expect(await git.ref.deleteExact(repo, "refs/heads/owned", first)).toEqual({ kind: "deleted" });
			expect(await refSha(repo, "refs/heads/owned")).toBeNull();

			expect(await git.ref.deleteExact(repo, "refs/heads/owned", first)).toEqual({ kind: "missing" });
		});

		it("never deletes a commit that arrives while owned-ref cleanup is running", async () => {
			const repo = await initRepo();
			const baseline = await captureBaseline(repo);
			const readRef = git.ref.read.bind(git.ref);
			try {
				await fs.writeFile(path.join(repo, "tracked.txt"), "atomic cleanup change\n");
				const commitResult = await commitToBranch(repo, baseline, "atomic-cleanup", undefined);
				const owned = commitResult?.branch;
				if (!owned) throw new Error("Expected an owned task branch");
				await runGit(repo, ["checkout", "--", "tracked.txt"]);

				// A commit this invocation never created, force-moved onto the owned
				// ref at the only instant a resolve-then-delete implementation can be
				// interrupted: right after it reads the ref it is about to delete.
				const ownedRef = `refs/heads/${owned.branchName}`;
				const foreign = await runGit(repo, [
					"commit-tree",
					`${owned.commitSha}^{tree}`,
					"-p",
					owned.commitSha,
					"-m",
					"user force-move",
				]);
				let hijacked = false;
				const tryDelete = vi.spyOn(git.branch, "tryDelete");
				vi.spyOn(git.ref, "read").mockImplementation(async (cwd, refName, signal) => {
					const current = await readRef(cwd, refName, signal);
					if (refName === ownedRef && !hijacked) {
						hijacked = true;
						await runGit(repo, ["update-ref", ownedRef, foreign, owned.commitSha]);
					}
					return current;
				});

				const errors = await cleanupTaskBranches(repo, [owned]);
				vi.restoreAllMocks();

				// Either the ref was never re-read and the owned commit was deleted
				// under its own sha, or the foreign commit is still there and the
				// refusal is reported. There is no third outcome in which the
				// foreign commit is silently discarded.
				expect(await refSha(repo, ownedRef)).toBe(hijacked ? foreign : null);
				expect(tryDelete).not.toHaveBeenCalled();
				expect(errors).toEqual(
					hijacked
						? [
								`Refusing to delete ${owned.branchName}: owned commit changed from ${owned.commitSha} to ${foreign}.`,
							]
						: [],
				);
			} finally {
				vi.restoreAllMocks();
				await releaseBaseline(baseline);
			}
		});

		it("retains a task branch whose commit it cannot prove it owns", async () => {
			const repo = await initRepo();
			const startSha = await runGit(repo, ["rev-parse", "HEAD"]);
			const baseline = await captureBaseline(repo);
			const headSha = git.head.sha.bind(git.head);
			try {
				await fs.writeFile(path.join(repo, "tracked.txt"), "unverifiable change\n");
				// The commit lands, then the read that would name it fails.
				vi.spyOn(git.head, "sha").mockImplementation(async (cwd, signal) => {
					const sha = await headSha(cwd, signal);
					return path.basename(cwd).startsWith("omp-branch-") ? null : sha;
				});

				await expect(commitToBranch(repo, baseline, "unverifiable", undefined)).rejects.toThrow(
					/retained for manual cleanup/,
				);
				vi.restoreAllMocks();

				const retained = await runGit(repo, [
					"for-each-ref",
					"--format=%(objectname)",
					"refs/heads/omp/task/unverifiable-*",
				]);
				expect(retained).not.toBe("");
				expect(retained).not.toBe(startSha);
				// The retained ref holds this invocation's own unverified commit.
				expect(await runGit(repo, ["rev-parse", `${retained}^`])).toBe(startSha);
			} finally {
				vi.restoreAllMocks();
				await releaseBaseline(baseline);
			}
		});

		it("reports a temporary worktree it cannot delete without losing the owned branch", async () => {
			const repo = await initRepo();
			const baseline = await captureBaseline(repo);
			const stageFiles = git.stage.files.bind(git.stage);
			let pinnedDir: string | undefined;
			try {
				await fs.writeFile(path.join(repo, "tracked.txt"), "undeletable worktree\n");
				// After staging, plant a directory whose contents this process cannot
				// unlink, so both `git worktree remove` and `fs.rm` fail for real.
				vi.spyOn(git.stage, "files").mockImplementation(async (cwd, files, signal) => {
					await stageFiles(cwd, files, signal);
					if (!path.basename(cwd).startsWith("omp-branch-")) return;
					pinnedDir = path.join(cwd, "pinned");
					await fs.mkdir(pinnedDir);
					await fs.writeFile(path.join(pinnedDir, "pinned.txt"), "pinned\n");
					await fs.chmod(pinnedDir, 0o500);
				});

				const commitResult = await commitToBranch(repo, baseline, "undeletable-worktree", undefined);
				vi.restoreAllMocks();
				const owned = commitResult?.branch;
				if (!owned) throw new Error("Expected the owned task branch to survive worktree cleanup failure");

				expect(commitResult?.cleanupErrors.some(error => error.includes("could not be removed"))).toBe(true);
				expect(await refSha(repo, `refs/heads/${owned.branchName}`)).toBe(owned.commitSha);
			} finally {
				vi.restoreAllMocks();
				if (pinnedDir) {
					await fs.chmod(pinnedDir, 0o700).catch(() => {});
					await fs.rm(path.dirname(pinnedDir), { recursive: true, force: true }).catch(() => {});
				}
				await releaseBaseline(baseline);
			}
		});

		it("keeps a landed merge landed when owned-ref cleanup fails", async () => {
			const repo = await initRepo();
			const baseline = await captureBaseline(repo);
			try {
				await fs.writeFile(path.join(repo, "tracked.txt"), "merged by task\n");
				const commitResult = await commitToBranch(repo, baseline, "cleanup-error-merge", undefined);
				const owned = commitResult?.branch;
				if (!owned) throw new Error("Expected an owned task branch");
				await runGit(repo, ["checkout", "--", "tracked.txt"]);

				vi.spyOn(git.ref, "deleteExact").mockImplementation(async () => {
					throw new Error("git is not installed.");
				});
				const mergeResult = await mergeTaskBranches(repo, [owned]);
				vi.restoreAllMocks();

				expect(mergeResult.merged).toEqual([owned.branchName]);
				expect(mergeResult.failed).toEqual([]);
				expect(mergeResult.commitPointCrossed).toBe(true);
				expect(mergeResult.cleanupErrors).toEqual([
					`Failed to delete owned task branch ${owned.branchName}: git is not installed.`,
				]);
				expect(await fs.readFile(path.join(repo, "tracked.txt"), "utf8")).toBe("merged by task\n");
				expect(await refSha(repo, `refs/heads/${owned.branchName}`)).toBe(owned.commitSha);
			} finally {
				vi.restoreAllMocks();
				await releaseBaseline(baseline);
			}
		});

		it("keeps a landed merge landed when the ref boundary itself is broken", async () => {
			const repo = await initRepo();
			const baseline = await captureBaseline(repo);
			const resolveRef = git.ref.resolve.bind(git.ref);
			const readRef = git.ref.read.bind(git.ref);
			try {
				await fs.writeFile(path.join(repo, "tracked.txt"), "merged despite broken ref reads\n");
				const commitResult = await commitToBranch(repo, baseline, "broken-ref-merge", undefined);
				const owned = commitResult?.branch;
				if (!owned) throw new Error("Expected an owned task branch");
				await runGit(repo, ["checkout", "--", "tracked.txt"]);

				// Reads of the owned ref start failing exactly at the commit point,
				// after the pre-merge revalidation and before cherry-pick and cleanup.
				const ownedRef = `refs/heads/${owned.branchName}`;
				const mergeResult = await mergeTaskBranches(repo, [owned], undefined, {
					commitPoint: () => {
						vi.spyOn(git.ref, "read").mockImplementation(async (cwd, refName, signal) => {
							if (refName === ownedRef) throw new Error("ref database unreadable");
							return readRef(cwd, refName, signal);
						});
						vi.spyOn(git.ref, "resolve").mockImplementation(async (cwd, refName, signal) => {
							if (refName === ownedRef) throw new Error("ref database unreadable");
							return resolveRef(cwd, refName, signal);
						});
					},
				});
				vi.restoreAllMocks();

				expect(mergeResult.merged).toEqual([owned.branchName]);
				expect(mergeResult.commitPointCrossed).toBe(true);
				expect(mergeResult.cleanupErrors).toEqual([
					`Failed to delete owned task branch ${owned.branchName}: ref database unreadable`,
				]);
				expect(await fs.readFile(path.join(repo, "tracked.txt"), "utf8")).toBe("merged despite broken ref reads\n");
			} finally {
				vi.restoreAllMocks();
				await releaseBaseline(baseline);
			}
		});

		it("classifies a ref as direct, symbolic, missing or unreadable without dereferencing it", async () => {
			const repo = await initRepo();
			const sha = await runGit(repo, ["rev-parse", "HEAD"]);
			await runGit(repo, ["branch", "target", sha]);
			await runGit(repo, ["branch", "direct", sha]);
			await runGit(repo, ["branch", "space/child", sha]);
			await runGit(repo, ["symbolic-ref", "refs/heads/pointer", "refs/heads/target"]);

			expect(await git.ref.read(repo, "refs/heads/direct")).toEqual({ kind: "direct", oid: sha });
			expect(await git.ref.read(repo, "refs/heads/pointer")).toEqual({
				kind: "symbolic",
				target: "refs/heads/target",
			});
			expect(await git.ref.read(repo, "refs/heads/absent")).toEqual({ kind: "missing" });
			// `refs/heads/space` is a namespace, not a ref, even though
			// `for-each-ref` lists `refs/heads/space/child` for that same pattern.
			expect(await git.ref.read(repo, "refs/heads/space")).toEqual({ kind: "missing" });

			// A symbolic ref is refused outright: `-d` with the dereferenced sha
			// would otherwise retire a name this invocation no longer owns.
			expect(await git.ref.deleteExact(repo, "refs/heads/pointer", sha)).toEqual({
				kind: "symbolic",
				target: "refs/heads/target",
			});
			expect(await runGit(repo, ["symbolic-ref", "refs/heads/pointer"])).toBe("refs/heads/target");
			expect(await refSha(repo, "refs/heads/target")).toBe(sha);

			const loosePath = path.join(repo, ".git", "refs", "heads", "direct");
			expect((await fs.readFile(loosePath, "utf8")).trim()).toBe(sha);
			await fs.chmod(loosePath, 0o000);
			try {
				// Git skips the ref with a warning and every read command reports it
				// as absent; an unreadable ref is never absence.
				expect((await git.ref.read(repo, "refs/heads/direct")).kind).toBe("unreadable");
				expect((await git.ref.deleteExact(repo, "refs/heads/direct", sha)).kind).toBe("failed");
			} finally {
				await fs.chmod(loosePath, 0o644);
			}
			expect(await refSha(repo, "refs/heads/direct")).toBe(sha);
		});

		it("reports an unreadable reftable store instead of reporting the branch retired", async () => {
			const repo = await fs.mkdtemp(path.join(os.tmpdir(), "omp-reftable-"));
			repos.push(repo);
			await runGit(repo, ["init", "-q", "-b", "main", "--ref-format=reftable"]);
			await runGit(repo, ["config", "user.email", "test@example.com"]);
			await runGit(repo, ["config", "user.name", "Test User"]);
			await fs.writeFile(path.join(repo, "tracked.txt"), "base\n");
			await runGit(repo, ["add", "."]);
			await runGit(repo, ["commit", "-q", "-m", "initial"]);
			const commitSha = await runGit(repo, ["rev-parse", "HEAD"]);
			const branchName = "omp/task/reftable-unreadable-1";
			await runGit(repo, ["branch", branchName, commitSha]);

			// A reftable store this process cannot read answers every ref query
			// with an empty listing and a zero exit, so a cleanup that trusts the
			// listing calls a branch that is still there retired.
			const store = path.join(repo, ".git", "reftable");
			await fs.chmod(store, 0o000);
			let errors: string[];
			try {
				expect(await runGit(repo, ["for-each-ref", "--format=%(refname)", `refs/heads/${branchName}`])).toBe("");
				errors = await cleanupTaskBranches(repo, [{ branchName, commitSha, ownershipId: "reftable-unreadable" }]);
			} finally {
				await fs.chmod(store, 0o700);
			}

			expect(errors).toHaveLength(1);
			expect(errors[0]).toContain(`Failed to delete owned task branch ${branchName}`);
			expect(errors[0]).toContain("reftable store");
			expect(await refSha(repo, `refs/heads/${branchName}`)).toBe(commitSha);
		});

		it("never follows a symbolic owned ref onto the branch it points at", async () => {
			const repo = await initRepo();
			const baseline = await captureBaseline(repo);
			try {
				await fs.writeFile(path.join(repo, "tracked.txt"), "symbolic owned ref\n");
				const commitResult = await commitToBranch(repo, baseline, "symbolic-owned", undefined);
				const owned = commitResult?.branch;
				if (!owned) throw new Error("Expected an owned task branch");
				await runGit(repo, ["checkout", "--", "tracked.txt"]);

				// An external writer replaces the owned ref with a symbolic ref to a
				// branch that happens to sit on the owned commit, so the expected-sha
				// comparison passes on a name this invocation no longer owns.
				const ownedRef = `refs/heads/${owned.branchName}`;
				await runGit(repo, ["branch", "foreign", owned.commitSha]);
				await runGit(repo, ["symbolic-ref", ownedRef, "refs/heads/foreign"]);

				const errors = await cleanupTaskBranches(repo, [owned]);

				expect(errors).toEqual([
					`Refusing to delete ${owned.branchName}: it is now a symbolic ref to refs/heads/foreign, ` +
						`not the owned commit ${owned.commitSha}.`,
				]);
				// Both refs survive: a dereferencing delete retires the symref and
				// the branch it names.
				expect(await runGit(repo, ["symbolic-ref", ownedRef])).toBe("refs/heads/foreign");
				expect(await refSha(repo, "refs/heads/foreign")).toBe(owned.commitSha);
			} finally {
				await releaseBaseline(baseline);
			}
		});

		it("refuses to delete an owned branch a registered worktree still has checked out", async () => {
			const repo = await initRepo();
			const baseline = await captureBaseline(repo);
			let borrowed: string | undefined;
			try {
				await fs.writeFile(path.join(repo, "tracked.txt"), "checked out elsewhere\n");
				const commitResult = await commitToBranch(repo, baseline, "checked-out", undefined);
				const owned = commitResult?.branch;
				if (!owned) throw new Error("Expected an owned task branch");
				await runGit(repo, ["checkout", "--", "tracked.txt"]);

				borrowed = path.join(os.tmpdir(), `omp-borrowed-${owned.ownershipId}`);
				await runGit(repo, ["worktree", "add", "--quiet", borrowed, owned.branchName]);

				const errors = await cleanupTaskBranches(repo, [owned]);

				expect(errors).toEqual([
					`Refusing to delete ${owned.branchName}: a registered worktree still has it checked out, ` +
						`and deleting the ref would strand that worktree.`,
				]);
				expect(await refSha(repo, `refs/heads/${owned.branchName}`)).toBe(owned.commitSha);
			} finally {
				if (borrowed) {
					await runGit(repo, ["worktree", "remove", "-f", borrowed]).catch(() => {});
					await fs.rm(borrowed, { recursive: true, force: true });
				}
				await releaseBaseline(baseline);
			}
		});

		it("fails closed on an overflowing external worktree list before owned-ref deletion", async () => {
			const repo = await initRepo();
			const commitSha = await runGit(repo, ["rev-parse", "HEAD"]);
			const branchName = "omp/task/pre-delete-overflow-1";
			const borrowed = path.join(os.tmpdir(), "omp-borrowed-pre-delete-overflow");
			await runGit(repo, ["branch", branchName, commitSha]);
			await runGit(repo, ["worktree", "add", "--quiet", borrowed, branchName]);
			try {
				const program = `
import * as git from ${JSON.stringify(GIT_SOURCE_URL)};
import { cleanupTaskBranches } from ${JSON.stringify(WORKTREE_SOURCE_URL)};
const [repo, branchName, commitSha] = process.argv.slice(1);
let typedOverflow = false;
try {
	await git.worktree.list(repo);
} catch (error) {
	typedOverflow = error instanceof git.GitOutputOverflowError;
}
const cleanupErrors = await cleanupTaskBranches(repo, [{ branchName, commitSha, ownershipId: "overflow" }]);
process.stdout.write(JSON.stringify({ cleanupErrors, typedOverflow }));
`;
				const output = await runWithOverflowingGit(program, [repo, branchName, commitSha]);
				const result = JSON.parse(output) as { cleanupErrors: string[]; typedOverflow: boolean };

				expect(await refSha(repo, `refs/heads/${branchName}`)).toBe(commitSha);
				expect(await runGit(repo, ["worktree", "list", "--porcelain"])).toContain(
					`branch refs/heads/${branchName}`,
				);
				expect(result.typedOverflow).toBe(true);
				expect(result.cleanupErrors).toHaveLength(1);
				expect(result.cleanupErrors[0]).toContain(`Refusing to delete ${branchName}`);
				expect(result.cleanupErrors[0]).toContain("stdout exceeded the 8388608-byte capture limit");
			} finally {
				await runGit(repo, ["worktree", "remove", "-f", borrowed]).catch(() => {});
				await fs.rm(borrowed, { recursive: true, force: true });
			}
		});

		it("retains a partially created branch whose temporary worktree survives cleanup", async () => {
			const repo = await initRepo();
			const startSha = await runGit(repo, ["rev-parse", "HEAD"]);
			const baseline = await captureBaseline(repo);
			const stageFiles = git.stage.files.bind(git.stage);
			let pinnedDir: string | undefined;
			try {
				await fs.writeFile(path.join(repo, "tracked.txt"), "worktree survives cleanup\n");
				// Plant a directory whose contents this process cannot unlink, then
				// fail the operation, so the branch exists at `startSha` while its
				// temporary worktree cannot be retired.
				vi.spyOn(git.stage, "files").mockImplementation(async (cwd, files, signal) => {
					await stageFiles(cwd, files, signal);
					if (!path.basename(cwd).startsWith("omp-branch-")) return;
					pinnedDir = path.join(cwd, "pinned");
					await fs.mkdir(pinnedDir);
					await fs.writeFile(path.join(pinnedDir, "pinned.txt"), "pinned\n");
					await fs.chmod(pinnedDir, 0o500);
					throw new Error("staging failed after the worktree became undeletable");
				});

				await expect(commitToBranch(repo, baseline, "worktree-survives", undefined)).rejects.toThrow(
					/is retained for manual cleanup: its temporary worktree .* could not be retired/,
				);
				vi.restoreAllMocks();

				const retained = await runGit(repo, [
					"for-each-ref",
					"--format=%(refname)",
					"refs/heads/omp/task/worktree-survives-*",
				]);
				expect(retained).not.toBe("");
				expect(await refSha(repo, retained)).toBe(startSha);
				// The recursive removal takes the worktree's `.git` link with it, so
				// the prune that follows unregisters an entry whose directory is very
				// much still there. Registration alone would call this retired.
				if (!pinnedDir) throw new Error("Expected the undeletable directory to have been planted");
				expect((await fs.stat(pinnedDir)).isDirectory()).toBe(true);
			} finally {
				vi.restoreAllMocks();
				if (pinnedDir) {
					await fs.chmod(pinnedDir, 0o700).catch(() => {});
					await fs.rm(path.dirname(pinnedDir), { recursive: true, force: true }).catch(() => {});
				}
				await releaseBaseline(baseline);
			}
		});

		it("retains a partially created ref when an overflowing list blocks post-cleanup verification", async () => {
			const repo = await initRepo();
			const startSha = await runGit(repo, ["rev-parse", "HEAD"]);
			const program = `
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { captureBaseline, commitToBranch, releaseBaseline } from ${JSON.stringify(WORKTREE_SOURCE_URL)};
const repo = process.argv[1];
const baseline = await captureBaseline(repo);
try {
	await fs.writeFile(path.join(repo, "tracked.txt"), "post-cleanup overflow\\n");
	let failure = "";
	try {
		await commitToBranch(repo, baseline, "post-cleanup-overflow", undefined);
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error);
	}
	if (!failure) throw new Error("expected commitToBranch to fail");
	process.stdout.write(failure);
} finally {
	await releaseBaseline(baseline);
}
`;

			const failure = await runWithOverflowingGit(program, [repo], { failApply: true });
			const retained = await runGit(repo, [
				"for-each-ref",
				"--format=%(refname)",
				"refs/heads/omp/task/post-cleanup-overflow-*",
			]);
			expect(retained).not.toBe("");
			expect(await refSha(repo, retained)).toBe(startSha);
			expect(failure).toContain("controlled git apply failure");
			expect(failure).toContain("Temporary worktree registration could not be verified");
			expect(failure).toContain("stdout exceeded the 8388608-byte capture limit");
			expect(failure).toContain("is retained for manual cleanup");
		});

		it("sequences nested transactions in path order regardless of patch order", async () => {
			const repo = await initRepo();
			const order = ["zeta", "mid", "alpha"];
			const patches: { relativePath: string; patch: string }[] = [];
			for (const name of order) {
				const nested = await initNested(repo, name);
				patches.push({ relativePath: name, patch: await makeTrackedPatch(nested, `${name} change\n`) });
			}
			// `mid` diverges after its patch was captured, so it fails before its own
			// commit point and stops the sequence.
			await fs.writeFile(path.join(repo, "mid", "tracked.txt"), "diverged\n");
			await runGit(path.join(repo, "mid"), ["commit", "-q", "-am", "diverged"]);

			const result = await applyNestedPatches(repo, patches, async () => "nested transaction");

			expect(result.repos.map(status => status.relativePath)).toEqual(["alpha", "mid"]);
			expect(result.completed).toBe(false);
			expect(await runGit(path.join(repo, "alpha"), ["log", "-1", "--format=%s"])).toBe("nested transaction");
			expect(await fs.readFile(path.join(repo, "zeta", "tracked.txt"), "utf8")).toBe("base\n");
			expect(await runGit(path.join(repo, "zeta"), ["status", "--porcelain=v1"])).toBe("");
		});

		it("captures nested repositories in path order under a shuffled directory listing", async () => {
			const repo = await initRepo();
			for (const name of ["delta", "alpha", "charlie", "bravo"]) {
				await initNested(repo, name);
			}
			const readdir = fs.readdir as (dir: string, options?: unknown) => Promise<unknown[]>;
			const entryName = (entry: unknown): string =>
				typeof entry === "string" ? entry : (entry as { name: string }).name;
			// Descending directory-entry order on every filesystem, so discovery
			// order can never coincide with the required ascending sequence.
			const descending = async (dir: string, options?: unknown): Promise<unknown[]> => {
				const entries = await readdir(dir, options);
				return [...entries].sort((left, right) => (entryName(left) < entryName(right) ? 1 : -1));
			};
			vi.spyOn(fs, "readdir").mockImplementation(descending as unknown as typeof fs.readdir);

			let baseline: Awaited<ReturnType<typeof captureBaseline>> | undefined;
			try {
				baseline = await captureBaseline(repo);
				vi.restoreAllMocks();
				expect(baseline.nested.map(entry => entry.relativePath)).toEqual(["alpha", "bravo", "charlie", "delta"]);
			} finally {
				vi.restoreAllMocks();
				if (baseline) await releaseBaseline(baseline);
			}
		});

		it("reports nested repositories already committed when a later transaction cannot start", async () => {
			const repo = await initRepo();
			const patches: { relativePath: string; patch: string }[] = [];
			for (const name of ["alpha", "beta"]) {
				const nested = await initNested(repo, name);
				patches.push({ relativePath: name, patch: await makeTrackedPatch(nested, `${name} change\n`) });
			}

			// Commit-message generation is a live model call made before each nested
			// repository's lease: it can fail after an earlier repository already
			// crossed its commit point. The landed commit must survive in the report.
			let calls = 0;
			const result = await applyNestedPatches(repo, patches, async () => {
				calls += 1;
				if (calls === 2) throw new Error("commit-message generator failed");
				return "alpha transaction";
			});

			expect(result.completed).toBe(false);
			expect(result.commitPointCrossed).toBe(true);
			expect(result.lateAbort).toBe(false);
			expect(result.repos).toEqual([
				{ relativePath: "alpha", applied: true, committed: true, commitPointCrossed: true },
				{
					relativePath: "beta",
					applied: false,
					committed: false,
					commitPointCrossed: false,
					error: "commit-message generator failed",
				},
			]);
			expect(await fs.readFile(path.join(repo, "alpha", "tracked.txt"), "utf8")).toBe("alpha change\n");
			expect(await runGit(path.join(repo, "alpha"), ["log", "-1", "--format=%s"])).toBe("alpha transaction");
			expect(await fs.readFile(path.join(repo, "beta", "tracked.txt"), "utf8")).toBe("base\n");
		});

		interface RssFixtureReceipt {
			readonly trackedFiles: number;
			readonly untrackedBytes: number;
			readonly peakDeltaBytes: number;
			readonly nestedRepos: number;
			readonly excludedCount: number;
			readonly warnings: number;
		}

		interface PermissionsFixtureReceipt {
			readonly patchDirMode: number;
			readonly patchModes: number[];
			readonly partsDirMode: number | null;
			readonly partMode: number | null;
		}

		interface AbortFixtureReceipt {
			readonly partObserved: boolean;
			readonly aborted: boolean;
			readonly cleanupLatencyMs: number;
			readonly patchDirRemoved: boolean;
		}

		async function runCaptureFixture<T>(args: string[], tmpRoot?: string): Promise<T> {
			const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "baseline-rss-fixture.ts"), ...args], {
				cwd: path.join(import.meta.dir, "../.."),
				env: tmpRoot ? { ...process.env, TMPDIR: tmpRoot, TMP: tmpRoot, TEMP: tmpRoot } : undefined,
				stderr: "pipe",
				stdout: "pipe",
				windowsHide: true,
			});
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			if ((exitCode ?? 0) !== 0) {
				throw new Error(stderr.trim() || stdout.trim() || `Capture fixture exited ${exitCode ?? 0}`);
			}
			return JSON.parse(stdout) as T;
		}

		it("creates baseline and part storage as 0700/0600 under umask 000", async () => {
			if (process.platform === "win32") return;
			const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-permissions-fixture-"));
			try {
				const receipt = await runCaptureFixture<PermissionsFixtureReceipt>(["permissions"], tmpRoot);

				expect(receipt.patchDirMode).toBe(0o700);
				expect(receipt.patchModes.length).toBeGreaterThan(0);
				expect(receipt.patchModes.every(mode => mode === 0o600)).toBe(true);
				expect(receipt.partsDirMode).toBe(0o700);
				expect(receipt.partMode).toBe(0o600);
			} finally {
				await fs.rm(tmpRoot, { recursive: true, force: true });
			}
		}, 120_000);

		it("aborts an in-flight git diff and removes its private capture directory promptly", async () => {
			const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-abort-fixture-"));
			try {
				const receipt = await runCaptureFixture<AbortFixtureReceipt>(["abort"], tmpRoot);

				expect(receipt.partObserved).toBe(true);
				expect(receipt.aborted).toBe(true);
				expect(receipt.patchDirRemoved).toBe(true);
				expect(receipt.cleanupLatencyMs).toBeLessThan(2_000);
			} finally {
				await fs.rm(tmpRoot, { recursive: true, force: true });
			}
		}, 120_000);

		it("keeps coordinator peak RSS bounded across four increasing dirty fixtures", async () => {
			const inputs = [
				{ trackedFiles: 512, untrackedBytes: 8 * 1024 * 1024 },
				{ trackedFiles: 1_024, untrackedBytes: 16 * 1024 * 1024 },
				{ trackedFiles: 2_048, untrackedBytes: 32 * 1024 * 1024 },
				{ trackedFiles: 4_096, untrackedBytes: 128 * 1024 * 1024 },
			];
			const receipts: RssFixtureReceipt[] = [];
			for (const input of inputs) {
				receipts.push(
					await runCaptureFixture<RssFixtureReceipt>([String(input.trackedFiles), String(input.untrackedBytes)]),
				);
			}
			const peakDeltas = receipts.map(receipt => receipt.peakDeltaBytes);
			const spread = Math.max(...peakDeltas) - Math.min(...peakDeltas);

			expect(receipts.map(receipt => receipt.trackedFiles)).toEqual(inputs.map(input => input.trackedFiles));
			expect(receipts.every(receipt => receipt.nestedRepos === 3)).toBe(true);
			expect(receipts.every(receipt => receipt.excludedCount === 2)).toBe(true);
			expect(receipts.every(receipt => receipt.warnings > 0)).toBe(true);
			expect(peakDeltas.every(bytes => bytes < 48 * 1024 * 1024)).toBe(true);
			expect(spread).toBeLessThan(24 * 1024 * 1024);
		}, 240_000);

		it("captures every nested repository and keeps their deltas separate", async () => {
			const repo = await initRepo();
			const names = ["one", "two", "three"];
			for (const name of names) {
				const nested = path.join(repo, name);
				await fs.mkdir(nested, { recursive: true });
				await runGit(nested, ["init", "-q", "-b", "main"]);
				await runGit(nested, ["config", "user.email", "test@example.com"]);
				await runGit(nested, ["config", "user.name", "Test User"]);
				await fs.writeFile(path.join(nested, "seed.txt"), `${name} seed\n`);
				await runGit(nested, ["add", "."]);
				await runGit(nested, ["commit", "-q", "-m", "seed"]);
			}

			const baseline = await captureBaseline(repo);
			expect(baseline.nested.map(entry => entry.relativePath)).toEqual(["one", "three", "two"]);

			await fs.writeFile(path.join(repo, "two", "seed.txt"), "two changed\n");
			const delta = await captureDeltaPatch(repo, baseline);

			expect(delta.nestedPatches).toHaveLength(1);
			expect(delta.nestedPatches[0].relativePath).toBe("two");
			expect(delta.nestedPatches[0].patch).toContain("+two changed");
		});
	});
});
