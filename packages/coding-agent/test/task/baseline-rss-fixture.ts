import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	type BaselineLimits,
	captureBaseline,
	DEFAULT_BASELINE_LIMITS,
	releaseBaseline,
	type WorktreeBaseline,
} from "@oh-my-pi/pi-coding-agent/task/worktree";

async function runGit(cwd: string, args: string[]): Promise<void> {
	const proc = Bun.spawn(["git", ...args], { cwd, stderr: "pipe", stdout: "ignore", windowsHide: true });
	const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
	if ((exitCode ?? 0) !== 0) throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
}

async function initRepo(repo: string): Promise<void> {
	await runGit(repo, ["init", "-q", "-b", "main"]);
	await runGit(repo, ["config", "user.email", "test@example.com"]);
	await runGit(repo, ["config", "user.name", "Test User"]);
	await runGit(repo, ["config", "core.pager", ""]);
	await runGit(repo, ["config", "diff.external", ""]);
	await fs.writeFile(path.join(repo, "tracked.txt"), "base\n");
	await runGit(repo, ["add", "."]);
	await runGit(repo, ["commit", "-q", "-m", "initial"]);
}

async function writeRepeated(filePath: string, bytes: number, fill = 0xa5): Promise<void> {
	const writer = Bun.file(filePath).writer();
	const chunk = Buffer.alloc(64 * 1024, fill);
	try {
		let chunks = 0;
		for (let remaining = bytes; remaining > 0; remaining -= chunk.byteLength) {
			writer.write(remaining >= chunk.byteLength ? chunk : chunk.subarray(0, remaining));
			chunks += 1;
			if (chunks % 256 === 0) await writer.flush();
		}
	} finally {
		await writer.end();
	}
}

interface ObservedPart {
	readonly patchDir: string;
	readonly partsDirMode: number;
	readonly partMode: number;
}

async function waitForPartFile(tmpRoot: string, timeoutMs: number): Promise<ObservedPart | null> {
	const deadline = performance.now() + timeoutMs;
	while (performance.now() < deadline) {
		let captureDirs: string[];
		try {
			captureDirs = (await fs.readdir(tmpRoot)).filter(entry => entry.startsWith("omp-task-baseline-"));
		} catch {
			captureDirs = [];
		}
		for (const captureDir of captureDirs) {
			const patchDir = path.join(tmpRoot, captureDir);
			try {
				const partsDirs = (await fs.readdir(patchDir)).filter(entry => entry.endsWith("-parts"));
				for (const partsDirName of partsDirs) {
					const partsDir = path.join(patchDir, partsDirName);
					const part = (await fs.readdir(partsDir)).find(entry => entry.endsWith(".patch"));
					if (!part) continue;
					const [partsStat, partStat] = await Promise.all([fs.stat(partsDir), fs.stat(path.join(partsDir, part))]);
					return { patchDir, partsDirMode: partsStat.mode & 0o777, partMode: partStat.mode & 0o777 };
				}
			} catch {
				// Capture can remove one completed chunk while this observer is reading it.
			}
		}
		await Bun.sleep(2);
	}
	return null;
}

async function writeManyFiles(repo: string, prefix: string, count: number, bytes: number): Promise<void> {
	for (let start = 0; start < count; start += 32) {
		await Promise.all(
			Array.from({ length: Math.min(32, count - start) }, (_unused, offset) => {
				const index = start + offset;
				return writeRepeated(path.join(repo, `${prefix}-${index.toString().padStart(3, "0")}.bin`), bytes, index);
			}),
		);
	}
}

async function runPermissionsFixture(): Promise<void> {
	const originalUmask = process.umask(0);
	const repo = await fs.mkdtemp(path.join(os.tmpdir(), "omp-baseline-permissions-"));
	try {
		await initRepo(repo);
		await fs.writeFile(path.join(repo, "tracked.txt"), "changed\n");
		await writeManyFiles(repo, "part", 256, 32 * 1024);
		const limits: BaselineLimits = {
			...DEFAULT_BASELINE_LIMITS,
			maxUntrackedFileBytes: 64 * 1024,
			maxUntrackedTotalBytes: 8 * 1024 * 1024,
			untrackedConcurrency: 1,
		};
		const pending = captureBaseline(repo, limits);
		const observed = await waitForPartFile(os.tmpdir(), 10_000);
		const baseline = await pending;
		try {
			const patchPaths = [
				baseline.root.stagedPatchPath,
				baseline.root.unstagedPatchPath,
				baseline.root.untracked.patchPath,
			].filter((entry): entry is string => entry !== null);
			const patchModes = await Promise.all(patchPaths.map(async entry => (await fs.stat(entry)).mode & 0o777));
			process.stdout.write(
				`${JSON.stringify({
					patchDirMode: (await fs.stat(baseline.patchDir)).mode & 0o777,
					patchModes,
					partsDirMode: observed?.partsDirMode ?? null,
					partMode: observed?.partMode ?? null,
				})}\n`,
			);
		} finally {
			await releaseBaseline(baseline);
		}
	} finally {
		process.umask(originalUmask);
		await fs.rm(repo, { recursive: true, force: true });
	}
}

