import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import {
	type AssistantMessage,
	classifyAbortReason,
	classifyRequestFailure,
	getProviderClassifierRefusalCategory,
	type RequestFailureCause,
	type RetryCause,
	requestFailureCauseFromRetryCause,
} from "@oh-my-pi/pi-ai";
import type { DiagnosticEventInput } from "../../session/error-inbox-ledger";

import type { AssistantMessageComponent } from "../components/assistant-message";
import type { InteractiveModeContext } from "../types";
export type RequestFailureDisposition =
	| { readonly kind: "retrying"; readonly attempt: number; readonly maxAttempts: number; readonly delayMs: number }
	| { readonly kind: "recovered"; readonly attempt: number }
	| { readonly kind: "gave-up"; readonly attempt: number };

export interface RequestFailureOwner {
	readonly agent: string;
	readonly session: string;
}

const CLASSIFIER_REFUSAL_CONTEXT_CANDIDATE_LIMIT = 3;

function recentIrcContextCandidates(messages: readonly AgentMessage[]): string[] {
	const candidates: string[] = [];
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "custom" || message.customType !== "irc:incoming") continue;
		const details = message.details;
		const sender =
			typeof details === "object" &&
			details !== null &&
			"from" in details &&
			typeof details.from === "string" &&
			details.from.length > 0
				? details.from
				: "unknown peer";
		candidates.push(`IRC message from ${sender} at ${new Date(message.timestamp).toISOString()}`);
		if (candidates.length === CLASSIFIER_REFUSAL_CONTEXT_CANDIDATE_LIMIT) break;
	}
	return candidates;
}

function classifierRefusalDetail(category: string, rawDetail: string, contextCandidates: readonly string[]): string {
	const candidates =
		contextCandidates.length > 0
			? ` Recent externally injected context candidates: ${contextCandidates.join("; ")}.`
			: "";
	return (
		`The request was refused by a provider-side content classifier, category "${category}". ` +
		"This is a property of the accumulated context, not necessarily the current turn. " +
		"Retrying or changing the thinking level will not clear it. " +
		"Content injected by other agents through IRC messages, tool output, or file reads is a common cause. " +
		"Start a fresh session, or switch to a model from a different provider if this content must stay in context." +
		candidates +
		` Provider detail: ${rawDetail}`
	);
}

function failureAction(cause: RequestFailureCause): string {
	switch (cause) {
		case "provider-stream-abort":
			return "stream stalled";
		case "timeout":
			return "request timed out";
		case "parent-cancel":
			return "request cancelled by parent";
		case "user-interrupt":
			return "request interrupted";
		case "network":
			return "network request failed";
		case "rate-limit":
			return "request rate limited";
		case "provider-error":
			return "provider request failed";
	}
}

function formatDisposition(disposition: RequestFailureDisposition): string {
	switch (disposition.kind) {
		case "retrying": {
			const seconds = Math.max(0, Math.round(disposition.delayMs / 1000));
			return `retrying ${disposition.attempt}/${disposition.maxAttempts} in ${seconds}s`;
		}
		case "recovered":
			return `recovered on attempt ${disposition.attempt}`;
		case "gave-up":
			return `gave up after ${disposition.attempt}`;
	}
}

export function formatRequestFailureHeadline(
	message: Pick<AssistantMessage, "provider" | "model">,
	cause: RequestFailureCause,
	disposition: RequestFailureDisposition,
): string {
	return `${message.provider}/${message.model} ${failureAction(cause)} (${cause}) — ${formatDisposition(disposition)}`;
}

function classifyAssistantRequestFailure(
	message: AssistantMessage,
	detail = message.errorMessage ?? "Provider returned no error detail",
): RequestFailureCause {
	return classifyRequestFailure({
		failureCause: message.stopReason === "aborted" ? classifyAbortReason(detail) : undefined,
		message: detail,
		status: message.errorStatus,
	});
}

export function buildRequestFailureDiagnostic(
	message: AssistantMessage,
	owner: RequestFailureOwner,
	disposition: RequestFailureDisposition,
	retryCause?: RetryCause,
	contextCandidates: readonly string[] = [],
): DiagnosticEventInput {
	const rawDetail = message.errorMessage ?? "Provider returned no error detail";
	const classifierCategory = getProviderClassifierRefusalCategory(message);
	if (classifierCategory) {
		return {
			message: `${message.provider}/${message.model} request refused by provider-side content classifier (category "${classifierCategory}") — non-retryable`,
			detail: classifierRefusalDetail(classifierCategory, rawDetail, contextCandidates),
			cause: "provider-error",
			disposition: "non-retryable",
			source: "provider",
			category: "classifier-refusal",
			provider: message.provider,
			model: message.model,
			session: owner.session,
			agent: owner.agent,
			operation: "turn",
			status: message.errorStatus,
			code: message.stopDetails?.type,
			retry: false,
		};
	}
	const classifiedCause = classifyAssistantRequestFailure(message, rawDetail);
	const cause =
		retryCause && classifiedCause === "provider-error"
			? requestFailureCauseFromRetryCause(retryCause)
			: classifiedCause;
	return {
		message: formatRequestFailureHeadline(message, cause, disposition),
		detail: rawDetail,
		cause,
		disposition: formatDisposition(disposition),
		source: "provider",
		category: "request-failure",
		provider: message.provider,
		model: message.model,
		session: owner.session,
		agent: owner.agent,
		operation: cause === "provider-stream-abort" ? "stream" : "turn",
		status: message.errorStatus,
		code: message.stopDetails?.type,
		retry: disposition.kind === "retrying",
	};
}

