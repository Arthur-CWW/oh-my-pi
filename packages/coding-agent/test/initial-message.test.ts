import { describe, expect, it } from "bun:test";
import type { MediaContent } from "@oh-my-pi/pi-ai";
import type { Args } from "@oh-my-pi/pi-coding-agent/cli/args";
import { buildInitialMessage } from "@oh-my-pi/pi-coding-agent/cli/initial-message";

function createArgs(messages: string[]): Args {
	return {
		messages,
		fileArgs: [],
		unknownFlags: new Map(),
		unrecognizedFlags: [],
	};
}

describe("buildInitialMessage", () => {
	it("combines stdin, file text, and the first CLI message", () => {
		const parsed = createArgs(["first", "second"]);
		const attachments: MediaContent[] = [{ type: "image", data: "abc123", mimeType: "image/png" }];

		const result = buildInitialMessage({
			parsed,
			stdinContent: "stdin",
			fileText: "file-",
			fileAttachments: attachments,
		});

		expect(result.initialMessage).toBe("stdin\nfile-first");
		expect(result.initialAttachments).toEqual(attachments);
		expect(parsed.messages).toEqual(["second"]);
	});

	it("preserves media attachments when the initial message has no text", () => {
		const parsed = createArgs([]);
		const attachments: MediaContent[] = [{ type: "video", data: "AA==", mimeType: "video/mp4" }];

		const result = buildInitialMessage({
			parsed,
			fileAttachments: attachments,
		});

		expect(result.initialMessage).toBe("");
		expect(result.initialAttachments).toEqual(attachments);
		expect(parsed.messages).toEqual([]);
	});

	it("leaves plain CLI messages untouched when there is no initial file or stdin input", () => {
		const parsed = createArgs(["first", "second"]);

		const result = buildInitialMessage({ parsed });

		expect(result.initialMessage).toBeUndefined();
		expect(result.initialAttachments).toBeUndefined();
		expect(parsed.messages).toEqual(["first", "second"]);
	});
});
