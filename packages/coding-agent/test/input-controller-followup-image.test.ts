/**
 * Regression: enqueuing a follow-up message (Ctrl+Enter /
 * `app.message.followUp`) with a pending clipboard-pasted image must forward
 * the image through the durable `session.sendUserMessage` API. Previously
 * `handleFollowUp` ignored `pendingImages`, so the queued message reached the
 * model as text only and the image was silently dropped.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";
import type { ImageContent, TextContent } from "@oh-my-pi/pi-ai";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";

interface StubEditor {
	setText: (text: string) => void;
	getText: () => string;
	addToHistory: (text: string) => void;
	imageLinks?: unknown;
}
type SendUserMessageContent = string | (TextContent | ImageContent)[];

interface SendUserMessageOptions {
	deliverAs?: "steer" | "followUp";
}

function createContext(opts: { isStreaming: boolean; pendingImages: ImageContent[] }) {
	let editorText = "";
	const editor: StubEditor = {
		setText(text) {
			editorText = text;
		},
		getText() {
			return editorText;
		},
		addToHistory: vi.fn(),
	};
	const sendUserMessage = vi.fn(async (_content: SendUserMessageContent, _options?: SendUserMessageOptions) => {});
	const updatePendingMessagesDisplay = vi.fn();
	const requestRender = vi.fn();

	const ctx = {
		editor,
		ui: { requestRender },
		skillCommands: new Map<string, string>(),
		session: {
			isStreaming: opts.isStreaming,
			isCompacting: false,
			isBashRunning: false,
			isEvalRunning: false,
			extensionRunner: undefined,
			sendUserMessage,
		},
		pendingImages: opts.pendingImages,
		pendingImageLinks: opts.pendingImages.map(() => undefined),
		loopModeEnabled: false,
		compactionQueuedMessages: [],
		locallySubmittedUserSignatures: new Set<string>(),
		updatePendingMessagesDisplay,
		withLocalSubmission: async (_text: string, fn: () => unknown) => fn(),
	} as unknown as InteractiveModeContext;

	return { ctx, editor, sendUserMessage };
}

describe("InputController.handleFollowUp image forwarding", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("enqueues pending images through session.sendUserMessage while streaming and clears them", async () => {
		const image: ImageContent = { type: "image", mimeType: "image/png", data: "aGVsbG8=" };
		const { ctx, editor, sendUserMessage } = createContext({ isStreaming: true, pendingImages: [image] });

		const controller = new InputController(ctx);
		editor.setText("[Image #1] look at this");
		await controller.handleFollowUp();

		expect(sendUserMessage).toHaveBeenCalledTimes(1);
		expect(sendUserMessage).toHaveBeenCalledWith(
			[{ type: "text", text: "[Image #1] look at this" }, image],
			{ deliverAs: "followUp" },
		);

		// Pending image state is consumed so the next message does not resend it.
		expect(ctx.pendingImages).toEqual([]);
		expect(ctx.pendingImageLinks).toEqual([]);
	});

	it("enqueues pending images through session.sendUserMessage while idle and clears them", async () => {
		const image: ImageContent = { type: "image", mimeType: "image/png", data: "d29ybGQ=" };
		const { ctx, editor, sendUserMessage } = createContext({ isStreaming: false, pendingImages: [image] });

		const controller = new InputController(ctx);
		editor.setText("[Image #1] describe it");
		await controller.handleFollowUp();

		expect(sendUserMessage).toHaveBeenCalledTimes(1);
		expect(sendUserMessage).toHaveBeenCalledWith(
			[{ type: "text", text: "[Image #1] describe it" }, image],
			{ deliverAs: "followUp" },
		);
		expect(ctx.pendingImages).toEqual([]);
		expect(ctx.pendingImageLinks).toEqual([]);
	});

	it("omits images when none are pending", async () => {
		const { ctx, editor, sendUserMessage } = createContext({ isStreaming: true, pendingImages: [] });

		const controller = new InputController(ctx);
		editor.setText("just text");
		await controller.handleFollowUp();

		expect(sendUserMessage).toHaveBeenCalledTimes(1);
		expect(sendUserMessage).toHaveBeenCalledWith("just text", { deliverAs: "followUp" });
	});
});
