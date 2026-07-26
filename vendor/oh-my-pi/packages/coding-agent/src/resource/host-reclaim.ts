import { logger } from "@oh-my-pi/pi-utils";
import { shutdownShellSessionsOwnedBy } from "../exec/bash-executor";
import { clearLspInitFailureCache, shutdownIdleClients } from "../lsp/client";
import { AgentLifecycleManager } from "../registry/agent-lifecycle";
import { AgentRegistry } from "../registry/agent-registry";
import { releaseExpiredTabs, releaseTabsOwnedBy } from "../tools/browser/tab-supervisor";

export type HostMemoryReclaimLevel = "soft" | "hard";

export interface HostMemoryReclaimReceipt {
	action: string;
	count: number;
	bytesHint?: number;
}

export interface HostMemoryReclaimError {
	action: string;
	error: string;
}

export interface HostMemoryReclaimReport {
	level: HostMemoryReclaimLevel;
	receipts: HostMemoryReclaimReceipt[];
	errors: HostMemoryReclaimError[];
	totalCount: number;
	durationMs: number;
}

const ACTION_TIMEOUT_MS = 5_000;
let activeReclaim: { level: HostMemoryReclaimLevel; promise: Promise<HostMemoryReclaimReport> } | undefined;

async function runAction(
	action: string,
	work: () => number | Promise<number>,
	errors: HostMemoryReclaimError[],
): Promise<HostMemoryReclaimReceipt> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`timed out after ${ACTION_TIMEOUT_MS}ms`)), ACTION_TIMEOUT_MS);
		timer.unref?.();
	});
	try {
		const count = await Promise.race([Promise.resolve().then(work), timeout]);
		return { action, count };
	} catch (error) {
		errors.push({ action, error: error instanceof Error ? error.message : String(error) });
		return { action, count: 0 };
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function idleSessionIds(): Set<string> {
	const ids = new Set<string>();
	for (const ref of AgentRegistry.global().list()) {
		if (ref.status !== "idle") continue;
		if (ref.sessionId) ids.add(ref.sessionId);
		const sessionId = ref.session?.sessionManager.getSessionId();
		if (sessionId) ids.add(sessionId);
	}
	return ids;
}

async function releaseTabsForOwners(owners: ReadonlySet<string>): Promise<number> {
	const results = await Promise.allSettled([...owners].map(owner => releaseTabsOwnedBy(owner, { kill: true })));
	const failures = results.flatMap(result => (result.status === "rejected" ? [result.reason] : []));
	if (failures.length > 0) throw new AggregateError(failures, "Failed to release one or more idle sessions' tabs");
	return results.reduce((count, result) => count + (result.status === "fulfilled" ? result.value : 0), 0);
}

async function performReclaim(level: HostMemoryReclaimLevel): Promise<HostMemoryReclaimReport> {
	const startedAt = performance.now();
	const errors: HostMemoryReclaimError[] = [];
	const receipts: HostMemoryReclaimReceipt[] = [];
	const lifecycle = AgentLifecycleManager.global();

	receipts.push(
		await runAction(
			"gc",
			() => {
				Bun.gc(level === "hard");
				return 0;
			},
			errors,
		),
	);

	if (level === "soft") {
		receipts.push(
			...(await Promise.all([
				runAction("park-idle-children", () => lifecycle.parkIdleAgents(), errors),
				runAction("release-expired-tabs", () => releaseExpiredTabs(), errors),
			])),
		);
	} else {
		let owners = new Set<string>();
		try {
			owners = idleSessionIds();
		} catch (error) {
			errors.push({
				action: "discover-idle-sessions",
				error: error instanceof Error ? error.message : String(error),
			});
		}
		receipts.push(
			...(await Promise.all([
				runAction("release-idle-tabs", () => releaseTabsForOwners(owners), errors),
				runAction("shutdown-idle-shells", () => shutdownShellSessionsOwnedBy(owners), errors),
				runAction("shutdown-idle-lsp", () => shutdownIdleClients(), errors),
				runAction("clear-lsp-init-cache", () => clearLspInitFailureCache(), errors),
			])),
		);
		receipts.push(await runAction("park-idle-children", () => lifecycle.parkIdleAgents(), errors));
		receipts.push(await runAction("release-parked-sessions", () => lifecycle.releaseParkedAgents(), errors));
	}

	const report: HostMemoryReclaimReport = {
		level,
		receipts,
		errors,
		totalCount: receipts.reduce((count, receipt) => count + receipt.count, 0),
		durationMs: Math.round(performance.now() - startedAt),
	};
	logger.info("Host memory reclaim completed", {
		level,
		count: report.totalCount,
		errors: errors.length,
		durationMs: report.durationMs,
	});
	return report;
}

/**
 * Release process-owned memory without touching live work or foreign
 * processes. Calls are coalesced; a hard request arriving during a soft pass
 * runs immediately afterward.
 */
export function reclaimHostMemory(level: HostMemoryReclaimLevel): Promise<HostMemoryReclaimReport> {
	const current = activeReclaim;
	if (current) {
		if (current.level === "hard" || level === "soft") return current.promise;
		return current.promise.then(() => reclaimHostMemory("hard"));
	}
	const promise = performReclaim(level).catch(error => {
		const report: HostMemoryReclaimReport = {
			level,
			receipts: [],
			errors: [{ action: "reclaim", error: error instanceof Error ? error.message : String(error) }],
			totalCount: 0,
			durationMs: 0,
		};
		try {
			logger.info("Host memory reclaim completed", { level, count: 0, errors: 1, durationMs: 0 });
		} catch {}
		return report;
	});
	activeReclaim = { level, promise };
	void promise.finally(() => {
		if (activeReclaim?.promise === promise) activeReclaim = undefined;
	});
	return promise;
}
