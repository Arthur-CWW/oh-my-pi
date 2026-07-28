import { AgentRegistry, MAIN_AGENT_ID } from "../registry/agent-registry";
import type { AgentSession } from "./agent-session";
import {
	appendChildRestartRecord,
	isTerminalChildLifecycleState,
	latestChildLifecycleRecord,
} from "../task/child-lifecycle";
import { SessionManager } from "./session-manager";
import type { RestartChildManifestEntryV1 } from "./session-ownership";

/**
 * Persist restart authorization for every recoverable direct child before the
 * parent session begins teardown. Running supervised turns are soft-stopped
 * first so their journals contain a durable handoff boundary.
 */
export async function captureRestartChildManifest(
	session: AgentSession,
	predecessorOwnerEpoch: string,
): Promise<readonly RestartChildManifestEntryV1[]> {
	const supervisedJobIds = new Set(
		session.asyncJobManager
			?.getRunningJobs({ ownerId: MAIN_AGENT_ID })
			.filter(job => job.type === "task" && !job.isolated)
			.map(job => job.id) ?? [],
	);
	const children = AgentRegistry.global()
		.list()
		.filter(
			ref =>
				(ref.parentId === MAIN_AGENT_ID || supervisedJobIds.has(ref.id)) &&
				(ref.status === "running" || ref.status === "parked") &&
				typeof ref.sessionFile === "string",
		)
		.map(ref => ({
			agentId: ref.id,
			state: ref.status as "running" | "parked",
			journalPath: ref.sessionFile!,
			sessionManager: ref.session?.sessionManager,
		}));

	await session.checkpointChildJobsForRestart(children.map(child => child.agentId));

	const manifest: RestartChildManifestEntryV1[] = [];
	for (const child of children) {
		const manager = child.sessionManager ?? (await SessionManager.open(child.journalPath));
		try {
			const lifecycle = latestChildLifecycleRecord(manager.getEntries());
			if (!lifecycle || isTerminalChildLifecycleState(lifecycle.state)) continue;
			appendChildRestartRecord(manager, {
				version: 1,
				agentId: child.agentId,
				predecessorOwnerEpoch,
				state: child.state,
				queueCheckpoint: null,
				status: "pending",
				updatedAt: new Date().toISOString(),
			});
			await manager.flush();
			manifest.push({
				agentId: child.agentId,
				state: child.state,
				journalPath: child.journalPath,
				queueCheckpoint: null,
			});
		} finally {
			if (!child.sessionManager) await manager.close();
		}
	}
	return manifest;
}
