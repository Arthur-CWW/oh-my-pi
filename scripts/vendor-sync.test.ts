import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { decodeManifest, syncManifest, type CommandResult, type GitRunner } from "./vendor-sync";

type Fixture = {
	local: string;
	remote: string;
	seed: string;
	vendorPath: string;
	upstream: string;
};

type RecordedCall = { repo: string; args: string[] };
type RunnerHooks = {
	onFetch?: (repo: string) => Promise<void>;
	onMerge?: (repo: string) => Promise<void>;
};

const roots: string[] = [];

function rawGit(repo: string, args: string[]): CommandResult {
	const result = spawnSync("git", args, {
		cwd: repo,
		shell: false,
		encoding: "utf8",
	});
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed to spawn: ${result.error.message}`);
	}
	if (result.status === null) {
		throw new Error(`git ${args.join(" ")} exited without a status`);
	}
	return {
		status: result.status,
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
	};
}

async function git(repo: string, args: string[]): Promise<CommandResult> {
	const result = await rawGit(repo, args);
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	return result;
}

async function fixtureRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vendor-sync-test-"));
	roots.push(root);
	return root;
}

async function createRemote(root: string, name: string): Promise<Fixture> {
	const remote = path.join(root, `${name}.git`);
	const seed = path.join(root, `${name}-seed`);
	const local = path.join(root, "vendor", name);
	const vendorPath = path.posix.join("vendor", name);
	const upstream = `https://example.test/${name}.git`;
	await fs.mkdir(seed, { recursive: true });
	await git(root, ["init", "--bare", remote]);
	await git(seed, ["init", "-b", "main"]);
	await git(seed, ["config", "user.email", "vendor-sync@test.invalid"]);
	await git(seed, ["config", "user.name", "Vendor Sync Test"]);
	await fs.writeFile(path.join(seed, "state.txt"), "base\n", "utf8");
	await git(seed, ["add", "state.txt"]);
	await git(seed, ["commit", "-m", "base"]);
	await git(seed, ["remote", "add", "origin", remote]);
	await git(seed, ["push", "origin", "main"]);
	await git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
	await fs.mkdir(path.dirname(local), { recursive: true });
	await git(root, ["clone", remote, local]);
	await git(local, ["config", "user.email", "vendor-sync@test.invalid"]);
	await git(local, ["config", "user.name", "Vendor Sync Test"]);
	await git(local, ["remote", "set-url", "origin", upstream]);
	return { local, remote, seed, vendorPath, upstream };
}

async function advanceRemote(fixture: Fixture, label = "remote update"): Promise<string> {
	await fs.writeFile(path.join(fixture.seed, "state.txt"), `${label}\n`, "utf8");
	await git(fixture.seed, ["add", "state.txt"]);
	await git(fixture.seed, ["commit", "-m", label]);
	await git(fixture.seed, ["push", "origin", "main"]);
	return (await git(fixture.seed, ["rev-parse", "HEAD"])).stdout;
}

async function advanceLocal(fixture: Fixture, label = "local update"): Promise<string> {
	await fs.writeFile(path.join(fixture.local, "local.txt"), `${label}\n`, "utf8");
	await git(fixture.local, ["add", "local.txt"]);
	await git(fixture.local, ["commit", "-m", label]);
	return (await git(fixture.local, ["rev-parse", "HEAD"])).stdout;
}


function manifestFor(entries: Array<{ path: string; upstream: string | null; policy: "track" | "pin"; lastSync?: string; reason?: string; remote?: string | null; branch?: string | null; order?: string[] }>, newline = "\n"): string {
	const blocks = entries.map(entry => {
		const values: Record<string, string> = {
			path: entry.path,
			upstream: entry.upstream ?? "null",
			policy: entry.policy,
			lastSync: entry.lastSync ?? "2026-07-14",
			reason: entry.reason ?? (entry.policy === "pin" ? "snapshot content cannot be verified" : "fixture clean nested repository"),
			remote: entry.remote === undefined ? (entry.policy === "track" ? "origin" : "null") : entry.remote ?? "null",
			branch: entry.branch === undefined ? (entry.policy === "track" ? "main" : "null") : entry.branch ?? "null",
		};
		const order = entry.order ?? ["path", "upstream", "policy", "lastSync", "reason", "remote", "branch"];
		const first = order[0];
		if (first === undefined) throw new Error("manifest entry order cannot be empty");
		return [`  - ${first}: ${values[first]}`, ...order.slice(1).map(key => `    ${key}: ${values[key]}`)].join(newline);
	});
	return ["schemaVersion: 2", "vendors:", ...blocks].join(newline) + newline;
}

