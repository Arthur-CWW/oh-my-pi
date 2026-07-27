import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

interface ProbeResult {
	configHomeDir: string;
	configHomeFromHostileArg: string;
	agentDir: string;
	configDirOutput: string[];
	userPath: string | null;
	commands: Array<{ name: string; path: string }>;
	skills: Array<{ name: string; path: string }>;
	plugins: Array<{ id: string; path: string }>;
	pluginWarnings: string[];
}

interface Sandbox {
	root: string;
	configRoot: string;
	hostileHome: string;
	hostileXdg: string;
	hostileAgentDir: string;
	projectDir: string;
	explicitPluginDir: string;
	environment: Record<string, string | undefined>;
}

const fixture = path.join(import.meta.dir, "fixtures", "config-root-discovery.ts");
const packageRoot = path.resolve(import.meta.dir, "../..");
const tempRoots: string[] = [];

function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

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

async function writeSkill(parent: string, prefix: string): Promise<void> {
	const skillDir = path.join(parent, `${prefix}-skill`);
	await fs.mkdir(skillDir, { recursive: true });
	await fs.writeFile(
		path.join(skillDir, "SKILL.md"),
		`---\nname: ${prefix}-skill\ndescription: ${prefix} skill\n---\n\n${prefix} skill\n`,
	);
}

async function writeDiscoveryFixtures(base: string, prefix: string): Promise<void> {
	await fs.mkdir(path.join(base, "commands"), { recursive: true });
	await fs.writeFile(path.join(base, "commands", `${prefix}-command.md`), `${prefix} command\n`);
	await writeSkill(path.join(base, "skills"), prefix);
}

async function writePluginRegistry(
	home: string,
	prefix: string,
	extraEntries: Record<string, string> = {},
): Promise<void> {
	const installPath = path.join(home, `${prefix}-plugin-install`);
	const registryDir = path.join(home, ".claude", "plugins");
	const plugins: Record<string, unknown> = {
		[`${prefix}-plugin@test-market`]: [
			{
				scope: "user",
				installPath,
				version: "1.0.0",
			},
		],
	};
	for (const [pluginId, escapedInstallPath] of Object.entries(extraEntries)) {
		plugins[pluginId] = [
			{
				scope: "user",
				installPath: escapedInstallPath,
				version: "1.0.0",
			},
		];
	}
	await Promise.all([fs.mkdir(installPath, { recursive: true }), fs.mkdir(registryDir, { recursive: true })]);
	await fs.writeFile(path.join(registryDir, "installed_plugins.json"), JSON.stringify({ version: 2, plugins }));
}

