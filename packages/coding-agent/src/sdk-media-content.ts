import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { ImageContent, Message, TextContent, UserContent } from "@oh-my-pi/pi-ai";

const BLOCKED_IMAGE_NOTICE = "Image reading is disabled.";
const BLOCKED_IMAGE_CONTENT: TextContent = { type: "text", text: BLOCKED_IMAGE_NOTICE };

type ToolResultContent = TextContent | ImageContent;
type MessageConverter = (messages: AgentMessage[]) => Message[];

function isToolResultContent(content: UserContent): content is ToolResultContent {
	return content.type === "text" || content.type === "image";
}

function isBlockedImageNotice(content: UserContent | undefined): content is TextContent {
	return content?.type === "text" && content.text === BLOCKED_IMAGE_NOTICE;
}

function replaceBlockedUserImages(content: readonly UserContent[]): UserContent[] {
	const filtered: UserContent[] = [];
	for (const block of content) {
		const replacement = block.type === "image" ? BLOCKED_IMAGE_CONTENT : block;
		if (isBlockedImageNotice(replacement) && isBlockedImageNotice(filtered.at(-1))) continue;
		filtered.push(replacement);
	}
	return filtered;
}

function replaceBlockedToolResultImages(content: readonly UserContent[]): TextContent[] {
	const filtered: TextContent[] = [];
	for (const block of content) {
		if (!isToolResultContent(block)) continue;
		const replacement = block.type === "image" ? BLOCKED_IMAGE_CONTENT : block;
		if (isBlockedImageNotice(replacement) && isBlockedImageNotice(filtered.at(-1))) continue;
		filtered.push(replacement);
	}
	return filtered;
}

/** Preserve text-only tool result content when image delivery is disabled. */
export function createBlockedMediaConverter(
	convertMessages: MessageConverter,
	shouldBlockImages: () => boolean,
): MessageConverter {
	return messages => {
		const converted = convertMessages(messages);
		if (!shouldBlockImages()) return converted;

		return converted.map(message => {
			if (message.role === "user" && Array.isArray(message.content)) {
				if (!message.content.some(block => block.type === "image")) return message;
				return { ...message, content: replaceBlockedUserImages(message.content) };
			}
			if (message.role === "toolResult") {
				const content: readonly UserContent[] = message.content;
				if (content.some(block => block.type === "image" || block.type === "video")) {
					return { ...message, content: replaceBlockedToolResultImages(content) };
				}
			}
			return message;
		});
	};
}
