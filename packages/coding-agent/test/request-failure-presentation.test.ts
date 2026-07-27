import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import {
	buildRequestFailureDiagnostic,
	shouldAwaitRetryDisposition,
} from "@oh-my-pi/pi-coding-agent/modes/utils/request-failure-presentation";

const EMPTY_USAGE: AssistantMessage["usage"] = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function errorMessage(overrides: Partial<AssistantMessage>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-test",
		usage: EMPTY_USAGE,
		stopReason: "error",
		timestamp: 1,
		...overrides,
	};
}

const OWNER = { agent: "Main", session: "diagnostic-test" };

describe("request failure presentation", () => {
	it("maps categorized classifier refusals to an actionable non-retryable diagnosis", () => {
		const message = errorMessage({
			stopDetails: { type: "refusal", category: "policy", explanation: "Request declined." },
			errorMessage: "Refusal (policy): Request declined.",
		});

		const diagnostic = buildRequestFailureDiagnostic(message, OWNER, { kind: "gave-up", attempt: 1 }, undefined, [
			"IRC message from ResearchAgent at 2026-07-26T00:00:00.000Z",
		]);

		expect(diagnostic).toMatchObject({
			message:
				'anthropic/claude-test request refused by provider-side content classifier (category "policy") — non-retryable',
			cause: "provider-error",
			category: "classifier-refusal",
			disposition: "non-retryable",
			retry: false,
		});
		expect(diagnostic.detail).toContain("accumulated context, not necessarily the current turn");
		expect(diagnostic.detail).toContain("Retrying or changing the thinking level will not clear it");
		expect(diagnostic.detail).toContain("IRC messages, tool output, or file reads");
		expect(diagnostic.detail).toContain("Start a fresh session");
		expect(diagnostic.detail).toContain("model from a different provider");
		expect(diagnostic.detail).toContain("IRC message from ResearchAgent");
		expect(shouldAwaitRetryDisposition(message)).toBe(false);
	});

	it("keeps transient provider failures on the normal retry path", () => {
		const message = errorMessage({ errorMessage: "fetch failed: ENOTFOUND provider.example" });
		const diagnostic = buildRequestFailureDiagnostic(
			message,
			OWNER,
			{ kind: "retrying", attempt: 1, maxAttempts: 3, delayMs: 1_000 },
			"network",
		);

		expect(diagnostic).toMatchObject({
			message: "anthropic/claude-test network request failed (network) — retrying 1/3 in 1s",
			cause: "network",
			category: "request-failure",
			disposition: "retrying 1/3 in 1s",
			retry: true,
		});
		expect(shouldAwaitRetryDisposition(message)).toBe(true);
	});
});
