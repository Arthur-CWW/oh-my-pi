/**
 * The `ps` boundary for the host resource stack, expressed as Effects.
 *
 * Why not `effect/unstable/process`: that module ships the `ChildProcess`
 * command description plus the `ChildProcessSpawner` service *tag*, but the only
 * spawner implementation lives in `@effect/platform-node`, which this package
 * does not depend on. `PsExecutor` / `SyncCommandExecutor` are the narrow local
 * backend with the same shape — describe the invocation, run it through an
 * injectable service, decode the bytes through Schema — limited to the two
 * commands this stack runs. Swapping them for `ChildProcessSpawner` is a
 * drop-in once a platform backend becomes a real dependency: the decode layer
 * and the guards below do not change.
 *
 * Guards are explicit per-invocation options rather than ambient behaviour.
 * `timeoutMs` and `maxOutputBytes` are enforced by the executor (SIGKILL on
 * either breach, so a wedged or runaway `ps` can neither hang the sampler nor
 * pin memory), and `maxProcesses` is enforced by the decoder before any row
 * array is materialised.
 */

import * as path from "node:path";
import { Effect, Schema } from "effect";

const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1_048_576;
const DEFAULT_MAX_PROCESSES = 100_000;
const DEFAULT_TIMEOUT_MS = 2_000;
const EXECUTABLE_FALLBACK_PATH = ["/usr/sbin", "/sbin"].join(path.delimiter);
const MAX_STDERR_BYTES = 64 * 1_024;

/** Full-host snapshot argv. `lstart=` is last because it is the only field containing spaces. */
export const PS_SNAPSHOT_ARGS: readonly string[] = ["-axo", "pid=,ppid=,rss=,lstart="];

export const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
export const NonNegativeSafeIntSchema = Schema.Int.pipe(
	Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	Schema.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
);
export const PositiveSafeIntSchema = Schema.Int.pipe(
	Schema.check(Schema.isGreaterThanOrEqualTo(1)),
	Schema.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
);

export class PsUnavailableError extends Schema.TaggedErrorClass<PsUnavailableError>()("PsUnavailableError", {
	message: Schema.String,
	executable: NonEmptyStringSchema,
}) {}

export const PsExecutionFailureReasonSchema = Schema.Literals([
	"spawn-failed",
	"nonzero-exit",
	"timeout",
	"output-overflow",
	"process-limit",
]);
export type PsExecutionFailureReason = typeof PsExecutionFailureReasonSchema.Type;

export class PsExecutionError extends Schema.TaggedErrorClass<PsExecutionError>()("PsExecutionError", {
	message: Schema.String,
	reason: PsExecutionFailureReasonSchema,
}) {}

export const PsDecodeSourceSchema = Schema.Literals(["snapshot-row", "process-identity"]);
export type PsDecodeSource = typeof PsDecodeSourceSchema.Type;

export class PsDecodeError extends Schema.TaggedErrorClass<PsDecodeError>()("PsDecodeError", {
	message: Schema.String,
	source: PsDecodeSourceSchema,
}) {}

export type PsCommandError = PsUnavailableError | PsExecutionError;
export type PsSnapshotError = PsCommandError | PsDecodeError;

/** One decoded row of the full-host snapshot. `startFingerprint` is the PID-reuse discriminator. */
export const PsSnapshotRowSchema = Schema.Struct({
	pid: PositiveSafeIntSchema,
	ppid: NonNegativeSafeIntSchema,
	rssBytes: NonNegativeSafeIntSchema,
	startFingerprint: NonEmptyStringSchema,
});
export type PsSnapshotRow = typeof PsSnapshotRowSchema.Type;

const PsSnapshotRowsSchema = Schema.Array(PsSnapshotRowSchema);
const decodeSnapshotRows = Schema.decodeUnknownEffect(PsSnapshotRowsSchema);

export interface PsSnapshotOptions {
	readonly timeoutMs?: number;
	readonly maxOutputBytes?: number;
	readonly maxProcesses?: number;
}

export interface PsInvocation {
	readonly args: readonly string[];
	readonly timeoutMs: number;
	readonly maxOutputBytes: number;
}

/** Streaming, bounded `ps` backend. The seam tests replace to avoid spawning. */
export type PsExecutor = (invocation: PsInvocation) => Effect.Effect<string, PsCommandError>;

/** Decoded-row seam: everything downstream of it is pure attribution arithmetic. */
export type PsSnapshotSource = (options: PsSnapshotOptions) => Effect.Effect<readonly PsSnapshotRow[], PsSnapshotError>;

/** Blocking single-shot backend for the per-PID identity probe, which must stay synchronous. */
export type SyncCommandExecutor = (
	executable: string,
	args: readonly string[],
) => Effect.Effect<string, PsCommandError>;

function positiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const executablePaths = new Map<string, string | null>();

function resolveExecutable(name: string): string | null {
	const cached = executablePaths.get(name);
	if (cached !== undefined) return cached;
	const resolved = Bun.which(name) ?? Bun.which(name, { PATH: EXECUTABLE_FALLBACK_PATH }) ?? null;
	executablePaths.set(name, resolved);
	return resolved;
}

