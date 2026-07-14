import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { VERSION } from "@oh-my-pi/pi-utils/dirs";
import { IrcExternalBus, type IrcExternalPeer } from "../irc/bus-external";
import { SessionControlBus } from "./session-control";
import { inspectSessionOwnership } from "./session-ownership";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

type SkipReason = "working" | "unsafe-state" | "initiator" | "already-current" | "missing-control-identity";
export type RolloutPlanEntry =
	| { readonly action: "restart"; readonly peer: IrcExternalPeer }
	| { readonly action: "skip"; readonly peer: IrcExternalPeer; readonly reason: SkipReason };

export interface RolloutSummary {
	readonly targetDigest: string;
	readonly targetVersion: string;
	readonly entries: readonly RolloutPlanEntry[];
	readonly restarted: readonly string[];
	readonly failed?: { readonly sessionId: string; readonly name: string; readonly error: string };
}

export function createRolloutPlan(
	peers: readonly IrcExternalPeer[],
	targetDigest: string,
	initiatorPids: ReadonlySet<number>,
	initiatorSessionIds: ReadonlySet<string> = new Set(),
): RolloutPlanEntry[] {
	return peers.map(peer => {
		if (initiatorPids.has(peer.pid) || initiatorSessionIds.has(peer.sessionId)) {
			return { action: "skip", peer, reason: "initiator" };
		}
		if (peer.buildDigest === targetDigest) return { action: "skip", peer, reason: "already-current" };
		if (peer.state === "working") return { action: "skip", peer, reason: "working" };
		if (peer.state !== "idle" && peer.state !== "waiting_input") {
			return { action: "skip", peer, reason: "unsafe-state" };
		}
		if (!peer.ownerEpoch) return { action: "skip", peer, reason: "missing-control-identity" };
		return { action: "restart", peer };
	});
}

