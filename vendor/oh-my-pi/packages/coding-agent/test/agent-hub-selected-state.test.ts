import { describe, expect, it } from "bun:test";
import {
	EMPTY_AGENT_HUB_SELECTED_LIVE_STATE,
	projectAgentHubSelectedState,
	reduceAgentHubSelectedLiveState,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-selected-state";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";


describe("Agent Hub selected state", () => {
	it("reduces typed retry events and sanitizes provider text", () => {
		const retrying = reduceAgentHubSelectedLiveState(
			EMPTY_AGENT_HUB_SELECTED_LIVE_STATE,
			{
				type: "auto_retry_start",
				cause: "rate-limit",
				attempt: 2,
				maxAttempts: 4,
				delayMs: 1_500,
				errorMessage: "rate\tlimit\nfrom upstream",
			} as AgentSessionEvent,
		);
		expect(retrying.retry).toEqual({
			cause: "rate-limit",
			attempt: 2,
			maxAttempts: 4,
			delayMs: 1_500,
			error: "rate limit from upstream",
		});

		const failed = reduceAgentHubSelectedLiveState(
			retrying,
			{ type: "auto_retry_end", success: false, attempt: 2, finalError: "quota\nexhausted" } as AgentSessionEvent,
		);
		expect(failed).toEqual({ error: { text: "quota exhausted", source: "retry" } });
	});

	it("renders network, rate-limit, and provider retry causes distinctly", () => {
		const cases = [
			{ cause: "network" as const, text: "provider unreachable (network/DNS), retrying 2s" },
			{ cause: "rate-limit" as const, text: "rate limited · retrying 2/4" },
			{ cause: "provider" as const, text: "provider error · retrying 2/4" },
		];

		for (const retryCase of cases) {
			const items = projectAgentHubSelectedState({
				live: {
					retry: {
						cause: retryCase.cause,
						attempt: 2,
						maxAttempts: 4,
						delayMs: retryCase.cause === "network" ? 2_000 : 1_500,
						error: "retry later",
					},
				},
			});
			expect(items).toContainEqual({ kind: "activity", text: retryCase.text, detail: "retry later" });
		}
	});

	it("orders error, needs-input, rollout, and current activity without text inference", () => {
		const items = projectAgentHubSelectedState({
			external: { state: "waiting_input", sessionId: "workspace:worker" },
			live: {
				error: { text: "provider failed", source: "provider" },
				retry: { cause: "provider", attempt: 1, maxAttempts: 3, delayMs: 500, error: "retry later" },
			},
			rollout: {
				rolloutId: "rollout-1",
				targetDigest: "1234567890abcdef",
				targetVersion: "2.0.0",
				sessionId: "workspace:worker",
				name: "Worker",
				phase: "acknowledged",
				updatedAt: "2026-07-14T00:00:00.000Z",
			},
		});

		expect(items).toEqual([
			{ kind: "error", text: "error", detail: "provider failed" },
			{ kind: "needs-input", text: "waiting for input", detail: "workspace:worker" },
			{ kind: "rollout", text: "restart acknowledged", detail: "2.0.0 (1234567890ab)" },
			{ kind: "activity", text: "provider error · retrying 1/3", detail: "retry later" },
		]);
	});

	it("projects a failed rollout once as the selected error", () => {
		const items = projectAgentHubSelectedState({
			live: EMPTY_AGENT_HUB_SELECTED_LIVE_STATE,
			rollout: {
				rolloutId: "rollout-2",
				targetDigest: "fedcba0987654321",
				targetVersion: "2.0.0",
				sessionId: "worker",
				name: "Worker",
				phase: "failed",
				error: "recovery timeout",
				updatedAt: "2026-07-14T00:00:00.000Z",
			},
		});

		expect(items).toEqual([{ kind: "error", text: "rollout failed", detail: "recovery timeout" }]);
	});
});
