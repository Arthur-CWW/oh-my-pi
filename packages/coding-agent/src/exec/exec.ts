/**
 * Shared command execution utilities for hooks and custom tools.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { ptree } from "@oh-my-pi/pi-utils";

/** Hard cap applied independently to captured stdout and stderr. */
export const MAX_EXEC_OUTPUT_BYTES = 256 * 1024;

export interface ExecHandlerContext {
	signal: AbortSignal;
	onOutputTruncated?: (stream: "stdout" | "stderr", limitBytes: number) => void;
}

const execHandlerContext = new AsyncLocalStorage<ExecHandlerContext>();

/** Bind extension-owned subprocesses to the currently executing handler. */
export function runWithExecHandlerContext<T>(context: ExecHandlerContext, callback: () => T): T {
	return execHandlerContext.run(context, callback);
}

/**
 * Options for executing shell commands.
 */
export interface ExecOptions {
	/** AbortSignal to cancel the command */
	signal?: AbortSignal;
	/** Timeout in milliseconds */
	timeout?: number;
	/** Working directory */
	cwd?: string;
	/** Optional lower output cap. Values above the hard cap are clamped. */
	maxOutputBytes?: number;
}

/**
 * Result of executing a shell command.
 */
export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
	stdoutTruncated?: boolean;
	stderrTruncated?: boolean;
}

/**
 * Execute a shell command and return stdout/stderr/code.
 * Supports timeout and abort signal.
 */
export async function execCommand(
	command: string,
	args: string[],
	cwd: string,
	options?: ExecOptions,
): Promise<ExecResult> {
	const handlerContext = execHandlerContext.getStore();
	const explicitSignal = options?.signal;
	const signal =
		handlerContext?.signal && explicitSignal && handlerContext.signal !== explicitSignal
			? AbortSignal.any([handlerContext.signal, explicitSignal])
			: (explicitSignal ?? handlerContext?.signal);
	const requestedLimit = options?.maxOutputBytes ?? MAX_EXEC_OUTPUT_BYTES;
	const maxOutputBytes = Number.isNaN(requestedLimit)
		? MAX_EXEC_OUTPUT_BYTES
		: Math.min(MAX_EXEC_OUTPUT_BYTES, Math.max(0, Math.floor(requestedLimit)));

	// A JavaScript handler shares the host process and cannot be given an honest
	// hard RSS ceiling. Hard RSS enforcement belongs at the subprocess boundary;
	// this seam enforces cancellation and bounded pipe capture there.
	const result = await ptree.exec([command, ...args], {
		cwd,
		signal,
		timeout: options?.timeout,
		maxOutputBytes,
		allowNonZero: true,
		allowAbort: true,
		stderr: "full",
	});

	if (result.stdoutTruncated) handlerContext?.onOutputTruncated?.("stdout", maxOutputBytes);
	if (result.stderrTruncated) handlerContext?.onOutputTruncated?.("stderr", maxOutputBytes);

	return {
		stdout: result.stdout,
		stderr: result.stderr,
		code: result.exitCode ?? 0,
		killed: Boolean(result.exitError?.aborted),
		stdoutTruncated: result.stdoutTruncated,
		stderrTruncated: result.stderrTruncated,
	};
}
