import type { SettingPath } from "../config/settings-schema";
import type { ExecutorOptions } from "./executor";
import type { AgentProgress, SingleResult } from "./types";

/**
 * v2 adds launch-generation fencing and a durable current-turn journal marker.
 * Decoders continue to accept v1 traffic during rolling upgrades, but v1
 * registry projections cannot prove a launch generation.
 */
export const SPAWN_WORKER_PROTOCOL_VERSION = 2 as const;
export const SPAWN_WORKER_REQUEST_VERSION = SPAWN_WORKER_PROTOCOL_VERSION;
export type SpawnWorkerProtocolVersion = 1 | typeof SPAWN_WORKER_PROTOCOL_VERSION;
export const SPAWN_WORKER_ARG = "__omp_worker_task_spawn";
export const SPAWN_WORKER_MAX_RECORD_BYTES = 1024 * 1024;
export const SPAWN_WORKER_MAX_QUEUED_BYTES = 4 * 1024 * 1024;
export const SPAWN_WORKER_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const SPAWN_WORKER_JOURNAL_START_MARKER = "spawn_worker_turn_start";

export type SpawnWorkerErrorCode = "protocol" | "spawn" | "exit" | "timeout" | "memory-watermark" | "aborted";

export interface SpawnWorkerRegistryRef {
	id: string;
	displayName: string;
	kind: "main" | "sub";
	parentId?: string;
	status: "running" | "waiting-provider" | "idle" | "parked" | "aborted";
	sessionFile?: string | null;
	launchGeneration?: string;
}

export type SerializableExecutorOptions = Pick<
	ExecutorOptions,
	| "cwd"
	| "worktree"
	| "agent"
	| "task"
	| "assignment"
	| "context"
	| "planReference"
	| "description"
	| "role"
	| "index"
	| "id"
	| "parentToolCallId"
	| "detached"
	| "modelOverride"
	| "routeReceipt"
	| "buildVersion"
	| "buildDigest"
	| "parentActiveModelPattern"
	| "thinkingLevel"
	| "outputSchema"
	| "taskDepth"
	| "maxRuntimeMs"
	| "quotaAdmission"
	| "enableLsp"
	| "sessionFile"
	| "parentWorkstream"
	| "parentSessionFile"
	| "parentSessionId"
	| "parentAgentId"
	| "persistArtifacts"
	| "artifactsDir"
	| "contextFiles"
	| "skills"
	| "promptTemplates"
	| "workspaceTree"
	| "rules"
	| "preloadedExtensionPaths"
	| "preloadedCustomToolPaths"
	| "parentEvalSessionId"
	| "autoloadSkills"
>;

interface SpawnWorkerRunRequestBase {
	type: "run";
	requestId: string;
	options: SerializableExecutorOptions;
	settings: Partial<Record<SettingPath, unknown>>;
	registry: SpawnWorkerRegistryRef[];
	localProtocol?: { artifactsDir: string | null; sessionId: string | null };
}

export type SpawnWorkerRunRequest =
	| (SpawnWorkerRunRequestBase & { version: 1 })
	| (SpawnWorkerRunRequestBase & {
			version: typeof SPAWN_WORKER_PROTOCOL_VERSION;
			launchGeneration: string;
			journalStartNonce: string;
	  });

export interface SpawnWorkerSyntheticRequest {
	version: SpawnWorkerProtocolVersion;
	type: "synthetic";
	requestId: string;
	workload: {
		spinMs: number;
		allocateBytes: number;
		hangMs?: number;
		lingerAfterResultMs?: number;
	};
}

export type SpawnWorkerRequest = SpawnWorkerRunRequest | SpawnWorkerSyntheticRequest;

interface SpawnWorkerRecordBase {
	version: SpawnWorkerProtocolVersion;
	requestId: string;
}