function trackManifest(fixture: Fixture, order?: string[], newline = "\n"): string {
	return manifestFor([{ path: fixture.vendorPath, upstream: fixture.upstream, policy: "track", order: order ?? ["path", "upstream", "policy", "lastSync", "reason", "remote", "branch"] }], newline);
}

function pinManifest(vendorPath = "vendor/snapshot"): string {
	return manifestFor([{ path: vendorPath, upstream: null, policy: "pin" }]);
}

async function readHead(repo: string): Promise<string> {
	return (await git(repo, ["rev-parse", "HEAD"])).stdout;
}

function makeRunner(fixtures: Fixture[], hooks: RunnerHooks = {}): { runGit: GitRunner; calls: RecordedCall[] } {
	const remoteByRepo = new Map(fixtures.map(fixture => [fixture.local, fixture.remote]));
	const calls: RecordedCall[] = [];
	const runGit: GitRunner = async (repo, args) => {
		calls.push({ repo, args: [...args] });
		const actualArgs = [...args];
		if (actualArgs[0] === "fetch") {
			const remote = remoteByRepo.get(repo);
			const remoteIndex = actualArgs.indexOf("origin", 1);
			if (remote && remoteIndex >= 0) actualArgs[remoteIndex] = remote;
		}
		const result = await rawGit(repo, actualArgs);
		if (result.status === 0 && args[0] === "fetch" && hooks.onFetch) await hooks.onFetch(repo);
		if (result.status === 0 && args[0] === "merge" && hooks.onMerge) await hooks.onMerge(repo);
		return result;
	};
	return { runGit, calls };
}

async function writeManifest(root: string, text: string): Promise<string> {
	const manifestPath = path.join(root, "vendors.yml");
	await fs.writeFile(manifestPath, text, "utf8");
	return manifestPath;
}

