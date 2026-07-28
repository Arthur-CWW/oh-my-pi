import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as git from "../../src/utils/git";
import { DIAGNOSTIC_STREAM_CAP_BYTES, readCapped } from "@oh-my-pi/pi-utils";

// A fake `git` on PATH that emits a caller-controlled number of stdout bytes,
// a caller-controlled stderr payload, and a caller-controlled exit code. Real
// git cannot be steered that precisely, and these tests are about the reader's
// byte accounting, not about git itself.
const SHIM = `#!/bin/sh
bytes="\${GIT_SHIM_BYTES:-0}"
if [ "$bytes" -gt 0 ]; then
  head -c "$bytes" /dev/zero | tr '\\0' 'a'
fi
if [ -n "\${GIT_SHIM_STDERR:-}" ]; then
  printf '%s' "$GIT_SHIM_STDERR" >&2
fi
exit "\${GIT_SHIM_EXIT:-0}"
`;

let root: string;
let workDir: string;
let shimPath: string;

interface ChildMeasurement {
	readonly totalBytes: number;
	readonly retainedBytes: number;
	readonly truncated: boolean;
	/** Process-wide high-water RSS reported by `getrusage`, in KiB on nixbox. */
	readonly maxRssKiB: number;
}

async function measureChild(totalBytes: number, capBytes: number): Promise<ChildMeasurement> {
	const child = Bun.spawn(
		[
			process.execPath,
			path.join(import.meta.dir, "fixtures", "git-capped-output-child.ts"),
			workDir,
			String(totalBytes),
			String(capBytes),
		],
		{
			env: { ...process.env, PATH: shimPath },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		readCapped(child.stdout, DIAGNOSTIC_STREAM_CAP_BYTES),
		readCapped(child.stderr, DIAGNOSTIC_STREAM_CAP_BYTES),
		child.exited,
	]);
	if (stdout.truncated || stderr.truncated) throw new Error("measurement child output exceeded its diagnostic cap");
	if (exitCode !== 0) throw new Error(`measurement child exited ${exitCode}: ${stderr.text}`);
	return JSON.parse(stdout.text) as ChildMeasurement;
}

beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "git-capped-"));
	workDir = path.join(root, "cwd");
	const shimDir = path.join(root, "bin");
	await fs.mkdir(workDir, { recursive: true });
	await fs.mkdir(shimDir, { recursive: true });
	const shim = path.join(shimDir, "git");
	await Bun.write(shim, SHIM);
	await fs.chmod(shim, 0o755);
	shimPath = `${shimDir}${path.delimiter}${process.env.PATH ?? ""}`;
});

