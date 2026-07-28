import {
	type AssistantMessage,
	classifyAbortReason,
	classifyRequestFailure,
	type RequestFailureCause,
	type RetryCause,
	requestFailureCauseFromRetryCause,
} from "@oh-my-pi/pi-ai";
import { isRetryableError } from "@oh-my-pi/pi-utils";
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

export const REQUEST_FAILURE_DETAIL_MAX_BYTES = 2 * 1024;
const REDACTED_PROVIDER_SECRET = "[REDACTED]";

const DOUBLE_QUOTED_SECRET_FIELD =
	/((?:"(?:authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret)"|(?:authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret))\s*[:=]\s*)"[^"\r\n]*"/gi;
const SINGLE_QUOTED_SECRET_FIELD =
	/((?:'(?:authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret)'|(?:authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret))\s*[:=]\s*)'[^'\r\n]*'/gi;
const UNQUOTED_SECRET_FIELD =
	/(\b(?:authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret)\b\s*[:=]\s*)(?:(?:bearer|basic)\s+)?[^\s,;}\]]+/gi;
const AUTHORIZATION_CREDENTIAL = /\b(?:bearer|basic)\s+[A-Za-z0-9+/._~=-]+/gi;
const PROVIDER_KEY_LITERAL = /\b(?:sk|pk|rk|tok|key|secret)[-_][A-Za-z0-9._~-]{12,}\b/g;

function utf8ByteLength(codePoint: number): number {
	if (codePoint <= 0x7f) return 1;
	if (codePoint <= 0x7ff) return 2;
	if (codePoint <= 0xffff) return 3;
	return 4;
}

function boundUtf8(text: string, maxBytes: number): string {
	const suffix = "…";
	const contentBudget = maxBytes - 3;
	let bytes = 0;
	let codeUnitEnd = 0;
	let boundedEnd = 0;
	for (const character of text) {
		bytes += utf8ByteLength(character.codePointAt(0) ?? 0);
		codeUnitEnd += character.length;
		if (bytes <= contentBudget) boundedEnd = codeUnitEnd;
		if (bytes > maxBytes) return `${text.slice(0, boundedEnd)}${suffix}`;
	}
	return text;
}

/** Redact transport credentials before bounding provider-controlled failure text. */
export function sanitizeRequestFailureDetail(detail: string): string {
	const redacted = detail
		.toWellFormed()
		.replace(DOUBLE_QUOTED_SECRET_FIELD, `$1"${REDACTED_PROVIDER_SECRET}"`)
		.replace(SINGLE_QUOTED_SECRET_FIELD, `$1'${REDACTED_PROVIDER_SECRET}'`)
		.replace(UNQUOTED_SECRET_FIELD, `$1${REDACTED_PROVIDER_SECRET}`)
		.replace(AUTHORIZATION_CREDENTIAL, REDACTED_PROVIDER_SECRET)
		.replace(PROVIDER_KEY_LITERAL, REDACTED_PROVIDER_SECRET)
		.trim();
	return boundUtf8(redacted, REQUEST_FAILURE_DETAIL_MAX_BYTES);
}

function formatProviderStopDetail(message: AssistantMessage): string | undefined {
	const stopDetails = message.stopDetails;
	if (!stopDetails) return undefined;
	const type = stopDetails.type?.trim();
	const category = stopDetails.category?.trim();
	const explanation = stopDetails.explanation?.trim();
	if (!type && !category && !explanation) return undefined;
	const classification = [type || "unknown", category ? `category=${category}` : undefined].filter(Boolean).join(" ");
	return explanation
		? `Provider stop reason: ${classification} — ${explanation}`
		: `Provider stop reason: ${classification}`;
}

export function extractRequestFailureDetail(message: AssistantMessage, rawDetail = message.errorMessage): string {
	const sdkOrHttpDetail = rawDetail?.trim();
	const stopDetail = formatProviderStopDetail(message);
	if (!sdkOrHttpDetail) return stopDetail ?? "Provider returned no error detail";
	const explanation = message.stopDetails?.explanation?.trim();
	if (stopDetail && explanation && !sdkOrHttpDetail.includes(explanation)) {
		return `${sdkOrHttpDetail}\n${stopDetail}`;
	}
	return sdkOrHttpDetail;
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
		case "auth":
			return "provider authentication failed";
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
	detail = extractRequestFailureDetail(message),
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
): DiagnosticEventInput {
	const rawDetail = extractRequestFailureDetail(message);
	const detail = sanitizeRequestFailureDetail(rawDetail);
	const classifiedCause = classifyAssistantRequestFailure(message, rawDetail);
	const cause =
		retryCause && classifiedCause === "provider-error"
			? requestFailureCauseFromRetryCause(retryCause)
			: classifiedCause;
	const headline = formatRequestFailureHeadline(message, cause, disposition);
	return {
		message: `${headline}\nDetail: ${detail}`,
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
	if (message.stopReason !== "error") return false;
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
	if (cause === "provider-stream-abort" || cause === "timeout" || cause === "network" || cause === "rate-limit") {
		return true;
	}
	return isRetryableError({ message: extractRequestFailureDetail(message), status: message.errorStatus });
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
		if (message.stopReason !== "error" && message.stopReason !== "aborted") return;
		const detail = extractRequestFailureDetail(message, rawDetail);
		const cause = classifyAssistantRequestFailure(message, detail);
		if (cause === "user-interrupt") return;
		const pending = { message, component, rawDetail: detail };
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
		pending.message.errorMessage = diagnostic.message;
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
