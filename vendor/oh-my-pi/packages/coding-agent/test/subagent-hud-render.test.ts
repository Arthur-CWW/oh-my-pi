/**
 * Contract: the anchored subagent HUD (rendered above the editor, next to the
 * Todos block) lists exactly the running *detached* subagents as
 * `Id: description` rows and yields no output once nothing qualifies, so the
 * block self-clears. Sync task spawns and eval `agent()` spawns are excluded:
 * their progress is already rendered inline (tool block / eval cell).
 */
import { beforeAll, describe, expect, it, setSystemTime, vi } from "bun:test";
import { renderSubagentHudLines } from "@oh-my-pi/pi-coding-agent/modes/interactive-mode";
import {
	type ObservableSession,
	SessionObserverRegistry,
} from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry, MAIN_AGENT_ID } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import {
	type AgentProgress,
	type SubagentLifecyclePayload,
	type SubagentProgressPayload,
	TASK_SUBAGENT_LIFECYCLE_CHANNEL,
	TASK_SUBAGENT_PROGRESS_CHANNEL,
} from "@oh-my-pi/pi-coding-agent/task";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";

function makeSession(overrides: Partial<ObservableSession> & { id: string }): ObservableSession {
	return {
		kind: "subagent",
		label: overrides.id,
		status: "active",
		detached: true,
		lastUpdate: Date.now(),
		...overrides,
	};
}

function makeProgress(overrides: Partial<AgentProgress> & { id: string }): AgentProgress {
	return {
		index: 0,
		agent: "task",
		agentSource: "bundled",
		status: "running",
		task: "",
		recentTools: [],
		recentOutput: [],
		toolCount: 0,
		requests: 0,
		tokens: 0,
		cost: 0,
		durationMs: 0,
		...overrides,
	};
}

function makeLifecycle(id: string, index: number, description: string, detached?: boolean): SubagentLifecyclePayload {
	return {
		id,
		index,
		agent: "task",
		agentSource: "bundled",
		description,
		status: "started",
		parentToolCallId: "tool-call",
		detached,
	};
}

function makeProgressPayload(
	id: string,
	index: number,
	description: string,
	detached?: boolean,
): SubagentProgressPayload {
	return {
		index,
		agent: "task",
		agentSource: "bundled",
		task: description,
		parentToolCallId: "tool-call",
		detached,
		progress: makeProgress({ id, index, description, task: description }),
	};
}

function render(sessions: ObservableSession[], columns = 120): string {
	return Bun.stripANSI(renderSubagentHudLines(sessions, columns).join("\n"));
}