afterAll(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

function shimEnv(overrides: Record<string, string> = {}): Record<string, string> {
	return { PATH: shimPath, ...overrides };
}

describe("git() stdout budget", () => {
	test("output below the cap is returned verbatim with no marker", async () => {
		const result = await git.run(workDir, ["shim"], {
			env: shimEnv({ GIT_SHIM_BYTES: "5000" }),
			maxStdoutBytes: 64 * 1024,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout.length).toBe(5000);
		expect(result.stdout).not.toContain("truncated");
		expect(result.stdoutTruncated).toBe(false);
		expect(result.stdoutBytes).toBe(5000);
	});

	test("output above the cap truncates at the cap and says so", async () => {
		const cap = 4096;
		const result = await git.run(workDir, ["shim"], {
			env: shimEnv({ GIT_SHIM_BYTES: "1000000" }),
			maxStdoutBytes: cap,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdoutTruncated).toBe(true);
		expect(result.stdoutBytes).toBe(1_000_000);
		expect(result.stdout.endsWith("\n[stdout truncated: kept 4096 of 1000000 bytes]")).toBe(true);
		expect(result.stdout.slice(0, cap)).toBe("a".repeat(cap));
	});

	test("child high-water RSS and retained stdout stay bounded while output grows 100x", async () => {
		const cap = 8192;
		const small = await measureChild(1_000_000, cap);
		const large = await measureChild(100_000_000, cap);
		expect(small).toMatchObject({ totalBytes: 1_000_000, retainedBytes: cap, truncated: true });
		expect(large).toMatchObject({ totalBytes: 100_000_000, retainedBytes: cap, truncated: true });
		expect(large.totalBytes).toBe(100 * small.totalBytes);
		expect(large.retainedBytes).toBe(small.retainedBytes);
		// maxRSS is a process-wide high-water mark: it includes Bun startup/JIT,
		// allocator arenas, and OS pipe buffers, so it cannot measure the reader's
		// exact allocation. Separate child processes avoid allocator-release noise;
		// the exact retained-byte assertions above are the correctness invariant.
		expect(large.maxRssKiB).toBeLessThanOrEqual(small.maxRssKiB + 32 * 1024);
	});

	test("the default cap applies when the caller sets none", async () => {
		const cap = 8 * 1024 * 1024;
		const totalBytes = cap + 4096;
		const result = await git.run(workDir, ["shim"], { env: shimEnv({ GIT_SHIM_BYTES: String(totalBytes) }) });
		expect(result.stdoutTruncated).toBe(true);
		expect(result.stdoutKeptBytes).toBeLessThanOrEqual(cap);
		expect(result.stdoutKeptBytes).toBe(cap);
		expect(result.stdoutBytes).toBe(totalBytes);
		expect(result.stdout.endsWith(`\n[stdout truncated: kept ${cap} of ${totalBytes} bytes]`)).toBe(true);
	});
});

describe("git() exit code and stderr", () => {
	test("a non-zero exit and its stderr survive the capped read", async () => {
		const result = await git.run(workDir, ["shim"], {
			env: shimEnv({
				GIT_SHIM_BYTES: "16",
				GIT_SHIM_STDERR: "fatal: not a git repository",
				GIT_SHIM_EXIT: "128",
			}),
		});
		expect(result.exitCode).toBe(128);
		expect(result.stderr).toBe("fatal: not a git repository");
		expect(result.stdout).toBe("a".repeat(16));
	});

	test("a truncating child still reports its exit code instead of deadlocking", async () => {
		const result = await git.run(workDir, ["shim"], {
			env: shimEnv({ GIT_SHIM_BYTES: "20000000", GIT_SHIM_STDERR: "boom", GIT_SHIM_EXIT: "3" }),
			maxStdoutBytes: 1024,
		});
		expect(result.exitCode).toBe(3);
		expect(result.stderr).toBe("boom");
		expect(result.stdoutTruncated).toBe(true);
		expect(result.stdoutBytes).toBe(20_000_000);
	});

	test("stderr past its own cap is marked rather than silently clipped", async () => {
		const stderrPayload = "e".repeat(70 * 1024);
		const result = await git.run(workDir, ["shim"], { env: shimEnv({ GIT_SHIM_STDERR: stderrPayload }) });
		expect(result.stderr.startsWith("e".repeat(64 * 1024))).toBe(true);
		expect(result.stderr.endsWith(`\n[stderr truncated: kept 65536 of ${70 * 1024} bytes]`)).toBe(true);
	});
});

describe("git() stdout spill opt-out", () => {
	test("stdoutFile returns a path and a file holding every byte", async () => {
		const target = path.join(root, "full-stdout.bin");
		const result = await git.run(workDir, ["shim"], {
			env: shimEnv({ GIT_SHIM_BYTES: "3000000" }),
			stdoutFile: target,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdoutPath).toBe(target);
		expect(result.stdoutBytes).toBe(3_000_000);
		expect(result.stdout).toBe(`[stdout spilled to ${target} (3000000 bytes)]`);
		expect(Bun.file(target).size).toBe(3_000_000);
	});

	test("spilling keeps stderr and the exit code intact", async () => {
		const target = path.join(root, "failing-stdout.bin");
		const result = await git.run(workDir, ["shim"], {
			env: shimEnv({ GIT_SHIM_BYTES: "1024", GIT_SHIM_STDERR: "spill-stderr", GIT_SHIM_EXIT: "7" }),
			stdoutFile: target,
		});
		expect(result.exitCode).toBe(7);
		expect(result.stderr).toBe("spill-stderr");
		expect(result.stdoutPath).toBe(target);
		expect(Bun.file(target).size).toBe(1024);
	});
});
