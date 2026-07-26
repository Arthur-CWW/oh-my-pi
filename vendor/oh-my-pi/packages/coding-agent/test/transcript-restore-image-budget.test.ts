import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { UiHelpers } from "@oh-my-pi/pi-coding-agent/modes/utils/ui-helpers";
import type { SessionContext } from "@oh-my-pi/pi-coding-agent/session/session-context";
import { Container, Image, ImageBudget, ImageProtocol, TERMINAL } from "@oh-my-pi/pi-tui";

const LARGE_IMAGE_PAYLOAD = "A".repeat(32 * 1024);
const originalImageProtocol = TERMINAL.imageProtocol;
const terminal = TERMINAL as unknown as { imageProtocol: ImageProtocol | null };

function imageTranscript(resultCount: number): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for (let index = 0; index < resultCount; index++) {
		const toolCallId = `image-${index}`;
		messages.push(
			{
				role: "assistant",
				content: [{ type: "toolCall", id: toolCallId, name: "image_probe", arguments: {} }],
				stopReason: "stop",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
				timestamp: index,
			} as unknown as AgentMessage,
			{
				role: "toolResult",
				toolCallId,
				toolName: "image_probe",
				content: [{ type: "image", data: `${LARGE_IMAGE_PAYLOAD}${index}`, mimeType: "image/test" }],
				timestamp: index,
			} as unknown as AgentMessage,
		);
	}
	return messages;
}

function makeHarness(): { ctx: InteractiveModeContext; helpers: UiHelpers } {
	let helpers: UiHelpers;
	const ctx = {
		chatContainer: new Container(),
		pendingTools: new Map(),
		ui: {
			imageBudget: new ImageBudget(),
			requestRender: vi.fn(),
			requestComponentRender: vi.fn(),
		},
		statusLine: { invalidate: vi.fn() },
		updateEditorBorderColor: vi.fn(),
		settings: { get: () => false },
		addMessageToChat: (message: AgentMessage) => helpers.addMessageToChat(message),
		session: {
			retryAttempt: 0,
			getToolByName: () => undefined,
			sessionManager: { getCwd: () => process.cwd() },
		},
		get viewSession() {
			return (this as typeof ctx).session;
		},
		toolOutputExpanded: false,
		hideThinkingBlock: false,
		richTranscript: true,
	} as unknown as InteractiveModeContext;
	helpers = new UiHelpers(ctx);
	return { ctx, helpers };
}

describe("restored transcript image memory budget", () => {
	beforeAll(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true });
		await initTheme();
	});

	afterEach(() => {
		terminal.imageProtocol = originalImageProtocol;
	});

	it("bounds restored history and releases fallback and demoted image payloads", () => {
		terminal.imageProtocol = null;
		const { ctx, helpers } = makeHarness();

		helpers.renderSessionContext({ messages: imageTranscript(300) } as SessionContext);

		// The bounded 200-message tail contains 100 assistant/result pairs, plus
		// one omission marker. The other 200 image results never become components.
		expect(ctx.chatContainer.children.length).toBeLessThanOrEqual(201);

		const image = new Image(
			LARGE_IMAGE_PAYLOAD,
			"image/test",
			{ fallbackColor: text => text },
			{},
			{ widthPx: 640, heightPx: 480 },
		);
		expect(image.hasRetainedPayload).toBe(true);
		expect(image.render(80).join("\n")).toContain("[Image:");
		expect(image.hasRetainedPayload).toBe(false);

		terminal.imageProtocol = ImageProtocol.Kitty;
		const budget = new ImageBudget(1);
		const older = new Image(
			LARGE_IMAGE_PAYLOAD,
			"image/test",
			{ fallbackColor: text => text },
			{ budget, imageKey: "older" },
			{ widthPx: 640, heightPx: 480 },
		);
		const newer = new Image(
			LARGE_IMAGE_PAYLOAD,
			"image/test",
			{ fallbackColor: text => text },
			{ budget, imageKey: "newer" },
			{ widthPx: 640, heightPx: 480 },
		);
		for (let pass = 0; pass < 2; pass++) {
			budget.beginPass();
			older.render(80);
			newer.render(80);
			budget.endPass();
			budget.takeTransmits();
		}
		expect(older.hasRetainedPayload).toBe(false);
		expect(newer.hasRetainedPayload).toBe(true);
	});
});
