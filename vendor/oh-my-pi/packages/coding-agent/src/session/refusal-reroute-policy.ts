export const DEFAULT_SEMANTIC_REFUSAL_MODEL = "openai-codex/gpt-5.6-sol" as const;
export const DEFAULT_SEMANTIC_REFUSAL_SMOL_MODEL = "openai-codex/gpt-5.6-luna" as const;

export interface SemanticRefusalRecoveryInput {
	readonly enabled: boolean;
	readonly provider: string | undefined;
	readonly model: string | undefined;
	readonly stopType: string | undefined;
	readonly responsibility: string | undefined;
	readonly exemptResponsibilities: readonly string[];
	readonly smolResponsibilities: readonly string[];
	readonly attemptedThisTurn: boolean;
	readonly completedRecoveries: number;
	readonly maxTotalRecoveries: number;
	readonly fallbackModel?: string;
	readonly smolFallbackModel?: string;
}

export type SemanticRefusalRecoveryDecision =
	| { readonly recover: true; readonly fallbackModel: string }
	| {
			readonly recover: false;
			readonly reason:
				| "disabled"
				| "not-fable"
				| "not-semantic-refusal"
				| "role-exempt"
				| "already-attempted"
				| "session-limit";
	  };

/**
 * Automatic recovery is deliberately narrow: decoded semantic refusals from
 * Anthropic Fable only. It does not inspect prompt or provider error text, so
 * content can never leak into policy, notifications, or retry context.
 */
export function decideSemanticRefusalRecovery(
	input: SemanticRefusalRecoveryInput,
): SemanticRefusalRecoveryDecision {
	if (!input.enabled) return { recover: false, reason: "disabled" };
	if (input.provider !== "anthropic" || !input.model?.toLowerCase().includes("fable")) {
		return { recover: false, reason: "not-fable" };
	}
	if (input.stopType !== "refusal" && input.stopType !== "sensitive") {
		return { recover: false, reason: "not-semantic-refusal" };
	}
	if (input.responsibility && input.exemptResponsibilities.includes(input.responsibility)) {
		return { recover: false, reason: "role-exempt" };
	}
	if (input.attemptedThisTurn) return { recover: false, reason: "already-attempted" };
	if (input.completedRecoveries >= input.maxTotalRecoveries) {
		return { recover: false, reason: "session-limit" };
	}
	const useSmol = input.responsibility !== undefined && input.smolResponsibilities.includes(input.responsibility);
	return {
		recover: true,
		fallbackModel: useSmol
			? (input.smolFallbackModel?.trim() || DEFAULT_SEMANTIC_REFUSAL_SMOL_MODEL)
			: (input.fallbackModel?.trim() || DEFAULT_SEMANTIC_REFUSAL_MODEL),
	};
}
