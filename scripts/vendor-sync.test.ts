import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { decodeManifest, decideFastForward, syncManifest } from "./vendor-sync";

type GitResult = { status: number; stdout: string; stderr: string };
const roots: string[] = [];

async function git(repo: string, args: string[]): Promise<GitResult> {
	const process = Bun.spawn(["git", "-C", repo, ...args], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
	const status = await process.exited;
	if (status !== 0) throw new Error(`git ${args.join(" ")} failed with status ${status}`);
	return { status, stdout: "", stderr: "" };
}
async function fixtureRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vendor-sync-test-"));
	roots.push(root);
	return root;
}
async function runGitForSync(repo: string, args: string[]): Promise<GitResult> {
	const temp = await fs.mkdtemp(path.join(os.tmpdir(), "vendor-sync-command-"));
	roots.push(temp);
	const stdoutPath = path.join(temp, "stdout");
	const stderrPath = path.join(temp, "stderr");
	const quoteShell = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
	const command = [...["git", "-C", repo], ...args].map(quoteShell).join(" ") + ` >${quoteShell(stdoutPath)} 2>${quoteShell(stderrPath)}`;
	const process = Bun.spawn(["sh", "-c", command], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
	const status = await process.exited;
	const stdout = await fs.readFile(stdoutPath, "utf8");
	const stderr = await fs.readFile(stderrPath, "utf8");
	return { status, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function createRemote(root: string): Promise<{ remote: string; local: string }> {
	const remote = path.join(root, "remote.git");
	const seed = path.join(root, "seed");
	const local = path.join(root, "vendor", "fixture");
	await fs.mkdir(seed, { recursive: true });
	await git(root, ["init", "--bare", remote]);
	await git(seed, ["init", "-b", "main"]);
	await git(seed, ["config", "user.email", "vendor-sync@test.invalid"]);
	await git(seed, ["config", "user.name", "Vendor Sync Test"]);
	await fs.writeFile(path.join(seed, "state.txt"), "base\n");
	await git(seed, ["add", "state.txt"]);
	await git(seed, ["commit", "-m", "base"]);
	await git(seed, ["remote", "add", "origin", remote]);
	await git(seed, ["push", "origin", "main"]);
	await git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
	await fs.mkdir(path.dirname(local), { recursive: true });
	await git(root, ["clone", remote, local]);
	await git(local, ["config", "user.email", "vendor-sync@test.invalid"]);
	await git(local, ["config", "user.name", "Vendor Sync Test"]);
	return { remote, local };
}

function manifestFor(localPath: string): string {
	return `vendors:\n  - path: ${localPath}\n    upstream: https://example.test/vendor.git\n    policy: track\n    lastSync: 2026-07-14\n    reason: fixture clean nested repository\n`;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("vendor manifest decoding", () => {
	it("decodes policy entries and nullable upstreams", () => {
		expect(decodeManifest(`vendors:\n  - path: vendor/example\n    upstream: null\n    policy: pin\n    lastSync: 2026-07-14\n    reason: snapshot content cannot be verified\n`)).toEqual({ vendors: [{
			path: "vendor/example",
			upstream: null,
			policy: "pin",
			lastSync: "2026-07-14",
			reason: "snapshot content cannot be verified",
		}] });
	});
});

describe("ff-only decisions", () => {
	it("distinguishes fast-forward, divergence, and command failure", () => {
		expect(decideFastForward(0)).toBe("fast-forward");
		expect(decideFastForward(1)).toBe("diverged");
		expect(decideFastForward(128)).toBe("failed");
	});

	it("flips a diverged fixture to pin without merging", async () => {
		const root = await fixtureRoot();
		const { remote, local } = await createRemote(root);
		const writer = path.join(root, "writer");
		await git(root, ["clone", remote, writer]);
		await git(writer, ["config", "user.email", "vendor-sync@test.invalid"]);
		await git(writer, ["config", "user.name", "Vendor Sync Test"]);
		await fs.writeFile(path.join(writer, "remote.txt"), "remote\n");
		await git(writer, ["add", "remote.txt"]);
		await git(writer, ["commit", "-m", "remote"]);
		await git(writer, ["push", "origin", "main"]);
		await fs.writeFile(path.join(local, "local.txt"), "local\n");
		await git(local, ["add", "local.txt"]);
		await git(local, ["commit", "-m", "local"]);
		const before = (await runGitForSync(local, ["rev-parse", "HEAD"])).stdout;
		const manifestPath = path.join(root, "vendors.yml");
		await fs.writeFile(manifestPath, manifestFor("vendor/fixture"));
		const [result] = await syncManifest({ root, manifestPath, apply: true, runGit: runGitForSync });
		expect(result.action).toBe("diverged — flipped to pin");
		expect(decodeManifest(await fs.readFile(manifestPath, "utf8")).vendors[0].policy).toBe("pin");
		expect((await runGitForSync(local, ["rev-parse", "HEAD"])).stdout).toBe(before);
	});
});
