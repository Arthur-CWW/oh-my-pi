import type { ImageContent } from "@oh-my-pi/pi-ai";
import type { ExtensionUIContext } from "../extensibility/extensions";
import type { MCPManager } from "../mcp";
import type { AgentSession } from "../session/agent-session";
import type { LspStartupServerInfo } from "../tools";
import type { EventBus } from "../utils/event-bus";
import type { DisposableTerminalViewFactory } from "./disposable-terminal-host";
import { InteractiveMode } from "./interactive-mode";
import type { InteractiveModeInitOptions } from "./types";

export interface RichDisposableTerminalViewOptions {
	readonly session: AgentSession;
	readonly version: string;
	readonly changelogMarkdown?: string;
	readonly setToolUIContext?: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
	readonly lspServers?: LspStartupServerInfo[];
	readonly mcpManager?: MCPManager;
	readonly eventBus?: EventBus;
	readonly titleSystemPrompt?: string;
	readonly init?: InteractiveModeInitOptions;
	/** Runs after the full view is initialized, for startup notices and initial input. */
	readonly afterInit?: (mode: InteractiveMode) => Promise<void>;
	/** Complete rich startup and input loop. The host starts it as view-owned work. */
	readonly runMode?: (mode: InteractiveMode) => Promise<void>;
}

/**
 * Adapt the complete InteractiveMode composition to the disposable host lifetime.
 * The runner owns the session; reload retirement therefore stops only terminal-
 * local resources and never disposes the AgentSession.
 */
export function createRichDisposableTerminalViewFactory(
	options: RichDisposableTerminalViewOptions,
): DisposableTerminalViewFactory {
	return (_controller, callbacks) => {
		const mode = new InteractiveMode(
			options.session,
			options.version,
			options.changelogMarkdown,
			options.setToolUIContext,
			options.lspServers,
			options.mcpManager,
			options.eventBus,
			options.titleSystemPrompt,
			{
				requestHostReload: callbacks.requestReload,
			},
		);
		let stopped = false;
		const stopView = () => {
			if (stopped) return;
			stopped = true;
			mode.stop();
		};
		return {
			run: async () => {
				callbacks.assertCurrentEpoch();
				if (options.runMode) {
					void options.runMode(mode).catch(error => {
						if (callbacks.isCurrentEpoch()) void callbacks.requestStop().catch(() => undefined);
						else void error;
					});
					return;
				}
				await mode.init(options.init);
				await options.afterInit?.(mode);
			},
			quiesce: async () => stopView(),
			dispose: async () => stopView(),
		};
	};
}

/** Initial prompt payload retained here for factory callers without importing controller internals. */
export interface RichInitialInput {
	readonly text?: string;
	readonly images?: readonly ImageContent[];
}