describe("subagent HUD lines", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("renders running subagents as Id: description under a Subagents header", () => {
		const out = render([
			makeSession({ id: "AuthLoader", description: "Refactoring the auth flow" }),
			makeSession({ id: "SchemaMigrator", description: "Migrating the users table" }),
		]);
		expect(out).toContain("Subagents");
		expect(out).toContain("AuthLoader: Refactoring the auth flow");
		expect(out).toContain("SchemaMigrator: Migrating the users table");
	});

	it("only shows active subagents and clears once everything finished", () => {
		const finishedStates = ["completed", "failed", "aborted"] as const;
		const sessions: ObservableSession[] = [
			{ id: "main", kind: "main", label: "Main Session", status: "active", lastUpdate: Date.now() },
			...finishedStates.map(status => makeSession({ id: `Done-${status}`, status, description: "old work" })),
		];
		expect(renderSubagentHudLines(sessions, 120)).toEqual([]);

		const out = render([...sessions, makeSession({ id: "StillRunning", description: "live work" })]);
		expect(out).toContain("StillRunning: live work");
		expect(out).not.toContain("Done-");
		expect(out).not.toContain("Main Session");
	});

	it("falls back to the description and task carried by progress snapshots", () => {
		const fromProgressDesc = render([
			makeSession({ id: "Worker", progress: makeProgress({ id: "Worker", description: "From progress" }) }),
		]);
		expect(fromProgressDesc).toContain("Worker: From progress");

		const fromTask = render([
			makeSession({ id: "Worker", progress: makeProgress({ id: "Worker", task: "Investigate flaky CI on macOS" }) }),
		]);
		expect(fromTask).toContain("Worker Investigate flaky CI on macOS");
	});

	it("hides non-detached spawns: sync task calls and eval agent() helpers", () => {
		// Sync task spawn (parent blocked on the call) and eval `agent()` spawn
		// (no detached flag at all) both stay off the HUD.
		const sessions = [
			makeSession({ id: "SyncSpawn", description: "inline task work", detached: false }),
			makeSession({ id: "EvalSpawn", description: "eval cell work", detached: undefined }),
		];
		expect(renderSubagentHudLines(sessions, 120)).toEqual([]);

		const out = render([...sessions, makeSession({ id: "BackgroundSpawn", description: "detached work" })]);
		expect(out).toContain("BackgroundSpawn: detached work");
		expect(out).not.toContain("SyncSpawn");
		expect(out).not.toContain("EvalSpawn");
	});

	it("threads the detached flag from lifecycle and progress payloads", () => {
		const eventBus = new EventBus();
		const registry = new SessionObserverRegistry();
		registry.subscribeToEventBus(eventBus);

		eventBus.emit(TASK_SUBAGENT_LIFECYCLE_CHANNEL, makeLifecycle("Detached", 0, "background work", true));
		eventBus.emit(TASK_SUBAGENT_LIFECYCLE_CHANNEL, makeLifecycle("Inline", 1, "sync work"));
		eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, makeProgressPayload("FromProgress", 2, "background work", true));

		const out = render(registry.getSessions());
		expect(out).toContain("Detached: background work");
		expect(out).toContain("FromProgress: background work");
		expect(out).not.toContain("Inline");
	});

	it("rehydrates a rebuilt roster from AgentRegistry without progress events", () => {
		const agents = new AgentRegistry();
		agents.register({
			id: MAIN_AGENT_ID,
			displayName: "Main Session",
			kind: "main",
			session: null,
			status: "running",
		});
		agents.register({
			id: "QuietRoot",
			displayName: "Quiet root",
			kind: "sub",
			parentId: MAIN_AGENT_ID,
			session: null,
			status: "running",
		});
		agents.register({
			id: "QuietRoot.ParkedLeaf",
			displayName: "Parked leaf",
			kind: "sub",
			parentId: "QuietRoot",
			session: null,
			status: "parked",
		});
		agents.register({
			id: "IdleSibling",
			displayName: "Idle sibling",
			kind: "sub",
			parentId: MAIN_AGENT_ID,
			session: null,
			status: "idle",
		});

		const first = new SessionObserverRegistry();
		first.subscribeToAgentRegistry(agents);
		const expected = agents
			.list()
			.filter(ref => ref.kind === "sub")
			.map(ref => ref.id);
		expect(
			first
				.getSessions()
				.filter(session => session.kind === "subagent")
				.map(session => session.id),
		).toEqual(expected);
		expect(first.getSessions().find(session => session.id === "QuietRoot.ParkedLeaf")).toMatchObject({
			registryStatus: "parked",
			parentAgentId: "QuietRoot",
		});
		first.dispose();

		const rebuilt = new SessionObserverRegistry();
		rebuilt.subscribeToAgentRegistry(agents);
		expect(
			rebuilt
				.getSessions()
				.filter(session => session.kind === "subagent")
				.map(session => session.id),
		).toEqual(expected);
		expect(render(rebuilt.getSessions())).toContain("QuietRoot: Quiet root");
		rebuilt.dispose();
	});

	it("renders nested ids as a breadcrumb and truncates long descriptions to the viewport", () => {
		const out = render([makeSession({ id: "Anna.Bob", description: `start ${"x".repeat(300)} end` })], 60);
		expect(out).toContain("Bob:");
		expect(out).not.toContain("Anna>Bob");
		expect(out).not.toContain("end");
		for (const line of out.split("\n")) {
			expect(Bun.stringWidth(line)).toBeLessThanOrEqual(60);
		}
	});

	it("keeps subagent registry order stable while progress arrives out of order", () => {
		const eventBus = new EventBus();
		const registry = new SessionObserverRegistry();
		registry.subscribeToEventBus(eventBus);
		const activeIds = () =>
			registry
				.getSessions()
				.filter(session => session.kind === "subagent" && session.status === "active")
				.map(session => session.id);

		eventBus.emit(
			TASK_SUBAGENT_LIFECYCLE_CHANNEL,
			makeLifecycle("BlastRadius", 1, "Survey id-keyed downstream consumers"),
		);
		eventBus.emit(
			TASK_SUBAGENT_LIFECYCLE_CHANNEL,
			makeLifecycle("SelectorSurfaces", 0, "Map model-selector resolution surfaces"),
		);
		eventBus.emit(
			TASK_SUBAGENT_LIFECYCLE_CHANNEL,
			makeLifecycle("VariantsSurvey", 2, "Survey tier-variant ids across catalog"),
		);

		expect(activeIds()).toEqual(["SelectorSurfaces", "BlastRadius", "VariantsSurvey"]);

		eventBus.emit(
			TASK_SUBAGENT_PROGRESS_CHANNEL,
			makeProgressPayload("VariantsSurvey", 2, "Survey tier-variant ids across catalog"),
		);
		eventBus.emit(
			TASK_SUBAGENT_PROGRESS_CHANNEL,
			makeProgressPayload("BlastRadius", 1, "Survey id-keyed downstream consumers"),
		);

		expect(activeIds()).toEqual(["SelectorSurfaces", "BlastRadius", "VariantsSurvey"]);
	});
	it("computes a sliding token rate and marks an event-stale running row", () => {
		vi.useFakeTimers();
		const registry = new SessionObserverRegistry();
		const eventBus = new EventBus();
		registry.subscribeToEventBus(eventBus);
		const start = new Date("2025-01-01T00:00:00.000Z");
		setSystemTime(start);
		try {
			eventBus.emit(TASK_SUBAGENT_LIFECYCLE_CHANNEL, makeLifecycle("RateWorker", 0, "rate work", true));
			const progress = (tokens: number, outputTokens?: number): SubagentProgressPayload => ({
				...makeProgressPayload("RateWorker", 0, "rate work", true),
				progress: makeProgress({ id: "RateWorker", index: 0, description: "rate work", tokens, outputTokens }),
			});
			eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, progress(100, 10));
			setSystemTime(new Date(start.getTime() + 15_000));
			eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, progress(250, 25));

			const live = registry.getSessions().find(session => session.id === "RateWorker");
			// Rate is computed from outputTokens: (25-10)/15s = 1 t/s
			expect(live?.tokenRate).toBeCloseTo(1, 5);
			expect(live?.tokenRateStuck).toBe(false);
			expect(render(registry.getSessions())).toMatch(/\s1 t\/s$/m);

			setSystemTime(new Date(start.getTime() + 61_000));
			const decayed = registry.getSessions().find(session => session.id === "RateWorker");
			expect(decayed).toMatchObject({ tokenRate: 0, tokenRateStuck: false });

			setSystemTime(new Date(start.getTime() + 76_000));
			const stale = registry.getSessions().find(session => session.id === "RateWorker");
			expect(stale).toMatchObject({ tokenRate: 0, tokenRateStuck: true });
			expect(render(registry.getSessions())).toMatch(/\s0 t\/s$/m);
		} finally {
			registry.dispose();
			vi.useRealTimers();
		}
	});

	it("renders parent-probed liveness states instead of 0 t/s", () => {
		const out = render([
			makeSession({
				id: "StalledWorker",
				tokenRateStuck: true,
				progress: makeProgress({ id: "StalledWorker", livenessState: "stalled" }),
			}),
			makeSession({
				id: "DeadWorker",
				tokenRateStuck: true,
				progress: makeProgress({ id: "DeadWorker", livenessState: "dead" }),
			}),
		]);

		expect(out).toContain("STALLED");
		expect(out).toContain("DEAD");
		expect(out).not.toContain("0 t/s");
	});

	it("renders a three-deep short-name tree with aligned badge columns", () => {
		const rows = [
			makeSession({
				id: "HR147ColonMode",
				description: "Colon-mode UX implementer",
				tokenRate: 9.6,
				progress: makeProgress({ id: "HR147ColonMode", resolvedModel: "openai-codex/gpt-5.6-sol:xhigh" }),
			}),
			makeSession({
				id: "HR147ColonMode.HR151DismissAction",
				parentAgentId: "HR147ColonMode",
				description: "Modal input-action migration specialist",
				tokenRate: 123.4,
				progress: makeProgress({
					id: "HR147ColonMode.HR151DismissAction",
					resolvedModel: "anthropic/claude-sonnet-4-6:high",
				}),
			}),
			makeSession({
				id: "HR147ColonMode.HR151DismissAction.DismissSelectors",
				parentAgentId: "HR147ColonMode.HR151DismissAction",
				description: "Selector dismissal migration specialist",
				tokenRate: 1.2,
				tokenRateStuck: true,
				progress: makeProgress({
					id: "HR147ColonMode.HR151DismissAction.DismissSelectors",
					resolvedModel: "kimi-code/kimi-for-coding:medium",
				}),
			}),
		];
		const rendered = render(rows, 100)
			.split("\n")
			.filter(line => line.includes("["));
		expect(rendered).toHaveLength(3);
		expect(rendered[0]).toContain("[OX5.6solxh] HR147ColonMode: Colon-mode UX implementer");
		expect(rendered[1]).toContain("[AN4.6sonneth] HR151DismissAction: Modal input-action migration specialist");
		expect(rendered[2]).toContain("[KMkimim] DismissSelectors: Selector dismissal migration specialist");
		expect(rendered.join("\n")).not.toContain("HR147ColonMode.HR151DismissAction");
		expect(rendered.map(line => Bun.stringWidth(line))).toEqual([99, 99, 99]);
		expect(rendered[0]).toMatch(/\s10 t\/s$/);
		expect(rendered[1]).toMatch(/\s123 t\/s$/);
		expect(rendered[2]).toMatch(/\s1 t\/s$/);
	});

	it("keeps long-role rows on one display line at narrow, normal, and wide widths", () => {
		const row = makeSession({
			id: "LongRoleWorker",
			description: `HUD and Hub polish implementer ${"with a deliberately long role ".repeat(20)}`,
			tokenRate: 123.4,
			progress: makeProgress({
				id: "LongRoleWorker",
				resolvedModel: "openai-codex/gpt-5.6-sol:xhigh",
			}),
		});
		for (const width of [60, 100, 160]) {
			const rendered = renderSubagentHudLines([row], width).at(-1)!;
			const plain = Bun.stripANSI(rendered);
			expect(Bun.stringWidth(plain)).toBe(width - 1);
			expect(plain).toMatch(/…\s+123 t\/s$/);
			expect(plain.split("\n")).toHaveLength(1);
		}
	});

	it("cache-heavy turn yields output-rate not billing-volume rate", () => {
		vi.useFakeTimers();
		const registry = new SessionObserverRegistry();
		const eventBus = new EventBus();
		registry.subscribeToEventBus(eventBus);
		const start = new Date("2025-06-01T00:00:00.000Z");
		setSystemTime(start);
		try {
			eventBus.emit(TASK_SUBAGENT_LIFECYCLE_CHANNEL, makeLifecycle("CacheHeavy", 0, "cache work", true));
			const progress = (tokens: number, outputTokens: number): SubagentProgressPayload => ({
				...makeProgressPayload("CacheHeavy", 0, "cache work", true),
				progress: makeProgress({ id: "CacheHeavy", index: 0, description: "cache work", tokens, outputTokens }),
			});
			// Turn 1: 150k total (input+cacheWrite), 100 output
			eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, progress(150_000, 100));
			setSystemTime(new Date(start.getTime() + 10_000));
			// Turn 2: 300k total, 400 output (300 new output tokens in 10s => 30 t/s)
			eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, progress(300_000, 400));

			const session = registry.getSessions().find(s => s.id === "CacheHeavy");
			// Rate should be ~30 (output-based), NOT ~15000 (total-based)
			expect(session?.tokenRate).toBeCloseTo(30, 5);
			expect(session?.tokenRate).toBeLessThan(100);
			expect(render(registry.getSessions())).toMatch(/\s30 t\/s$/m);
		} finally {
			registry.dispose();
			vi.useRealTimers();
		}
	});

	it("old child without outputTokens falls back to total for rate", () => {
		vi.useFakeTimers();
		const registry = new SessionObserverRegistry();
		const eventBus = new EventBus();
		registry.subscribeToEventBus(eventBus);
		const start = new Date("2025-06-01T00:00:00.000Z");
		setSystemTime(start);
		try {
			eventBus.emit(TASK_SUBAGENT_LIFECYCLE_CHANNEL, makeLifecycle("OldChild", 0, "legacy work", true));
			// Simulate old child that does not send outputTokens
			const progress = (tokens: number): SubagentProgressPayload => ({
				...makeProgressPayload("OldChild", 0, "legacy work", true),
				progress: makeProgress({ id: "OldChild", index: 0, description: "legacy work", tokens }),
			});
			eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, progress(500));
			setSystemTime(new Date(start.getTime() + 10_000));
			eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, progress(1000));

			const session = registry.getSessions().find(s => s.id === "OldChild");
			// Falls back to total: (1000-500)/10s = 50 t/s
			expect(session?.tokenRate).toBeCloseTo(50, 5);
		} finally {
			registry.dispose();
			vi.useRealTimers();
		}
	});

	it("stuck detection fires on total-advance stagnation even when outputTokens grows", () => {
		vi.useFakeTimers();
		const registry = new SessionObserverRegistry();
		const eventBus = new EventBus();
		registry.subscribeToEventBus(eventBus);
		const start = new Date("2025-06-01T00:00:00.000Z");
		setSystemTime(start);
		try {
			eventBus.emit(TASK_SUBAGENT_LIFECYCLE_CHANNEL, makeLifecycle("StuckWorker", 0, "stuck work", true));
			const progress = (tokens: number, outputTokens: number): SubagentProgressPayload => ({
				...makeProgressPayload("StuckWorker", 0, "stuck work", true),
				progress: makeProgress({ id: "StuckWorker", index: 0, description: "stuck work", tokens, outputTokens }),
			});
			// Single progress update, then silence
			eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, progress(1000, 50));

			// After 76s of no new progress events, stuck should fire
			setSystemTime(new Date(start.getTime() + 76_000));
			const session = registry.getSessions().find(s => s.id === "StuckWorker");
			expect(session?.tokenRate).toBe(0);
			expect(session?.tokenRateStuck).toBe(true);
		} finally {
			registry.dispose();
			vi.useRealTimers();
		}
	});
});
