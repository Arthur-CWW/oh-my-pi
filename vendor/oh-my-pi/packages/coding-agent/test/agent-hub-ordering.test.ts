/**
 * Regression: the agent hub row order must be stable while the hub is open.
 *
 * Agent positions follow first appearance (registry spawn order), not
 * lastActivity/status. Keyboard selection must not jump around as agents
 * heartbeat or update activity. New agents append at the end.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import {
	type AgentHubExternalPeer,
	type AgentHubExternalPeerDataSource,
	AgentHubOverlayComponent,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";

interface GeometryStub {
	setRows(n: number): void;
	restore(): void;
}

function stubStdoutGeometry(cols: number): GeometryStub {
	const rowsDesc = Object.getOwnPropertyDescriptor(process.stdout, "rows");
	const colsDesc = Object.getOwnPropertyDescriptor(process.stdout, "columns");
	let rows = 24;
	Object.defineProperty(process.stdout, "rows", { configurable: true, get: () => rows });
	Object.defineProperty(process.stdout, "columns", { configurable: true, get: () => cols });
	const restoreOne = (key: "rows" | "columns", desc: PropertyDescriptor | undefined) => {
		if (desc) Object.defineProperty(process.stdout, key, desc);
		else Object.defineProperty(process.stdout, key, { configurable: true, value: undefined, writable: true });
	};
	return {
		setRows(n: number) {
			rows = n;
		},
		restore() {
			restoreOne("rows", rowsDesc);
			restoreOne("columns", colsDesc);
		},
	};
}

function makeHub(
	agents: AgentRegistry,
	options: { externalIrc?: AgentHubExternalPeerDataSource | null; externalSessionId?: string } = {},
) {
	return new AgentHubOverlayComponent({
		observers: new SessionObserverRegistry(),
		hubKeys: [],
		onDone: () => {},
		requestRender: () => {},
		registry: agents,
		irc: new IrcBus(agents),
		focusAgent: async () => {},
		externalIrc: options.externalIrc ?? null,
		externalSessionId: options.externalSessionId,
	});
}

function renderedAgentIds(hub: AgentHubOverlayComponent): string[] {
	return hub
		.render(120)
		.map(line => Bun.stripANSI(line))
		.map(line => line.split(" · "))
		.filter(
			parts =>
				parts.length >= 4 && ["running", "idle", "parked", "aborted"].some(status => parts[0].endsWith(status)),
		)
		.map(parts => parts[1]!);
}

function renderedExternalPeerNames(hub: AgentHubOverlayComponent): string[] {
	return hub
		.render(120)
		.map(line => Bun.stripANSI(line))
		.map(line => line.split(" · "))
		.filter(parts => parts.length >= 5 && parts[2] === "external")
		.map(parts => parts[1]!);
}

function externalPeer(
	sessionId: string,
	name: string,
	lastSeen: string,
	state: AgentHubExternalPeer["state"],
): AgentHubExternalPeer {
	return {
		sessionId,
		name,
		cwd: `/tmp/${name}`,
		pid: 100,
		lastSeen,
		state,
	};
}

describe("Agent hub row ordering", () => {
	let geometry: GeometryStub | undefined;

	beforeAll(async () => {
		await initTheme();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		geometry?.restore();
		geometry = undefined;
		AgentRegistry.resetGlobalForTests();
	});

	it("freezes spawn order while the hub is open", () => {
		geometry = stubStdoutGeometry(120);
		const now = vi.spyOn(Date, "now");
		const agents = new AgentRegistry();
		const sessions = new Map<string, AgentSession>();

		now.mockReturnValue(1000);
		const sessionA = {} as AgentSession;
		sessions.set("A", sessionA);
		agents.register({ id: "A", displayName: "Alpha", kind: "sub", session: sessionA });

		now.mockReturnValue(2000);
		const sessionB = {} as AgentSession;
		sessions.set("B", sessionB);
		agents.register({ id: "B", displayName: "Beta", kind: "sub", session: sessionB });

		now.mockReturnValue(3000);
		const sessionC = {} as AgentSession;
		sessions.set("C", sessionC);
		agents.register({ id: "C", displayName: "Gamma", kind: "sub", session: sessionC });

		const hub = makeHub(agents);
		expect(renderedAgentIds(hub)).toEqual(["A", "B", "C"]);

		// Bump A's lastActivity far ahead of the others. Activity changes are
		// display-only and must not move a spawned row.
		now.mockReturnValue(4000);
		agents.setActivity("A", "still running");

		// Force a refresh by registering a new agent; the existing rows must stay put.
		now.mockReturnValue(5000);
		const sessionD = {} as AgentSession;
		agents.register({ id: "D", displayName: "Delta", kind: "sub", session: sessionD });

		expect(renderedAgentIds(hub)).toEqual(["A", "B", "C", "D"]);

		hub.dispose();
	});

	it("keeps external peers in first-seen order and appends newcomers", () => {
		geometry = stubStdoutGeometry(120);
		const now = vi.spyOn(Date, "now");
		now.mockReturnValue(Date.parse("2026-07-03T00:00:00.000Z"));
		const lastSeen = new Date(Date.now()).toISOString();
		const agents = new AgentRegistry();
		let peers = [
			externalPeer("external:alpha", "alpha", lastSeen, "working"),
			externalPeer("external:beta", "beta", lastSeen, "idle"),
		];
		const externalIrc: AgentHubExternalPeerDataSource = {
			listPeers: () => peers,
		};

		const hub = makeHub(agents, { externalIrc, externalSessionId: "this-session" });
		expect(renderedExternalPeerNames(hub)).toEqual(["alpha", "beta"]);
		hub.handleInput("\r");
		expect(Bun.stripANSI(hub.render(120).join("\n"))).toContain("message with: omp irc send alpha …");

		peers = [
			externalPeer("external:beta", "beta", lastSeen, "idle"),
			externalPeer("external:alpha", "alpha", lastSeen, "working"),
			externalPeer("external:gamma", "gamma", lastSeen, "waiting_input"),
		];
		agents.register({ id: "refresh", displayName: "Refresh", kind: "sub", session: {} as AgentSession });

		expect(renderedExternalPeerNames(hub)).toEqual(["alpha", "beta", "gamma"]);
		hub.dispose();
	});

	it("shows unknown state when external peer state is absent", () => {
		geometry = stubStdoutGeometry(120);
		const now = vi.spyOn(Date, "now");
		now.mockReturnValue(Date.parse("2026-07-03T00:00:00.000Z"));
		const lastSeen = new Date(Date.now()).toISOString();
		const agents = new AgentRegistry();
		const externalIrc: AgentHubExternalPeerDataSource = {
			listPeers: () => [externalPeer("external:nemo", "nemo", lastSeen, undefined)],
		};

		const hub = makeHub(agents, { externalIrc, externalSessionId: "this-session" });
		const rendered = Bun.stripANSI(hub.render(120).join("\n"));

		expect(rendered).toContain("nemo");
		expect(rendered).toContain("unknown");
		hub.dispose();
	});

	it("hides external peers when the bus is absent", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		const externalIrc: AgentHubExternalPeerDataSource = {
			listPeers: () => {
				throw new Error("ENOENT: no IRC bus file");
			},
		};

		const hub = makeHub(agents, { externalIrc, externalSessionId: "this-session" });
		const rendered = Bun.stripANSI(hub.render(120).join("\n"));

		expect(rendered).not.toContain("external peers");
		expect(rendered).toContain("no subagents yet");
		hub.dispose();
	});
});
