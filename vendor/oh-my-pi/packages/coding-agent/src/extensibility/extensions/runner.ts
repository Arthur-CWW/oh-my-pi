/**
 * Extension runner - executes extensions and manages their lifecycle.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type {
	CredentialDisabledEvent,
	MediaContent,
	Model,
	ProviderResponseMetadata,
	UserContent,
} from "@oh-my-pi/pi-ai";
import type { KeyId } from "@oh-my-pi/pi-tui";
import { logger } from "@oh-my-pi/pi-utils";
import type { ModelRegistry } from "../../config/model-registry";
import type { Settings } from "../../config/settings";
import type { MemoryRuntimeContext } from "../../memory-backend";
import { type Theme, theme } from "../../modes/theme/theme";
import type { SessionManager } from "../../session/session-manager";
import { runWithExecHandlerContext } from "../../exec/exec";
import { createExtensionModelQuery } from "./model-api";
import {
	type BeforeAgentStartCombinedResult,
	runBeforeAgentStartAttachmentAdapters,
	runInputAttachmentAdapters,
} from "./attachment-event-adapters";
import type {
	AfterProviderResponseEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	AssistantThinkingRenderer,
	BeforeProviderRequestEvent,
	BeforeProviderRequestEventResult,
	CompactOptions,
	ContextEvent,
	ContextEventResult,
	ContextUsage,
	Extension,
	ExtensionActions,
	ExtensionCommandContext,
	ExtensionCommandContextActions,
	ExtensionContext,
	ExtensionContextActions,
	ExtensionError,
	ExtensionEvent,
	ExtensionFlag,
	ExtensionRuntime,
	ExtensionShortcut,
	ExtensionUIContext,
	InputEvent,
	InputEventResult,
	MessageRenderer,
	RegisteredCommand,
	RegisteredTool,
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
	SessionBeforeBranchResult,
	SessionBeforeCompactResult,
	SessionBeforeSwitchResult,
	SessionBeforeTreeResult,
	SessionCompactingResult,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	UserBashEvent,
	UserBashEventResult,
	UserPythonEvent,
	UserPythonEventResult,
} from "./types";

export type ExtensionErrorListener = (error: ExtensionError) => void;

export type ExtensionViolationRecord =
	| {
			kind: "timeout";
			extensionId: string;
			sessionId: string;
			event: string;
			elapsedMs: number;
			action: "abort_handler_and_process_tree";
			timeoutMs: number;
			timestamp: string;
	  }
	| {
			kind: "reentrancy";
			extensionId: string;
			sessionId: string;
			event: string;
			elapsedMs: number;
			action: "coalesce_with_in_flight";
			timestamp: string;
	  }
	| {
			kind: "output_overflow";
			extensionId: string;
			sessionId: string;
			event: string;
			elapsedMs: number;
			action: "truncate_output";
			stream: "stdout" | "stderr";
			limitBytes: number;
			timestamp: string;
	  }
	| {
			kind: "message_overflow";
			extensionId: string;
			sessionId: string;
			event: string;
			elapsedMs: number;
			action: "drop_message";
			limit: number;
			timestamp: string;
	  };

export type ExtensionViolationListener = (record: ExtensionViolationRecord) => void;

interface HandlerMessageBudget {
	count: number;
	overflowRecorded: boolean;
	startedAt: number;
	extensionId?: string;
}

interface HandlerExecutionScope {
	extensionId: string;
	event: string;
	startedAt: number;
	messageBudget: HandlerMessageBudget;
}

const handlerExecutionContext = new AsyncLocalStorage<HandlerExecutionScope>();
export const NEVER_ABORT_SIGNAL = new AbortController().signal;
const MAX_PENDING_EXTENSION_MESSAGES = 32;
const MAX_EXTENSION_VIOLATION_RECORDS = 128;

export const EXTENSION_HANDLER_TIMEOUT_MS = 30_000;
let extensionHandlerTimeoutMs = EXTENSION_HANDLER_TIMEOUT_MS;

export function testSetExtensionHandlerTimeoutMs(timeoutMs: number): void {
	extensionHandlerTimeoutMs = timeoutMs;
}

/**
 * Dedicated cap for `session_shutdown` handlers. The generic 30s budget is
 * appropriate for events extensions can observe (e.g. `session_start`,
 * `before_provider_request`), but `session_shutdown` is fire-and-forget
 * teardown — extensions receive no result and the user has already asked to
 * leave. A hung handler (e.g. an extension waiting on a stuck IPC pipe to a
 * companion app) MUST NOT hold Ctrl+C / `/exit` hostage for the full window.
 * See issue #2600.
 */
