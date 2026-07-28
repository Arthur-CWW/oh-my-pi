import { isTransientNetworkError } from "@oh-my-pi/pi-ai";
import type { FileEntry } from "../session/session-entries";
import type { SessionManager } from "../session/session-manager";
import { appendErrorInboxEvent, type ErrorInboxWriter } from "../session/error-inbox-ledger";
import { observeFleetIncidentFailure } from "./fleet-incident-runtime";
import type { AgentProgress, SingleResult } from "./types";

interface ErrorInboxReaderWriter extends ErrorInboxWriter {
	getEntries: SessionManager["getEntries"];
}

export type SubagentFailureClass =
	| "failed"
	| "timeout"
	| "budget"
	| "network"
	| "provider"
	| "schema"
	| "no-yield"
	| "host-resource"
	| "subprocess-abort"
	| "lost-transcript";

export interface SubagentFailureInput {
	agent: string;
	job: string;
	operation: string;
	errorClass: SubagentFailureClass;
	message: string;
	historyUri: string;
	finalOutputUri: string;
	finalOutputAvailable: boolean;
	intentionalCancellation?: boolean;
	provider?: string;
	model?: string;
}

export interface DurableSubagentFailureReceipt {
	agent: string;
	job: string;
	errorClass: SubagentFailureClass;
	disposition: "resumable" | "unrecoverable";
	message: string;
	historyUri: string;
	finalOutputAvailable: boolean;
	lastTimestamp: number;
}

export function isResumableSubagentFailureClass(errorClass: SubagentFailureClass): boolean {
	return (
		errorClass === "timeout" ||
		errorClass === "host-resource" ||
		errorClass === "subprocess-abort" ||
		errorClass === "lost-transcript"
	);
}

export function isTransientHostResourceFailure(message: string): boolean {
	return containsFailureMarker(message, [
		"database is locked",
		"sqlite_busy",
		"resource authority unavailable",
		"host resource authority unavailable",
		"resource temporarily unavailable",
		"eagain",
		"ebusy",
	]);
}

/**
 * Marker embedded in every graduated memory-backpressure interrupt message.
 *
 * It is a protocol constant we emit, not a heuristic over foreign error text:
 * a hard-watermark crossing stops the child's turn at a boundary and leaves the
 * journal intact, so the outcome must classify as resumable host pressure
 * rather than an unrecoverable fault.
 */
export const MEMORY_WATERMARK_MARKER = "memory watermark";

export function isMemoryWatermarkInterrupt(message: string | undefined): boolean {
	return containsFailureMarker(message, [MEMORY_WATERMARK_MARKER]);
}

function isSubagentFailureClass(value: unknown): value is SubagentFailureClass {
	return (
		value === "failed" ||
		value === "timeout" ||
		value === "budget" ||
		value === "network" ||
		value === "provider" ||
		value === "schema" ||
		value === "no-yield" ||
		value === "host-resource" ||
		value === "subprocess-abort" ||
		value === "lost-transcript"
	);
}

/** Decode durable parent-journal failure receipts used after the process-local job map is gone. */
export function listDurableSubagentFailureReceipts(entries: readonly FileEntry[]): DurableSubagentFailureReceipt[] {
	const receipts = new Map<string, DurableSubagentFailureReceipt>();
	for (const entry of entries) {
		if (
			entry.type !== "custom" ||
			entry.customType !== "ui_error" ||
			typeof entry.data !== "object" ||
			entry.data === null ||
			Array.isArray(entry.data)
		) {
			continue;
		}
		const data = entry.data as Record<string, unknown>;
		if (
			data.source !== "task" ||
			typeof data.agent !== "string" ||
			data.agent.length === 0 ||
			typeof data.job !== "string" ||
			data.job.length === 0 ||
			!isSubagentFailureClass(data.errorClass) ||
			typeof data.message !== "string"
		) {
			continue;
		}
		const lastTimestamp = typeof data.lastTimestamp === "number" ? data.lastTimestamp : Date.parse(entry.timestamp);
		const receipt: DurableSubagentFailureReceipt = {
			agent: data.agent,
			job: data.job,
			errorClass: data.errorClass,
			disposition:
				data.disposition === "resumable" || isResumableSubagentFailureClass(data.errorClass)
					? "resumable"
					: "unrecoverable",
			message: data.message,
			historyUri: typeof data.historyUri === "string" ? data.historyUri : `history://${data.agent}`,
			finalOutputAvailable: data.finalOutputAvailable === true,
			lastTimestamp: Number.isFinite(lastTimestamp) ? lastTimestamp : 0,
		};
		const previous = receipts.get(receipt.agent);
		if (!previous || receipt.lastTimestamp >= previous.lastTimestamp) receipts.set(receipt.agent, receipt);
	}
	return [...receipts.values()];
}

