import { createHash } from "node:crypto";
import * as fsSync from "node:fs";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { decodeRolloutCheckpoint, type RolloutCheckpoint } from "../session/rollout-checkpoint";
import {
	acquireSessionOwnership,
	ExternalSessionOwner,
	ExternalSessionOwnerUnverifiable,
	type RestartChildManifestEntryV1,
	type SessionOwnershipAcquisitionOptions,
	type SessionOwnershipHandle,
	writeRestartHandoff,
} from "../session/session-ownership";
import { OPTIONAL_VALUE_FLAGS, STRING_VALUE_FLAGS } from "./flag-tables";
let launchArgsForRestart: readonly string[] = [];
let launchPathForRestart: string | undefined;
let resolvedExecPathForRestart: string | undefined;

const SESSION_SELECTOR_FLAGS: Record<string, true> = { "--resume": true, "-r": true, "--session": true };
const DROPPED_STRING_FLAGS: Record<string, true> = { "--fork": true, "--export": true, "--api-key": true };
const DROPPED_BOOLEAN_FLAGS: Record<string, true> = {
	"--continue": true,
	"-c": true,
	"--print": true,
	"-p": true,
	"--help": true,
	"-h": true,
	"--version": true,
	"-v": true,
};
export const RESTART_API_KEY_ENV = "OMP_RESTART_API_KEY";
export const RESTART_OWNER_EPOCH_ENV = "OMP_RESTART_OWNER_EPOCH";
export const RESTART_ROLLOUT_ID_ENV = "OMP_RESTART_ROLLOUT_ID";
export const RESTART_TARGET_DIGEST_ENV = "OMP_RESTART_TARGET_DIGEST";
export const RESTART_CHECKPOINT_ID_ENV = "OMP_RESTART_CHECKPOINT_ID";

function restartApiKey(args: readonly string[]): string | undefined {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--api-key") return args[i + 1];
		if (arg?.startsWith("--api-key=")) return arg.slice("--api-key=".length);
	}
	return undefined;
}

/** Capture the launch argv after profile/bootstrap rewriting, before extension reparsing mutates semantics. */
export function captureRestartLaunchArgs(
	args: readonly string[],
	launchPath = process.argv0,
	resolvedExecPath = process.execPath,
): void {
	launchArgsForRestart = [...args];
	resolvedExecPathForRestart = resolvedExecPath;
	launchPathForRestart = resolveLauncherPath(launchPath, resolvedExecPath);
}

export function getRestartLaunchArgsForTest(): readonly string[] {
	return launchArgsForRestart;
}

function resolveLauncherPath(launchPath: string | undefined, resolvedExecPath: string): string | undefined {
	if (!launchPath || !resolvedExecPath) return undefined;
	const candidate = path.isAbsolute(launchPath)
		? launchPath
		: launchPath.includes(path.sep)
			? path.resolve(launchPath)
			: Bun.which(launchPath);
	if (!candidate) return undefined;

	try {
		const launchMetadata = fsSync.lstatSync(candidate);
		if (!launchMetadata.isSymbolicLink()) {
			const executableMetadata = fsSync.statSync(resolvedExecPath);
			if (launchMetadata.dev === executableMetadata.dev && launchMetadata.ino === executableMetadata.ino) return undefined;
		}
		if (fsSync.realpathSync(candidate) === fsSync.realpathSync(resolvedExecPath)) return candidate;
		return launchMetadata.isFile() && (launchMetadata.mode & 0o111) !== 0 ? candidate : undefined;
	} catch {
		// A launch path that cannot be inspected at startup is not safe to
		// preserve as a launcher. The resolved executable remains the fallback.
	}
	return undefined;
}

/**
 * Rebuild launch args for a fast-restart resume. It preserves option flags that
 * shape runtime configuration, drops the old session selector and one-shot
 * prompt/export/print intent, and appends an explicit resume for the live
 * session id so the replacement process reattaches to the same JSONL file.
 */
export function buildRestartLaunchArgs(originalArgs: readonly string[], sessionId: string): string[] {
	const rebuilt: string[] = [];

	for (let i = 0; i < originalArgs.length; i++) {
		const arg = originalArgs[i];
		if (!arg) continue;

		if (arg.startsWith("--") && arg.includes("=")) {
			const flag = arg.slice(0, arg.indexOf("="));
			if (
				SESSION_SELECTOR_FLAGS[flag] !== true &&
				DROPPED_STRING_FLAGS[flag] !== true &&
				DROPPED_BOOLEAN_FLAGS[flag] !== true
			) {
				rebuilt.push(arg);
			}
			continue;
		}

		if (SESSION_SELECTOR_FLAGS[arg] === true) {
			const next = originalArgs[i + 1];
			if (next !== undefined && next.length > 0 && !next.startsWith("-")) i++;
			continue;
		}

		if (DROPPED_STRING_FLAGS[arg] === true) {
			if (i + 1 < originalArgs.length) i++;
			continue;
		}

		if (DROPPED_BOOLEAN_FLAGS[arg] === true) continue;

		if (STRING_VALUE_FLAGS.has(arg)) {
			rebuilt.push(arg);
			if (i + 1 < originalArgs.length) rebuilt.push(originalArgs[++i]);
			continue;
		}

		if (OPTIONAL_VALUE_FLAGS.has(arg)) {
			// All built-in optional-value flags currently select sessions and were
			// handled above. Keep this branch defensive for future optional flags.
			rebuilt.push(arg);
			const next = originalArgs[i + 1];
			if (next !== undefined && next.length > 0 && !next.startsWith("-")) rebuilt.push(originalArgs[++i]);
			continue;
		}

		if (arg.startsWith("-")) {
			rebuilt.push(arg);
		}
	}

	rebuilt.push("--resume", sessionId);
	return rebuilt;
}

