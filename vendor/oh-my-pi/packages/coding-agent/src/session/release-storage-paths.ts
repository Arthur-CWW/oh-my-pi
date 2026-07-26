import * as os from "node:os";
import * as path from "node:path";

export interface ReleaseStoragePaths {
	readonly rootDir: string;
	readonly registryPath: string;
	readonly releasesDir: string;
	readonly workspaceLocalDir: string;
}

function configuredPath(value: string | undefined, fallback: string, label: string): string {
	const selected = value ?? fallback;
	if (selected.trim().length === 0) throw new Error(`${label} must not be empty`);
	if (!path.isAbsolute(selected)) throw new Error(`${label} must be an absolute path`);
	return path.resolve(selected);
}

/**
 * Resolve the one machine-local release store shared by every source workspace.
 * Source checkouts must never own registry state or immutable release binaries.
 */
export function resolveReleaseStoragePaths(
	env: NodeJS.ProcessEnv = process.env,
): ReleaseStoragePaths {
	const home = configuredPath(env.HOME, os.homedir(), "Home directory");
	const dataHome = configuredPath(
		env.XDG_DATA_HOME,
		path.join(home, ".local", "share"),
		"XDG data home",
	);
	const rootDir = path.join(dataHome, "omp");
	return {
		rootDir,
		registryPath: configuredPath(
			env.OMP_RELEASE_REGISTRY_PATH,
			path.join(rootDir, "release-registry.json"),
			"Release registry path",
		),
		releasesDir: configuredPath(
			env.OMP_RELEASES_DIR,
			path.join(rootDir, "releases"),
			"Immutable releases directory",
		),
		workspaceLocalDir: path.join(rootDir, "workspace-local"),
	};
}
