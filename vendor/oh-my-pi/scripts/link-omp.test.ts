import { afterAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const script = path.join(import.meta.dir, "link-omp.sh");
const repoRoot = path.resolve(import.meta.dir, "..");
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-link-test-"));
	temporaryRoots.push(root);
	return root;
}

function checksum(file: string): string {
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function releasePath(bin: string, file: string): string {
	return path.join(bin, ".omp-releases", `omp-${checksum(file)}`);
}

function linkTarget(link: string): string {
	return fs.realpathSync(fs.readlinkSync(link));
}

function executable(file: string, body: string): string {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `#!/bin/sh\nset -eu\n${body}\n`);
	fs.chmodSync(file, 0o755);
	return file;
}

function candidate(root: string, name: string, output = "fixture-A"): string {
	return executable(
		path.join(root, name),
		`case "${"$"}{1:-}" in
  --version) printf '%s\\n' fixture-version ;;
  --help) printf '%s\\n' fixture-help ;;
  --smoke-test) printf '%s\\n' fixture-smoke ;;
  *) printf '%s\\n' '${output}' ;;
esac`,
	);
}

function run(root: string, args: string[]) {
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
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

function runInstalled(root: string): string {
	const result = Bun.spawnSync([path.join(root, "global bin", "omp")], {
		cwd: root,
		env: { ...process.env, HOME: path.join(root, "home") },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(result.exitCode).toBe(0);
	return new TextDecoder().decode(result.stdout).trim();
}

afterAll(() => {
	for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe("link-omp immutable stable promotion", () => {
	it("keeps the source-only development launcher separate from omp", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const existing = candidate(root, "existing");
		fs.mkdirSync(bin, { recursive: true });
		fs.symlinkSync(existing, path.join(bin, "omp"));

		const result = run(root, ["dev"]);
		expect(result.exitCode).toBe(0);
		expect(linkTarget(path.join(bin, "omp"))).toBe(fs.realpathSync(existing));
		expect(fs.realpathSync(path.join(bin, "omp-dev"))).toBe(
			fs.realpathSync(path.join(repoRoot, "packages", "coding-agent", "scripts", "omp")),
		);
	});

	it("keeps promoted bytes runnable after its candidate is overwritten and deleted", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const source = candidate(root, "candidate with spaces", "A");
		const sourceDigest = checksum(source);

		expect(run(root, ["stable", source]).exitCode).toBe(0);
		const release = releasePath(bin, source);
		expect(linkTarget(path.join(bin, "omp"))).toBe(fs.realpathSync(release));
		expect(runInstalled(root)).toBe("A");
		const installedDigest = checksum(release);

		candidate(root, "candidate with spaces", "B");
		expect(checksum(release)).toBe(installedDigest);
		expect(runInstalled(root)).toBe("A");
		fs.rmSync(source);
		expect(checksum(release)).toBe(sourceDigest);
		expect(runInstalled(root)).toBe("A");
	});

	it("leaves the stable release unchanged when malformed B fails staged smoke validation", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const a = candidate(root, "A", "A");
		expect(run(root, ["stable", a]).exitCode).toBe(0);
		const releaseA = releasePath(bin, a);
		const malformedB = executable(
			path.join(root, "B"),
			`case "${"$"}{1:-}" in --smoke-test) exit 43 ;; *) exit 0 ;; esac`,
		);

		expect(run(root, ["stable", malformedB]).exitCode).not.toBe(0);
		expect(linkTarget(path.join(bin, "omp"))).toBe(fs.realpathSync(releaseA));
		expect(fs.existsSync(path.join(bin, "omp.previous"))).toBeFalse();
		expect(runInstalled(root)).toBe("A");
	});

	it("imports legacy stable symlink and file bytes before promoting B, preserving A for rollback", () => {
		for (const stableKind of ["symlink", "file"] as const) {
			const root = temporaryRoot();
			const bin = path.join(root, "global bin");
			const legacyA = candidate(root, `${stableKind}-A`, "A");
			const b = candidate(root, `${stableKind}-B`, "B");
			const stable = path.join(bin, "omp");
			fs.mkdirSync(bin, { recursive: true });
			if (stableKind === "symlink") fs.symlinkSync(legacyA, stable);
			else fs.copyFileSync(legacyA, stable);
			if (stableKind === "file") fs.chmodSync(stable, 0o755);

			const importedA = releasePath(bin, legacyA);
			const importedDigest = checksum(legacyA);
			expect(run(root, ["stable", b]).exitCode).toBe(0);
			const releaseB = releasePath(bin, b);
			expect(linkTarget(stable)).toBe(fs.realpathSync(releaseB));
			expect(linkTarget(path.join(bin, "omp.previous"))).toBe(fs.realpathSync(importedA));

			candidate(root, `${stableKind}-A`, "mutated-A");
			expect(checksum(legacyA)).not.toBe(importedDigest);
			expect(checksum(importedA)).toBe(importedDigest);
			expect(run(root, ["rollback"]).exitCode).toBe(0);
			expect(linkTarget(stable)).toBe(fs.realpathSync(importedA));
			expect(runInstalled(root)).toBe("A");
		}
	});

	it("retains A as N-1 after B and atomically rolls back while preserving B inspectably", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const a = candidate(root, "A", "A");
		const b = candidate(root, "B", "B");
		expect(run(root, ["stable", a]).exitCode).toBe(0);
		const releaseA = releasePath(bin, a);
		expect(run(root, ["stable", b]).exitCode).toBe(0);
		const releaseB = releasePath(bin, b);
		expect(linkTarget(path.join(bin, "omp"))).toBe(fs.realpathSync(releaseB));
		expect(linkTarget(path.join(bin, "omp.previous"))).toBe(fs.realpathSync(releaseA));

		expect(run(root, ["rollback"]).exitCode).toBe(0);
		expect(linkTarget(path.join(bin, "omp"))).toBe(fs.realpathSync(releaseA));
		expect(linkTarget(path.join(bin, "omp.failed"))).toBe(fs.realpathSync(releaseB));
		expect(fs.existsSync(path.join(bin, "omp.previous"))).toBeFalse();
		expect(runInstalled(root)).toBe("A");
	});

	it("reuses an identical immutable A release without creating a backup", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const a = candidate(root, "A", "A");
		expect(run(root, ["stable", a]).exitCode).toBe(0);
		const releaseA = releasePath(bin, a);

		expect(run(root, ["stable", a]).exitCode).toBe(0);
		expect(linkTarget(path.join(bin, "omp"))).toBe(fs.realpathSync(releaseA));
		expect(fs.existsSync(path.join(bin, "omp.previous"))).toBeFalse();
	});

	it("refuses a corrupt content-addressed collision without changing stable", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const a = candidate(root, "A", "A");
		const collision = releasePath(bin, a);
		executable(collision, "exit 0");
		const collisionDigest = checksum(collision);

		expect(run(root, ["stable", a]).exitCode).not.toBe(0);
		expect(fs.existsSync(path.join(bin, "omp"))).toBeFalse();
		expect(checksum(collision)).toBe(collisionDigest);
	});
});
