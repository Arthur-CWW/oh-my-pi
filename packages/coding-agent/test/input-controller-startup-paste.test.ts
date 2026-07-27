import { describe, expect, it, vi } from "bun:test";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { Editor, StdinBuffer } from "@oh-my-pi/pi-tui";
import { defaultEditorTheme } from "../../tui/test/test-themes";

function createTerminalInputPipeline() {
	let steerCount = 0;
	const steerWaiters: Array<{ count: number; resolve: () => void }> = [];
	const steer = vi.fn(async (_text: string, _images?: unknown) => {
		steerCount++;
		for (let index = steerWaiters.length - 1; index >= 0; index--) {
			const waiter = steerWaiters[index]!;
			if (steerCount < waiter.count) continue;
			steerWaiters.splice(index, 1);
			waiter.resolve();
		}
	});
	const waitForSteers = (count: number): Promise<void> => {
		if (steerCount >= count) return Promise.resolve();
		return new Promise(resolve => steerWaiters.push({ count, resolve }));
	};
	const requestRender = vi.fn();
	const editor = new Editor(defaultEditorTheme);
	const ctx = {
		editor,
		ui: { requestRender },
		session: {
			isStreaming: false,
			isCompacting: false,
			isBashRunning: false,
			isEvalRunning: false,
			extensionRunner: undefined,
			steer,
			prompt: vi.fn(async () => {}),
			queuedMessageCount: 0,
			getQueuedMessages: () => ({ steering: [], followUp: [] }),
			getQueuedInputProjection: () => [],
		},
		sessionManager: {
			getSessionName: () => "named-session",
			getSessionFile: () => undefined,
		},
		pendingImages: [],
		pendingImageLinks: [],
		fileSlashCommands: new Set<string>(),
		locallySubmittedUserSignatures: new Set<string>(),
		isKnownSlashCommand: () => false,
		recordLocalSubmission(this: InteractiveModeContext, text: string, imageCount = 0) {
			const signature = `${text}\u0000${imageCount}`;
			this.locallySubmittedUserSignatures.add(signature);
			return () => this.locallySubmittedUserSignatures.delete(signature);
		},
		async withLocalSubmission<T>(
			this: InteractiveModeContext,
			text: string,
			fn: () => Promise<T>,
			options?: { imageCount?: number },
		): Promise<T> {
			const dispose = this.recordLocalSubmission(text, options?.imageCount ?? 0);
			try {
				return await fn();
			} catch (error) {
				dispose();
				throw error;
			}
		},
		onInputCallback: undefined,
		updatePendingMessagesDisplay: vi.fn(),
		flushPendingBashComponents: vi.fn(),
		showError: vi.fn(),
		isBashMode: false,
		isPythonMode: false,
	} as unknown as InteractiveModeContext;

	const controller = new InputController(ctx);
	controller.setupEditorSubmitHandler();
	const stdin = new StdinBuffer({ timeout: 10 });
	stdin.on("data", sequence => editor.handleInput(sequence));
	stdin.on("paste", content => editor.handleInput(`\x1b[200~${content}\x1b[201~`));
	return { editor, stdin, steer, waitForSteers };
}

describe("InputController startup paste input", () => {
	it("queues one steer after an unmarked multiline startup chunk", async () => {
		const { editor, stdin, steer, waitForSteers } = createTerminalInputPipeline();
		try {
			stdin.process("alpha\nbeta\ngamma");
			expect(editor.getText()).toBe("alpha\nbeta\ngamma");
			expect(steer).not.toHaveBeenCalled();

			stdin.process("\r");
			await waitForSteers(1);

			expect(steer).toHaveBeenCalledTimes(1);
			expect(steer).toHaveBeenCalledWith("alpha\nbeta\ngamma", undefined);
		} finally {
			stdin.destroy();
		}
	});

	it("keeps genuine separate Enter submissions separate", async () => {
		const { stdin, steer, waitForSteers } = createTerminalInputPipeline();
		try {
			stdin.process("first");
			stdin.process("\r");
			stdin.process("second");
			stdin.process("\r");
			await waitForSteers(2);

			expect(steer).toHaveBeenCalledTimes(2);
			expect(steer).toHaveBeenNthCalledWith(1, "first", undefined);
			expect(steer).toHaveBeenNthCalledWith(2, "second", undefined);
		} finally {
			stdin.destroy();
		}
	});

	it("keeps bracketed paste on the single-submit path", async () => {
		const { stdin, steer, waitForSteers } = createTerminalInputPipeline();
		try {
			stdin.process("\x1b[200~one\ntwo\x1b[201~");
			stdin.process("\r");
			await waitForSteers(1);

			expect(steer).toHaveBeenCalledTimes(1);
			expect(steer).toHaveBeenCalledWith("one\ntwo", undefined);
		} finally {
			stdin.destroy();
		}
	});
});