async function runAbortFixture(): Promise<void> {
	const repo = await fs.mkdtemp(path.join(os.tmpdir(), "omp-baseline-abort-"));
	try {
		await initRepo(repo);
		await writeManyFiles(repo, "blocked", 128, 512 * 1024);
		const limits: BaselineLimits = { ...DEFAULT_BASELINE_LIMITS, untrackedConcurrency: 1 };
		const controller = new AbortController();
		const pending = captureBaseline(repo, limits, controller.signal);
		const observed = await waitForPartFile(os.tmpdir(), 10_000);
		const abortAt = performance.now();
		controller.abort(new Error("abort-fixture"));
		let baseline: WorktreeBaseline | undefined;
		let captureError: unknown;
		try {
			baseline = await pending;
		} catch (error) {
			captureError = error;
		}
		const cleanupLatencyMs = performance.now() - abortAt;
		if (baseline) await releaseBaseline(baseline);
		let patchDirRemoved = false;
		if (observed) {
			try {
				await fs.access(observed.patchDir);
			} catch {
				patchDirRemoved = true;
			}
		}
		process.stdout.write(
			`${JSON.stringify({
				partObserved: observed !== null,
				aborted: captureError instanceof Error && captureError.message === "abort-fixture",
				cleanupLatencyMs,
				patchDirRemoved,
			})}\n`,
		);
	} finally {
		await fs.rm(repo, { recursive: true, force: true });
	}
}

async function runRssFixture(trackedFiles: number, untrackedBytes: number): Promise<void> {
	const repo = await fs.mkdtemp(path.join(os.tmpdir(), "omp-baseline-rss-"));
	try {
		await runGit(repo, ["init", "-q", "-b", "main"]);
		await runGit(repo, ["config", "user.email", "test@example.com"]);
		await runGit(repo, ["config", "user.name", "Test User"]);
		await fs.writeFile(path.join(repo, ".gitignore"), "nested-*/\n");
		const seed = "x".repeat(1024);
		for (let start = 0; start < trackedFiles; start += 128) {
			await Promise.all(
				Array.from({ length: Math.min(128, trackedFiles - start) }, (_unused, offset) =>
					fs.writeFile(path.join(repo, `tracked-${start + offset}.txt`), `base ${seed}\n`),
				),
			);
		}
		await runGit(repo, ["add", "."]);
		await runGit(repo, ["commit", "-q", "-m", "initial"]);

		for (let start = 0; start < trackedFiles; start += 128) {
			await Promise.all(
				Array.from({ length: Math.min(128, trackedFiles - start) }, (_unused, offset) =>
					fs.writeFile(path.join(repo, `tracked-${start + offset}.txt`), `changed ${seed}\n`),
				),
			);
		}
		await writeRepeated(path.join(repo, "oversized-a.bin"), untrackedBytes);
		await writeRepeated(path.join(repo, "oversized-b.bin"), untrackedBytes);

		for (let index = 0; index < 3; index += 1) {
			const nested = path.join(repo, `nested-${index}`);
			await fs.mkdir(nested);
			await runGit(nested, ["init", "-q", "-b", "main"]);
			await runGit(nested, ["config", "user.email", "test@example.com"]);
			await runGit(nested, ["config", "user.name", "Test User"]);
			await fs.writeFile(path.join(nested, "tracked.txt"), "base\n");
			await runGit(nested, ["add", "."]);
			await runGit(nested, ["commit", "-q", "-m", "initial"]);
			await fs.writeFile(path.join(nested, "tracked.txt"), `changed ${index}\n`);
		}

		Bun.gc(true);
		const startRss = process.memoryUsage().rss;
		let peakRss = startRss;
		const sampler = setInterval(() => {
			peakRss = Math.max(peakRss, process.memoryUsage().rss);
		}, 2);
		const baseline = await captureBaseline(repo);
		clearInterval(sampler);
		peakRss = Math.max(peakRss, process.memoryUsage().rss);
		const result = {
			trackedFiles,
			untrackedBytes,
			peakDeltaBytes: Math.max(0, peakRss - startRss),
			nestedRepos: baseline.nested.length,
			excludedCount: baseline.root.untracked.excludedCount,
			warnings: baseline.warnings.length,
		};
		await releaseBaseline(baseline);
		process.stdout.write(`${JSON.stringify(result)}\n`);
	} finally {
		await fs.rm(repo, { recursive: true, force: true });
	}
}

const mode = process.argv[2] ?? "";
if (mode === "permissions") {
	await runPermissionsFixture();
} else if (mode === "abort") {
	await runAbortFixture();
} else {
	const trackedFiles = Number.parseInt(mode, 10);
	const untrackedBytes = Number.parseInt(process.argv[3] ?? "0", 10);
	if (
		!Number.isSafeInteger(trackedFiles) ||
		trackedFiles < 1 ||
		!Number.isSafeInteger(untrackedBytes) ||
		untrackedBytes < 1
	) {
		throw new Error("usage: baseline-rss-fixture.ts <tracked-files> <untracked-bytes> | permissions | abort");
	}
	await runRssFixture(trackedFiles, untrackedBytes);
}
