import { afterAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const script = path.join(import.meta.dir, "link-omp.sh");
const distCandidate = path.join(import.meta.dir, "..", "packages", "coding-agent", "dist", "omp");
const repoRoot = path.resolve(import.meta.dir, "..");
const temporaryRoots: string[] = [];

function canonicalPath(file: string): string {
	return fs.realpathSync(file);
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

function temporaryRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-installed-binary-test-"));
	temporaryRoots.push(root);
	return root;
}

function executable(file: string, body: string): string {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `#!/bin/sh\nset -eu\n${body}\n`);
	fs.chmodSync(file, 0o755);
	return file;
}

function isolatedEnvironment(root: string): Record<string, string> {
	const bin = path.join(root, "global bin");
	fs.mkdirSync(bin, { recursive: true });
	return {
		...process.env,
		HOME: path.join(root, "home"),
		XDG_CONFIG_HOME: path.join(root, "xdg-config"),
		XDG_CACHE_HOME: path.join(root, "xdg-cache"),
		XDG_DATA_HOME: path.join(root, "xdg-data"),
		OMP_LINK_GLOBAL_BIN: bin,
		OMP_LINK_REPO_ROOT: repoRoot,
	};
}

function run(root: string, args: string[]) {
	return Bun.spawnSync(["bash", script, ...args], {
		cwd: root,
		env: isolatedEnvironment(root),
		stdout: "pipe",
		stderr: "pipe",
	});
}

afterAll(() => {
	for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe("installed binary isolation", () => {
	it("validates version, help, and smoke using only the supplied candidate", () => {
		const root = temporaryRoot();
		const candidate = executable(
			path.join(root, "fixture", "omp"),
			`case \"${"$"}{1:-}\" in
  --version) printf '%s\\n' fixture-version ;;
  --help) printf '%s\\n' fixture-help ;;
  --smoke-test) printf '%s\\n' fixture-smoke ;;
  *) exit 31 ;;
esac`,
		);
		const result = run(root, ["stable", candidate]);
		expect(result.exitCode).toBe(0);

		const bin = path.join(root, "global bin");
		const promoted = path.join(bin, "omp");
		const release = releasePath(bin, candidate);
		expect(linkTarget(promoted)).toBe(canonicalPath(release));
		expect(canonicalPath(promoted)).toBe(canonicalPath(release));
		expect(fs.existsSync(path.join(root, "home", ".omp"))).toBeFalse();
	});

	it("does not promote a candidate when validation requires a missing source file", () => {
		const root = temporaryRoot();
		const bin = path.join(root, "global bin");
		const current = executable(path.join(root, "fixture", "current"), "exit 0");
		const sourceRoot = path.join(root, "corrupted source");
		fs.mkdirSync(sourceRoot, { recursive: true });
		const candidate = executable(
			path.join(root, "fixture", "source-dependent"),
			`[ -e \"${sourceRoot}/required-source-file\" ] || exit 73`,
		);
		fs.mkdirSync(bin, { recursive: true });
		fs.symlinkSync(current, path.join(bin, "omp"));

		const result = run(root, ["stable", candidate]);
		expect(result.exitCode).not.toBe(0);
		expect(canonicalPath(path.join(bin, "omp"))).toBe(canonicalPath(current));
	});
});

describe.skipIf(!fs.existsSync(distCandidate))("compiled dist candidate", () => {
	it("remains runnable after the copied source layout is corrupted", () => {
		const root = temporaryRoot();
		const copiedSource = path.join(root, "copied source");
		const copiedCandidate = path.join(copiedSource, "packages", "coding-agent", "dist", "omp");
		const copiedEntry = path.join(copiedSource, "packages", "coding-agent", "src", "cli.ts");
		fs.mkdirSync(path.dirname(copiedEntry), { recursive: true });
		fs.mkdirSync(path.dirname(copiedCandidate), { recursive: true });
		fs.copyFileSync(distCandidate, copiedCandidate);
		fs.chmodSync(copiedCandidate, 0o755);
		fs.writeFileSync(copiedEntry, "original source");
		const promotion = run(root, ["stable", copiedCandidate]);
		expect(promotion.exitCode).toBe(0);

		const bin = path.join(root, "global bin");
		const promoted = path.join(bin, "omp");
		const release = releasePath(bin, copiedCandidate);
		expect(linkTarget(promoted)).toBe(canonicalPath(release));
		expect(canonicalPath(promoted)).toBe(canonicalPath(release));
		const releaseDigest = checksum(release);
		fs.writeFileSync(copiedCandidate, "corrupted build output");
		expect(checksum(release)).toBe(releaseDigest);
		fs.rmSync(copiedCandidate);

		fs.rmSync(path.join(copiedSource, "packages", "coding-agent", "src"), {
			recursive: true,
			force: true,
		});
		const result = Bun.spawnSync([promoted, "--version"], {
			cwd: root,
			env: isolatedEnvironment(root),
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(result.exitCode).toBe(0);
	});
});
