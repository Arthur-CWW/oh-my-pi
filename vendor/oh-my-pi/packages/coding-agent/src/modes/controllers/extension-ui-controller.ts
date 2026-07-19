import type { Component, OverlayHandle, TUI } from "@oh-my-pi/pi-tui";
import { Container, Spacer, Text } from "@oh-my-pi/pi-tui";
import { KeybindingsManager } from "../../config/keybindings";
import type {
	CompactOptions,
	ExtensionActions,
	ExtensionCommandContextActions,
	ExtensionContextActions,
	ExtensionError,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionUISelectItem,
	ExtensionUiComponent,
	ExtensionWidgetContent,
	ExtensionWidgetOptions,
	SendUserMessageHandler,
	TerminalInputHandler,
} from "../../extensibility/extensions";
import { NEVER_ABORT_SIGNAL } from "../../extensibility/extensions";
import { getSessionSlashCommands } from "../../extensibility/extensions/get-commands-handler";
import { createExtensionModelQuery } from "../../extensibility/extensions/model-api";
import type { HookSelectorSlider } from "../../modes/components/hook-selector";
import { getAvailableThemesWithPaths, getThemeByName, setTheme, type Theme, theme } from "../../modes/theme/theme";
import type { InteractiveModeContext, InteractiveSelectorDialogOptions } from "../../modes/types";
import { USER_INTERRUPT_LABEL } from "../../session/messages";
import { setSessionTerminalTitle, setTerminalTitle } from "../../utils/title-generator";

const MAX_WIDGET_LINES = 10;
interface DialogFifoRequest<Result> {
	start(): void;
	readonly isSettled: () => boolean;
}

/** FIFO settlement boundary shared by hook dialogs; each request settles at most once. */
export class DialogFifo<Result> {
	#active = false;
	#queue: DialogFifoRequest<Result>[] = [];

	present(
		signal: AbortSignal | undefined,
		mount: (settle: (value: Result | undefined) => void) => () => void,
	): Promise<Result | undefined> {
		const { promise, resolve, reject } = Promise.withResolvers<Result | undefined>();
		let settled = false;
		let started = false;
		let hide: (() => void) | undefined;
		let request: DialogFifoRequest<Result>;

		const onAbort = (): void => settle(undefined);
		const settle = (value: Result | undefined): void => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			if (started) {
				hide?.();
				this.#active = false;
				this.#advance();
			} else {
				const index = this.#queue.indexOf(request);
				if (index >= 0) this.#queue.splice(index, 1);
			}
			resolve(value);
		};

		request = {
			isSettled: () => settled,
			start: () => {
				if (settled) {
					this.#advance();
					return;
				}
				started = true;
				this.#active = true;
				try {
					hide = mount(settle);
				} catch (error) {
					settled = true;
					signal?.removeEventListener("abort", onAbort);
					this.#active = false;
					reject(error);
					this.#advance();
				}
			},
		};

		if (signal?.aborted) {
			settled = true;
			resolve(undefined);
			return promise;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		this.#queue.push(request);
		this.#advance();
		return promise;
	}

	#advance(): void {
		if (this.#active) return;
		while (this.#queue.length > 0) {
			const request = this.#queue.shift()!;
			if (request.isSettled()) continue;
			request.start();
			return;
		}
	}
}


export class ExtensionUiController {
	#extensionTerminalInputUnsubscribers = new Set<() => void>();
	#hookWidgetsAbove = new Map<string, ExtensionUiComponent>();
	#hookWidgetsBelow = new Map<string, ExtensionUiComponent>();
	// The editor replacement surface is exclusive; hook dialogs settle through
	// one FIFO so aborts cannot orphan a previous Promise or steal its focus.
	#dialogFifo = new DialogFifo<string>();
	constructor(private ctx: InteractiveModeContext) {}