export async function executeRolloutPlan(
	entries: readonly RolloutPlanEntry[],
	restart: (peer: IrcExternalPeer) => Promise<void>,
): Promise<{ restarted: string[]; failed?: RolloutSummary["failed"] }> {
	const restarted: string[] = [];
	for (const entry of entries) {
		if (entry.action !== "restart") continue;
		try {
			await restart(entry.peer);
			restarted.push(entry.peer.sessionId);
		} catch (error) {
			return {
				restarted,
				failed: {
					sessionId: entry.peer.sessionId,
					name: entry.peer.name,
					error: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}
	return { restarted };
}

async function enrichPeerIdentity(peer: IrcExternalPeer): Promise<IrcExternalPeer> {
	if ((peer.ownerEpoch && peer.buildDigest && peer.version) || !peer.sessionFile) return peer;
	const ownership = await inspectSessionOwnership(peer.sessionFile, peer.sessionId);
	if (ownership.status !== "live") return peer;
	return {
		...peer,
		ownerEpoch: peer.ownerEpoch ?? ownership.lease.ownerEpoch,
		buildDigest: peer.buildDigest ?? ownership.lease.buildRevision?.digest,
		version: peer.version ?? ownership.lease.buildRevision?.version,
	};
}

async function executableDigest(): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of fs.createReadStream(process.execPath)) hash.update(chunk);
	return hash.digest("hex");
}

async function ancestorPids(): Promise<Set<number>> {
	const result = new Set<number>([process.pid, process.ppid]);
	try {
		const child = Bun.spawn(["ps", "-axo", "pid=,ppid="], { stdout: "pipe", stderr: "ignore" });
		const rows = (await new Response(child.stdout).text()).trim().split("\n");
		if ((await child.exited) !== 0) return result;
		const parents = new Map<number, number>();
		for (const row of rows) {
			const [pid, parent] = row.trim().split(/\s+/, 2).map(Number);
			if (Number.isInteger(pid) && Number.isInteger(parent)) parents.set(pid, parent);
		}
		let current = process.pid;
		while (parents.has(current)) {
			const parent = parents.get(current)!;
			if (parent < 1 || result.has(parent)) break;
			result.add(parent);
			current = parent;
		}
	} catch {
		// The direct parent still protects the common in-session invocation path.
	}
	return result;
}

export interface RunRolloutOptions {
	readonly bus?: IrcExternalBus;
	readonly controlBus?: SessionControlBus;
	readonly targetDigest?: string;
	readonly targetVersion?: string;
	readonly initiatorPids?: ReadonlySet<number>;
	readonly initiatorSessionIds?: ReadonlySet<string>;
	readonly dryRun?: boolean;
	readonly timeoutMs?: number;
	readonly pollIntervalMs?: number;
}

export async function runRollout(options: RunRolloutOptions = {}): Promise<RolloutSummary> {
	const bus = options.bus ?? new IrcExternalBus();
	const controlBus = options.controlBus ?? new SessionControlBus();
	const ownsBus = options.bus === undefined;
	const ownsControlBus = options.controlBus === undefined;
	try {
		const targetDigest = options.targetDigest ?? (await executableDigest());
		const targetVersion = options.targetVersion ?? VERSION;
		const initiators = options.initiatorPids ?? (await ancestorPids());
		const peers = await Promise.all(bus.listPeers().map(enrichPeerIdentity));
		const entries = createRolloutPlan(peers, targetDigest, initiators, options.initiatorSessionIds);
		if (options.dryRun) return { targetDigest, targetVersion, entries, restarted: [] };
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		const sourceInstanceId = randomUUID();
		const result = await executeRolloutPlan(entries, async plannedPeer => {
			const current = await enrichPeerIdentity(
				bus.listPeers({ includeStale: true }).find(peer => peer.sessionId === plannedPeer.sessionId) ?? plannedPeer,
			);
			if (current.state === "working") throw new Error("session became working before restart");
			if (current.state !== "idle" && current.state !== "waiting_input") {
				throw new Error(`session entered unsafe state ${current.state}`);
			}
			if (!current.ownerEpoch) throw new Error("session has no control owner epoch");
			if (current.buildDigest === targetDigest) return;
			const baselineHeartbeat = Date.parse(current.lastSeen);
			const commandId = randomUUID();
			controlBus.request({
				schemaVersion: 1,
				commandId,
				source: { kind: "local-cli", instanceId: sourceInstanceId, pid: process.pid, ...(process.getuid ? { uid: process.getuid() } : {}) },
				sessionId: current.sessionId,
				targetOwnerEpoch: current.ownerEpoch,
				requestedAt: new Date().toISOString(),
				intent: { kind: "restart" },
			});
			const receipt = await controlBus.waitForTerminal(commandId, { timeoutMs, pollIntervalMs });
			if (receipt.state === "failed") throw new Error(receipt.error ?? "restart control command failed");
			const deadline = Date.now() + timeoutMs;
			for (;;) {
				const recovered = bus.listPeers({ includeStale: true }).find(peer => peer.sessionId === current.sessionId);
				if (
					recovered &&
					Date.parse(recovered.lastSeen) > baselineHeartbeat &&
					recovered.ownerEpoch !== current.ownerEpoch &&
					recovered.buildDigest === targetDigest &&
					(!recovered.version || recovered.version === targetVersion)
				) return;
				if (Date.now() >= deadline) throw new Error(`timed out waiting for recovery on ${targetDigest.slice(0, 12)}`);
				await Bun.sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
			}
		});
		return { targetDigest, targetVersion, entries, ...result };
	} finally {
		if (ownsControlBus) controlBus.close();
		if (ownsBus) bus.close();
	}
}

function printSummary(summary: RolloutSummary, dryRun: boolean): void {
	process.stdout.write(`rollout target ${summary.targetDigest} (${summary.targetVersion})${dryRun ? " [dry-run]" : ""}\n`);
	for (const entry of summary.entries) {
		const identity = `${entry.peer.name} session=${entry.peer.sessionId} pid=${entry.peer.pid} state=${entry.peer.state} version=${entry.peer.version ?? "unknown"} digest=${entry.peer.buildDigest ?? "unknown"}`;
		if (entry.action === "skip") process.stdout.write(`skip ${identity} reason=${entry.reason}\n`);
		else {
			const outcome = summary.restarted.includes(entry.peer.sessionId) ? "restarted" : summary.failed?.sessionId === entry.peer.sessionId ? "failed" : dryRun ? "would-restart" : "untouched";
			process.stdout.write(`${outcome} ${identity}\n`);
		}
	}
	if (summary.failed) process.stderr.write(`rollout aborted at ${summary.failed.name} (${summary.failed.sessionId}): ${summary.failed.error}; remaining sessions untouched\n`);
}

export default class RolloutCommand extends Command {
	static description = "Safely restart live sessions into the current blessed binary";
	static flags = {
		auto: Flags.boolean({ description: "Run unattended after binary promotion", default: false }),
		"dry-run": Flags.boolean({ description: "Print the rollout plan without restarting sessions", default: false }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(RolloutCommand);
		const summary = await runRollout({ dryRun: flags["dry-run"] });
		printSummary(summary, flags["dry-run"]);
		if (summary.failed) process.exitCode = 1;
	}
}
