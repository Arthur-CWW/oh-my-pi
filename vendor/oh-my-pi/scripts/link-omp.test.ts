import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const script = path.join(import.meta.dir, "link-omp.sh");
const repoRoot = path.resolve(import.meta.dir, "..");
const temporaryRoots: string[] = [];

function canonicalPath(file: string): string {
	return fs.realpathSync(file);
}

function temporaryRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-link-test-"));
	temporaryRoots.push(root);
	return root;
}

function executable(file: string, body: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `#!/bin/sh\nset -eu\n${body}\n`);
	fs.chmodSync(file, 0o755);
}

function candidate(root: string, name: string, behavior = ""): string {
	const file = path.join(root, name);
	executable(
		file,
		`case \"${"$"}{1:-}\" in\n  --version) printf '%s\\n' fixture-1.0.0 ;;\n  --help) printf '%s\\n' fixture-help ;;\n  --smoke-test) printf '%s\\n' fixture-smoke ;;\n  *) ${behavior || "printf '%s\\n' fixture-run"} ;;\nesac`,
	);
	return file;
}

function run(root: string, args: string[], environment: Record<string, string> = {}) {
	const bin = path.join(root, "global bin");
	fs.mkdirSync(path.join(root, "home"), { recursive: true });
	fs.mkdirSync(bin, { recursive: true });
	return Bun.spawnSync(["bash", script, ...args], {
		cwd: root,
		env: {
			...process.env,
			HOME: path.join(root, "home"),
			OMP_LINK_GLOBAL_BIN: bin,
			OMP_LINK_REPO_ROOT: repoRoot,
			...environment,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

function runWithDefaultBin(root: string, args: string[]) {
	const home = path.join(root, "home");
	fs.mkdirSync(home, { recursive: true });
	const environment: Record<string, string | undefined> = {
		...process.env,
		HOME: home,
		OMP_LINK_REPO_ROOT: repoRoot,
		PATH: "/usr/bin:/bin",
	};
	delete environment.OMP_LINK_GLOBAL_BIN;
	delete environment.BUN_INSTALL;
	return Bun.spawnSync(["/bin/bash", script, ...args], {
		cwd: root,
		env: environment,
		stdout: "pipe",
		stderr: "pipe",
	});
}


afterAll(() => {
	for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe("link-omp", () => {
	it("keeps the stable command intact when installing the dev launcher", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const stable = candidate(root, "existing-omp");
		fs.mkdirSync(bin, { recursive: true });
		fs.symlinkSync(stable, path.join(bin, "omp"));

		const result = run(root, ["dev"]);
		expect(result.exitCode).toBe(0);
		expect(fs.readlinkSync(path.join(bin, "omp"))).toBe(stable);
		expect(canonicalPath(path.join(bin, "omp-dev"))).toBe(canonicalPath(path.join(repoRoot, "packages", "coding-agent", "scripts", "omp")));
	});

	it("falls back to HOME's Bun bin when no global-bin override is supplied", () => {
		const root = temporaryRoot();
		const result = runWithDefaultBin(root, ["dev"]);

		expect(result.exitCode).toBe(0);
		expect(canonicalPath(path.join(root, "home", ".bun", "bin", "omp-dev"))).toBe(canonicalPath(path.join(repoRoot, "packages", "coding-agent", "scripts", "omp")));
	});

	it("rejects a missing stable candidate without changing the active command", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const current = candidate(root, "current");
		fs.mkdirSync(bin, { recursive: true });
		fs.symlinkSync(current, path.join(bin, "omp"));


		const result = run(root, ["stable", path.join(root, "missing")]);
		expect(result.exitCode).not.toBe(0);
		expect(canonicalPath(path.join(bin, "omp"))).toBe(canonicalPath(current));
	});

	it("promotes the first validated candidate without requiring a fallback", () => {
		const root = temporaryRoot();
		const next = candidate(root, "first-stable");

		const result = run(root, ["stable", next]);
		const bin = path.join(root, "global bin");
		expect(result.exitCode).toBe(0);
		expect(canonicalPath(path.join(bin, "omp"))).toBe(canonicalPath(next));
		expect(fs.existsSync(path.join(bin, "omp.previous"))).toBeFalse();
	});

	it("rejects candidates that fail validation without changing the active command", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const current = candidate(root, "current");
		const broken = path.join(root, "broken");
		executable(broken, "case \"$1\" in --version) exit 19 ;; *) exit 0 ;; esac");
		fs.mkdirSync(bin, { recursive: true });
		fs.symlinkSync(current, path.join(bin, "omp"));

		const result = run(root, ["stable", broken]);
		expect(result.exitCode).not.toBe(0);
		expect(canonicalPath(path.join(bin, "omp"))).toBe(canonicalPath(current));
		expect(fs.existsSync(path.join(bin, "omp.previous"))).toBeFalse();
	});

	it("preserves both active and backup links when version validation fails", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const active = candidate(root, "active");
		const backup = candidate(root, "backup");
		const rejected = path.join(root, "version-rejected");
		executable(rejected, "case \"$1\" in --version) exit 41 ;; *) exit 0 ;; esac");
		fs.mkdirSync(bin, { recursive: true });
		fs.symlinkSync(active, path.join(bin, "omp"));
		fs.symlinkSync(backup, path.join(bin, "omp.previous"));

		const result = run(root, ["stable", rejected]);
		expect(result.exitCode).not.toBe(0);
		expect(canonicalPath(path.join(bin, "omp"))).toBe(canonicalPath(active));
		expect(canonicalPath(path.join(bin, "omp.previous"))).toBe(canonicalPath(backup));
	});

	it("preserves both active and backup links when smoke validation fails", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const active = candidate(root, "active");
		const backup = candidate(root, "backup");
		const rejected = path.join(root, "smoke-rejected");
		executable(rejected, "case \"$1\" in --smoke-test) exit 43 ;; *) exit 0 ;; esac");
		fs.mkdirSync(bin, { recursive: true });
		fs.symlinkSync(active, path.join(bin, "omp"));
		fs.symlinkSync(backup, path.join(bin, "omp.previous"));

		const result = run(root, ["stable", rejected]);
		expect(result.exitCode).not.toBe(0);
		expect(canonicalPath(path.join(bin, "omp"))).toBe(canonicalPath(active));
		expect(canonicalPath(path.join(bin, "omp.previous"))).toBe(canonicalPath(backup));
	});

	it("promotes a validated candidate atomically and retains the previous stable command", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const previous = candidate(root, "previous");
		const next = candidate(root, "next");
		fs.mkdirSync(bin, { recursive: true });
		fs.symlinkSync(previous, path.join(bin, "omp"));

		const result = run(root, ["stable", next]);
		expect(result.exitCode).toBe(0);
		expect(canonicalPath(path.join(bin, "omp"))).toBe(canonicalPath(next));
		expect(canonicalPath(path.join(bin, "omp.previous"))).toBe(canonicalPath(previous));
	});

	it("rolls back to the retained stable command without discarding the failed candidate", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const previous = candidate(root, "previous");
		const failed = candidate(root, "failed");
		fs.mkdirSync(bin, { recursive: true });
		fs.symlinkSync(failed, path.join(bin, "omp"));
		fs.symlinkSync(previous, path.join(bin, "omp.previous"));

		const result = run(root, ["rollback"]);
		expect(result.exitCode).toBe(0);
		expect(canonicalPath(path.join(bin, "omp"))).toBe(canonicalPath(previous));
		expect(canonicalPath(path.join(bin, "omp.failed"))).toBe(canonicalPath(failed));
	});

	it("refuses rollback when no backup exists and leaves the active command intact", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const active = candidate(root, "active");
		fs.mkdirSync(bin, { recursive: true });
		fs.symlinkSync(active, path.join(bin, "omp"));

		const result = run(root, ["rollback"]);
		expect(result.exitCode).not.toBe(0);
		expect(canonicalPath(path.join(bin, "omp"))).toBe(canonicalPath(active));
	});

	it("supports global-bin and candidate paths containing spaces", () => {
		const root = temporaryRoot();
		const next = candidate(root, "candidate with spaces");
		const result = run(root, ["stable", next]);
		const bin = path.join(root, "global bin");
		expect(result.exitCode).toBe(0);
		expect(canonicalPath(path.join(bin, "omp"))).toBe(canonicalPath(next));
	});

	it("falls back to HOME's empty Bun bin for a stable promotion", () => {
		const root = temporaryRoot();
		const next = candidate(root, "fallback-candidate");

		const result = runWithDefaultBin(root, ["stable", next]);
		expect(result.exitCode).toBe(0);
		expect(canonicalPath(path.join(root, "home", ".bun", "bin", "omp"))).toBe(canonicalPath(next));
	});
});
