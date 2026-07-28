import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	type CappedStreamResult,
	DIAGNOSTIC_STREAM_CAP_BYTES,
	isCompiledBinary,
	isEnoent,
	popLoopPhase,
	pushLoopPhase,
	readCapped,
	withCappedStreamNotice,
	workerHostEntry,
} from "@oh-my-pi/pi-utils";
import type { Settings } from "../config/settings";
import { AgentRegistry } from "../registry/agent-registry";
import { matchesProcessIdentity, type ProcessIdentity } from "../resource/process-identity";
import type { FileEntry } from "../session/session-entries";
import type { EventBus } from "../utils/event-bus";
import {
	appendInterruptedChildLifecycleFile,
	type ChildLifecycleState,
	isTerminalChildLifecycleState,
	latestChildLifecycleRecord,
} from "./child-lifecycle";
import { type ExecutorOptions, finalizeSubprocessOutput, snapshotExecutorSettings } from "./executor";
import {
	DEFAULT_MEMORY_HARD_WATERMARK_BYTES,
	DEFAULT_MEMORY_SOFT_WATERMARK_BYTES,
	deliverMemoryPressureNotice,
	type MemoryWatermarks,
	memoryHardWatermarkMessage,
	memorySoftWatermarkNotice,
	memoryWatermarkSampleInvalidMessage,
	resolveMemoryWatermarks,
} from "./memory-watermarks";
import {
	decodeSpawnWorkerRecord,
	type SerializableExecutorOptions,
	SPAWN_WORKER_ARG,
	SPAWN_WORKER_JOURNAL_START_MARKER,
	SPAWN_WORKER_MAX_RECORD_BYTES,
	SPAWN_WORKER_REQUEST_VERSION,
	type SpawnWorkerErrorCode,
	type SpawnWorkerRecord,
	type SpawnWorkerRegistryRef,
	type SpawnWorkerRequest,
	type SpawnWorkerRunRequest,
	type SpawnWorkerSyntheticRequest,
} from "./spawn-worker-protocol";
import { isTransientHostResourceFailure } from "./subagent-failure";
import type { AgentProgress, SingleResult } from "./types";

const RSS_SAMPLE_INTERVAL_MS = 250;
const RSS_SAMPLE_BYTES_PER_PID = 64;
const SETUP_TIMEOUT_GRACE_MS = 60_000;
const WORKER_REAP_TIMEOUT_MS = 1_500;
const DEFAULT_MEMORY_INTERRUPT_GRACE_MS = 20_000;
const DEFAULT_STALL_THRESHOLD_MS = 5 * 60_000;
const SPAWN_CONTENTION_RETRY_DELAYS_MS = [50, 200] as const;
let spawnLaunchTail: Promise<void> = Promise.resolve();

async function launchSpawnProcess(
	requestId: string,
	command: SpawnCommand,
	signal?: AbortSignal,
): Promise<Bun.Subprocess<"pipe", "pipe", "pipe">> {
	const previous = spawnLaunchTail;
	const { promise: turnComplete, resolve: releaseTurn } = Promise.withResolvers<void>();
	spawnLaunchTail = turnComplete;
	await previous;
	await Bun.sleep(10);
	try {
		for (let attempt = 0; ; attempt++) {
			if (signal?.aborted) throw new SpawnWorkerError("aborted", "Subagent subprocess aborted before spawn");
			pushLoopPhase(`subagent:${requestId}:process-spawn`);
			try {
				return Bun.spawn({
					cmd: command.cmd,
					cwd: command.cwd,
					env: Bun.env,
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
					detached: true,
					windowsHide: true,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const delayMs = SPAWN_CONTENTION_RETRY_DELAYS_MS[attempt];
				if (delayMs === undefined || !isTransientHostResourceFailure(message)) throw error;
				await Bun.sleep(delayMs);
			} finally {
				popLoopPhase();
			}
		}
	} finally {
		releaseTurn();
	}
}

export class SpawnWorkerError extends Error {
	constructor(
		readonly code: SpawnWorkerErrorCode,
		message: string,
	) {
		super(message);
		this.name = "SpawnWorkerError";
	}
}

export class JournalRecoveryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JournalRecoveryError";
	}
}

export interface SpawnWorkerClientOptions {
	signal?: AbortSignal;
	/** Graduated memory backpressure. Defaults to the shipped watermarks. */
	memoryWatermarks?: MemoryWatermarks;
	/** Sink for the soft-watermark notice; defaults to the child's external IRC peer. */
	onMemoryPressureNotice?: (agentId: string, notice: string) => void;
	timeoutMs?: number;
	/** Bounded grace after a memory interrupt before the process group is killed. */
	memoryInterruptGraceMs?: number;
	/** Delay before a no-token/no-journal-activity worker is probed for liveness. */
	stallThresholdMs?: number;
	onProgress?: ExecutorOptions["onProgress"];
	eventBus?: EventBus;
	onPhase?: (phase: Extract<SpawnWorkerRecord, { type: "phase" }>["phase"]) => void;
	onProcessStart?: (pid: number) => void | Promise<void>;
}

export interface SyntheticSpawnWorkload {
	spinMs: number;
	allocateBytes: number;
	hangMs?: number;
	lingerAfterResultMs?: number;
}

export interface SyntheticSpawnResult {
	allocatedBytes: number;
	rssBytes: number;
}

interface SpawnCommand {
	cmd: string[];
	cwd?: string;
}

