import { describe, expect, it } from "bun:test";
import { TempDir } from "@oh-my-pi/pi-utils";
import { IrcExternalBus, type IrcExternalPeerLabels } from "../../src/irc/bus-external";

function withIsolatedBus(test: (bus: IrcExternalBus) => void, fleetRegistration: "0" | "unset" = "unset"): void {
	using tmp = TempDir.createSync("@omp-irc-bus-");
	const previousHome = process.env.HOME;
	const previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
	const previousFleetRegistration = process.env.OMP_FLEET_REGISTER;
	process.env.HOME = tmp.path();
	process.env.OMP_SESSION_CONTROL_DB = `${tmp.path()}/session-control.sqlite`;
	if (fleetRegistration === "0") process.env.OMP_FLEET_REGISTER = "0";
	else delete process.env.OMP_FLEET_REGISTER;
	const bus = new IrcExternalBus(`${tmp.path()}/irc-bus.sqlite`);
	try {
		test(bus);
	} finally {
		bus.close();
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
		else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
		if (previousFleetRegistration === undefined) delete process.env.OMP_FLEET_REGISTER;
		else process.env.OMP_FLEET_REGISTER = previousFleetRegistration;
	}
}

function registerPeer(bus: IrcExternalBus, sessionId: string, name = "initial", labels?: IrcExternalPeerLabels): void {
	bus.registerPeer({ sessionId, name, cwd: "/tmp/irc-bus-test", labels });
}

describe("external IRC peer labels", () => {
	it("merges patches, prunes nulls, and does not create missing peers", () => {
		withIsolatedBus(bus => {
			registerPeer(bus, "merge-peer", "initial", {
				objective: "Keep this objective",
				activity: "Old activity",
				workstream: "harness",
			});

			expect(bus.mergePeerLabels("merge-peer", { activity: "New activity" })).toBe(true);
			const merged = bus.listPeers({ includeStale: true }).find(peer => peer.sessionId === "merge-peer");
			expect(merged?.labels).toEqual({
				objective: "Keep this objective",
				activity: "New activity",
				workstream: "harness",
			});

			expect(bus.mergePeerLabels("merge-peer", { workstream: null })).toBe(true);
			expect(bus.listPeers({ includeStale: true }).find(peer => peer.sessionId === "merge-peer")?.labels).toEqual({
				objective: "Keep this objective",
				activity: "New activity",
			});
			expect(bus.mergePeerLabels("missing-peer", { summary: "not created" })).toBe(false);
			expect(bus.listPeers({ includeStale: true })).toHaveLength(1);
		});
	});

	it("leaves the roster unchanged when fleet registration is disabled", () => {
		withIsolatedBus(
			bus => {
				const before = bus.listPeers({ includeStale: true });
				bus.registerPeer({
					sessionId: "disabled-peer",
					name: "disabled",
					cwd: "/tmp/irc-bus-test",
				});
				bus.heartbeat("disabled-peer", { activity: "must not persist" });
				bus.updatePeerState("disabled-peer", "working");
				expect(bus.listPeers({ includeStale: true })).toEqual(before);
			},
			"0",
		);
	});

	it("preserves observer summary while heartbeat refreshes activity", () => {
		withIsolatedBus(bus => {
			registerPeer(bus, "heartbeat-peer", "initial", { objective: "Goal" });
			expect(bus.mergePeerLabels("heartbeat-peer", { summary: "Observer summary" })).toBe(true);

			bus.heartbeat("heartbeat-peer", {
				objective: "Goal",
				workstream: "harness",
				activity: "Refreshed activity",
				todoHead: "Next task",
				label: "Worker label",
				model: "provider/model",
			});

			const peer = bus.listPeers({ includeStale: true }).find(candidate => candidate.sessionId === "heartbeat-peer");
			expect(peer?.labels).toEqual({
				objective: "Goal",
				workstream: "harness",
				activity: "Refreshed activity",
				todoHead: "Next task",
				label: "Worker label",
				model: "provider/model",
				summary: "Observer summary",
			});
		});
	});

	it("truncates oversized summaries at write time", () => {
		withIsolatedBus(bus => {
			registerPeer(bus, "summary-peer");
			expect(bus.mergePeerLabels("summary-peer", { summary: "s".repeat(281) })).toBe(true);
			const summary = bus.listPeers({ includeStale: true }).find(peer => peer.sessionId === "summary-peer")?.labels?.summary;
			expect(summary).toHaveLength(280);
		});
	});

	it("captures the original name once across ambient renames", () => {
		withIsolatedBus(bus => {
			registerPeer(bus, "rename-peer", "spawned-name");
			expect(bus.updatePeerName("rename-peer", "first-ambient-name")).toBe(true);
			expect(bus.updatePeerName("rename-peer", "second-ambient-name")).toBe(true);

			const peer = bus.listPeers({ includeStale: true }).find(candidate => candidate.sessionId === "rename-peer");
			expect(peer?.name).toBe("second-ambient-name");
			expect(peer?.labels?.spawnName).toBe("spawned-name");
		});
	});
});
