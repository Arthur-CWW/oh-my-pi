import { beforeAll, describe, expect, test } from "bun:test";
import { CommandController } from "@oh-my-pi/pi-coding-agent/modes/controllers/command-controller";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { Container } from "@oh-my-pi/pi-tui";

beforeAll(() => {
	initTheme();
});

/**
 * The controller owns compaction UI only. InputController has already sent
 * durable user input to AgentSession before this path begins, so completion
 * must neither replay nor mutate that input.
 */
function buildCtx(compact: InteractiveModeContext["session"]["compact"]) {
	const statusContainer = new Container();
	const dispatched: string[] = [];
	const capturedInputs = [
		{
			text: "address review feedback",
			delivery: "steer",
			images: ["review.png"],
		},
	];
	const capturedInput = capturedInputs[0];
	const ctx = {
		loadingAnimation: undefined,
		statusContainer,
		ui: { requestRender: () => {}, requestComponentRender: () => {} },
		session: {
			compact,
			sendUserMessage: async (text: string) => {
				dispatched.push(text);
			},
		},
		rebuildChatFromMessages: () => {},
		statusLine: { invalidate: () => {} },
		updateEditorTopBorder: () => {},
		showError: () => {},
	} as unknown as InteractiveModeContext;

	return { ctx, capturedInputs, capturedInput, dispatched };
}

describe("issue #825: compaction input ownership", () => {
	test("completion leaves AgentSession-captured input untouched without a UI dispatch", async () => {
		const compact: InteractiveModeContext["session"]["compact"] = async () => ({
			summary: "",
			firstKeptEntryId: "",
			tokensBefore: 0,
		});
		const { ctx, capturedInputs, capturedInput, dispatched } = buildCtx(compact);

		const outcome = await new CommandController(ctx).executeCompaction();

		expect(outcome).toBe("ok");
		expect(dispatched).toEqual([]);
		expect(capturedInputs).toEqual([{ text: "address review feedback", delivery: "steer", images: ["review.png"] }]);
		expect(capturedInputs).toHaveLength(1);
		expect(capturedInputs[0]).toBe(capturedInput);
	});

	test("runs admission callbacks before releasing admission and returning", async () => {
		const events: string[] = [];
		const compact: InteractiveModeContext["session"]["compact"] = async (_instructions, options) => {
			events.push("compact");
			await options?.beforeAdmission?.({
				outcome: "ok",
				result: { summary: "", firstKeptEntryId: "", tokensBefore: 0 },
			});
			events.push("admission released");
			return { summary: "", firstKeptEntryId: "", tokensBefore: 0 };
		};
		const { ctx } = buildCtx(compact);
		const controller = new CommandController(ctx);

		const outcome = await controller.executeCompaction(
			{
				beforeAdmission: () => {
					events.push("session before admission");
				},
			},
			false,
			() => {
				events.push("controller completion");
			},
		);
		events.push("returned");

		expect(outcome).toBe("ok");
		expect(events).toEqual([
			"compact",
			"session before admission",
			"controller completion",
			"admission released",
			"returned",
		]);
	});

	test("does not reclassify successful compaction when admission callback throws", async () => {
		const outcomes: string[] = [];
		const compact: InteractiveModeContext["session"]["compact"] = async (_instructions, options) => {
			const result = { summary: "", firstKeptEntryId: "", tokensBefore: 0 };
			try {
				await options?.beforeAdmission?.({ outcome: "ok", result });
			} catch {
				// AgentSession isolates callback failures after committing compaction.
			}
			return result;
		};
		const { ctx } = buildCtx(compact);

		const outcome = await new CommandController(ctx).executeCompaction({
			beforeAdmission: ({ outcome }) => {
				outcomes.push(outcome);
				throw new Error("admission callback failed");
			},
		});

		expect(outcome).toBe("ok");
		expect(outcomes).toEqual(["ok"]);
	});
});
