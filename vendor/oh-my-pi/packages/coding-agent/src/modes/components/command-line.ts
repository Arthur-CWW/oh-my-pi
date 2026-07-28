import * as os from "node:os";
import { CompletionBehavior, Container, Input, matchesKey, type SelectItem, SelectList, Text } from "@oh-my-pi/pi-tui";
import { getProjectDir, logger, VERSION } from "@oh-my-pi/pi-utils";
import type { HistoryStorage } from "../../session/history-storage";
import { formatLoopStats } from "../../slash-commands/loopstats";
import { formatTabs } from "../../slash-commands/tabs";
import { buildVersionViewModel, formatVersion } from "../../slash-commands/version";
import { routeCommandOutput } from "../../task/route-inspector";
import { listTabs } from "../../tools/browser/tab-supervisor";
import { copyToClipboard } from "../../utils/clipboard";
import { canEnterCommandModeFromCurrentFocus } from "../command-mode-activation";
import {
	applyCommandModeCompletion,
	COMMAND_MODE_COMMANDS,
	type CommandModeCommand,
	type CommandModeCompletion,
	type CommandModeContext,
	commandModeCommandsForView,
	dispatchCommandLine,
	getCommandModeCompletions,
} from "../command-registry";
import type { SessionIdentity } from "../session-identity";
import { getSelectListTheme } from "../theme/theme";
import { toggleRichTranscript, toggleTranscriptWrap } from "../transcript-commands";
import type { InteractiveModeContext } from "../types";
import { matchesUiDismiss } from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";
import { IdentityPanelComponent, IdentityPanelState } from "./identity-panel";

const DEFAULT_MAX_VISIBLE = 12;
const MAX_COMMAND_OUTPUT_LINES = 12;

function feedbackError(error: Error | string): string {
	const message = typeof error === "string" ? error : error.message;
	return (
		message
			.replace(/[\r\n\t]+/g, " ")
			.replace(/\s+/g, " ")
			.trim() || "Command failed"
	);
}

class CommandLineInput extends Input {
	delegate?: (data: string) => void;

	override handleInput(data: string): void {
		if (this.delegate) {
			this.delegate(data);
			return;
		}
		super.handleInput(data);
	}

	handleEditingInput(data: string): void {
		super.handleInput(data);
	}
}

/** Single-line footer prompt with a completion popup above it for Vim-style colon commands. */
export class CommandLineComponent extends Container {
	readonly input: Input = new CommandLineInput();
	#completionList: SelectList;
	readonly #completion = new CompletionBehavior<CommandModeCompletion>();
	#closed = false;
	readonly #ctx: CommandModeContext;
	readonly #onDone: (reason: "submit" | "cancel") => void;
	readonly #commands: readonly CommandModeCommand[];
	readonly #maxVisible: number;
	readonly #historyStorage?: HistoryStorage;

