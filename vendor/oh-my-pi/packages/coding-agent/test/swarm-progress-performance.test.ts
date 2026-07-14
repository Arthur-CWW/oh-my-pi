import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "bun:test";
import type { Component, RenderScheduler, RenderTimer } from "@oh-my-pi/pi-tui";
import { TUI } from "@oh-my-pi/pi-tui";
import type { RenderResultOptions } from "@oh-my-pi/pi-agent-core";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	getAgentHubPerfCounters,
	resetAgentHubPerfCounters,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-performance";
import {
	getStatusLinePerformanceCounters,
	resetStatusLinePerformanceCounters,
} from "@oh-my-pi/pi-coding-agent/modes/components/status-line";
import { SubagentHudRenderer } from "@oh-my-pi/pi-coding-agent/modes/components/subagent-hud";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { getThemeByName, setThemeInstance, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { ProgressAggregator } from "@oh-my-pi/pi-coding-agent/task/progress-aggregator";
import {
	getTaskProgressRenderPerformanceCounters,
	resetTaskProgressRenderPerformanceCounters,
	taskToolRenderer,
} from "@oh-my-pi/pi-coding-agent/task/render";
import {
	type AgentProgress,
	TASK_SUBAGENT_PROGRESS_CHANNEL,
	type SubagentProgressPayload,
	type TaskToolDetails,
} from "@oh-my-pi/pi-coding-agent/task";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { VirtualTerminal } from "../../tui/test/virtual-terminal";

const CHILDREN = 120;
const BURST_SIZE = 12;

function progressFor(index: number, burst: number): AgentProgress {
	return {
		index,
		id: `SwarmChild${index}`,
		agent: "task",
		agentSource: "bundled",
		status: "running",
		task: `synthetic assignment ${index}`,
		description: `synthetic child ${index}`,
		recentTools: [],
		recentOutput: [],
		toolCount: burst,
		requests: burst,
		tokens: burst,
		cost: 0,
		durationMs: burst,
	};
}

function payloadFor(index: number, burst: number): SubagentProgressPayload {
	return {
		index,
		agent: "task",
		agentSource: "bundled",
		task: `synthetic assignment ${index}`,
		parentToolCallId: "synthetic-swarm",
		detached: true,
		progress: progressFor(index, burst),
	};
}

class ManualRenderScheduler implements RenderScheduler {
	#now = 0;
	#queue: Array<{ callback: () => void; canceled: boolean }> = [];

	now(): number {
		return this.#now;
	}

	scheduleImmediate(callback: () => void): void {
		this.#queue.push({ callback, canceled: false });
	}

	scheduleRender(callback: () => void, delayMs: number): RenderTimer {
		const scheduled = { callback, canceled: false };
		this.#queue.push(scheduled);
		return { cancel: () => (scheduled.canceled = true) };
	}

	advance(ms: number): void {
		this.#now += ms;
	}

	flush(): void {
		const pending = this.#queue;
		this.#queue = [];
		for (const scheduled of pending) {
			if (!scheduled.canceled) scheduled.callback();
		}
	}
}

class ObserverHudComponent implements Component {
	renders = 0;

	constructor(
		readonly registry: SessionObserverRegistry,
		readonly hud: SubagentHudRenderer,
	) {}

	invalidate(): void {}

	render(width: number): readonly string[] {
		this.renders++;
		return this.hud.render(this.registry.getSessions(), width);
	}
}

beforeAll(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	const dark = await getThemeByName("dark");
	if (!dark) throw new Error("dark theme unavailable");
	setThemeInstance(dark);
});

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("synthetic swarm performance proof", () => {
	test("coalesces 120 child progress bursts through EventBus, observer, and TUI", async () => {
		const eventBus = new EventBus();
		const registry = new SessionObserverRegistry();
		registry.subscribeToEventBus(eventBus);
		registry.setMainSession();
		vi.advanceTimersByTime(5);
		await Promise.resolve();

		const terminal = new VirtualTerminal(120, 40, 20_000);
		const scheduler = new ManualRenderScheduler();
		const tui = new TUI(terminal, undefined, { renderScheduler: scheduler });
		const hud = new SubagentHudRenderer();
		const component = new ObserverHudComponent(registry, hud);
		tui.addChild(component);
		let inputDispatchMs = Number.POSITIVE_INFINITY;
		tui.addInputListener(() => {
			inputDispatchMs = performance.now() - inputSentAt;
			return { consume: true };
		});

		let inputSentAt = 0;
		let observerNotifications = 0;
		const unsubscribe = registry.onChange(() => {
			observerNotifications++;
			registry.getSessions();
			registry.getSessions();
			tui.requestRender();
		});

		try {
			tui.start();
			vi.advanceTimersByTime(40);
			scheduler.advance(40);
			scheduler.flush();
			await Promise.resolve();
			const renderBaseline = tui.renderMetrics.renderPasses;
			const composeBaseline = component.renders;
			registry.resetPerformanceCounters();
			hud.resetPerformanceCounters();
			resetStatusLinePerformanceCounters();
			resetAgentHubPerfCounters();

			for (let burst = 0; burst < BURST_SIZE; burst++) {
				for (let child = 0; child < CHILDREN; child++) {
					eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, payloadFor(child, burst));
				}
			}
			inputSentAt = performance.now();
			terminal.sendInput("x");
			vi.advanceTimersByTime(80);
			scheduler.advance(80);
			scheduler.flush();
			await Promise.resolve();

			const observer = registry.getPerformanceCounters();
			const status = getStatusLinePerformanceCounters();
			const hub = getAgentHubPerfCounters();
			const measurements = {
				children: CHILDREN,
				events: CHILDREN * BURST_SIZE,
				inputDispatchMs,
				renderPasses: tui.renderMetrics.renderPasses - renderBaseline,
				composeCount: component.renders - composeBaseline,
				observerNotifications,
				snapshotUpdates: observer.snapshotUpdates,
				projectionRebuilds: observer.projectionRebuilds,
				hudRowRebuilds: hud.getPerformanceCounters().rowRebuilds,
				gitHeadResolutions: status.gitHeadResolutions,
				journalReads: hub.journalReads,
				hubProjectionRebuilds: hub.projectionRebuilds,
			};
			console.log("synthetic swarm measurements", measurements);

			expect(inputDispatchMs).toBeLessThan(50);
			expect(measurements.renderPasses).toBeLessThanOrEqual(1);
			expect(measurements.composeCount).toBeLessThanOrEqual(1);
			expect(observerNotifications).toBe(1);
			expect(observer.snapshotUpdates).toBe(CHILDREN);
			expect(observer.notificationFlushes).toBe(1);
			expect(observer.projectionRebuilds).toBe(1);
			expect(hud.getPerformanceCounters().rowRebuilds).toBe(CHILDREN);
			expect(registry.getSessions()).toHaveLength(CHILDREN + 1);
			expect(registry.getSessions().find(session => session.id === "SwarmChild63")?.progress?.requests).toBe(
				BURST_SIZE - 1,
			);
			expect(status.gitHeadResolutions).toBe(0);
			expect(hub.journalReads).toBe(0);
			expect(hub.projectionRebuilds).toBe(0);
		} finally {
			unsubscribe();
			registry.dispose();
			tui.stop();
		}
	});

	test("rebuilds only the changed task row", () => {
		const options: RenderResultOptions = { expanded: true, isPartial: true, spinnerFrame: 0 };
		const snapshots = Array.from({ length: CHILDREN }, (_, index) => progressFor(index, 0));
		const render = (progress: AgentProgress[]) => {
			const details: TaskToolDetails = { projectAgentsDir: null, results: [], totalDurationMs: 0, progress };
			return taskToolRenderer
				.renderResult({ content: [{ type: "text", text: "" }], details }, options, theme)
				.render(120);
		};

		resetTaskProgressRenderPerformanceCounters();
		render(snapshots);
		expect(getTaskProgressRenderPerformanceCounters().rowRebuilds).toBe(CHILDREN);
		const next = snapshots.slice();
		next[63] = progressFor(63, 1);
		render(next);
		const rowRebuilds = getTaskProgressRenderPerformanceCounters().rowRebuilds;
		console.log("incremental task row measurements", { initialRows: CHILDREN, changedRows: rowRebuilds - CHILDREN });
		expect(rowRebuilds).toBe(CHILDREN + 1);
	});

	test("publishes one ordered task projection for a burst", () => {
		const projections: Array<readonly AgentProgress[]> = [];
		const aggregator = new ProgressAggregator(progress => projections.push(progress));
		for (let burst = 0; burst < BURST_SIZE; burst++) {
			for (let child = 0; child < CHILDREN; child++) aggregator.update(child, progressFor(child, burst));
		}
		vi.advanceTimersByTime(5);
		const counters = aggregator.getPerformanceCounters();
		console.log("task progress aggregation measurements", { ...counters, projectionSize: projections[0]?.length ?? 0 });
		expect(counters.flushes).toBe(1);
		expect(projections).toHaveLength(1);
		expect(projections[0]).toHaveLength(CHILDREN);
		expect(projections[0][63]?.requests).toBe(BURST_SIZE - 1);
		aggregator.dispose();
	});
});
