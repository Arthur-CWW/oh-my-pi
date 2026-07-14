import { isTransientNetworkError } from "@oh-my-pi/pi-ai";
import type { SessionManager } from "../session/session-manager";
import { appendErrorInboxEvent, type ErrorInboxWriter } from "../session/error-inbox-ledger";
import { observeFleetIncidentFailure } from "./fleet-incident-runtime";
import type { AgentProgress, SingleResult } from "./types";

interface ErrorInboxReaderWriter extends ErrorInboxWriter {
	getEntries: SessionManager["getEntries"];
}

export type SubagentFailureClass = "failed" | "timeout" | "budget" | "network" | "provider" | "schema" | "no-yield";

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

function classifySubagentFailure(result: SingleResult): SubagentFailureClass {
	if (result.timeoutPartial) return "timeout";
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
	if (isTransientNetworkError(message)) return "network";
	if (containsFailureMarker(message, ["timeout", "timed out"])) return "timeout";
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
	progress.requests = result?.requests ?? 0;
	progress.contextTokens = result?.contextTokens;
	progress.contextWindow = result?.contextWindow;
	progress.cost = result?.usage?.cost.total ?? 0;
	progress.extractedToolData = result?.extractedToolData;
	progress.retryFailure = result?.retryFailure;
	progress.retryState = undefined;
}
