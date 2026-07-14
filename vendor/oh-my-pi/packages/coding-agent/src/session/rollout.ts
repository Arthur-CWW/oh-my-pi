import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { VERSION } from "@oh-my-pi/pi-utils/dirs";
import { IrcExternalBus, type IrcExternalPeer } from "../irc/bus-external";
import { RolloutJournal, type RolloutPeerPhase } from "./rollout-journal";
import { SessionControlBus } from "./session-control";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

type SkipReason = "working" | "unsafe-state" | "initiator" | "already-current" | "legacy";
type RolloutPeer = IrcExternalPeer & { readonly controlSessionId?: string };
export type RolloutPlanEntry =
	| { readonly action: "restart"; readonly peer: RolloutPeer }
	| { readonly action: "skip"; readonly peer: RolloutPeer; readonly reason: SkipReason };

const SKIP_REASON_REPORT: Record<SkipReason, string> = {
	working: "working",
	"unsafe-state": "unsafe-state",
	initiator: "initiator",
	"already-current": "already-current",
	legacy: "legacy binary — restart manually once; future rollouts will manage it",
};

export interface RolloutSummary {
	readonly targetDigest: string;
	readonly targetVersion: string;
	readonly entries: readonly RolloutPlanEntry[];
	readonly restarted: readonly string[];
	readonly failed?: { readonly sessionId: string; readonly name: string; readonly error: string };
}

export function createRolloutPlan(
	peers: readonly RolloutPeer[],
	targetDigest: string,
	initiatorPids: ReadonlySet<number>,
	initiatorSessionIds: ReadonlySet<string> = new Set(),
): RolloutPlanEntry[] {
	return peers.map(peer => {
		if (initiatorPids.has(peer.pid) || initiatorSessionIds.has(peer.sessionId)) {
			return { action: "skip", peer, reason: "initiator" };
		}
		if (!peer.ownerEpoch || !peer.buildDigest || !peer.version) {
			return { action: "skip", peer, reason: "legacy" };
		}
		if (peer.buildDigest === targetDigest) return { action: "skip", peer, reason: "already-current" };
		if (peer.state === "working") return { action: "skip", peer, reason: "working" };
		if (peer.state !== "idle" && peer.state !== "waiting_input") {
			return { action: "skip", peer, reason: "unsafe-state" };
		}
		return { action: "restart", peer };
	});
}

export async function executeRolloutPlan(
	entries: readonly RolloutPlanEntry[],
	restart: (peer: RolloutPeer) => Promise<void>,
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
	readonly rolloutJournal?: RolloutJournal;
	readonly targetDigest?: string;
	readonly targetVersion?: string;
	readonly targetExecutable?: string;
	readonly initiatorPids?: ReadonlySet<number>;
	readonly initiatorSessionIds?: ReadonlySet<string>;
	readonly dryRun?: boolean;
	readonly timeoutMs?: number;
	readonly pollIntervalMs?: number;
}

