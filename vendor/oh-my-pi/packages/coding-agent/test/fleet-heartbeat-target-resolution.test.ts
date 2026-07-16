import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it, vi } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { resolveFleetSelectors } from "../src/cli/fleet-target-resolution";
import {
	IRC_EXTERNAL_STALE_MS,
	IrcExternalBus,
} from "../src/irc/bus-external";
import { AuthStorage } from "../src/session/auth-storage";
import { AgentSession } from "../src/session/agent-session";
import { SessionManager } from "../src/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

const originalHome = process.env.HOME;
const originalControlDb = process.env.OMP_SESSION_CONTROL_DB;
const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
	for (const dispose of cleanup.splice(0)) await dispose();
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	if (originalControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
	else process.env.OMP_SESSION_CONTROL_DB = originalControlDb;
});


async function createHeartbeatSession(): Promise<{ readonly session: AgentSession; readonly bus: IrcExternalBus }> {
	const tempDir = TempDir.createSync("@omp-hr138-heartbeat-");
	process.env.HOME = tempDir.path();
	process.env.OMP_SESSION_CONTROL_DB = `${tempDir.path()}/session-control.sqlite`;
	const bus = new IrcExternalBus(`${tempDir.path()}/irc.sqlite`);
	const auth = await AuthStorage.create(`${tempDir.path()}/auth.sqlite`);
	const modelRegistry = new ModelRegistry(auth);
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("Expected bundled test model");
	const session = new AgentSession({
		agent: new Agent({ initialState: { model, systemPrompt: ["test"], tools: [], messages: [] } }),
		sessionManager: SessionManager.create(tempDir.path(), `${tempDir.path()}/sessions`),
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry,
		externalIrcBus: bus,
		externalIrcHeartbeatIntervalMs: 5,
	});
	cleanup.push(async () => {
		await session.dispose();
		auth.close();
		bus.close();
		tempDir.removeSync();
	});
	return { session, bus };
}

describe("HR-138 idle peer liveness", () => {
	it("advances last_seen for an idle session with a short injected interval", async () => {
		vi.useFakeTimers();
		try {
			const { session, bus } = await createHeartbeatSession();
			session.beginExternalIrcWaitingInput();
			const initial = bus.listPeers({ includeStale: true })[0];
			expect(initial).toBeDefined();
			vi.advanceTimersByTime(5);
			const current = bus.listPeers({ includeStale: true })[0];
			expect(Date.parse(current!.lastSeen)).toBeGreaterThan(Date.parse(initial!.lastSeen));
		} finally {
			vi.useRealTimers();
		}
	});

	it("stops the idle heartbeat when the session is disposed", async () => {
		vi.useFakeTimers();
		try {
			const { session, bus } = await createHeartbeatSession();
			session.beginExternalIrcWaitingInput();
			const beforeDispose = bus.listPeers({ includeStale: true })[0]!.lastSeen;
			await session.dispose();
			vi.advanceTimersByTime(25);
			expect(bus.listPeers({ includeStale: true })[0]!.lastSeen).toBe(beforeDispose);
		} finally {
			vi.useRealTimers();
		}
	});

	it("resolves stale idle rows with live pids and excludes stale dead pids", async () => {
		const tempDir = TempDir.createSync("@omp-hr138-targets-");
		const bus = new IrcExternalBus(`${tempDir.path()}/irc.sqlite`);
		cleanup.push(() => {
			bus.close();
			tempDir.removeSync();
		});
		const alivePid = 12345;
		const deadPid = 54321;
		bus.registerPeer({ sessionId: "stale-alive", name: "canary-alive", cwd: tempDir.path(), pid: alivePid });
		bus.updatePeerState("stale-alive", "idle");
		bus.registerPeer({ sessionId: "stale-dead", name: "canary-dead", cwd: tempDir.path(), pid: deadPid });
		bus.updatePeerState("stale-dead", "idle");
		const db = new Database(`${tempDir.path()}/irc.sqlite`);
		db.query("UPDATE peers SET last_seen = $lastSeen").run({
			$lastSeen: new Date(Date.now() - IRC_EXTERNAL_STALE_MS - 1).toISOString(),
		});
		db.close();
		const isProcessAlive = (pid: number): boolean => pid === alivePid;
		const targets = await resolveFleetSelectors({ bus, isProcessAlive });
		expect(targets.map(target => target.peer.sessionId)).toEqual(["stale-alive"]);
		expect(targets[0]?.peer.state).toBe("idle");
	});
});
