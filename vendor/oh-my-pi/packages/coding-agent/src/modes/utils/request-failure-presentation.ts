import {
	classifyRequestFailure,
	type RequestFailureCause,
	type RetryCause,
	requestFailureCauseFromRetryCause,
	type AssistantMessage,
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

export function buildRequestFailureDiagnostic(
	message: AssistantMessage,
	owner: RequestFailureOwner,
	disposition: RequestFailureDisposition,
	retryCause?: RetryCause,
): DiagnosticEventInput {
	const detail = message.errorMessage ?? "Provider returned no error detail";
	const classifiedCause = classifyRequestFailure({ message: detail, status: message.errorStatus });
	const cause =
		retryCause && classifiedCause === "provider-error"
			? requestFailureCauseFromRetryCause(retryCause)
			: classifiedCause;
	return {
		message: formatRequestFailureHeadline(message, cause, disposition),
		detail,
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
	const cause = classifyRequestFailure({ message: message.errorMessage, status: message.errorStatus });
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
		const cause = classifyRequestFailure(rawDetail);
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
		);
		pending.message.errorMessage = `${diagnostic.message}\nDetail: ${pending.rawDetail}`;
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
