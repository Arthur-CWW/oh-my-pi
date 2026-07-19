import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { CompactionCancelledError, type CompactionResult } from "@oh-my-pi/pi-agent-core/compaction";
import { CommandController } from "@oh-my-pi/pi-coding-agent/modes/controllers/command-controller";
import { getThemeByName, setThemeInstance, type Theme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { Container, Spacer } from "@oh-my-pi/pi-tui";
import { withControllerFixture } from "./helpers/controller-fixture";

/**
 * Contract under test: `CommandController.executeCompaction` must not leak
 * transient UI across either terminal state.
 *
 *  - A cancelled compaction (session.compact rejects with the real
 *    CompactionCancelledError the code branches on) must leave the chat
 *    transcript byte-for-byte as it was — no orphan Spacer pushed into
 *    chatContainer — and must drain the status container's loader.
 *  - A successful compaction must drain the status container's loader once it
 *    resolves.
 *
 * Exercised only through the public `executeCompaction` entrypoint with real
 * in-memory Container instances and a session stub whose `compact()` outcome we
 * drive.
 */
function buildCtx(compact: InteractiveModeContext["session"]["compact"]) {
	const chatContainer = new Container();
	const statusContainer = new Container();
	// Pre-existing transcript content. The regression we defend leaked an extra
	// Spacer into this container on the cancel path, so we seed it with real
	// children and require the count to survive the call untouched.
	chatContainer.addChild(new Spacer(1));
	chatContainer.addChild(new Spacer(1));

	// Record the status container's state at the instant the transcript rebuild
	// runs, so a test can prove cleanup happens BEFORE the rebuild (the fix) and
	// not merely in the finally that runs after it.
	let statusChildrenAtRebuild: number | undefined;
	const rebuildChatFromMessages = vi.fn(() => {
		statusChildrenAtRebuild = statusContainer.children.length;
	});
	const showError = vi.fn();
	const ctx = {
		loadingAnimation: undefined,
		chatContainer,
		statusContainer,
		ui: { requestRender: vi.fn(), requestComponentRender: vi.fn() },
		session: { compact },
		rebuildChatFromMessages,
		statusLine: { invalidate: vi.fn() },
		updateEditorTopBorder: vi.fn(),
		showError,
		flushCompactionQueue: vi.fn(async () => undefined),
	} as unknown as InteractiveModeContext;

	return {
		ctx,
		chatContainer,
		statusContainer,
		rebuildChatFromMessages,
		showError,
		statusAtRebuild: () => statusChildrenAtRebuild,
	};
}

describe("executeCompaction UI lifecycle", () => {
	let priorTheme: Theme | undefined;

	beforeAll(async () => {
		// The compacting Loader colorizes through the active theme on construction.
		// Capture the prior global theme first so afterAll can restore it and not
		// couple later suites sharing this process to our dark override.
		priorTheme = theme;
		const dark = await getThemeByName("dark");
		if (!dark) throw new Error("Expected dark theme");
		setThemeInstance(dark);
	});

	afterAll(() => {
		if (priorTheme) setThemeInstance(priorTheme);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("leaves the transcript untouched and drains the loader when compaction is cancelled", async () => {
		await withControllerFixture(async fixture => {
			const compact = vi.fn(async () => {
				throw new CompactionCancelledError();
			});
			const { ctx, chatContainer, statusContainer, rebuildChatFromMessages, showError } = buildCtx(compact);
			const childrenBefore = chatContainer.children.length;

			const controller = new CommandController(ctx, fixture.getInputLeaseManager, fixture.scope);
			const outcome = await controller.executeCompaction();

			expect(outcome).toBe("cancelled");
			expect(chatContainer.children).toHaveLength(childrenBefore);
			expect(statusContainer.children).toHaveLength(0);
			expect(showError).toHaveBeenCalledWith("Compaction cancelled");
			expect(rebuildChatFromMessages).not.toHaveBeenCalled();
		});
	});

	it("drains the loader after a successful compaction resolves", async () => {
		await withControllerFixture(async fixture => {
			const compact = vi.fn(
				async (): Promise<CompactionResult<unknown>> => ({ summary: "", firstKeptEntryId: "", tokensBefore: 0 }),
			);
			const { ctx, statusContainer, rebuildChatFromMessages, statusAtRebuild } = buildCtx(compact);

			const controller = new CommandController(ctx, fixture.getInputLeaseManager, fixture.scope);
			const outcome = await controller.executeCompaction();

			expect(outcome).toBe("ok");
			expect(statusContainer.children).toHaveLength(0);
			expect(rebuildChatFromMessages).toHaveBeenCalledTimes(1);
			expect(statusAtRebuild()).toBe(0);
		});
	});
});
