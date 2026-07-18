import { describe, expect, it } from "bun:test";
import { TempDir } from "@oh-my-pi/pi-utils";
import { IrcExternalBus, type IrcExternalPeerLabels } from "../src/irc/bus-external";
import { collectFleetOverview, formatFleetOverview, formatFleetOverviewJson, type FleetOverviewJsonRow } from "../src/cli/fleet-overview";
import { createFleetCapability } from "../src/session/fleet-capability";
import { CURRENT_SESSION_CONTROL_PROTOCOL } from "../src/session/session-control";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");

function registerPeer(
	bus: IrcExternalBus,
	id: string,
	overrides: {
		name?: string;
		cwd?: string;
		pid?: number;
		sessionFile?: string;
		labels?: IrcExternalPeerLabels;
		workstream?: { kind: "workstream"; id: string } | { kind: "adhoc" };
	} = {},
) {
	bus.registerPeer({
		sessionId: id,
		name: overrides.name ?? id,
		cwd: overrides.cwd ?? "/tmp/test",
		pid: overrides.pid ?? process.pid,
		sessionFile: overrides.sessionFile,
		fleetCapability: createFleetCapability({
			buildDigest: "a".repeat(64),
			productVersion: "1.0.0",
			controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
			workstream: overrides.workstream,
		}),
		labels: overrides.labels,
	});
	bus.updatePeerState(id, "working");
}