export function shouldAwaitRetryDisposition(message: AssistantMessage): boolean {
	if (message.stopReason !== "error" || !message.errorMessage) return false;
	if (getProviderClassifierRefusalCategory(message)) return false;
	if (
		message.content.some(
			block =>
				block.type === "toolCall" ||
				(block.type === "text" && block.text.length > 0) ||
				(block.type === "thinking" && block.thinking.length > 0) ||
				(block.type === "redactedThinking" && block.data.length > 0),
		)
	)
		return false;
	const cause = classifyAssistantRequestFailure(message);
	return cause === "provider-stream-abort" || cause === "timeout" || cause === "network" || cause === "rate-limit";
}

interface PendingRequestFailure {
	message: AssistantMessage;
	component: AssistantMessageComponent;
	rawDetail: string;
	retryCause?: RetryCause;
}

/** Owns request-failure card state across an automatic retry attempt. */
export class RequestFailurePresenter {
	#pending: PendingRequestFailure | undefined;
	#pinnedComponent: AssistantMessageComponent | undefined;

	constructor(private readonly ctx: InteractiveModeContext) {}

	reset(): void {
		this.#pending = undefined;
		this.#pinnedComponent = undefined;
	}

	handleAgentStart(): void {
		if (this.#pending) return;
		this.#pinnedComponent?.setErrorPinned(false);
		this.#pinnedComponent = undefined;
		this.ctx.clearPinnedError();
	}

	handleMessage(
		message: AssistantMessage,
		component: AssistantMessageComponent,
		retryEnabled: boolean,
		retryAttempt: number,
		rawDetail = message.errorMessage,
	): void {
		if ((message.stopReason !== "error" && message.stopReason !== "aborted") || !rawDetail) return;
		const cause = classifyAssistantRequestFailure(message, rawDetail);
		if (cause === "user-interrupt") return;
		const pending = { message, component, rawDetail };
		if (retryEnabled && shouldAwaitRetryDisposition(message)) {
			component.setErrorPinned(true);
			this.#pending = pending;
			return;
		}
		this.#present(pending, { kind: "gave-up", attempt: Math.max(1, retryAttempt + 1) });
	}

	handleRetryStart(event: { cause: RetryCause; attempt: number; maxAttempts: number; delayMs: number }): void {
		if (!this.#pending) return;
		this.#pending.retryCause = event.cause;
		this.#present(
			this.#pending,
			{ kind: "retrying", attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs },
			event.cause,
		);
	}

	handleRetryEnd(event: { success: boolean; attempt: number; finalError?: string }): boolean {
		const pending = this.#pending;
		if (!pending) return false;
		if (!event.success && event.finalError) pending.rawDetail = event.finalError;
		this.#present(
			pending,
			event.success ? { kind: "recovered", attempt: event.attempt } : { kind: "gave-up", attempt: event.attempt },
			pending.retryCause,
			!event.success,
		);
		this.#pending = undefined;
		return true;
	}

	#present(
		pending: PendingRequestFailure,
		disposition: RequestFailureDisposition,
		retryCause?: RetryCause,
		pin = true,
	): void {
		const diagnostic = buildRequestFailureDiagnostic(
			{ ...pending.message, errorMessage: pending.rawDetail },
			{
				agent: this.ctx.viewSession.getAgentId() ?? "Main",
				session: this.ctx.sessionManager.getSessionName() ?? this.ctx.sessionManager.getSessionId(),
			},
			disposition,
			retryCause,
			recentIrcContextCandidates(this.ctx.viewSession.messages),
		);
		pending.message.errorMessage =
			diagnostic.category === "classifier-refusal"
				? `${diagnostic.message}\n${diagnostic.detail}`
				: `${diagnostic.message}\nDetail: ${pending.rawDetail}`;
		pending.component.updateContent(pending.message);
		pending.component.setErrorPinned(pin);
		if (pin) {
			this.#pinnedComponent = pending.component;
			this.ctx.showPinnedError(diagnostic);
			return;
		}
		if (this.#pinnedComponent === pending.component) this.#pinnedComponent = undefined;
		this.ctx.clearPinnedError();
		this.ctx.errorInbox.recordError(diagnostic);
	}
}
