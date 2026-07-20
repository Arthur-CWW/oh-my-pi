import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import type { AssistantMessage, Usage } from "@oh-my-pi/pi-ai";
import { BtwController } from "@oh-my-pi/pi-coding-agent/modes/controllers/btw-controller";
import {
	BtwPanelComponent,
	makeBtwPanelModel,
	type BtwPanelComponentOptions,
} from "@oh-my-pi/pi-coding-agent/modes/components/btw-panel";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { createControllerFixture, type ControllerFixture } from "../../helpers/controller-fixture";
import { type Component, Container } from "@oh-my-pi/pi-tui";

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage,
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

interface RunEphemeralTurnArgs {
	promptText: string;
	onTextDelta?: (delta: string) => void;
	signal?: AbortSignal;
}

interface RunEphemeralTurnResult {
	replyText: string;
	assistantMessage: AssistantMessage;
}
const fixtures: ControllerFixture[] = [];

function makeFakeSession(
	runEphemeralTurn: (args: RunEphemeralTurnArgs) => Promise<RunEphemeralTurnResult>,
): InteractiveModeContext["session"] {
	return {
		model: { provider: "anthropic", id: "claude-sonnet-4-5" },
		runEphemeralTurn,
	} as unknown as InteractiveModeContext["session"];
}

async function makeCtx(
	session: InteractiveModeContext["session"],
	btwContainer = new Container(),
): Promise<InteractiveModeContext> {
	const fixture = await createControllerFixture();
	fixtures.push(fixture);
	fixture.tui.addChild(btwContainer);
	return {
		ui: fixture.tui,
		btwContainer,
		session,
		mvuScope: fixture.scope,
		mvuInputLeaseManager: fixture.getInputLeaseManager(),
		showStatus: vi.fn(),
		showError: vi.fn(),
	} as unknown as InteractiveModeContext;
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < 1_000; i++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	expect(predicate()).toBe(true);
}

beforeAll(async () => {
	await initTheme();
});

afterEach(async () => {
	while (fixtures.length > 0) await fixtures.pop()?.close();
});

describe("BtwController", () => {
	it("dispatches the question to runEphemeralTurn with the btw prompt wrapper and a fresh signal", async () => {
		const runEphemeralTurn = vi.fn(async (_args: RunEphemeralTurnArgs) => ({
			replyText: "Answer",
			assistantMessage: createAssistantMessage("Answer"),
		}));
		const ctx = await makeCtx(makeFakeSession(runEphemeralTurn));
		const controller = new BtwController(ctx);

		await controller.start("What changed?");
		// Drain microtasks so the inner promise can resolve.
		await Promise.resolve();
		await Promise.resolve();
		await waitFor(() => ctx.mvuInputLeaseManager.current().kind === "mvu");

		expect(runEphemeralTurn).toHaveBeenCalledTimes(1);
		const callArg = runEphemeralTurn.mock.calls[0]?.[0];
		expect(callArg).toBeDefined();
		expect(callArg?.promptText).toContain("<btw>");
		expect(callArg?.promptText).toContain("What changed?");
		expect(callArg?.signal).toBeInstanceOf(AbortSignal);
		expect(typeof callArg?.onTextDelta).toBe("function");
		expect(controller.hasActiveRequest()).toBe(true);
	});

	it("replaces a previous request by aborting it before issuing the next runEphemeralTurn", async () => {
		const signals: AbortSignal[] = [];
		let firstRelease!: () => void;
		const firstPromise = new Promise<RunEphemeralTurnResult>(resolve => {
			firstRelease = () => resolve({ replyText: "first", assistantMessage: createAssistantMessage("first") });
		});
		const runEphemeralTurn = vi
			.fn<(args: RunEphemeralTurnArgs) => Promise<RunEphemeralTurnResult>>()
			.mockImplementationOnce(async args => {
				signals.push(args.signal as AbortSignal);
				return firstPromise;
			})
			.mockImplementationOnce(async args => {
				signals.push(args.signal as AbortSignal);
				return { replyText: "second", assistantMessage: createAssistantMessage("second") };
			});
		const btwContainer = new Container();
		const ctx = await makeCtx(makeFakeSession(runEphemeralTurn), btwContainer);
		const controller = new BtwController(ctx);

		await controller.start("First?");
		await waitFor(() => ctx.mvuInputLeaseManager.current().kind === "mvu");
		const firstLeaseGeneration = ctx.mvuInputLeaseManager.current().generation;
		await controller.start("Second?");
		await waitFor(() => {
			const lease = ctx.mvuInputLeaseManager.current();
			return lease.kind === "mvu" && lease.generation > firstLeaseGeneration;
		});
		// Allow the second call to settle.
		await Promise.resolve();
		await Promise.resolve();

		expect(runEphemeralTurn).toHaveBeenCalledTimes(2);
		expect(signals[0]?.aborted).toBe(true);
		expect(signals[1]?.aborted).toBe(false);
		expect(btwContainer.children).toHaveLength(1);
		// Allow the orphaned first request to finish to keep the test clean.
		firstRelease();
	});

	it("clears the panel when the active request is dismissed via Escape", async () => {
		const runEphemeralTurn = vi.fn(async () => new Promise<RunEphemeralTurnResult>(() => {}));
		const btwContainer = new Container();
		const ctx = await makeCtx(makeFakeSession(runEphemeralTurn), btwContainer);
		const controller = new BtwController(ctx);

		await controller.start("Question?");
		await waitFor(() => ctx.mvuInputLeaseManager.current().kind === "mvu");
		expect(btwContainer.children).toHaveLength(1);
		expect(controller.handleEscape()).toBe(true);
		await waitFor(() => ctx.mvuInputLeaseManager.current().kind === "legacy");
		expect(btwContainer.children).toHaveLength(0);
		expect(controller.hasActiveRequest()).toBe(false);
	});

	it("rejects empty questions before issuing the side-channel call", async () => {
		const runEphemeralTurn = vi.fn(async () => ({
			replyText: "n/a",
			assistantMessage: createAssistantMessage("n/a"),
		}));
		const ctx = await makeCtx(makeFakeSession(runEphemeralTurn));
		const controller = new BtwController(ctx);

		await controller.start("   ");
		expect(runEphemeralTurn).not.toHaveBeenCalled();
		expect(controller.hasActiveRequest()).toBe(false);
	});

	it("shows an error message when no model is configured", async () => {
		const runEphemeralTurn = vi.fn(async () => ({
			replyText: "n/a",
			assistantMessage: createAssistantMessage("n/a"),
		}));
		const session = { model: undefined, runEphemeralTurn } as unknown as InteractiveModeContext["session"];
		const ctx = await makeCtx(session);
		const controller = new BtwController(ctx);

		await controller.start("Anything?");
		expect(runEphemeralTurn).not.toHaveBeenCalled();
		expect(ctx.showError).toHaveBeenCalled();
	});

describe("BtwPanelComponent", () => {
	it("uses an injected component-render callback without requiring a TUI instance", () => {
		const requested: Component[] = [];
		const requestComponentRender: BtwPanelComponentOptions["requestComponentRender"] = component => {
			requested.push(component);
		};
		const component = new BtwPanelComponent({ requestComponentRender }, makeBtwPanelModel("Why?"));

		expect(requested).toEqual([component]);
		component.apply({ question: "Why?", answer: "Because.", state: "complete" });
		expect(requested).toEqual([component, component]);
	});
});
});
