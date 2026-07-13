import { describe, expect, it } from "bun:test";
import { type Component, type NativeScrollbackLiveRegion, TUI } from "@oh-my-pi/pi-tui";
import { StressRenderScheduler } from "./render-stress-scheduler";
import { VirtualTerminal } from "./virtual-terminal";

class Block implements Component {
  #lines: string[];
  constructor(lines: string[]) { this.#lines = lines; }
  set(lines: string[]): void { this.#lines = lines; }
  invalidate(): void {}
  render(_width: number): readonly string[] { return this.#lines; }
}
class Transcript implements Component, NativeScrollbackLiveRegion {
  lines: string[] = [];
  seam = 0;
  invalidate(): void {}
  render(_width: number): readonly string[] { return this.lines; }
  getNativeScrollbackLiveRegionStart(): number | undefined { return this.seam; }
  getNativeScrollbackCommitSafeEnd(): number | undefined { return this.seam; }
}
function rows(prefix: string, n: number, from = 0): string[] { return Array.from({length:n}, (_, i) => `${prefix}${from+i}`); }
function view(term: VirtualTerminal): string[] { return term.getViewport().map(r => Bun.stripANSI(r).trimEnd()); }
function expectVisibleInOrder(actual: readonly string[], expected: readonly string[]): void {
  let next = 0;
  for (const line of actual) {
    if (line === expected[next]) next++;
  }
  expect(next).toBe(expected.length);
}

describe("semantic scroll repro", () => {
  it("keeps final tail after two historical reflows and progress append", async () => {
    const term = new VirtualTerminal(40, 10, 10_000);
    const scheduler = new StressRenderScheduler();
    const tui = new TUI(term, true, {renderScheduler:scheduler});
    const transcript = new Transcript();
    tui.addChild(transcript);
    const drain = async () => { tui.requestRender(); await scheduler.drain(term); };
    transcript.lines = [...rows("history-", 20), ...rows("tool-", 24)]; transcript.seam = 20;
    try {
      tui.start(); await scheduler.drain(term);
      transcript.lines = [...rows("history-", 20), "tool-final"];
      transcript.seam = 21; await drain();
      transcript.lines = [...rows("history-", 20), "tool-final", "Assessing job completion..."]; transcript.seam = 22; await drain();
      transcript.lines = [...rows("history-", 20), "tool-final", "Assessing job completion...", "Planning follow-up..."]; transcript.seam = 22; await drain();
      transcript.lines = [...rows("history-", 20), "tool-final", "Assessing job completion...", "Planning follow-up...", "IRC result"]; transcript.seam = 22; await drain();
      transcript.lines = [...rows("history-", 20), "tool-final", "Assessing job completion...", "Planning follow-up...", "IRC result", "Returned to main session"]; transcript.seam = 22; await drain();
      transcript.lines = [...rows("history-", 20), "tool-final", "Assessing job completion...", "Planning follow-up...", "IRC result", "Returned to main session", "FINAL RESPONSE"]; transcript.seam = 22; await drain();
      const visible = view(term);
      expectVisibleInOrder(visible, [
        "Assessing job completion...",
        "Planning follow-up...",
        "IRC result",
        "Returned to main session",
        "FINAL RESPONSE",
      ]);
      expect(visible.filter(line => line.length > 0).at(-1)).toBe("FINAL RESPONSE");
    } finally { tui.stop(); }
  });
  it("does not reuse a stale historical root during component-scoped progress", async () => {
    const term = new VirtualTerminal(40, 8, 10_000);
    const scheduler = new StressRenderScheduler();
    const tui = new TUI(term, true, { renderScheduler: scheduler });
    const history = new Block(rows("history-", 20));
    const tool = new Block(rows("tool-", 12));
    const progress = new Block(["progress-0"]);
    const final = new Block(["final"]);
    tui.addChild(history);
    tui.addChild(tool);
    tui.addChild(progress);
    tui.addChild(final);
    try {
      tui.start();
      await scheduler.drain(term);
      tool.set(["tool-final"]);
      progress.set(["Assessing job completion...", "Planning follow-up..."]);
      // Tool finalization owns the tool root and must invalidate it before the
      // component-scoped progress update; production callbacks do both.
      tui.requestComponentRender(tool);
      tui.requestComponentRender(progress);
      await scheduler.drain(term);
      final.set(["IRC result", "Returned to main session", "FINAL RESPONSE"]);
      tui.requestComponentRender(final);
      await scheduler.drain(term);
      const visible = view(term);
      expectVisibleInOrder(visible, [
        "tool-final",
        "Assessing job completion...",
        "Planning follow-up...",
        "IRC result",
        "Returned to main session",
        "FINAL RESPONSE",
      ]);
      expect(visible.filter(line => line.length > 0).at(-1)).toBe("FINAL RESPONSE");
    } finally {
      tui.stop();
    }
  });
});