function spawnCommand(): SpawnCommand {
	if (isCompiledBinary()) return { cmd: [process.execPath, SPAWN_WORKER_ARG] };
	const hostEntry = workerHostEntry();
	if (hostEntry) {
		return { cmd: [process.execPath, path.basename(hostEntry), SPAWN_WORKER_ARG], cwd: path.dirname(hostEntry) };
	}
	const packageRoot = path.resolve(import.meta.dir, "..", "..");
	return { cmd: [process.execPath, "src/cli.ts", SPAWN_WORKER_ARG], cwd: packageRoot };
}

const SERIALIZABLE_OPTION_KEYS = [
	"worktree",
	"assignment",
	"context",
	"planReference",
	"description",
	"role",
	"parentToolCallId",
	"detached",
	"modelOverride",
	"routeReceipt",
	"buildVersion",
	"buildDigest",
	"parentActiveModelPattern",
	"thinkingLevel",
	"outputSchema",
	"taskDepth",
	"maxRuntimeMs",
	"quotaAdmission",
	"enableLsp",
	"sessionFile",
	"parentWorkstream",
	"parentSessionFile",
	"parentSessionId",
	"parentAgentId",
	"persistArtifacts",
	"artifactsDir",
	"contextFiles",
	"skills",
	"promptTemplates",
	"workspaceTree",
	"rules",
	"preloadedExtensionPaths",
	"preloadedCustomToolPaths",
	"parentEvalSessionId",
	"autoloadSkills",
] as const satisfies readonly (keyof SerializableExecutorOptions)[];

function serializeOptions(options: ExecutorOptions): SerializableExecutorOptions {
	const result: SerializableExecutorOptions = {
		cwd: options.cwd,
		agent: options.agent,
		task: options.task,
		index: options.index,
		id: options.id,
	};
	const writable = result as Record<string, unknown>;
	for (const key of SERIALIZABLE_OPTION_KEYS) {
		const value = options[key];
		if (value !== undefined) writable[key] = value;
	}
	return result;
}

function registrySnapshot(): SpawnWorkerRegistryRef[] {
	const registry = AgentRegistry.global();
	return registry.list().map(ref => {
		const launchGeneration = registry.getLaunchGeneration(ref);
		return {
			id: ref.id,
			displayName: ref.displayName,
			kind: ref.kind,
			status: ref.status,
			...(ref.parentId ? { parentId: ref.parentId } : {}),
			sessionFile: ref.sessionFile,
			...(launchGeneration ? { launchGeneration } : {}),
		};
	});
}

function projectRegistry(ref: SpawnWorkerRegistryRef): void {
	if (!ref.launchGeneration) return;
	const registry = AgentRegistry.global();
	const existing = registry.get(ref.id);
	if (existing) {
		if (registry.getLaunchGeneration(existing) !== ref.launchGeneration || existing.session !== null) return;
		if (existing.sessionFile === (ref.sessionFile ?? null)) {
			registry.setStatus(ref.id, ref.status);
			return;
		}
	}
	registry.register({ ...ref, session: null, launchGeneration: ref.launchGeneration });
}

const activeWorkerReapers = new Set<Promise<void>>();

function signalWorkerProcessGroup(proc: Bun.Subprocess, signal: "SIGKILL"): void {
	try {
		process.kill(-proc.pid, signal);
	} catch {
		// The worker may have exited between the live-owner check and the signal.
	}
}
export function signalWorkerMemoryInterrupt(proc: Bun.Subprocess, expectedPid: number): boolean {
	if (proc.pid !== expectedPid || proc.exitCode !== null || proc.signalCode !== null) return false;
	try {
		proc.kill("SIGUSR2");
		return true;
	} catch {
		return false;
	}
}

async function waitForWorkerExit(proc: Bun.Subprocess, timeoutMs: number): Promise<void> {
	const { promise: timedOut, resolve } = Promise.withResolvers<void>();
	const timer = setTimeout(resolve, timeoutMs);
	try {
		await Promise.race([
			proc.exited.then(
				() => undefined,
				() => undefined,
			),
			timedOut,
		]);
	} finally {
		clearTimeout(timer);
	}
}

function createProcessGroupTeardown(proc: Bun.Subprocess): (signalOwnedGroup: boolean) => void {
	let processExited = false;
	let teardown: Promise<void> | undefined;
	void proc.exited.then(
		() => {
			processExited = true;
		},
		() => {
			processExited = true;
		},
	);
	return (signalOwnedGroup: boolean): void => {
		// A graceful reap may already be waiting when the bounded memory grace
		// expires. Escalation must still be able to kill the owned group.
		if (signalOwnedGroup && !processExited && proc.exitCode === null) signalWorkerProcessGroup(proc, "SIGKILL");
		if (teardown) return;
		const work = waitForWorkerExit(proc, WORKER_REAP_TIMEOUT_MS);
		teardown = work;
		activeWorkerReapers.add(work);
		void work.finally(() => activeWorkerReapers.delete(work));
	};
}

export interface WorkerRssWatch {
	/** Warn-only watermark. 0 disables the warning stage. */
	softBytes: number;
	/** Resumable-interrupt watermark. 0 disables the interrupt. */
	hardBytes: number;
	onSoftWatermark(rssBytes: number): void;
	onHardWatermark(rssBytes: number): void;
	onSampleInvalid(reason: string): void;
}

const rssWatches = new Map<number, WorkerRssWatch>();
let rssTimer: Timer | undefined;
let rssSampling = false;

