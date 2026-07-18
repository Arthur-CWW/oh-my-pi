import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isSubcommand } from "@oh-my-pi/pi-coding-agent/cli-commands";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import {
	createRolloutPlan,
	executeRolloutPlan,
	matchesFleetRecovery,
	RolloutHealthError,
} from "@oh-my-pi/pi-coding-agent/session/rollout";

const cleanupRoots: string[] = [];

// checkpoint-gate exports OMP_FLEET_REGISTER=0 (ephemeral-session roster guard);
// these fixtures construct real buses in tmp dbs and must register anyway.
process.env.OMP_FLEET_REGISTER = "1";

async function fixtureBus(): Promise<IrcExternalBus> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-rollout-"));
	cleanupRoots.push(root);
	return new IrcExternalBus(path.join(root, "irc.sqlite"));
}

function register(
	bus: IrcExternalBus,
	sessionId: string,
	pid: number,
	buildDigest: string,
	state: "working" | "waiting_input" | "idle",
): void {
	bus.registerPeer({
		sessionId,
		name: `peer-${sessionId}`,
		cwd: `/tmp/${sessionId}`,
		pid,
		ownerEpoch: `owner-${sessionId}`,
		buildDigest,
		version: `0.0.0-${buildDigest}`,
	});
	bus.updatePeerState(sessionId, state);
}
function registerLegacy(
	bus: IrcExternalBus,
	sessionId: string,
	pid: number,
	state: "working" | "waiting_input" | "idle",
): void {
	bus.registerPeer({
		sessionId,
		name: `peer-${sessionId}`,
		cwd: `/tmp/${sessionId}`,
		pid,
	});
	bus.updatePeerState(sessionId, state);
}

