export type AgentHubFoldSequenceAction =
	| { readonly kind: "unhandled" }
	| { readonly kind: "pending" }
	| { readonly kind: "cancelled" }
	| { readonly kind: "toggle"; readonly agentId: string };

/**
 * Vim-style `za` prefix state for Agent Hub tree folding.
 *
 * The selected identity is captured when `z` is received so a roster refresh
 * between the two keys cannot redirect the fold to another row.
 */
export class AgentHubFoldSequence {
	#agentId: string | undefined;
	#pending = false;

	handle(keyData: string, selectedAgentId: string | undefined, dismiss: boolean): AgentHubFoldSequenceAction {
		if (!this.#pending) {
			if (keyData !== "z") return { kind: "unhandled" };
			this.#pending = true;
			this.#agentId = selectedAgentId;
			return { kind: "pending" };
		}

		const agentId = this.#agentId;
		this.reset();
		if (dismiss || keyData !== "a" || !agentId) return { kind: "cancelled" };
		return { kind: "toggle", agentId };
	}

	reset(): void {
		this.#pending = false;
		this.#agentId = undefined;
	}
}
