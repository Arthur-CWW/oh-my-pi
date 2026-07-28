import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { elideOldestImagePayloads, estimateTokens } from "@oh-my-pi/pi-agent-core/compaction";
import type { RequestFailureCause } from "@oh-my-pi/pi-ai";

export const MAX_OVERSIZED_PROMPT_COMPACTIONS = 2;

export interface OversizedPromptRecoveryAttempt {
	attempt: number;
	maxAttempts: number;
	providerTokens?: number;
	providerCountDidNotShrink: boolean;
	cause: Extract<RequestFailureCause, "provider-error">;
	disposition: "retrying" | "gave-up";
}

function parseProviderPromptTokens(errorMessage: string): number | undefined {
	const match = /prompt is too long:\s*([\d,]+)\s*tokens/i.exec(errorMessage);
	if (!match?.[1]) return undefined;
	const parsed = Number(match[1].replaceAll(",", ""));
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Per-turn guard for provider-reported oversized-prompt recovery. */
export class OversizedPromptRecoveryGuard {
	#generation: number | undefined;
	#attempt = 0;
	#lastProviderTokens: number | undefined;

	record(generation: number, errorMessage: string): OversizedPromptRecoveryAttempt {
		if (generation !== this.#generation) {
			this.#generation = generation;
			this.#attempt = 0;
			this.#lastProviderTokens = undefined;
		}
		this.#attempt++;
		const providerTokens = parseProviderPromptTokens(errorMessage);
		const providerCountDidNotShrink =
			providerTokens !== undefined &&
			this.#lastProviderTokens !== undefined &&
			providerTokens >= this.#lastProviderTokens;
		this.#lastProviderTokens = providerTokens ?? this.#lastProviderTokens;
		return {
			attempt: this.#attempt,
			maxAttempts: MAX_OVERSIZED_PROMPT_COMPACTIONS,
			providerTokens,
			providerCountDidNotShrink,
			cause: "provider-error",
			disposition: this.#attempt >= MAX_OVERSIZED_PROMPT_COMPACTIONS ? "gave-up" : "retrying",
		};
	}

	reset(): void {
		this.#generation = undefined;
		this.#attempt = 0;
		this.#lastProviderTokens = undefined;
	}
}

export interface OversizedPromptRecoveryOptions {
	guard: OversizedPromptRecoveryGuard;
	generation: number;
	errorMessage: string;
	contextWindow: number;
	threshold: number;
	autoContinue: boolean;
	getMessages: () => AgentMessage[];
	replaceMessages: (messages: AgentMessage[]) => void;
	compact: () => Promise<void>;
	emit: (
		event:
			| {
					type: "auto_retry_start";
					cause: "provider";
					attempt: number;
					maxAttempts: number;
					delayMs: number;
					errorMessage: string;
			  }
			| { type: "auto_retry_end"; success: false; attempt: number; finalError: string },
	) => Promise<void>;
	notice: (message: string) => void;
	scheduleRetry: () => void;
}

/** Compact, emergency-elide images, then either retry once or fail closed. */
export async function recoverOversizedPrompt(options: OversizedPromptRecoveryOptions): Promise<void> {
	const recovery = options.guard.record(options.generation, options.errorMessage);
	await options.emit({
		type: "auto_retry_start",
		cause: "provider",
		attempt: recovery.attempt,
		maxAttempts: recovery.maxAttempts,
		delayMs: 100,
		errorMessage: options.errorMessage,
	});
	const estimateContext = (): number =>
		options.getMessages().reduce((sum, message) => sum + estimateTokens(message), 0);
	const beforeTokens = estimateContext();
	await options.compact();
	let afterTokens = estimateContext();
	if (
		recovery.providerCountDidNotShrink ||
		afterTokens >= beforeTokens ||
		afterTokens > options.threshold
	) {
		const target = recovery.providerCountDidNotShrink || afterTokens >= beforeTokens ? 0 : options.threshold;
		const emergency = elideOldestImagePayloads(options.getMessages(), target);
		if (emergency.elidedCount > 0) {
			options.replaceMessages(emergency.messages);
			afterTokens = emergency.tokensAfter;
		}
	}
	const gaveUp =
		recovery.disposition === "gave-up" ||
		afterTokens >= beforeTokens ||
		(options.contextWindow > 0 && afterTokens > options.threshold);
	if (gaveUp) {
		const message =
			`Oversized prompt recovery gave up after ${recovery.attempt} compaction attempt` +
			`${recovery.attempt === 1 ? "" : "s"}; refusing an identical provider retry.`;
		await options.emit({ type: "auto_retry_end", success: false, attempt: recovery.attempt, finalError: message });
		options.notice(message);
		return;
	}
	if (options.autoContinue) options.scheduleRetry();
}