	constructor(
		ctx: CommandModeContext,
		onDone: (reason: "submit" | "cancel") => void,
		options: {
			commands?: readonly CommandModeCommand[];
			maxVisible?: number;
			historyStorage?: HistoryStorage;
		} = {},
	) {
		super();
		this.#ctx = ctx;
		this.#onDone = onDone;
		this.#commands = options.commands ?? COMMAND_MODE_COMMANDS;
		this.#maxVisible = Math.max(1, options.maxVisible ?? DEFAULT_MAX_VISIBLE);
		this.#historyStorage = options.historyStorage;
		this.#completion.loadHistory(
			(options.historyStorage?.getRecent(100, "command") ?? []).map(entry => entry.prompt).reverse(),
		);
		this.#completion.setItems(getCommandModeCompletions("", this.#commands));
		this.#completionList = this.#createCompletionList();
		this.input.prompt = ":";
		(this.input as CommandLineInput).delegate = data => this.handleInput(data);
		this.#syncChildren();
	}

	handleInput(data: string): void {
		if (this.#closed) return;
		if (matchesUiDismiss(data)) {
			if (this.#completion.dismiss()) {
				this.#syncChildren();
			} else {
				this.#cancel();
			}
			return;
		}
		if (matchesKey(data, "ctrl+c")) {
			this.#cancel();
			return;
		}
		if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
			const selected = this.#completion.cycle(matchesKey(data, "shift+tab") ? -1 : 1);
			if (selected) this.#applyCompletion(selected);
			this.#syncSelectedIndex();
			return;
		}
		if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n") {
			const selected = this.#completion.accept();
			if (selected) this.#applyCompletion(selected);
			if (this.input.getValue().trim() === "") {
				this.#cancel();
				return;
			}
			this.#submit();
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "ctrl+p")) {
			this.#navigate(-1);
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "ctrl+n")) {
			this.#navigate(1);
			return;
		}
		if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
			this.#completion.page(matchesKey(data, "pageUp") ? -1 : 1, this.#maxVisible);
			this.#syncSelectedIndex();
			return;
		}
		if (matchesKey(data, "backspace") && this.input.getValue() === "") {
			this.#cancel();
			return;
		}
		(this.input as CommandLineInput).handleEditingInput(data);
		this.#completion.loadHistory(this.#completion.history);
		this.#refreshCompletions();
	}

	#createCompletionList(): SelectList {
		const items: readonly SelectItem[] = this.#completion.items.map(completion => ({
			value: completion.value,
			label: completion.label,
			description: completion.description,
			hint: completion.hint,
		}));
		const list = new SelectList(items, this.#maxVisible, getSelectListTheme());
		list.setSelectedIndex(this.#completion.selectedIndex);
		list.onCancel = () => {
			if (this.#completion.dismiss()) this.#syncChildren();
		};
		list.onSelectionChange = item => {
			const index = items.indexOf(item);
			if (index >= 0) this.#completion.select(index);
		};
		list.onSelect = item => {
			const index = items.indexOf(item);
			if (index >= 0) this.#completion.select(index);
			const selected = this.#completion.accept();
			if (selected) this.#applyCompletion(selected);
			this.#submit();
		};
		return list;
	}

	#refreshCompletions(): void {
		this.#completion.setItems(getCommandModeCompletions(this.input.getValue(), this.#commands));
		this.#completionList = this.#createCompletionList();
		this.#syncChildren();
	}

	#syncChildren(): void {
		this.clear();
		if (this.#completion.isOpen) this.addChild(this.#completionList);
		this.addChild(this.input);
		this.invalidate();
	}

	#syncSelectedIndex(): void {
		this.#completionList.setSelectedIndex(this.#completion.selectedIndex);
		this.invalidate();
	}

	#navigate(direction: -1 | 1): void {
		const result = this.#completion.navigate(direction, this.input.getValue());
		if (result.kind === "selection") {
			this.#completionList.setSelectedIndex(result.index);
		} else if (result.kind === "history") {
			this.input.setValue(result.value);
		}
		this.invalidate();
	}

	#applyCompletion(completion: CommandModeCompletion): void {
		this.input.setValue(applyCommandModeCompletion(this.input.getValue(), completion));
	}

	#cancel(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#onDone("cancel");
	}

	#submit(): void {
		if (this.#closed) return;
		const value = this.input.getValue();
		this.#closed = true;
		this.#onDone("submit");
		void dispatchCommandLine(value, this.#ctx, this.#commands)
			.then(handled => {
				if (!handled) return;
				const command = value.trim();
				this.#completion.recordHistory(command);
				void this.#historyStorage?.addToChannel("command", command).catch(error => {
					logger.warn("Command history persistence failed", { error: String(error) });
				});
			})
			.catch(error => {
				this.#ctx.showFeedback(`Command failed: ${feedbackError(error instanceof Error ? error : String(error))}`);
			});
	}
}

/** Bottom-anchored, bounded output surface for every colon command. */
export class CommandOutputOverlayComponent extends Container {
	constructor(
		private readonly message: string,
		private readonly dismiss: () => void,
	) {
		super();
	}

	handleInput(_data: string): void {
		this.dismiss();
	}

	override render(width: number): readonly string[] {
		const border = new DynamicBorder().render(width);
		const body = new Text(this.message, 1, 0).render(Math.max(10, width));
		const clipped = body.slice(0, MAX_COMMAND_OUTPUT_LINES);
		if (body.length > clipped.length)
			clipped[clipped.length - 1] = ` … ${body.length - clipped.length + 1} more lines`;
		return [...border, ...clipped, ...border];
	}
}

const installedContexts = new WeakSet<InteractiveModeContext>();

export function canEnterCommandMode(ctx: InteractiveModeContext): boolean {
	return canEnterCommandModeFromCurrentFocus(ctx);
}

