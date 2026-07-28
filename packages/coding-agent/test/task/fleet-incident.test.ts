import { describe, expect, it } from "bun:test";
import { TempDir } from "@oh-my-pi/pi-utils";
import {
	FleetIncidentCoordinator,
	FleetIncidentStore,
	type FleetIncident,
	type FleetIncidentCoordinatorHooks,
} from "../../src/task/fleet-incident";
import {
	salvageFleetIncidentAgent,
	type FleetSalvageAgent,
} from "../../src/task/fleet-incident-runtime";

function network(evidenceKey: string, agent: string, occurredAt: number) {
	return {
		evidenceKey,
		agent,
		job: evidenceKey,
		failureClass: "network" as const,
		occurredAt,
		journalUri: `journal://${evidenceKey}`,
	};
}

function quietHooks(overrides: Partial<FleetIncidentCoordinatorHooks> = {}): FleetIncidentCoordinatorHooks {
	return {
		notice: () => {},
		appendInbox: () => {},
		probe: () => true,
		salvage: () => {},
		sleep: async () => {},
		random: () => 0,
		now: () => 10_000,
		...overrides,
	};
}

describe("FleetIncidentStore and FleetIncidentCoordinator", () => {
	it("opens for three distinct network agents, notices once, includes later evidence, then closes and salvages once", async () => {
		using tempDir = TempDir.createSync("@omp-fleet-incident-");
		const store = new FleetIncidentStore(`${tempDir.path()}/control.sqlite`, { now: () => 10_000 });
		const notices: string[] = [];
		const inbox: string[] = [];
		const salvaged: string[] = [];
		let resolveProbe: (healthy: boolean) => void = () => {};
		const probeResult = new Promise<boolean>(resolve => {
			resolveProbe = resolve;
		});
		const coordinator = new FleetIncidentCoordinator(
			store,
			quietHooks({
				notice: incident => {
					notices.push(incident.id);
				},
				appendInbox: incident => {
					inbox.push(incident.id);
				},
				probe: () => probeResult,
				salvage: (_incident, agent) => {
					salvaged.push(agent);
				},
			}),
		);

		expect(coordinator.recordFailure(network("e1", "agent-a", 1_000))).toBeUndefined();
		expect(coordinator.recordFailure(network("e2", "agent-b", 1_001))).toBeUndefined();
		const opened = coordinator.recordFailure(network("e3", "agent-c", 1_002));
		expect(opened?.status).toBe("open");
		expect(opened?.evidence.map(item => item.agent)).toEqual(["agent-a", "agent-b", "agent-c"]);
		expect(opened?.evidence.map(item => item.job)).toEqual(["e1", "e2", "e3"]);

		const withFourth = coordinator.recordFailure(network("e4", "agent-d", 1_003));
		expect(withFourth?.id).toBe(opened?.id);
		expect(withFourth?.evidence).toHaveLength(4);
		expect(notices).toEqual([opened?.id ?? "missing"]);
		expect(inbox).toEqual([opened?.id ?? "missing"]);

		resolveProbe(true);
		await coordinator.waitForIdle();
		const closed = store.getIncident(opened?.id ?? "missing");
		expect(closed?.status).toBe("closed");
		expect(closed?.closedAt).toBe(10_000);
		expect([...salvaged].sort()).toEqual(["agent-a", "agent-b", "agent-c", "agent-d"]);
		for (const agent of salvaged) expect(store.reserveSalvage(closed?.id ?? "missing", agent)).toBe(false);
		expect(store.listIncidents("closed")).toHaveLength(1);

		await coordinator.close();
		store.close();
	});

	it("does not let repeated evidence from one agent satisfy the distinct-agent threshold", () => {
		using tempDir = TempDir.createSync("@omp-fleet-incident-distinct-");
		const store = new FleetIncidentStore(`${tempDir.path()}/control.sqlite`);

		expect(store.recordFailure(network("same-1", "agent-a", 1_000))).toBeUndefined();
		expect(store.recordFailure(network("same-2", "agent-a", 1_001))).toBeUndefined();
		expect(store.recordFailure(network("same-3", "agent-a", 1_002))).toBeUndefined();
		expect(store.recordFailure(network("other", "agent-b", 1_003))).toBeUndefined();
		expect(store.listIncidents()).toEqual([]);

		store.close();
	});

	it("uses a sliding window and drops stale unassigned evidence", () => {
		using tempDir = TempDir.createSync("@omp-fleet-incident-window-");
		const store = new FleetIncidentStore(`${tempDir.path()}/control.sqlite`, { windowMs: 120 });

		expect(store.recordFailure(network("stale", "agent-a", 0))).toBeUndefined();
		expect(store.recordFailure(network("fresh-b", "agent-b", 121))).toBeUndefined();
		expect(store.recordFailure(network("fresh-c", "agent-c", 122))).toBeUndefined();
		const incident = store.recordFailure(network("fresh-d", "agent-d", 123));

		expect(incident?.evidence.map(item => item.agent)).toEqual(["agent-b", "agent-c", "agent-d"]);
		store.close();
	});

	it("leaves provider-class failures out of incident evidence", () => {
		using tempDir = TempDir.createSync("@omp-fleet-incident-provider-");
		const store = new FleetIncidentStore(`${tempDir.path()}/control.sqlite`);

		expect(
			store.recordFailure({ evidenceKey: "provider", agent: "provider-agent", job: "provider", failureClass: "provider", occurredAt: 1_000 }),
		).toBeUndefined();
		store.recordFailure(network("network-a", "agent-a", 1_001));
		store.recordFailure(network("network-b", "agent-b", 1_002));
		const incident = store.recordFailure(network("network-c", "agent-c", 1_003));

		expect(incident?.evidence).toHaveLength(3);
		expect(incident?.evidence.some(item => item.agent === "provider-agent")).toBe(false);
		store.close();
	});

	it("opens a new id when failures recur after a closed incident", async () => {
		using tempDir = TempDir.createSync("@omp-fleet-incident-reopen-");
		const ids = ["incident-first", "incident-second"];
		const store = new FleetIncidentStore(`${tempDir.path()}/control.sqlite`, {
			now: () => 10_000,
			createId: () => ids.shift() ?? "unexpected-id",
		});
		const salvaged: Array<{ incident: string; agent: string }> = [];
		const coordinator = new FleetIncidentCoordinator(
			store,
			quietHooks({
				salvage: (incident: FleetIncident, agent) => {
					salvaged.push({ incident: incident.id, agent });
				},
			}),
		);

		coordinator.recordFailure(network("first-a", "agent-a", 1_000));
		coordinator.recordFailure(network("first-b", "agent-b", 1_001));
		const first = coordinator.recordFailure(network("first-c", "agent-c", 1_002));
		await coordinator.waitForIdle();
		expect(store.getIncident(first?.id ?? "missing")?.status).toBe("closed");

		coordinator.recordFailure(network("second-a", "agent-a", 2_000));
		coordinator.recordFailure(network("second-b", "agent-b", 2_001));
		const second = coordinator.recordFailure(network("second-c", "agent-c", 2_002));
		await coordinator.waitForIdle();

		expect(first?.id).toBe("incident-first");
		expect(second?.id).toBe("incident-second");
		expect(second?.id).not.toBe(first?.id);
		expect(store.listIncidents()).toHaveLength(2);
		expect(salvaged.filter(item => item.incident === "incident-first")).toHaveLength(3);
		expect(salvaged.filter(item => item.incident === "incident-second")).toHaveLength(3);

		await coordinator.close();
		store.close();
	});

	it("revives only matching owned children without user cancellation", async () => {
		using tempDir = TempDir.createSync("@omp-fleet-incident-salvage-");
		const store = new FleetIncidentStore(`${tempDir.path()}/control.sqlite`);
		const agents: Record<string, FleetSalvageAgent> = {
			matching: { id: "matching", kind: "sub", parentId: "Main", status: "parked" },
			cancelled: { id: "cancelled", kind: "sub", parentId: "Main", status: "parked" },
			healthy: { id: "healthy", kind: "sub", parentId: "Main", status: "running" },
			provider: { id: "provider", kind: "sub", parentId: "Main", status: "parked" },
		};
		const journalled = new Set<string>();
		const resumed: string[] = [];
		const coordinator = new FleetIncidentCoordinator(
			store,
			quietHooks({
				shouldSalvage: (_incident, agent) => agent === "matching",
				salvage: async (incident, agent) => {
					await salvageFleetIncidentAgent(incident, agent, {
						resolveAgent: id => agents[id],
						journalShowsUserCancellation: id => id === "cancelled",
						journalAttempt: (_current, id) => {
							if (journalled.has(id)) return false;
							journalled.add(id);
							return true;
						},
						sendResume: (_current, id) => {
							resumed.push(id);
						},
					});
				},
			}),
		);

		coordinator.recordFailure({
			evidenceKey: "provider",
			agent: "provider",
			job: "provider",
			failureClass: "provider",
			occurredAt: 999,
		});
		coordinator.recordFailure(network("matching", "matching", 1_000));
		coordinator.recordFailure(network("cancelled", "cancelled", 1_001));
		coordinator.recordFailure(network("healthy", "healthy", 1_002));
		await coordinator.waitForIdle();

		expect(resumed).toEqual(["matching"]);
		expect(journalled).toEqual(new Set(["matching"]));
		expect(resumed).not.toContain("provider");
		await coordinator.close();
		store.close();
	});
});
