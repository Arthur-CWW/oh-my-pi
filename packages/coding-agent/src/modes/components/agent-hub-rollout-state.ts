import { RolloutJournal, type RolloutPeerPhase, type RolloutPeerSnapshot } from "../../session/rollout-journal";

export const AGENT_HUB_ROLLOUT_TERMINAL_TTL_MS = 10 * 60_000;

export interface AgentHubRolloutSnapshot {
	readonly rolloutId: string;
	readonly targetDigest: string;
	readonly targetVersion: string;
	readonly sessionId: string;
	readonly sessionFile?: string;
	readonly name: string;
	readonly phase: RolloutPeerPhase;
	readonly reason?: string;
	readonly error?: string;
	readonly updatedAt: string;
}

export interface AgentHubRolloutPeerIdentity {
	readonly sessionId?: string;
	readonly sessionFile?: string | null;
}

export interface AgentHubRolloutDataSource {
	latestForPeer(peer: AgentHubRolloutPeerIdentity): AgentHubRolloutSnapshot | undefined;
	close?(): void;
}

export interface AgentHubRolloutDataSourceOptions {
	readonly dbPath?: string;
	readonly terminalTtlMs?: number;
	readonly now?: () => number;
}

const TERMINAL_PHASE: Partial<Record<RolloutPeerPhase, true>> = {
	skipped: true,
	recovered: true,
	failed: true,
};

function isExpiredTerminal(snapshot: RolloutPeerSnapshot, now: number, ttlMs: number): boolean {
	if (!TERMINAL_PHASE[snapshot.phase]) return false;
	return now - Date.parse(snapshot.updatedAt) > ttlMs;
}

/**
 * Lazily opens the shared session-control journal on first read. Supplying null
 * as the Hub dependency remains the explicit no-I/O path for tests.
 */
export function createAgentHubRolloutDataSource(
	options: AgentHubRolloutDataSourceOptions = {},
): AgentHubRolloutDataSource {
	let journal: RolloutJournal | undefined;
	const now = options.now ?? Date.now;
	const ttlMs = options.terminalTtlMs ?? AGENT_HUB_ROLLOUT_TERMINAL_TTL_MS;
	return {
		latestForPeer(peer): AgentHubRolloutSnapshot | undefined {
			if (!peer.sessionId && !peer.sessionFile) return undefined;
			journal ??= new RolloutJournal(options.dbPath);
			const snapshot = journal.latestForPeer({
				...(peer.sessionId ? { sessionId: peer.sessionId } : {}),
				...(peer.sessionFile ? { sessionFile: peer.sessionFile } : {}),
			});
			if (!snapshot || isExpiredTerminal(snapshot, now(), ttlMs)) return undefined;
			return snapshot;
		},
		close(): void {
			journal?.close();
			journal = undefined;
		},
	};
}