export async function runRollout(options: RunRolloutOptions = {}): Promise<RolloutSummary> {
	const ownsBus = options.bus === undefined;
	const ownsControlBus = options.controlBus === undefined;
	const ownsRolloutJournal = options.rolloutJournal === undefined;
	let bus = options.bus;
	let controlBus = options.controlBus;
	let rolloutJournal = options.rolloutJournal;
	try {
		bus ??= new IrcExternalBus();
		controlBus ??= new SessionControlBus();
		rolloutJournal ??= new RolloutJournal(controlBus.dbPath);
		const activeBus = bus;
		const activeControlBus = controlBus;
		const activeRolloutJournal = rolloutJournal;
		const targetDigest = options.targetDigest ?? (await executableDigest());
		const targetVersion = options.targetVersion ?? VERSION;
		const targetExecutable = options.targetExecutable ?? process.execPath;
		const initiators = options.initiatorPids ?? (await ancestorPids());
		const peers = activeBus.listPeers();
		const entries = createRolloutPlan(peers, targetDigest, initiators, options.initiatorSessionIds);
		if (options.dryRun) return { targetDigest, targetVersion, entries, restarted: [] };
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		const sourceInstanceId = randomUUID();
		const rolloutId = randomUUID();
		activeRolloutJournal.beginRun({ rolloutId, targetDigest, targetVersion });
		const updatePeer = (
			peer: RolloutPeer,
			phase: RolloutPeerPhase,
			detail: { readonly reason?: string; readonly error?: string } = {},
		): void => {
			activeRolloutJournal.updatePeer({
				rolloutId,
				sessionId: peer.sessionId,
				...(peer.sessionFile ? { sessionFile: peer.sessionFile } : {}),
				name: peer.name || peer.sessionId,
				phase,
				...detail,
			});
		};
		for (const entry of entries) {
			if (entry.action === "skip") updatePeer(entry.peer, "skipped", { reason: entry.reason });
			else updatePeer(entry.peer, "planned");
		}
		const result = await executeRolloutPlan(entries, async plannedPeer => {
			let current = plannedPeer;
			try {
				current = (activeBus
					.listPeers({ includeStale: true })
					.find(peer => peer.sessionId === plannedPeer.sessionId) ?? plannedPeer) as RolloutPeer;
				if (current.state === "working") throw new Error("session became working before restart");
				if (current.state !== "idle" && current.state !== "waiting_input") {
					throw new Error(`session entered unsafe state ${current.state}`);
				}
				if (!current.ownerEpoch) throw new Error("session has no control owner epoch");
				if (current.buildDigest === targetDigest) {
					updatePeer(current, "skipped", { reason: "already-current" });
					return;
				}
				const baselineHeartbeat = Date.parse(current.lastSeen);
				const commandId = randomUUID();
				updatePeer(current, "requested");
				activeControlBus.request({
					schemaVersion: 1,
					commandId,
					source: {
						kind: "local-cli",
						instanceId: sourceInstanceId,
						pid: process.pid,
						...(process.getuid ? { uid: process.getuid() } : {}),
					},
					sessionId: current.controlSessionId ?? current.sessionId,
					targetOwnerEpoch: current.ownerEpoch,
					requestedAt: new Date().toISOString(),
					intent: { kind: "restart", executable: targetExecutable },
				});
				const receipt = await activeControlBus.waitForTerminal(commandId, {
					timeoutMs,
					pollIntervalMs,
					onReceipt: next => {
						if (next.state === "requested") updatePeer(current, "requested");
						else if (next.state === "acknowledged") updatePeer(current, "acknowledged");
						else if (next.state === "applied") updatePeer(current, "applied");
						else updatePeer(current, "failed", { error: next.error ?? "restart control command failed" });
					},
				});
				if (receipt.state === "failed") throw new Error(receipt.error ?? "restart control command failed");
				const deadline = Date.now() + timeoutMs;
				for (;;) {
					const recovered = activeBus
						.listPeers({ includeStale: true })
						.find(
							peer =>
								peer.sessionId === (current.controlSessionId ?? current.sessionId) ||
								peer.sessionFile === current.sessionFile,
						);
					if (
						recovered &&
						Date.parse(recovered.lastSeen) > baselineHeartbeat &&
						recovered.ownerEpoch !== current.ownerEpoch &&
						recovered.buildDigest === targetDigest &&
						(!recovered.version || recovered.version === targetVersion)
					) {
						updatePeer({ ...current, sessionFile: recovered.sessionFile ?? current.sessionFile }, "recovered");
						return;
					}
					if (Date.now() >= deadline)
						throw new Error(`timed out waiting for recovery on ${targetDigest.slice(0, 12)}`);
					await Bun.sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
				}
			} catch (error) {
				updatePeer(current, "failed", { error: error instanceof Error ? error.message : String(error) });
				throw error;
			}
		});
		if (result.failed) {
			for (const entry of entries) {
				if (
					entry.action === "restart" &&
					entry.peer.sessionId !== result.failed.sessionId &&
					!result.restarted.includes(entry.peer.sessionId)
				) {
					updatePeer(entry.peer, "skipped", { reason: "rollout-aborted" });
				}
			}
		}
		return { targetDigest, targetVersion, entries, ...result };
	} finally {
		if (ownsRolloutJournal) rolloutJournal?.close();
		if (ownsControlBus) controlBus?.close();
		if (ownsBus) bus?.close();
	}
}

function printSummary(summary: RolloutSummary, dryRun: boolean): void {
	process.stdout.write(
		`rollout target ${summary.targetDigest} (${summary.targetVersion})${dryRun ? " [dry-run]" : ""}\n`,
	);
	for (const entry of summary.entries) {
		const identity = `${entry.peer.name} session=${entry.peer.sessionId} pid=${entry.peer.pid} state=${entry.peer.state} version=${entry.peer.version ?? "unknown"} digest=${entry.peer.buildDigest ?? "unknown"}`;
		if (entry.action === "skip")
			process.stdout.write(`skip ${identity} reason=${SKIP_REASON_REPORT[entry.reason]}\n`);
		else {
			const outcome = summary.restarted.includes(entry.peer.sessionId)
				? "restarted"
				: summary.failed?.sessionId === entry.peer.sessionId
					? "failed"
					: dryRun
						? "would-restart"
						: "untouched";
			process.stdout.write(`${outcome} ${identity}\n`);
		}
	}
	if (summary.failed)
		process.stderr.write(
			`rollout aborted at ${summary.failed.name} (${summary.failed.sessionId}): ${summary.failed.error}; remaining sessions untouched\n`,
		);
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