export type SpawnWorkerRecord =
	| (SpawnWorkerRecordBase & { type: "ready"; pid: number })
	| (SpawnWorkerRecordBase & { type: "phase"; phase: "decode" | "setup" | "run" | "finalize"; at: number })
	| (SpawnWorkerRecordBase & { type: "registry"; ref: SpawnWorkerRegistryRef })
	| (SpawnWorkerRecordBase & { type: "progress"; progress: AgentProgress })
	| (SpawnWorkerRecordBase & { type: "event"; channel: string; payload: unknown })
	| (SpawnWorkerRecordBase & { type: "result"; result: SingleResult; rssBytes: number })
	| (SpawnWorkerRecordBase & { type: "synthetic-result"; allocatedBytes: number; rssBytes: number })
	| (SpawnWorkerRecordBase & { type: "error"; code: SpawnWorkerErrorCode; message: string })
	| (Omit<SpawnWorkerRecordBase, "version"> & { version: 2; type: "yield-written" });

function object(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
	return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum)
		throw new Error(`${label} must be an integer >= ${minimum}`);
	return value as number;
}

function version(value: unknown): SpawnWorkerProtocolVersion {
	if (value !== 1 && value !== SPAWN_WORKER_PROTOCOL_VERSION)
		throw new Error(`unsupported spawn-worker protocol version: ${String(value)}`);
	return value as SpawnWorkerProtocolVersion;
}

export function decodeSpawnWorkerRequest(value: unknown): SpawnWorkerRequest {
	const input = object(value, "request");
	const protocolVersion = version(input.version);
	const requestId = string(input.requestId, "requestId");
	if (input.type === "run") {
		const options = object(input.options, "options") as unknown as SerializableExecutorOptions;
		string(options.cwd, "options.cwd");
		string(options.id, "options.id");
		string(options.task, "options.task");
		object(options.agent, "options.agent");
		const settings = object(input.settings, "settings") as Partial<Record<SettingPath, unknown>>;
		if (!Array.isArray(input.registry)) throw new Error("registry must be an array");
		const registry = input.registry.map((raw, index) =>
			decodeRegistryRef(raw, `registry[${index}]`, protocolVersion),
		);
		let localProtocol: SpawnWorkerRunRequest["localProtocol"];
		if (input.localProtocol !== undefined) {
			const local = object(input.localProtocol, "localProtocol");
			if (local.artifactsDir !== null && typeof local.artifactsDir !== "string") {
				throw new Error("localProtocol.artifactsDir must be a string or null");
			}
			if (local.sessionId !== null && typeof local.sessionId !== "string") {
				throw new Error("localProtocol.sessionId must be a string or null");
			}
			localProtocol = {
				artifactsDir: local.artifactsDir as string | null,
				sessionId: local.sessionId as string | null,
			};
		}
		const base = {
			type: "run",
			requestId,
			options,
			settings,
			registry,
			localProtocol,
		} as const;
		if (protocolVersion === SPAWN_WORKER_PROTOCOL_VERSION) {
			return {
				...base,
				version: protocolVersion,
				launchGeneration: string(input.launchGeneration, "launchGeneration"),
				journalStartNonce: string(input.journalStartNonce, "journalStartNonce"),
			};
		}
		return { ...base, version: protocolVersion };
	}
	if (input.type === "synthetic") {
		const workload = object(input.workload, "workload");
		const hangMs = workload.hangMs === undefined ? undefined : integer(workload.hangMs, "workload.hangMs");
		const lingerAfterResultMs =
			workload.lingerAfterResultMs === undefined
				? undefined
				: integer(workload.lingerAfterResultMs, "workload.lingerAfterResultMs");
		return {
			version: protocolVersion,
			type: "synthetic",
			requestId,
			workload: {
				spinMs: integer(workload.spinMs, "workload.spinMs"),
				allocateBytes: integer(workload.allocateBytes, "workload.allocateBytes"),
				...(hangMs === undefined ? {} : { hangMs }),
				...(lingerAfterResultMs === undefined ? {} : { lingerAfterResultMs }),
			},
		};
	}
	throw new Error(`unknown spawn-worker request type: ${String(input.type)}`);
}

