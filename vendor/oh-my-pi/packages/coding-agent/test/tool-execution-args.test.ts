import { afterEach, describe, expect, it, vi } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { ToolExecutionComponent } from "@oh-my-pi/pi-coding-agent/modes/components/tool-execution";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { TUI } from "@oh-my-pi/pi-tui";

describe("ToolExecutionComponent.updateArgs (F8 — no clone, ref-eq fast path)", () => {
	let initialized = false;

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	async function makeComponent(args: unknown) {
		if (!initialized) {
			await initTheme();
			initialized = true;
		}
		const uiStub = { requestRender() {} } as unknown as TUI;
		return new ToolExecutionComponent("bash", args, {}, undefined, uiStub);
	}

	it("does NOT call structuredClone in updateArgs (caller already owns isolation)", async () => {
		const cloneSpy = vi.spyOn(globalThis, "structuredClone");
		const component = await makeComponent({ command: "ls" });
		cloneSpy.mockClear();

		// Simulate event-controller.ts: each delta builds a fresh spread.
		for (let i = 0; i < 5; i++) {
			component.updateArgs({ command: `ls -l ${i}` });
		}

		expect(cloneSpy).not.toHaveBeenCalled();
	});
});

describe("ToolExecutionComponent expanded args (mode-aware formatting)", () => {
	let ready = false;
	async function build(args: unknown) {
		if (!ready) {
			await initTheme();
			ready = true;
		}
		const ui = { requestRender() {}, requestComponentRender() {} } as unknown as TUI;
		return new ToolExecutionComponent("bash", args, {}, undefined, ui);
	}

	it("renders complete nested string args verbatim once expanded (custom renderer path)", async () => {
		const note = `${"n".repeat(280)}ENDMARKER`;
		const byteCount = Buffer.byteLength(note, "utf8");
		expect(byteCount).toBeGreaterThan(240);
		const component = await build({ command: "echo hi", meta: { note } });

		component.setExpanded(true);
		const expanded = stripVTControlCharacters(component.render(600).join("\n"));
		expect(expanded).toContain("meta:");
		expect(expanded).toContain(note);
		expect(expanded).toContain("ENDMARKER");
		expect(expanded).not.toContain(`<${byteCount} bytes>`);
		expect(expanded).not.toContain("…");
	});
});
