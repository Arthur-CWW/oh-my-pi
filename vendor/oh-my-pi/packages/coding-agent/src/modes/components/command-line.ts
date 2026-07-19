import {
	CompletionBehavior,
	Container,
	Input,
	type Keybinding,
	matchesKey,
	moveWordLeft,
	type SelectItem,
	SelectList,
	Text,
} from "@oh-my-pi/pi-tui";
import { logger, VERSION } from "@oh-my-pi/pi-utils";
import { Effect, Scope } from "effect";
import type { HistoryStorage } from "../../session/history-storage";
import { formatLoopStats } from "../../slash-commands/loopstats";
import { formatTabs } from "../../slash-commands/tabs";
import { buildVersionViewModel, formatVersion } from "../../slash-commands/version";
import { DynamicBorder } from "./dynamic-border";
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
import { getSelectListTheme } from "../theme/theme";
import { toggleRichTranscript, toggleTranscriptWrap } from "../transcript-commands";
import type { InteractiveModeContext } from "../types";
import { matchesUiDismiss } from "../utils/keybinding-matchers";
import {
	makeSurfaceModalModel,
	type SurfaceModalModel,
	type SurfaceModalMsg,
	updateSurfaceModal,
} from "./plugin-settings";
import { updateTextDraft } from "../mvu/form-input";
import type { InputLeaseHandle, InputLeaseHandoff, MvuEnvelope } from "../mvu/input-lease";
import { mountMvuEditorReplacement, mountMvuOverlay, type MvuRouteHandle } from "../mvu/route-host";
import { makeComponentId } from "../mvu/schema";

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

export const COMMAND_LINE_ROUTE = {
	componentId: makeComponentId("command-line"),
	openAction: "app.command.open" as Keybinding,
	context: "modal.command",
	makeInitialModel: makeCommandModalModel,
	update: updateCommandModal,
} as const;

export type CommandModalRegion = "input" | "completion" | "output";
export type CommandModalLayer = { readonly _tag: "Completion" };
export interface CommandModalModel extends SurfaceModalModel<CommandModalRegion, CommandModalLayer> {
	readonly value: string;
	readonly cursor: number;
	readonly completions: readonly CommandModeCompletion[];
	readonly selectedCompletion: number;
	readonly history: readonly string[];
	readonly historyIndex: number;
	readonly historyDraft: string;
	readonly output?: string;
	readonly pending: boolean;
}
export type CommandModalMsg =
	| SurfaceModalMsg<CommandModalRegion, CommandModalLayer>
	| { readonly _tag: "ValueChanged"; readonly value: string; readonly completions: readonly CommandModeCompletion[] }
	| { readonly _tag: "Insert"; readonly text: string }
	| { readonly _tag: "Backspace" }
	| { readonly _tag: "Delete" }
	| { readonly _tag: "Move"; readonly delta: -1 | 1 }
	| { readonly _tag: "Jump"; readonly target: "start" | "end" }
	| { readonly _tag: "DeleteWordBackward" }
	| { readonly _tag: "CycleCompletion"; readonly delta: -1 | 1 }
	| { readonly _tag: "AcceptCompletion" }
	| { readonly _tag: "NavigateHistory"; readonly delta: -1 | 1 }
	| { readonly _tag: "Submit" }
	| { readonly _tag: "CommandFinished"; readonly handled: boolean; readonly output?: string; readonly error?: string };
export type CommandModalCommand =
	| { readonly _tag: "Render"; readonly model: CommandModalModel }
	| { readonly _tag: "CloseRequested" }
	| { readonly _tag: "DispatchCommandRequested"; readonly value: string }
	| { readonly _tag: "PersistCommandHistory"; readonly value: string };

