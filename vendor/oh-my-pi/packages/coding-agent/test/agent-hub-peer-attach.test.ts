import { pressHub } from "./helpers/agent-hub-input";
import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import {
	type AgentHubExternalPeer,
	type AgentHubExternalPeerDataSource,
	AgentHubOverlayComponent,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import type { FocusCmuxOwnerResult } from "@oh-my-pi/pi-coding-agent/modes/utils/cmux-owner-navigation";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";

function liveSession(): AgentSession {
	const session: Pick<AgentSession, "subscribe"> = { subscribe: () => () => {} };
	return session as AgentSession;
}

function externalPeer(overrides: Partial<AgentHubExternalPeer> = {}): AgentHubExternalPeer {
	return {
		sessionId: "peer-session",
		name: "peer",
		cwd: "/tmp/peer",
		pid: 100,
		lastSeen: new Date().toISOString(),
		state: "idle",
		stateTs: null,
		sessionFile: "/tmp/peer-session.jsonl",
		...overrides,
	};
}

function renderedText(hub: AgentHubOverlayComponent): string {
	return hub.render(120).map(line => Bun.stripANSI(line)).join("\n");
}

async function waitForNotice(hub: AgentHubOverlayComponent, notice: string): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (!renderedText(hub).includes(notice)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${notice}`);
		await Bun.sleep(1);
	}
}

function makeHub(options: {
	peers?: AgentHubExternalPeer[];
	localAgent?: boolean;
	focusExternalOwner: (sessionFile: string, sessionId: string) => Promise<FocusCmuxOwnerResult>;
}): AgentHubOverlayComponent {
	const registry = new AgentRegistry();
	if (options.localAgent) {
		registry.register({ id: "Worker", displayName: "Worker", kind: "sub", session: liveSession() });
	}
	const externalIrc: AgentHubExternalPeerDataSource = {
		listPeers: () => options.peers ?? [],
	};
	return new AgentHubOverlayComponent({
		observers: new SessionObserverRegistry(),
		hubKeys: [],
		onDone: () => {},
		requestRender: () => {},
		registry,
		irc: new IrcBus(registry),
		externalIrc,
		externalSessionId: "local-session",
		focusExternalOwner: options.focusExternalOwner,
	});
}

function startAttach(hub: AgentHubOverlayComponent): void {
	pressHub(hub, "g");
	pressHub(hub, "a");
}

describe("Agent Hub external peer attach", () => {
	const hubs: AgentHubOverlayComponent[] = [];

	beforeAll(async () => {
		await initTheme(false);
	});

	afterEach(() => {
		for (const hub of hubs.splice(0)) hub.dispose();
	});

	it("focuses the selected external owner and keeps the hub open", async () => {
		const calls: Array<[string, string]> = [];
		const peer = externalPeer();
		const hub = makeHub({
			peers: [peer],
			focusExternalOwner: async (sessionFile, sessionId) => {
				calls.push([sessionFile, sessionId]);
				return { kind: "focused" };
			},
		});
		hubs.push(hub);

		startAttach(hub);
		await waitForNotice(hub, "focused peer in cmux");

		expect(calls).toEqual([[peer.sessionFile!, peer.sessionId]]);
		expect(renderedText(hub)).toContain("❯");
	});

	it("renders the unavailable owner message", async () => {
		const hub = makeHub({
			peers: [externalPeer()],
			focusExternalOwner: async () => ({ kind: "unavailable" }),
		});
		hubs.push(hub);

		startAttach(hub);
		await waitForNotice(hub, "The active cmux session is no longer available. This view remains read-only.");
	});

	it("reports peers from older builds without a session file", async () => {
		const calls: string[] = [];
		const hub = makeHub({
			peers: [externalPeer({ sessionFile: undefined })],
			focusExternalOwner: async sessionFile => {
				calls.push(sessionFile);
				return { kind: "focused" };
			},
		});
		hubs.push(hub);

		startAttach(hub);
		await waitForNotice(hub, "peer publishes no session file (older build)");
		expect(calls).toEqual([]);
	});

	it("rejects ga when the selected row is not external", async () => {
		const calls: string[] = [];
		const hub = makeHub({
			localAgent: true,
			focusExternalOwner: async sessionFile => {
				calls.push(sessionFile);
				return { kind: "focused" };
			},
		});
		hubs.push(hub);

		startAttach(hub);
		await waitForNotice(hub, "ga targets external peers only.");
		expect(calls).toEqual([]);
	});
});
