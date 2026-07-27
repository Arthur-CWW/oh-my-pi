import { EventLoopKeepalive } from "@oh-my-pi/pi-agent-core";
import type { MediaContent } from "@oh-my-pi/pi-ai";
import { logger } from "@oh-my-pi/pi-utils";
import type { InteractiveMode } from "../modes/interactive-mode";
import type { AgentSession } from "../session/agent-session";
import type { Args } from "./args";
import { processFileArguments } from "./file-processor";
import { buildInitialMessage, type InitialMessageResult } from "./initial-message";

export async function prepareInitialInput(
	parsed: Args,
	stdinContent: string | undefined,
	autoResizeImages: boolean,
): Promise<InitialMessageResult> {
	const processedFiles =
		parsed.fileArgs.length > 0
			? await logger.time("processFileArguments", () =>
					processFileArguments(parsed.fileArgs, { autoResizeImages }),
				)
			: undefined;
	return buildInitialMessage({
		parsed,
		fileText: processedFiles?.text,
		fileAttachments: processedFiles?.attachments,
		stdinContent,
	});
}

export async function submitInitialPrompts(
	mode: InteractiveMode,
	session: AgentSession,
	initialMessages: readonly string[],
	initialMessage?: string,
	initialAttachments?: MediaContent[],
): Promise<void> {
	if (initialMessage !== undefined) {
		try {
			using _keepalive = new EventLoopKeepalive();
			await session.prompt(initialMessage, { attachments: initialAttachments });
		} catch (error) {
			mode.showError(error instanceof Error ? error.message : "Unknown error occurred");
		}
	}

	for (const message of initialMessages) {
		try {
			using _keepalive = new EventLoopKeepalive();
			await session.prompt(message);
		} catch (error) {
			mode.showError(error instanceof Error ? error.message : "Unknown error occurred");
		}
	}
}
