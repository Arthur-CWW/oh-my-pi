import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const runner = join(import.meta.dir, "remote-workspace.nu");

interface FixturePaths {
	base: string;
	home: string;
	repo: string;
	lanes: string;
	bundles: string;
	manifest: string;
	catalog: string;
}

interface LaneBundle {
	change_id: string;
	commit_id: string;
	path: string;
	receipt: string;
}

interface LaneRecord {
	root: string;
	bundle: LaneBundle | null;
}

interface LaneManifest {
	lanes: Record<string, LaneRecord>;
}

let fixture: FixturePaths;

function command(argv: string[], cwd = fixture.repo): string {
	const result = Bun.spawnSync(argv, {
		cwd,
		env: {
			...process.env,
			HOME: fixture.home,
			OMP_CONFIG_ROOT: join(fixture.base, "omp-config"),
			OMP_IRC_EXTERNAL_BUS_DB: join(fixture.base, "irc.sqlite"),
			OMP_SESSION_CONTROL_DB: join(fixture.base, "session-control.sqlite"),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0) throw new Error(`${argv.join(" ")} failed (${result.exitCode}): ${stderr || stdout}`);
	return stdout;
}

function nu(source: string): string {
	return command(["nu", "--no-config-file", "-c", `use '${runner}' *; let catalog = (open '${fixture.catalog}'); ${source}`]);
}

async function filesBelow(root: string): Promise<string[]> {
	const output: string[] = [];
	async function visit(directory: string, prefix: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (entry.name === ".jj" || entry.name === ".git") continue;
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await visit(join(directory, entry.name), relative);
			else output.push(relative);
		}
	}
	await visit(root, "");
	return output.sort();
}

async function manifest(): Promise<LaneManifest> {
	return (await Bun.file(fixture.manifest).json()) as LaneManifest;
}

beforeEach(async () => {
	const base = await mkdtemp(join(tmpdir(), "remote-lanes-"));
	fixture = {
		base,
		home: join(base, "home"),
		repo: join(base, "repo"),
		lanes: join(base, "lanes"),
		bundles: join(base, "bundles"),
		manifest: join(base, "lane-manifest.json"),
		catalog: join(base, "catalog.json"),
	};
	await mkdir(join(fixture.home, ".config", "jj"), { recursive: true });
	await writeFile(join(fixture.home, ".config", "jj", "config.toml"), 'user.name = "Lane Fixture"\nuser.email = "lane@example.invalid"\n');
	await mkdir(join(fixture.repo, "src", "alpha"), { recursive: true });
	await mkdir(join(fixture.repo, "src", "beta"), { recursive: true });
	await mkdir(join(fixture.repo, "shared"), { recursive: true });
	await mkdir(join(fixture.repo, "streams", "harness"), { recursive: true });
	await Promise.all([
		writeFile(join(fixture.repo, "AGENTS.md"), "fixture\n"),
		writeFile(join(fixture.repo, "mise.toml"), "[tools]\n"),
		writeFile(join(fixture.repo, "package.json"), "{}\n"),
		writeFile(join(fixture.repo, "shared", "config.yml"), "fixture: true\n"),
		writeFile(join(fixture.repo, "streams", "harness", "GOAL.md"), "fixture goal\n"),
		writeFile(join(fixture.repo, "src", "alpha", "owned.txt"), "alpha base\n"),
		writeFile(join(fixture.repo, "src", "beta", "owned.txt"), "beta base\n"),
	]);
	command(["git", "init", "--initial-branch=main"], fixture.repo);
	command(["git", "config", "user.name", "Lane Fixture"], fixture.repo);
	command(["git", "config", "user.email", "lane@example.invalid"], fixture.repo);
	command(["git", "add", "."], fixture.repo);
	command(["git", "commit", "-m", "fixture base"], fixture.repo);
	command(["jj", "git", "init", "--colocate", "."], fixture.repo);
	const catalog = {
		shared: { laneSharedPaths: ["AGENTS.md", "mise.toml", "package.json"] },
		workspaces: {
			fixture: {
				root: fixture.repo,
				laneRoot: fixture.lanes,
				laneManifest: fixture.manifest,
				laneBundleRoot: fixture.bundles,
				sharedCacheRoots: [join(fixture.base, "cache")],
				streams: {
					harness: {
						ompConfig: "shared/config.yml",
						promptRefs: ["streams/harness/GOAL.md"],
					},
				},
				laneStreams: { harness: { ownedRoots: ["src/alpha", "src/beta"] } },
			},
		},
	};
	await writeFile(fixture.catalog, JSON.stringify(catalog));
});

afterEach(async () => {
	await rm(fixture.base, { recursive: true, force: true });
});

describe("remote sparse jj lane lifecycle", () => {
	test("keeps concurrent lanes disjoint and refuses dirty or unbundled drops", async () => {
		expect(() => nu('lane-new $catalog fixture harness invalid ["scripts/not-owned"]')).toThrow(
			"Owned path is outside the stream manifest",
		);
		nu('lane-new $catalog fixture harness alpha ["src/alpha"]');
		nu('lane-new $catalog fixture harness beta ["src/beta"]');
		const state = await manifest();
		const alphaFiles = await filesBelow(state.lanes.alpha.root);
		const betaFiles = await filesBelow(state.lanes.beta.root);

		expect(alphaFiles).toEqual([
			"AGENTS.md",
			"mise.toml",
			"package.json",
			"shared/config.yml",
			"src/alpha/owned.txt",
			"streams/harness/GOAL.md",
		]);
		expect(betaFiles).toEqual([
			"AGENTS.md",
			"mise.toml",
			"package.json",
			"shared/config.yml",
			"src/beta/owned.txt",
			"streams/harness/GOAL.md",
		]);
		expect(alphaFiles).not.toContain("src/beta/owned.txt");
		expect(betaFiles).not.toContain("src/alpha/owned.txt");

		await writeFile(join(state.lanes.alpha.root, "src", "alpha", "owned.txt"), "alpha lane change\n");
		expect(() => nu('lane-drop $catalog fixture "alpha"')).toThrow("Refusing to drop unbundled lane");
		nu('lane-bundle $catalog fixture "alpha"');
		nu('lane-drop $catalog fixture "alpha"');

		nu('lane-bundle $catalog fixture "beta"');
		await writeFile(join(state.lanes.beta.root, "src", "beta", "owned.txt"), "beta after bundle\n");
		expect(() => nu('lane-drop $catalog fixture "beta"')).toThrow("Refusing to drop dirty lane changed after bundle");
		nu('lane-bundle $catalog fixture "beta"');
		nu('lane-drop $catalog fixture "beta"');
	});

	test("bundle then drop preserves the exact jj change for standard restore", async () => {
		nu('lane-new $catalog fixture harness restore ["src/alpha"]');
		let state = await manifest();
		await writeFile(join(state.lanes.restore.root, "src", "alpha", "owned.txt"), "durable lane payload\n");
		nu('lane-bundle $catalog fixture "restore"');
		state = await manifest();
		const bundle = state.lanes.restore.bundle;
		expect(bundle).not.toBeNull();
		if (!bundle) throw new Error("bundle record missing");
		nu('lane-drop $catalog fixture "restore"');

		const receipt = (await Bun.file(bundle.receipt).json()) as { bundle_ref: string };
		const restoreRef = "refs/heads/restored-lane";
		command(["git", "-C", fixture.repo, "fetch", bundle.path, `${receipt.bundle_ref}:${restoreRef}`]);
		command(["jj", "-R", fixture.repo, "git", "import"]);
		const restoredChange = command(["jj", "-R", fixture.repo, "log", "-r", "restored-lane", "--no-graph", "-T", "change_id"]).trim();
		const restoredPayload = command(["jj", "-R", fixture.repo, "file", "show", "-r", "restored-lane", "src/alpha/owned.txt"]);
		expect(restoredChange).toBe(bundle.change_id);
		expect(restoredPayload).toBe("durable lane payload\n");
	});
});

interface ReviewTarget {
	name: string;
	kind: "direct" | "portless" | "static";
	aliasSuffix: string;
	localPort: number;
	path: string;
	route?: string;
	remotePort?: number;
	artifact?: string;
	artifactDigest?: string;
}

interface ReviewForwarding {
	enabled: boolean;
	aliasPrefix: string;
	localPortOffset: number;
}

interface CatalogWorkspace {
	extends?: string;
	host: string;
	capabilities: { reviewForwarding: ReviewForwarding };
	streams?: Record<string, { reviewWorkspace: string; review: ReviewTarget[] }>;
}

interface Catalog {
	workspaces: Record<string, CatalogWorkspace>;
}

const catalogPath = join(import.meta.dir, "..", "catalog", "remote-workspaces.yml");

function invokeRunner(catalogFile: string, argv: string[]): { exitCode: number; output: string } {
	const result = Bun.spawnSync(["nu", "--no-config-file", runner, ...argv, "--catalog", catalogFile], {
		cwd: fixture.repo,
		env: {
			...process.env,
			HOME: fixture.home,
			OMP_CONFIG_ROOT: join(fixture.base, "omp-config"),
			OMP_IRC_EXTERNAL_BUS_DB: join(fixture.base, "irc.sqlite"),
			OMP_SESSION_CONTROL_DB: join(fixture.base, "session-control.sqlite"),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	return { exitCode: result.exitCode ?? -1, output: `${result.stdout.toString()}${result.stderr.toString()}` };
}

function loadCatalog(): Catalog {
	const result = Bun.spawnSync(["nu", "--no-config-file", "-c", `open '${catalogPath}' | to json`], { stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(`catalog read failed: ${result.stderr.toString()}`);
	return JSON.parse(result.stdout.toString()) as Catalog;
}

async function catalogVariant(mutate: (catalog: Catalog) => void): Promise<string> {
	const catalog = loadCatalog();
	mutate(catalog);
	const path = join(fixture.base, `catalog-${crypto.randomUUID()}.json`);
	await writeFile(path, JSON.stringify(catalog));
	return path;
}

function addStaticTarget(catalog: Catalog, overrides: Partial<ReviewTarget> = {}): ReviewTarget {
	const harness = catalog.workspaces["desktop-agents"].streams?.harness;
	if (!harness) throw new Error("harness stream missing");
	const target: ReviewTarget = {
		name: "fixture-report",
		kind: "static",
		aliasSuffix: "fixture-report",
		localPort: 19000,
		path: "/",
		artifact: "reports/fixture.html",
		artifactDigest: "a".repeat(64),
		...overrides,
	};
	harness.review.push(target);
	return target;
}

describe("remote review catalog", () => {
	test("gives every forwarding host its own alias prefix and non-overlapping local ports", () => {
		const catalog = loadCatalog();
		const base = catalog.workspaces["desktop-agents"];
		expect(catalog.workspaces["nixbox-agents"]).toMatchObject({
			extends: "desktop-agents",
			host: "nixbox",
			capabilities: { reviewForwarding: { enabled: true, aliasPrefix: "nixbox", localPortOffset: 200 } },
		});

		const prefixes: string[] = [];
		const offsets: number[] = [];
		const bindings: string[] = [];
		for (const [name, workspace] of Object.entries(catalog.workspaces)) {
			const forwarding = workspace.capabilities.reviewForwarding;
			if (!forwarding.enabled) continue;
			prefixes.push(forwarding.aliasPrefix);
			offsets.push(forwarding.localPortOffset);
			const streams = workspace.streams ?? base.streams ?? {};
			for (const [streamName, stream] of Object.entries(streams)) {
				expect(stream.reviewWorkspace).toMatch(/^workspace:[1-9][0-9]*$/);
				for (const target of stream.review) {
					const suffix = target.aliasSuffix === streamName ? streamName : `${streamName}-${target.aliasSuffix}`;
					bindings.push(`${forwarding.aliasPrefix}-${suffix}`);
					bindings.push(`port:${target.localPort + forwarding.localPortOffset}`);
				}
			}
			expect(streams, `${name} resolves streams`).not.toEqual({});
		}
		expect(new Set(prefixes).size).toBe(prefixes.length);
		expect(new Set(offsets).size).toBe(offsets.length);
		expect(new Set(bindings).size).toBe(bindings.length);
	});

	test("omits the unsynced reliability report target", () => {
		const harness = loadCatalog().workspaces["desktop-agents"].streams?.harness;
		if (!harness) throw new Error("harness stream missing");
		expect(harness.review.map((target) => target.name)).toEqual(["fleet-board"]);
		expect(harness.review.some((target) => target.artifact?.includes("reliability-report"))).toBe(false);
	});

	test("computes the exact forwarding metadata contract", async () => {
		const output = command([
			"nu",
			"--no-config-file",
			"-c",
			`use '${runner}' *; let catalog = (open '${catalogPath}'); review-forward-targets $catalog.workspaces.desktop-agents harness | to json`,
		]);
		const targets = JSON.parse(output) as Array<Record<string, unknown>>;
		expect(targets).toEqual([
			{
				name: "fleet-board",
				kind: "portless",
				alias: "desktop-harness-fleet-board",
				path: "/",
				artifactDigest: null,
				localPort: 18440,
			},
		]);

		const digest = "b".repeat(64);
		const staticWorkspacePath = join(fixture.base, "static-forward-metadata.json");
		await writeFile(
			staticWorkspacePath,
			JSON.stringify({
				capabilities: { reviewForwarding: { enabled: true, aliasPrefix: "fixture", localPortOffset: 7 } },
				streams: {
					reports: {
						review: [
							{
								name: "report",
								kind: "static",
								aliasSuffix: "report",
								localPort: 19000,
								path: "/index.html",
								artifact: "reports/index.html",
								artifactDigest: digest,
							},
						],
					},
				},
			}),
		);
		const staticOutput = command([
			"nu",
			"--no-config-file",
			"-c",
			`use '${runner}' *; let workspace = (open '${staticWorkspacePath}'); review-forward-targets $workspace reports | to json`,
		]);
		expect(JSON.parse(staticOutput)).toEqual([
			{
				name: "report",
				kind: "static",
				alias: "fixture-reports-report",
				path: "/index.html",
				artifactDigest: digest,
				localPort: 19007,
			},
		]);
	});

	test("accepts the shipped catalog and rejects unsafe or colliding review declarations", async () => {
		const accepted = invokeRunner(catalogPath, ["not-an-action", "--workspace", "nixbox-agents"]);
		expect(accepted.exitCode).not.toBe(0);
		expect(accepted.output).toContain("Usage: remote-workspace.nu");

		const collidingPorts = await catalogVariant((catalog) => {
			catalog.workspaces["nixbox-agents"].capabilities.reviewForwarding.localPortOffset = 100;
		});
		expect(invokeRunner(collidingPorts, ["status", "harness"]).output).toContain("Effective review local ports must be unique");

		const collidingAliases = await catalogVariant((catalog) => {
			catalog.workspaces["nixbox-agents"].capabilities.reviewForwarding.aliasPrefix = "h11";
		});
		expect(invokeRunner(collidingAliases, ["status", "harness"]).output).toContain("Effective review aliases must be unique");

		const missingDigest = await catalogVariant((catalog) => {
			addStaticTarget(catalog, { artifactDigest: undefined });
		});
		expect(invokeRunner(missingDigest, ["status", "harness"]).output).toContain(
			"Static review target must declare a lowercase sha256 artifactDigest",
		);

		const uppercaseDigest = await catalogVariant((catalog) => {
			addStaticTarget(catalog, { artifactDigest: "A".repeat(64) });
		});
		expect(invokeRunner(uppercaseDigest, ["status", "harness"]).output).toContain(
			"Static review target must declare a lowercase sha256 artifactDigest",
		);

		const unsafeArtifact = await catalogVariant((catalog) => {
			addStaticTarget(catalog, { artifact: "../../etc/passwd" });
		});
		expect(invokeRunner(unsafeArtifact, ["status", "harness"]).output).toContain("Unsafe static review artifact");

		const unrenderableArtifact = await catalogVariant((catalog) => {
			addStaticTarget(catalog, { artifact: "reports/fixture.bin" });
		});
		expect(invokeRunner(unrenderableArtifact, ["status", "harness"]).output).toContain("Unsupported static review artifact type");

		const digestOnLiveTarget = await catalogVariant((catalog) => {
			const harness = catalog.workspaces["desktop-agents"].streams?.harness;
			if (!harness) throw new Error("harness stream missing");
			harness.review[0].artifactDigest = "a".repeat(64);
		});
		expect(invokeRunner(digestOnLiveTarget, ["status", "harness"]).output).toContain(
			"artifactDigest is only valid for static review targets",
		);

		const unknownKind = await catalogVariant((catalog) => {
			const harness = catalog.workspaces["desktop-agents"].streams?.harness;
			if (!harness) throw new Error("harness stream missing");
			harness.review[0].kind = "tunnel" as ReviewTarget["kind"];
		});
		expect(invokeRunner(unknownKind, ["status", "harness"]).output).toContain("Invalid review kind");
	});
});