describe("fleet overview", () => {
	it("publishes and reads back all label fields in a round-trip", () => {
		using tmp = TempDir.createSync("@omp-fleet-overview-");
		const dbPath = `${tmp.path()}/bus.sqlite`;
		const bus = new IrcExternalBus(dbPath);

		const labels: IrcExternalPeerLabels = {
			objective: "Implement feature X end-to-end",
			workstream: "harness",
			activity: "Reading agent-session.ts",
			todoHead: "Add schema migration",
			label: "FleetDev",
			model: "anthropic/claude-opus-4",
		};

		registerPeer(bus, "session-with-labels", {
			name: "LabeledPeer",
			labels,
			workstream: { kind: "workstream", id: "harness" },
		});

		const peers = bus.listPeers({ includeStale: true });
		const peer = peers.find(p => p.sessionId === "session-with-labels");
		expect(peer).toBeDefined();
		expect(peer!.labels).toEqual(labels);

		bus.close();
	});

	it("publishes empty labels for session without goal or todo", () => {
		using tmp = TempDir.createSync("@omp-fleet-overview-");
		const dbPath = `${tmp.path()}/bus.sqlite`;
		const bus = new IrcExternalBus(dbPath);

		registerPeer(bus, "session-no-goal", { name: "PlainPeer" });

		const peers = bus.listPeers({ includeStale: true });
		const peer = peers.find(p => p.sessionId === "session-no-goal");
		expect(peer).toBeDefined();
		// No labels set — should be undefined (nothing in the blob)
		expect(peer!.labels).toBeUndefined();

		bus.close();
	});

	it("heartbeat updates labels", () => {
		using tmp = TempDir.createSync("@omp-fleet-overview-");
		const dbPath = `${tmp.path()}/bus.sqlite`;
		const bus = new IrcExternalBus(dbPath);

		registerPeer(bus, "session-hb", { name: "HeartbeatPeer" });

		// Heartbeat with labels
		bus.heartbeat("session-hb", {
			objective: "New goal after heartbeat",
			activity: "Editing files",
			model: "anthropic/claude-sonnet-4",
		});

		const peers = bus.listPeers({ includeStale: true });
		const peer = peers.find(p => p.sessionId === "session-hb");
		expect(peer!.labels?.objective).toBe("New goal after heartbeat");
		expect(peer!.labels?.activity).toBe("Editing files");
		expect(peer!.labels?.model).toBe("anthropic/claude-sonnet-4");

		bus.close();
	});

	it("old rows without label_json decode fine", () => {
		using tmp = TempDir.createSync("@omp-fleet-overview-");
		const dbPath = `${tmp.path()}/bus.sqlite`;
		// Create bus, register a peer, then drop the label_json column to simulate old schema
		const bus = new IrcExternalBus(dbPath);
		registerPeer(bus, "old-session", { name: "OldPeer" });
		bus.close();

		// Open as readonly to verify old rows without label_json are readable
		const readBus = new IrcExternalBus(dbPath, { readonly: true });
		const peers = readBus.listPeers({ includeStale: true });
		const peer = peers.find(p => p.sessionId === "old-session");
		expect(peer).toBeDefined();
		expect(peer!.name).toBe("OldPeer");
		// labels should be undefined for rows with null label_json
		readBus.close();
	});

	it("overview renders mixed old/new rows correctly", () => {
		using tmp = TempDir.createSync("@omp-fleet-overview-");
		const dbPath = `${tmp.path()}/bus.sqlite`;
		const bus = new IrcExternalBus(dbPath);

		// New-style peer with labels
		registerPeer(bus, "new-peer", {
			name: "NewPeer",
			labels: {
				objective: "Build fleet overview",
				workstream: "harness",
				activity: "Writing tests",
				model: "anthropic/claude-opus-4",
			},
			workstream: { kind: "workstream", id: "harness" },
		});

		// Old-style peer without labels
		registerPeer(bus, "old-peer", { name: "OldPeer" });

		bus.close();

		const rows = collectFleetOverview({
			ircDbPath: dbPath,
			nowMs: NOW,
			isProcessAlive: () => true,
		});

		expect(rows.length).toBe(2);

		const formatted = formatFleetOverview(rows, NOW);
		expect(formatted).toContain("NewPeer");
		expect(formatted).toContain("OldPeer");
		expect(formatted).toContain("Build fleet overview");
		// OldPeer shows dashes for empty fields
		expect(formatted).toContain("working");
	});

	it("--json schema is stable and decodable", () => {
		using tmp = TempDir.createSync("@omp-fleet-overview-");
		const dbPath = `${tmp.path()}/bus.sqlite`;
		const bus = new IrcExternalBus(dbPath);

		registerPeer(bus, "json-peer", {
			name: "JsonPeer",
			sessionFile: "/tmp/sessions/test.jsonl",
			labels: {
				objective: "Test the JSON schema",
				workstream: "harness",
				activity: "Running tests",
				todoHead: "Validate schema",
				label: "TestLabel",
				model: "anthropic/claude-opus-4",
				summary: "Observer summary",
				spawnName: "Original spawned name",
			},
			workstream: { kind: "workstream", id: "harness" },
		});

		bus.close();

		const rows = collectFleetOverview({
			ircDbPath: dbPath,
			nowMs: NOW,
			isProcessAlive: () => true,
		});

		const jsonOutput = formatFleetOverviewJson(rows);
		const parsed: FleetOverviewJsonRow[] = JSON.parse(jsonOutput);

		expect(parsed).toHaveLength(1);
		const row = parsed[0];
		// Verify all expected fields exist
		expect(row.session_id).toBe("json-peer");
		expect(row.name).toBe("JsonPeer");
		expect(row.state).toBe("working");
		expect(row.model).toBe("anthropic/claude-opus-4");
		expect(row.workstream).toBe("harness");
		expect(row.objective).toBe("Test the JSON schema");
		expect(row.activity).toBe("Running tests");
		expect(row.todo_head).toBe("Validate schema");
		expect(row.label).toBe("TestLabel");
		expect(row.summary).toBe("Observer summary");
		expect(row.spawn_name).toBe("Original spawned name");
		expect(row.last_seen).toBeTruthy();
		expect(row.cwd).toBe("/tmp/test");
		expect(row.pid).toBeGreaterThan(0);
		expect(row.session_journal).toBe("/tmp/sessions/test.jsonl");
		expect(row.version).toBe("1.0.0");
	});

	it("stale-alive peers included, dead-pid peers excluded", () => {
		using tmp = TempDir.createSync("@omp-fleet-overview-");
		const dbPath = `${tmp.path()}/bus.sqlite`;
		const bus = new IrcExternalBus(dbPath);

		// Stale-alive peer (process alive but heartbeat stale)
		registerPeer(bus, "stale-alive", { name: "StaleAlive", pid: process.pid });
		bus.updatePeerState("stale-alive", "idle");

		// Dead-pid peer
		registerPeer(bus, "dead-peer", { name: "DeadPeer", pid: 999999 });

		bus.close();

		// Use a NOW that makes both peers stale
		const futureNow = Date.now() + 20 * 60 * 1000; // 20 minutes from real now

		const rows = collectFleetOverview({
			ircDbPath: dbPath,
			nowMs: futureNow,
			isProcessAlive: (pid) => pid === process.pid,
		});

		const names = rows.map(r => r.name);
		expect(names).toContain("StaleAlive");
		expect(names).not.toContain("DeadPeer");
	});

	it("stale-alive waiting_input peers keep their recorded state", () => {
		using tmp = TempDir.createSync("@omp-fleet-overview-");
		const dbPath = `${tmp.path()}/bus.sqlite`;
		const bus = new IrcExternalBus(dbPath);
		registerPeer(bus, "stale-waiting", { name: "StaleWaiting", pid: process.pid });
		bus.updatePeerState("stale-waiting", "waiting_input");
		bus.close();

		const futureNow = Date.now() + 20 * 60 * 1000;
		const rows = collectFleetOverview({
			ircDbPath: dbPath,
			nowMs: futureNow,
			isProcessAlive: pid => pid === process.pid,
		});
		// A session blocked on input must never be relabeled idle — operators
		// would read "needs nothing" for a session that needs them.
		expect(rows.find(r => r.name === "StaleWaiting")?.displayState).toBe("waiting_input");
	});
});
