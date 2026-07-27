import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const fixture = path.join(import.meta.dir, "fixtures", "config-root-probe.ts");
const envInheritanceFixture = path.join(import.meta.dir, "fixtures", "config-root-env-inheritance-probe.ts");

async function tree(root: string): Promise<string[]> {
	const entries: string[] = [];
	const visit = async (dir: string): Promise<void> => {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const absolute = path.join(dir, entry.name);
			entries.push(path.relative(root, absolute));
			if (entry.isDirectory()) await visit(absolute);
		}
	};
	await visit(root);
	return entries.sort();
}

interface ProbeResult {
	configHome: string;
	configRoot: string;
	agentDir: string;
	statsDb: string;
	githubCache: string;
	authBrokerCache: string;
}

interface ContainmentResult {
	root: string;
	paths: Record<string, string>;
	installId: string;
}

interface AuthoritySnapshot {
	configRoot: string;
	envConfigRoot: string | null;
}

interface AuthorityProbeResult {
	parent: AuthoritySnapshot;
	child: AuthoritySnapshot;
}

async function runAuthorityProbe(cwd: string, env: Record<string, string | undefined>): Promise<AuthorityProbeResult> {
	const proc = Bun.spawn([process.execPath, envInheritanceFixture], {
		cwd,
		env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(exitCode, stderr).toBe(0);
	return JSON.parse(stdout) as AuthorityProbeResult;
}

describe("process-start OMP_CONFIG_ROOT (global helpers; project-scoped helpers intentionally excluded)", () => {
	let sandbox: string;
	let home: string;
	let hostile: string;
	let xdgData: string;
	let xdgState: string;
	let xdgCache: string;

	beforeEach(async () => {
		sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "pi-utils-config-root-"));
		home = path.join(sandbox, "hostile-home");
		hostile = path.join(sandbox, "hostile-agent-and-args");
		xdgData = path.join(sandbox, "hostile-xdg-data");
		xdgState = path.join(sandbox, "hostile-xdg-state");
		xdgCache = path.join(sandbox, "hostile-xdg-cache");
		await Promise.all([
			fs.mkdir(home, { recursive: true }),
			fs.mkdir(hostile, { recursive: true }),
			fs.mkdir(path.join(xdgData, "omp"), { recursive: true }),
			fs.mkdir(path.join(xdgState, "omp"), { recursive: true }),
			fs.mkdir(path.join(xdgCache, "omp"), { recursive: true }),
		]);
	});

	afterEach(async () => {
		await fs.rm(sandbox, { recursive: true, force: true });
	});

	function childEnv(root: string | undefined): Record<string, string | undefined> {
		const env: Record<string, string | undefined> = {
			...process.env,
			HOME: home,
			XDG_DATA_HOME: xdgData,
			XDG_STATE_HOME: xdgState,
			XDG_CACHE_HOME: xdgCache,
			OMP_SESSION_CONTROL_DB: path.join(sandbox, "session-control.sqlite"),
			IRC_EXTERNAL_BUS_DB: path.join(sandbox, "irc-external.sqlite"),
			PI_CONFIG_DIR: ".hostile-config-name",
			PI_CODING_AGENT_DIR: hostile,
			OMP_GITHUB_CACHE_DB: path.join(hostile, "github-cache.db"),
			OMP_AUTH_BROKER_SNAPSHOT_CACHE: path.join(hostile, "auth-broker.enc"),
			TEST_HOSTILE_ROOT: hostile,
		};
		delete env.OMP_PROFILE;
		delete env.PI_PROFILE;
		delete env.TEST_EXPECT_CONFIG_ROOT;
		delete env.TEST_MUTATE_CONFIG_ROOT;
		if (root === undefined) delete env.OMP_CONFIG_ROOT;
		else env.OMP_CONFIG_ROOT = root;
		return env;
	}

	it("preserves HOME, PI_CODING_AGENT_DIR, and dedicated cache behavior when unset", async () => {
		const proc = Bun.spawn([process.execPath, fixture], {
			cwd: sandbox,
			env: childEnv(undefined),
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		const result = JSON.parse(stdout) as ProbeResult;
		expect(result).toEqual({
			configHome: home,
			configRoot: path.join(home, ".hostile-config-name"),
			agentDir: hostile,
			statsDb: path.join(home, ".hostile-config-name", "stats.db"),
			githubCache: path.join(hostile, "github-cache.db"),
			authBrokerCache: path.join(hostile, "auth-broker.enc"),
		});

		await fs.writeFile(path.join(home, ".env"), `OMP_CONFIG_ROOT=${hostile}\n`);
		const authority = await runAuthorityProbe(sandbox, childEnv(undefined));
		const legacyRoot = path.join(home, ".hostile-config-name");
		expect(authority).toEqual({
			parent: { configRoot: legacyRoot, envConfigRoot: null },
			child: { configRoot: legacyRoot, envConfigRoot: null },
		});
	});

	for (const invalidRoot of ["", "relative/config-root"]) {
		it(`rejects ${invalidRoot === "" ? "empty" : "relative"} OMP_CONFIG_ROOT during module initialization`, async () => {
			const proc = Bun.spawn([process.execPath, fixture], {
				cwd: sandbox,
				env: childEnv(invalidRoot),
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			expect(exitCode).not.toBe(0);
			expect(stdout).toBe("");
			expect(stderr).toContain("InvalidConfigRootError");
			expect(stderr).toContain(JSON.stringify(invalidRoot));
		});
	}

	it("contains every global path despite hostile env, optional args, profiles, and setAgentDir", async () => {
		const normalizedRoot = path.join(sandbox, "authoritative-root");
		const rawRoot = path.join(normalizedRoot, "redundant", "..");
		const outsideBefore = await tree(sandbox);
		const env = childEnv(rawRoot);
		env.TEST_EXPECT_CONFIG_ROOT = normalizedRoot;
		const proc = Bun.spawn([process.execPath, fixture], {
			cwd: sandbox,
			env,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		const result = JSON.parse(stdout) as ContainmentResult;
		expect(result.root).toBe(normalizedRoot);
		expect(Object.keys(result.paths)).toHaveLength(96);
		for (const resolved of Object.values(result.paths)) {
			const relative = path.relative(normalizedRoot, resolved);
			expect(relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))).toBe(true);
		}
		expect(result.paths.configHome).toBe(normalizedRoot);
		expect(result.paths.configHomeHostileArg).toBe(normalizedRoot);
		expect(result.paths.configRoot).toBe(normalizedRoot);
		expect(result.paths.profileActiveRoot).toBe(path.join(normalizedRoot, "profiles", "work"));
		expect(result.paths.setAgentDirAgent).toBe(path.join(normalizedRoot, "agent"));
		expect(result.paths.rootAfterEnvMutation).toBe(normalizedRoot);
		expect(result.paths.installIdPath).toBe(path.join(normalizedRoot, "install-id"));

		const outsideAfter = (await tree(sandbox)).filter(
			entry => entry !== "authoritative-root" && !entry.startsWith(`authoritative-root${path.sep}`),
		);
		expect(outsideAfter).toEqual(outsideBefore);

		await fs.writeFile(path.join(home, ".env"), `OMP_CONFIG_ROOT=${hostile}\n`);
		const authorityEnv = childEnv(rawRoot);
		authorityEnv.TEST_MUTATE_CONFIG_ROOT = hostile;
		const authority = await runAuthorityProbe(sandbox, authorityEnv);
		expect(authority).toEqual({
			parent: { configRoot: normalizedRoot, envConfigRoot: normalizedRoot },
			child: { configRoot: normalizedRoot, envConfigRoot: normalizedRoot },
		});
	});
});
