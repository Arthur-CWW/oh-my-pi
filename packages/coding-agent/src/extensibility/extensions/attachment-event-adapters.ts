import type { MediaContent, UserContent } from "@oh-my-pi/pi-ai";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	Extension,
	InputEvent,
	InputEventResult,
} from "./types";

export interface BeforeAgentStartCombinedResult {
	messages?: NonNullable<BeforeAgentStartEventResult["message"]>[];
	systemPrompt?: string[];
}

interface InputAdapterOptions {
	extensions: readonly Extension[];
	input: string | UserContent[];
	attachments: MediaContent[] | undefined;
	source: InputEvent["source"];
	runHandler: (
		extension: Extension,
		handlerIndex: number,
		event: InputEvent,
	) => Promise<InputEventResult | undefined>;
}

export async function runInputAttachmentAdapters({
	extensions,
	input,
	attachments,
	source,
	runHandler,
}: InputAdapterOptions): Promise<InputEventResult> {
	let currentInput = input;
	let currentAttachments = attachments;

	for (const extension of extensions) {
		for (let index = 0; index < (extension.handlers.get("input")?.length ?? 0); index++) {
			const event: InputEvent = {
				type: "input",
				input: currentInput,
				attachments: currentAttachments,
				source,
			};
			const result = await runHandler(extension, index, event);
			if (result?.handled) return result;
			if (result?.input !== undefined) currentInput = result.input;
			if (result?.attachments !== undefined) currentAttachments = result.attachments;
		}
	}

	return currentInput !== input || currentAttachments !== attachments
		? { input: currentInput, attachments: currentAttachments }
		: {};
}

interface BeforeAgentStartAdapterOptions {
	extensions: readonly Extension[];
	prompt: string | UserContent[];
	attachments: MediaContent[] | undefined;
	systemPrompt: string[];
	runHandler: (
		extension: Extension,
		handlerIndex: number,
		event: BeforeAgentStartEvent,
	) => Promise<BeforeAgentStartEventResult | undefined>;
}

export async function runBeforeAgentStartAttachmentAdapters({
	extensions,
	prompt,
	attachments,
	systemPrompt,
	runHandler,
}: BeforeAgentStartAdapterOptions): Promise<BeforeAgentStartCombinedResult | undefined> {
	const messages: NonNullable<BeforeAgentStartEventResult["message"]>[] = [];
	let currentSystemPrompt = systemPrompt;
	let systemPromptModified = false;

	for (const extension of extensions) {
		for (let index = 0; index < (extension.handlers.get("before_agent_start")?.length ?? 0); index++) {
			const result = await runHandler(extension, index, {
				type: "before_agent_start",
				prompt,
				attachments,
				systemPrompt: currentSystemPrompt,
			});
			if (result?.message) messages.push(result.message);
			if (result?.systemPrompt !== undefined) {
				systemPromptModified = true;
				currentSystemPrompt =
					typeof result.systemPrompt === "string" ? [result.systemPrompt] : result.systemPrompt;
			}
		}
	}

	if (messages.length === 0 && !systemPromptModified) return undefined;
	return {
		messages: messages.length > 0 ? messages : undefined,
		systemPrompt: systemPromptModified ? currentSystemPrompt : undefined,
	};
}
