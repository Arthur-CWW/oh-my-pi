import { afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "bun:test";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EventController } from "@oh-my-pi/pi-coding-agent/modes/controllers/event-controller";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";

interface FakeWorkingLoader {
	stop: Mock<() => void>;
	kind: "working";
}

/**
 * Faithful model of the shared `statusContainer` + working-loader invariant that
 * InteractiveMode owns:
 *  - `agent_start` → `ensureLoadingAnimation()` only creates+attaches the loader
 *    when `loadingAnimation` is unset (the real `if (!this.loadingAnimation)`
 *    guard), so a stale, still-referenced loader makes it a no-op.
 *  - A transient overlay (auto-compaction / auto-retry) takes over the container.
 *
 * The regression: the overlay handlers cleared the container (detaching the
 * working loader) but left `loadingAnimation` set, so the resumed turn's
 * `agent_start` skipped re-attaching it — "Working…" vanished while the agent
 * kept streaming. The fix tears the working loader down (stop + dereference) so
 * the next `agent_start` recreates and re-attaches it.
 */
function createContext() {
	const streamState = { isStreaming: false };
	const children: unknown[] = [];
	const statusContainer = {
		children,
		clear() {
			children.length = 0;
		},
		addChild(child: unknown) {
			children.push(child);
		},
		removeChild(child: unknown) {
			const index = children.indexOf(child);
			if (index !== -1) children.splice(index, 1);
		},
	};
	const workingLoaders: FakeWorkingLoader[] = [];
	const ctx = {
		isInitialized: true,
		settings: { get: () => false },
		statusLine: { invalidate: vi.fn() },
		updateEditorTopBorder: vi.fn(),
		pendingTools: new Map<string, unknown>(),
		hideThinkingBlock: false,
		setWorkingMessage: vi.fn(),
		clearPinnedError: vi.fn(),
		loadingAnimation: undefined,
		autoCompactionLoader: undefined,
		retryLoader: undefined,
		streamingComponent: undefined,
		streamingMessage: undefined,
		statusContainer,
		chatContainer: { removeChild: vi.fn(), clear: vi.fn() },
		flushPendingModelSwitch: vi.fn(async () => {}),
		flushCompactionQueue: vi.fn(async () => {}),
		rebuildChatFromMessages: vi.fn(),
		reloadTodos: vi.fn(async () => {}),
		showStatus: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn(),
		editor: { getText: () => "" },
		sessionManager: { getSessionName: () => "test-session" },
		ui: { requestRender: vi.fn(), requestComponentRender: vi.fn() },
		viewSession: { isCompacting: false, getLastAssistantMessage: () => undefined },
		session: {
			get isStreaming() {
				return streamState.isStreaming;
			},
			getToolByName: () => undefined,
		},
	} as unknown as InteractiveModeContext;
	ctx.ensureLoadingAnimation = vi.fn(() => {
		if (ctx.loadingAnimation) return;
		statusContainer.clear();
		const working: FakeWorkingLoader = { stop: vi.fn(), kind: "working" };
		workingLoaders.push(working);
		ctx.loadingAnimation = working as unknown as typeof ctx.loadingAnimation;
		statusContainer.addChild(ctx.loadingAnimation);
	});
	return { ctx, streamState, statusContainer, workingLoaders };
}

const AGENT_START = { type: "agent_start" } as unknown as AgentSessionEvent;
const COMPACTION_START = {
	type: "auto_compaction_start",
	reason: "overflow",
	action: "context-full",
} as unknown as AgentSessionEvent;
const COMPACTION_END = {
	type: "auto_compaction_end",
	action: "context-full",
	result: { summary: "s", shortSummary: "s", tokensBefore: 10, details: {}, firstKeptEntryId: undefined },
	willRetry: true,
} as unknown as AgentSessionEvent;
const RETRY_START = {
	type: "auto_retry_start",
	cause: "provider",
	attempt: 1,
	maxAttempts: 3,
	delayMs: 1000,
	errorMessage: "overloaded",
} as unknown as AgentSessionEvent;

describe("EventController loader recovery after overflow maintenance", () => {
	beforeAll(async () => {
		await initTheme(false);
	});

	beforeEach(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true });
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		resetSettingsForTest();
	});

	it("re-shows the Working… loader after auto-compaction recovers and streams a new turn", async () => {
		const { ctx, streamState, statusContainer, workingLoaders } = createContext();
		const controller = new EventController(ctx);

		// Turn 1 begins: the working loader is created and attached.
		await controller.handleEvent(AGENT_START);
		const firstWorking = workingLoaders[0];
		expect(firstWorking).toBeDefined();
		expect(statusContainer.children).toContain(ctx.loadingAnimation);

		// Overflow recovery hands the status container to the auto-compaction loader.
		// The original turn's agent_end is held while the prompt is in flight, so the
		// session keeps reporting streaming throughout.
		streamState.isStreaming = true;
		await controller.handleEvent(COMPACTION_START);

		// The working loader must be fully torn down — not detached-but-referenced —
		// so the upcoming agent_start can recreate it.
		expect(firstWorking?.stop).toHaveBeenCalled();
		expect(ctx.loadingAnimation).toBeUndefined();
		expect(statusContainer.children).not.toContain(firstWorking);

		await controller.handleEvent(COMPACTION_END);

		// The retry continuation starts a fresh turn: the loader must reappear in the
		// status container so streaming shows "Working…" again (issue: it stayed gone).
		await controller.handleEvent(AGENT_START);
		expect(ctx.loadingAnimation).toBeDefined();
		expect(statusContainer.children).toContain(ctx.loadingAnimation);
		expect(workingLoaders).toHaveLength(2);
	});

	it("re-shows the Working… loader after an auto-retry resumes the turn", async () => {
		const { ctx, streamState, statusContainer, workingLoaders } = createContext();
		const controller = new EventController(ctx);

		await controller.handleEvent(AGENT_START);
		const firstWorking = workingLoaders[0];
		expect(statusContainer.children).toContain(ctx.loadingAnimation);

		// A transient error: the retry loader takes over the status container.
		streamState.isStreaming = true;
		await controller.handleEvent(RETRY_START);
		expect(firstWorking?.stop).toHaveBeenCalled();
		expect(ctx.loadingAnimation).toBeUndefined();

		// The retry attempt re-enters the agent loop, emitting a fresh agent_start.
		await controller.handleEvent(AGENT_START);
		expect(ctx.loadingAnimation).toBeDefined();
		expect(statusContainer.children).toContain(ctx.loadingAnimation);
	});
	it("renders each retry cause distinctly in the status loader", async () => {
		const { ctx } = createContext();
		const controller = new EventController(ctx);
		const cases = [
			{ cause: "network" as const, text: "Provider unreachable (network/DNS), retrying 1s" },
			{ cause: "rate-limit" as const, text: "Rate limited, retrying (1/3) in 1s" },
			{ cause: "provider" as const, text: "Provider error, retrying (1/3) in 1s" },
		];

		for (const retryCase of cases) {
			const event: Extract<AgentSessionEvent, { type: "auto_retry_start" }> = {
				type: "auto_retry_start",
				cause: retryCase.cause,
				attempt: 1,
				maxAttempts: 3,
				delayMs: 1_000,
				errorMessage: "overloaded",
			};
			await controller.handleEvent(event);
			const loader = ctx.retryLoader;
			expect(loader).toBeDefined();
			expect(loader?.render(240).join("\n")).toContain(retryCase.text);
			await controller.handleEvent({ type: "auto_retry_end", success: true, attempt: 1 });
		}
	});
});
