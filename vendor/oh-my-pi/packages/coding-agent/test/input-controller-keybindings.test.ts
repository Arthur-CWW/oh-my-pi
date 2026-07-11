import { describe, expect, it, vi } from "bun:test";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import type { DurableInputPayload, DurableQueuedInput } from "@oh-my-pi/pi-coding-agent/session/durable-input-queue";
import manualContinuePrompt from "../src/prompts/system/manual-continue.md" with { type: "text" };

type FakeEditor = {
	onEscape?: () => void;
	onClear?: () => void;
	onExit?: () => void;
	onDisplayReset?: () => void;
	onSuspend?: () => void;
	onCycleThinkingLevel?: () => void;
	onCycleModelForward?: () => void;
	onCycleModelBackward?: () => void;
	onSelectModelTemporary?: () => void;
	onSelectModel?: () => void;
	onHistorySearch?: () => void;
	onPasteImage?: () => Promise<boolean>;
	onCopyPrompt?: () => void;
	onExpandTools?: () => void;
	onToggleThinking?: () => void;
	onExternalEditor?: () => void;
	onDequeue?: () => void;
	onChange?: (text: string) => void;
	onSubmit?: (text: string) => Promise<void>;
	setText(text: string): void;
	getText(): string;
	addToHistory(text: string): void;
	setActionKeys(action: string, keys: string[]): void;
	setCustomKeyHandler(key: string, handler: () => void): void;
	clearCustomKeyHandlers(): void;
	pasteText(text: string): void;
};

type DurableProjectionItem = DurableQueuedInput;

function installDurableInputSeam(
	ctx: InteractiveModeContext,
	projection: DurableProjectionItem[],
	edit: (inputId: string, revision: number, payload: DurableInputPayload) => Promise<DurableQueuedInput>,
): { clearQueueCalls: () => number; cancelCalls: () => number } {
	let clearQueueCalls = 0;
	let cancelCalls = 0;
	const session = ctx.session as AgentSession;
	Object.assign(session, {
		getQueuedInputProjection: () => projection,
		editQueuedInput: edit,
		clearQueue: () => {
			clearQueueCalls += 1;
			return { steering: [], followUp: [] };
		},
		cancelQueuedInput: async () => {
			cancelCalls += 1;
			return projection[0]!;
		},
	} satisfies Pick<AgentSession, "getQueuedInputProjection" | "editQueuedInput" | "clearQueue" | "cancelQueuedInput">);
	return { clearQueueCalls: () => clearQueueCalls, cancelCalls: () => cancelCalls };
}
async function createContext() {
	let editorText = "";
	const keyMap: Record<string, string[]> = {
		"app.display.reset": ["ctrl+l"],
		"app.model.selectTemporary": ["ctrl+y"],
		"app.model.select": ["alt+m"],
		"app.message.followUp": ["ctrl+q", "ctrl+enter"],
		"app.agents.returnToParent": ["alt+shift+left"],
	};
	const customHandlers = new Map<string, () => void>();
	const setActionKeys = vi.fn();
	const setCustomKeyHandler = vi.fn((key: string, handler: () => void) => {
		customHandlers.set(key, handler);
	});
	const clearCustomKeyHandlers = vi.fn(() => {
		customHandlers.clear();
	});
	const resetDisplay = vi.fn();
	const showModelSelector = vi.fn();
	const requestRender = vi.fn();
	const addInputListener = vi.fn();
	const addStartListener = vi.fn();
	const terminalWrite = vi.fn();
	const prompt = vi.fn(async () => {});
	const abort = vi.fn(async () => {});
	const sendUserMessage = vi.fn(async () => {});
	const hardCancel = vi.fn();
	const focusParentSession = vi.fn(async () => {});
	const showStatus = vi.fn();
	const updatePendingMessagesDisplay = vi.fn();
	const showError = vi.fn();
	const editor: FakeEditor = {
		setText(text: string) {
			editorText = text;
		},
		getText() {
			return editorText;
		},
		addToHistory: vi.fn(),
		pasteText(text: string) {
			editorText += text;
		},
		setActionKeys,
		setCustomKeyHandler,
		clearCustomKeyHandlers,
	};
	const ctx = {
		editor: editor as unknown as InteractiveModeContext["editor"],
		ui: {
			requestRender,
			resetDisplay,
			addInputListener,
			addStartListener,
			terminal: { write: terminalWrite },
		} as unknown as InteractiveModeContext["ui"],
		loadingAnimation: undefined,
		autoCompactionLoader: undefined,
		retryLoader: undefined,
		autoCompactionEscapeHandler: undefined,
		retryEscapeHandler: undefined,
		session: {
			isStreaming: false,
			isCompacting: false,
			isGeneratingHandoff: false,
			isBashRunning: false,
			isEvalRunning: false,
			extensionRunner: undefined,
			prompt,
			queuedMessageCount: 0,
			sendUserMessage,
			abort,
			cancel: hardCancel,
		} as unknown as InteractiveModeContext["session"],
		keybindings: {
			getKeys(action: string) {
				return keyMap[action] ? [...keyMap[action]] : [];
			},
		} as InteractiveModeContext["keybindings"],
		pendingImages: [],
		locallySubmittedUserSignatures: new Set<string>(),
		isKnownSlashCommand: () => false,
		recordLocalSubmission(this: InteractiveModeContext, text: string, imageCount = 0) {
			if (this.isKnownSlashCommand(text)) return () => {};
			const sig = `${text}\u0000${imageCount}`;
			this.locallySubmittedUserSignatures.add(sig);
			let disposed = false;
			return () => {
				if (disposed) return;
				disposed = true;
				this.locallySubmittedUserSignatures.delete(sig);
			};
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
			} catch (err) {
				dispose();
				throw err;
			}
		},
		updatePendingMessagesDisplay,
		isBashMode: false,
		isPythonMode: false,
		handleHotkeysCommand: vi.fn(),
		handlePlanModeCommand: vi.fn(),
		handleClearCommand: vi.fn(),
		showTreeSelector: vi.fn(),
		showUserMessageSelector: vi.fn(),
		showSessionSelector: vi.fn(),
		handleSTTToggle: vi.fn(),
		showDebugSelector: vi.fn(),
		showHistorySearch: vi.fn(),
		toggleThinkingBlockVisibility: vi.fn(),
		showModelSelector,
		focusParentSession,
		showStatus,
		focusedAgentId: undefined,
		viewSession: undefined,
		updateEditorBorderColor: vi.fn(),
		hasActiveBtw: vi.fn(() => false),
		showError,
	} as unknown as InteractiveModeContext;
	Object.defineProperty(ctx, "viewSession", { get: () => ctx.session });

	return {
		InputController,
		ctx,
		editor,
		customHandlers,
		spies: {
			setActionKeys,
			showModelSelector,
			prompt,
			updatePendingMessagesDisplay,
			sendUserMessage,
			requestRender,
			abort,
			hardCancel,
			focusParentSession,
			showStatus,
			resetDisplay,
			showError,
		},
	};
}

