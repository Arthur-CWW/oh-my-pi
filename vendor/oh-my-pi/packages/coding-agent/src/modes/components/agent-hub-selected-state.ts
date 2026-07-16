import { formatAge, formatDuration } from "@oh-my-pi/pi-utils";
import type { IrcExternalPeerDisplayState } from "../../irc/bus-external";
import type { AgentRef } from "../../registry/agent-ref";
import type { AgentSessionEvent } from "../../session/agent-session";
import { replaceTabs, truncateToWidth } from "../../tools/render-utils";
import type { ObservableSession } from "../session-observer-registry";
import { theme } from "../theme/theme";
import type { AgentHubRolloutSnapshot } from "./agent-hub-rollout-state";

const SUMMARY_TEXT_LIMIT = 512;
const DETAIL_TEXT_LIMIT = 768;

/** Typed admission projection supplied by the queue owner; never inferred from transcript text. */
export interface AgentHubTurnStatus {
	inputId: string;
	state: "queued" | "admitted" | "running" | "completed" | "failed-rate-limit" | "cancelled";
	resetAt?: number;
	reroutedProvider?: string;
	originalModel?: string;
	reroutedModel?: string;
	canCancel: boolean;
	ratePerHour?: number;
	projectedEmptyAt?: number;
	deficitPerHour?: number;
	provider?: string;
	decisionReason?: string;
	quotaPoolId?: string;
	limitWindowId?: string;
}

export interface AgentHubSelectedLiveState {
	readonly retry?: {
		readonly cause: "network" | "rate-limit" | "provider";
		readonly attempt: number;
		readonly maxAttempts: number;
		readonly delayMs: number;
		readonly error: string;
	};
	readonly fallbackApproval?: {
		readonly sourceModel: string;
		readonly proposedModel: string;
		readonly cause: "network" | "rate-limit" | "provider";
		readonly taskContext: string;
	};
	readonly error?: {
		readonly text: string;
		readonly source: "provider" | "notice" | "retry" | "maintenance";
	};
}

export type AgentHubSelectedStateKind = "error" | "needs-input" | "rollout" | "activity";

export interface AgentHubSelectedStateItem {
	readonly kind: AgentHubSelectedStateKind;
	readonly text: string;
	readonly detail?: string;
}

export interface AgentHubSelectedStateInput {
	readonly ref?: AgentRef;
	readonly observed?: ObservableSession;
	readonly external?: {
		readonly state: IrcExternalPeerDisplayState;
		readonly sessionId: string;
		readonly buildDigest?: string;
		readonly version?: string;
	};
	readonly turnStatus?: AgentHubTurnStatus;
	readonly live: AgentHubSelectedLiveState;
	readonly rollout?: AgentHubRolloutSnapshot;
}

export const EMPTY_AGENT_HUB_SELECTED_LIVE_STATE: AgentHubSelectedLiveState = Object.freeze({});

function sanitizeText(text: string, limit: number): string {
	return replaceTabs(text)
		.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, limit);
}

function liveErrorFromEvent(event: AgentSessionEvent): AgentHubSelectedLiveState["error"] | undefined {
	if (event.type === "notice" && event.level === "error") {
		return { text: sanitizeText(event.message, DETAIL_TEXT_LIMIT), source: "notice" };
	}
	if (event.type === "auto_compaction_end" && event.errorMessage && !event.skipped) {
		return { text: sanitizeText(event.errorMessage, DETAIL_TEXT_LIMIT), source: "maintenance" };
	}
	if (
		event.type === "message_end" &&
		event.message.role === "assistant" &&
		event.message.stopReason === "error" &&
		event.message.errorMessage
	) {
		return { text: sanitizeText(event.message.errorMessage, DETAIL_TEXT_LIMIT), source: "provider" };
	}
	return undefined;
}

/** Reduce only typed session events; persisted transcript entries remain the durable error record. */
export function reduceAgentHubSelectedLiveState(
	state: AgentHubSelectedLiveState,
	event: AgentSessionEvent,
): AgentHubSelectedLiveState {
	if (event.type === "agent_start") return EMPTY_AGENT_HUB_SELECTED_LIVE_STATE;
	if (event.type === "retry_fallback_approval_requested") {
		return {
			...state,
			fallbackApproval: {
				sourceModel: event.proposal.sourceModel,
				proposedModel: event.proposal.proposedModel,
				cause: event.proposal.cause,
				taskContext: sanitizeText(event.proposal.taskContext, DETAIL_TEXT_LIMIT),
			},
		};
	}
	if (event.type === "retry_fallback_approval_resolved") {
		const { fallbackApproval: _resolved, ...remaining } = state;
		return remaining;
	}
	if (event.type === "auto_retry_start") {
		return {
			retry: {
				cause: event.cause,
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				delayMs: event.delayMs,
				error: sanitizeText(event.errorMessage, DETAIL_TEXT_LIMIT),
			},
			...(state.error?.source === "retry" ? {} : { error: state.error }),
		};
	}
	if (event.type === "auto_retry_end") {
		if (event.success) return state.error?.source === "retry" ? EMPTY_AGENT_HUB_SELECTED_LIVE_STATE : { error: state.error };
		return {
			error: {
				text: sanitizeText(event.finalError ?? `Retry ${event.attempt} failed`, DETAIL_TEXT_LIMIT),
				source: "retry",
			},
		};
	}
	const error = liveErrorFromEvent(event);
	if (error) return { ...state, error };
	return state;
}