export interface RestartSpawnSpec {
	executable: string;
	args: string[];
	cwd: string;
	env?: Record<string, string | undefined>;
	/** Absolute launcher path captured at startup for launcher-mediated sessions. */
	launchPath?: string;
}

export interface RestartExecutableResolution {
	readonly executable: string;
	readonly usedLauncher: boolean;
	readonly fallback: boolean;
	readonly notice?: string;
}

function launcherIsExecutable(launcherPath: string): boolean {
	try {
		const metadata = fsSync.statSync(launcherPath);
		return metadata.isFile() && (metadata.mode & 0o111) !== 0;
	} catch {
		return false;
	}
}

/** Resolve a captured launcher only at the final reexec boundary. */
export function resolveRestartExecutable(spec: RestartSpawnSpec): RestartExecutableResolution {
	if (!spec.launchPath) {
		return { executable: spec.executable, usedLauncher: false, fallback: false };
	}
	if (launcherIsExecutable(spec.launchPath)) {
		return {
			executable: spec.launchPath,
			usedLauncher: true,
			fallback: false,
			notice: `restart executable re-resolved: ${spec.executable} → ${spec.launchPath}`,
		};
	}
	return {
		executable: spec.executable,
		usedLauncher: false,
		fallback: true,
		notice: `restart launcher unavailable: ${spec.launchPath}; using ${spec.executable}`,
	};
}

const SHA256_DIGEST = /^[0-9a-f]{64}$/;

export async function verifyExecutableDigest(executable: string, targetDigest: string): Promise<void> {
	if (!SHA256_DIGEST.test(targetDigest)) throw new Error("Rollout target digest must be a lowercase SHA-256 digest");
	const metadata = await fs.lstat(executable);
	if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o111) === 0) {
		throw new Error(`Rollout release is not an executable regular file: ${targetDigest}`);
	}
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(executable)) hash.update(chunk);
	const actualDigest = hash.digest("hex");
	if (actualDigest !== targetDigest) {
		throw new Error(`Rollout release digest mismatch: expected ${targetDigest}, found ${actualDigest}`);
	}
}

export async function resolveVerifiedReleaseExecutable(releaseStoreDir: string, targetDigest: string): Promise<string> {
	const executable = path.join(releaseStoreDir, `omp-${targetDigest}`);
	await verifyExecutableDigest(executable, targetDigest);
	return executable;
}

export interface RolloutRestartSpawnOptions {
	readonly checkpoint: RolloutCheckpoint | unknown;
	readonly rolloutId: string;
	readonly targetDigest: string;
	readonly releaseStoreDir: string;
	readonly sessionId: string;
	readonly sessionFile: string;
	readonly ownerEpoch: string;
	readonly cwd: string;
	readonly processArgv?: readonly string[];
	readonly launchArgs?: readonly string[];
}

/** Build an exact-artifact restart only from the current runner's durable checkpoint receipt. */
export async function buildRolloutRestartSpawnSpec(options: RolloutRestartSpawnOptions): Promise<RestartSpawnSpec> {
	const checkpoint = decodeRolloutCheckpoint(options.checkpoint);
	if (
		checkpoint.outcome !== "Checkpointed" ||
		checkpoint.rolloutId !== options.rolloutId ||
		checkpoint.ownerEpoch !== options.ownerEpoch ||
		checkpoint.journalCheckpoint.sessionId !== options.sessionId ||
		path.resolve(checkpoint.journalCheckpoint.sessionFile) !== path.resolve(options.sessionFile)
	) {
		throw new Error("Rollout restart requires a matching successful checkpoint receipt");
	}
	const executable = await resolveVerifiedReleaseExecutable(options.releaseStoreDir, options.targetDigest);
	const spec = buildRestartSpawnSpec({
		sessionId: options.sessionId,
		cwd: options.cwd,
		executable,
		processArgv: options.processArgv,
		launchArgs: options.launchArgs,
	});
	return {
		...spec,
		env: {
			...(spec.env ?? Bun.env),
			[RESTART_ROLLOUT_ID_ENV]: options.rolloutId,
			[RESTART_TARGET_DIGEST_ENV]: options.targetDigest,
			[RESTART_CHECKPOINT_ID_ENV]: checkpoint.checkpointId,
		},
	};
}