describe("InputController keybinding setup", () => {
	it("registers model selector and display reset actions separately", async () => {
		const { InputController, ctx, editor, spies } = await createContext();
		const controller = new InputController(ctx);

		controller.setupKeyHandlers();

		expect(spies.setActionKeys).toHaveBeenCalledWith("app.display.reset", ["ctrl+l"]);
		expect(spies.setActionKeys).toHaveBeenCalledWith("app.model.selectTemporary", ["ctrl+y"]);
		expect(spies.setActionKeys).toHaveBeenCalledWith("app.model.select", ["alt+m"]);
		expect(editor.onDisplayReset).toBeDefined();
		expect(editor.onSelectModelTemporary).toBeDefined();
		expect(editor.onSelectModel).toBeDefined();
		expect(editor.onExit).toBeDefined();
		expect(editor.onSelectModelTemporary).not.toBe(editor.onSelectModel);

		editor.onDisplayReset?.();
		editor.onSelectModelTemporary?.();
		editor.onSelectModel?.();

		expect(spies.showModelSelector).toHaveBeenNthCalledWith(1, { temporaryOnly: true });
		expect(spies.showModelSelector).toHaveBeenNthCalledWith(2);
		expect(spies.resetDisplay).toHaveBeenCalledTimes(1);
	});

	it("empty Enter aborts the active stream when queued messages are pending", async () => {
		const { InputController, ctx, editor, spies } = await createContext();
		const session = ctx.session as unknown as { isStreaming: boolean; queuedMessageCount: number };
		session.isStreaming = true;
		session.queuedMessageCount = 1;
		const controller = new InputController(ctx);

		controller.setupEditorSubmitHandler();
		await editor.onSubmit?.("");

		expect(spies.abort).toHaveBeenCalledWith({ reason: "Interrupted by user" });
		expect(spies.updatePendingMessagesDisplay).toHaveBeenCalledTimes(1);
		expect(spies.requestRender).toHaveBeenCalledTimes(1);
		expect(spies.prompt).not.toHaveBeenCalled();
	});

	it("restores exactly one highest-sequence durable input without class grouping or queue mutation", async () => {
		const { InputController, ctx, editor } = await createContext();
		const projection: DurableProjectionItem[] = [
			{
				inputId: "steer-2",
				sequence: 2,
				deliveryClass: "steer",
				revision: 1,
				payload: { text: "first steer", images: undefined },
				state: "queued",
				attempts: [],
			},
			{
				inputId: "follow-9",
				sequence: 9,
				deliveryClass: "followUp",
				revision: 4,
				payload: { text: "latest follow-up", images: undefined },
				state: "queued",
				attempts: [],
			},
		];
		const seam = installDurableInputSeam(ctx, projection, async () => projection[1]!);
		const controller = new InputController(ctx);

		expect(controller.restoreQueuedMessagesToEditor()).toBe(1);
		expect(editor.getText()).toBe("latest follow-up");
		expect(seam.clearQueueCalls()).toBe(0);
		expect(seam.cancelCalls()).toBe(0);
	});

	it("edits the restored durable input by stable identity and revision", async () => {
		const { InputController, ctx, editor, spies } = await createContext();
		const projection: DurableProjectionItem[] = [
			{
				inputId: "input-7",
				sequence: 7,
				deliveryClass: "steer",
				revision: 3,
				payload: { text: "original", images: undefined },
				state: "queued",
				attempts: [],
			},
		];
		const edits: { inputId: string; revision: number; payload: DurableInputPayload }[] = [];
		installDurableInputSeam(ctx, projection, async (inputId, revision, payload) => {
			edits.push({ inputId, revision, payload });
			return projection[0]!;
		});
		const controller = new InputController(ctx);
		controller.restoreQueuedMessagesToEditor();
		editor.setText("replacement");
		controller.setupEditorSubmitHandler();

		await editor.onSubmit?.("replacement");

		expect(edits).toEqual([{ inputId: "input-7", revision: 3, payload: { text: "replacement", images: undefined } }]);
		expect(editor.getText()).toBe("");
		expect(spies.prompt).not.toHaveBeenCalled();
	});

	it("releases a stale queued edit token so the retained draft submits as new input", async () => {
		const { InputController, ctx, editor, spies } = await createContext();
		const session = ctx.session as unknown as { isStreaming: boolean };
		session.isStreaming = true;
		const projection: DurableProjectionItem[] = [
			{
				inputId: "input-8",
				sequence: 8,
				deliveryClass: "steer",
				revision: 5,
				payload: { text: "original", images: undefined },
				state: "queued",
				attempts: [],
			},
		];
		const attemptedRevisions: number[] = [];
		installDurableInputSeam(ctx, projection, async (_inputId, revision) => {
			attemptedRevisions.push(revision);
			throw new Error("queued input input-8 was admitted");
		});
		const controller = new InputController(ctx);
		controller.restoreQueuedMessagesToEditor();
		editor.setText("keep this draft");
		controller.setupEditorSubmitHandler();

		await editor.onSubmit?.("keep this draft");

		expect(editor.getText()).toBe("keep this draft");
		expect(spies.showError).toHaveBeenCalledWith("queued input input-8 was admitted");

		await editor.onSubmit?.("keep this draft");

		expect(attemptedRevisions).toEqual([5]);
		expect(spies.prompt).toHaveBeenCalledTimes(1);
		expect(spies.prompt).toHaveBeenCalledWith("keep this draft", {
			streamingBehavior: "steer",
			images: undefined,
		});
	});

	it("marks streaming follow-up submissions as local", async () => {
		const { InputController, ctx, editor, spies } = await createContext();
		const session = ctx.session as unknown as { isStreaming: boolean };
		session.isStreaming = true;
		editor.setText("follow up after current response");
		const controller = new InputController(ctx);

		await controller.handleFollowUp();

		expect(ctx.locallySubmittedUserSignatures.has("follow up after current response\u00000")).toBe(true);
		expect(spies.sendUserMessage).toHaveBeenCalledWith("follow up after current response", {
			deliverAs: "followUp",
		});
		expect(spies.updatePendingMessagesDisplay).toHaveBeenCalledTimes(1);
	});

	it("marks idle follow-up submissions as local", async () => {
		const { InputController, ctx, editor, spies } = await createContext();
		// Default fake session is idle.
		editor.setText("plain idle submit");
		const controller = new InputController(ctx);

		await controller.handleFollowUp();

		expect(ctx.locallySubmittedUserSignatures.has("plain idle submit\u00000")).toBe(true);
		expect(spies.sendUserMessage).toHaveBeenCalledWith("plain idle submit", { deliverAs: "followUp" });
	});

	it("removes the signature when an idle follow-up submission rejects", async () => {
		const { InputController, ctx, editor, spies } = await createContext();
		spies.sendUserMessage.mockImplementationOnce(async () => {
			throw new Error("boom");
		});
		editor.setText("doomed submit");
		const controller = new InputController(ctx);

		await expect(controller.handleFollowUp()).rejects.toThrow("boom");

		// Contract: a thrown delivery error must not leave a stale signature
		// behind, otherwise the next attempt with the same text would silently
		// suppress the editor-clear protection that was meant for the failed call.
		expect(ctx.locallySubmittedUserSignatures.has("doomed submit\u00000")).toBe(false);
	});

	it("removes the signature when a streaming follow-up rejects", async () => {
		const { InputController, ctx, editor, spies } = await createContext();
		const session = ctx.session as unknown as { isStreaming: boolean };
		session.isStreaming = true;
		spies.sendUserMessage.mockImplementationOnce(async () => {
			throw new Error("queue full");
		});
		editor.setText("queued during stream");
		const controller = new InputController(ctx);

		await expect(controller.handleFollowUp()).rejects.toThrow("queue full");

		expect(ctx.locallySubmittedUserSignatures.has("queued during stream\u00000")).toBe(false);
	});

	it("continue shortcuts submit a hidden synthetic developer directive", async () => {
		for (const shortcut of [".", "c"]) {
			const { InputController, ctx, editor } = await createContext();
			const onInput = vi.fn();
			ctx.onInputCallback = onInput;
			const controller = new InputController(ctx);

			controller.setupEditorSubmitHandler();
			await editor.onSubmit?.(shortcut);

			expect(onInput, `shortcut ${shortcut}`).toHaveBeenCalledWith({
				text: manualContinuePrompt,
				cancelled: false,
				started: true,
				synthetic: true,
				userInitiated: true,
			});
		}
	});

	it("Ctrl+Q softly interrupts a running focused child, preserves its draft, and returns to its parent", async () => {
		const { InputController, ctx, editor, customHandlers, spies } = await createContext();
		const session = ctx.session as unknown as { isStreaming: boolean };
		session.isStreaming = true;
		(ctx as unknown as { focusedAgentId?: string }).focusedAgentId = "Worker";
		editor.setText("keep this draft");
		const controller = new InputController(ctx);
		controller.setupKeyHandlers();

		customHandlers.get("ctrl+q")?.();
		await Promise.resolve();
		await Promise.resolve();

		expect(spies.abort).toHaveBeenCalledWith({ reason: "Interrupted by user" });
		expect(spies.hardCancel).not.toHaveBeenCalled();
		expect(spies.focusParentSession).toHaveBeenCalledTimes(1);
		expect(editor.getText()).toBe("keep this draft");
		expect(spies.showStatus).toHaveBeenCalledWith("Interrupted Worker; returned to parent with draft preserved");
	});

	it("Ctrl+Q returns from an idle focused child without interrupting or clearing its draft", async () => {
		const { InputController, ctx, editor, customHandlers, spies } = await createContext();
		(ctx as unknown as { focusedAgentId?: string }).focusedAgentId = "Worker";
		editor.setText("resume me later");
		const controller = new InputController(ctx);
		controller.setupKeyHandlers();

		customHandlers.get("ctrl+q")?.();
		await Promise.resolve();

		expect(spies.abort).not.toHaveBeenCalled();
		expect(spies.focusParentSession).toHaveBeenCalledTimes(1);
		expect(editor.getText()).toBe("resume me later");
	});

	it("Ctrl+Q retains its main-session follow-up behavior", async () => {
		const { InputController, ctx, editor, customHandlers, spies } = await createContext();
		editor.setText("main follow-up");
		const controller = new InputController(ctx);
		controller.setupKeyHandlers();

		customHandlers.get("ctrl+q")?.();
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(spies.sendUserMessage).toHaveBeenCalledWith("main follow-up", { deliverAs: "followUp" });
		expect(spies.focusParentSession).not.toHaveBeenCalled();
	});

	it("the dedicated parent shortcut leaves a nonempty focused draft intact", async () => {
		const { InputController, ctx, editor, customHandlers, spies } = await createContext();
		(ctx as unknown as { focusedAgentId?: string }).focusedAgentId = "Worker";
		editor.setText("draft at cursor");
		const controller = new InputController(ctx);
		controller.setupKeyHandlers();

		customHandlers.get("alt+shift+left")?.();
		await Promise.resolve();

		expect(spies.abort).not.toHaveBeenCalled();
		expect(spies.focusParentSession).toHaveBeenCalledTimes(1);
		expect(editor.getText()).toBe("draft at cursor");
	});
});
