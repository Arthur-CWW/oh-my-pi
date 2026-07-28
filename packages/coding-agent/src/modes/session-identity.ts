export interface SessionIdentity {
	readonly sessionId: string;
	readonly sessionName?: string;
	readonly agentId: string;
	readonly hostname: string;
	readonly projectDir: string;
	readonly journalPath?: string;
	readonly binaryVersion: string;
}

export function sessionIdentityHandle(identity: Pick<SessionIdentity, "sessionId" | "agentId">): string {
	return `${identity.sessionId}/${identity.agentId}`;
}

export function formatSessionIdentity(identity: SessionIdentity, copied = false): string {
	const handle = sessionIdentityHandle(identity);
	return [
		"OMP session identity",
		`  handle: ${handle}`,
		`  session id: ${identity.sessionId}`,
		`  session name: ${identity.sessionName ?? "(unnamed)"}`,
		`  agent IRC id: ${identity.agentId}`,
		`  host/project: ${identity.hostname} · ${identity.projectDir}`,
		`  journal: ${identity.journalPath ?? "(in memory)"}`,
		`  binary: ${identity.binaryVersion}`,
		copied ? `  copied: ${handle} via OSC52` : "  copy: pending",
		"",
		"Esc dismisses this panel",
	].join("\n");
}
