import { beforeAll, describe, expect, test } from "bun:test";
import type { ImageContent } from "@oh-my-pi/pi-ai";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";

beforeAll(() => {
	initTheme();
});

type DeliveredContent = string | Array<{ type: "text"; text: string } | ImageContent>;
type DeliveryClass = "steer" | "followUp";
type DeliveredMessage = { content: DeliveredContent; deliverAs: DeliveryClass };

const img = (data: string): ImageContent => ({ type: "image", mimeType: "image/png", data });

function makeCtx(onSend: (content: DeliveredContent, deliverAs: DeliveryClass) => Promise<void>) {
	let editorText = "";
	const history: string[] = [];
	const session = {
		isStreaming: false,
		isCompacting: true,
		extensionRunner: undefined,
		customCommands: [] as Array<{ command: { name: string } }>,
		async sendUserMessage(content: DeliveredContent, options: { deliverAs: DeliveryClass }): Promise<void> {
			await onSend(content, options.deliverAs);
		},
	};
	const editor = {
		addToHistory: (text: string) => history.push(text),
		setText: (text: string) => {
			editorText = text;
		},
		getText: () => editorText,
		imageLinks: undefined as (string | undefined)[] | undefined,
		onSubmit: undefined as ((text: string) => Promise<void>) | undefined,
	};
	const ctx = {
		session,
		editor,
		pendingImages: [] as ImageContent[],
		pendingImageLinks: [] as (string | undefined)[],
		locallySubmittedUserSignatures: new Set<string>(),
		withLocalSubmission: async <T>(_text: string, submit: () => Promise<T>): Promise<T> => await submit(),
		updatePendingMessagesDisplay: () => {},
		ui: { requestRender: () => {} },
	} as unknown as InteractiveModeContext;

	return { ctx, editor, history };
}

function expectCapturedContent(content: DeliveredContent, text: string, images: ImageContent[]): void {
	expect(content).toEqual([{ type: "text", text }, ...images]);
	if (typeof content === "string") throw new Error("Expected text-and-image content");
	for (const [index, image] of images.entries()) {
		expect(content[index + 1]).toBe(image);
	}
}

describe("compaction image capture", () => {
	test("Enter immediately captures a steer with its images before consuming editor ownership", async () => {
		const images = [img("c3RlZXItMQ=="), img("c3RlZXItMg==")];
		const calls: DeliveredMessage[] = [];
		const { ctx, editor, history } = makeCtx(async (content, deliverAs) => {
			calls.push({ content, deliverAs });
			expect(editor.getText()).toBe("describe both images");
			expect(ctx.pendingImages).toEqual(images);
			expect(ctx.pendingImageLinks).toEqual(["clipboard-1", "clipboard-2"]);
		});
		editor.setText("describe both images");
		editor.imageLinks = ["clipboard-1", "clipboard-2"];
		ctx.pendingImages = images;
		ctx.pendingImageLinks = ["clipboard-1", "clipboard-2"];

		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();
		const submit = editor.onSubmit;
		if (!submit) throw new Error("InputController did not install an editor submit handler");
		await submit("describe both images");

		expect(calls).toHaveLength(1);
		expect(calls[0]?.deliverAs).toBe("steer");
		expectCapturedContent(calls[0]!.content, "describe both images", images);
		expect(history).toEqual(["describe both images"]);
		expect(editor.getText()).toBe("");
		expect(editor.imageLinks).toBeUndefined();
		expect(ctx.pendingImages).toEqual([]);
		expect(ctx.pendingImageLinks).toEqual([]);
	});

	test("Ctrl+Enter immediately captures a follow-up with its images before consuming editor ownership", async () => {
		const images = [img("Zm9sbG93LXVw")];
		const calls: DeliveredMessage[] = [];
		const { ctx, editor, history } = makeCtx(async (content, deliverAs) => {
			calls.push({ content, deliverAs });
			expect(editor.getText()).toBe("compare this image");
			expect(ctx.pendingImages).toEqual(images);
			expect(ctx.pendingImageLinks).toEqual(["clipboard"]);
		});
		editor.setText("compare this image");
		editor.imageLinks = ["clipboard"];
		ctx.pendingImages = images;
		ctx.pendingImageLinks = ["clipboard"];

		await new InputController(ctx).handleFollowUp();

		expect(calls).toHaveLength(1);
		expect(calls[0]?.deliverAs).toBe("followUp");
		expectCapturedContent(calls[0]!.content, "compare this image", images);
		expect(history).toEqual(["compare this image"]);
		expect(editor.getText()).toBe("");
		expect(editor.imageLinks).toBeUndefined();
		expect(ctx.pendingImages).toEqual([]);
		expect(ctx.pendingImageLinks).toEqual([]);
	});
});
