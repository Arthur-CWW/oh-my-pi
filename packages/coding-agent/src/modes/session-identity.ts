export interface SessionIdentity {
	readonly sessionId: string;
	readonly sessionName?: string;
	readonly agentId: string;
	readonly journalPath?: string;
	readonly binaryVersion: string;
}

export function sessionIdentityHandle(identity: Pick<SessionIdentity, "sessionId" | "agentId">): string {
	return `${identity.sessionId}/${identity.agentId}`;
}

export function formatSessionIdentity(identity: SessionIdentity): string {
	const handle = sessionIdentityHandle(identity);
	return [
		"OMP session identity",
		`  handle: ${handle}`,
		`  session id: ${identity.sessionId}`,
		`  session name: ${identity.sessionName ?? "(unnamed)"}`,
		`  agent id: ${identity.agentId}`,
		`  journal: ${identity.journalPath ?? "(in memory)"}`,
		`  binary: ${identity.binaryVersion}`,
		`  status segment: session (renders ${identity.sessionId.slice(0, 8) || "new"})`,
		"  copied: handle via OSC52",
	].join("\n");
}
