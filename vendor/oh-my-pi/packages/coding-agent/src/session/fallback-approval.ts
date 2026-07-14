import type { RetryCause } from "@oh-my-pi/pi-ai";

export type { RetryCause } from "@oh-my-pi/pi-ai";

export interface FallbackApprovalProposal {
	readonly agentId: string;
	readonly parentAgentId: string;
	readonly sourceModel: string;
	readonly proposedModel: string;
	readonly cause: RetryCause;
	readonly taskContext: string;
	readonly requestedAt: number;
}

export type FallbackApprovalAction =
	| { readonly kind: "wait"; readonly timeoutMs: number }
	| { readonly kind: "approve" }
	| { readonly kind: "choose"; readonly model: string }
	| { readonly kind: "abort" };

export interface FallbackApprovalResolution {
	readonly proposal: FallbackApprovalProposal;
	readonly action: FallbackApprovalAction;
}

interface PendingFallbackApproval {
	readonly proposal: FallbackApprovalProposal;
	readonly resolve: (action: FallbackApprovalAction) => Promise<void>;
}

/** Policy boundary shared by the retry machine and focused policy tests. */
export function canRequestFallbackApproval(agentKind: "main" | "sub", failureObserved: boolean): boolean {
	return agentKind === "sub" && failureObserved;
}

/** Process-local approval ledger. Pending entries are keyed by stable child id. */
export class FallbackApprovalGate {
	static #global: FallbackApprovalGate | undefined;

	static global(): FallbackApprovalGate {
		return (FallbackApprovalGate.#global ??= new FallbackApprovalGate());
	}

	static resetGlobalForTests(): void {
		FallbackApprovalGate.#global = new FallbackApprovalGate();
	}

	readonly #pending = new Map<string, PendingFallbackApproval>();

	request(proposal: FallbackApprovalProposal, resolve: PendingFallbackApproval["resolve"]): boolean {
		if (this.#pending.has(proposal.agentId)) return false;

		this.#pending.set(proposal.agentId, { proposal, resolve });
		return true;
	}

	get(agentId: string): FallbackApprovalProposal | undefined {
		return this.#pending.get(agentId)?.proposal;
	}

	listForParent(parentAgentId: string): FallbackApprovalProposal[] {
		return [...this.#pending.values()]
			.map(entry => entry.proposal)
			.filter(proposal => proposal.parentAgentId === parentAgentId);
	}

	async act(
		parentAgentId: string,
		agentId: string,
		action: FallbackApprovalAction,
	): Promise<FallbackApprovalResolution> {
		const pending = this.#pending.get(agentId);
		if (!pending) throw new Error(`No fallback approval is pending for agent ${agentId}.`);
		if (pending.proposal.parentAgentId !== parentAgentId) {
			throw new Error(`Agent ${agentId} is not owned by ${parentAgentId}.`);
		}
		if (action.kind === "wait" && (!Number.isFinite(action.timeoutMs) || action.timeoutMs < 0)) {
			throw new Error("Fallback wait timeout must be a non-negative finite number.");
		}
		if (action.kind === "choose" && action.model.trim().length === 0) {
			throw new Error("An explicit fallback model is required.");
		}
		this.#pending.delete(agentId);
		try {
			await pending.resolve(action);
		} catch (error) {
			this.#pending.set(agentId, pending);
			throw error;
		}
		return { proposal: pending.proposal, action };
	}

	cancel(agentId: string): void {
		this.#pending.delete(agentId);
	}
}

export const FALLBACK_APPROVAL_OPTIONS_TEXT =
	"Options: (a) wait/retry source model with timeout, (b) approve proposed model, (c) choose another explicit model, (d) abort.";

export function formatFallbackApprovalNotice(proposal: FallbackApprovalProposal): string {
	return [
		`Fallback approval required for ${proposal.agentId}.`,
		`Source: ${proposal.sourceModel}`,
		`Proposed: ${proposal.proposedModel}`,
		`Cause: ${proposal.cause}`,
		`Task: ${proposal.taskContext}`,
		FALLBACK_APPROVAL_OPTIONS_TEXT,
		`Use job({ fallbackApproval: { id: "${proposal.agentId}", action: "wait", timeoutMs: 60000 } }),`,
		`job({ fallbackApproval: { id: "${proposal.agentId}", action: "approve" } }),`,
		`job({ fallbackApproval: { id: "${proposal.agentId}", action: "choose", model: "provider/model" } }), or`,
		`job({ fallbackApproval: { id: "${proposal.agentId}", action: "abort" } }).`,
	].join("\n");
}
