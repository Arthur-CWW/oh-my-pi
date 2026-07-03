import { OPTIONAL_VALUE_FLAGS, STRING_VALUE_FLAGS } from "./flag-tables";

let launchArgsForRestart: readonly string[] = [];

const SESSION_SELECTOR_FLAGS: Record<string, true> = { "--resume": true, "-r": true, "--session": true };
const DROPPED_STRING_FLAGS: Record<string, true> = { "--fork": true, "--export": true };
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

/** Capture the launch argv after profile/bootstrap rewriting, before extension reparsing mutates semantics. */
export function captureRestartLaunchArgs(args: readonly string[]): void {
	launchArgsForRestart = [...args];
}

export function getRestartLaunchArgsForTest(): readonly string[] {
	return launchArgsForRestart;
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
}

function processArgPrefix(processArgv: readonly string[], launchArgs: readonly string[]): string[] {
	if (processArgv.length <= 1) return [];

	if (launchArgs.length > 0) {
		const tailStart = processArgv.length - launchArgs.length;
		if (tailStart >= 1 && launchArgs.every((arg, index) => processArgv[tailStart + index] === arg)) {
			return processArgv.slice(1, tailStart);
		}
	}

	const maybeScript = processArgv[1];
	return maybeScript && !maybeScript.startsWith("-") ? [maybeScript] : [];
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
	return {
		executable: options.executable ?? process.execPath,
		args: [...processArgPrefix(processArgv, launchArgs), ...buildRestartLaunchArgs(launchArgs, options.sessionId)],
		cwd: options.cwd,
	};
}

export function spawnRestartProcess(spec: RestartSpawnSpec): void {
	const child = Bun.spawn([spec.executable, ...spec.args], {
		cwd: spec.cwd,
		detached: true,
		env: Bun.env,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	child.unref();
}