export const SESSION_SHUTDOWN_HANDLER_TIMEOUT_MS = 2_000;
let sessionShutdownHandlerTimeoutMs = SESSION_SHUTDOWN_HANDLER_TIMEOUT_MS;

export function testSetSessionShutdownHandlerTimeoutMs(timeoutMs: number): void {
	sessionShutdownHandlerTimeoutMs = timeoutMs;
}

/** Per-event handler budget. Defaults to the generic cap; `session_shutdown`
 *  uses its own short cap so teardown stays prompt. */
function handlerTimeoutForEvent(eventType: string): number {
	return eventType === "session_shutdown" ? sessionShutdownHandlerTimeoutMs : extensionHandlerTimeoutMs;
}

const EXTENSION_HANDLER_TIMEOUT = Symbol("extensionHandlerTimeout");

const MAX_PENDING_CREDENTIAL_DISABLED = 32;

/**
 * Events handled by the generic emit() method.
 * Events with dedicated emitXxx() methods are excluded for stronger type safety.
 */
type RunnerEmitEvent = Exclude<
	ExtensionEvent,
	| ToolCallEvent
	| ToolResultEvent
	| UserBashEvent
	| ContextEvent
	| BeforeProviderRequestEvent
	| AfterProviderResponseEvent
	| BeforeAgentStartEvent
	| ResourcesDiscoverEvent
	| InputEvent
>;

type SessionBeforeEvent = Extract<
	RunnerEmitEvent,
	{ type: "session_before_switch" | "session_before_branch" | "session_before_compact" | "session_before_tree" }
>;

type SessionBeforeEventResult =
	| SessionBeforeSwitchResult
	| SessionBeforeBranchResult
	| SessionBeforeCompactResult
	| SessionBeforeTreeResult;

type RunnerEmitResult<TEvent extends RunnerEmitEvent> = TEvent extends { type: "session_before_switch" }
	? SessionBeforeSwitchResult | undefined
	: TEvent extends { type: "session_before_branch" }
		? SessionBeforeBranchResult | undefined
		: TEvent extends { type: "session_before_compact" }
			? SessionBeforeCompactResult | undefined
			: TEvent extends { type: "session_before_tree" }
				? SessionBeforeTreeResult | undefined
				: TEvent extends { type: "session.compacting" }
					? SessionCompactingResult | undefined
					: undefined;

export type NewSessionHandler = (options?: {
	parentSession?: string;
	setup?: (sessionManager: SessionManager) => Promise<void>;
}) => Promise<{ cancelled: boolean }>;

export type BranchHandler = (entryId: string) => Promise<{ cancelled: boolean }>;

export type NavigateTreeHandler = (
	targetId: string,
	options?: { summarize?: boolean },
) => Promise<{ cancelled: boolean }>;

export type SwitchSessionHandler = (sessionPath: string) => Promise<{ cancelled: boolean }>;

export type ShutdownHandler = () => void;

/**
 * Helper function to emit session_shutdown event to extensions.
 * Returns true if the event was emitted, false if there were no handlers.
 */
export async function emitSessionShutdownEvent(extensionRunner: ExtensionRunner | undefined): Promise<boolean> {
	if (extensionRunner?.hasHandlers("session_shutdown")) {
		await extensionRunner.emit({
			type: "session_shutdown",
		});
		return true;
	}
	return false;
}

const noOpUIContext: ExtensionUIContext = {
	select: async (_title, _options, _dialogOptions) => undefined,
	confirm: async (_title, _message, _dialogOptions) => false,
	input: async (_title, _placeholder, _dialogOptions) => undefined,
	notify: () => {},
	onTerminalInput: () => () => {},
	setStatus: () => {},
	setWorkingMessage: () => {},
	setWidget: () => {},
	setFooter: () => {},
	setHeader: () => {},
	setTitle: () => {},
	custom: async () => undefined as never,
	setEditorText: () => {},
	pasteToEditor: () => {},
	getEditorText: () => "",
	editor: async () => undefined,
	setEditorComponent: () => {},
	get theme() {
		return theme;
	},
	getAllThemes: () => Promise.resolve([]),
	getTheme: () => Promise.resolve(undefined),
	setTheme: (_theme: string | Theme) => Promise.resolve({ success: false, error: "UI not available" }),
	getToolsExpanded: () => false,
	setToolsExpanded: () => {},
};

