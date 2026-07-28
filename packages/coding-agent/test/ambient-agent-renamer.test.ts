import { describe, expect, test } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { AmbientAgentRenamer, type AmbientRenameCompletion } from "../src/irc/ambient-agent-renamer";
import type { IrcExternalPeer } from "../src/irc/bus-external";
import { AgentSession } from "../src/session/agent-session";
import { SessionManager } from "../src/session/session-manager";

const NOW = Date.parse("2026-07-12T12:00:00.000Z");

function peer(overrides: Partial<IrcExternalPeer> = {}): IrcExternalPeer {
	return {
		sessionId: "session-1",
		name: "coding-agent-a1b2c3",
		cwd: "/work/coding-agent",
		pid: 123,
		lastSeen: new Date(NOW - 10 * 60_000).toISOString(),
		state: "idle",
		stateTs: new Date(NOW - 10 * 60_000).toISOString(),
		explicitName: false,
		...overrides,
	};
}

function harness(peers: IrcExternalPeer[], complete: AmbientRenameCompletion) {
	const renamed: Array<{ sessionId: string; name: string }> = [];
	let scheduled: (() => void) | undefined;
	const renamer = new AmbientAgentRenamer({
		bus: {
			listPeers: () => peers,
			updatePeerName: (sessionId, name) => {
				renamed.push({ sessionId, name });
				return true;
			},
		},
		complete,
		now: () => NOW,
		setInterval: callback => {
			scheduled = callback;
			return { unref() {} } as ReturnType<typeof setInterval>;
		},
		clearInterval: () => {},
	});
	return { renamer, renamed, runScheduled: () => scheduled?.() };
}

describe("AmbientAgentRenamer", () => {
	test("fake-clock tick renames a stale automatic main-session label with smol", async () => {
		const calls: string[] = [];
		const h = harness([peer()], async (prompt, options) => {
			calls.push(`${options.model}:${prompt}`);
			return "Reviewing queue durability";
		});
		h.renamer.start();
		h.runScheduled();
		await Promise.resolve();
		await Promise.resolve();
		expect(h.renamed).toEqual([{ sessionId: "session-1", name: "Reviewing queue durability" }]);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.startsWith("smol:")).toBe(true);
		h.renamer.stop();
	});

	test("leaves explicit and heuristic user names untouched", async () => {
		let calls = 0;
		const h = harness(
			[peer({ explicitName: true }), peer({ sessionId: "session-2", name: "Arthur Main", explicitName: false })],
			async () => {
				calls++;
				return "Changing label";
			},
		);
		await h.renamer.tick();
		expect(calls).toBe(0);
		expect(h.renamed).toEqual([]);
	});

	test("completion errors skip the tick quietly", async () => {
		const h = harness([peer()], async () => {
			throw new Error("provider busy");
		});
		await expect(h.renamer.tick()).resolves.toBeUndefined();
		expect(h.renamed).toEqual([]);
	});
});

test("AgentSession starts and stops the ambient renamer only when enabled", async () => {
	const peers = [peer()];
	const renamed: Array<{ sessionId: string; name: string }> = [];
	let scheduled: (() => void) | undefined;
	let schedules = 0;
	let clears = 0;
	const createSession = (enabled: boolean) =>
		new AgentSession({
			agent: new Agent({
				initialState: { systemPrompt: ["Test"], tools: [], messages: [] },
			}),
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({
				"compaction.enabled": false,
				"irc.ambientRename.enabled": enabled,
				"irc.ambientRename.intervalMs": 1234,
			}),
			modelRegistry: { getAvailable: () => [] } as unknown as ModelRegistry,
			ambientAgentRenamer: {
				bus: {
					listPeers: () => peers,
					updatePeerName: (sessionId, name) => {
						renamed.push({ sessionId, name });
						return true;
					},
				},
				complete: async (_prompt, options) => {
					expect(options.model).toBe("smol");
					return "Wiring session bootstrap";
				},
				now: () => NOW,
				setInterval: (callback, intervalMs) => {
					expect(intervalMs).toBe(1234);
					schedules++;
					scheduled = callback;
					return { unref() {} } as ReturnType<typeof setInterval>;
				},
				clearInterval: () => {
					clears++;
				},
			},
		});

	const disabled = createSession(false);
	expect(schedules).toBe(0);
	await disabled.dispose();
	expect(clears).toBe(0);

	const enabled = createSession(true);
	expect(schedules).toBe(1);
	scheduled?.();
	await Promise.resolve();
	await Promise.resolve();
	expect(renamed).toEqual([{ sessionId: "session-1", name: "Wiring session bootstrap" }]);
	await enabled.dispose();
	expect(clears).toBe(1);
});
