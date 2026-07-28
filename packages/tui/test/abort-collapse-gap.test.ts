import { describe, expect, it } from "bun:test";
import { type Component, CURSOR_MARKER, type Focusable, type NativeScrollbackLiveRegion, TUI } from "@oh-my-pi/pi-tui";
import { StressRenderScheduler } from "./render-stress-scheduler";
import { VirtualTerminal } from "./virtual-terminal";

// Regression for a streaming block whose committed sealed prefix collapses on
// abort while the editor is below it. The editor must stay at the viewport
// bottom instead of leaving a blank gap underneath.

class Transcript implements Component, NativeScrollbackLiveRegion {
	lines: string[] = [];
	seam = 0;
	safeEnd: number | undefined;

	invalidate(): void {}

	render(_width: number): readonly string[] {
		return this.lines;
	}

	getNativeScrollbackLiveRegionStart(): number | undefined {
		return this.seam;
	}

	getNativeScrollbackCommitSafeEnd(): number | undefined {
		return this.safeEnd;
	}
}

class Editor implements Component, Focusable {
	focused = false;
	text = "> ";

	invalidate(): void {}

	setUseTerminalCursor(): void {}

	render(_width: number): readonly string[] {
		return [this.text + CURSOR_MARKER];
	}
}

function rows(prefix: string, n: number, from = 0): string[] {
	return Array.from({ length: n }, (_, i) => `${prefix}${from + i}`);
}

describe("abort-collapse gap regression", () => {
	it("keeps the editor bottom-aligned after a committed live block collapses", async () => {
		const height = 10;
		const term = new VirtualTerminal(40, height, 1_000);
		const scheduler = new StressRenderScheduler();
		const tui = new TUI(term, true, { renderScheduler: scheduler });
		const transcript = new Transcript();
		const editor = new Editor();
		tui.addChild(transcript);
		tui.addChild(editor);
		tui.setFocus(editor);

		// 20 finalized rows + live block streaming.
		transcript.lines = [...rows("hist-", 20), ...rows("live-", 4)];
		transcript.seam = 20;
		transcript.safeEnd = 20; // nothing sealed yet

		try {
			tui.start();
			await scheduler.drain(term);

			// Stream: live block grows, sealed prefix advances behind the tail.
			for (let grow = 8; grow <= 24; grow += 4) {
				transcript.lines = [...rows("hist-", 20), ...rows("live-", grow)];
				transcript.seam = 20;
				transcript.safeEnd = 20 + grow - 2; // sealed prefix trails by 2
				tui.requestRender();
				await scheduler.drain(term);
			}

			// ABORT: the live block collapses after some of its append-only prefix
			// reached native scrollback. The viewport should pull the short tail
			// back down instead of pinning the editor near the top with blank rows
			// underneath.
			transcript.lines = [...rows("hist-", 20), "aborted!", "interrupted"];
			transcript.seam = 22;
			transcript.safeEnd = 22;
			tui.requestRender();
			await scheduler.drain(term);

			expect(term.getViewport().map(row => Bun.stripANSI(row).trimEnd())).toEqual([
				"hist-13",
				"hist-14",
				"hist-15",
				"hist-16",
				"hist-17",
				"hist-18",
				"hist-19",
				"aborted!",
				"interrupted",
				">",
			]);

			editor.text = "> a";
			tui.requestRender();
			await scheduler.drain(term);

			expect(term.getViewport().map(row => Bun.stripANSI(row).trimEnd())).toEqual([
				"hist-13",
				"hist-14",
				"hist-15",
				"hist-16",
				"hist-17",
				"hist-18",
				"hist-19",
				"aborted!",
				"interrupted",
				"> a",
			]);
		} finally {
			tui.stop();
			await term.flush();
		}
	});

	it("bottom-aligns a final response after a tool reflow without a focused editor", async () => {
		const height = 10;
		const term = new VirtualTerminal(40, height, 1_000);
		const scheduler = new StressRenderScheduler();
		const tui = new TUI(term, true, { renderScheduler: scheduler });
		const transcript = new Transcript();
		tui.addChild(transcript);

		transcript.lines = [...rows("history-", 20), ...rows("tool-output-", 24)];
		transcript.seam = 20;
		transcript.safeEnd = 42;

		try {
			tui.start();
			await scheduler.drain(term);

			// Completion collapses the tool card and appends the final reply in
			// the same frame. No cursor marker exists during this transition.
			transcript.lines = [...rows("history-", 20), "tool complete", "FINAL RESPONSE"];
			transcript.seam = 22;
			transcript.safeEnd = 22;
			tui.requestRender();
			await scheduler.drain(term);

			expect(term.getViewport().map(row => Bun.stripANSI(row).trimEnd())).toEqual([
				"history-12",
				"history-13",
				"history-14",
				"history-15",
				"history-16",
				"history-17",
				"history-18",
				"history-19",
				"tool complete",
				"FINAL RESPONSE",
			]);
		} finally {
			tui.stop();
			await term.flush();
		}
	});

	it("does not yank an intentionally scrolled reader on the same completion reflow", async () => {
		const term = new VirtualTerminal(40, 10, 1_000);
		const scheduler = new StressRenderScheduler();
		const tui = new TUI(term, true, { renderScheduler: scheduler });
		const transcript = new Transcript();
		tui.addChild(transcript);
		transcript.lines = [...rows("history-", 20), ...rows("tool-output-", 24)];
		transcript.seam = 20;
		transcript.safeEnd = 42;

		try {
			tui.start();
			await scheduler.drain(term);
			term.scrollLines(-5);
			const scrollAnchor = term.getBufferPosition().viewportY;

			transcript.lines = [...rows("history-", 20), "tool complete", "FINAL RESPONSE"];
			transcript.seam = 22;
			transcript.safeEnd = 22;
			tui.requestRender();
			await scheduler.drain(term);

			// Ordinary relative repaint bytes update the live grid, but native
			// scrollback owns follow mode and preserves a reader's viewport.
			expect(term.getBufferPosition().viewportY).toBe(scrollAnchor);
			expect(term.getScrollBuffer().map(row => Bun.stripANSI(row).trimEnd())).toContain("FINAL RESPONSE");
		} finally {
			tui.stop();
			await term.flush();
		}
	});
});