function callsFor(calls: RecordedCall[], repo: string, command: string): RecordedCall[] {
	return calls.filter(call => call.repo === repo && call.args[0] === command);
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("vendor manifest v2 decoding", () => {
	it("accepts valid nullable pin entries with the exact schema", () => {
		expect(decodeManifest(pinManifest())).toEqual({
			schemaVersion: 2,
			vendors: [{
				path: "vendor/snapshot",
				upstream: null,
				policy: "pin",
				remote: null,
				branch: null,
				lastSync: "2026-07-14",
				reason: "snapshot content cannot be verified",
			}],
		});
	});

	it("rejects inexact keys and invalid values", () => {
		const valid = pinManifest();
		const invalid = [
			valid.replace("schemaVersion: 2", "schemaVersion: 1"),
			valid.replace("    reason:", "    extra: value\n    reason:"),
			valid.replace("    reason: snapshot content cannot be verified\n", ""),
			valid.replace("    reason:", "    reason: duplicate\n    reason:"),
			valid.replace("upstream: null", "upstream: http://example.test/snapshot.git"),
			valid.replace("path: vendor/snapshot", "path: ../snapshot"),
			valid.replace("lastSync: 2026-07-14", "lastSync: 2026-02-30"),
		];
		for (const text of invalid) expect(() => decodeManifest(text)).toThrow();
	});
});

describe("vendor sync safety invariants", () => {
	it("does not probe Git for pinned entries", async () => {
		const root = await fixtureRoot();
		const manifestPath = await writeManifest(root, pinManifest());
		let probes = 0;
		const report = await syncManifest({ root, manifestPath, apply: true, runGit: async () => {
			probes += 1;
			throw new Error("pinned entries must not probe Git");
		} });
		expect(probes).toBe(0);
		expect(report).toMatchObject({ apply: true, updated: 0, unchanged: 0, blocked: 0, failed: 0, ok: true });
		expect(report.results[0]).toMatchObject({ disposition: "skipped", code: "pinned", policy: "pin" });
	});

	it("keeps dry-run read-only and performs no fetch, merge, or write", async () => {
		const root = await fixtureRoot();
		const fixture = await createRemote(root, "dry-run");
		await advanceRemote(fixture);
		const manifestText = trackManifest(fixture);
		const manifestPath = await writeManifest(root, manifestText);
		const before = await readHead(fixture.local);
		const { runGit, calls } = makeRunner([fixture]);
		const report = await syncManifest({ root, manifestPath, apply: false, runGit });
		expect(report).toMatchObject({ apply: false, updated: 0, unchanged: 0, blocked: 0, failed: 0, ok: true });
		expect(report.results[0]).toMatchObject({ disposition: "eligible", code: "dry-run", before, after: null });
		expect(callsFor(calls, fixture.local, "fetch")).toHaveLength(0);
		expect(callsFor(calls, fixture.local, "merge")).toHaveLength(0);
		expect(await readHead(fixture.local)).toBe(before);
		expect(await fs.readFile(manifestPath, "utf8")).toBe(manifestText);
	});

	it("applies equal state using the explicit remote branch ref", async () => {
		const root = await fixtureRoot();
		const fixture = await createRemote(root, "equal");
		const manifestText = trackManifest(fixture);
		const manifestPath = await writeManifest(root, manifestText);
		const { runGit, calls } = makeRunner([fixture]);
		const report = await syncManifest({ root, manifestPath, apply: true, now: () => "2026-07-15", runGit });
		expect(report).toMatchObject({ apply: true, updated: 0, unchanged: 1, blocked: 0, failed: 0, ok: true });
		expect(report.results[0]).toMatchObject({ disposition: "unchanged", code: "up-to-date" });
		expect(callsFor(calls, fixture.local, "fetch")[0]?.args).toContain("refs/heads/main:refs/remotes/origin/main");
		expect(callsFor(calls, fixture.local, "merge")).toHaveLength(0);
		expect(await fs.readFile(manifestPath, "utf8")).toBe(manifestText.replace("2026-07-14", "2026-07-15"));
	});

	it("fast-forwards behind state to the fetched commit and preserves reordered bytes", async () => {
		const root = await fixtureRoot();
		const fixture = await createRemote(root, "behind");
		const target = await advanceRemote(fixture);
		const manifestText = trackManifest(fixture, ["lastSync", "reason", "path", "branch", "remote", "policy", "upstream"], "\r\n").replace("lastSync: 2026-07-14", "lastSync: \"2026-07-14\" # preserve this comment");
		const manifestPath = await writeManifest(root, manifestText);
		const { runGit, calls } = makeRunner([fixture]);
		const report = await syncManifest({ root, manifestPath, apply: true, now: () => "2026-07-15", runGit });
		expect(report).toMatchObject({ apply: true, updated: 1, unchanged: 0, blocked: 0, failed: 0, ok: true });
		expect(report.results[0]).toMatchObject({ disposition: "updated", code: "fast-forwarded", before: expect.any(String), after: target });
		expect(await readHead(fixture.local)).toBe(target);
		expect(await fs.readFile(manifestPath, "utf8")).toBe(manifestText.replace("2026-07-14", "2026-07-15"));
		expect(callsFor(calls, fixture.local, "fetch")[0]?.args).toContain("refs/heads/main:refs/remotes/origin/main");
		expect(callsFor(calls, fixture.local, "merge")[0]?.args).toEqual(["merge", "--ff-only", target]);
		expect(calls.some(call => call.args[0] === "commit" || call.args[0] === "push")).toBe(false);
	});

	it("persists two sequential successful entries against the advancing manifest snapshot", async () => {
		const root = await fixtureRoot();
		const first = await createRemote(root, "sequential-first");
		const second = await createRemote(root, "sequential-second");
		const firstTarget = await advanceRemote(first);
		const secondTarget = await advanceRemote(second);
		const manifestText = manifestFor([
			{ path: first.vendorPath, upstream: first.upstream, policy: "track" },
			{ path: second.vendorPath, upstream: second.upstream, policy: "track" },
		], "\r\n").replaceAll("lastSync: 2026-07-14", 'lastSync: "2026-07-14" # preserve this comment');
		const manifestPath = await writeManifest(root, manifestText);
		const { runGit, calls } = makeRunner([first, second]);
		const report = await syncManifest({ root, manifestPath, apply: true, now: () => "2026-07-15", runGit });
		expect(report).toMatchObject({ apply: true, updated: 2, unchanged: 0, blocked: 0, failed: 0, ok: true });
		expect(report.results[0]).toMatchObject({ disposition: "updated", code: "fast-forwarded", after: firstTarget });
		expect(report.results[1]).toMatchObject({ disposition: "updated", code: "fast-forwarded", after: secondTarget });
		expect(await readHead(first.local)).toBe(firstTarget);
		expect(await readHead(second.local)).toBe(secondTarget);
		expect(callsFor(calls, second.local, "fetch")).toHaveLength(1);
		expect(callsFor(calls, second.local, "merge")).toHaveLength(1);
		expect(await fs.readFile(manifestPath, "utf8")).toBe(manifestText.replaceAll("2026-07-14", "2026-07-15"));
	});

	it("blocks dirty, detached, tracking-config, URL, and escaped paths before fetch", async () => {
		const cases = [
			{
				name: "dirty",
				prepare: async (fixture: Fixture) => fs.writeFile(path.join(fixture.local, "untracked.txt"), "dirty\n", "utf8"),
				code: "dirty" as const,
			},
			{
				name: "detached",
				prepare: async (fixture: Fixture) => { await git(fixture.local, ["checkout", "--detach", "HEAD"]); },
				code: "detached" as const,
			},
			{
				name: "config",
				prepare: async (fixture: Fixture) => { await git(fixture.local, ["config", "branch.main.remote", "other"]); },
				code: "tracking-remote-mismatch" as const,
			},
			{
				name: "url",
				prepare: async (fixture: Fixture) => { await git(fixture.local, ["remote", "set-url", "origin", "https://wrong.example/vendor.git"]); },
				code: "remote-url-mismatch" as const,
			},
		];
		for (const testCase of cases) {
			const root = await fixtureRoot();
			const fixture = await createRemote(root, `blocked-${testCase.name}`);
			await testCase.prepare(fixture);
			const manifestPath = await writeManifest(root, trackManifest(fixture));
			const { runGit, calls } = makeRunner([fixture]);
			const report = await syncManifest({ root, manifestPath, apply: true, runGit });
			expect(report.results[0]).toMatchObject({ disposition: "blocked", code: testCase.code });
			expect(callsFor(calls, fixture.local, "fetch")).toHaveLength(0);
		}

		const root = await fixtureRoot();
		const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vendor-sync-outside-"));
		roots.push(outside);
		await fs.mkdir(path.join(root, "vendor"), { recursive: true });
		await fs.symlink(outside, path.join(root, "vendor", "escape"), "dir");
		const manifestPath = await writeManifest(root, manifestFor([{ path: "vendor/escape", upstream: "https://example.test/escape.git", policy: "track" }]));
		const { runGit, calls } = makeRunner([]);
		const report = await syncManifest({ root, manifestPath, apply: true, runGit });
		expect(report.results[0]).toMatchObject({ disposition: "blocked", code: "path-escape" });
		expect(calls).toHaveLength(0);
	});

	it("continues a healthy track after a nonfatal bad track", async () => {
		const root = await fixtureRoot();
		const bad = await createRemote(root, "nonfatal-bad");
		const healthy = await createRemote(root, "nonfatal-healthy");
		await fs.writeFile(path.join(bad.local, "untracked.txt"), "dirty\n", "utf8");
		const target = await advanceRemote(healthy);
		const manifestPath = await writeManifest(root, manifestFor([
			{ path: bad.vendorPath, upstream: bad.upstream, policy: "track" },
			{ path: healthy.vendorPath, upstream: healthy.upstream, policy: "track" },
		]));
		const { runGit, calls } = makeRunner([bad, healthy]);
		const report = await syncManifest({ root, manifestPath, apply: true, now: () => "2026-07-15", runGit });
		expect(report).toMatchObject({ updated: 1, unchanged: 0, blocked: 1, failed: 0, ok: false });
		expect(report.results[0]).toMatchObject({ disposition: "blocked", code: "dirty" });
		expect(callsFor(calls, bad.local, "fetch")).toHaveLength(0);
		expect(report.results[1]).toMatchObject({ disposition: "updated", code: "fast-forwarded", after: target });
		expect(await readHead(healthy.local)).toBe(target);
		expect(callsFor(calls, healthy.local, "fetch")).toHaveLength(1);
		expect(callsFor(calls, healthy.local, "merge")).toHaveLength(1);
	});

	it("blocks ahead and diverged histories without mutation or pin flips", async () => {
		for (const mode of ["ahead", "diverged"] as const) {
			const root = await fixtureRoot();
			const fixture = await createRemote(root, `relationship-${mode}`);
			if (mode === "ahead") await advanceLocal(fixture);
			else {
				await advanceRemote(fixture);
				await advanceLocal(fixture);
			}
			const manifestText = trackManifest(fixture);
			const manifestPath = await writeManifest(root, manifestText);
			const before = await readHead(fixture.local);
			const { runGit, calls } = makeRunner([fixture]);
			const report = await syncManifest({ root, manifestPath, apply: true, runGit });
			expect(report.results[0]).toMatchObject({ disposition: "blocked", code: mode });
			expect(report.ok).toBe(false);
			expect(await readHead(fixture.local)).toBe(before);
			expect(decodeManifest(await fs.readFile(manifestPath, "utf8")).vendors[0]?.policy).toBe("track");
			expect(await fs.readFile(manifestPath, "utf8")).toBe(manifestText);
			expect(callsFor(calls, fixture.local, "merge")).toHaveLength(0);
		}
	});

	it("reports a held lock without probing any repository", async () => {
		const root = await fixtureRoot();
		const fixture = await createRemote(root, "lock");
		const manifestPath = await writeManifest(root, trackManifest(fixture));
		await fs.writeFile(`${manifestPath}.lock`, "held", "utf8");
		let probes = 0;
		const report = await syncManifest({ root, manifestPath, apply: true, runGit: async () => {
			probes += 1;
			throw new Error("lock-held run must not probe Git");
		} });
		expect(probes).toBe(0);
		expect(report).toMatchObject({ blocked: 0, failed: 1, ok: false });
		expect(report.results[0]).toMatchObject({ disposition: "failed", code: "lock-held" });
	});

	it("preserves an earlier manifest write but stops later mutation on an external conflict", async () => {
		const root = await fixtureRoot();
		const first = await createRemote(root, "conflict-first");
		const second = await createRemote(root, "conflict-second");
		const third = await createRemote(root, "conflict-third");
		const firstTarget = await advanceRemote(first);
		const secondTarget = await advanceRemote(second);
		await advanceRemote(third);
		const manifestText = manifestFor([
			{ path: first.vendorPath, upstream: first.upstream, policy: "track" },
			{ path: second.vendorPath, upstream: second.upstream, policy: "track" },
			{ path: third.vendorPath, upstream: third.upstream, policy: "track" },
		]);
		const manifestPath = await writeManifest(root, manifestText);
		const thirdBefore = await readHead(third.local);
		const expectedAfterFirst = manifestText.replace("lastSync: 2026-07-14", "lastSync: 2026-07-15");
		const { runGit, calls } = makeRunner([first, second, third], {
			onFetch: async repo => {
				if (repo !== second.local) return;
				const currentText = await fs.readFile(manifestPath, "utf8");
				await fs.writeFile(manifestPath, `${currentText}# external edit\n`, "utf8");
			},
		});
		const report = await syncManifest({ root, manifestPath, apply: true, now: () => "2026-07-15", runGit });
		expect(report).toMatchObject({ updated: 1, unchanged: 0, blocked: 0, failed: 2, ok: false });
		expect(report.results[0]).toMatchObject({ disposition: "updated", code: "fast-forwarded", after: firstTarget });
		expect(report.results[1]).toMatchObject({ disposition: "failed", code: "manifest-conflict", after: secondTarget });
		expect(report.results[2]).toMatchObject({ disposition: "failed", code: "manifest-write-failed" });
		expect(await readHead(first.local)).toBe(firstTarget);
		expect(await readHead(second.local)).toBe(secondTarget);
		expect(await readHead(third.local)).toBe(thirdBefore);
		expect(callsFor(calls, third.local, "fetch")).toHaveLength(0);
		expect(await fs.readFile(manifestPath, "utf8")).toBe(`${expectedAfterFirst}# external edit\n`);
	});

	it("stops later vendor mutation after post-merge verification fails", async () => {
		const root = await fixtureRoot();
		const first = await createRemote(root, "fatal-first");
		const second = await createRemote(root, "fatal-second");
		const firstTarget = await advanceRemote(first);
		await advanceRemote(second);
		const manifestPath = await writeManifest(root, manifestFor([
			{ path: first.vendorPath, upstream: first.upstream, policy: "track" },
			{ path: second.vendorPath, upstream: second.upstream, policy: "track" },
		]));
		const secondBefore = await readHead(second.local);
		const { runGit, calls } = makeRunner([first, second], { onMerge: async repo => fs.writeFile(path.join(repo, "post-merge-untracked.txt"), "unexpected mutation\n", "utf8") });
		const report = await syncManifest({ root, manifestPath, apply: true, now: () => "2026-07-15", runGit });
		expect(report.ok).toBe(false);
		expect(report.results[0]).toMatchObject({ disposition: "blocked", code: "dirty", after: firstTarget });
		expect(report.results[1]).toMatchObject({ disposition: "failed", code: "manifest-write-failed" });
		expect(await readHead(first.local)).toBe(firstTarget);
		expect(await readHead(second.local)).toBe(secondBefore);
		expect(callsFor(calls, second.local, "fetch")).toHaveLength(0);
		expect(callsFor(calls, second.local, "merge")).toHaveLength(0);
	});
});