function isBunVirtualEntry(arg: string): boolean {
	return arg.startsWith("/$bunfs/");
}

function processArgPrefix(processArgv: readonly string[], launchArgs: readonly string[]): string[] {
	if (processArgv.length <= 1) return [];

	if (launchArgs.length > 0) {
		const tailStart = processArgv.length - launchArgs.length;
		if (tailStart >= 1 && launchArgs.every((arg, index) => processArgv[tailStart + index] === arg)) {
			return processArgv.slice(1, tailStart).filter(arg => !isBunVirtualEntry(arg));
		}
	}

	const maybeScript = processArgv[1];
	return maybeScript && !maybeScript.startsWith("-") && !isBunVirtualEntry(maybeScript) ? [maybeScript] : [];
}

export function buildRestartSpawnSpec(options: {
	sessionId: string;
	cwd: string;
	executable?: string;
	processArgv?: readonly string[];
	launchArgs?: readonly string[];
}): RestartSpawnSpec {
	const processArgv = options.processArgv ?? process.argv;
	const launchArgs = options.launchArgs ?? launchArgsForRestart;
	const apiKey = restartApiKey(launchArgs);
	const executable = options.executable ?? resolvedExecPathForRestart ?? process.execPath;
	return {
		executable,
		args: [...processArgPrefix(processArgv, launchArgs), ...buildRestartLaunchArgs(launchArgs, options.sessionId)],
		cwd: options.cwd,
		...(options.executable === undefined && launchPathForRestart !== undefined
			? { launchPath: launchPathForRestart }
			: {}),
		...(apiKey === undefined ? {} : { env: { ...Bun.env, [RESTART_API_KEY_ENV]: apiKey } }),
	};
}

const RESTART_CLAIM_DELAYS_MS = [0, 10, 25, 50, 100, 200] as const;

/**
 * A replacement may observe the predecessor between its releasing write and
 * atomic claim-directory retirement. Only restart children carrying that exact
 * predecessor epoch retry; ordinary concurrent resumes still fail immediately.
 */
export async function acquireRestartSessionOwnership(
	sessionFile: string,
	sessionId: string,
	options: SessionOwnershipAcquisitionOptions,
	predecessorEpoch = process.env[RESTART_OWNER_EPOCH_ENV],
): Promise<SessionOwnershipHandle> {
	for (const delayMs of RESTART_CLAIM_DELAYS_MS) {
		if (delayMs > 0) await Bun.sleep(delayMs);
		try {
			return await acquireSessionOwnership(sessionFile, sessionId, options);
		} catch (error) {
			if (!predecessorEpoch) throw error;
			if (error instanceof ExternalSessionOwner && error.lease.ownerEpoch !== predecessorEpoch) throw error;
			if (!(error instanceof ExternalSessionOwner || error instanceof ExternalSessionOwnerUnverifiable)) throw error;
		}
	}
	return acquireSessionOwnership(sessionFile, sessionId, options);
}

/**
 * Retire this process's direct session lease, then atomically replace its
 * process image. Keeping the same PID preserves the PTY foreground process
 * group and tmux pane ownership while execve guarantees the replacement image
 * was installed before any old-process exit can occur.
 */
export function replaceRestartProcess(spec: RestartSpawnSpec, predecessorOwnerEpoch?: string): void {
	const env = predecessorOwnerEpoch
		? { ...(spec.env ?? Bun.env), [RESTART_OWNER_EPOCH_ENV]: predecessorOwnerEpoch }
		: (spec.env ?? Bun.env);
	if (!process.execve) throw new Error("restart requires process.execve support");
	const resolution = resolveRestartExecutable(spec);
	if (resolution.notice) {
		if (resolution.fallback) {
			logger.warn("restart launcher unavailable; falling back to current executable", {
				launcherPath: spec.launchPath,
				executable: spec.executable,
				notice: resolution.notice,
			});
		} else {
			logger.info("restart executable path re-resolved through launcher", {
				launcherPath: spec.launchPath,
				previousExecutable: spec.executable,
				executable: resolution.executable,
				notice: resolution.notice,
			});
		}
	}
	process.chdir(spec.cwd);
	process.execve(resolution.executable, [resolution.executable, ...spec.args], env);
}

export async function handoffRestartProcess(
	spec: RestartSpawnSpec,
	ownership: SessionOwnershipHandle | undefined,
	teardown?: () => Promise<void | readonly RestartChildManifestEntryV1[]>,
	childManifest: readonly RestartChildManifestEntryV1[] = [],
): Promise<void> {
	const capturedManifest = await teardown?.();
	if (ownership) await writeRestartHandoff(ownership, capturedManifest ?? childManifest);
	await ownership?.release();
	replaceRestartProcess(spec, ownership?.ownerEpoch);
}