export function makeCommandModalModel(
	history: readonly string[] = [],
	commands: readonly CommandModeCommand[] = COMMAND_MODE_COMMANDS,
): CommandModalModel {
	const base = makeSurfaceModalModel<CommandModalRegion, CommandModalLayer>("input");
	const completions = getCommandModeCompletions("", commands);
	const modal =
		completions.length === 0
			? base
			: updateSurfaceModal<CommandModalRegion, CommandModalLayer>(base, {
					_tag: "Push",
					layer: { _tag: "Completion" },
					region: "completion",
				}).model;
	return {
		...modal,
		value: "",
		cursor: 0,
		completions,
		selectedCompletion: 0,
		history,
		historyIndex: history.length,
		historyDraft: "",
		pending: false,
	};
}

function updateCommandValue(
	model: CommandModalModel,
	value: string,
	cursor: number,
	completions: readonly CommandModeCompletion[],
): { readonly model: CommandModalModel; readonly commands: readonly CommandModalCommand[] } {
	const opening = completions.length > 0 && model.region !== "completion";
	const closing = completions.length === 0 && model.region === "completion";
	const modal = opening
		? updateSurfaceModal<CommandModalRegion, CommandModalLayer>(model, {
				_tag: "Push",
				layer: { _tag: "Completion" },
				region: "completion",
			})
		: closing
			? updateSurfaceModal<CommandModalRegion, CommandModalLayer>(model, { _tag: "Back" })
			: { model, commands: [] };
	return {
		model: {
			...model,
			...modal.model,
			value,
			cursor,
			completions,
			selectedCompletion: 0,
			historyIndex: model.history.length,
			historyDraft: value,
		},
		commands: [],
	};
}

export function updateCommandModal(
	model: CommandModalModel,
	msg: CommandModalMsg,
	commands: readonly CommandModeCommand[] = COMMAND_MODE_COMMANDS,
): { readonly model: CommandModalModel; readonly commands: readonly CommandModalCommand[] } {
	switch (msg._tag) {
		case "ValueChanged":
			return updateCommandValue(model, msg.value, msg.value.length, msg.completions);
		case "Insert":
		case "Backspace":
		case "Delete":
		case "Move":
		case "Jump": {
			const draft = updateTextDraft(model, msg);
			if (draft.value === model.value) {
				return draft.cursor === model.cursor
					? { model, commands: [] }
					: { model: { ...model, cursor: draft.cursor }, commands: [] };
			}
			return updateCommandValue(
				model,
				draft.value,
				draft.cursor,
				getCommandModeCompletions(draft.value, commands),
			);
		}
		case "DeleteWordBackward": {
			const cursor = moveWordLeft(model.value, model.cursor);
			if (cursor === model.cursor) return { model, commands: [] };
			const value = model.value.slice(0, cursor) + model.value.slice(model.cursor);
			return updateCommandValue(model, value, cursor, getCommandModeCompletions(value, commands));
		}
		case "CycleCompletion": {
			if (model.completions.length === 0) return { model, commands: [] };
			const selectedCompletion =
				(model.selectedCompletion + msg.delta + model.completions.length) % model.completions.length;
			return { model: { ...model, selectedCompletion }, commands: [] };
		}
		case "AcceptCompletion": {
			const completion = model.completions[model.selectedCompletion];
			if (!completion) return { model, commands: [] };
			const value = applyCommandModeCompletion(model.value, completion);
			return {
				model: {
					...model,
					value,
					cursor: value.length,
					region: "input",
					depth: [],
					completions: [],
					selectedCompletion: 0,
				},
				commands: [],
			};
		}
		case "NavigateHistory": {
			if (model.history.length === 0) return { model, commands: [] };
			const historyIndex = Math.max(0, Math.min(model.history.length, model.historyIndex + msg.delta));
			const value = historyIndex === model.history.length ? model.historyDraft : model.history[historyIndex] ?? model.value;
			return { model: { ...model, historyIndex, value, cursor: value.length }, commands: [] };
		}
		case "Submit": {
			const value = model.value.trim();
			return value.length === 0
				? { model, commands: [{ _tag: "CloseRequested" }] }
				: { model: { ...model, pending: true }, commands: [{ _tag: "DispatchCommandRequested", value }] };
		}
		case "CommandFinished": {
			const output = msg.error ? `Command failed: ${feedbackError(msg.error)}` : msg.output;
			const commands: CommandModalCommand[] = msg.handled
				? [{ _tag: "PersistCommandHistory", value: model.value.trim() }]
				: [];
			if (output === undefined) commands.push({ _tag: "CloseRequested" });
			return {
				model: {
					...model,
					pending: false,
					region: output === undefined ? model.region : "output",
					depth: output === undefined ? model.depth : [],
					...(output === undefined ? {} : { output }),
				},
				commands,
			};
		}
		default: {
			const transition = updateSurfaceModal(model, msg);
			const backedModel =
				msg._tag === "Back" && model.region === "completion"
					? { ...model, ...transition.model, completions: [], selectedCompletion: 0 }
					: { ...model, ...transition.model };
			return { model: backedModel, commands: transition.commands };
		}
	}
}