afterEach(async () => {
	for (const root of cleanupRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("staged session rollout", () => {
	it("registers rollout as a management command", () => {
		expect(isSubcommand("rollout")).toBe(true);
	});

	it("selects only safe, out-of-date, non-initiating peers", async () => {
		const bus = await fixtureBus();
		try {
			register(bus, "idle-old", 101, "old", "idle");
			register(bus, "waiting-old", 102, "old", "waiting_input");
			register(bus, "working-old", 103, "old", "working");
			register(bus, "idle-current", 104, "target", "idle");
			register(bus, "initiator", 105, "old", "idle");
			const plan = createRolloutPlan(bus.listPeers(), "target", new Set([105]));
			const actionBySession = Object.fromEntries(
				plan.map(entry => [entry.peer.sessionId, entry.action === "restart" ? "restart" : entry.reason]),
			);
			expect(actionBySession).toEqual({
				"idle-old": "restart",
				"waiting-old": "restart",
				"working-old": "working",
				"idle-current": "already-current",
				initiator: "initiator",
			});
		} finally {
			bus.close();
		}
	});

	it("skips legacy peers without sending a restart command", async () => {
		const bus = await fixtureBus();
		try {
			registerLegacy(bus, "legacy", 106, "idle");
			const plan = createRolloutPlan(bus.listPeers(), "target", new Set());
			expect(plan).toEqual([
				{ action: "skip", peer: expect.objectContaining({ sessionId: "legacy" }), reason: "legacy" },
			]);
			const calls: string[] = [];
			const result = await executeRolloutPlan(plan, async peer => {
				calls.push(peer.sessionId);
			});
			expect(calls).toEqual([]);
			expect(result).toEqual({ restarted: [], skipped: [] });
		} finally {
			bus.close();
		}
	});

	it("accepts only the exact durable same-session replacement identity", async () => {
		const bus = await fixtureBus();
		try {
			register(bus, "saved-session", 107, "old", "idle");
			const original = bus.listPeers().find(peer => peer.sessionId === "saved-session")!;
			const heartbeatFreshAfter = Date.parse(original.lastSeen);
			const sessionFile = "/tmp/saved-session/session.jsonl";
			const replacement = {
				...original,
				sessionFile,
				ownerEpoch: "owner-saved-session-v2",
				buildDigest: "target",
				lastSeen: new Date(heartbeatFreshAfter + 1).toISOString(),
			};
			const expectation = {
				sessionId: original.sessionId,
				sessionFile: "/tmp/saved-session/./session.jsonl",
				previousOwnerEpoch: original.ownerEpoch!,
				heartbeatFreshAfter,
				targetDigest: "target",
			};

			expect(matchesFleetRecovery(replacement, expectation)).toBe(true);
			expect(matchesFleetRecovery({ ...replacement, sessionId: "new-session" }, expectation)).toBe(false);
			expect(
				matchesFleetRecovery({ ...replacement, sessionFile: "/tmp/new-session/session.jsonl" }, expectation),
			).toBe(false);
			expect(matchesFleetRecovery({ ...replacement, ownerEpoch: original.ownerEpoch }, expectation)).toBe(false);
			expect(matchesFleetRecovery({ ...replacement, buildDigest: "old" }, expectation)).toBe(false);
			expect(
				matchesFleetRecovery(
					{ ...replacement, lastSeen: new Date(heartbeatFreshAfter).toISOString() },
					expectation,
				),
			).toBe(false);
			expect(matchesFleetRecovery(replacement, { ...expectation, sessionFile: undefined })).toBe(false);
		} finally {
			bus.close();
		}
	});

	it("restarts one at a time and aborts the untouched remainder on first failure", async () => {
		const bus = await fixtureBus();
		try {
			register(bus, "one", 201, "old", "idle");
			register(bus, "two", 202, "old", "idle");
			register(bus, "three", 203, "old", "idle");
			const orderedPeers = ["one", "two", "three"].map(id => bus.listPeers().find(peer => peer.sessionId === id)!);
			const plan = createRolloutPlan(orderedPeers, "target", new Set());
			const calls: string[] = [];
			let active = 0;
			const result = await executeRolloutPlan(plan, async peer => {
				active++;
				expect(active).toBe(1);
				calls.push(peer.sessionId);
				await Promise.resolve();
				active--;
				if (peer.sessionId === "two") throw new Error("recovery timeout");
			});
			expect(calls).toEqual(["one", "two"]);
			expect(result.restarted).toEqual(["one"]);
			expect(result.failed).toMatchObject({ sessionId: "two", error: "recovery timeout" });
		} finally {
			bus.close();
		}
	});
	it("skips an unresponsive session and continues with later sessions", async () => {
		const bus = await fixtureBus();
		try {
			register(bus, "one", 204, "old", "idle");
			register(bus, "two", 205, "old", "idle");
			register(bus, "three", 206, "old", "idle");
			const orderedPeers = ["one", "two", "three"].map(id => bus.listPeers().find(peer => peer.sessionId === id)!);
			const plan = createRolloutPlan(orderedPeers, "target", new Set());
			const calls: string[] = [];
			const result = await executeRolloutPlan(plan, async peer => {
				calls.push(peer.sessionId);
				if (peer.sessionId === "two") throw new Error("Timed out waiting for control command");
			});
			expect(calls).toEqual(["one", "two", "three"]);
			expect(result).toEqual({
				restarted: ["one", "three"],
				skipped: [{ sessionId: "two", name: "peer-two", reason: "unresponsive" }],
			});
		} finally {
			bus.close();
		}
	});

	it("keeps a health regression fatal instead of treating it as unresponsive", async () => {
		const bus = await fixtureBus();
		try {
			register(bus, "canary", 207, "old", "idle");
			register(bus, "later", 208, "old", "idle");
			const plan = createRolloutPlan(
				["canary", "later"].map(id => bus.listPeers().find(peer => peer.sessionId === id)!),
				"target",
				new Set(),
			);
			const result = await executeRolloutPlan(plan, async peer => {
				if (peer.sessionId === "canary") throw new RolloutHealthError("health regression on canary");
			});
			expect(result).toMatchObject({
				restarted: [],
				skipped: [],
				failed: { sessionId: "canary", error: "health regression on canary" },
			});
		} finally {
			bus.close();
		}
	});

});
