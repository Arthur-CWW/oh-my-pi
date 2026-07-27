import { describe, expect, it, vi } from "bun:test";
import type { ExtensionUIContext } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { ExtensionUiController } from "@oh-my-pi/pi-coding-agent/modes/controllers/extension-ui-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { Container } from "@oh-my-pi/pi-tui";

function makeContext(borderless: boolean): {
	ctx: InteractiveModeContext;
	above: Container;
} {
	const above = new Container();
	const ctx = {
		hookWidgetContainerAbove: above,
		hookWidgetContainerBelow: new Container(),
		statusLine: { isBorderless: () => borderless },
		ui: { requestRender: () => {} },
	} as unknown as InteractiveModeContext;
	return { ctx, above };
}

describe("ExtensionUiController hook widget layout", () => {
	it("omits an empty above-editor spacer for compact status lines", () => {
		const { ctx, above } = makeContext(true);
		const controller = new ExtensionUiController(ctx);

		controller.setHookWidget("test", ["widget"]);
		expect(above.children).toHaveLength(2);

		controller.setHookWidget("test", undefined);
		expect(above.children).toHaveLength(0);
	});

	it("keeps the empty above-editor spacer for bordered status lines", () => {
		const { ctx, above } = makeContext(false);
		const controller = new ExtensionUiController(ctx);

		controller.setHookWidget("test", ["widget"]);
		controller.setHookWidget("test", undefined);

		expect(above.children).toHaveLength(1);
	});
});

describe("ExtensionUiController editor paste", () => {
	it("passes extension text literally through the editor paste seam", async () => {
		let uiContext: ExtensionUIContext | undefined;
		const applyPaste = vi.fn();
		const ctx = {
			editor: {
				applyPaste,
				setText: () => {},
				getText: () => "",
			},
			session: { extensionRunner: undefined },
			setToolUIContext: (context: ExtensionUIContext) => {
				uiContext = context;
			},
		} as unknown as InteractiveModeContext;

		await new ExtensionUiController(ctx).initHooksAndCustomTools();

		expect(uiContext).toBeDefined();
		const literal = "extension paste\nwithout terminal escapes";
		uiContext?.pasteToEditor(literal);

		expect(applyPaste).toHaveBeenCalledWith(literal);
		const received = String(applyPaste.mock.calls[0]?.[0] ?? "");
		expect(received).toBe(literal);
		expect(received).not.toContain("\x1b[200~");
	});
});