function invalidateWorkerRssSample(watches: ReadonlyMap<number, WorkerRssWatch>, reason: string): void {
	// A watch with no hard watermark has nothing to enforce conservatively.
	for (const watch of watches.values()) if (watch.hardBytes > 0) watch.onSampleInvalid(reason);
}

/**
 * Apply a complete RSS sample, or conservatively invalidate every watched worker
 * on overflow. The hard watermark wins a sample that crosses both, so a soft
 * watermark configured at or above the hard one simply has no warning stage.
 */
export function enforceWorkerRssSample(
	sample: Pick<CappedStreamResult, "keptBytes" | "text" | "totalBytes" | "truncated">,
	watches: ReadonlyMap<number, WorkerRssWatch>,
): void {
	if (sample.truncated) {
		invalidateWorkerRssSample(
			watches,
			`ps output overflowed: kept ${sample.keptBytes} of ${sample.totalBytes} bytes`,
		);
		return;
	}
	const seen = new Set<number>();
	for (const rawLine of sample.text.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0) continue;
		const fields = line.split(/\s+/);
		if (fields.length !== 2 || !/^\d+$/.test(fields[0]!) || !/^\d+$/.test(fields[1]!)) {
			invalidateWorkerRssSample(watches, `ps emitted malformed row: ${JSON.stringify(line)}`);
			return;
		}
		const pid = Number(fields[0]);
		const rssKiB = Number(fields[1]);
		if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(rssKiB) || rssKiB < 0) {
			invalidateWorkerRssSample(watches, `ps emitted invalid numeric row: ${JSON.stringify(line)}`);
			return;
		}
		const watch = watches.get(pid);
		if (!watch) continue;
		seen.add(pid);
		const rssBytes = rssKiB * 1024;
		if (!Number.isSafeInteger(rssBytes)) {
			invalidateWorkerRssSample(watches, `ps emitted overflowing RSS for pid ${pid}`);
			return;
		}
		if (watch.hardBytes > 0 && rssBytes >= watch.hardBytes) watch.onHardWatermark(rssBytes);
		else if (watch.softBytes > 0 && rssBytes >= watch.softBytes) watch.onSoftWatermark(rssBytes);
	}
	for (const [pid, watch] of watches) {
		if (!seen.has(pid) && watch.hardBytes > 0) watch.onSampleInvalid(`ps omitted watched pid ${pid}`);
	}
}

