import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { ImageContent, MediaContent } from "@oh-my-pi/pi-ai";
import type { SubmittedUserInput } from "./types";

export interface PendingSubmissionInput {
	text: string;
	attachments?: MediaContent[];
	imageLinks?: (string | undefined)[];
	customType?: string;
	display?: boolean;
	streamingBehavior?: "steer" | "followUp";
}

interface SubmittedInputEditor {
	imageLinks?: readonly (string | undefined)[];
	setText(text: string): void;
}

export interface SubmittedInputRestoreHost {
	pendingImages: ImageContent[];
	pendingImageLinks: (string | undefined)[];
	editor: SubmittedInputEditor;
	rebuildChatFromMessages(): void;
}

export function createPendingSubmission(input: PendingSubmissionInput): SubmittedUserInput {
	return {
		submissionId: randomUUID(),
		text: input.text,
		attachments: input.attachments,
		imageLinks: input.imageLinks,
		customType: input.customType,
		display: input.display,
		streamingBehavior: input.streamingBehavior,
		cancelled: false,
		started: false,
	};
}

export function countSubmissionImages(submission: SubmittedUserInput): number {
	let count = 0;
	for (const attachment of submission.attachments ?? []) {
		if (attachment.type === "image") count++;
	}
	return count;
}

export function createSubmissionUserMessage(submission: SubmittedUserInput): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text: submission.text }, ...(submission.attachments ?? [])],
		attribution: "user",
		timestamp: Date.now(),
	};
}

/** Restore the editor-compatible portion of a cancelled or rejected submission. */
export function restoreSubmittedInput(host: SubmittedInputRestoreHost, submission: SubmittedUserInput): boolean {
	const imageAttachments =
		submission.attachments?.filter((attachment): attachment is ImageContent => attachment.type === "image") ?? [];
	host.pendingImages = imageAttachments;
	host.pendingImageLinks = submission.imageLinks ? [...submission.imageLinks] : imageAttachments.map(() => undefined);
	host.editor.imageLinks = host.pendingImageLinks;
	host.rebuildChatFromMessages();
	host.editor.setText(submission.text);
	return submission.attachments?.some(attachment => attachment.type === "video") ?? false;
}

export function recordLocalSubmission(
	signatures: Set<string>,
	isKnownSlashCommand: boolean,
	text: string,
	imageCount: number,
): () => void {
	if (isKnownSlashCommand) return () => {};
	const signature = `${text}\u0000${imageCount}`;
	signatures.add(signature);
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		signatures.delete(signature);
	};
}

export async function runWithLocalSubmission<T>(dispose: () => void, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		dispose();
		throw error;
	}
}
