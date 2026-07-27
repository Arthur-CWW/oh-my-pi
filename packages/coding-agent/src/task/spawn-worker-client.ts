import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isCompiledBinary, popLoopPhase, pushLoopPhase, workerHostEntry } from "@oh-my-pi/pi-utils";
import type { Settings } from "../config/settings";
import { SessionManager } from "../session/session-manager";
import { AgentRegistry } from "../registry/agent-registry";
import type { EventBus } from "../utils/event-bus";
import { finalizeSubprocessOutput, snapshotExecutorSettings, type ExecutorOptions } from "./executor";
import {
	decodeSpawnWorkerRecord,
	SPAWN_WORKER_ARG,
	SPAWN_WORKER_MAX_RECORD_BYTES,
	SPAWN_WORKER_PROTOCOL_VERSION,
	type SerializableExecutorOptions,
	type SpawnWorkerErrorCode,
	type SpawnWorkerRecord,
	type SpawnWorkerRegistryRef,
	type SpawnWorkerRequest,
	type SpawnWorkerRunRequest,
	type SpawnWorkerSyntheticRequest,
} from "./spawn-worker-protocol";
import type { AgentProgress, SingleResult } from "./types";

const DEFAULT_MAX_RSS_BYTES = 1536 * 1024 * 1024;
const RSS_SAMPLE_INTERVAL_MS = 250;
const STDERR_CAP_BYTES = 64 * 1024;
const SETUP_TIMEOUT_GRACE_MS = 60_000;
const DEFAULT_STALL_THRESHOLD_MS = 5 * 60_000;
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
	await new Promise<void>(resolve => setTimeout(resolve, 10));
	try {
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
		} finally {
			popLoopPhase();
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

export interface SpawnWorkerClientOptions {
	signal?: AbortSignal;
	maxRssBytes?: number;
	timeoutMs?: number;
	/** Delay before a no-token/no-journal-activity worker is probed for liveness. */
	stallThresholdMs?: number;
	onProgress?: ExecutorOptions["onProgress"];
	eventBus?: EventBus;
	onPhase?: (phase: Extract<SpawnWorkerRecord, { type: "phase" }>["phase"]) => void;
}

export interface SyntheticSpawnWorkload {
	spinMs: number;
	allocateBytes: number;
	hangMs?: number;
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
	return AgentRegistry.global()
		.list()
		.map(ref => ({
			id: ref.id,
			displayName: ref.displayName,
			kind: ref.kind,
			status: ref.status,
			...(ref.parentId ? { parentId: ref.parentId } : {}),
			sessionFile: ref.sessionFile,
		}));
}

function projectRegistry(ref: SpawnWorkerRegistryRef): void {
	const registry = AgentRegistry.global();
	const existing = registry.get(ref.id);
	if (!existing || existing.sessionFile !== (ref.sessionFile ?? null)) {
		registry.register({ ...ref, session: null });
		return;
	}
	registry.setStatus(ref.id, ref.status);
}

function killProcessTree(proc: Bun.Subprocess): void {
	try {
		process.kill(-proc.pid, "SIGKILL");
		return;
	} catch {
		// The worker may have exited or may not yet own its process group.
	}
	try {
		proc.kill("SIGKILL");
	} catch {
		// Exit processing reports the terminal state.
	}
}

interface RssWatch {
	maxBytes: number;
	onExceeded(rssBytes: number): void;
}

const rssWatches = new Map<number, RssWatch>();
let rssTimer: Timer | undefined;
let rssSampling = false;

async function sampleWorkerRss(): Promise<void> {
	if (rssSampling || rssWatches.size === 0) return;
	rssSampling = true;
	try {
		const pids = [...rssWatches.keys()];
		const sample = Bun.spawn({
			cmd: ["/bin/ps", "-o", "pid=,rss=", "-p", pids.join(",")],
			stdout: "pipe",
			stderr: "ignore",
		});
		const [text] = await Promise.all([new Response(sample.stdout).text(), sample.exited]);
		for (const line of text.split("\n")) {
			const [pidText, rssText] = line.trim().split(/\s+/, 2);
			const pid = Number.parseInt(pidText, 10);
			const rssBytes = Number.parseInt(rssText, 10) * 1024;
			const watch = rssWatches.get(pid);
			if (watch && Number.isFinite(rssBytes) && rssBytes > watch.maxBytes) watch.onExceeded(rssBytes);
		}
	} finally {
		rssSampling = false;
	}
}

function watchWorkerRss(pid: number, watch: RssWatch): () => void {
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

async function readCappedStderr(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const remaining = STDERR_CAP_BYTES - bytes;
			if (remaining <= 0) continue;
			const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
			bytes += slice.byteLength;
			text += decoder.decode(slice, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}


type RecoveredYield = { data?: unknown; status?: "success" | "aborted"; error?: string; schemaOverridden?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recover a terminal yield from the child journal when the worker's final JSONL
 * record races process teardown. The journal is the durable source of truth;
 * this path deliberately returns a typed failure when it cannot be read.
 */
export async function recoverSpawnWorkerResultFromJournal(
	request: SpawnWorkerRunRequest,
): Promise<SingleResult | undefined> {
	const sessionFile = request.options.sessionFile;
	if (!sessionFile) return undefined;
	try {
		const session = await SessionManager.open(sessionFile, undefined, undefined, { suppressBreadcrumb: true });
		const yields: RecoveredYield[] = [];
		for (const entry of session.getEntries()) {
			if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "toolResult") continue;
			const details = entry.message.details;
			if (!isRecord(details) || (details.status !== "success" && details.status !== "aborted")) continue;
			yields.push({
				data: details.data,
				status: details.status,
				error: typeof details.error === "string" ? details.error : undefined,
				schemaOverridden: details.schemaOverridden === true ? true : undefined,
			});
		}
		const lastYield = yields[yields.length - 1];
		if (!lastYield) return undefined;
		const finalized = finalizeSubprocessOutput({
			rawOutput: "",
			exitCode: lastYield.status === "success" ? 0 : 1,
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
			aborted: lastYield.status === "aborted",
			abortReason: lastYield.status === "aborted" ? lastYield.error : undefined,
			outputPath: request.options.artifactsDir ? path.join(request.options.artifactsDir, `${request.options.id}.md`) : undefined,
			extractedToolData: { yield: yields },
			outputMeta: { lineCount: output.split("\n").length, charCount: output.length },
		};
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
	const command = spawnCommand();
	let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
	try {
		proc = await launchSpawnProcess(request.requestId, command, options.signal);
	} catch (error) {
		if (error instanceof SpawnWorkerError) throw error;
		throw new SpawnWorkerError("spawn", error instanceof Error ? error.message : String(error));
	}

	const startedAt = Date.now();
	const terminal = Promise.withResolvers<void>();
	let terminalClaimed = false;
	let terminalError: SpawnWorkerError | undefined;
	let result: SingleResult | SyntheticSpawnResult | undefined;
	let sawReady = false;
	let latestProgress = request.type === "run" ? initialWorkerProgress(request) : undefined;
	let latestTokens = latestProgress?.tokens ?? 0;
	let lastTokenAdvanceAt = startedAt;
	let probeInFlight = false;
	const maxRssBytes = Math.max(1, Math.trunc(options.maxRssBytes ?? DEFAULT_MAX_RSS_BYTES));
	const stallThresholdMs = Math.max(1, Math.trunc(options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS));
	const probeIntervalMs = Math.max(10, Math.min(30_000, Math.trunc(stallThresholdMs / 4)));

	const emitLiveness = (state: "stalled" | "dead"): void => {
		if (!latestProgress) return;
		latestProgress = { ...latestProgress, livenessState: state, durationMs: Date.now() - startedAt };
		options.onProgress?.(latestProgress);
	};
	const claimError = (error: SpawnWorkerError, kill = true): void => {
		if (terminalClaimed) return;
		terminalClaimed = true;
		terminalError = error;
		if (kill) killProcessTree(proc);
		terminal.resolve();
	};
	const claimResult = (value: SingleResult | SyntheticSpawnResult, terminateWorker = false): void => {
		if (terminalClaimed) return;
		terminalClaimed = true;
		result = value;
		if (terminateWorker) {
			try {
				proc.kill();
			} catch {
				// The worker may already be exiting.
			}
		}
		terminal.resolve();
	};
	const recoverAfterDeath = async (message: string): Promise<void> => {
		if (terminalClaimed) return;
		const recovered = request.type === "run" ? await recoverSpawnWorkerResultFromJournal(request) : undefined;
		if (terminalClaimed) return;
		if (recovered) {
			claimResult(recovered);
			return;
		}
		if (request.type === "run") emitLiveness("dead");
		claimError(new SpawnWorkerError("exit", message), false);
	};
	const failAndKill = (error: SpawnWorkerError): void => claimError(error);
	const onAbort = (): void => failAndKill(new SpawnWorkerError("aborted", "Subagent subprocess aborted"));
	options.signal?.addEventListener("abort", onAbort, { once: true });
	const timeout = options.timeoutMs && options.timeoutMs > 0
		? setTimeout(() => failAndKill(new SpawnWorkerError("timeout", `Subagent subprocess exceeded ${options.timeoutMs}ms`)), options.timeoutMs)
		: undefined;
	const stopRssWatch = watchWorkerRss(proc.pid, {
		maxBytes: maxRssBytes,
		onExceeded: rssBytes =>
			failAndKill(new SpawnWorkerError("rss-limit", `Subagent subprocess RSS ${rssBytes} exceeded ${maxRssBytes}`)),
	});

	const stderrPromise = readCappedStderr(proc.stderr);
	const stdoutPromise = (async (): Promise<void> => {
		const reader = proc.stdout.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		const handleLine = (line: string): void => {
			if (terminalClaimed) return;
			if (new TextEncoder().encode(line).byteLength > SPAWN_WORKER_MAX_RECORD_BYTES) {
				failAndKill(new SpawnWorkerError("protocol", "Subagent subprocess emitted an oversized record"));
				return;
			}
			let record: SpawnWorkerRecord;
			try {
				record = decodeSpawnWorkerRecord(JSON.parse(line));
			} catch (error) {
				failAndKill(new SpawnWorkerError("protocol", error instanceof Error ? error.message : String(error)));
				return;
			}
			if (record.requestId !== request.requestId) {
				failAndKill(new SpawnWorkerError("protocol", "Subagent subprocess request id mismatch"));
				return;
			}
			switch (record.type) {
				case "ready":
					if (sawReady || record.pid !== proc.pid) failAndKill(new SpawnWorkerError("protocol", "Invalid worker ready record"));
					sawReady = true;
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
				case "result":
					claimResult(record.result, true);
					break;
				case "synthetic-result":
					result = { allocatedBytes: record.allocatedBytes, rssBytes: record.rssBytes };
					break;
				case "error":
					failAndKill(new SpawnWorkerError(record.code, record.message));
					break;
			}
		};
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let newline = buffer.indexOf("\n");
				while (newline >= 0) {
					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 1);
					if (line.length > 0) handleLine(line);
					newline = buffer.indexOf("\n");
				}
				if (new TextEncoder().encode(buffer).byteLength > SPAWN_WORKER_MAX_RECORD_BYTES) {
					failAndKill(new SpawnWorkerError("protocol", "Subagent subprocess unterminated record exceeded cap"));
					break;
				}
			}
			buffer += decoder.decode();
			if (buffer.trim().length > 0) handleLine(buffer);
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
			await recoverAfterDeath(`Subagent subprocess pid ${proc.pid} died without a terminal journal record`);
		} finally {
			probeInFlight = false;
		}
	};
	const livenessTimer = request.type === "run"
		? setInterval(() => {
				void probeLiveness();
			}, probeIntervalMs)
		: undefined;

	const naturalCompletion = (async (): Promise<void> => {
		try {
			proc.stdin.write(`${JSON.stringify(request)}\n`);
			proc.stdin.end();
			const [exitCode, stderr] = await Promise.all([proc.exited, stderrPromise, stdoutPromise]).then(values =>
				[values[0], values[1]] as const
			);
			if (terminalClaimed) return;
			if (!sawReady) {
				await recoverAfterDeath("Subagent subprocess exited before ready or writing a terminal journal record");
				return;
			}
			if (result) {
				claimResult(result);
				return;
			}
			await recoverAfterDeath(
				exitCode !== 0
					? `Subagent subprocess exited with code ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`
					: "Subagent subprocess exited without a result or terminal journal record",
			);
		} catch (error) {
			claimError(
				error instanceof SpawnWorkerError
					? error
					: new SpawnWorkerError("protocol", error instanceof Error ? error.message : String(error)),
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
		clearTimeout(timeout);
		clearInterval(livenessTimer);
		stopRssWatch();
		options.signal?.removeEventListener("abort", onAbort);
	}
}

export function runSubagentSpawnProcess(options: ExecutorOptions, settings: Settings): Promise<SingleResult> {
	pushLoopPhase(`subagent:${options.id}:request-snapshot`);
	let request: SpawnWorkerRunRequest;
	try {
		request = {
			version: SPAWN_WORKER_PROTOCOL_VERSION,
			type: "run",
			requestId: crypto.randomUUID(),
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
		signal: options.signal,
		timeoutMs,
		stallThresholdMs: settings.get("task.stallThresholdMs"),
		onProgress: options.onProgress,
		eventBus: options.eventBus,
	}).then(result => result as SingleResult);
}

export function runSyntheticSpawnWorkerWorkload(
	workload: SyntheticSpawnWorkload,
	options: SpawnWorkerClientOptions = {},
): Promise<SyntheticSpawnResult> {
	const request: SpawnWorkerSyntheticRequest = {
		version: SPAWN_WORKER_PROTOCOL_VERSION,
		type: "synthetic",
		requestId: crypto.randomUUID(),
		workload,
	};
	return runRequest(request, options).then(result => result as SyntheticSpawnResult);
}
