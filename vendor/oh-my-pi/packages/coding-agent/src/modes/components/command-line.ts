import { Container, Input, matchesKey, SelectList, type SelectItem } from "@oh-my-pi/pi-tui";
import { buildVersionViewModel, formatVersion } from "../../slash-commands/version";
import {
	COMMAND_MODE_COMMANDS,
	applyCommandModeCompletion,
	type CommandModeCommand,
	type CommandModeCompletion,
	type CommandModeContext,
	dispatchCommandLine,
	getCommandModeCompletions,
} from "../command-registry";
import { getSelectListTheme } from "../theme/theme";
import { toggleRichTranscript, toggleTranscriptWrap } from "../transcript-commands";
import type { InteractiveModeContext } from "../types";
import { matchesSelectCancel } from "../utils/keybinding-matchers";

const DEFAULT_MAX_VISIBLE = 12;

function feedbackError(error: Error | string): string {
	const message = typeof error === "string" ? error : error.message;
	return message.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() || "Command failed";
}

/** Single-line footer prompt with a completion popup above it for Vim-style colon commands. */
export class CommandLineComponent extends Container {
	readonly input = new Input();
	#completionList: SelectList;
	#closed = false;
	readonly #ctx: CommandModeContext;
	readonly #onDone: (reason: "submit" | "cancel") => void;
	readonly #commands: readonly CommandModeCommand[];
	readonly #maxVisible: number;

	constructor(
		ctx: CommandModeContext,
		onDone: (reason: "submit" | "cancel") => void,
		options: { commands?: readonly CommandModeCommand[]; maxVisible?: number } = {},
	) {
		super();
		this.#ctx = ctx;
		this.#onDone = onDone;
		this.#commands = options.commands ?? COMMAND_MODE_COMMANDS;
		this.#maxVisible = Math.max(1, options.maxVisible ?? DEFAULT_MAX_VISIBLE);
		this.#completionList = this.#createCompletionList(getCommandModeCompletions("", this.#commands));
		this.input.prompt = ":";
		this.input.onEscape = () => this.#cancel();
		this.input.onSubmit = () => this.#submit();
		this.addChild(this.#completionList);
		this.addChild(this.input);
	}

	handleInput(data: string): void {
		if (this.#closed) return;
		if (
			matchesSelectCancel(data) ||
			matchesKey(data, "escape") ||
			matchesKey(data, "esc") ||
			matchesKey(data, "ctrl+c")
		) {
			this.#cancel();
			return;
		}
		if (matchesKey(data, "tab")) {
			this.#applySelectedCompletion();
			return;
		}
		if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n") {
			if (this.input.getValue().trim() === "") {
				this.#cancel();
				return;
			}
			this.#applySelectedCompletion();
			this.#submit();
			return;
		}
		if (
			matchesKey(data, "up") ||
			matchesKey(data, "down") ||
			matchesKey(data, "pageUp") ||
			matchesKey(data, "pageDown")
		) {
			this.#completionList.handleInput(data);
			return;
		}
		if (matchesKey(data, "backspace") && this.input.getValue() === "") {
			this.#cancel();
			return;
		}
		this.input.handleInput(data);
		this.#refreshCompletions();
	}

	#createCompletionList(completions: readonly CommandModeCompletion[]): SelectList {
		const items: readonly SelectItem[] = completions.map(completion => ({
			value: completion.value,
			label: completion.label,
			description: completion.description,
			hint: completion.hint,
		}));
		const list = new SelectList(items, this.#maxVisible, getSelectListTheme());
		list.onCancel = () => this.#cancel();
		list.onSelect = item => {
			this.#applyCompletion(item);
			this.#submit();
		};
		return list;
	}

	#refreshCompletions(): void {
		const completions = getCommandModeCompletions(this.input.getValue(), this.#commands);
		this.#completionList = this.#createCompletionList(completions);
		this.children[0] = this.#completionList;
		this.invalidate();
	}

	#applyCompletion(item: SelectItem): void {
		const completion: CommandModeCompletion = {
			value: item.value,
			label: item.label,
			description: item.description,
			hint: item.hint,
		};
		this.input.setValue(applyCommandModeCompletion(this.input.getValue(), completion));
		this.#refreshCompletions();
	}

	#applySelectedCompletion(): void {
		const item = this.#completionList.getSelectedItem();
		if (item) this.#applyCompletion(item);
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
		void dispatchCommandLine(value, this.#ctx, this.#commands).catch(error => {
			this.#ctx.showFeedback(`Command failed: ${feedbackError(error instanceof Error ? error : String(error))}`);
		});
	}
}

const installedContexts = new WeakSet<InteractiveModeContext>();

/** Install the normal-context `:` route once for a main-view input controller. */
export function installCommandLine(ctx: InteractiveModeContext): void {
	if (installedContexts.has(ctx)) return;
	installedContexts.add(ctx);
	const canEnterCommandMode = (): boolean =>
		ctx.ui.getFocused() === ctx.editor &&
		ctx.editor.getText().length === 0 &&
		!ctx.editor.isShowingAutocomplete() &&
		!ctx.focusedAgentId;
	const show = (): void => {
		if (!canEnterCommandMode()) return;
		const restore = (): void => {
			ctx.editorContainer.clear();
			ctx.editorContainer.addChild(ctx.editor);
			ctx.ui.setFocus(ctx.editor);
			ctx.ui.requestRender();
		};
		const commandLine = new CommandLineComponent(
			{
				collabGuest: ctx.collabGuest,
				toggleWrap: () => toggleTranscriptWrap(ctx),
				toggleRich: () => toggleRichTranscript(ctx),
				handleErrorsCommand: args => ctx.handleErrorsCommand(args),
				showPrimitivesInspector: category => ctx.showPrimitivesInspector(category),
				showCopySelector: () => ctx.showCopySelector(),
				handleDumpCommand: isRaw => ctx.handleDumpCommand(isRaw),
				handleJobsCommand: () => ctx.handleJobsCommand(),
				handleChangelogCommand: showFull => ctx.handleChangelogCommand(showFull),
				handleHotkeysCommand: () => ctx.handleHotkeysCommand(),
				handleToolsCommand: () => ctx.handleToolsCommand(),
				handleContextCommand: () => ctx.handleContextCommand(),
				showVersion: async () => {
					const viewModel = await buildVersionViewModel({
						sessionStartedAt: ctx.sessionManager.getHeader()?.timestamp,
					});
					ctx.showStatus(formatVersion(viewModel));
				},
				showFeedback: message => ctx.showStatus(message),
			},
			restore,
		);
		ctx.editorContainer.clear();
		ctx.editorContainer.addChild(commandLine);
		ctx.ui.setFocus(commandLine.input);
		ctx.ui.requestRender();
	};
	ctx.ui.addInputListener(data => {
		if (data !== ":" || !canEnterCommandMode()) return undefined;
		show();
		return { consume: true };
	});
}