export class ExtensionRunner {
	#uiContext: ExtensionUIContext;
	#errorListeners: Set<ExtensionErrorListener> = new Set();
	#violationListeners: Set<ExtensionViolationListener> = new Set();
	#violationRecords: ExtensionViolationRecord[] = [];
	#inFlightEvents = new Map<
		string,
		{ promise: Promise<unknown>; startedAt: number; messageBudget: HandlerMessageBudget }
	>();
	#getModel: () => Model | undefined = () => undefined;
	#isIdleFn: () => boolean = () => true;
	#waitForIdleFn: () => Promise<void> = async () => {};
	#abortFn: () => void = () => {};
	#hasPendingMessagesFn: () => boolean = () => false;
	#getContextUsageFn: () => ContextUsage | undefined = () => undefined;
	#compactFn: (instructionsOrOptions?: string | CompactOptions) => Promise<void> = async () => {};
	#getSystemPromptFn: () => string[] = () => [];
	#newSessionHandler: NewSessionHandler = async () => ({ cancelled: false });
	#branchHandler: BranchHandler = async () => ({ cancelled: false });
	#navigateTreeHandler: NavigateTreeHandler = async () => ({ cancelled: false });
	#switchSessionHandler: SwitchSessionHandler = async () => ({ cancelled: false });
	#reloadHandler: () => Promise<void> = async () => {};
	#shutdownHandler: ShutdownHandler = () => {};
	#getMemoryFn?: () => MemoryRuntimeContext | undefined;
	#commandDiagnostics: Array<{ type: string; message: string; path: string }> = [];
	#initialized = false;
	/**
	 * Buffer for `credential_disabled` events received via {@link emitCredentialDisabled}
	 * before {@link initialize} has run. Drained through {@link emit} once initialize sets
	 * up the runtime context, so extension handlers see a populated UI/runtime context
	 * rather than the constructor's no-op default. Bounded at
	 * {@link MAX_PENDING_CREDENTIAL_DISABLED}; oldest entries are dropped under pressure.
	 */
	#pendingCredentialDisabled: CredentialDisabledEvent[] = [];

	constructor(
		private readonly extensions: Extension[],
		private readonly runtime: ExtensionRuntime,
		private readonly cwd: string,
		private readonly sessionManager: SessionManager,
		private readonly modelRegistry: ModelRegistry,
		getMemory?: () => MemoryRuntimeContext | undefined,
		private readonly settings?: Settings,
	) {
		this.#uiContext = noOpUIContext;
		this.#getMemoryFn = getMemory;
	}

	initialize(
		actions: ExtensionActions,
		contextActions: ExtensionContextActions,
		commandContextActions?: ExtensionCommandContextActions,
		uiContext?: ExtensionUIContext,
	): void {
		// Copy actions into the shared runtime (all extension APIs reference this)
		this.runtime.sendMessage = (message, options) => {
			if (!this.#consumePendingMessageSlot()) return;
			actions.sendMessage(message, options);
		};
		this.runtime.sendUserMessage = (content, options) => {
			if (!this.#consumePendingMessageSlot()) return;
			actions.sendUserMessage(content, options);
		};
		this.runtime.appendEntry = actions.appendEntry;
		this.runtime.getActiveTools = actions.getActiveTools;
		this.runtime.getAllTools = actions.getAllTools;
		this.runtime.setActiveTools = actions.setActiveTools;
		this.runtime.getCommands = actions.getCommands;
		this.runtime.setModel = actions.setModel;
		this.runtime.getThinkingLevel = actions.getThinkingLevel;
		this.runtime.setThinkingLevel = actions.setThinkingLevel;
		this.runtime.getSessionName = actions.getSessionName;
		this.runtime.setSessionName = actions.setSessionName;

		// Context actions (required)
		this.#getModel = contextActions.getModel;
		this.#isIdleFn = contextActions.isIdle;
		this.#abortFn = contextActions.abort;
		this.#hasPendingMessagesFn = contextActions.hasPendingMessages;
		this.#shutdownHandler = contextActions.shutdown;
		this.#getSystemPromptFn = contextActions.getSystemPrompt;

		// Command context actions (optional, only for interactive mode)
		if (commandContextActions) {
			this.#waitForIdleFn = commandContextActions.waitForIdle;
			this.#newSessionHandler = commandContextActions.newSession;
			this.#branchHandler = commandContextActions.branch;
			this.#navigateTreeHandler = commandContextActions.navigateTree;
			this.#switchSessionHandler = commandContextActions.switchSession;
			this.#reloadHandler = commandContextActions.reload;
			this.#getContextUsageFn = commandContextActions.getContextUsage;
			this.#compactFn = commandContextActions.compact;
		}

		this.#uiContext = uiContext ?? noOpUIContext;
		this.#initialized = true;

		// Drain events buffered by emitCredentialDisabled() before initialize ran. The
		// spread adds the `type` discriminator — `event` is the pi-ai shape (no `type`).
		// Deferred by one microtask so callers that register an onError listener
		// synchronously after initialize() see handler errors routed through it.
		const pending = this.#pendingCredentialDisabled.splice(0);
		queueMicrotask(() => {
			for (const event of pending) {
				this.#emitHandlers({ type: "credential_disabled", ...event }).catch((error: unknown) => {
					logger.warn("credential_disabled handler threw during initialize flush", {
						provider: event.provider,
						error: error instanceof Error ? error.message : String(error),
					});
				});
			}
		});
	}