/** Sentinel for async jobs whose subagent finished with a failing result; progress is already updated. */
export class TaskJobError extends Error {}

const MAX_SUBAGENT_ERROR_MESSAGE = 1_024;
const TOKEN_PATTERN = /\b(?:sk|rk|pk|ghp|gho|ghu|ghs|github_pat|AIza|xox[baprs])[-_A-Za-z0-9=]{12,}\b/g;
const BEARER_PATTERN = /\b(Bearer\s+)[^\s,;]+/gi;
const SECRET_ASSIGNMENT_PATTERN =
	/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)\s*[:=]\s*["']?[^\s,"';]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const PROVIDER_FAILURE_MARKERS = [
	"rate limit",
	"rate-limit",
	"provider",
	"api key",
	"authentication",
	"unauthorized",
	"overloaded",
	"http 429",
	"http 5",
] as const;

function sanitizeSubagentFailureMessage(message: string): string {
	const oneLine = message
		.replace(BEARER_PATTERN, "$1[REDACTED]")
		.replace(SECRET_ASSIGNMENT_PATTERN, "$1=[REDACTED]")
		.replace(JWT_PATTERN, "[REDACTED]")
		.replace(AWS_ACCESS_KEY_PATTERN, "[REDACTED]")
		.replace(TOKEN_PATTERN, "[REDACTED]")
		.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ")
		.trim();
	if (oneLine.length <= MAX_SUBAGENT_ERROR_MESSAGE) return oneLine;
	return `${oneLine.slice(0, MAX_SUBAGENT_ERROR_MESSAGE - 1)}…`;
}

function hasEventId(sessionManager: ErrorInboxReaderWriter, id: string): boolean {
	for (const entry of sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== "ui_error") continue;
		const data = entry.data;
		if (typeof data === "object" && data !== null && "id" in data && data.id === id) return true;
	}
	return false;
}

/**
 * Append one durable task-subagent failure to the caller's ErrorInbox ledger.
 * The deterministic id makes repeated finalization/catch paths idempotent.
 */
export function recordSubagentFailure(
	sessionManager: ErrorInboxReaderWriter,
	input: SubagentFailureInput,
	nowMs = Date.now(),
): boolean {
	if (input.intentionalCancellation) return false;
	const id = `task-subagent:${encodeURIComponent(input.job)}:${encodeURIComponent(input.agent)}`;
	if (hasEventId(sessionManager, id)) return false;
	const message = sanitizeSubagentFailureMessage(input.message) || `Subagent ${input.agent} failed`;
	const appended = appendErrorInboxEvent(sessionManager, {
		id,
		firstTimestamp: nowMs,
		lastTimestamp: nowMs,
		message,
		count: 1,
		source: "task",
		category: input.errorClass,
		errorClass: input.errorClass,
		disposition: isResumableSubagentFailureClass(input.errorClass) ? "resumable" : "unrecoverable",
		provider: input.provider,
		model: input.model,
		agent: input.agent,
		tool: "task",
		job: input.job,
		operation: input.operation,
		status: input.finalOutputAvailable ? "final-output-available" : "final-output-missing",
		code: `subagent_${input.errorClass.replace("-", "_")}`,
		logPointer: input.historyUri,
		historyUri: input.historyUri,
		finalOutputUri: input.finalOutputUri,
		finalOutputAvailable: input.finalOutputAvailable,
		unread: true,
		resolved: false,
	});
	if (appended) {
		observeFleetIncidentFailure({
			evidenceKey: id,
			agent: input.agent,
			job: input.job,
			failureClass: input.errorClass,
			occurredAt: nowMs,
			journalUri: input.historyUri,
			message,
		});
	}
	return appended;
}

