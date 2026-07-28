import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import type { RunnerCommandReceipt } from "../../src/runner/protocol";
import { createDisposableTerminalView } from "../../src/modes/disposable-chat-view";
import type {
	DisposableTerminalHostCallbacks,
	DisposableTerminalView,
} from "../../src/modes/disposable-terminal-host";
import type {
	TerminalSessionController,
	TerminalSubmitIntent,
} from "../../src/modes/terminal-session-controller";
import type { TerminalSessionSnapshot } from "../../src/runner/terminal-session-view";

const runningViews: DisposableTerminalView[] = [];

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(async () => {
	await Promise.all(runningViews.splice(0).map(view => view.dispose()));
	vi.useRealTimers();
});

function createSnapshot(): TerminalSessionSnapshot {
	const snapshot = {
		terminalSequence: 0,
		runner: {
			runnerIdentity: {
				buildRevision: { digest: "0".repeat(64), version: "test" },
				runnerInstance: {
					runnerInstanceId: "00000000-0000-4000-8000-000000000000",
					startedAt: "2026-01-01T00:00:00.000Z",
				},
			},
			revision: 7,
			sessionRevision: 4,
			sequence: 0,
			durableSequence: 0,
			items: [],
			transcript: {
				header: {
					type: "session",
					id: "test-session",
					timestamp: "2026-01-01T00:00:00.000Z",
					cwd: "/tmp",
				},
				entries: [],
				entryCount: 0,
				leafId: null,
				lastEntryId: undefined,
			},
			recentDeliveries: [],
			views: [],
			controller: { viewId: "test-view", epoch: 1 },
			activeCompaction: undefined,
			activeLocalOperation: undefined,
			activeEphemeralTurn: undefined,
			activeSessionOperation: undefined,
			checkpointRevision: 0,
			checkpointState: undefined,
			workflow: { kind: "none" },
			toolConfigurationGeneration: 0,
			activeToolNames: [],
			todoGeneration: 0,
			status: "running",
			pendingOperations: 0,
		},
		session: {
			sessionId: "test-session",
			sessionFile: undefined,
			cwd: "/tmp",
			modelSummary: {
				provider: "test-provider",
				api: "openai-completions",
				id: "test-model",
				requestModelId: "test-model",
				name: "Test model",
				contextWindow: 4096,
			},
			configuredThinkingLevel: "off",
			effectiveThinkingLevel: "off",
			workflow: { kind: "none" },
			toolConfigurationGeneration: 0,
			activeToolNames: [],
			todoGeneration: 0,
			todoPhases: [],
			goalModeState: undefined,
			planReferencePath: "",
			autoCompactionEnabled: true,
			isStreaming: false,
			isCompacting: false,
			hasPostPromptWork: false,
			isBashRunning: false,
			isEvalRunning: false,
			promptOperation: { generation: 0, active: false },
		},
	} satisfies TerminalSessionSnapshot;
	return snapshot;
}

function createController(): {
	controller: TerminalSessionController;
	snapshotCalls: () => number;
	refreshCalls: () => number;
	formatted: () => Array<{ compact?: boolean }>;
	submissions: TerminalSubmitIntent[];
	interruptCalls: () => number;
	unsubscribeCalls: () => number;
} {
	const snapshot = createSnapshot();
	let snapshots = 0;
	let refreshes = 0;
	const formatted: Array<{ compact?: boolean }> = [];
	const submissions: TerminalSubmitIntent[] = [];
	let interrupts = 0;
	let unsubscribes = 0;
	let nextRevision = 8;

	const controller = {
		viewId: "test-view",
		epoch: 1,
		snapshot: () => {
			snapshots++;
			return snapshot;
		},
		subscribeAgentEvents: (_listener: () => void) => () => {
			unsubscribes++;
		},
		refresh: async () => {
			refreshes++;
			return snapshot;
		},
		formatSessionAsText: async (options?: { compact?: boolean }) => {
			formatted.push(options ?? {});
			return "hydrated transcript marker";
		},
		submit: async (intent: TerminalSubmitIntent) => {
			submissions.push(intent);
			return {
				commandId: `command-${nextRevision}`,
				correlationId: `correlation-${nextRevision}`,
				inputId: `input-${nextRevision}`,
				durableSequence: nextRevision,
				revision: nextRevision++,
				replayed: false,
			} satisfies RunnerCommandReceipt;
		},
		interruptPrompt: async () => {
			interrupts++;
			return {};
		},
	} as unknown as TerminalSessionController;

	return {
		controller,
		snapshotCalls: () => snapshots,
		refreshCalls: () => refreshes,
		formatted: () => formatted,
		submissions,
		interruptCalls: () => interrupts,
		unsubscribeCalls: () => unsubscribes,
	};
}

