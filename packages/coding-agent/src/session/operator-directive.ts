import operatorDirectiveTemplate from "../prompts/system/operator-directive.md" with { type: "text" };
import type { OperatorDirectiveControlCommand } from "./session-control";

/** Durable model-visible projection; agent attribution prevents user impersonation. */
export function operatorDirectiveMessage(command: OperatorDirectiveControlCommand) {
	return {
		kind: "custom" as const,
		message: {
			customType: "operator:directive",
			content: operatorDirectiveTemplate
				.replace("{{issuedBy}}", command.intent.issuedBy)
				.replace("{{delegatedThrough}}", command.intent.delegatedThrough)
				.replace("{{commandId}}", command.commandId)
				.replace("{{intent}}", command.intent.intent),
			display: true,
			details: {
				commandId: command.commandId,
				idempotencyKey: command.intent.idempotencyKey,
				issuedBy: command.intent.issuedBy,
				delegatedThrough: command.intent.delegatedThrough,
				sessionId: command.sessionId,
				targetOwnerEpoch: command.targetOwnerEpoch,
			},
			attribution: "agent" as const,
		},
		deliverAs: "followUp" as const,
		triggerTurn: true,
	};
}
