import { describe, expect, it } from "bun:test";
import {
	MAX_OVERSIZED_PROMPT_COMPACTIONS,
	OversizedPromptRecoveryGuard,
} from "../src/session/oversized-prompt-recovery";

describe("oversized prompt recovery guard", () => {
	it("gives up with typed provider failure after at most two compactions", () => {
		const guard = new OversizedPromptRecoveryGuard();
		const first = guard.record(7, "400 invalid_request_error: prompt is too long: 1085563 tokens > 1000000");
		expect(first).toMatchObject({
			attempt: 1,
			maxAttempts: MAX_OVERSIZED_PROMPT_COMPACTIONS,
			providerTokens: 1_085_563,
			providerCountDidNotShrink: false,
			cause: "provider-error",
			disposition: "retrying",
		});

		const second = guard.record(7, "400 invalid_request_error: prompt is too long: 1085563 tokens > 1000000");
		expect(second).toMatchObject({
			attempt: 2,
			providerTokens: 1_085_563,
			providerCountDidNotShrink: true,
			cause: "provider-error",
			disposition: "gave-up",
		});
		expect(second.attempt).toBeLessThanOrEqual(2);
	});

	it("resets the cap for a new prompt generation", () => {
		const guard = new OversizedPromptRecoveryGuard();
		guard.record(1, "prompt is too long: 200,000 tokens");
		guard.record(1, "prompt is too long: 190,000 tokens");
		expect(guard.record(2, "prompt is too long: 180,000 tokens").attempt).toBe(1);
	});
});