async function createSandbox(): Promise<Sandbox> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-config-root-discovery-"));
	tempRoots.push(root);
	const configRoot = path.join(root, "config-root");
	const hostileHome = path.join(root, "hostile-home");
	const hostileXdg = path.join(root, "hostile-xdg");
	const hostileAgentDir = path.join(root, "hostile-agent");
	const projectDir = path.join(root, "project");
	const explicitPluginDir = path.join(root, "explicit-plugin-dir");
	const lexicalEscapeTarget = path.join(root, "lexical-escape-plugin");
	const symlinkEscapeTarget = path.join(root, "symlink-escape-plugin");
	const symlinkInstallPath = path.join(configRoot, "symlink-plugin-install");
	const lexicalInstallPath =
		path.join(configRoot, "lexical-parent") +
		`${path.sep}..${path.sep}..${path.sep}${path.basename(lexicalEscapeTarget)}`;

	await Promise.all([
		writeDiscoveryFixtures(path.join(configRoot, "agent"), "root-native"),
		writeDiscoveryFixtures(path.join(configRoot, ".claude"), "root-claude"),
		writeSkill(path.join(configRoot, "custom-skills"), "root-custom"),
		writeDiscoveryFixtures(path.join(hostileHome, ".omp", "agent"), "home-native-decoy"),
		writeDiscoveryFixtures(path.join(hostileHome, ".claude"), "home-claude-decoy"),
		writeSkill(path.join(hostileHome, "custom-skills"), "home-custom-decoy"),
		writeDiscoveryFixtures(path.join(hostileXdg, ".claude"), "xdg-claude-decoy"),
		writeDiscoveryFixtures(hostileAgentDir, "agent-env-decoy"),
		fs.mkdir(path.join(hostileXdg, "data", "omp"), { recursive: true }),
		fs.mkdir(path.join(hostileXdg, "state", "omp"), { recursive: true }),
		fs.mkdir(path.join(hostileXdg, "cache", "omp"), { recursive: true }),
		fs.mkdir(projectDir, { recursive: true }),
		fs.mkdir(path.join(explicitPluginDir, ".claude-plugin"), { recursive: true }),
		fs.mkdir(lexicalEscapeTarget, { recursive: true }),
		fs.mkdir(symlinkEscapeTarget, { recursive: true }),
	]);

	await Promise.all([
		fs.writeFile(
			path.join(explicitPluginDir, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "explicit-outside" }),
		),
		fs.symlink(symlinkEscapeTarget, symlinkInstallPath, "dir"),
	]);
	await Promise.all([
		writePluginRegistry(configRoot, "root", {
			"lexical-escape@test-market": lexicalInstallPath,
			"symlink-escape@test-market": symlinkInstallPath,
		}),
		writePluginRegistry(hostileHome, "decoy"),
	]);

	const environment: Record<string, string | undefined> = {
		...process.env,
		OMP_CONFIG_ROOT: configRoot,
		OMP_TEST_PROJECT_DIR: projectDir,
		OMP_TEST_HOSTILE_HOME: hostileHome,
		OMP_TEST_EXPLICIT_PLUGIN_DIR: explicitPluginDir,
		OMP_SESSION_CONTROL_DB: path.join(root, "session-control.sqlite"),
		IRC_EXTERNAL_BUS_DB: path.join(root, "irc-external.sqlite"),
		BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
		HOME: hostileHome,
		XDG_CONFIG_HOME: hostileXdg,
		XDG_DATA_HOME: path.join(hostileXdg, "data"),
		XDG_STATE_HOME: path.join(hostileXdg, "state"),
		XDG_CACHE_HOME: path.join(hostileXdg, "cache"),
		PI_CONFIG_DIR: ".hostile-omp",
		PI_CODING_AGENT_DIR: hostileAgentDir,
	};
	delete environment.OMP_PROFILE;
	delete environment.PI_PROFILE;

	return { root, configRoot, hostileHome, hostileXdg, hostileAgentDir, projectDir, explicitPluginDir, environment };
}