export function commandModeContextForInteractive(
	ctx: InteractiveModeContext,
	commands: readonly CommandModeCommand[],
	showOutput: (message: string) => void = message => ctx.showStatus(message),
	showIdentityPanel: CommandModeContext["showIdentityPanel"] = async identity => {
		const state = new IdentityPanelState(identity);
		await state.activate(copyToClipboard);
		showOutput(state.content);
	},
): CommandModeContext {
	return {
		collabGuest: ctx.collabGuest,
		commands,
		toggleWrap: () => toggleTranscriptWrap(ctx),
		toggleRich: () => toggleRichTranscript(ctx),
		handleErrorsCommand: args => ctx.handleErrorsCommand(args, showOutput),
		handleRouteCommand: async args => {
			showOutput(
				await routeCommandOutput({
					mainSession: ctx.session,
					focusedSession: ctx.viewSession,
					focusedAgentId: ctx.focusedAgentId,
					args,
					binaryVersion: VERSION,
				}),
			);
		},
		showPrimitivesInspector: category => ctx.showPrimitivesInspector(category),
		showCopySelector: () => ctx.showCopySelector(),
		handleDumpCommand: isRaw => ctx.handleDumpCommand(isRaw),
		handleJobsCommand: () => ctx.handleJobsCommand(),
		handleChangelogCommand: showFull => ctx.handleChangelogCommand(showFull),
		handleHotkeysCommand: () => ctx.handleHotkeysCommand(),
		handleToolsCommand: showOutput => ctx.handleToolsCommand(showOutput),
		handleContextCommand: () => ctx.handleContextCommand(),
		showVersion: async () => {
			const viewModel = await buildVersionViewModel({
				sessionStartedAt: ctx.viewSession.sessionManager.getHeader()?.timestamp,
			});
			showOutput(formatVersion(viewModel));
		},
		showLoopStats: () => {
			showOutput(formatLoopStats(ctx.ui.loopWatchdogSnapshot));
		},
		showTabs: () => {
			showOutput(formatTabs(listTabs()));
		},
		getSessionIdentity: () => {
			const viewSession = ctx.viewSession;
			return {
				sessionId: ctx.sessionManager.getSessionId(),
				sessionName: ctx.sessionManager.getSessionName(),
				agentId: ctx.focusedAgentId ?? viewSession.getAgentId() ?? "Main",
				hostname: os.hostname(),
				projectDir: getProjectDir(),
				journalPath: viewSession.sessionManager.getSessionFile(),
				binaryVersion: VERSION,
			};
		},
		showIdentityPanel,
		bookmarkCurrent: args => ctx.bookmarkCurrent(args),
		showBookmarks: () => ctx.showBookmarks(),
		showFeedback: showOutput,
	};
}

/** Install the normal-context `:` route for the main or focused child view. */
export function installCommandLine(ctx: InteractiveModeContext): void {
	if (installedContexts.has(ctx)) return;
	installedContexts.add(ctx);
	const canEnter = (): boolean => canEnterCommandMode(ctx);
	let outputOverlay: ReturnType<InteractiveModeContext["ui"]["showOverlay"]> | undefined;
	const showOutput = (message: string): void => {
		outputOverlay?.hide();
		const dismiss = (): void => {
			outputOverlay?.hide();
			outputOverlay = undefined;
			ctx.ui.requestRender();
		};
		const component = new CommandOutputOverlayComponent(message, dismiss);
		outputOverlay = ctx.ui.showOverlay(component, {
			anchor: "bottom-center",
			width: "100%",
			maxHeight: MAX_COMMAND_OUTPUT_LINES + 2,
			margin: { bottom: 1 },
		});
		ctx.ui.setFocus(component);
		ctx.ui.requestRender();
	};
	let identityOverlay: ReturnType<InteractiveModeContext["ui"]["showOverlay"]> | undefined;
	const showIdentityPanel = async (identity: SessionIdentity): Promise<void> => {
		identityOverlay?.hide();
		const priorFocus = ctx.ui.getFocused();
		const state = new IdentityPanelState(identity);
		await state.activate(copyToClipboard);
		const dismiss = (): void => {
			identityOverlay?.hide();
			identityOverlay = undefined;
			ctx.ui.setFocus(priorFocus);
			ctx.ui.requestRender();
		};
		const component = new IdentityPanelComponent(state, dismiss);
		identityOverlay = ctx.ui.showOverlay(component, {
			anchor: "bottom-center",
			width: "100%",
			maxHeight: 14,
			margin: { bottom: 1 },
		});
		ctx.ui.setFocus(component);
		ctx.ui.requestRender();
	};
	const show = (): void => {
		if (!canEnter()) return;
		const commands = commandModeCommandsForView(Boolean(ctx.focusedAgentId));
		const priorFocus = ctx.ui.getFocused();
		const useEditorSlot = priorFocus === ctx.editor;
		const priorChildren = useEditorSlot ? [...ctx.editorContainer.children] : undefined;
		let overlay: ReturnType<InteractiveModeContext["ui"]["showOverlay"]> | undefined;
		let commandLine: CommandLineComponent;
		const restore = (): void => {
			if (overlay) {
				overlay.hide();
				overlay = undefined;
			} else if (priorChildren) {
				ctx.editorContainer.clear();
				for (const child of priorChildren) ctx.editorContainer.addChild(child);
			}
			commandLine.input.focused = false;
			ctx.ui.setFocus(priorFocus);
			ctx.ui.requestRender();
		};
		commandLine = new CommandLineComponent(
			commandModeContextForInteractive(ctx, commands, showOutput, showIdentityPanel),
			restore,
			{
				commands,
				historyStorage: ctx.historyStorage,
			},
		);
		if (useEditorSlot) {
			ctx.editorContainer.clear();
			ctx.editorContainer.addChild(commandLine);
			ctx.ui.setFocus(commandLine.input);
		} else {
			overlay = ctx.ui.showOverlay(commandLine, {
				anchor: "bottom-center",
				width: "100%",
				maxHeight: "50%",
				margin: 0,
			});
			commandLine.input.focused = true;
			ctx.ui.setFocus(commandLine);
		}
		ctx.ui.requestRender();
	};
	ctx.ui.addInputListener(data => {
		if (data !== ":" || !canEnter()) return undefined;
		show();
		return { consume: true };
	});
}
