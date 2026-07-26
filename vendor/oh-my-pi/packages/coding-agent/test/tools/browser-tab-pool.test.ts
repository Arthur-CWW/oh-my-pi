import { describe, expect, test } from "bun:test";
import { formatTabs } from "../../src/slash-commands/tabs";
import type { CmuxTabSession, WorkerTabSession } from "../../src/tools/browser/tab-supervisor";
import { acquireTab, listTabs, registerTabForTest } from "../../src/tools/browser/tab-supervisor";

function workerTab(name: string, kind: "spawned" | "connected"): WorkerTabSession {
	const browser = {
		key: `external-${name}`,
		kind: kind === "spawned" ? { kind, path: "/Applications/Test.app" } : { kind, cdpUrl: "http://127.0.0.1:9222" },
		refCount: 1,
		browser: Object.assign(Object.create(null), { connected: true, targets: () => [] }),
		stealth: { browserSession: null, override: null },
	} as WorkerTabSession["browser"];
	return {
		name,
		browser,
		targetId: `target-${name}`,
		backend: "worker",
		worker: {
			mode: "worker",
			send() {},
			onMessage: () => () => {},
			onError: () => () => {},
			async terminate() {},
		},
		state: "alive",
		info: { url: "about:blank", targetId: `target-${name}`, viewport: { width: 800, height: 600 } },
		pending: new Map(),
		kindTag: kind,
		group: "adhoc",
		ownerSessionId: "external-session",
		ownerAgentId: "ExternalAgent",
		purpose: "exemption-test",
		createdAt: 1,
		lastUsedAt: 1,
		urlKey: "about:blank",
	};
}

function cmuxTab(name: string): CmuxTabSession {
	return {
		name,
		browser: {
			key: `external-${name}`,
			kind: { kind: "cmux", socketPath: "/tmp/cmux.sock" },
			refCount: 1,
			client: { request: async () => ({}) },
		} as unknown as CmuxTabSession["browser"],
		targetId: `surface-${name}`,
		backend: "cmux",
		cmuxTab: {} as CmuxTabSession["cmuxTab"],
		cmuxOwnsSurface: false,
		state: "alive",
		info: { url: "about:blank", targetId: `surface-${name}`, viewport: { width: 800, height: 600 } },
		pending: new Map(),
		kindTag: "cmux",
		group: "adhoc",
		ownerSessionId: "external-session",
		ownerAgentId: "ExternalAgent",
		purpose: "exemption-test",
		createdAt: 1,
		lastUsedAt: 1,
		urlKey: "about:blank",
	};
}

describe("browser external tab budget exemption", () => {
	test("cmux, spawned-app, and connected-CDP tabs survive budget sweeps and are listed as external", async () => {
		const spawned = workerTab("spawned", "spawned");
		const connected = workerTab("connected", "connected");
		const cmux = cmuxTab("cmux");
		const unregister = [registerTabForTest(spawned), registerTabForTest(connected), registerTabForTest(cmux)];
		try {
			const result = await acquireTab(spawned.name, spawned.browser, {
				timeoutMs: 1_000,
				tabIdleTtlMs: 0,
				sessionId: "external-session",
				maxTabsPerSession: 1,
				maxGlobalTabs: 1,
			});
			expect(result).toMatchObject({ created: false, tab: { name: "spawned" } });
			const entries = listTabs(10);
			expect(entries.map(entry => [entry.name, entry.exempt])).toEqual([
				["spawned", "external"],
				["connected", "external"],
				["cmux", "external"],
			]);
			const listing = formatTabs(entries);
			expect(listing.match(/exempt: external/g)).toHaveLength(3);
		} finally {
			for (const cleanup of unregister) cleanup();
		}
	});
});
