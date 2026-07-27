import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { EvalStatusEvent, EvalToolDetails } from "@oh-my-pi/pi-coding-agent/eval/types";
import { getThemeByName, setThemeInstance, type Theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { evalToolRenderer } from "@oh-my-pi/pi-coding-agent/tools/eval";

/**
 * Defends the contract that `agent()` calls inside an eval cell surface as a
 * live, Task-tool-style progress tree drawn *below* the notebook (code cell
 * box) — not buried inside the box's collapsed "Status" list, and not deferred
 * to the final result.
 */
describe("eval renderer: agent() progress below the cell box", () => {
	let theme: Theme;

	beforeAll(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true, cwd: process.cwd() });
		theme = (await getThemeByName("dark"))!;
		expect(theme).toBeDefined();
		setThemeInstance(theme);
	});

	afterAll(() => {
		resetSettingsForTest();
	});

	function render(statusEvents: EvalStatusEvent[], status: "running" | "complete" = "running"): string[] {
		const details: EvalToolDetails = {
			language: "python",
			languages: ["python"],
			cells: [
				{
					index: 0,
					title: "Investigate",
					code: "results = parallel([...])",
					language: "python",
					output: "",
					status,
					statusEvents,
				},
			],
		};
		const component = evalToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details },
			{ expanded: false, isPartial: status === "running", spinnerFrame: 0 },
			theme,
		);
		return Bun.stripANSI(component.render(120).join("\n")).split("\n");
	}

	it("draws a running subagent below the box with its current tool and intent", () => {
		const event: EvalStatusEvent = {
			op: "agent",
			id: "0-Scout",
			agent: "task",
			status: "running",
			currentTool: "read",
			currentToolArgs: "config.ts",
			lastIntent: "Reading config",
			taskPreview: "investigate the bug",
			toolCount: 4,
			contextTokens: 5000,
			contextWindow: 200000,
			cost: 0.03,
			durationMs: 800,
			model: "p/model",
		};

		const lines = render([event]);
		const joined = lines.join("\n");
		// The running subagent renders with its id, current tool, and intent.
		expect(joined).toContain("0-Scout");
		expect(joined).toContain("read");
		expect(joined).toContain("Reading config");
		// The current-tool row is indented beneath the subagent id row.
		const idLine = lines.findIndex(line => line.includes("0-Scout"));
		expect(idLine).toBeGreaterThanOrEqual(0);
		expect(lines.slice(idLine).some(line => /^\s{2,}.*read/.test(line))).toBe(true);
	});

	it("keeps full stats on a completed subagent below the box", () => {
		const event: EvalStatusEvent = {
			op: "agent",
			id: "0-Scout",
			agent: "task",
			status: "completed",
			toolCount: 7,
			contextTokens: 8000,
			contextWindow: 200000,
			cost: 0.06,
			durationMs: 1500,
			model: "p/model",
		};

		const lines = render([event], "complete");
		const joined = lines.join("\n");
		expect(joined).toContain("0-Scout");
		// Cost stat survives the completed snapshot.
		expect(joined).toContain("$0.06");
	});

	it("renders one line per subagent for a parallel fan-out", () => {
		const events: EvalStatusEvent[] = [
			{ op: "agent", id: "0-Alpha", agent: "task", status: "running", lastIntent: "scanning" },
			{ op: "agent", id: "1-Beta", agent: "task", status: "completed", toolCount: 3, durationMs: 900 },
			{ op: "agent", id: "2-Gamma", agent: "task", status: "running", currentTool: "search" },
		];

		const joined = render(events).join("\n");
		expect(joined).toContain("0-Alpha");
		expect(joined).toContain("1-Beta");
		expect(joined).toContain("2-Gamma");
	});

	it("still folds non-agent status events into the box Status section", () => {
		const events: EvalStatusEvent[] = [
			{ op: "read", path: "/tmp/file.ts", chars: 1200 },
			{ op: "agent", id: "0-Scout", agent: "task", status: "running", lastIntent: "thinking" },
		];

		const lines = render(events);
		const joined = lines.join("\n");
		// Discrete ops fold under the cell's "Status" section; agent progress
		// renders after it, never inside it.
		const statusIdx = lines.findIndex(line => line.trim() === "Status");
		const readIdx = lines.findIndex(line => line.includes("file.ts"));
		const scoutIdx = lines.findIndex(line => line.includes("0-Scout"));
		expect(statusIdx).toBeGreaterThanOrEqual(0);
		expect(readIdx).toBeGreaterThan(statusIdx);
		expect(scoutIdx).toBeGreaterThan(readIdx);
		expect(joined).toContain("read");
	});
});