async function readBounded(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
	onOverflow: () => void,
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			total += next.value.byteLength;
			if (total > maxBytes) {
				onOverflow();
				throw new PsExecutionError({
					message: `ps output exceeded ${maxBytes} bytes`,
					reason: "output-overflow",
				});
			}
			chunks.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

async function spawnBoundedPs(psPath: string, invocation: PsInvocation): Promise<string> {
	const child = Bun.spawn({ cmd: [psPath, ...invocation.args], stdout: "pipe", stderr: "pipe" });
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, invocation.timeoutMs);
	timer.unref?.();
	const killOnOverflow = () => child.kill("SIGKILL");
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			readBounded(child.stdout, invocation.maxOutputBytes, killOnOverflow),
			readBounded(child.stderr, MAX_STDERR_BYTES, killOnOverflow),
			child.exited,
		]);
		if (timedOut) {
			throw new PsExecutionError({ message: `ps exceeded ${invocation.timeoutMs}ms`, reason: "timeout" });
		}
		if (exitCode !== 0) {
			const diagnostics = new TextDecoder().decode(stderr).trim();
			throw new PsExecutionError({
				message: `ps exited ${exitCode}: ${diagnostics || "no diagnostics"}`,
				reason: "nonzero-exit",
			});
		}
		return new TextDecoder().decode(stdout);
	} finally {
		clearTimeout(timer);
	}
}

export const bunPsExecutor: PsExecutor = Effect.fn("HostResource.ps")(function* (invocation: PsInvocation) {
	const psPath = resolveExecutable("ps");
	if (!psPath) {
		return yield* Effect.fail(new PsUnavailableError({ message: "Unable to find ps executable", executable: "ps" }));
	}
	return yield* Effect.tryPromise({
		try: () => spawnBoundedPs(psPath, invocation),
		catch: error =>
			error instanceof PsExecutionError
				? error
				: new PsExecutionError({ message: String(error), reason: "spawn-failed" }),
	});
});

/**
 * Synchronous backend shared by the per-PID `ps -o lstart=` probe and the darwin
 * boot-id `sysctl` probe. Both feed {@link readProcessIdentity}, whose callers
 * (SQLite admission transactions, IRC peer listings) cannot await.
 */
export const bunSyncCommandExecutor: SyncCommandExecutor = Effect.fn("HostResource.syncCommand")(function* (
	executable: string,
	args: readonly string[],
) {
	const executablePath = resolveExecutable(executable);
	if (!executablePath) {
		return yield* Effect.fail(
			new PsUnavailableError({ message: `Unable to find ${executable} executable`, executable }),
		);
	}
	return yield* Effect.try({
		try: () => {
			const result = Bun.spawnSync({ cmd: [executablePath, ...args], stdout: "pipe", stderr: "ignore" });
			if (result.exitCode !== 0) {
				throw new PsExecutionError({
					message: `${executable} exited ${result.exitCode}`,
					reason: "nonzero-exit",
				});
			}
			return new TextDecoder().decode(result.stdout).trim().replace(/\s+/g, " ");
		},
		catch: error =>
			error instanceof PsExecutionError
				? error
				: new PsExecutionError({ message: String(error), reason: "spawn-failed" }),
	});
});

/** Read a process group id through the same PATH-resolved synchronous `ps` boundary. */
export function readProcessGroupId(
	pid: number,
	executor: SyncCommandExecutor = bunSyncCommandExecutor,
): number | undefined {
	if (process.platform === "win32" || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
	const output = Effect.runSync(Effect.orElseSucceed(executor("ps", ["-o", "pgid=", "-p", String(pid)]), () => ""));
	const parsed = Number.parseInt(output, 10);
	return Number.isSafeInteger(parsed) && parsed > 1 ? parsed : undefined;
}

const PS_SNAPSHOT_ROW_PATTERN = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S.*?)\s*$/;

/**
 * Parses the bounded `ps` bytes into candidate records and decodes them through
 * Schema in one pass. The regex only fixes the column shape; every value
 * invariant (safe positive PID, non-negative RSS, non-empty start fingerprint)
 * is the schema's job, so a malformed table surfaces as {@link PsDecodeError}
 * rather than a silently mis-attributed process tree.
 */
export function makePsSnapshotSource(executor: PsExecutor): PsSnapshotSource {
	return Effect.fn("HostResource.psSnapshot")(function* (options: PsSnapshotOptions) {
		const maxProcesses = positiveInteger(options.maxProcesses, DEFAULT_MAX_PROCESSES);
		const output = yield* executor({
			args: PS_SNAPSHOT_ARGS,
			timeoutMs: positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS),
			maxOutputBytes: positiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES),
		});
		const candidates: unknown[] = [];
		const seen = new Set<number>();
		let lineNumber = 0;
		for (const line of output.split(/\r?\n/)) {
			lineNumber += 1;
			if (!line.trim()) continue;
			const match = PS_SNAPSHOT_ROW_PATTERN.exec(line);
			if (!match) {
				return yield* Effect.fail(
					new PsDecodeError({ message: `Malformed ps row ${lineNumber}`, source: "snapshot-row" }),
				);
			}
			const pid = Number(match[1]);
			if (seen.has(pid)) {
				return yield* Effect.fail(
					new PsDecodeError({
						message: `Duplicate ps pid ${pid} on row ${lineNumber}`,
						source: "snapshot-row",
					}),
				);
			}
			seen.add(pid);
			candidates.push({
				pid,
				ppid: Number(match[2]),
				rssBytes: Number(match[3]) * 1_024,
				startFingerprint: (match[4] ?? "").replace(/\s+/g, " "),
			});
			if (candidates.length > maxProcesses) {
				return yield* Effect.fail(
					new PsExecutionError({
						message: `ps returned more than ${maxProcesses} processes`,
						reason: "process-limit",
					}),
				);
			}
		}
		return yield* decodeSnapshotRows(candidates).pipe(
			Effect.mapError(
				error => new PsDecodeError({ message: `Unable to decode ps snapshot: ${error}`, source: "snapshot-row" }),
			),
		);
	});
}

export const bunPsSnapshotSource: PsSnapshotSource = makePsSnapshotSource(bunPsExecutor);