function rolloutDetail(snapshot: AgentHubRolloutSnapshot, reason?: string): string {
	const target = snapshot.targetVersion
		? `${snapshot.targetVersion} (${snapshot.targetDigest.slice(0, 12)})`
		: snapshot.targetDigest.slice(0, 12);
	const updatedAt = Date.parse(snapshot.updatedAt);
	const age = Number.isFinite(updatedAt)
		? formatAge(Math.max(1, Math.round((Date.now() - updatedAt) / 1000)))
		: "age unknown";
	return sanitizeText([target, age, reason].filter(Boolean).join(" · "), DETAIL_TEXT_LIMIT);
}

function rolloutLabel(snapshot: AgentHubRolloutSnapshot): AgentHubSelectedStateItem | undefined {
	switch (snapshot.phase) {
		case "planned":
			return { kind: "rollout", text: "rollout planned", detail: rolloutDetail(snapshot) };
		case "requested":
			return { kind: "rollout", text: "restart requested", detail: rolloutDetail(snapshot) };
		case "acknowledged":
			return { kind: "rollout", text: "restart acknowledged", detail: rolloutDetail(snapshot) };
		case "applied":
			return { kind: "rollout", text: "restart applied", detail: rolloutDetail(snapshot, "awaiting recovery") };
		case "recovered":
			return { kind: "rollout", text: "rollout recovered", detail: rolloutDetail(snapshot) };
		case "skipped":
			return { kind: "rollout", text: "rollout skipped", detail: rolloutDetail(snapshot, snapshot.reason) };
		case "failed":
			return undefined;
	}
}

function activeRetry(input: AgentHubSelectedStateInput): AgentHubSelectedLiveState["retry"] | undefined {
	if (input.live.retry) return input.live.retry;
	const retry = input.observed?.progress?.retryState;
	return retry
		? {
				cause: retry.cause,
				attempt: retry.attempt,
				maxAttempts: retry.maxAttempts,
				delayMs: retry.delayMs,
				error: retry.errorMessage,
			}
		: undefined;
}

function retryCauseLabel(cause: NonNullable<AgentHubSelectedLiveState["retry"]>["cause"]): string {
	switch (cause) {
		case "network":
			return "network/DNS";
		case "rate-limit":
			return "rate limited";
		case "provider":
			return "provider error";
	}
}

function activityItem(input: AgentHubSelectedStateInput): AgentHubSelectedStateItem | undefined {
	const retry = activeRetry(input);
	if (retry) {
		return {
			kind: "activity",
			text:
				retry.cause === "network"
					? `provider unreachable (network/DNS), retrying ${Math.max(0, Math.round(retry.delayMs / 1000))}s`
					: `${retryCauseLabel(retry.cause)} · retrying ${retry.attempt}/${retry.maxAttempts}`,
			detail: sanitizeText(retry.error, DETAIL_TEXT_LIMIT),
		};
	}
	const refActivity = input.ref?.activity && sanitizeText(input.ref.activity, SUMMARY_TEXT_LIMIT);
	if (refActivity) return { kind: "activity", text: refActivity };
	const progress = input.observed?.progress;
	const intent = progress?.lastIntent && sanitizeText(progress.lastIntent, SUMMARY_TEXT_LIMIT);
	if (intent) return { kind: "activity", text: intent };
	if (progress?.currentTool) {
		const elapsed = progress.currentToolStartMs
			? ` · ${formatDuration(Math.max(0, Date.now() - progress.currentToolStartMs))}`
			: "";
		return { kind: "activity", text: `${sanitizeText(progress.currentTool, 96)}${elapsed}` };
	}
	const description = input.observed?.description ?? progress?.task;
	if (description) return { kind: "activity", text: sanitizeText(description, SUMMARY_TEXT_LIMIT) };
	if (input.turnStatus && input.turnStatus.state !== "completed") {
		return {
			kind: "activity",
			text: input.turnStatus.state,
			detail: input.turnStatus.decisionReason
				? sanitizeText(input.turnStatus.decisionReason, DETAIL_TEXT_LIMIT)
				: undefined,
		};
	}
	return undefined;
}

