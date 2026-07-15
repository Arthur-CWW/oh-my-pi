import { beforeAll, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import {
	composeToolHeadline,
	formatToolArgsLines,
	phaseStatus,
	ToolHeadlineMemo,
} from "@oh-my-pi/pi-coding-agent/tools/tool-headline";
import { ToolExecutionComponent } from "@oh-my-pi/pi-coding-agent/modes/components/tool-execution";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { TUI } from "@oh-my-pi/pi-tui";

describe("semantic tool-call headlines", () => {
	it.each([
		["bash", { _i: "Checking focused tests", command: "bun test test/tool.test.ts", cwd: "/tmp/work" }, "Checking focused tests · bun · cwd /tmp/work · ok"],
		["read", { _i: "Reading renderer section", path: "src/render.ts", offset: 40, limit: 20 }, "Reading renderer section · src/render.ts:40-59 · ok"],
		["task", { _i: "Spawning parser review", tasks: [{ id: "ParserReview", role: "Parser specialist", model: "slow" }] }, "Spawning parser review · ParserReview · Parser specialist · slow · ok"],
		["mcp__node_repl_js", { _i: "Inspecting package metadata", title: "Read package manifest", code: "throw new Error('not headline')" }, "Inspecting package metadata · Read package manifest · ok"],
		["browser", { _i: "Opening documentation", action: "open", url: "https://example.test/docs" }, "Opening documentation · open · https://example.test/docs · ok"],
		["edit", { _i: "Updating renderer import", path: "src/render.ts" }, "Updating renderer import · src/render.ts · ok"],
		["write", { _i: "Writing fixture output", path: "test/fixture.txt" }, "Writing fixture output · test/fixture.txt · ok"],
		["mcp__fetch_fetch", { _i: "Fetching API reference", url: "https://example.test/api" }, "Fetching API reference · https://example.test/api · ok"],
		["search", { _i: "Finding status handlers", pattern: "phaseStatus", paths: ["src"] }, "Finding status handlers · phaseStatus · src · ok"],
		["find", { _i: "Locating renderer files", paths: ["src/**/*.ts"] }, "Locating renderer files · src/**/*.ts · ok"],
		["irc", { _i: "Asking renderer owner", op: "send", to: "RichToggleFix", message: "Which files are in flight?" }, "Asking renderer owner · send · to RichToggleFix · Which files are in flight? · ok"],
	] as const)("composes a %s headline", (toolName, args, expected) => {
		expect(composeToolHeadline(toolName, args, "ok")).toBe(expected);
	});

	it("uses the first non-import JS line when title is absent and never leaks raw args", () => {
		const headline = composeToolHeadline(
			"mcp__node_repl_js",
			{ code: `\nvar fs = (await ${"import("}\"node:fs\"));\nconst count = fs.readdirSync(\".\").length;` },
			"running",
		);
		expect(headline).toContain("const count = fs.readdirSync");
		expect(headline).not.toContain('code="');
		expect(headline).not.toContain("var fs");
	});

	it("maps the uniform row vocabulary to canonical glyph states", () => {
		expect(["pending", "running", "ok", "error", "interrupted"].map(phase => phaseStatus(phase as never))).toEqual([
			"pending",
			"running",
			"success",
			"error",
			"aborted",
		]);
	});

	it("memoizes a headline until args, phase, or result state changes", () => {
		const memo = new ToolHeadlineMemo();
		const args = { title: "Run analysis" };
		let compositions = 0;
		const build = () => {
			compositions++;
			return "headline";
		};
		expect(memo.get("mcp__node_repl_js", args, "pending", 0, build)).toBe("headline");
		memo.get("mcp__node_repl_js", args, "pending", 0, build);
		expect(compositions).toBe(1);
		memo.get("mcp__node_repl_js", args, "running", 0, build);
		memo.get("mcp__node_repl_js", args, "running", 1, build);
		memo.get("mcp__node_repl_js", { ...args }, "running", 1, build);
		expect(compositions).toBe(4);
	});

	it("pretty-prints expanded arguments as labels and elides long strings with byte counts", () => {
		const lines = formatToolArgsLines({ title: "Evaluate", code: "x".repeat(300), nested: { value: 3 } });
		expect(lines).toContain("title: Evaluate");
		expect(lines.join("\n")).toContain("<300 bytes>");
		expect(lines).toContain("nested:");
		expect(lines).toContain("  value: 3");
		expect(lines.join("\n")).not.toContain('{"');
	});
});

describe("generic MCP transcript row", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("renders a semantic collapsed headline and labeled expanded args", () => {
		const ui = { requestRender() {}, requestComponentRender() {} } as unknown as TUI;
		const component = new ToolExecutionComponent(
			"mcp__node_repl_js",
			{ _i: "Inspecting package metadata", title: "Read package manifest", code: "x".repeat(300) },
			{},
			undefined,
			ui,
		);
		component.updateResult({ content: [{ type: "text", text: "one\ntwo" }] }, false);
		const collapsed = stripVTControlCharacters(component.render(100).join("\n"));
		expect(collapsed).toContain("Inspecting package metadata · Read package manifest · ok · 2 lines");
		expect(collapsed).not.toContain('code="');
		expect(collapsed).not.toContain("x".repeat(30));

		component.setExpanded(true);
		const expanded = stripVTControlCharacters(component.render(100).join("\n"));
		expect(expanded).toContain("title: Read package manifest");
		expect(expanded).toContain("code:");
		expect(expanded).toContain("<300 bytes>");
		expect(expanded).not.toContain('code="');
	});
});
