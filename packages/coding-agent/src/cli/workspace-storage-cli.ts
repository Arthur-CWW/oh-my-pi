import { createHash } from "node:crypto";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";
import {
	type ReleaseStoragePaths,
	resolveReleaseStoragePaths,
} from "../session/release-storage-paths";

const PHYSICAL_BLOCK_BYTES = 512;
const MAX_REGISTRY_BYTES = 1024 * 1024;
const RELEASE_NAME = /^omp-[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REGISTRY_KEYS = [
	"schemaVersion",
	"stable",
	"previous",
	"candidate",
	"receiptDigest",
	"timestamps",
] as const;
const TIMESTAMP_KEYS = ["candidate", "blessed", "rollback"] as const;

export type StorageEntryKind = "missing" | "symlink" | "directory" | "file" | "other";

export interface StorageEntryStatus {
	readonly path: string;
	readonly kind: StorageEntryKind;
	readonly linkTarget: string | null;
	readonly physicalBytes: number;
}

export type ReleaseRegistryState =
	| {
			readonly state: "valid";
			readonly stable: string | null;
			readonly previous: string | null;
			readonly candidate: string | null;
	  }
	| {
			readonly state: "missing";
			readonly stable: null;
			readonly previous: null;
			readonly candidate: null;
	  }
	| {
			readonly state: "invalid";
			readonly stable: null;
			readonly previous: null;
			readonly candidate: null;
			readonly error: string;
	  };

export interface WorkspaceStoragePaths extends ReleaseStoragePaths {
	readonly workspaceRoot: string;
	readonly workspaceLocalAlias: string;
}

export interface WorkspaceStorageStatus {
	readonly paths: WorkspaceStoragePaths;
	readonly workspaceLocal: {
		readonly sourceAlias: StorageEntryStatus;
		readonly sharedStore: StorageEntryStatus;
	};
	readonly releases: {
		readonly sharedStore: StorageEntryStatus;
		readonly releaseCount: number;
	};
	readonly registry: {
		readonly sharedStore: StorageEntryStatus;
		readonly state: ReleaseRegistryState;
	};
}

export interface ResolveWorkspaceStoragePathOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly workspaceRoot?: string;
}

export function resolveWorkspaceStoragePaths(
	options: ResolveWorkspaceStoragePathOptions = {},
): WorkspaceStoragePaths {
	const env = options.env ?? process.env;
	const selectedWorkspaceRoot = options.workspaceRoot ?? env.OMP_LINK_REPO_ROOT ?? process.cwd();
	if (selectedWorkspaceRoot.trim().length === 0)
		throw new Error("Workspace root must not be empty");
	const workspaceRoot = path.resolve(selectedWorkspaceRoot);
	const shared = resolveReleaseStoragePaths(env);
	return {
		...shared,
		workspaceRoot,
		workspaceLocalAlias: path.join(workspaceRoot, "oh-my-pi", "local"),
	};
}

function storageEntryKind(stat: fsSync.Stats): Exclude<StorageEntryKind, "missing"> {
	if (stat.isSymbolicLink()) return "symlink";
	if (stat.isDirectory()) return "directory";
	if (stat.isFile()) return "file";
	return "other";
}

async function lstatOrMissing(entryPath: string): Promise<fsSync.Stats | null> {
	try {
		return await fs.lstat(entryPath);
	} catch (error) {
		if (isEnoent(error)) return null;
		throw error;
	}
}

/** Sum allocated stat blocks recursively while treating every symlink as a leaf. */
export async function allocatedPhysicalBytes(entryPath: string): Promise<number> {
	const pending = [path.resolve(entryPath)];
	let bytes = 0;
	while (pending.length > 0) {
		const current = pending.pop();
		if (current === undefined) break;
		const stat = await lstatOrMissing(current);
		if (stat === null) continue;
		bytes += stat.blocks * PHYSICAL_BLOCK_BYTES;
		if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
		let entries: fsSync.Dirent[];
		try {
			entries = await fs.readdir(current, { withFileTypes: true });
		} catch (error) {
			if (isEnoent(error)) continue;
			throw error;
		}
		for (const entry of entries) pending.push(path.join(current, entry.name));
	}
	return bytes;
}