async function runProbe(environment: Record<string, string | undefined>) {
	const child = Bun.spawn([process.execPath, fixture], {
		cwd: packageRoot,
		env: environment,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("OMP_CONFIG_ROOT coding-agent discovery", () => {
	it("preserves normal HOME and explicit agent-dir discovery when unset", async () => {
		const sandbox = await createSandbox();
		delete sandbox.environment.OMP_CONFIG_ROOT;
		const { stdout, stderr, exitCode } = await runProbe(sandbox.environment);
		expect(exitCode, stderr).toBe(0);
		const result = JSON.parse(stdout) as ProbeResult;

		expect(result.configHomeDir).toBe(sandbox.hostileHome);
		expect(result.configHomeFromHostileArg).toBe(sandbox.hostileHome);
		expect(result.agentDir).toBe(sandbox.hostileAgentDir);
		expect(result.configDirOutput).toEqual([
			path.join(sandbox.hostileAgentDir, "commands"),
			path.join(sandbox.hostileHome, ".claude", "commands"),
			path.join(sandbox.hostileHome, ".codex", "commands"),
			path.join(sandbox.hostileHome, ".gemini", "commands"),
		]);
		expect(result.userPath).toBe(path.join(sandbox.hostileHome, ".claude", "commands"));
		expect(result.commands.map(command => command.name).sort()).toEqual([
			"agent-env-decoy-command",
			"home-claude-decoy-command",
		]);
		expect(result.skills.map(skill => skill.name).sort()).toEqual([
			"agent-env-decoy-skill",
			"home-claude-decoy-skill",
			"home-custom-decoy-skill",
		]);
		expect(result.plugins).toEqual([
			{
				id: "explicit-outside@__local__",
				path: sandbox.explicitPluginDir,
			},
			{
				id: "decoy-plugin@test-market",
				path: path.join(sandbox.hostileHome, "decoy-plugin-install"),
			},
		]);
		expect(result.pluginWarnings).toEqual([]);
	});

	for (const invalidRoot of ["", "relative/config-root"]) {
		it(`rejects ${invalidRoot === "" ? "empty" : "relative"} root before discovery`, async () => {
			const sandbox = await createSandbox();
			sandbox.environment.OMP_CONFIG_ROOT = invalidRoot;
			const { stdout, stderr, exitCode } = await runProbe(sandbox.environment);
			expect(exitCode).not.toBe(0);
			expect(stdout).toBe("");
			expect(stderr).toContain("InvalidConfigRootError");
			expect(stderr).toContain(JSON.stringify(invalidRoot));
		});
	}

	it("clamps config, command, skill, and plugin discovery to an absolute process root", async () => {
		const sandbox = await createSandbox();
		const hostileBefore = await Promise.all([
			tree(sandbox.hostileHome),
			tree(sandbox.hostileXdg),
			tree(sandbox.hostileAgentDir),
		]);
		const { stdout, stderr, exitCode } = await runProbe(sandbox.environment);
		expect(exitCode, stderr).toBe(0);
		const result = JSON.parse(stdout) as ProbeResult;

		expect(result.configHomeDir).toBe(sandbox.configRoot);
		expect(result.configHomeFromHostileArg).toBe(sandbox.configRoot);
		expect(result.agentDir).toBe(path.join(sandbox.configRoot, "agent"));
		expect(result.configDirOutput).toEqual([
			path.join(sandbox.configRoot, "agent", "commands"),
			path.join(sandbox.configRoot, ".claude", "commands"),
			path.join(sandbox.configRoot, ".codex", "commands"),
			path.join(sandbox.configRoot, ".gemini", "commands"),
		]);
		expect(result.userPath).toBe(path.join(sandbox.configRoot, ".claude", "commands"));
		expect(result.commands.map(command => command.name).sort()).toEqual([
			"root-claude-command",
			"root-native-command",
		]);
		expect(result.skills.map(skill => skill.name).sort()).toEqual([
			"root-claude-skill",
			"root-custom-skill",
			"root-native-skill",
		]);
		expect(result.plugins).toEqual([
			{
				id: "explicit-outside@__local__",
				path: sandbox.explicitPluginDir,
			},
			{
				id: "root-plugin@test-market",
				path: path.join(sandbox.configRoot, "root-plugin-install"),
			},
		]);
		expect(result.pluginWarnings).toEqual([
			"Ignored plugin lexical-escape@test-market: installPath escapes the authoritative config root",
			"Ignored plugin symlink-escape@test-market: installPath escapes the authoritative config root",
		]);
		const registryPluginPaths = result.plugins
			.filter(plugin => plugin.id !== "explicit-outside@__local__")
			.map(plugin => plugin.path);

		const reportedUserPaths = [
			result.configHomeDir,
			result.configHomeFromHostileArg,
			result.agentDir,
			...result.configDirOutput,
			result.userPath,
			...result.commands.map(command => command.path),
			...result.skills.map(skill => skill.path),
			...registryPluginPaths,
		].filter((candidate): candidate is string => candidate !== null);
		expect(reportedUserPaths.every(candidate => isWithin(sandbox.configRoot, candidate))).toBe(true);
		expect(isWithin(sandbox.configRoot, sandbox.explicitPluginDir)).toBe(false);
		expect(stdout).not.toContain("decoy");
		expect(stdout).not.toContain(sandbox.hostileHome);
		expect(stdout).not.toContain(sandbox.hostileXdg);
		expect(stdout).not.toContain(sandbox.hostileAgentDir);
		expect(
			await Promise.all([tree(sandbox.hostileHome), tree(sandbox.hostileXdg), tree(sandbox.hostileAgentDir)]),
		).toEqual(hostileBefore);
	});
});