	/**
	 * Initialize the hook system with TUI-based UI context.
	 */
	async initHooksAndCustomTools(): Promise<void> {
		// Create and set hook & tool UI context
		const uiContext: ExtensionUIContext = {
			select: (title, options, dialogOptions) => this.showHookSelector(title, options, dialogOptions),
			confirm: (title, message, _dialogOptions) => this.showHookConfirm(title, message),
			input: (title, placeholder, dialogOptions) => this.showHookInput(title, placeholder, dialogOptions),
			notify: (message, type) => this.showHookNotify(message, type),
			onTerminalInput: handler => this.addExtensionTerminalInputListener(handler),
			setStatus: (key, text) => this.setHookStatus(key, text),
			setWorkingMessage: message => this.ctx.setWorkingMessage(message),
			setWidget: (key, content, options) => this.setHookWidget(key, content, options),
			setTitle: title => setTerminalTitle(title),
			custom: (factory, options) => this.showHookCustom(factory, options),
			setEditorText: text => this.ctx.editor.setText(text),
			pasteToEditor: text => {
				this.ctx.editor.applyPaste(text);
			},
			getEditorText: () => this.ctx.editor.getText(),
			editor: (title, prefill, dialogOptions, editorOptions) =>
				this.showHookEditor(title, prefill, dialogOptions, editorOptions),
			get theme() {
				return theme;
			},
			getAllThemes: async () => (await getAvailableThemesWithPaths()).map(t => ({ name: t.name, path: t.path })),
			getTheme: name => getThemeByName(name),
			setTheme: async themeArg => {
				if (typeof themeArg === "string") {
					return await setTheme(themeArg, true);
				}
				// Theme object passed directly - not supported in current implementation
				return Promise.resolve({ success: false, error: "Direct theme object not supported" });
			},
			setFooter: () => {},
			setHeader: () => {},
			setEditorComponent: factory => this.ctx.setEditorComponent(factory),
			getToolsExpanded: () => this.ctx.toolOutputExpanded,
			setToolsExpanded: expanded => this.ctx.setToolsExpanded(expanded),
		};
		this.ctx.setToolUIContext(uiContext, true);

		const extensionRunner = this.ctx.session.extensionRunner;
		if (!extensionRunner) {
			return; // No hooks loaded
		}

		const actions: ExtensionActions = {
			sendMessage: (message, options) => {
				const wasStreaming = this.ctx.session.isStreaming;
				this.ctx.session
					.sendCustomMessage(message, options)
					.then(() => this.#applyCustomMessageDisplay(wasStreaming, message.display))
					.catch((err: unknown) => {
						this.ctx.showError(
							`Extension sendMessage failed: ${err instanceof Error ? err.message : String(err)}`,
						);
					});
			},
			sendUserMessage: this.#sendExtensionUserMessage,
			appendEntry: (customType, data) => {
				this.ctx.sessionManager.appendCustomEntry(customType, data);
			},
			setLabel: (targetId, label) => {
				this.ctx.sessionManager.appendLabelChange(targetId, label);
			},
			getActiveTools: () => this.ctx.session.getActiveToolNames(),
			getAllTools: () => this.ctx.session.getAllToolNames(),
			setActiveTools: toolNames => this.ctx.session.setActiveToolsByName(toolNames),
			refreshTools: tools => this.ctx.session.refreshDynamicTools(tools, extensionRunner),
			setModel: async model => {
				const key = await this.ctx.session.modelRegistry.getApiKey(model);
				if (!key) return false;
				await this.ctx.session.setModel(model);
				return true;
			},
			getThinkingLevel: () => this.ctx.session.thinkingLevel,
			setThinkingLevel: level => this.ctx.session.setThinkingLevel(level),
			getCommands: () => getSessionSlashCommands(this.ctx.session),
			getSessionName: () => this.ctx.sessionManager.getSessionName(),
			setSessionName: name => this.#updateSessionName(name),
		};
		const contextActions: ExtensionContextActions = {
			getModel: () => this.ctx.session.model,
			isIdle: () => !this.ctx.session.isStreaming,
			abort: () => this.ctx.session.abort({ reason: USER_INTERRUPT_LABEL }),
			hasPendingMessages: () => this.ctx.session.queuedMessageCount > 0,
			shutdown: () => {
				// Defer the actual teardown to the main loop, which calls
				// `checkShutdownRequested()` at idle boundaries so any queued
				// steering / follow-up messages drain first (see issue #1020).
				this.ctx.shutdownRequested = true;
			},
			getContextUsage: () => this.ctx.session.getContextUsage(),
			compact: instructionsOrOptions => this.#compactSession(instructionsOrOptions),
			getSystemPrompt: () => this.ctx.session.systemPrompt,
		};
		const commandActions: ExtensionCommandContextActions = {
			getContextUsage: () => this.ctx.session.getContextUsage(),
			waitForIdle: () => this.ctx.session.agent.waitForIdle(),
			reload: async () => {
				await this.ctx.session.reload();
				this.ctx.chatContainer.clear();
				this.ctx.renderInitialMessages({ clearTerminalHistory: true });
				await this.ctx.reloadTodos();
				this.ctx.showStatus("Reloaded session");
			},
			newSession: async options => {
				// Stop any loading animation
				if (this.ctx.loadingAnimation) {
					this.ctx.loadingAnimation.stop();
					this.ctx.loadingAnimation = undefined;
				}
				this.ctx.statusContainer.clear();

				// Create new session
				this.clearExtensionTerminalInputListeners();
				this.clearHookWidgets();
				const success = await this.ctx.session.newSession({ parentSession: options?.parentSession });
				if (!success) {
					return { cancelled: true };
				}
				setSessionTerminalTitle(this.ctx.sessionManager.getSessionName(), this.ctx.sessionManager.getCwd());

				// Call setup callback if provided
				if (options?.setup) {
					await options.setup(this.ctx.sessionManager);
				}

				// Reset and update status line
				this.ctx.statusLine.invalidate();
				this.ctx.statusLine.setSessionStartTime(Date.now());
				this.ctx.updateEditorTopBorder();
				this.ctx.ui.requestRender();

				// Clear UI state
				this.ctx.chatContainer.clear();
				this.ctx.pendingMessagesContainer.clear();
				this.ctx.streamingComponent = undefined;
				this.ctx.streamingMessage = undefined;
				this.ctx.pendingTools.clear();

				this.ctx.present([
					new Spacer(1),
					new Text(`${theme.fg("accent", `${theme.status.success} New session started`)}`, 1, 1),
				]);
				await this.ctx.reloadTodos();
				this.ctx.ui.requestRender(true, { clearScrollback: true });

				return { cancelled: false };
			},
			branch: async entryId => {
				const result = await this.ctx.session.branch(entryId);
				if (result.cancelled) {
					return { cancelled: true };
				}

				// Update UI
				this.ctx.chatContainer.clear();
				this.ctx.renderInitialMessages({ clearTerminalHistory: true });
				await this.ctx.reloadTodos();
				this.ctx.editor.setText(result.selectedText);
				this.ctx.showStatus("Branched to new session");

				return { cancelled: false };
			},
			navigateTree: async (targetId, options) => {
				const result = await this.ctx.session.navigateTree(targetId, { summarize: options?.summarize });
				if (result.cancelled) {
					return { cancelled: true };
				}

				// Update UI
				this.ctx.chatContainer.clear();
				this.ctx.renderInitialMessages({ clearTerminalHistory: true });
				await this.ctx.reloadTodos();
				if (result.editorText && !this.ctx.editor.getText().trim()) {
					this.ctx.editor.setText(result.editorText);
				}
				this.ctx.showStatus("Navigated to selected point");

				return { cancelled: false };
			},
			compact: async instructionsOrOptions => this.#handleInteractiveCompact(instructionsOrOptions),
			switchSession: async sessionPath => {
				this.clearHookWidgets();
				const result = await this.ctx.session.switchSession(sessionPath);
				if (!result) {
					return { cancelled: true };
				}
				setSessionTerminalTitle(this.ctx.sessionManager.getSessionName(), this.ctx.sessionManager.getCwd());
				this.ctx.chatContainer.clear();
				this.ctx.renderInitialMessages({ clearTerminalHistory: true });
				await this.ctx.reloadTodos();
				return { cancelled: false };
			},
		};

		extensionRunner.initialize(actions, contextActions, commandActions, uiContext);

		// Subscribe to extension errors
		extensionRunner.onError((error: ExtensionError) => {
			this.showExtensionError(error.extensionPath, error.error);
		});

		// Emit session_start event
		await extensionRunner.emit({
			type: "session_start",
		});
	}

	setHookWidget(key: string, content: ExtensionWidgetContent, options?: ExtensionWidgetOptions): void {
		const placement = options?.placement ?? "aboveEditor";
		this.#removeHookWidget(this.#hookWidgetsAbove, key);
		this.#removeHookWidget(this.#hookWidgetsBelow, key);

		if (content === undefined) {
			this.#rebuildHookWidgets();
			return;
		}

		const target = placement === "belowEditor" ? this.#hookWidgetsBelow : this.#hookWidgetsAbove;
		target.set(key, this.#createHookWidget(content));
		this.#rebuildHookWidgets();
	}

	#removeHookWidget(widgets: Map<string, ExtensionUiComponent>, key: string): void {
		const existing = widgets.get(key);
		existing?.dispose?.();
		widgets.delete(key);
	}

	#createHookWidget(content: ExtensionWidgetContent): ExtensionUiComponent {
		if (Array.isArray(content)) {
			const container = new Container();
			for (const line of content.slice(0, MAX_WIDGET_LINES)) {
				container.addChild(new Text(line, 1, 0));
			}
			if (content.length > MAX_WIDGET_LINES) {
				container.addChild(new Text(theme.fg("muted", "... (widget truncated)"), 1, 0));
			}
			return container;
		}
		if (content === undefined) {
			throw new Error("Widget content missing");
		}
		return content(this.ctx.ui, theme);
	}