function containsFailureMarker(value: string | undefined, markers: readonly string[]): boolean {
	if (!value) return false;
	const normalized = value.toLowerCase();
	return markers.some(marker => normalized.includes(marker));
}

function classifyResultText(result: SingleResult): string {
	return [result.abortReason, result.error, result.stderr, result.retryFailure?.errorMessage]
		.filter((value): value is string => typeof value === "string")
		.join("\n");
}

function classifySubagentFailure(result: SingleResult): SubagentFailureClass {
	const failureText = classifyResultText(result);
	if (result.timeoutPartial) return "timeout";
	// Graduated memory backpressure stops a turn at a boundary with the journal
	// intact, so it is resumable host pressure — never an unrecoverable fault.
	if (isMemoryWatermarkInterrupt(failureText)) return "host-resource";
	if (isTransientHostResourceFailure(failureText)) return "host-resource";
	if (containsFailureMarker(failureText, ["died without terminal journal", "without a terminal journal record"]))
		return "lost-transcript";
	if (containsFailureMarker(failureText, ["subagent subprocess aborted", "subprocess aborted"]))
		return "subprocess-abort";
	if (
		containsFailureMarker(result.abortReason, ["budget"]) ||
		containsFailureMarker(result.error, ["budget"]) ||
		containsFailureMarker(result.stderr, ["budget"])
	) {
		return "budget";
	}
	if (
		containsFailureMarker(result.error, ["schema_violation", "invalid output schema", "schema-retry"]) ||
		containsFailureMarker(result.stderr, ["schema_violation", "invalid output schema", "schema-retry"]) ||
		containsFailureMarker(result.output, ["schema_violation"])
	) {
		return "schema";
	}
	if (
		containsFailureMarker(result.error, ["without calling yield", "missing yield"]) ||
		containsFailureMarker(result.stderr, ["without calling yield", "missing yield"])
	) {
		return "no-yield";
	}
	if (
		(result.error && isTransientNetworkError(result.error)) ||
		(result.retryFailure?.errorMessage && isTransientNetworkError(result.retryFailure.errorMessage)) ||
		(result.stderr && isTransientNetworkError(result.stderr))
	) {
		return "network";
	}
	if (
		result.retryFailure ||
		containsFailureMarker(result.error, PROVIDER_FAILURE_MARKERS) ||
		containsFailureMarker(result.stderr, PROVIDER_FAILURE_MARKERS)
	) {
		return "provider";
	}
	return "failed";
}

function classifyThrownSubagentFailure(message: string): SubagentFailureClass {
	if (isMemoryWatermarkInterrupt(message)) return "host-resource";
	if (isTransientHostResourceFailure(message)) return "host-resource";
	if (containsFailureMarker(message, ["died without terminal journal", "without a terminal journal record"]))
		return "lost-transcript";
	if (containsFailureMarker(message, ["subagent subprocess aborted", "subprocess aborted"])) return "subprocess-abort";
	if (isTransientNetworkError(message)) return "network";
	if (containsFailureMarker(message, ["timeout", "timed out", "subprocess exceeded"])) return "timeout";
	if (containsFailureMarker(message, ["budget"])) return "budget";
	if (containsFailureMarker(message, ["schema_violation", "invalid output schema", "schema-retry"])) return "schema";
	if (containsFailureMarker(message, ["without calling yield", "missing yield"])) return "no-yield";
	if (containsFailureMarker(message, PROVIDER_FAILURE_MARKERS)) return "provider";
	return "failed";
}

