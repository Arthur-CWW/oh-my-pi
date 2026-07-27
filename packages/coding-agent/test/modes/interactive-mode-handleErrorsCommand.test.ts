import { describe, expect, mock, test } from "bun:test";
import { ErrorInbox } from "../../src/modes/utils/error-inbox";
import { InteractiveMode } from "../../src/modes/interactive-mode";

function makeContext() {
	const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
	const inbox = new ErrorInbox({ appendCustomEntry });
	const statusMessages: string[] = [];
	return {
		inbox,
		appendCustomEntry,
		statusMessages,
		ctx: {
			errorInbox: inbox,
			showStatus: (message: string) => statusMessages.push(message),
		} as unknown as InteractiveMode,
	};
}

describe("InteractiveMode.handleErrorsCommand", () => {
	test(":errors clear empties the ledger and reports status", () => {
		const { inbox, ctx, statusMessages } = makeContext();
		inbox.recordError("msg", "src", { nowMs: 1000 });

		InteractiveMode.prototype.handleErrorsCommand.call(ctx, "clear");

		expect(inbox.getErrors().length).toBe(0);
		expect(statusMessages).toContain("Error history cleared.");
	});

	test(":errors clear with extra args shows usage", () => {
		const { ctx, statusMessages } = makeContext();
		InteractiveMode.prototype.handleErrorsCommand.call(ctx, "clear extra");
		expect(statusMessages[0]).toContain("Usage: :errors clear");
	});

	test(":errors resolve <id> resolves the matching error", () => {
		const { inbox, ctx, statusMessages } = makeContext();
		inbox.recordError("msg", "src", { nowMs: 1000, id: "ERR-1" });

		InteractiveMode.prototype.handleErrorsCommand.call(ctx, "resolve ERR-1");

		expect(inbox.getErrors()[0].resolved).toBe(true);
		expect(inbox.getErrors()[0].unread).toBe(false);
		expect(inbox.getErrors()[0].lastTimestamp).toBe(1000);
		expect(statusMessages).toContain("Error ERR-1 resolved.");
	});

	test(":errors resolve preserves case-sensitive ids", () => {
		const { inbox, ctx, statusMessages } = makeContext();
		inbox.recordError("msg", "src", { nowMs: 1000, id: "MixedCase-ID" });

		InteractiveMode.prototype.handleErrorsCommand.call(ctx, "resolve MixedCase-ID");

		expect(inbox.getErrors()[0].resolved).toBe(true);
		expect(statusMessages).toContain("Error MixedCase-ID resolved.");
	});

	test(":errors resolve with extra tokens shows usage", () => {
		const { ctx, statusMessages } = makeContext();
		InteractiveMode.prototype.handleErrorsCommand.call(ctx, "resolve id extra");
		expect(statusMessages[0]).toContain("Usage: :errors resolve <id>");
	});

	test(":errors resolve with unknown id reports not found", () => {
		const { ctx, statusMessages } = makeContext();
		InteractiveMode.prototype.handleErrorsCommand.call(ctx, "resolve missing");
		expect(statusMessages[0]).toContain('No error with id "missing"');
	});

	test("bare :errors resolve shows usage", () => {
		const { ctx, statusMessages } = makeContext();
		InteractiveMode.prototype.handleErrorsCommand.call(ctx, "resolve");
		expect(statusMessages[0]).toContain("Usage: :errors resolve <id>");
	});

	test("unknown verb shows usage", () => {
		const { ctx, statusMessages } = makeContext();
		InteractiveMode.prototype.handleErrorsCommand.call(ctx, "nope");
		expect(statusMessages[0]).toContain("Usage: :errors [clear | resolve <id>]");
	});
});
