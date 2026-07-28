import type { MediaContent } from "@oh-my-pi/pi-ai";
import type { Args } from "./args";

export interface InitialMessageInput {
	parsed: Args;
	fileText?: string;
	fileAttachments?: MediaContent[];
	stdinContent?: string;
}

export interface InitialMessageResult {
	initialMessage?: string;
	initialAttachments?: MediaContent[];
}

/**
 * Combine stdin content, @file text, and the first CLI message into a single
 * initial prompt for non-interactive mode.
 */
export function buildInitialMessage({
	parsed,
	fileText,
	fileAttachments,
	stdinContent,
}: InitialMessageInput): InitialMessageResult {
	const hasInitialContext = stdinContent !== undefined || fileText !== undefined || (fileAttachments?.length ?? 0) > 0;
	if (!hasInitialContext) {
		return {
			initialAttachments: undefined,
		};
	}

	let body = "";
	if (fileText !== undefined) {
		body += fileText;
	}

	if (parsed.messages.length > 0) {
		body += parsed.messages[0];
		parsed.messages.shift();
	}

	const initialMessage =
		stdinContent !== undefined
			? body.length > 0
				? `${stdinContent}\n${body}`
				: stdinContent
			: body.length > 0
				? body
				: fileAttachments && fileAttachments.length > 0
					? ""
					: undefined;

	return {
		initialMessage,
		initialAttachments: fileAttachments && fileAttachments.length > 0 ? fileAttachments : undefined,
	};
}