function decodeRegistryRef(
	value: unknown,
	label: string,
	protocolVersion: SpawnWorkerProtocolVersion,
): SpawnWorkerRegistryRef {
	const input = object(value, label);
	const kind = input.kind;
	if (kind !== "main" && kind !== "sub") throw new Error(`${label}.kind is invalid`);
	const status = input.status;
	if (
		status !== "running" &&
		status !== "waiting-provider" &&
		status !== "idle" &&
		status !== "parked" &&
		status !== "aborted"
	) {
		throw new Error(`${label}.status is invalid`);
	}
	if (input.sessionFile !== undefined && input.sessionFile !== null && typeof input.sessionFile !== "string") {
		throw new Error(`${label}.sessionFile must be a string or null`);
	}
	if (protocolVersion === 1 && input.launchGeneration !== undefined) {
		throw new Error(`${label}.launchGeneration requires spawn-worker protocol version 2`);
	}
	const launchGeneration =
		input.launchGeneration === undefined ? undefined : string(input.launchGeneration, `${label}.launchGeneration`);
	return {
		id: string(input.id, `${label}.id`),
		displayName: string(input.displayName, `${label}.displayName`),
		kind,
		status,
		...(typeof input.parentId === "string" ? { parentId: input.parentId } : {}),
		...(input.sessionFile === undefined ? {} : { sessionFile: input.sessionFile as string | null }),
		...(launchGeneration === undefined ? {} : { launchGeneration }),
	};
}

export function decodeSpawnWorkerRecord(value: unknown): SpawnWorkerRecord {
	const input = object(value, "record");
	const protocolVersion = version(input.version);
	const requestId = string(input.requestId, "requestId");
	switch (input.type) {
		case "ready":
			return { version: protocolVersion, type: "ready", requestId, pid: integer(input.pid, "pid", 1) };
		case "phase": {
			const phase = input.phase;
			if (phase !== "decode" && phase !== "setup" && phase !== "run" && phase !== "finalize") {
				throw new Error("phase is invalid");
			}
			return {
				version: protocolVersion,
				type: "phase",
				requestId,
				phase,
				at: integer(input.at, "at"),
			};
		}
		case "registry":
			return {
				version: protocolVersion,
				type: "registry",
				requestId,
				ref: decodeRegistryRef(input.ref, "ref", protocolVersion),
			};
		case "progress":
			return {
				version: protocolVersion,
				type: "progress",
				requestId,
				progress: object(input.progress, "progress") as unknown as AgentProgress,
			};
		case "event":
			return {
				version: protocolVersion,
				type: "event",
				requestId,
				channel: string(input.channel, "channel"),
				payload: input.payload,
			};
		case "result":
			return {
				version: protocolVersion,
				type: "result",
				requestId,
				result: object(input.result, "result") as unknown as SingleResult,
				rssBytes: integer(input.rssBytes, "rssBytes"),
			};
		case "synthetic-result":
			return {
				version: protocolVersion,
				type: "synthetic-result",
				requestId,
				allocatedBytes: integer(input.allocatedBytes, "allocatedBytes"),
				rssBytes: integer(input.rssBytes, "rssBytes"),
			};
		case "error": {
			const code = input.code;
			if (
				code !== "protocol" &&
				code !== "spawn" &&
				code !== "exit" &&
				code !== "timeout" &&
				code !== "memory-watermark" &&
				code !== "aborted"
			)
				throw new Error("error code is invalid");
			return {
				version: protocolVersion,
				type: "error",
				requestId,
				code,
				message: string(input.message, "message"),
			};
		}
		case "yield-written":
			if (protocolVersion !== SPAWN_WORKER_PROTOCOL_VERSION)
				throw new Error("yield-written requires spawn-worker protocol version 2");
			return { version: protocolVersion, type: "yield-written", requestId };
		default:
			throw new Error(`unknown spawn-worker record type: ${String(input.type)}`);
	}
}