	/**
	 * Forward a `credential_disabled` event from `AuthStorage` to extension handlers.
	 *
	 * If {@link initialize} has not yet run, the event is buffered and replayed once
	 * initialize wires the runtime/UI context. This matters because mode controllers
	 * (interactive, RPC, ACP, print, subagent) call `initialize()` AFTER `createAgentSession`
	 * returns, but `AuthStorage` can fire `credential_disabled` during startup model probes
	 * inside `createAgentSession()`. Without deferral, extension handlers would observe
	 * `hasUI=false`, an unset model, and no-op runtime actions on exactly the headline
	 * "OAuth invalid_grant during startup" path the event was designed to surface.
	 *
	 * Always returns; never throws. Errors from handlers are routed through
	 * {@link onError} via {@link emit}'s normal isolation.
	 */
	async emitCredentialDisabled(event: CredentialDisabledEvent): Promise<void> {
		if (!this.#initialized) {
			if (this.#pendingCredentialDisabled.length >= MAX_PENDING_CREDENTIAL_DISABLED) {
				this.#pendingCredentialDisabled.shift();
			}
			this.#pendingCredentialDisabled.push(event);
			return;
		}
		await this.emit({ type: "credential_disabled", ...event });
	}

	getUIContext(): ExtensionUIContext {
		return this.#uiContext;
	}

	hasUI(): boolean {
		return this.#uiContext !== noOpUIContext;
	}

	getExtensionPaths(): string[] {
		return this.extensions.map(e => e.path);
	}

	/** Get all registered tools from all extensions. */
	getAllRegisteredTools(): RegisteredTool[] {
		const tools: RegisteredTool[] = [];
		for (const ext of this.extensions) {
			for (const tool of ext.tools.values()) {
				tools.push(tool);
			}
		}
		return tools;
	}

	/**
	 * Aggregate the registered CLI flags across a set of extensions (last write
	 * wins on name collision). Static so callers that need the flag set before a
	 * runner exists — e.g. the CLI resolving `@file`/flag args before session
	 * creation — share this exact logic instead of duplicating it.
	 */
	static aggregateFlags(extensions: readonly Extension[]): Map<string, ExtensionFlag> {
		const allFlags = new Map<string, ExtensionFlag>();
		for (const ext of extensions) {
			for (const [name, flag] of ext.flags) {
				allFlags.set(name, flag);
			}
		}
		return allFlags;
	}

	getFlags(): Map<string, ExtensionFlag> {
		return ExtensionRunner.aggregateFlags(this.extensions);
	}

	getFlagValues(): Map<string, boolean | string> {
		return new Map(this.runtime.flagValues);
	}

	setFlagValue(name: string, value: boolean | string): void {
		this.runtime.flagValues.set(name, value);
	}

