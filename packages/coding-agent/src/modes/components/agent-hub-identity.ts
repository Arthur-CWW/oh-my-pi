export interface AgentHubYankIdentity {
	readonly sessionId: string;
	readonly agentId: string;
}

export function agentHubYankPayload(identity: AgentHubYankIdentity): string {
	return `${identity.sessionId}/${identity.agentId}\nhistory://${identity.sessionId}/${identity.agentId}`;
}