	#rebuildHookWidgets(): void {
		this.#renderHookWidgetContainer(this.ctx.hookWidgetContainerAbove, this.#hookWidgetsAbove, true, true);
		this.#renderHookWidgetContainer(this.ctx.hookWidgetContainerBelow, this.#hookWidgetsBelow, false, false);
		this.ctx.ui.requestRender();
	}

	#renderHookWidgetContainer(
		container: Container,
		widgets: Map<string, ExtensionUiComponent>,
		spacerWhenEmpty: boolean,
		leadingSpacer: boolean,
	): void {
		container.clear();
		if (widgets.size === 0) {
			// Compact status lines already occupy their own row directly above the
			// editor. Do not retain an empty spacer row when an above-editor widget
			// is removed; the leading spacer for a real widget remains intentional.
			const omitEmptyAboveSpacer =
				container === this.ctx.hookWidgetContainerAbove && this.ctx.statusLine.isBorderless();
			if (spacerWhenEmpty && !omitEmptyAboveSpacer) {
				container.addChild(new Spacer(1));
			}
			return;
		}

		if (leadingSpacer) {
			container.addChild(new Spacer(1));
		}
		for (const widget of widgets.values()) {
			container.addChild(widget);
		}
	}

	initializeHookRunner(uiContext: ExtensionUIContext, _hasUI: boolean): void {
		const extensionRunner = this.ctx.session.extensionRunner;
		if (!extensionRunner) {
			return;
		}

		const actions: ExtensionActions = {
			sendMessage: (message, options) => {
				const wasStreaming = this.ctx.session.isStreaming;
				this.ctx.session
					.sendCustomMessage(message, options)
					.then(() => this.#applyCustomMessageDisplay(wasStreaming, message.display))
					.catch((err: unknown) => {
						const errorText = `Extension sendMessage failed: ${err instanceof Error ? err.message : String(err)}`;
						this.ctx.showError(errorText);
					});
			},
			sendUserMessage: this.#sendExtensionUserMessage,
			appendEntry: (customType, data) => {
				this.ctx.sessionManager.appendCustomEntry(customType, data);
			},
			setLabel: (targetId, label) => {
				this.ctx.sessionManager.appendLabelChange(targetId, label);
			},
			getActiveTools: () => this.ctx.session.getActiveToolNames(),
			getAllTools: () => this.ctx.session.getAllToolNames(),
			setActiveTools: toolNames => this.ctx.session.setActiveToolsByName(toolNames),
			refreshTools: tools => this.ctx.session.refreshDynamicTools(tools, extensionRunner),
			setModel: async model => {
				const key = await this.ctx.session.modelRegistry.getApiKey(model);
				if (!key) return false;
				await this.ctx.session.setModel(model);
				return true;
			},
			getThinkingLevel: () => this.ctx.session.thinkingLevel,
			setThinkingLevel: (level, persist) => this.ctx.session.setThinkingLevel(level, persist),
			getCommands: () => getSessionSlashCommands(this.ctx.session),
			getSessionName: () => this.ctx.sessionManager.getSessionName(),
			setSessionName: name => this.#updateSessionName(name),
		};
		const contextActions: ExtensionContextActions = {
			getModel: () => this.ctx.session.model,
			isIdle: () => !this.ctx.session.isStreaming,
			abort: () => this.ctx.session.abort({ reason: USER_INTERRUPT_LABEL }),
			hasPendingMessages: () => this.ctx.session.queuedMessageCount > 0,
			shutdown: () => {
				// Defer the actual teardown to the main loop, which calls
				// `checkShutdownRequested()` at idle boundaries so any queued
				// steering / follow-up messages drain first (see issue #1020).
				this.ctx.shutdownRequested = true;
			},
			getContextUsage: () => this.ctx.session.getContextUsage(),
			compact: instructionsOrOptions => this.#compactSession(instructionsOrOptions),
			getSystemPrompt: () => this.ctx.session.systemPrompt,
		};
		const commandActions: ExtensionCommandContextActions = {
			getContextUsage: () => this.ctx.session.getContextUsage(),
			waitForIdle: () => this.ctx.session.agent.waitForIdle(),
			reload: async () => {
				await this.ctx.session.reload();
				this.ctx.chatContainer.clear();
				this.ctx.renderInitialMessages({ clearTerminalHistory: true });
				await this.ctx.reloadTodos();
				this.ctx.showStatus("Reloaded session");
			},
			newSession: async options => {
				// Stop any loading animation
				if (this.ctx.loadingAnimation) {
					this.ctx.loadingAnimation.stop();
					this.ctx.loadingAnimation = undefined;
				}
				this.ctx.statusContainer.clear();

				// Create new session
				this.clearExtensionTerminalInputListeners();
				this.clearHookWidgets();
				const success = await this.ctx.session.newSession({ parentSession: options?.parentSession });
				if (!success) {
					return { cancelled: true };
				}

				// Call setup callback if provided
				if (options?.setup) {
					await options.setup(this.ctx.sessionManager);
				}

				// Clear UI state
				this.ctx.chatContainer.clear();
				this.ctx.pendingMessagesContainer.clear();
				this.ctx.streamingComponent = undefined;
				this.ctx.streamingMessage = undefined;
				this.ctx.pendingTools.clear();

				this.ctx.present([
					new Spacer(1),
					new Text(`${theme.fg("accent", `${theme.status.success} New session started`)}`, 1, 1),
				]);
				await this.ctx.reloadTodos();
				this.ctx.ui.requestRender(true, { clearScrollback: true });

				return { cancelled: false };
			},
			branch: async entryId => {
				const result = await this.ctx.session.branch(entryId);
				if (result.cancelled) {
					return { cancelled: true };
				}

				// Update UI
				this.ctx.chatContainer.clear();
				this.ctx.renderInitialMessages({ clearTerminalHistory: true });
				await this.ctx.reloadTodos();
				this.ctx.editor.setText(result.selectedText);
				this.ctx.showStatus("Branched to new session");

				return { cancelled: false };
			},
			navigateTree: async (targetId, options) => {
				const result = await this.ctx.session.navigateTree(targetId, { summarize: options?.summarize });
				if (result.cancelled) {
					return { cancelled: true };
				}

				// Update UI
				this.ctx.chatContainer.clear();
				this.ctx.renderInitialMessages({ clearTerminalHistory: true });
				await this.ctx.reloadTodos();
				if (result.editorText && !this.ctx.editor.getText().trim()) {
					this.ctx.editor.setText(result.editorText);
				}
				this.ctx.showStatus("Navigated to selected point");

				return { cancelled: false };
			},
			compact: async instructionsOrOptions => this.#handleInteractiveCompact(instructionsOrOptions),
			switchSession: async sessionPath => {
				this.clearHookWidgets();
				const result = await this.ctx.session.switchSession(sessionPath);
				if (!result) {
					return { cancelled: true };
				}
				this.ctx.chatContainer.clear();
				this.ctx.renderInitialMessages({ clearTerminalHistory: true });
				await this.ctx.reloadTodos();
				return { cancelled: false };
			},
		};

		extensionRunner.initialize(actions, contextActions, commandActions, uiContext);
	}

	/**
	 * Emit session event to all extension tools.
	 */
	async emitCustomToolSessionEvent(
		reason: "start" | "switch" | "branch" | "tree" | "shutdown",
		previousSessionFile?: string,
	): Promise<void> {
		const event = { reason, previousSessionFile };
		const uiContext = this.ctx.session.extensionRunner?.getUIContext();
		if (!uiContext) {
			return;
		}
		for (const registeredTool of this.ctx.session.extensionRunner?.getAllRegisteredTools() ?? []) {
			if (reason === "shutdown" && registeredTool.definition.origin?.kind === "dynamic") continue;
			if (registeredTool.definition.onSession) {
				try {
					await registeredTool.definition.onSession(event, {
						ui: uiContext,
						signal: NEVER_ABORT_SIGNAL,
						getContextUsage: () => this.ctx.session.getContextUsage(),
						compact: instructionsOrOptions => this.#compactSession(instructionsOrOptions),
						hasUI: true,
						cwd: this.ctx.sessionManager.getCwd(),
						sessionManager: this.ctx.session.sessionManager,
						modelRegistry: this.ctx.session.modelRegistry,
						model: this.ctx.session.model,
						models: createExtensionModelQuery(
							this.ctx.session.modelRegistry,
							this.ctx.session.settings,
							() => this.ctx.session.model,
						),
						isIdle: () => !this.ctx.session.isStreaming,
						hasPendingMessages: () => this.ctx.session.queuedMessageCount > 0,
						abort: () => {
							this.ctx.session.abort({ reason: USER_INTERRUPT_LABEL });
						},
						shutdown: () => {
							// Signal shutdown request
						},
						getSystemPrompt: () => this.ctx.session.systemPrompt,
					});
				} catch (err) {
					this.showToolError(registeredTool.definition.name, err instanceof Error ? err.message : String(err));
				}
			}
		}
	}

	/**
	 * Show a tool error in the chat.
	 */
	showToolError(toolName: string, error: string): void {
		const errorText = new Text(theme.fg("error", `Tool "${toolName}" error: ${error}`), 1, 0);
		this.ctx.present(errorText);
	}

	/**
	 * Set hook status text in the footer.
	 */
	setHookStatus(key: string, text: string | undefined): void {
		this.ctx.statusLine.setHookStatus(key, text);
		this.ctx.ui.requestRender();
	}

	/**
	 * Show a selector for hooks.
	 */
	showHookSelector(
		title: string,
		options: ExtensionUISelectItem[],
		dialogOptions?: InteractiveSelectorDialogOptions,
		extra?: { slider?: HookSelectorSlider },
	): Promise<string | undefined> {
		return this.ctx.showHookSelector(title, options, dialogOptions);
	}

	hideHookSelector(): void {
		this.ctx.hideHookSelector();
	}

	async showHookConfirm(title: string, message: string): Promise<boolean> {
		return (await this.ctx.showHookSelector(`${title}\n${message}`, ["Yes", "No"])) === "Yes";
	}

	showHookInput(title: string, placeholder?: string, dialogOptions?: ExtensionUIDialogOptions): Promise<string | undefined> {
		return this.ctx.showHookInput(title, placeholder, dialogOptions);
	}

	hideHookInput(): void {
		this.ctx.hideHookInput();
	}

	showHookEditor(
		title: string,
		prefill?: string,
		dialogOptions?: ExtensionUIDialogOptions,
		editorOptions?: { promptStyle?: boolean },
	): Promise<string | undefined> {
		return this.ctx.showHookEditor(title, prefill, dialogOptions, editorOptions);
	}

	hideHookEditor(): void {
		this.ctx.hideHookEditor();
	}

	/**
	 * Show a notification for hooks.
	 */
	showHookNotify(message: string, type?: "info" | "warning" | "error"): void {
		if (type === "error") {
			this.ctx.showError(message);
		} else if (type === "warning") {
			this.ctx.showWarning(message);
		} else {
			this.ctx.showStatus(message);
		}
	}

	/**
	 * Show a custom component with keyboard focus.
	 */
	async showHookCustom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
		options?: { overlay?: boolean },
	): Promise<T> {
		const savedText = this.ctx.editor.getText();
		const keybindings = KeybindingsManager.inMemory();

		const { promise, resolve } = Promise.withResolvers<T>();
		let component: (Component & { dispose?(): void }) | undefined;
		let overlayHandle: OverlayHandle | undefined;
		let closed = false;

		const close = (result: T) => {
			if (closed) return;
			closed = true;
			component?.dispose?.();
			overlayHandle?.hide();
			overlayHandle = undefined;
			if (!options?.overlay) {
				this.ctx.editorContainer.clear();
				this.ctx.editorContainer.addChild(this.ctx.editor);
				this.ctx.editor.setText(savedText);
			}
			this.ctx.ui.setFocus(this.ctx.editor);
			this.ctx.ui.requestRender();
			resolve(result);
		};

		Promise.try(() => factory(this.ctx.ui, theme, keybindings, close)).then(c => {
			if (closed) {
				c.dispose?.();
				return;
			}
			component = c;
			if (options?.overlay) {
				overlayHandle = this.ctx.ui.showOverlay(component, {
					anchor: "bottom-center",
					width: "100%",
					maxHeight: "100%",
					margin: 0,
				});
				return;
			}
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(component);
			this.ctx.ui.setFocus(component);
			this.ctx.ui.requestRender();
		});
		return promise;
	}

	/**
	 * Show an extension error in the UI.
	 */
	addExtensionTerminalInputListener(handler: TerminalInputHandler): () => void {
		const unsubscribe = this.ctx.ui.addInputListener(handler);
		this.#extensionTerminalInputUnsubscribers.add(unsubscribe);
		return () => {
			unsubscribe();
			this.#extensionTerminalInputUnsubscribers.delete(unsubscribe);
		};
	}

	clearHookWidgets(): void {
		for (const widget of this.#hookWidgetsAbove.values()) {
			widget.dispose?.();
		}
		for (const widget of this.#hookWidgetsBelow.values()) {
			widget.dispose?.();
		}
		this.#hookWidgetsAbove.clear();
		this.#hookWidgetsBelow.clear();
		this.#rebuildHookWidgets();
	}

	clearExtensionTerminalInputListeners(): void {
		for (const unsubscribe of this.#extensionTerminalInputUnsubscribers) {
			unsubscribe();
		}
		this.#extensionTerminalInputUnsubscribers.clear();
	}

	showExtensionError(extensionPath: string, error: string): void {
		const errorText = new Text(theme.fg("error", `Extension "${extensionPath}" error: ${error}`), 1, 0);
		this.ctx.present(errorText);
	}
	async #handleInteractiveCompact(instructionsOrOptions: string | CompactOptions | undefined): Promise<void> {
		await this.ctx.executeCompaction(instructionsOrOptions, false);
	}

	async #compactSession(instructionsOrOptions: string | CompactOptions | undefined): Promise<void> {
		const instructions = typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
		const options =
			instructionsOrOptions && typeof instructionsOrOptions === "object" ? instructionsOrOptions : undefined;
		await this.ctx.session.compact(instructions, options);
	}

	async #updateSessionName(name: string): Promise<void> {
		await this.ctx.sessionManager.setSessionName(name, "user");
		setSessionTerminalTitle(this.ctx.sessionManager.getSessionName(), this.ctx.sessionManager.getCwd());
	}

	#sendExtensionUserMessage: SendUserMessageHandler = (content, options) => {
		this.ctx.session.sendUserMessage(content, options).catch((err: unknown) => {
			this.ctx.showError(`Extension sendUserMessage failed: ${err instanceof Error ? err.message : String(err)}`);
		});
	};

	#applyCustomMessageDisplay(wasStreaming: boolean, shouldDisplay: boolean | undefined): void {
		// For non-streaming cases with display=true, update UI
		// (streaming cases update via message_end event)
		if (!wasStreaming && shouldDisplay) {
			this.ctx.rebuildChatFromMessages();
		}
	}

	/**
	 * Present a modal dialog on the shared editor surface, serializing against any
	 * dialog already open. `present` builds the component, swaps it into
	 * `editorContainer`, steals focus, and returns a `hide` closure; it is invoked
	 * with a single `settle` callback that the component fires on submit/cancel.
	 *
	 * Because selector / input / editor all clear `editorContainer` and re-focus,
	 * showing a second one while the first is open would orphan the first — its
	 * promise would hang until the caller's signal aborts. So at most one dialog is
	 * presented at a time and the rest queue (FIFO). `settle` (or an abort) hides
	 * the current dialog and hands the surface to the next queued request. A request
	 * whose signal aborts before its turn resolves `undefined` and is never shown.
	 */
	#presentDialog(
		signal: AbortSignal | undefined,
		present: (settle: (value: string | undefined) => void) => () => void,
	): Promise<string | undefined> {
		return this.#dialogFifo.present(signal, present);
	}

}