async function sampleWorkerRss(): Promise<void> {
	if (rssSampling || rssWatches.size === 0) return;
	rssSampling = true;
	const watches = new Map(rssWatches);
	const retainActiveWatches = (): void => {
		for (const [pid, watch] of watches) {
			if (rssWatches.get(pid) !== watch) watches.delete(pid);
		}
	};
	try {
		const pids = [...watches.keys()];
		const sample = Bun.spawn({
			cmd: ["ps", "-o", "pid=,rss=", "-p", pids.join(",")],
			stdout: "pipe",
			stderr: "ignore",
		});
		const maxOutputBytes = Math.max(DIAGNOSTIC_STREAM_CAP_BYTES, pids.length * RSS_SAMPLE_BYTES_PER_PID);
		const [stdoutRead, exitCode] = await Promise.all([readCapped(sample.stdout, maxOutputBytes), sample.exited]);
		retainActiveWatches();
		if (exitCode !== 0) {
			invalidateWorkerRssSample(watches, `ps exited with code ${exitCode}`);
			return;
		}
		enforceWorkerRssSample(stdoutRead, watches);
	} catch (error) {
		retainActiveWatches();
		invalidateWorkerRssSample(
			watches,
			`ps sampling failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		rssSampling = false;
	}
}

function watchWorkerRss(pid: number, watch: WorkerRssWatch): () => void {
	rssWatches.set(pid, watch);
	if (rssTimer === undefined) {
		rssTimer = setInterval(() => void sampleWorkerRss(), RSS_SAMPLE_INTERVAL_MS);
		rssTimer.unref?.();
	}
	return () => {
		rssWatches.delete(pid);
		if (rssWatches.size === 0) {
			clearInterval(rssTimer);
			rssTimer = undefined;
		}
	};
}

type RecoveredYield = {
	data?: unknown;
	status?: "success" | "aborted";
	error?: string;
	schemaOverridden?: boolean;
};

interface JournalFileIdentity {
	readonly device: number;
	readonly inode: number;
}

interface JournalCursor {
	readonly offset: number;
	readonly identity?: JournalFileIdentity;
}

interface JournalStartEntry {
	readonly data: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function captureJournalCursor(sessionFile: string | null | undefined): Promise<JournalCursor> {
	if (!sessionFile) return { offset: 0 };
	try {
		const handle = await fs.open(sessionFile, "r");
		try {
			const stat = await handle.stat();
			return { offset: stat.size, identity: { device: stat.dev, inode: stat.ino } };
		} finally {
			await handle.close();
		}
	} catch (error) {
		if (isEnoent(error)) return { offset: 0 };
		throw new JournalRecoveryError(error instanceof Error ? error.message : String(error));
	}
}

function isJournalStart(entry: unknown): entry is JournalStartEntry {
	return (
		isRecord(entry) &&
		entry.type === "custom" &&
		entry.customType === SPAWN_WORKER_JOURNAL_START_MARKER &&
		isRecord(entry.data)
	);
}

function matchesJournalStart(entry: unknown, request: Extract<SpawnWorkerRunRequest, { version: 2 }>): boolean {
	return (
		isJournalStart(entry) &&
		entry.data.requestId === request.requestId &&
		entry.data.launchGeneration === request.launchGeneration &&
		entry.data.nonce === request.journalStartNonce
	);
}

function parseCurrentTurnYield(
	text: string,
	request: Extract<SpawnWorkerRunRequest, { version: 2 }>,
): RecoveredYield | undefined {
	let afterCurrentTurnStart = false;
	const lines = text.split("\n");
	if (!text.endsWith("\n")) lines.pop();
	for (const line of lines) {
		if (line.trim().length === 0) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch (error) {
			if (!afterCurrentTurnStart) continue;
			throw new JournalRecoveryError(error instanceof Error ? error.message : String(error));
		}
		if (isJournalStart(entry)) {
			if (matchesJournalStart(entry, request)) {
				afterCurrentTurnStart = true;
				continue;
			}
			if (afterCurrentTurnStart) return undefined;
			continue;
		}
		if (
			!afterCurrentTurnStart ||
			!isRecord(entry) ||
			entry.type !== "message" ||
			!isRecord(entry.message) ||
			entry.message.role !== "toolResult" ||
			entry.message.toolName !== "yield"
		) {
			continue;
		}
		const details = entry.message.details;
		if (!isRecord(details) || (details.status !== "success" && details.status !== "aborted")) continue;
		return {
			data: details.data,
			status: details.status,
			error: typeof details.error === "string" ? details.error : undefined,
			schemaOverridden: details.schemaOverridden === true ? true : undefined,
		};
	}
	return undefined;
}

/**
 * Recover a terminal yield only after this launch's durable turn marker. An
 * unchanged journal identity keeps the byte-offset fast path; a child-owned
 * rewrite or shrink rescans the durable marker instead of trusting old bytes.
 */
async function recoverCurrentTurnResultFromJournal(
	request: SpawnWorkerRunRequest,
	cursor: JournalCursor,
): Promise<SingleResult | undefined> {
	if (request.version !== 2) return undefined;
	const sessionFile = request.options.sessionFile;
	if (!sessionFile) return undefined;
	let text: string;
	try {
		const handle = await fs.open(sessionFile, "r");
		try {
			const stat = await handle.stat();
			const identityUnchanged =
				cursor.identity !== undefined &&
				stat.dev === cursor.identity.device &&
				stat.ino === cursor.identity.inode &&
				stat.size >= cursor.offset;
			const start = identityUnchanged ? cursor.offset : 0;
			if (stat.size === start) return undefined;
			text = await Bun.file(handle.fd).slice(start, stat.size).text();
		} finally {
			await handle.close();
		}
	} catch (error) {
		if (isEnoent(error) && cursor.identity === undefined) return undefined;
		throw new JournalRecoveryError(error instanceof Error ? error.message : String(error));
	}

	const recoveredYield = parseCurrentTurnYield(text, request);
	if (!recoveredYield) return undefined;
	const yields = [recoveredYield];
	const finalized = finalizeSubprocessOutput({
		rawOutput: "",
		exitCode: recoveredYield.status === "success" ? 0 : 1,
		stderr: "",
		doneAborted: false,
		signalAborted: false,
		completed: true,
		yieldItems: yields,
		outputSchema: request.options.outputSchema,
	});
	const output = finalized.rawOutput;
	return {
		index: request.options.index,
		id: request.options.id,
		agent: request.options.agent.name,
		agentSource: request.options.agent.source,
		task: request.options.task,
		assignment: request.options.assignment,
		description: request.options.description,
		exitCode: finalized.exitCode,
		output,
		stderr: finalized.stderr,
		truncated: false,
		durationMs: 0,
		tokens: 0,
		requests: 0,
		modelOverride: request.options.modelOverride,
		routeReceipt: request.options.routeReceipt,
		error: finalized.exitCode !== 0 && finalized.stderr ? finalized.stderr : undefined,
		aborted: recoveredYield.status === "aborted",
		abortReason: recoveredYield.status === "aborted" ? recoveredYield.error : undefined,
		outputPath: request.options.artifactsDir
			? path.join(request.options.artifactsDir, `${request.options.id}.md`)
			: undefined,
		extractedToolData: { yield: yields },
		outputMeta: { lineCount: output.split("\n").length, charCount: output.length },
	};
}

export async function recoverSpawnWorkerResultFromJournal(
	request: SpawnWorkerRunRequest,
): Promise<SingleResult | undefined> {
	try {
		return await recoverCurrentTurnResultFromJournal(request, { offset: 0 });
	} catch {
		return undefined;
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return isRecord(error) && error.code === "EPERM";
	}
}

export interface DetachedSpawnWorkerMonitorOptions {
	sessionFile: string;
	processIdentity: ProcessIdentity;
	signal?: AbortSignal;
	pollIntervalMs?: number;
}

export interface DetachedSpawnWorkerOutcome {
	state: ChildLifecycleState;
}

async function latestDetachedWorkerLifecycle(sessionFile: string): Promise<ChildLifecycleState | undefined> {
	try {
		const entries: FileEntry[] = [];
		for (const line of (await fs.readFile(sessionFile, "utf8")).split("\n")) {
			if (!line.trim()) continue;
			const entry: FileEntry = JSON.parse(line);
			entries.push(entry);
		}
		const lifecycle = latestChildLifecycleRecord(entries);
		return lifecycle && lifecycle !== null ? lifecycle.state : undefined;
	} catch {
		return undefined;
	}
}

async function waitForDetachedWorkerPoll(signal: AbortSignal | undefined, delayMs: number): Promise<void> {
	if (signal?.aborted) return;
	const { promise: aborted, resolve } = Promise.withResolvers<void>();
	const onAbort = (): void => resolve();
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		await Promise.race([Bun.sleep(delayMs), aborted]);
	} finally {
		signal?.removeEventListener("abort", onAbort);
	}
}

/**
 * Reattach supervision to a worker whose protocol pipe belonged to a previous
 * parent. The child journal is authoritative for completion; a running claim
 * is retained only while the exact PID+start fingerprint still matches.
 */
export async function monitorDetachedSpawnWorker(
	options: DetachedSpawnWorkerMonitorOptions,
): Promise<DetachedSpawnWorkerOutcome> {
	const pollIntervalMs = Math.max(25, Math.trunc(options.pollIntervalMs ?? 1_000));
	while (true) {
		const state = await latestDetachedWorkerLifecycle(options.sessionFile);
		if (state && isTerminalChildLifecycleState(state)) return { state };
		if (options.signal?.aborted) {
			if (matchesProcessIdentity(options.processIdentity)) {
				try {
					process.kill(-options.processIdentity.pid, "SIGKILL");
				} catch {
					// The detached group may exit after the identity check.
				}
			}
			throw new SpawnWorkerError("aborted", "Re-adopted subagent subprocess aborted");
		}
		if (!matchesProcessIdentity(options.processIdentity)) {
			const finalState = await latestDetachedWorkerLifecycle(options.sessionFile);
			if (finalState && isTerminalChildLifecycleState(finalState)) return { state: finalState };
			throw new SpawnWorkerError(
				"exit",
				`Detached subagent subprocess pid ${options.processIdentity.pid} died without terminal journal evidence`,
			);
		}
		await waitForDetachedWorkerPoll(options.signal, pollIntervalMs);
	}
}

function initialWorkerProgress(request: SpawnWorkerRunRequest): AgentProgress {
	return {
		index: request.options.index,
		id: request.options.id,
		agent: request.options.agent.name,
		agentSource: request.options.agent.source,
		status: "running",
		task: request.options.task,
		assignment: request.options.assignment,
		description: request.options.description,
		recentTools: [],
		recentOutput: [],
		toolCount: 0,
		requests: 0,
		tokens: 0,
		cost: 0,
		durationMs: 0,
		modelOverride: request.options.modelOverride,
		routeReceipt: request.options.routeReceipt,
	};
}

async function runRequest(
	request: SpawnWorkerRequest,
	options: SpawnWorkerClientOptions,
): Promise<SingleResult | SyntheticSpawnResult> {
	if (options.signal?.aborted) throw new SpawnWorkerError("aborted", "Subagent subprocess aborted before spawn");
	const journalCursor =
		request.type === "run" ? await captureJournalCursor(request.options.sessionFile) : { offset: 0 };
	const command = spawnCommand();
	let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
	try {
		proc = await launchSpawnProcess(request.requestId, command, options.signal);
	} catch (error) {
		if (error instanceof SpawnWorkerError) throw error;
		throw new SpawnWorkerError("spawn", error instanceof Error ? error.message : String(error));
	}
	const beginTeardown = createProcessGroupTeardown(proc);
	try {
		await options.onProcessStart?.(proc.pid);
	} catch (error) {
		beginTeardown(true);
		throw new SpawnWorkerError("spawn", error instanceof Error ? error.message : String(error));
	}

	type TerminalError = SpawnWorkerError | JournalRecoveryError;
	const startedAt = Date.now();
	const terminal = Promise.withResolvers<void>();
	let terminalClaimed = false;
	let terminalPending = false;
	let terminalError: TerminalError | undefined;
	let result: SingleResult | SyntheticSpawnResult | undefined;
	let memoryInterruptRequested = false;
	let memoryInterruptError: SpawnWorkerError | undefined;
	let memoryInterruptSignaled = false;
	let memoryEscalationStarted = false;
	let memoryInterruptGraceTimer: ReturnType<typeof setTimeout> | undefined;
	let sawReady = false;
	let latestProgress = request.type === "run" ? initialWorkerProgress(request) : undefined;
	let latestTokens = latestProgress?.tokens ?? 0;
	let lastTokenAdvanceAt = startedAt;
	let probeInFlight = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const watermarks = options.memoryWatermarks ?? {
		softBytes: DEFAULT_MEMORY_SOFT_WATERMARK_BYTES,
		hardBytes: DEFAULT_MEMORY_HARD_WATERMARK_BYTES,
	};
	const memoryInterruptGraceMs = Math.max(
		0,
		Math.trunc(options.memoryInterruptGraceMs ?? DEFAULT_MEMORY_INTERRUPT_GRACE_MS),
	);
	const stallThresholdMs = Math.max(1, Math.trunc(options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS));
	const probeIntervalMs = Math.max(10, Math.min(30_000, Math.trunc(stallThresholdMs / 4)));

	const emitLiveness = (state: "stalled" | "dead"): void => {
		if (!latestProgress) return;
		latestProgress = { ...latestProgress, livenessState: state, durationMs: Date.now() - startedAt };
		options.onProgress?.(latestProgress);
	};
	const disarmTimeout = (): void => {
		clearTimeout(timeout);
		timeout = undefined;
	};
	const disarmMemoryInterruptGrace = (): void => {
		clearTimeout(memoryInterruptGraceTimer);
		memoryInterruptGraceTimer = undefined;
	};
	void proc.exited.then(disarmMemoryInterruptGrace, disarmMemoryInterruptGrace);
	const claimError = (error: TerminalError, signalOwnedGroup = true): void => {
		if (terminalClaimed) return;
		terminalPending = false;
		terminalClaimed = true;
		terminalError = error;
		disarmTimeout();
		terminal.resolve();
		beginTeardown(signalOwnedGroup);
	};
	const claimResult = (value: SingleResult | SyntheticSpawnResult, signalOwnedGroup = true): void => {
		if (terminalClaimed || terminalPending) return;
		terminalClaimed = true;
		result = value;
		disarmTimeout();
		terminal.resolve();
		beginTeardown(signalOwnedGroup);
	};
	const claimRecoveredResult = (value: SingleResult, signalOwnedGroup: boolean): void => {
		if (terminalClaimed || request.type !== "run") return;
		terminalPending = false;
		if (request.version === 2 && request.options.sessionFile) {
			AgentRegistry.global().projectJournalTerminal(
				request.options.id,
				request.options.sessionFile,
				request.launchGeneration,
			);
		}
		claimResult(value, signalOwnedGroup);
	};
	const recoverCurrentTurn = async (signalOwnedGroup: boolean): Promise<boolean> => {
		if (terminalClaimed || request.type !== "run") return terminalClaimed;
		const recovered = await recoverCurrentTurnResultFromJournal(request, journalCursor);
		if (terminalClaimed) return true;
		if (!recovered) return false;
		claimRecoveredResult(recovered, signalOwnedGroup);
		return true;
	};
	const recoverOrFail = async (error: SpawnWorkerError, signalOwnedGroup = true, emitDead = false): Promise<void> => {
		if (terminalClaimed || terminalPending) return;
		terminalPending = true;
		try {
			if (await recoverCurrentTurn(signalOwnedGroup)) return;
		} catch (recoveryError) {
			if (terminalClaimed) return;
			if (emitDead && request.type === "run") emitLiveness("dead");
			claimError(
				recoveryError instanceof JournalRecoveryError
					? recoveryError
					: new JournalRecoveryError(
							recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
						),
			);
			return;
		}
		if (emitDead && request.type === "run") emitLiveness("dead");
		claimError(error, signalOwnedGroup);
	};
	const failProtocol = (message: string): Promise<void> => recoverOrFail(new SpawnWorkerError("protocol", message));
	const onAbort = (): void => {
		void recoverOrFail(new SpawnWorkerError("aborted", "Subagent subprocess aborted"));
	};
	options.signal?.addEventListener("abort", onAbort, { once: true });
	if (options.signal?.aborted) onAbort();
	if (options.timeoutMs && options.timeoutMs > 0) {
		timeout = setTimeout(() => {
			void recoverOrFail(new SpawnWorkerError("timeout", `Subagent subprocess exceeded ${options.timeoutMs}ms`));
		}, options.timeoutMs);
	}
	const persistParentMemoryInterrupt = async (): Promise<boolean> => {
		if (request.type !== "run" || !request.options.sessionFile || !request.options.parentSessionFile) {
			return false;
		}
		await appendInterruptedChildLifecycleFile({
			agentId: request.options.id,
			childSessionFile: request.options.sessionFile,
			parentSessionFile: request.options.parentSessionFile,
		});
		return true;
	};
	const escalateMemoryInterrupt = async (): Promise<void> => {
		if (memoryEscalationStarted) return;
		memoryEscalationStarted = true;
		disarmMemoryInterruptGrace();
		const error =
			memoryInterruptError ?? new SpawnWorkerError("memory-watermark", "Subagent memory interrupt grace expired");
		let persisted = false;
		if (!terminalClaimed) {
			try {
				persisted = await persistParentMemoryInterrupt();
			} catch (journalError) {
				beginTeardown(true);
				claimError(
					new JournalRecoveryError(
						`Failed to persist resumable memory interruption: ${
							journalError instanceof Error ? journalError.message : String(journalError)
						}`,
					),
					false,
				);
				return;
			}
			await recoverOrFail(error, true);
		}
		beginTeardown(true);
		if (persisted) {
			void proc.exited.then(async () => {
				// A worker can finish its own abort record just as the grace
				// expires. Reassert the parent's terminal record after exit so
				// the last durable state remains resumable and interrupted.
				try {
					await persistParentMemoryInterrupt();
				} catch {
					// The pre-kill durable record remains authoritative.
				}
			});
		}
	};
	const armMemoryInterruptGrace = (): void => {
		if (memoryInterruptGraceTimer || memoryEscalationStarted) return;
		memoryInterruptGraceTimer = setTimeout(() => void escalateMemoryInterrupt(), memoryInterruptGraceMs);
		memoryInterruptGraceTimer.unref?.();
	};
	const signalReadyWorkerForMemoryInterrupt = (): void => {
		if (!memoryInterruptRequested || memoryInterruptSignaled || memoryEscalationStarted || !sawReady) return;
		memoryInterruptSignaled = signalWorkerMemoryInterrupt(proc, proc.pid);
		if (!memoryInterruptSignaled) void escalateMemoryInterrupt();
	};
	const watchedAgentId = request.type === "run" ? request.options.id : undefined;
	const notifyMemoryPressure =
		options.onMemoryPressureNotice ??
		((agentId: string, notice: string): void => void deliverMemoryPressureNotice(agentId, notice));
	let softNoticeSent = false;
	const emitSoftNotice = (rssBytes: number): void => {
		if (softNoticeSent || !watchedAgentId || watermarks.softBytes === 0) return;
		softNoticeSent = true;
		notifyMemoryPressure(watchedAgentId, memorySoftWatermarkNotice(rssBytes, watermarks));
	};
	const interruptForMemoryWatermark = (error: SpawnWorkerError): void => {
		if (memoryInterruptRequested || terminalClaimed || terminalPending) return;
		memoryInterruptRequested = true;
		memoryInterruptError = error;
		armMemoryInterruptGrace();
		// Before ready, SIGUSR2 may still have its default action because the
		// worker entry module has not installed its handler. Defer the signal;
		// the already-armed grace still bounds a worker that never becomes ready.
		signalReadyWorkerForMemoryInterrupt();
	};
	const stopRssWatch = watchWorkerRss(proc.pid, {
		softBytes: watermarks.softBytes,
		hardBytes: watermarks.hardBytes,
		onSoftWatermark: emitSoftNotice,
		// A direct hard crossing may be the first observed sample. Persist the
		// warning before asking the worker to abort its live turn gracefully.
		onHardWatermark: rssBytes => {
			emitSoftNotice(rssBytes);
			interruptForMemoryWatermark(
				new SpawnWorkerError("memory-watermark", memoryHardWatermarkMessage(rssBytes, watermarks)),
			);
		},
		onSampleInvalid: reason => {
			interruptForMemoryWatermark(
				new SpawnWorkerError("memory-watermark", memoryWatermarkSampleInvalidMessage(reason, watermarks)),
			);
		},
	});

	const stderrPromise = readCapped(proc.stderr, DIAGNOSTIC_STREAM_CAP_BYTES).then(result =>
		withCappedStreamNotice(result, "stderr"),
	);
	const stdoutPromise = (async (): Promise<void> => {
		const reader = proc.stdout.getReader();
		const decoder = new TextDecoder();
		const encoder = new TextEncoder();
		let buffer = "";
		const handleLine = async (line: string): Promise<void> => {
			if (terminalClaimed) return;
			if (encoder.encode(line).byteLength > SPAWN_WORKER_MAX_RECORD_BYTES) {
				await failProtocol("Subagent subprocess emitted an oversized record");
				return;
			}
			let record: SpawnWorkerRecord;
			try {
				record = decodeSpawnWorkerRecord(JSON.parse(line));
			} catch (error) {
				await failProtocol(error instanceof Error ? error.message : String(error));
				return;
			}
			if (record.requestId !== request.requestId) {
				await failProtocol("Subagent subprocess request id mismatch");
				return;
			}
			switch (record.type) {
				case "ready":
					if (sawReady || record.pid !== proc.pid) {
						await failProtocol("Invalid worker ready record");
						return;
					}
					sawReady = true;
					signalReadyWorkerForMemoryInterrupt();
					break;
				case "phase":
					options.onPhase?.(record.phase);
					break;
				case "registry":
					projectRegistry(record.ref);
					break;
				case "progress": {
					const now = Date.now();
					if (record.progress.tokens > latestTokens) lastTokenAdvanceAt = now;
					latestTokens = record.progress.tokens;
					latestProgress = { ...record.progress, livenessState: undefined };
					options.onProgress?.(latestProgress);
					break;
				}
				case "event":
					options.eventBus?.emit(record.channel, record.payload);
					break;
				case "yield-written":
					if (!sawReady) {
						claimError(
							new SpawnWorkerError("protocol", "Subagent subprocess emitted yield-written before ready"),
						);
						break;
					}
					disarmTimeout();
					if (request.type !== "run") {
						await failProtocol("Synthetic subprocess emitted a yield-written record");
						break;
					}
					try {
						const recovered = await recoverCurrentTurn(!memoryInterruptRequested);
						if (!recovered && !terminalClaimed) {
							claimError(new JournalRecoveryError("Yield record was not recoverable from the child journal"));
						}
					} catch (error) {
						if (!terminalClaimed) {
							claimError(
								error instanceof JournalRecoveryError
									? error
									: new JournalRecoveryError(error instanceof Error ? error.message : String(error)),
							);
						}
					}
					break;
				case "result":
					if (!sawReady) {
						await failProtocol("Subagent subprocess emitted a result before ready");
						break;
					}
					claimResult(record.result, !memoryInterruptRequested);
					break;
				case "synthetic-result":
					if (!sawReady) {
						await failProtocol("Subagent subprocess emitted a result before ready");
						break;
					}
					claimResult(
						{ allocatedBytes: record.allocatedBytes, rssBytes: record.rssBytes },
						!memoryInterruptRequested,
					);
					break;
				case "error":
					if (!sawReady) {
						await failProtocol("Subagent subprocess emitted an error before ready");
						break;
					}
					await recoverOrFail(new SpawnWorkerError(record.code, record.message));
					break;
			}
		};
		try {
			while (true) {
				const read = await reader.read().catch(async error => {
					await recoverOrFail(
						new SpawnWorkerError("protocol", error instanceof Error ? error.message : String(error)),
					);
					return undefined;
				});
				if (!read) return;
				const { done, value } = read;
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let newline = buffer.indexOf("\n");
				while (newline >= 0) {
					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 1);
					if (line.length > 0) await handleLine(line);
					newline = buffer.indexOf("\n");
				}
				if (encoder.encode(buffer).byteLength > SPAWN_WORKER_MAX_RECORD_BYTES) {
					await failProtocol("Subagent subprocess unterminated record exceeded cap");
					break;
				}
			}
			buffer += decoder.decode();
			if (buffer.trim().length > 0) await handleLine(buffer);
		} finally {
			reader.releaseLock();
		}
	})();

	const probeLiveness = async (): Promise<void> => {
		if (terminalClaimed || probeInFlight || request.type !== "run") return;
		probeInFlight = true;
		try {
			const now = Date.now();
			let journalStale = false;
			const sessionFile = request.options.sessionFile;
			if (sessionFile) {
				try {
					const stat = await fs.stat(sessionFile);
					journalStale = now - stat.mtimeMs >= stallThresholdMs;
				} catch {
					journalStale = now - startedAt >= stallThresholdMs;
				}
			}
			const tokenRateStuck = now - lastTokenAdvanceAt >= stallThresholdMs;
			if (!tokenRateStuck && !journalStale) return;
			emitLiveness("stalled");
			if (isProcessAlive(proc.pid)) return;
			await recoverOrFail(
				new SpawnWorkerError("exit", `Subagent subprocess pid ${proc.pid} died without a terminal journal record`),
				false,
				true,
			);
		} finally {
			probeInFlight = false;
		}
	};
	const livenessTimer =
		request.type === "run"
			? setInterval(() => {
					void probeLiveness();
				}, probeIntervalMs)
			: undefined;

	const naturalCompletion = (async (): Promise<void> => {
		try {
			proc.stdin.write(`${JSON.stringify(request)}\n`);
			proc.stdin.end();
			const [exitCode, stderr] = await Promise.all([proc.exited, stderrPromise, stdoutPromise]).then(
				values => [values[0], values[1]] as const,
			);
			if (terminalClaimed) return;
			await recoverOrFail(
				memoryInterruptError ??
					new SpawnWorkerError(
						"exit",
						!sawReady
							? `Subagent subprocess exited before ready or writing a terminal journal record${stderr.trim() ? `: ${stderr.trim()}` : ""}`
							: exitCode !== 0
								? `Subagent subprocess exited with code ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`
								: "Subagent subprocess exited without a result or terminal journal record",
					),
				false,
				true,
			);
		} catch (error) {
			await recoverOrFail(
				error instanceof SpawnWorkerError
					? error
					: new SpawnWorkerError("protocol", error instanceof Error ? error.message : String(error)),
				!memoryInterruptRequested,
			);
		}
	})();
	void naturalCompletion;

	try {
		await terminal.promise;
		if (terminalError) throw terminalError;
		if (!result) throw new SpawnWorkerError("protocol", "Subagent subprocess settled without an outcome");
		return result;
	} finally {
		disarmTimeout();
		clearInterval(livenessTimer);
		stopRssWatch();
		options.signal?.removeEventListener("abort", onAbort);
	}
}

export function runSubagentSpawnProcess(
	options: ExecutorOptions,
	settings: Settings,
	clientOptions: SpawnWorkerClientOptions = {},
): Promise<SingleResult> {
	pushLoopPhase(`subagent:${options.id}:request-snapshot`);
	let request: SpawnWorkerRunRequest;
	try {
		const registry = AgentRegistry.global();
		const launchGeneration = crypto.randomUUID();
		const currentRef = registry.get(options.id);
		if (currentRef) registry.setLaunchGeneration(currentRef, launchGeneration, options.sessionFile);
		request = {
			version: SPAWN_WORKER_REQUEST_VERSION,
			type: "run",
			requestId: crypto.randomUUID(),
			launchGeneration,
			journalStartNonce: crypto.randomUUID(),
			options: serializeOptions(options),
			settings: snapshotExecutorSettings(settings),
			registry: registrySnapshot(),
			...(options.localProtocolOptions
				? {
						localProtocol: {
							artifactsDir: options.localProtocolOptions.getArtifactsDir?.() ?? null,
							sessionId: options.localProtocolOptions.getSessionId?.() ?? null,
						},
					}
				: {}),
		};
	} finally {
		popLoopPhase();
	}
	const runtimeLimitMs = options.maxRuntimeMs ?? settings.get("task.maxRuntimeMs");
	const timeoutMs = runtimeLimitMs > 0 ? runtimeLimitMs + SETUP_TIMEOUT_GRACE_MS : undefined;
	return runRequest(request, {
		...clientOptions,
		signal: clientOptions.signal ?? options.signal,
		timeoutMs: clientOptions.timeoutMs ?? timeoutMs,
		memoryInterruptGraceMs: clientOptions.memoryInterruptGraceMs ?? settings.get("task.memoryInterruptGraceMs"),
		stallThresholdMs: clientOptions.stallThresholdMs ?? settings.get("task.stallThresholdMs"),
		memoryWatermarks: clientOptions.memoryWatermarks ?? resolveMemoryWatermarks(settings),
		onProgress: clientOptions.onProgress ?? options.onProgress,
		eventBus: clientOptions.eventBus ?? options.eventBus,
	}).then(result => result as SingleResult);
}

export function runSyntheticSpawnWorkerWorkload(
	workload: SyntheticSpawnWorkload,
	options: SpawnWorkerClientOptions = {},
): Promise<SyntheticSpawnResult> {
	const request: SpawnWorkerSyntheticRequest = {
		version: SPAWN_WORKER_REQUEST_VERSION,
		type: "synthetic",
		requestId: crypto.randomUUID(),
		workload,
	};
	return runRequest(request, options).then(result => result as SyntheticSpawnResult);
}
