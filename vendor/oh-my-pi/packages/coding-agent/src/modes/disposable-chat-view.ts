import {
	Container,
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	ProcessTerminal,
	type SymbolTheme,
	Text,
	TUI,
} from "@oh-my-pi/pi-tui";
import type { WorkflowModeSnapshot } from "../session/session-entries";
import { handleReloadTuiCommand, RELOAD_TUI_COMMAND, RELOAD_TUI_DESCRIPTION } from "../slash-commands/reload-tui";
import type { DisposableTerminalHostCallbacks, DisposableTerminalView } from "./disposable-terminal-host";
import type { TerminalSessionController } from "./terminal-session-controller";

const identity = (text: string): string => text;
const symbols: SymbolTheme = {
	cursor: ">",
	inputCursor: "|",
	boxRound: {
		topLeft: "+",
		topRight: "+",
		bottomLeft: "+",
		bottomRight: "+",
		horizontal: "-",
		vertical: "|",
	},
	boxSharp: {
		topLeft: "+",
		topRight: "+",
		bottomLeft: "+",
		bottomRight: "+",
		horizontal: "-",
		vertical: "|",
		teeDown: "+",
		teeUp: "+",
		teeLeft: "+",
		teeRight: "+",
		cross: "+",
	},
	table: {
		topLeft: "+",
		topRight: "+",
		bottomLeft: "+",
		bottomRight: "+",
		horizontal: "-",
		vertical: "|",
		teeDown: "+",
		teeUp: "+",
		teeLeft: "+",
		teeRight: "+",
		cross: "+",
	},
	quoteBorder: "|",
	hrChar: "-",
	spinnerFrames: ["-", "\\", "|", "/"],
};
const editorTheme: EditorTheme = {
	borderColor: identity,
	selectList: {
		selectedPrefix: identity,
		selectedText: identity,
		description: identity,
		scrollInfo: identity,
		noMatch: identity,
		symbols,
	},
	symbols,
};

interface DisposableChatViewCallbacks extends DisposableTerminalHostCallbacks {
	readonly requestReload: () => Promise<void>;
	readonly requestStop: () => Promise<void>;
}

function describeWorkflow(workflow: WorkflowModeSnapshot): string {
	switch (workflow.kind) {
		case "none":
			return "none";
		case "plan":
			return `plan:${workflow.phase}`;
		case "goal":
			return `goal:${workflow.phase}`;
	}
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "Unknown error";
}