function createCallbacks(): {
	callbacks: DisposableTerminalHostCallbacks;
	reloads: () => number;
	stops: () => number;
} {
	let reloads = 0;
	let stops = 0;
	const callbacks: DisposableTerminalHostCallbacks = {
		epoch: 1,
		isCurrentEpoch: () => true,
		assertCurrentEpoch: () => {},
		requestReload: async () => {
			reloads++;
		},
		requestStop: async () => {
			stops++;
		},
		requestTransition: async () => {},
	};
	return { callbacks, reloads: () => reloads, stops: () => stops };
}

async function startView(
	controller: TerminalSessionController,
	callbacks: DisposableTerminalHostCallbacks,
): Promise<DisposableTerminalView> {
	const view = createDisposableTerminalView(controller, callbacks);
	runningViews.push(view);
	await view.run();
	return view;
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

async function sendLine(value: string): Promise<void> {
	process.stdin.emit("data", `${value}\r`);
	await settle();
}

describe("compact disposable terminal view", () => {
	test("hydrates the transcript and computes initial status before accepting input", async () => {
		const fixture = createController();
		const { callbacks } = createCallbacks();

		await startView(fixture.controller, callbacks);

		expect(fixture.refreshCalls()).toBe(1);
		expect(fixture.formatted()).toEqual([{ compact: false }]);
		expect(fixture.snapshotCalls()).toBeGreaterThan(0);
	});

	test("rejects unsupported slash, bang, and shell commands without submitting", async () => {
		const fixture = createController();
		const { callbacks } = createCallbacks();
		await startView(fixture.controller, callbacks);

		await sendLine("/unsupported");
		await sendLine("!shell-command");
		await sendLine("$shell-command");

		expect(fixture.submissions).toEqual([]);
	});

	test("submits ordinary input and interrupts an active prompt", async () => {
		const fixture = createController();
		const { callbacks } = createCallbacks();
		await startView(fixture.controller, callbacks);

		await sendLine("ordinary prompt");
		expect(fixture.submissions.map(intent => ({ text: intent.text, deliveryClass: intent.deliveryClass }))).toEqual([
			{ text: "ordinary prompt", deliveryClass: "followUp" },
		]);

		process.stdin.emit("data", "\x1b");
		vi.advanceTimersByTime(80);
		await settle();
		expect(fixture.interruptCalls()).toBe(1);
	});

	test("routes /reload-tui once through the host callback", async () => {
		const fixture = createController();
		const callbacks = createCallbacks();
		await startView(fixture.controller, callbacks.callbacks);

		await sendLine("/reload-tui");
		await sendLine("/reload-tui");

		expect(callbacks.reloads()).toBe(1);
		expect(fixture.submissions).toEqual([]);
	});

	test("quiesce is idempotent and fences input and stale callbacks", async () => {
		const fixture = createController();
		const callbacks = createCallbacks();
		const view = await startView(fixture.controller, callbacks.callbacks);

		await view.quiesce();
		await view.quiesce();
		process.stdin.emit("data", "ordinary after quiesce\r");
		process.stdin.emit("data", "\x1b");
		process.stdin.emit("data", "\x04");
		vi.advanceTimersByTime(80);
		await settle();

		expect(fixture.submissions).toEqual([]);
		expect(fixture.interruptCalls()).toBe(0);
		expect(callbacks.stops()).toBe(0);
		expect(fixture.unsubscribeCalls()).toBe(1);
	});
});
