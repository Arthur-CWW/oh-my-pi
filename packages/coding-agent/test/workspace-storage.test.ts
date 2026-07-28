import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	buildWorkspaceStorageStatus,
	planWorkspaceStorageMigration,
	validateSparsePatterns,
} from "../src/cli/workspace-storage-cli";

const roots: string[] = [];

function root(name: string): string {
	const value = fs.mkdtempSync(path.join(os.tmpdir(), `omp-workspace-storage-${name}-`));
	roots.push(value);
	return value;
}

function env(base: string, bin: string): NodeJS.ProcessEnv {
	const dataHome = path.join(base, "xdg-data");
	return {
		...process.env,
		HOME: path.join(base, "home"),
		XDG_DATA_HOME: dataHome,
		OMP_RELEASE_REGISTRY_PATH: path.join(dataHome, "omp", "release-registry.json"),
		OMP_RELEASES_DIR: path.join(dataHome, "omp", "releases"),
		OMP_LINK_GLOBAL_BIN: bin,
		OMP_LINK_REPO_ROOT: path.join(base, "workspace"),
	};
}

function workspaceLocal(base: string, name: string): string {
	return path.join(base, "search", "local", name, "vendor", "oh-my-pi", "local");
}

function releaseFile(directory: string, digest: string, contents: string): string {
	const file = path.join(directory, `omp-${digest}`);
	fs.writeFileSync(file, contents);
	fs.chmodSync(file, 0o555);
	return file;
}
async function runCommands(
	commands: readonly string[],
	digest: string,
	cwd: string,
): Promise<void> {
	for (const command of commands) {
		const child = Bun.spawn(["bash", "-euo", "pipefail", "-c", command], {
			cwd,
			env: { ...env(cwd, path.join(cwd, "bin")), OMP_WORKSPACE_STORAGE_PLAN_DIGEST: digest },
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await child.exited;
		if (exitCode !== 0)
			throw new Error(`workspace storage command failed (${exitCode}): ${command}`);
	}
}

afterAll(() => {
	for (const value of roots) fs.rmSync(value, { recursive: true, force: true });
});

describe("workspace storage status and sparse guards", () => {
	it("reports allocated bytes and valid stable, previous, and candidate registry state", async () => {
		const base = root("status");
		const bin = path.join(base, "bin");
		const dataHome = path.join(base, "xdg-data", "omp");
		const releases = path.join(dataHome, "releases");
		const registryPath = path.join(dataHome, "release-registry.json");
		await fsp.mkdir(path.join(base, "workspace", "vendor", "oh-my-pi"), { recursive: true });
		await fsp.mkdir(releases, { recursive: true });
		await fsp.mkdir(path.join(dataHome, "workspace-local"), { recursive: true });
		await fsp.writeFile(path.join(dataHome, "workspace-local", "state.json"), "{}\n");
		await fsp.mkdir(bin, { recursive: true });
		const stable = "a".repeat(64),
			previous = "b".repeat(64),
			candidate = "c".repeat(64);
		releaseFile(releases, stable, "stable bytes\n");
		releaseFile(releases, previous, "previous bytes\n");
		releaseFile(releases, candidate, "candidate bytes\n");
		const timestamp = "2026-07-26T00:00:00.000Z";
		fs.writeFileSync(
			registryPath,
			JSON.stringify({
				schemaVersion: 1,
				stable,
				previous,
				candidate,
				receiptDigest: null,
				timestamps: { candidate: timestamp, blessed: timestamp, rollback: null },
			}) + "\n",
		);
		fs.symlinkSync(
			path.join(dataHome, "workspace-local"),
			path.join(base, "workspace", "vendor", "oh-my-pi", "local"),
		);
		const status = await buildWorkspaceStorageStatus({ env: env(base, bin) });
		expect(status.workspaceLocal.sourceAlias.kind).toBe("symlink");
		expect(status.workspaceLocal.sharedStore.kind).toBe("directory");
		expect(status.workspaceLocal.sharedStore.physicalBytes).toBeGreaterThan(0);
		expect(status.releases.sharedStore.physicalBytes).toBeGreaterThan(0);
		expect(status.releases.releaseCount).toBe(3);
		expect(status.registry.sharedStore.physicalBytes).toBeGreaterThan(0);
		expect(status.registry.state).toEqual({ state: "valid", stable, previous, candidate });
	});

	it("rejects exact full sparse patterns only for implementation without a waiver", () => {
		expect(validateSparsePatterns(["."], "implementation")).toMatchObject({
			allowed: false,
			fullSparse: true,
			waived: false,
		});
		expect(validateSparsePatterns(["."], " Implementation ")).toMatchObject({
			allowed: false,
			lane: "implementation",
		});
		expect(validateSparsePatterns(["."], "implementation", true)).toMatchObject({
			allowed: true,
			fullSparse: true,
			waived: true,
		});
		expect(validateSparsePatterns(["."], "review")).toMatchObject({
			allowed: true,
			fullSparse: true,
		});
		expect(validateSparsePatterns(["packages/coding-agent"], "implementation")).toMatchObject({
			allowed: true,
			fullSparse: false,
		});
	});
});

describe("workspace storage migration plans", () => {
	it("dry-runs, guards, deduplicates, preserves registry bytes, and rolls back real fixtures", async () => {
		const base = root("migration");
		const search = path.join(base, "search");
		const bin = path.join(base, "bin");
		const legacyReleases = path.join(bin, ".omp-releases");
		const legacyRegistry = path.join(bin, ".omp-release-registry.json");
		await fsp.mkdir(workspaceLocal(base, "one"), { recursive: true });
		await fsp.mkdir(workspaceLocal(base, "two"), { recursive: true });
		await fsp.mkdir(legacyReleases, { recursive: true });
		await fsp.mkdir(bin, { recursive: true });
		fs.writeFileSync(
			path.join(workspaceLocal(base, "one"), "shared.txt"),
			"same workspace state\n",
		);
		fs.writeFileSync(
			path.join(workspaceLocal(base, "two"), "shared.txt"),
			"same workspace state\n",
		);
		const digest = "d".repeat(64);
		releaseFile(legacyReleases, digest, "legacy release\n");
		const registryJson =
			JSON.stringify({ schemaVersion: 1, stable: digest, previous: null, candidate: null }) + "\n";
		fs.writeFileSync(legacyRegistry, registryJson);
		const isolated = env(base, bin);
		const plan = await planWorkspaceStorageMigration({
			searchRoot: search,
			dryRun: true,
			env: isolated,
		});
		expect(plan.dryRun).toBe(true);
		expect(plan.workspaceRoots).toEqual([
			search,
			path.join(search, "local", "one"),
			path.join(search, "local", "two"),
		]);
		expect(
			plan.sources.filter(
				(source) => source.store === "workspace-local" && source.action === "migrate",
			),
		).toHaveLength(2);
		expect(
			plan.sources.filter((source) => source.store === "releases" && source.action === "migrate"),
		).toHaveLength(1);
		expect(
			plan.sources.filter((source) => source.store === "registry" && source.action === "migrate"),
		).toHaveLength(1);
		expect(plan.applyCommands[0]).toContain("OMP_WORKSPACE_STORAGE_PLAN_DIGEST");
		expect(plan.rollbackCommands[0]).toContain("OMP_WORKSPACE_STORAGE_PLAN_DIGEST");
		expect(plan.applyCommands.join("\n")).toContain(plan.digest);
		expect(plan.projectedReclaimBytes).toBeGreaterThan(0);
		await runCommands(plan.applyCommands, plan.digest, base);
		const sharedLocal = path.join(base, "xdg-data", "omp", "workspace-local");
		const sharedReleases = path.join(base, "xdg-data", "omp", "releases");
		const sharedRegistry = path.join(base, "xdg-data", "omp", "release-registry.json");
		expect(fs.realpathSync(workspaceLocal(base, "one"))).toBe(sharedLocal);
		expect(fs.realpathSync(workspaceLocal(base, "two"))).toBe(sharedLocal);
		expect(fs.realpathSync(path.join(bin, ".omp-releases"))).toBe(sharedReleases);
		expect(fs.realpathSync(path.join(bin, ".omp-release-registry.json"))).toBe(sharedRegistry);
		expect(fs.readdirSync(sharedReleases).filter((name) => name.startsWith("omp-")).length).toBe(1);
		expect(fs.readFileSync(sharedRegistry, "utf8")).toBe(registryJson);
		await runCommands(plan.rollbackCommands, plan.digest, base);
		expect(fs.lstatSync(workspaceLocal(base, "one")).isDirectory()).toBe(true);
		expect(fs.lstatSync(workspaceLocal(base, "two")).isDirectory()).toBe(true);
		expect(fs.lstatSync(path.join(bin, ".omp-releases")).isDirectory()).toBe(true);
		expect(fs.lstatSync(path.join(bin, ".omp-release-registry.json")).isFile()).toBe(true);
		expect(fs.readFileSync(path.join(bin, ".omp-release-registry.json"), "utf8")).toBe(
			registryJson,
		);
	});
});