/** Built-in compact revision for the opt-in disposable terminal host. */
export function createDisposableTerminalView(
	controller: TerminalSessionController,
	callbacks: DisposableTerminalHostCallbacks,
): DisposableTerminalView {
	const hostCallbacks = callbacks as DisposableChatViewCallbacks;
	let phase: "new" | "running" | "quiesced" | "disposed" = "new";
	let acceptingInput = false;
	let terminal: ProcessTerminal | undefined;
	let tui: TUI | undefined;
	let root: Container | undefined;
	let transcriptText: Text | undefined;
	let statusText: Text | undefined;
	let feedbackText: Text | undefined;
	let editor: Editor | undefined;
	let unsubscribeAgentEvents: (() => void) | undefined;
	let unsubscribeInput: (() => void) | undefined;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	let refreshTask: Promise<void> | undefined;
	let refreshAgain = false;
	let viewGeneration = 0;
	let lastSubmitStatus = "ready";
	let reloadPending = false;
	let stopPending = false;

	const requestRender = (): void => {
		if (phase === "running") tui?.requestRender();
	};

	const setFeedback = (message: string): void => {
		if (feedbackText?.setText(message)) requestRender();
	};

	const updateStatus = (): void => {
		const snapshot = controller.snapshot();
		const { runner, session } = snapshot;
		const model = session.modelSummary;
		const modelLabel = model ? `${model.provider}/${model.requestModelId ?? model.id}` : "unconfigured";
		const thinking = session.configuredThinkingLevel ?? session.effectiveThinkingLevel ?? "off";
		const activity: string[] = [];
		if (session.isStreaming || session.promptOperation.active) activity.push("streaming");
		if (session.isCompacting || runner.activeCompaction) activity.push("compacting");
		if (runner.activeLocalOperation || session.isBashRunning || session.isEvalRunning) {
			activity.push("local operation");
		}
		if (runner.activeEphemeralTurn) activity.push("ephemeral turn");
		if (session.hasPostPromptWork) activity.push("post-prompt work");
		if (activity.length === 0) activity.push("idle");
		const status = [
			`model ${modelLabel}`,
			`thinking ${thinking}`,
			`workflow ${describeWorkflow(session.workflow)}`,
			activity.join(", "),
			`runner ${runner.status}`,
			lastSubmitStatus,
		].join(" · ");
		if (statusText?.setText(status)) requestRender();
	};

	const refreshOnce = async (): Promise<void> => {
		if (!acceptingInput || !callbacks.isCurrentEpoch()) return;
		const generation = viewGeneration;
		try {
			const [, transcript] = await Promise.all([
				controller.refresh(),
				controller.formatSessionAsText({ compact: false }),
			]);
			if (!acceptingInput || generation !== viewGeneration || !callbacks.isCurrentEpoch()) return;
			transcriptText?.setText(transcript || "No messages yet.");
			updateStatus();
			requestRender();
		} catch (error) {
			if (!acceptingInput || generation !== viewGeneration || !callbacks.isCurrentEpoch()) return;
			setFeedback(`Transcript refresh failed: ${describeError(error)}`);
			updateStatus();
		}
	};

	const refreshView = async (): Promise<void> => {
		if (refreshTask) {
			refreshAgain = true;
			return refreshTask;
		}
		const task = (async () => {
			do {
				refreshAgain = false;
				await refreshOnce();
			} while (acceptingInput && refreshAgain);
		})();
		refreshTask = task;
		try {
			await task;
		} finally {
			if (refreshTask === task) refreshTask = undefined;
		}
	};

	const scheduleRefresh = (): void => {
		if (!acceptingInput || refreshTimer) return;
		refreshTimer = setTimeout(() => {
			refreshTimer = undefined;
			void refreshView();
		}, 32);
	};

	const requestHostReload = (): void => {
		if (reloadPending || !acceptingInput) return;
		reloadPending = true;
		setFeedback("Reloading disposable TUI…");
		queueMicrotask(() => {
			void hostCallbacks.requestReload().catch(error => {
				if (!acceptingInput || !callbacks.isCurrentEpoch()) return;
				reloadPending = false;
				setFeedback(`Reload failed: ${describeError(error)}`);
				updateStatus();
			});
		});
	};

	const requestHostStop = (): void => {
		if (stopPending || !acceptingInput) return;
		stopPending = true;
		setFeedback("Stopping disposable TUI…");
		queueMicrotask(() => {
			void hostCallbacks.requestStop().catch(error => {
				if (!acceptingInput || !callbacks.isCurrentEpoch()) return;
				stopPending = false;
				setFeedback(`Stop failed: ${describeError(error)}`);
			});
		});
	};

	const submit = async (text: string): Promise<void> => {
		if (!acceptingInput || !callbacks.isCurrentEpoch()) return;
		if (text === `/${RELOAD_TUI_COMMAND}`) {
			handleReloadTuiCommand({ requestHostReload }, setFeedback);
			return;
		}
		const first = text[0];
		if (first === "/" || first === "!" || first === "$") {
			setFeedback(`Unsupported in disposable TUI: ${text}`);
			return;
		}
		if (text.length === 0) return;
		editor?.addToHistory(text);
		setFeedback("");
		lastSubmitStatus = "submitting";
		updateStatus();
		try {
			const receipt = await controller.submit({ text, deliveryClass: "followUp" });
			if (!acceptingInput || !callbacks.isCurrentEpoch()) return;
			lastSubmitStatus = `submitted r${receipt.revision}${receipt.replayed ? " (replayed)" : ""}`;
			await refreshView();
		} catch (error) {
			if (!acceptingInput || !callbacks.isCurrentEpoch()) return;
			lastSubmitStatus = `submit failed: ${describeError(error)}`;
			setFeedback(lastSubmitStatus);
			updateStatus();
		}
	};

	const run = async (): Promise<void> => {
		if (phase === "running") return;
		if (phase !== "new") throw new Error("Disposable terminal view cannot be restarted after quiesce");
		callbacks.assertCurrentEpoch();
		phase = "running";
		acceptingInput = true;
		viewGeneration++;
		try {
			root = new Container();
			transcriptText = new Text("Loading session…", 1, 0);
			statusText = new Text("", 1, 0);
			feedbackText = new Text("", 1, 0);
			const helpText = new Text(
				`Disposable TUI · /${RELOAD_TUI_COMMAND} (${RELOAD_TUI_DESCRIPTION}) · Esc interrupt · Ctrl-D exit · Ctrl-L redraw\n` +
					"Pending input management unavailable in disposable TUI · Agent Hub unavailable in disposable TUI",
				1,
				0,
			);
			editor = new Editor(editorTheme);
			editor.setPromptGutter("> ");
			editor.setMaxHeight(8);
			editor.onSubmit = text => {
				void submit(text);
			};
			root.addChild(transcriptText);
			root.addChild(statusText);
			root.addChild(feedbackText);
			root.addChild(helpText);
			root.addChild(editor);

			terminal = new ProcessTerminal();
			tui = new TUI(terminal);
			tui.addChild(root);
			tui.setFocus(editor);
			unsubscribeInput = tui.addInputListener(data => {
				if (!acceptingInput) return { consume: true };
				if (matchesKey(data, Key.escape)) {
					void controller.interruptPrompt().then(
						() => {
							if (!acceptingInput || !callbacks.isCurrentEpoch()) return;
							setFeedback("Prompt interrupted");
							void refreshView();
						},
						error => {
							if (!acceptingInput || !callbacks.isCurrentEpoch()) return;
							setFeedback(`Interrupt failed: ${describeError(error)}`);
						},
					);
					return { consume: true };
				}
				if (matchesKey(data, Key.ctrl("l"))) {
					tui?.resetDisplay();
					return { consume: true };
				}
				if (matchesKey(data, Key.ctrl("d")) && editor?.getText().length === 0) {
					requestHostStop();
					return { consume: true };
				}
				if (matchesKey(data, Key.enter) && editor?.getText().trim().length === 0) {
					return { consume: true };
				}
				return undefined;
			});
			unsubscribeAgentEvents = controller.subscribeAgentEvents(scheduleRefresh);
			tui.start();
			await refreshView();
		} catch (error) {
			await quiesce();
			throw error;
		}
	};

	const quiesce = async (): Promise<void> => {
		if (phase === "quiesced" || phase === "disposed") return;
		phase = "quiesced";
		acceptingInput = false;
		viewGeneration++;
		if (editor) {
			editor.disableSubmit = true;
			editor.onSubmit = undefined;
		}
		unsubscribeAgentEvents?.();
		unsubscribeAgentEvents = undefined;
		unsubscribeInput?.();
		unsubscribeInput = undefined;
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = undefined;
		}
		tui?.setFocus(null);
		tui?.stop();
		if (!tui) terminal?.stop();
		if (refreshTask) await refreshTask;
	};

	const dispose = async (): Promise<void> => {
		if (phase === "disposed") return;
		await quiesce();
		phase = "disposed";
		root?.dispose();
		root?.clear();
		tui?.clear();
		terminal = undefined;
		tui = undefined;
		root = undefined;
		transcriptText = undefined;
		statusText = undefined;
		feedbackText = undefined;
		editor = undefined;
	};

	return { run, quiesce, dispose };
}
