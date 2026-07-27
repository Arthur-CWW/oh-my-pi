import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	getStatusLinePerformanceCounters,
	resetStatusLinePerformanceCounters,
	StatusLineComponent,
} from "@oh-my-pi/pi-coding-agent/modes/components/status-line";
import { EventController } from "@oh-my-pi/pi-coding-agent/modes/controllers/event-controller";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import type { AgentSession, AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";

beforeAll(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true, cwd: process.cwd() });
	await initTheme();
});

afterAll(() => {
	resetSettingsForTest();
});

function createSession(): AgentSession {
	const messages: unknown[] = [];
	return {
		messages,
		model: { id: "perf-model", contextWindow: 128_000 },
		state: { messages, model: { id: "perf-model", contextWindow: 128_000 } },
		sessionManager: {
			getUsageStatistics: () => ({
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				premiumRequests: 0,
				cost: 0,
			}),
			getSessionName: () => "perf",
		},
		getAsyncJobSnapshot: () => ({ running: [] }),
		getContextUsage: () => undefined,
	} as unknown as AgentSession;
}

describe("status-line child progress render path", () => {
	it("keeps a 128-event progress burst and typing border reads on the warm cache", async () => {
		const statusLine = new StatusLineComponent(createSession());
		statusLine.updateSettings({
			preset: "custom",
			leftSegments: ["pi"],
			rightSegments: [],
			separator: "ascii",
		});
		resetStatusLinePerformanceCounters();
		await statusLine.refreshGitBranch();
		statusLine.getTopBorder(100);

		let borderUpdates = 0;
		let progressUpdates = 0;
		let renderRequests = 0;
		const pendingProgress = {
			updateResult: () => {
				progressUpdates++;
			},
		};
		const ctx = {
			isInitialized: true,
			statusLine,
			updateEditorTopBorder: () => {
				borderUpdates++;
				statusLine.getTopBorder(100);
			},
			ui: {
				requestRender: () => {
					renderRequests++;
				},
			},
			pendingTools: new Map([["child-progress", pendingProgress]]),
		} as unknown as InteractiveModeContext;
		const controller = new EventController(ctx);
		const progressEvent = {
			type: "tool_execution_update",
			toolCallId: "child-progress",
			toolName: "task",
			partialResult: { content: [], details: { async: { state: "running" } } },
		} as Extract<AgentSessionEvent, { type: "tool_execution_update" }>;

		for (let i = 0; i < 128; i++) await controller.handleEvent(progressEvent);
		for (let i = 0; i < 128; i++) statusLine.getTopBorder(100);
		for (let i = 0; i < 128; i++) statusLine.setSubagentCount(0);
		statusLine.getTopBorder(100);

		const counters = getStatusLinePerformanceCounters();
		expect(progressUpdates).toBe(128);
		expect(renderRequests).toBe(128);
		expect(borderUpdates).toBe(0);
		expect(counters.gitHeadResolutions).toBeLessThanOrEqual(1);
		expect(counters.borderRebuilds).toBeLessThanOrEqual(1);
		statusLine.dispose();
	});
});
