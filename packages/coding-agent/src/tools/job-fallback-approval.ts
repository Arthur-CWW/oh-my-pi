import { type FallbackApprovalAction, FallbackApprovalGate } from "../session/fallback-approval";
import { ToolError } from "./tool-errors";

export interface FallbackApprovalRequest {
	id: string;
	action: "wait" | "approve" | "choose" | "abort";
	timeoutMs?: number;
	model?: string;
}

export async function resolveFallbackApproval(ownerId: string | undefined, requested: FallbackApprovalRequest) {
	if (!ownerId) throw new ToolError("Fallback approval requires an identified parent agent.");

	let action: FallbackApprovalAction;
	switch (requested.action) {
		case "wait":
			action = { kind: "wait", timeoutMs: requested.timeoutMs ?? 60_000 };
			break;
		case "approve":
			action = { kind: "approve" };
			break;
		case "choose":
			if (!requested.model) throw new ToolError("`fallbackApproval.model` is required for choose.");
			action = { kind: "choose", model: requested.model };
			break;
		case "abort":
			action = { kind: "abort" };
			break;
	}

	try {
		const resolution = await FallbackApprovalGate.global().act(ownerId, requested.id, action);
		const outcome =
			action.kind === "wait"
				? `will retry ${resolution.proposal.sourceModel} after ${action.timeoutMs}ms`
				: action.kind === "approve"
					? `approved ${resolution.proposal.proposedModel}`
					: action.kind === "choose"
						? `approved explicit model ${action.model}`
						: "aborted";
		return {
			content: [{ type: "text" as const, text: `Fallback approval resolved for ${requested.id}: ${outcome}.` }],
			details: { jobs: [] },
		};
	} catch (error) {
		throw new ToolError(error instanceof Error ? error.message : String(error));
	}
}