/** Project ordered summaries without inferring needs-input or rollout from local/build state. */
export function projectAgentHubSelectedState(input: AgentHubSelectedStateInput): AgentHubSelectedStateItem[] {
	const items: AgentHubSelectedStateItem[] = [];
	const retryFailure = input.observed?.progress?.retryFailure;
	const rolloutFailed = input.rollout?.phase === "failed";
	const hasTypedError = input.live.error !== undefined || retryFailure !== undefined || rolloutFailed;
	const errorText =
		input.live.error?.text ??
		retryFailure?.errorMessage ??
		(rolloutFailed ? rolloutDetail(input.rollout!, input.rollout?.error ?? input.rollout?.reason) : undefined);
	if (hasTypedError) {
		const detail = errorText ? sanitizeText(errorText, DETAIL_TEXT_LIMIT) : undefined;
		items.push({
			kind: "error",
			text: rolloutFailed && !input.live.error && !retryFailure ? "rollout failed" : "error",
			...(detail ? { detail } : {}),
		});
	} else if (input.turnStatus?.state === "failed-rate-limit") {
		items.push({
			kind: "error",
			text: "rate limit failed",
			detail: input.turnStatus.decisionReason
				? sanitizeText(input.turnStatus.decisionReason, DETAIL_TEXT_LIMIT)
				: undefined,
		});
	} else if (input.observed?.status === "failed") {
		items.push({ kind: "error", text: "session failed" });
	}

	if (input.external?.state === "waiting_input") {
		items.push({
			kind: "needs-input",
			text: "waiting for input",
			detail: sanitizeText(input.external.sessionId, DETAIL_TEXT_LIMIT),
		});
	}

	if (input.live.fallbackApproval) {
		const approval = input.live.fallbackApproval;
		items.push({
			kind: "needs-input",
			text: `fallback approval: ${approval.sourceModel} -> ${approval.proposedModel} (${approval.cause})`,
			detail: `wait/retry with timeout · approve proposed · choose explicit model · abort · ${approval.taskContext}`,
		});
	}

	if (input.rollout) {
		const rollout = rolloutLabel(input.rollout);
		if (rollout) items.push(rollout);
	}

	const activity = activityItem(input);
	if (activity) items.push(activity);
	return items;
}

export function renderAgentHubSelectedState(items: readonly AgentHubSelectedStateItem[], width: number): string[] {
	const maxWidth = Math.max(1, width);
	return items.map(item => {
		const text = sanitizeText(item.text, SUMMARY_TEXT_LIMIT);
		const detail = item.detail ? sanitizeText(item.detail, DETAIL_TEXT_LIMIT) : undefined;
		const line = truncateToWidth(detail ? `${text} · ${detail}` : text, maxWidth);
		switch (item.kind) {
			case "error":
				return theme.fg("error", line);
			case "needs-input":
				return theme.fg("warning", line);
			case "rollout":
				return theme.fg("accent", line);
			case "activity":
				return theme.fg("dim", line);
		}
	});
}

export function formatAgentHubTurnStatus(status: AgentHubTurnStatus, width: number): string {
	const details = [
		status.provider ? `provider:${sanitizeText(status.provider, 24)}` : undefined,
		status.reroutedProvider ? `rerouted:${sanitizeText(status.reroutedProvider, 24)}` : undefined,
		status.originalModel ? `model:${sanitizeText(status.originalModel, 24)}` : undefined,
		status.reroutedModel ? `rerouted-model:${sanitizeText(status.reroutedModel, 24)}` : undefined,
		status.ratePerHour !== undefined ? `rate:${status.ratePerHour}/h` : undefined,
		status.projectedEmptyAt ? `empty:${new Date(status.projectedEmptyAt).toLocaleTimeString()}` : undefined,
		status.resetAt ? `reset:${new Date(status.resetAt).toLocaleTimeString()}` : undefined,
		status.deficitPerHour !== undefined ? `deficit:${status.deficitPerHour}/h` : undefined,
		status.decisionReason ? `reason:${sanitizeText(status.decisionReason, 32)}` : undefined,
		status.quotaPoolId ? `pool:${sanitizeText(status.quotaPoolId, 16)}` : undefined,
		status.limitWindowId ? `window:${sanitizeText(status.limitWindowId, 16)}` : undefined,
		status.canCancel ? "cancellable" : undefined,
	].filter((detail): detail is string => detail !== undefined);
	const line = truncateToWidth(`${status.state}${details.length ? ` · ${details.join(" · ")}` : ""}`, Math.max(1, width));
	const color = status.state === "failed-rate-limit" ? "error" : status.state === "cancelled" ? "warning" : "accent";
	return theme.fg(color, line);
}

export function projectAgentHubRowActivity(ref: AgentRef, observed: ObservableSession | undefined): string | undefined {
	const progress = observed?.progress;
	if (progress?.retryState) {
		return `${retryCauseLabel(progress.retryState.cause)} · retrying ${progress.retryState.attempt}/${progress.retryState.maxAttempts}`;
	}
	const activity = ref.activity && sanitizeText(ref.activity, SUMMARY_TEXT_LIMIT);
	if (activity) return activity;
	const intent = progress?.lastIntent && sanitizeText(progress.lastIntent, SUMMARY_TEXT_LIMIT);
	if (intent) return intent;
	if (progress?.currentTool) {
		const elapsed = progress.currentToolStartMs
			? ` · ${formatDuration(Math.max(0, Date.now() - progress.currentToolStartMs))}`
			: "";
		return `${sanitizeText(progress.currentTool, 96)}${elapsed}`;
	}
	const description = observed?.description ?? progress?.task;
	return description ? sanitizeText(description, SUMMARY_TEXT_LIMIT) : undefined;
}
