import { describe, expect, it } from "bun:test";
import {
	DEFAULT_SEMANTIC_REFUSAL_MODEL,
	DEFAULT_SEMANTIC_REFUSAL_SMOL_MODEL,
	decideSemanticRefusalRecovery,
	type SemanticRefusalRecoveryInput,
} from "@oh-my-pi/pi-coding-agent/session/refusal-reroute-policy";

const base: SemanticRefusalRecoveryInput = {
	enabled: true,
	provider: "anthropic",
	model: "claude-fable-5",
	stopType: "refusal",
	responsibility: "implementer",
	exemptResponsibilities: ["designer"],
	smolResponsibilities: ["quick_task"],
	attemptedThisTurn: false,
	completedRecoveries: 0,
	maxTotalRecoveries: 3,
};

describe("semantic refusal recovery policy", () => {
	it("routes decoded Fable refusal to Sol without inspecting content", () => {
		expect(decideSemanticRefusalRecovery(base)).toEqual({
			recover: true,
			fallbackModel: DEFAULT_SEMANTIC_REFUSAL_MODEL,
		});
	});

	it("uses Luna for the configured smol responsibility", () => {
		expect(decideSemanticRefusalRecovery({ ...base, responsibility: "quick_task" })).toEqual({
			recover: true,
			fallbackModel: DEFAULT_SEMANTIC_REFUSAL_SMOL_MODEL,
		});
	});

	it("exempts the typed UI/UX responsibility", () => {
		expect(decideSemanticRefusalRecovery({ ...base, responsibility: "designer" })).toEqual({
			recover: false,
			reason: "role-exempt",
		});
	});

	it("allows at most one automatic fallback per turn and a bounded session total", () => {
		expect(decideSemanticRefusalRecovery({ ...base, attemptedThisTurn: true })).toEqual({
			recover: false,
			reason: "already-attempted",
		});
		expect(decideSemanticRefusalRecovery({ ...base, completedRecoveries: 3 })).toEqual({
			recover: false,
			reason: "session-limit",
		});
	});

	it("does not consume non-Fable or ordinary provider failures", () => {
		expect(decideSemanticRefusalRecovery({ ...base, provider: "openai-codex" }).recover).toBe(false);
		expect(decideSemanticRefusalRecovery({ ...base, stopType: "error" }).recover).toBe(false);
	});
});
