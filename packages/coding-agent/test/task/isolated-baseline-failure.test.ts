import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	captureBaseline,
	captureIsolatedPatchResult,
	DEFAULT_BASELINE_LIMITS,
	getRepoRoot,
	isolatedRepositoryFailureMessage,
	releaseBaseline,
} from "@oh-my-pi/pi-coding-agent/task/worktree";

async function runGit(cwd: string, args: string[]): Promise<void> {
	const proc = Bun.spawn(["git", ...args], { cwd, stderr: "pipe", stdout: "ignore", windowsHide: true });
	const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
	if ((exitCode ?? 0) !== 0) throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
}

describe("isolated baseline failure classification", () => {
	let root: string;
	let repo: string;
	let plainDir: string;
	const originalTmpdir = process.env.TMPDIR;

	beforeAll(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-baseline-failure-"));
		plainDir = path.join(root, "not-a-repo");
		repo = path.join(root, "repo");
		await Promise.all([fs.mkdir(plainDir), fs.mkdir(repo)]);
		await runGit(repo, ["init", "-q", "-b", "main"]);
		await runGit(repo, ["config", "user.email", "test@example.com"]);
		await runGit(repo, ["config", "user.name", "Test User"]);
		await fs.writeFile(path.join(repo, "tracked.txt"), "base\n");
		await runGit(repo, ["add", "."]);
		await runGit(repo, ["commit", "-q", "-m", "initial"]);
	});

	afterEach(() => {
		if (originalTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = originalTmpdir;
	});

	afterAll(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("formats only the missing-repository error reported by getRepoRoot", async () => {
		let repoFailure: unknown;
		try {
			await getRepoRoot(plainDir);
		} catch (err) {
			repoFailure = err;
		}

		const message = isolatedRepositoryFailureMessage(repoFailure);
		expect(message).toContain("Isolated task execution requires a git repository.");
		expect(message).toContain(plainDir);
	});

	it("rethrows a real non-git capture failure verbatim", async () => {
		const blocker = path.join(root, "blocker");
		await fs.writeFile(blocker, "not a directory\n");
		process.env.TMPDIR = path.join(blocker, "tmp");

		let captureFailure: unknown;
		try {
			await captureBaseline(repo);
		} catch (err) {
			captureFailure = err;
		}
		expect(captureFailure).toBeInstanceOf(Error);

		let propagated: unknown;
		try {
			isolatedRepositoryFailureMessage(captureFailure);
		} catch (err) {
			propagated = err;
		}

		expect(propagated).toBe(captureFailure);
		const message = propagated instanceof Error ? propagated.message : String(propagated);
		expect(message).toContain("ENOTDIR");
		expect(message).not.toContain("requires a git repository");
	});

	it("returns an explicit task-layer failure for new oversized output", async () => {
		const artifactsDir = path.join(root, "artifacts");
		const oversizedPath = path.join(repo, "task-oversized.bin");
		await fs.mkdir(artifactsDir, { recursive: true });
		const baseline = await captureBaseline(repo);
		try {
			await fs.writeFile(oversizedPath, "");
			await fs.truncate(oversizedPath, DEFAULT_BASELINE_LIMITS.maxUntrackedFileBytes + 1);
			const result = await captureIsolatedPatchResult({
				isolationDir: repo,
				baseline,
				artifactsDir,
				agentId: "oversized-output",
			});

			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("Expected oversized output capture to fail.");
			expect(result.error).toContain("Patch capture failed: Current task snapshot excluded 1 untracked file");
			expect(result.error).toContain("Task output was not captured");
			expect(result.error).not.toContain("No changes to apply");
			expect(await Bun.file(path.join(artifactsDir, "oversized-output.patch")).exists()).toBe(false);
		} finally {
			await releaseBaseline(baseline);
			await Promise.all([
				fs.rm(oversizedPath, { force: true }),
				fs.rm(artifactsDir, { recursive: true, force: true }),
			]);
		}
	});

	it("removes a partial artifact when cancellation lands during its write", async () => {
		const artifactsDir = path.join(root, "artifact-abort");
		const trackedPath = path.join(repo, "artifact-large.txt");
		const patchPath = path.join(artifactsDir, "artifact-abort.patch");
		await fs.mkdir(artifactsDir, { recursive: true });
		await fs.writeFile(trackedPath, Buffer.alloc(16 * 1024 * 1024, 97));
		await runGit(repo, ["add", "artifact-large.txt"]);
		await runGit(repo, ["commit", "-q", "-m", "large-artifact-base"]);
		const baseline = await captureBaseline(repo);
		const captureController = new AbortController();
		const watchController = new AbortController();
		const watcher = (async (): Promise<void> => {
			try {
				for await (const event of fs.watch(artifactsDir, { signal: watchController.signal })) {
					if (event.filename !== path.basename(patchPath) || event.eventType !== "change") continue;
					captureController.abort(new Error("artifact-write barrier"));
					return;
				}
			} catch (error) {
				if (!watchController.signal.aborted) throw error;
			}
		})();
		try {
			await fs.writeFile(trackedPath, Buffer.alloc(16 * 1024 * 1024, 98));
			const result = await captureIsolatedPatchResult({
				isolationDir: repo,
				baseline,
				artifactsDir,
				agentId: "artifact-abort",
				signal: captureController.signal,
			});
			watchController.abort();
			await watcher;

			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("Expected artifact capture to be aborted.");
			expect(result.aborted).toBe(true);
			expect(result.error).toContain("artifact-write barrier");
			expect(await Bun.file(patchPath).exists()).toBe(false);
			const leftovers = (await fs.readdir(artifactsDir)).filter(name => name.startsWith("artifact-abort.patch"));
			expect(leftovers).toEqual([]);
		} finally {
			watchController.abort();
			await watcher;
			await releaseBaseline(baseline);
			await fs.rm(artifactsDir, { recursive: true, force: true });
		}
	}, 120_000);
});