/** Persist a failed finalized result before its progress and delivery updates. */
export function recordFinalizedSubagentFailure(
	sessionManager: ErrorInboxReaderWriter | undefined,
	agent: string,
	job: string,
	result: SingleResult | undefined,
	runAborted: boolean,
	childRegistered: boolean,
): boolean {
	const resultFailed = !result || (result.aborted ?? false) || result.exitCode !== 0;
	if (!resultFailed || !sessionManager) return resultFailed;
	const childStarted = result ? result.requests > 0 || childRegistered : childRegistered;
	if (!childStarted) return resultFailed;
	if (!result) {
		recordSubagentFailure(sessionManager, {
			agent,
			job,
			operation: "async-finalize",
			errorClass: "failed",
			message: `Subagent ${agent} failed without a finalized result. Final output artifact is missing; salvage transcript: history://${agent}.`,
			historyUri: `history://${agent}`,
			finalOutputUri: `agent://${agent}`,
			finalOutputAvailable: false,
			intentionalCancellation: runAborted,
		});
		return resultFailed;
	}
	const errorClass = classifySubagentFailure(result);
	const detail = (result.error ?? result.retryFailure?.errorMessage ?? result.abortReason ?? result.stderr)
		.trim()
		.slice(0, 640);
	const finalOutputAvailable = result.outputMeta !== undefined;
	const finalOutputStatus = finalOutputAvailable
		? `Final output: agent://${agent}.`
		: `Final output artifact is missing; salvage transcript: history://${agent}.`;
	const resolvedModel = result.resolvedModel;
	const separator = resolvedModel?.indexOf("/") ?? -1;
	recordSubagentFailure(sessionManager, {
		agent,
		job,
		operation: "async-finalize",
		errorClass,
		message: `Subagent ${agent} failed (${errorClass}).${detail ? ` ${detail}` : ""} ${finalOutputStatus}`,
		historyUri: `history://${agent}`,
		finalOutputUri: `agent://${agent}`,
		finalOutputAvailable,
		intentionalCancellation: runAborted && errorClass !== "timeout" && errorClass !== "budget",
		provider: separator > 0 ? resolvedModel?.slice(0, separator) : undefined,
		model: separator > 0 ? resolvedModel?.slice(separator + 1) : resolvedModel,
	});
	return resultFailed;
}

/** Persist a thrown failure before its progress and delivery updates. */
export function recordThrownSubagentFailure(
	sessionManager: ErrorInboxReaderWriter | undefined,
	agent: string,
	job: string,
	message: string,
	runAborted: boolean,
	childRegistered: boolean,
): boolean {
	if (!sessionManager || !childRegistered) return false;
	const errorClass = classifyThrownSubagentFailure(message);
	return recordSubagentFailure(sessionManager, {
		agent,
		job,
		operation: "async-finalize",
		errorClass,
		message: `Subagent ${agent} failed (${errorClass}). ${message.slice(0, 640)} Final output artifact is missing; salvage transcript: history://${agent}.`,
		historyUri: `history://${agent}`,
		finalOutputUri: `agent://${agent}`,
		finalOutputAvailable: false,
		intentionalCancellation: runAborted,
	});
}

/** Apply a finalized result to the background task progress snapshot. */
export function updateFinalizedSubagentProgress(
	progress: AgentProgress,
	result: SingleResult | undefined,
	resultFailed: boolean,
	startedAt: number,
): void {
	progress.status = result?.aborted ? "aborted" : resultFailed ? "failed" : "completed";
	progress.durationMs = result?.durationMs ?? Math.max(0, Date.now() - startedAt);
	progress.tokens = result?.tokens ?? 0;
	progress.outputTokens = result?.outputTokens;
	progress.requests = result?.requests ?? 0;
	progress.contextTokens = result?.contextTokens;
	progress.contextWindow = result?.contextWindow;
	progress.cost = result?.usage?.cost.total ?? 0;
	progress.extractedToolData = result?.extractedToolData;
	progress.retryFailure = result?.retryFailure;
	progress.retryState = undefined;
}