export async function inspectStorageEntry(entryPath: string): Promise<StorageEntryStatus> {
	const absolutePath = path.resolve(entryPath);
	const stat = await lstatOrMissing(absolutePath);
	if (stat === null) {
		return { path: absolutePath, kind: "missing", linkTarget: null, physicalBytes: 0 };
	}
	let linkTarget: string | null = null;
	if (stat.isSymbolicLink()) {
		const rawTarget = await fs.readlink(absolutePath);
		linkTarget = path.resolve(path.dirname(absolutePath), rawTarget);
	}
	return {
		path: absolutePath,
		kind: storageEntryKind(stat),
		linkTarget,
		physicalBytes: await allocatedPhysicalBytes(absolutePath),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function nullableDigest(value: unknown): value is string | null {
	return value === null || (typeof value === "string" && SHA256.test(value));
}

function invalidRegistry(error: string): ReleaseRegistryState {
	return { state: "invalid", stable: null, previous: null, candidate: null, error };
}

export function parseReleaseRegistryState(json: string): ReleaseRegistryState {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		return invalidRegistry("Release registry is not valid JSON");
	}
	if (!isRecord(value) || !hasExactKeys(value, REGISTRY_KEYS)) {
		return invalidRegistry("Release registry has unexpected fields");
	}
	const timestamps = value.timestamps;
	if (
		value.schemaVersion !== 1 ||
		!nullableDigest(value.stable) ||
		!nullableDigest(value.previous) ||
		!nullableDigest(value.candidate) ||
		!nullableDigest(value.receiptDigest) ||
		!isRecord(timestamps) ||
		!hasExactKeys(timestamps, TIMESTAMP_KEYS) ||
		!Object.values(timestamps).every(
			(item) =>
				item === null ||
				(typeof item === "string" &&
					Number.isFinite(Date.parse(item)) &&
					new Date(Date.parse(item)).toISOString() === item),
		)
	) {
		return invalidRegistry("Release registry schema, channel digests, or timestamps are invalid");
	}
	return {
		state: "valid",
		stable: value.stable,
		previous: value.previous,
		candidate: value.candidate,
	};
}

export async function readReleaseRegistryState(
	registryPath: string,
): Promise<ReleaseRegistryState> {
	let handle: fs.FileHandle | undefined;
	try {
		handle = await fs.open(
			path.resolve(registryPath),
			fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW,
		);
		const stat = await handle.stat();
		if (!stat.isFile()) return invalidRegistry("Release registry is not a regular file");
		if (stat.size > MAX_REGISTRY_BYTES) {
			return invalidRegistry(`Release registry exceeds ${MAX_REGISTRY_BYTES} bytes`);
		}
		return parseReleaseRegistryState(await handle.readFile({ encoding: "utf8" }));
	} catch (error) {
		if (isEnoent(error)) {
			return { state: "missing", stable: null, previous: null, candidate: null };
		}
		return invalidRegistry(
			`Release registry is unavailable or unsafe: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		await handle?.close();
	}
}

export async function countImmutableReleases(releasesDir: string): Promise<number> {
	const absolutePath = path.resolve(releasesDir);
	const stat = await lstatOrMissing(absolutePath);
	if (stat === null || !stat.isDirectory() || stat.isSymbolicLink()) return 0;
	const entries = await fs.readdir(absolutePath, { withFileTypes: true });
	return entries.filter(
		(entry) => entry.isFile() && !entry.isSymbolicLink() && RELEASE_NAME.test(entry.name),
	).length;
}

export async function buildWorkspaceStorageStatus(
	options: ResolveWorkspaceStoragePathOptions = {},
): Promise<WorkspaceStorageStatus> {
	const paths = resolveWorkspaceStoragePaths(options);
	const [
		sourceAlias,
		workspaceLocalStore,
		releasesStore,
		releaseCount,
		registryStore,
		registryState,
	] = await Promise.all([
		inspectStorageEntry(paths.workspaceLocalAlias),
		inspectStorageEntry(paths.workspaceLocalDir),
		inspectStorageEntry(paths.releasesDir),
		countImmutableReleases(paths.releasesDir),
		inspectStorageEntry(paths.registryPath),
		readReleaseRegistryState(paths.registryPath),
	]);
	return {
		paths,
		workspaceLocal: { sourceAlias, sharedStore: workspaceLocalStore },
		releases: { sharedStore: releasesStore, releaseCount },
		registry: { sharedStore: registryStore, state: registryState },
	};
}

export interface CommandRunResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export type WorkspaceCommandRunner = (argv: readonly string[]) => Promise<CommandRunResult>;

export async function runWorkspaceCommand(argv: readonly string[]): Promise<CommandRunResult> {
	const child = Bun.spawn([...argv], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, stdout, stderr };
}

export function parseSparsePatterns(stdout: string): string[] {
	return stdout
		.split("\n")
		.map((pattern) => pattern.trim())
		.filter((pattern) => pattern.length > 0);
}

export async function listSparsePatterns(
	repositoryRoot: string,
	runner: WorkspaceCommandRunner = runWorkspaceCommand,
): Promise<string[]> {
	const root = path.resolve(repositoryRoot);
	const result = await runner(["jj", "sparse", "list", "--repository", root]);
	if (result.exitCode !== 0) {
		throw new Error(
			`jj sparse list failed (${result.exitCode}): ${result.stderr.trim() || "no error output"}`,
		);
	}
	return parseSparsePatterns(result.stdout);
}

export interface SparsePatternValidation {
	readonly allowed: boolean;
	readonly lane: string;
	readonly fullSparse: boolean;
	readonly waived: boolean;
	readonly reason: string | null;
}

export function validateSparsePatterns(
	patterns: readonly string[],
	lane: string,
	waiveFullSparse = false,
): SparsePatternValidation {
	const normalizedLane = lane.trim().toLowerCase();
	if (normalizedLane.length === 0) throw new Error("Workspace lane must not be empty");
	const fullSparse = patterns.includes(".");
	const rejected = normalizedLane === "implementation" && fullSparse && !waiveFullSparse;
	return {
		allowed: !rejected,
		lane: normalizedLane,
		fullSparse,
		waived: waiveFullSparse,
		reason: rejected
			? "Implementation lanes may not use the exact full-workspace sparse pattern `.` without --waive-full-sparse"
			: null,
	};
}

export type MigrationStore = "workspace-local" | "releases" | "registry";

export interface MigrationSource {
	readonly store: MigrationStore;
	readonly workspaceRoot: string | null;
	readonly path: string;
	readonly kind: StorageEntryKind;
	readonly linkTarget: string | null;
	readonly physicalBytes: number;
	readonly action: "migrate" | "already-shared" | "none";
}

export interface MigrationStorePlan {
	readonly store: MigrationStore;
	readonly target: StorageEntryStatus;
	readonly targetEmpty: boolean;
	readonly seedSource: string | null;
	readonly sourcePaths: readonly string[];
	readonly projectedReclaimBytes: number;
}

export interface WorkspaceStorageMigrationPlan {
	readonly schemaVersion: 1;
	readonly dryRun: true;
	readonly searchRoot: string;
	readonly workspaceRoots: readonly string[];
	readonly storagePaths: ReleaseStoragePaths;
	readonly sources: readonly MigrationSource[];
	readonly stores: readonly MigrationStorePlan[];
	readonly projectedReclaimBytes: number;
	readonly digest: string;
	readonly applyCommands: readonly string[];
	readonly rollbackCommands: readonly string[];
}

export interface WorkspaceStorageMigrationOptions {
	readonly searchRoot: string;
	readonly dryRun: boolean;
	readonly env?: NodeJS.ProcessEnv;
}

export async function discoverWorkspaceRoots(searchRoot: string): Promise<string[]> {
	const root = path.resolve(searchRoot);
	const roots = [root];
	const localRoot = path.join(root, "local");
	const localStat = await lstatOrMissing(localRoot);
	if (localStat === null || !localStat.isDirectory() || localStat.isSymbolicLink()) return roots;
	const children = await fs.readdir(localRoot, { withFileTypes: true });
	for (const child of children.sort((left, right) =>
		left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
	)) {
		if (child.isDirectory() && !child.isSymbolicLink())
			roots.push(path.join(localRoot, child.name));
	}
	return roots;
}

async function directoryIsEmpty(entryPath: string): Promise<boolean> {
	const stat = await lstatOrMissing(entryPath);
	if (stat === null) return true;
	if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
	const entries = await fs.readdir(entryPath);
	return entries.length === 0;
}

function configuredBinDir(env: NodeJS.ProcessEnv): string | undefined {
	const value = env.OMP_LINK_GLOBAL_BIN;
	if (value === undefined) return undefined;
	if (value.trim().length === 0) throw new Error("OMP_LINK_GLOBAL_BIN must not be empty");
	if (!path.isAbsolute(value)) throw new Error("OMP_LINK_GLOBAL_BIN must be an absolute path");
	return path.resolve(value);
}

function pathContains(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNoOverlap(source: string, target: string): void {
	if (pathContains(source, target) || pathContains(target, source)) {
		throw new Error(`Migration source and shared target overlap: ${source} and ${target}`);
	}
}

function expectedSourceKind(store: MigrationStore): "directory" | "file" {
	return store === "registry" ? "file" : "directory";
}

async function migrationSource(
	store: MigrationStore,
	sourcePath: string,
	targetPath: string,
	workspaceRoot: string | null,
): Promise<MigrationSource> {
	const entry = await inspectStorageEntry(sourcePath);
	if (entry.kind === "missing") return { ...entry, store, workspaceRoot, action: "none" };
	if (entry.kind === "symlink") {
		if (entry.linkTarget !== targetPath) {
			throw new Error(
				`${sourcePath} points to ${entry.linkTarget ?? "an unreadable target"}, expected ${targetPath}`,
			);
		}
		return { ...entry, store, workspaceRoot, action: "already-shared" };
	}
	const expectedKind = expectedSourceKind(store);
	if (entry.kind !== expectedKind) {
		throw new Error(`${sourcePath} is ${entry.kind}; expected an independent ${expectedKind}`);
	}
	assertNoOverlap(entry.path, targetPath);
	return { ...entry, store, workspaceRoot, action: "migrate" };
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function storageByteGuard(
	entryPath: string,
	kind: "directory" | "file",
	physicalBytes: number,
): string {
	const blocks = physicalBytes / PHYSICAL_BLOCK_BYTES;
	const typeGuard = kind === "directory" ? "test -d" : "test -f";
	return `${typeGuard} ${shellQuote(entryPath)} && test ! -L ${shellQuote(entryPath)} && test "$(BLOCKSIZE=512 du -s ${shellQuote(entryPath)} | cut -f1)" -eq ${blocks}`;
}

function sharedTargetGuard(store: MigrationStorePlan): string {
	const target = store.target;
	if (target.kind === "missing") {
		return `test ! -e ${shellQuote(target.path)} && test ! -L ${shellQuote(target.path)}`;
	}
	const kind = expectedSourceKind(store.store);
	const byteGuard = storageByteGuard(target.path, kind, target.physicalBytes);
	if (kind === "file") return byteGuard;
	const find = `find ${shellQuote(target.path)} -mindepth 1 -maxdepth 1 -print -quit`;
	return `${byteGuard} && test ${store.targetEmpty ? "-z" : "-n"} "$(${find})"`;
}

function contentEqualityGuard(kind: "directory" | "file", left: string, right: string): string {
	return kind === "directory"
		? `diff -qr ${shellQuote(left)} ${shellQuote(right)} >/dev/null`
		: `cmp -s ${shellQuote(left)} ${shellQuote(right)}`;
}

function symlinkTargetGuard(sourcePath: string, targetPath: string): string {
	return `test -L ${shellQuote(sourcePath)} && test "$(readlink ${shellQuote(sourcePath)})" = ${shellQuote(targetPath)}`;
}

export function createMigrationPlanDigest(value: unknown): string {
	const json = JSON.stringify(value);
	if (json === undefined) throw new Error("Migration plan digest input must be JSON-serializable");
	return createHash("sha256").update(json, "utf8").digest("hex");
}

function buildMigrationCommands(
	digest: string,
	stores: readonly MigrationStorePlan[],
	sources: readonly MigrationSource[],
): { readonly applyCommands: string[]; readonly rollbackCommands: string[] } {
	const digestGuard = `test "\${OMP_WORKSPACE_STORAGE_PLAN_DIGEST:-}" = ${shellQuote(digest)}`;
	const applyCommands = [digestGuard];
	const rollbackCommands = [digestGuard];
	for (const source of sources) {
		if (source.action !== "migrate") continue;
		applyCommands.push(
			storageByteGuard(source.path, expectedSourceKind(source.store), source.physicalBytes),
		);
	}
	for (const store of stores) {
		if (store.sourcePaths.length === 0) continue;
		applyCommands.push(sharedTargetGuard(store));
		const referencePath = store.seedSource ?? store.target.path;
		const kind = expectedSourceKind(store.store);
		for (const sourcePath of store.sourcePaths) {
			if (sourcePath !== store.seedSource) {
				applyCommands.push(contentEqualityGuard(kind, referencePath, sourcePath));
			}
		}
	}
	for (const store of stores) {
		if (store.sourcePaths.length === 0) continue;
		const targetPath = store.target.path;
		const seedSource = store.seedSource;
		const kind = expectedSourceKind(store.store);
		if (seedSource !== null) {
			applyCommands.push(`mkdir -p ${shellQuote(path.dirname(targetPath))}`);
			if (store.target.kind === "directory") applyCommands.push(`rmdir ${shellQuote(targetPath)}`);
			applyCommands.push(`mv ${shellQuote(seedSource)} ${shellQuote(targetPath)}`);
			applyCommands.push(`ln -s ${shellQuote(targetPath)} ${shellQuote(seedSource)}`);
		}
		for (const sourcePath of store.sourcePaths) {
			if (sourcePath === seedSource) continue;
			applyCommands.push(`${kind === "directory" ? "rm -rf" : "rm -f"} ${shellQuote(sourcePath)}`);
			applyCommands.push(`ln -s ${shellQuote(targetPath)} ${shellQuote(sourcePath)}`);
		}
	}
	for (const store of stores) {
		if (store.sourcePaths.length === 0) continue;
		const seed =
			store.seedSource === null
				? undefined
				: sources.find((source) => source.path === store.seedSource);
		const expectedBytes = seed?.physicalBytes ?? store.target.physicalBytes;
		rollbackCommands.push(
			storageByteGuard(store.target.path, expectedSourceKind(store.store), expectedBytes),
		);
		for (const sourcePath of store.sourcePaths) {
			rollbackCommands.push(symlinkTargetGuard(sourcePath, store.target.path));
		}
	}
	for (const store of [...stores].reverse()) {
		if (store.sourcePaths.length === 0) continue;
		const targetPath = store.target.path;
		const seedSource = store.seedSource;
		for (const sourcePath of [...store.sourcePaths].reverse()) {
			if (sourcePath === seedSource) continue;
			rollbackCommands.push(`rm ${shellQuote(sourcePath)}`);
			rollbackCommands.push(`cp -a ${shellQuote(targetPath)} ${shellQuote(sourcePath)}`);
		}
		if (seedSource !== null) {
			rollbackCommands.push(`rm ${shellQuote(seedSource)}`);
			rollbackCommands.push(`mv ${shellQuote(targetPath)} ${shellQuote(seedSource)}`);
			if (store.target.kind === "directory")
				rollbackCommands.push(`mkdir -p ${shellQuote(targetPath)}`);
		}
	}
	return { applyCommands, rollbackCommands };
}

export async function planWorkspaceStorageMigration(
	options: WorkspaceStorageMigrationOptions,
): Promise<WorkspaceStorageMigrationPlan> {
	if (!options.dryRun)
		throw new Error("Workspace storage migration is planning-only; --dry-run is required");
	if (options.searchRoot.trim().length === 0) throw new Error("--search-root must not be empty");
	const env = options.env ?? process.env;
	const searchRoot = path.resolve(options.searchRoot);
	const storagePaths = resolveReleaseStoragePaths(env);
	const workspaceRoots = await discoverWorkspaceRoots(searchRoot);
	const sources: MigrationSource[] = [];
	for (const workspaceRoot of workspaceRoots) {
		sources.push(
			await migrationSource(
				"workspace-local",
				path.join(workspaceRoot, "oh-my-pi", "local"),
				storagePaths.workspaceLocalDir,
				workspaceRoot,
			),
		);
	}
	const binDir = configuredBinDir(env);
	if (binDir !== undefined) {
		sources.push(
			await migrationSource(
				"releases",
				path.join(binDir, ".omp-releases"),
				storagePaths.releasesDir,
				null,
			),
			await migrationSource(
				"registry",
				path.join(binDir, ".omp-release-registry.json"),
				storagePaths.registryPath,
				null,
			),
		);
	}
	sources.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	const stores: MigrationStorePlan[] = [];
	for (const [store, targetPath] of [
		["workspace-local", storagePaths.workspaceLocalDir],
		["releases", storagePaths.releasesDir],
		["registry", storagePaths.registryPath],
	] as const) {
		if (store !== "workspace-local" && binDir === undefined) continue;
		const storeSources = sources.filter(
			(source) => source.store === store && source.action === "migrate",
		);
		const target = await inspectStorageEntry(targetPath);
		const expectedKind = expectedSourceKind(store);
		if (target.kind !== "missing" && target.kind !== expectedKind) {
			throw new Error(
				`Shared ${store} target ${target.path} is ${target.kind}; expected a ${expectedKind} or missing path`,
			);
		}
		for (const source of storeSources) assertNoOverlap(source.path, target.path);
		const targetEmpty =
			target.kind === "missing" ||
			(expectedKind === "directory" && (await directoryIsEmpty(target.path)));
		const seedSource = targetEmpty && storeSources.length > 0 ? storeSources[0]!.path : null;
		const independentBytes = storeSources.reduce(
			(total, source) => total + source.physicalBytes,
			0,
		);
		const seedBytes =
			seedSource === null
				? 0
				: (storeSources.find((source) => source.path === seedSource)?.physicalBytes ?? 0);
		stores.push({
			store,
			target,
			targetEmpty,
			seedSource,
			sourcePaths: storeSources.map((source) => source.path),
			projectedReclaimBytes: independentBytes - seedBytes,
		});
	}
	const digestPayload = {
		schemaVersion: 1,
		searchRoot,
		workspaceRoots,
		storagePaths,
		sources,
		stores,
	};
	const digest = createMigrationPlanDigest(digestPayload);
	const commands = buildMigrationCommands(digest, stores, sources);
	return {
		schemaVersion: 1,
		dryRun: true,
		searchRoot,
		workspaceRoots,
		storagePaths,
		sources,
		stores,
		projectedReclaimBytes: stores.reduce((total, store) => total + store.projectedReclaimBytes, 0),
		digest,
		...commands,
	};
}