/** Capture composer text outside the command model and restore it byte-for-byte. */
export function createCommandDraftRestorer(getDraft: () => string, setDraft: (draft: string) => void): () => void {
	const draft = getDraft();
	return () => {
		if (getDraft() !== draft) setDraft(draft);
	};
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
	#output: string | undefined;

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

	/** Project only a committed reducer model into the terminal component. */
	apply(model: CommandModalModel): void {
		this.#output = model.region === "output" ? model.output : undefined;
		this.input.setValue(model.value, model.cursor);
		this.#completion.setItems(model.completions);
		if (model.completions.length > 0) this.#completion.select(model.selectedCompletion);
		this.#completionList = this.#createCompletionList();
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
		if (this.#output !== undefined) {
			this.addChild(new Text(this.#output, 1, 0));
		} else {
			if (this.#completion.isOpen) this.addChild(this.#completionList);
			this.addChild(this.input);
		}
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

export type CommandOutputModalRegion = "output";
export type CommandOutputModalModel = SurfaceModalModel<CommandOutputModalRegion, never> & {
	readonly message: string;
};
export type CommandOutputModalMsg = SurfaceModalMsg<CommandOutputModalRegion, never>;
export type CommandOutputModalCommand = { readonly _tag: "CloseRequested" };

export const COMMAND_OUTPUT_ROUTE = {
	componentId: makeComponentId("command-output"),
	context: "modal.command-output",
	makeInitialModel: (message: string): CommandOutputModalModel => ({
		...makeSurfaceModalModel<CommandOutputModalRegion, never>("output"),
		message,
	}),
	update: (
		model: CommandOutputModalModel,
		message: CommandOutputModalMsg,
	): { readonly model: CommandOutputModalModel; readonly commands: readonly CommandOutputModalCommand[] } => {
		const transition = updateSurfaceModal(model, message);
		return { model: { ...model, ...transition.model }, commands: transition.commands };
	},
} as const;

/** Bottom-anchored, bounded output surface for every colon command. */
export class CommandOutputOverlayComponent extends Container {
	#model: CommandOutputModalModel;

	constructor(initialModel: CommandOutputModalModel) {
		super();
		this.#model = initialModel;
	}

	apply(model: CommandOutputModalModel): void {
		if (this.#model === model) return;
		this.#model = model;
		this.invalidate();
	}

	override render(width: number): readonly string[] {
		const border = new DynamicBorder().render(width);
		const body = new Text(this.#model.message, 1, 0).render(Math.max(10, width));
		const clipped = body.slice(0, MAX_COMMAND_OUTPUT_LINES);
		if (body.length > clipped.length)
			clipped[clipped.length - 1] = ` … ${body.length - clipped.length + 1} more lines`;
		return [...border, ...clipped, ...border];
	}
}

export async function mountCommandOutputOverlay(
	ctx: InteractiveModeContext,
	message: string,
	previousFocus = ctx.ui.getFocused(),
): Promise<MvuRouteHandle> {
	const initialModel = COMMAND_OUTPUT_ROUTE.makeInitialModel(message);
	const component = new CommandOutputOverlayComponent(initialModel);
	let mounted: MvuRouteHandle | undefined;
	const close = (): void => {
		const handle = mounted;
		if (handle === undefined) return;
		mounted = undefined;
		void Effect.runPromise(handle.close());
	};
	const handle = await Effect.runPromise(
		Scope.provide(ctx.mvuScope)(
			mountMvuOverlay({
				tui: ctx.ui,
				leaseManager: ctx.mvuInputLeaseManager,
				route: {
					componentId: COMMAND_OUTPUT_ROUTE.componentId,
					focusedRoot: component,
					context: () => ({
						contexts: ["modal.family"],
						mode: "Browse" as const,
						focus: "body" as const,
						capabilities: new Set<string>(),
					}),
					actionToMsg: (action: Keybinding, event: MvuEnvelope["event"]) => ({
						_tag: "MvuInput" as const,
						action,
						event,
					}),
				},
				component,
				runtimeConfig: {
					componentId: COMMAND_OUTPUT_ROUTE.componentId,
					initialModel,
					update: (model: CommandOutputModalModel, envelope: MvuEnvelope) => {
						if (envelope.action !== "ui.dismiss") {
							return { model, commands: [], dirtyKeys: new Set<string>() };
						}
						const transition = COMMAND_OUTPUT_ROUTE.update(model, { _tag: "Back" });
						return { ...transition, dirtyKeys: new Set<string>(["modal"]) };
					},
					interpret: (command: CommandOutputModalCommand) =>
						Effect.sync(() => {
							if (command._tag === "CloseRequested") close();
							return [];
						}),
					inputCapacity: 32,
					messageCapacity: 32,
					commandCapacity: 8,
				},
				overlayOptions: {
					anchor: "bottom-center",
					width: "100%",
					maxHeight: MAX_COMMAND_OUTPUT_LINES + 2,
					margin: { bottom: 1 },
				},
				restoreFocus: Effect.sync(() => {
					ctx.ui.setFocus(previousFocus);
					ctx.ui.requestRender();
				}),
			}),
		),
	);
	mounted = handle;
	ctx.ui.setFocus(component);
	ctx.ui.requestRender();
	return handle;
}

const installedContexts = new WeakSet<InteractiveModeContext>();
const activeCommandRoutes = new WeakMap<InteractiveModeContext, MvuRouteHandle>();

export function canEnterCommandMode(ctx: InteractiveModeContext): boolean {
	return canEnterCommandModeFromCurrentFocus(ctx);
}

export function commandModeContextForInteractive(
	ctx: InteractiveModeContext,
	commands: readonly CommandModeCommand[],
	showOutput: (message: string) => void = message => ctx.showStatus(message),
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
				journalPath: viewSession.sessionManager.getSessionFile(),
				binaryVersion: VERSION,
			};
		},
		copyIdentityHandle: handle => copyToClipboard(handle),
		bookmarkCurrent: args => ctx.bookmarkCurrent(args),
		showBookmarks: () => ctx.showBookmarks(),
		showFeedback: showOutput,
	};
}


export function updateCommandModalFromInput(
	model: CommandModalModel,
	envelope: MvuEnvelope,
	commands: readonly CommandModeCommand[],
): { readonly model: CommandModalModel; readonly commands: readonly CommandModalCommand[] } {
	if (model.pending) return { model, commands: [] };
	if (model.region === "output") return { model, commands: [{ _tag: "CloseRequested" }] };

	const chain = (messages: readonly CommandModalMsg[]) => {
		let current = model;
		const emitted: CommandModalCommand[] = [];
		for (const message of messages) {
			const transition = updateCommandModal(current, message, commands);
			current = transition.model;
			emitted.push(...transition.commands);
		}
		return { model: current, commands: emitted };
	};

	switch (envelope.action) {
		case "app.command.input": {
			const text =
				envelope.event._tag === "Paste"
					? envelope.event.text
					: envelope.event._tag === "Press"
						? envelope.event.text
						: undefined;
			return text === undefined || text.length === 0
				? { model, commands: [] }
				: updateCommandModal(model, { _tag: "Insert", text }, commands);
		}
		case "app.command.backspace":
			return model.value.length === 0
				? { model, commands: [{ _tag: "CloseRequested" }] }
				: updateCommandModal(model, { _tag: "Backspace" }, commands);
		case "tui.editor.deleteCharForward":
			return updateCommandModal(model, { _tag: "Delete" }, commands);
		case "tui.editor.cursorLeft":
			return updateCommandModal(model, { _tag: "Move", delta: -1 }, commands);
		case "tui.editor.cursorRight":
			return updateCommandModal(model, { _tag: "Move", delta: 1 }, commands);
		case "tui.editor.cursorLineStart":
			return updateCommandModal(model, { _tag: "Jump", target: "start" }, commands);
		case "tui.editor.cursorLineEnd":
			return updateCommandModal(model, { _tag: "Jump", target: "end" }, commands);
		case "tui.editor.deleteWordBackward":
			return updateCommandModal(model, { _tag: "DeleteWordBackward" }, commands);
		case "app.command.completionNext":
		case "app.command.completionPrevious": {
			if (model.completions.length === 0) return { model, commands: [] };
			const delta = envelope.action === "app.command.completionPrevious" ? -1 : 1;
			return chain([{ _tag: "CycleCompletion", delta }, { _tag: "AcceptCompletion" }]);
		}
		case "app.command.previous":
		case "app.command.next": {
			const delta = envelope.action === "app.command.previous" ? -1 : 1;
			return updateCommandModal(
				model,
				model.completions.length > 0
					? { _tag: "CycleCompletion", delta }
					: { _tag: "NavigateHistory", delta },
				commands,
			);
		}
		case "app.command.submit":
			return chain([
				...(model.completions.length > 0 ? ([{ _tag: "AcceptCompletion" }] as const) : []),
				{ _tag: "Submit" },
			]);
		case "ui.dismiss":
			return updateCommandModal(model, { _tag: "Back" }, commands);
		default:
			return { model, commands: [] };
	}
}

/** Install the named global command action; the modal itself owns one MVU lease. */
export function installCommandLine(ctx: InteractiveModeContext): void {
	if (installedContexts.has(ctx)) return;
	installedContexts.add(ctx);
	const canEnter = (): boolean => canEnterCommandMode(ctx);
	const leaseManager = ctx.mvuInputLeaseManager;
	let outputRoute: MvuRouteHandle | undefined;
	let outputTransition: Promise<void> = Promise.resolve();
	let commandCloseTransition: Promise<void> = Promise.resolve();
	const completeHandoffAfterClose = (handoff: InputLeaseHandoff): void => {
		const closeTransition = commandCloseTransition;
		void closeTransition
			.then(() => Effect.runPromise(handoff.complete()))
			.catch(error => {
				ctx.showError(`Could not complete command handoff: ${error instanceof Error ? error.message : String(error)}`);
			});
	};
	const showOutput = (message: string, handoff?: InputLeaseHandoff): void => {
		const closeTransition = commandCloseTransition;
		outputTransition = outputTransition.then(async () => {
			await closeTransition;
			if (outputRoute !== undefined) {
				await Effect.runPromise(outputRoute.close());
				outputRoute = undefined;
			}
			const previousFocus = ctx.ui.getFocused();
			try {
				outputRoute = await mountCommandOutputOverlay(ctx, message, previousFocus);
			} catch (error) {
				ctx.showError(`Could not open command output: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				if (handoff !== undefined) await Effect.runPromise(handoff.complete());
			}
		});
	};
	const show = (): boolean => {
		const currentLease = leaseManager.current();
		if (
			!canEnter() ||
			activeCommandRoutes.has(ctx) ||
			(currentLease.kind === "mvu" && currentLease.componentId === COMMAND_LINE_ROUTE.componentId)
		) {
			return false;
		}
		const commands = commandModeCommandsForView(Boolean(ctx.focusedAgentId));
		const priorFocus = ctx.ui.getFocused();
		const useEditorSlot = priorFocus === ctx.editor;
		const priorChildren = useEditorSlot ? [...ctx.editorContainer.children] : undefined;
		const restoreDraft = createCommandDraftRestorer(
			() => ctx.editor.getText(),
			draft => ctx.editor.setText(draft),
		);
		let closeRequested = false;
		let resolveRouteHandle!: (handle: MvuRouteHandle | undefined) => void;
		const routeHandle = new Promise<MvuRouteHandle | undefined>(resolve => {
			resolveRouteHandle = resolve;
		});
		const close = (): void => {
			if (closeRequested) return;
			closeRequested = true;
			activeCommandRoutes.delete(ctx);
			commandCloseTransition = routeHandle.then(handle =>
				handle === undefined ? Promise.resolve() : Effect.runPromise(handle.close()),
			);
		};
		let commandOutput: string | undefined;
		const commandContext = commandModeContextForInteractive(ctx, commands, message => {
			commandOutput = message;
		});
		const commandLine = new CommandLineComponent(commandContext, close, {
			commands,
			historyStorage: ctx.historyStorage,
		});
		let handedOff = false;
		const runtimeConfig = {
			componentId: COMMAND_LINE_ROUTE.componentId,
			initialModel: COMMAND_LINE_ROUTE.makeInitialModel(
				(ctx.historyStorage?.getRecent(100, "command") ?? []).map(entry => entry.prompt).reverse(),
				commands,
			),
			update: (model: CommandModalModel, message: MvuEnvelope | CommandModalMsg) => {
				const transition =
					message._tag === "MvuInput"
						? updateCommandModalFromInput(model, message, commands)
						: updateCommandModal(model, message);
				const runtimeCommands: readonly CommandModalCommand[] =
					transition.model === model
						? transition.commands
						: [{ _tag: "Render", model: transition.model }, ...transition.commands];
				return {
					model: transition.model,
					commands: runtimeCommands,
					dirtyKeys: transition.model === model ? new Set<string>() : new Set<string>(["modal"]),
				};
			},
			interpret: (command: CommandModalCommand): Effect.Effect<readonly CommandModalMsg[]> => {
				switch (command._tag) {
					case "Render":
						return Effect.sync(() => {
							commandLine.apply(command.model);
							ctx.ui.requestRender();
							return [];
						});
					case "CloseRequested":
						return Effect.sync(() => {
							close();
							return [];
						});
					case "DispatchCommandRequested":
						return Effect.promise(async () => {
							let handoff: InputLeaseHandoff;
							try {
								handoff = await Effect.runPromise(
									leaseManager.beginHandoff(COMMAND_LINE_ROUTE.componentId),
								);
							} catch (error) {
								close();
								ctx.showError(
									`Command failed: ${feedbackError(error instanceof Error ? error : String(error))}`,
								);
								return [];
							}
							handedOff = true;
							close();
							const closeTransition = commandCloseTransition;
							void closeTransition
								.then(async () => {
									commandOutput = undefined;
									try {
										const handled = await dispatchCommandLine(command.value, commandContext, commands);
										if (handled) {
											try {
												await ctx.historyStorage?.addToChannel("command", command.value.trim());
											} catch (error) {
												logger.warn("Command history persistence failed", { error: String(error) });
											}
										}
										if (commandOutput === undefined) completeHandoffAfterClose(handoff);
										else showOutput(commandOutput, handoff);
									} catch (error) {
										showOutput(
											`Command failed: ${feedbackError(error instanceof Error ? error : String(error))}`,
											handoff,
										);
									}
								})
								.catch(error => {
									void Effect.runPromise(handoff.complete());
									ctx.showError(
										`Could not close command mode: ${error instanceof Error ? error.message : String(error)}`,
									);
								});
							return [];
						});
					case "PersistCommandHistory":
						return Effect.promise(async () => {
							try {
								await ctx.historyStorage?.addToChannel("command", command.value);
							} catch (error) {
								logger.warn("Command history persistence failed", { error: String(error) });
							}
							return [];
						});
				}
			},
			inputCapacity: 256,
			messageCapacity: 256,
			commandCapacity: 64,
		};
		const route = {
			componentId: COMMAND_LINE_ROUTE.componentId,
			focusedRoot: commandLine,
			context: () => ({
				contexts: ["modal.family", COMMAND_LINE_ROUTE.context],
				mode: "Browse" as const,
				focus: "body" as const,
				capabilities: new Set<string>(),
			}),
			actionToMsg: (action: Keybinding, event: MvuEnvelope["event"]) => ({ _tag: "MvuInput" as const, action, event }),
			textToMsg: (event: Extract<MvuEnvelope["event"], { readonly _tag: "Press" }>) => ({
				_tag: "MvuInput" as const,
				action: "app.command.input" as Keybinding,
				event,
			}),
			pasteToMsg: (event: Extract<MvuEnvelope["event"], { readonly _tag: "Paste" }>) => ({
				_tag: "MvuInput" as const,
				action: "app.command.input" as Keybinding,
				event,
			}),
		};
		const restore = Effect.sync(() => {
			commandLine.input.focused = false;
			restoreDraft();
			const lease = leaseManager.current();
			if (!handedOff || lease.kind === "legacy" || lease.componentId === COMMAND_LINE_ROUTE.componentId) {
				ctx.ui.setFocus(priorFocus);
			}
			ctx.ui.requestRender();
		});
		const mount = useEditorSlot
			? mountMvuEditorReplacement({
					tui: ctx.ui,
					leaseManager,
					route,
					component: commandLine,
					runtimeConfig,
					hideEditor: Effect.sync(() => {
						ctx.editorContainer.clear();
						ctx.editorContainer.addChild(commandLine);
					}),
					restoreEditor: Effect.sync(() => {
						ctx.editorContainer.clear();
						for (const child of priorChildren ?? [ctx.editor]) ctx.editorContainer.addChild(child);
					}),
					previousFocus: priorFocus,
					restoreFocus: restore,
			  })
			: mountMvuOverlay({
					tui: ctx.ui,
					leaseManager,
					route,
					component: commandLine,
					runtimeConfig,
					overlayOptions: { anchor: "bottom-center", width: "100%", maxHeight: "50%", margin: 0 },
					restoreFocus: restore,
			  });
		let reservation: InputLeaseHandle;
		try {
			reservation = leaseManager.reserveMvu(route, { replaceActive: currentLease.kind === "mvu" });
		} catch (error) {
			ctx.showError(`Could not open command mode: ${error instanceof Error ? error.message : String(error)}`);
			return false;
		}
		void (async () => {
			try {
				const handle = await Effect.runPromise(Scope.provide(ctx.mvuScope)(mount));
				if (!closeRequested) activeCommandRoutes.set(ctx, handle);
				resolveRouteHandle(handle);
				if (closeRequested) return;
				commandLine.input.focused = true;
				ctx.ui.requestRender();
			} catch (error) {
				resolveRouteHandle(undefined);
				await Effect.runPromise(reservation.revoke());
				ctx.showError(`Could not open command mode: ${error instanceof Error ? error.message : String(error)}`);
			}
		})();
		return true;
	};
	const openKeys = ctx.keybindings.getKeys(COMMAND_LINE_ROUTE.openAction);
	leaseManager.addGlobalInputHandler(data => {
		const current = leaseManager.current();
		if (current.kind === "mvu" && current.componentId === COMMAND_LINE_ROUTE.componentId) return false;
		if (!openKeys.some(key => matchesKey(data, key)) || !canEnter()) return false;
		return show();
	});
	ctx.ui.addInputListener(data => {
		if (!openKeys.some(key => matchesKey(data, key)) || !canEnter()) return undefined;
		return show() ? { consume: true } : undefined;
	});
}