	static readonly #RESERVED_SHORTCUTS: Record<string, true> = {
		"ctrl+c": true,
		"ctrl+d": true,
		"ctrl+z": true,
		"ctrl+k": true,
		"ctrl+p": true,
		"ctrl+l": true,
		"ctrl+o": true,
		"ctrl+t": true,
		"ctrl+g": true,
		"alt+m": true,
		// Default chord for `app.message.followUp` (Windows Terminal can't deliver Ctrl+Enter; #1903).
		"ctrl+q": true,
		"shift+tab": true,
		"shift+ctrl+p": true,
		"alt+enter": true,
		escape: true,
		enter: true,
	};

	getShortcuts(): Map<KeyId, ExtensionShortcut> {
		const allShortcuts = new Map<KeyId, ExtensionShortcut>();
		for (const ext of this.extensions) {
			for (const [key, shortcut] of ext.shortcuts) {
				const normalizedKey = key.toLowerCase() as KeyId;

				if (ExtensionRunner.#RESERVED_SHORTCUTS[normalizedKey]) {
					logger.warn("Extension shortcut conflicts with built-in shortcut", {
						key,
						extensionPath: shortcut.extensionPath,
					});
					continue;
				}

				const existing = allShortcuts.get(normalizedKey);
				if (existing) {
					logger.warn("Extension shortcut conflict", {
						key,
						extensionPath: shortcut.extensionPath,
						existingExtensionPath: existing.extensionPath,
					});
				}
				allShortcuts.set(normalizedKey, shortcut);
			}
		}
		return allShortcuts;
	}

	onError(listener: ExtensionErrorListener): () => void {
		this.#errorListeners.add(listener);
		return () => this.#errorListeners.delete(listener);
	}

	emitError(error: ExtensionError): void {
		for (const listener of this.#errorListeners) {
			listener(error);
		}
	}

	onViolation(listener: ExtensionViolationListener): () => void {
		this.#violationListeners.add(listener);
		return () => this.#violationListeners.delete(listener);
	}

	getViolationRecords(): readonly ExtensionViolationRecord[] {
		return this.#violationRecords;
	}

	#recordViolation(record: ExtensionViolationRecord): void {
		if (this.#violationRecords.length >= MAX_EXTENSION_VIOLATION_RECORDS) {
			this.#violationRecords.shift();
		}
		this.#violationRecords.push(record);
		for (const listener of this.#violationListeners) listener(record);
	}

	#consumePendingMessageSlot(): boolean {
		const scope = handlerExecutionContext.getStore();
		if (!scope) return true;
		const budget = scope.messageBudget;
		if (budget.count < MAX_PENDING_EXTENSION_MESSAGES) {
			budget.count++;
			return true;
		}
		if (!budget.overflowRecorded) {
			budget.overflowRecorded = true;
			this.#recordViolation({
				kind: "message_overflow",
				extensionId: scope.extensionId,
				sessionId: this.sessionManager.getSessionId(),
				event: scope.event,
				elapsedMs: performance.now() - scope.startedAt,
				action: "drop_message",
				limit: MAX_PENDING_EXTENSION_MESSAGES,
				timestamp: new Date().toISOString(),
			});
		}
		return false;
	}

	hasHandlers(eventType: string): boolean {
		for (const ext of this.extensions) {
			const handlers = ext.handlers.get(eventType);
			if (handlers && handlers.length > 0) {
				return true;
			}
		}
		return false;
	}

	getMessageRenderer(customType: string): MessageRenderer | undefined {
		for (const ext of this.extensions) {
			const renderer = ext.messageRenderers.get(customType);
			if (renderer) {
				return renderer;
			}
		}
		return undefined;
	}

	getAssistantThinkingRenderers(): AssistantThinkingRenderer[] {
		return this.extensions.flatMap(ext => ext.assistantThinkingRenderers);
	}

	getRegisteredCommands(reserved?: ReadonlySet<string>): RegisteredCommand[] {
		this.#commandDiagnostics = [];

		const commands = new Map<string, RegisteredCommand>();
		for (const ext of this.extensions) {
			for (const command of ext.commands.values()) {
				if (reserved?.has(command.name)) {
					const message = `Extension command '${command.name}' from ${ext.path} conflicts with built-in commands. Skipping.`;
					this.#commandDiagnostics.push({ type: "warning", message, path: ext.path });
					if (!this.hasUI()) {
						logger.warn(message);
					}
					continue;
				}

				commands.set(command.name, command);
			}
		}
		return [...commands.values()];
	}

	getCommandDiagnostics(): Array<{ type: string; message: string; path: string }> {
		return this.#commandDiagnostics;
	}

	getCommand(name: string): RegisteredCommand | undefined {
		for (let index = this.extensions.length - 1; index >= 0; index -= 1) {
			const command = this.extensions[index]?.commands.get(name);
			if (command) {
				return command;
			}
		}
		return undefined;
	}

	createContext(signal: AbortSignal = NEVER_ABORT_SIGNAL): ExtensionContext {
		const getModel = this.#getModel;
		return {
			ui: this.#uiContext,
			signal,
			getContextUsage: () => this.#getContextUsageFn(),
			compact: instructionsOrOptions => this.#compactFn(instructionsOrOptions),
			hasUI: this.hasUI(),
			cwd: this.cwd,
			sessionManager: this.sessionManager,
			modelRegistry: this.modelRegistry,
			get model() {
				return getModel();
			},
			models: createExtensionModelQuery(this.modelRegistry, this.settings, getModel),
			isIdle: () => this.#isIdleFn(),
			abort: () => this.#abortFn(),
			hasPendingMessages: () => this.#hasPendingMessagesFn(),
			shutdown: () => this.#shutdownHandler(),
			getSystemPrompt: () => this.#getSystemPromptFn(),
			memory: this.#getMemoryFn?.(),
		};
	}

	/**
	 * Request a graceful shutdown. Called by extension tools and event handlers.
	 */
	shutdown(): void {
		this.#shutdownHandler();
	}

	createCommandContext(): ExtensionCommandContext {
		return {
			...this.createContext(),
			getContextUsage: () => this.#getContextUsageFn(),
			waitForIdle: () => this.#waitForIdleFn(),
			newSession: options => this.#newSessionHandler(options),
			branch: entryId => this.#branchHandler(entryId),
			navigateTree: (targetId, options) => this.#navigateTreeHandler(targetId, options),
			switchSession: sessionPath => this.#switchSessionHandler(sessionPath),
			reload: () => this.#reloadHandler(),
			compact: instructionsOrOptions => this.#compactFn(instructionsOrOptions),
		};
	}

	#isSessionBeforeEvent(event: RunnerEmitEvent): event is SessionBeforeEvent {
		return (
			event.type === "session_before_switch" ||
			event.type === "session_before_branch" ||
			event.type === "session_before_compact" ||
			event.type === "session_before_tree"
		);
	}

	async #runHandlerWithTimeout<TEvent extends { type: string }, TResult>(
		handler: (event: TEvent, ctx: ExtensionContext) => Promise<TResult | undefined> | TResult | undefined,
		event: TEvent,
		ctx: ExtensionContext,
		ext: Extension,
		timeoutMs: number,
		messageBudget: HandlerMessageBudget = {
			count: 0,
			overflowRecorded: false,
			startedAt: performance.now(),
		},
	): Promise<TResult | undefined> {
		const startedAt = performance.now();
		const controller = new AbortController();
		const handlerContext = { ...ctx, signal: controller.signal };
		messageBudget.extensionId = ext.path;
		const scope: HandlerExecutionScope = {
			extensionId: ext.path,
			event: event.type,
			startedAt,
			messageBudget,
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const handlerPromise = Promise.resolve(
				handlerExecutionContext.run(scope, () =>
					runWithExecHandlerContext(
						{
							signal: controller.signal,
							onOutputTruncated: (stream, limitBytes) => {
								this.#recordViolation({
									kind: "output_overflow",
									extensionId: ext.path,
									sessionId: this.sessionManager.getSessionId(),
									event: event.type,
									elapsedMs: performance.now() - startedAt,
									action: "truncate_output",
									stream,
									limitBytes,
									timestamp: new Date().toISOString(),
								});
							},
						},
						() => handler(event, handlerContext),
					),
				),
			);
			const timeoutResult = new Promise<typeof EXTENSION_HANDLER_TIMEOUT>(resolve => {
				timer = setTimeout(() => resolve(EXTENSION_HANDLER_TIMEOUT), timeoutMs);
			});
			const handlerResult = await Promise.race([handlerPromise, timeoutResult]);
			if (handlerResult === EXTENSION_HANDLER_TIMEOUT) {
				const elapsedMs = performance.now() - startedAt;
				controller.abort(new Error(`Extension handler timed out after ${timeoutMs}ms`));
				const error = `handler timed out after ${timeoutMs}ms`;
				logger.warn("Extension handler timed out", {
					extensionPath: ext.path,
					event: event.type,
					timeoutMs,
				});
				this.#recordViolation({
					kind: "timeout",
					extensionId: ext.path,
					sessionId: this.sessionManager.getSessionId(),
					event: event.type,
					elapsedMs,
					action: "abort_handler_and_process_tree",
					timeoutMs,
					timestamp: new Date().toISOString(),
				});
				this.emitError({
					extensionPath: ext.path,
					event: event.type,
					error,
				});
				return undefined;
			}
			return handlerResult as TResult | undefined;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const stack = err instanceof Error ? err.stack : undefined;
			this.emitError({
				extensionPath: ext.path,
				event: event.type,
				error: message,
				stack,
			});
			return undefined;
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}

	async emit<TEvent extends RunnerEmitEvent>(event: TEvent): Promise<RunnerEmitResult<TEvent>> {
		const active = this.#inFlightEvents.get(event.type);
		if (active) {
			this.#recordViolation({
				kind: "reentrancy",
				extensionId: active.messageBudget.extensionId ?? this.extensions[0]?.path ?? "<runner>",
				sessionId: this.sessionManager.getSessionId(),
				event: event.type,
				elapsedMs: performance.now() - active.startedAt,
				action: "coalesce_with_in_flight",
				timestamp: new Date().toISOString(),
			});
			return active.promise as Promise<RunnerEmitResult<TEvent>>;
		}

		const startedAt = performance.now();
		const messageBudget: HandlerMessageBudget = {
			count: 0,
			overflowRecorded: false,
			startedAt,
		};
		const promise = Promise.resolve().then(() => this.#emitHandlers(event, messageBudget));
		this.#inFlightEvents.set(event.type, { promise, startedAt, messageBudget });
		void promise.finally(() => {
			if (this.#inFlightEvents.get(event.type)?.promise === promise) this.#inFlightEvents.delete(event.type);
		});
		return promise;
	}

	async #emitHandlers<TEvent extends RunnerEmitEvent>(
		event: TEvent,
		messageBudget: HandlerMessageBudget = {
			count: 0,
			overflowRecorded: false,
			startedAt: performance.now(),
		},
	): Promise<RunnerEmitResult<TEvent>> {
		const ctx = this.createContext();
		let result: SessionBeforeEventResult | SessionCompactingResult | undefined;

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get(event.type);
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				const handlerResult = await this.#runHandlerWithTimeout(
					handler,
					event,
					ctx,
					ext,
					handlerTimeoutForEvent(event.type),
					messageBudget,
				);

				if (this.#isSessionBeforeEvent(event) && handlerResult) {
					result = handlerResult as SessionBeforeEventResult;
					if (result.cancel) return result as RunnerEmitResult<TEvent>;
				}

				if (event.type === "session.compacting" && handlerResult) {
					result = handlerResult as SessionCompactingResult;
				}
			}
		}

		return result as RunnerEmitResult<TEvent>;
	}

	async emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined> {
		const ctx = this.createContext();
		const currentEvent: ToolResultEvent = { ...event };
		let modified = false;

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("tool_result");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				const handlerResult = (await this.#runHandlerWithTimeout(
					handler,
					currentEvent,
					ctx,
					ext,
					extensionHandlerTimeoutMs,
				)) as ToolResultEventResult | undefined;
				if (!handlerResult) continue;

				if (handlerResult.content !== undefined) {
					currentEvent.content = handlerResult.content;
					modified = true;
				}
				if (handlerResult.details !== undefined) {
					currentEvent.details = handlerResult.details;
					modified = true;
				}
				if (handlerResult.isError !== undefined) {
					currentEvent.isError = handlerResult.isError;
					modified = true;
				}
			}
		}

		if (!modified) return undefined;

		return {
			content: currentEvent.content,
			details: currentEvent.details,
			isError: currentEvent.isError,
		};
	}

	async emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
		const ctx = this.createContext();
		let result: ToolCallEventResult | undefined;

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("tool_call");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				const handlerResult = await this.#runHandlerWithTimeout(
					handler,
					event,
					ctx,
					ext,
					extensionHandlerTimeoutMs,
				);
				if (handlerResult) {
					result = handlerResult as ToolCallEventResult;
					if (result.block) return result;
				}
			}
		}

		return result;
	}

	async emitUserBash(event: UserBashEvent): Promise<UserBashEventResult | undefined> {
		return this.emitUserEvent<UserBashEventResult>(event, "user_bash");
	}

	async emitUserPython(event: UserPythonEvent): Promise<UserPythonEventResult | undefined> {
		return this.emitUserEvent<UserPythonEventResult>(event, "user_python");
	}

	private async emitUserEvent<R>(
		event: UserBashEvent | UserPythonEvent,
		eventName: "user_bash" | "user_python",
	): Promise<R | undefined> {
		const ctx = this.createContext();

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get(eventName);
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				const handlerResult = await this.#runHandlerWithTimeout(
					handler,
					event,
					ctx,
					ext,
					extensionHandlerTimeoutMs,
				);
				if (handlerResult) {
					return handlerResult as R;
				}
			}
		}

		return undefined;
	}

	async emitResourcesDiscover(
		cwd: string,
		reason: ResourcesDiscoverEvent["reason"],
	): Promise<{
		skillPaths: Array<{ path: string; extensionPath: string }>;
		promptPaths: Array<{ path: string; extensionPath: string }>;
		themePaths: Array<{ path: string; extensionPath: string }>;
	}> {
		const ctx = this.createContext();
		const skillPaths: Array<{ path: string; extensionPath: string }> = [];
		const promptPaths: Array<{ path: string; extensionPath: string }> = [];
		const themePaths: Array<{ path: string; extensionPath: string }> = [];

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("resources_discover");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				const event: ResourcesDiscoverEvent = { type: "resources_discover", cwd, reason };
				const handlerResult = await this.#runHandlerWithTimeout(
					handler,
					event,
					ctx,
					ext,
					extensionHandlerTimeoutMs,
				);
				const result = handlerResult as ResourcesDiscoverResult | undefined;

				if (result?.skillPaths?.length) {
					skillPaths.push(...result.skillPaths.map(path => ({ path, extensionPath: ext.path })));
				}
				if (result?.promptPaths?.length) {
					promptPaths.push(...result.promptPaths.map(path => ({ path, extensionPath: ext.path })));
				}
				if (result?.themePaths?.length) {
					themePaths.push(...result.themePaths.map(path => ({ path, extensionPath: ext.path })));
				}
			}
		}

		return { skillPaths, promptPaths, themePaths };
	}

	/** Emit input event. Transforms chain, "handled" short-circuits. */
	async emitInput(
		input: string | UserContent[],
		attachments: MediaContent[] | undefined,
		source: "interactive" | "rpc" | "extension",
	): Promise<InputEventResult> {
		const ctx = this.createContext();
		return runInputAttachmentAdapters({
			extensions: this.extensions,
			input,
			attachments,
			source,
			runHandler: async (extension, handlerIndex, event) =>
				(await this.#runHandlerWithTimeout(
					extension.handlers.get("input")![handlerIndex]!,
					event,
					ctx,
					extension,
					extensionHandlerTimeoutMs,
				)) as InputEventResult | undefined,
		});
	}

	async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
		const ctx = this.createContext();

		// Check if any extensions actually have context handlers before cloning
		let hasContextHandlers = false;
		for (const ext of this.extensions) {
			if (ext.handlers.get("context")?.length) {
				hasContextHandlers = true;
				break;
			}
		}
		if (!hasContextHandlers) return messages;

		let currentMessages: AgentMessage[];
		try {
			currentMessages = structuredClone(messages);
		} catch {
			// Messages may contain non-cloneable objects (e.g. in ToolResultMessage.details
			// or ProviderPayload). Fall back to a shallow array clone — extensions should
			// return new message arrays rather than mutating in place.
			currentMessages = [...messages];
		}

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("context");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				const event: ContextEvent = { type: "context", messages: currentMessages };
				const handlerResult = await this.#runHandlerWithTimeout(
					handler,
					event,
					ctx,
					ext,
					extensionHandlerTimeoutMs,
				);

				if (handlerResult && (handlerResult as ContextEventResult).messages) {
					currentMessages = (handlerResult as ContextEventResult).messages!;
				}
			}
		}

		return currentMessages;
	}

	async emitBeforeProviderRequest(payload: unknown): Promise<BeforeProviderRequestEventResult> {
		const ctx = this.createContext();
		let currentPayload = payload;

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("before_provider_request");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				const event: BeforeProviderRequestEvent = {
					type: "before_provider_request",
					payload: currentPayload,
				};
				const handlerResult = await this.#runHandlerWithTimeout(
					handler,
					event,
					ctx,
					ext,
					extensionHandlerTimeoutMs,
				);
				if (handlerResult !== undefined) {
					currentPayload = handlerResult;
				}
			}
		}

		return currentPayload;
	}

	async emitAfterProviderResponse(response: ProviderResponseMetadata, _model?: Model): Promise<void> {
		const ctx = this.createContext();

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("after_provider_response");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				const event: AfterProviderResponseEvent = {
					type: "after_provider_response",
					status: response.status,
					headers: response.headers,
					requestId: response.requestId,
					metadata: response.metadata,
				};
				await this.#runHandlerWithTimeout(handler, event, ctx, ext, extensionHandlerTimeoutMs);
			}
		}
	}

	async emitBeforeAgentStart(
		prompt: string | UserContent[],
		attachments: MediaContent[] | undefined,
		systemPrompt: string[],
	): Promise<BeforeAgentStartCombinedResult | undefined> {
		const ctx = this.createContext();
		return runBeforeAgentStartAttachmentAdapters({
			extensions: this.extensions,
			prompt,
			attachments,
			systemPrompt,
			runHandler: async (extension, handlerIndex, event) =>
				(await this.#runHandlerWithTimeout(
					extension.handlers.get("before_agent_start")![handlerIndex]!,
					event,
					ctx,
					extension,
					extensionHandlerTimeoutMs,
				)) as BeforeAgentStartEventResult | undefined,
		});
	}
}
