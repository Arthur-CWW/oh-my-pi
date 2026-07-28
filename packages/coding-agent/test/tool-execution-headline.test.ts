import { beforeAll, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { ToolExecutionComponent } from "@oh-my-pi/pi-coding-agent/modes/components/tool-execution";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import {
	composeToolHeadline,
	formatToolArgsLines,
	phaseStatus,
	ToolHeadlineMemo,
} from "@oh-my-pi/pi-coding-agent/tools/tool-headline";
import type { TUI } from "@oh-my-pi/pi-tui";

describe("semantic tool-call headlines", () => {
	it.each([
		[
			"bash",
			{ _i: "Checking focused tests", command: "bun test test/tool.test.ts", cwd: "/tmp/work" },
			"Checking focused tests · bun · cwd /tmp/work · ok",
		],
		[
			"read",
			{ _i: "Reading renderer section", path: "src/render.ts", offset: 40, limit: 20 },
			"Reading renderer section · src/render.ts:40-59 · ok",
		],
		[
			"task",
			{ _i: "Spawning parser review", tasks: [{ id: "ParserReview", role: "Parser specialist", model: "slow" }] },
			"Spawning parser review · ParserReview · Parser specialist · slow · ok",
		],
		[
			"mcp__node_repl_js",
			{ _i: "Inspecting package metadata", title: "Read package manifest", code: "throw new Error('not headline')" },
			"Inspecting package metadata · Read package manifest · ok",
		],
		[
			"browser",
			{ _i: "Opening documentation", action: "open", url: "https://example.test/docs" },
			"Opening documentation · open · https://example.test/docs · ok",
		],
		[
			"edit",
			{ _i: "Updating renderer import", path: "src/render.ts" },
			"Updating renderer import · src/render.ts · ok",
		],
		[
			"write",
			{ _i: "Writing fixture output", path: "test/fixture.txt" },
			"Writing fixture output · test/fixture.txt · ok",
		],
		[
			"mcp__fetch_fetch",
			{ _i: "Fetching API reference", url: "https://example.test/api" },
			"Fetching API reference · https://example.test/api · ok",
		],
		[
			"search",
			{ _i: "Finding status handlers", pattern: "phaseStatus", paths: ["src"] },
			"Finding status handlers · phaseStatus · src · ok",
		],
		["find", { _i: "Locating renderer files", paths: ["src/**/*.ts"] }, "Locating renderer files · src/**/*.ts · ok"],
		[
			"irc",
			{ _i: "Asking renderer owner", op: "send", to: "RichToggleFix", message: "Which files are in flight?" },
			"Asking renderer owner · send · to RichToggleFix · Which files are in flight? · ok",
		],
		[
			"read",
			{
				_i: "Reading input controller",
				path: "vendor/oh-my-pi/packages/coding-agent/src/modes/controllers/input-controller.ts",
			},
			"Reading input controller · vendor/oh-my-pi/packages/coding-agent/src/modes/controllers/input-controller.ts · ok",
		],
	] as const)("composes a %s headline", (toolName, args, expected) => {
		expect(composeToolHeadline(toolName, args, "ok")).toBe(expected);
	});

	it("keeps long file paths whole so wide surfaces can render them in full", () => {
		const longPath = "vendor/oh-my-pi/packages/coding-agent/src/modes/controllers/input-controller.ts";
		for (const tool of ["read", "write", "edit", "apply_patch"] as const) {
			const headline = composeToolHeadline(tool, { _i: "Editing controller", path: longPath }, "ok");
			expect(headline).toContain(longPath);
			expect(stripVTControlCharacters(headline)).not.toContain("…");
		}
	});

	it("still compacts long free-text (non-path) details", () => {
		const longUrl = `https://example.test/${"a".repeat(120)}`;
		const headline = composeToolHeadline("mcp__fetch_fetch", { _i: "Fetching", url: longUrl }, "ok");
		expect(headline).toContain("…");
		expect(headline).not.toContain(longUrl);
	});

	it("uses the first non-import JS line when title is absent and never leaks raw args", () => {
		const headline = composeToolHeadline(
			"mcp__node_repl_js",
			{ code: `\nvar fs = (await ${"import("}"node:fs"));\nconst count = fs.readdirSync(".").length;` },
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

	it("renders complete nested strings and propagates mode when expanded", () => {
		const note = `friction ${"detail ".repeat(45)}tail-marker`;
		const byteCount = Buffer.byteLength(note, "utf8");
		expect(byteCount).toBeGreaterThan(240);
		const args = { report: { class: "capability-gap", note } };

		const collapsed = formatToolArgsLines(args, "collapsed");
		expect(collapsed).toContain("report:");
		expect(collapsed.join("\n")).toContain(`<${byteCount} bytes>`);
		expect(collapsed.join("\n")).not.toContain("tail-marker");

		const expanded = formatToolArgsLines(args, "expanded");
		expect(expanded).toContain("report:");
		expect(expanded.join("\n")).toContain(note);
		expect(expanded.join("\n")).toContain("tail-marker");
		expect(expanded.join("\n")).not.toContain(" bytes>");
		expect(expanded.join("\n")).not.toContain("…");
	});

	it("breaks expanded multi-line strings into legible indented lines", () => {
		const code = "const a = 1;\nconst b = 2;\nreturn a + b;";
		const collapsed = formatToolArgsLines({ code }, "collapsed").join("\n");
		expect(collapsed).toContain("code: const a = 1;\\nconst b = 2;\\nreturn a + b;");

		const expanded = formatToolArgsLines({ code }, "expanded");
		expect(expanded).toContain("code:");
		expect(expanded).toContain("  const a = 1;");
		expect(expanded).toContain("  const b = 2;");
		expect(expanded).toContain("  return a + b;");
		expect(expanded.join("\n")).not.toContain("\\n");
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
		const expanded = stripVTControlCharacters(component.render(400).join("\n"));
		expect(expanded).toContain("title: Read package manifest");
		expect(expanded).toContain("code:");
		expect(expanded).toContain("x".repeat(300));
		expect(expanded).not.toContain("<300 bytes>");
		expect(expanded).not.toContain('code="');
	});
});
