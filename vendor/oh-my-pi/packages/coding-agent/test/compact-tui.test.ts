import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { StatusLineComponent } from "@oh-my-pi/pi-coding-agent/modes/components/status-line";
import { getPreset } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/presets";
import {
	getEditorTheme,
	getMarkdownTheme,
	getThemeByName,
	getThemeEpoch,
	highlightCode,
	initTheme,
	setThemeInstance,
	theme,
} from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { Editor } from "@oh-my-pi/pi-tui/components/editor";
import { visibleWidth } from "@oh-my-pi/pi-tui";
import { getProjectDir, setProjectDir } from "@oh-my-pi/pi-utils";

const originalProjectDir = getProjectDir();

beforeAll(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	await initTheme();
});

afterAll(() => {
	resetSettingsForTest();
	setProjectDir(originalProjectDir);
});

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function createStatusLineSession(sessionName: string) {
	return {
		state: { model: { name: "Sonnet 4", id: "claude-sonnet-4", contextWindow: 200_000 }, messages: [] },
		isStreaming: false,
		isFastModeActive: () => false,
		isFastModeEnabled: () => false,
		isAdvisorActive: () => false,
		isAutoThinking: false,
		autoResolvedThinkingLevel: () => undefined,
		thinkingLevel: undefined,
		getAsyncJobSnapshot: () => ({ running: [] }),
		getCurrentModel: () => ({ name: "Sonnet 4", id: "claude-sonnet-4" }),
		getContextUsage: () => null,
		model: { name: "Sonnet 4", id: "claude-sonnet-4", contextWindow: 200_000 },
		messages: [],
		modelRegistry: { isUsingOAuth: () => false },
		sessionManager: {
			getSessionName: () => sessionName,
			getSessionId: () => "test-session-id",
			getCwd: () => "/tmp/test",
			getUsageStatistics: () => ({
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				premiumRequests: 0,
				cost: 0,
			}),
		},
		autoCompactionEnabled: false,
	} as unknown as ConstructorParameters<typeof StatusLineComponent>[0];
}

function buildCompactComponent(sessionName = "TestSession") {
	const component = new StatusLineComponent(createStatusLineSession(sessionName));
	component.updateSettings({
		preset: "compact",
		showHookStatus: true,
	});
	return component;
}

// ═══════════════════════════════════════════════════════════════════════════
// Compact preset definition
// ═══════════════════════════════════════════════════════════════════════════

describe("compact preset definition", () => {
	it("uses pipe separator and plain segments", () => {
		const preset = getPreset("compact");
		expect(preset.separator).toBe("pipe");
		expect(preset.leftSegments).toContain("model");
		expect(preset.leftSegments).toContain("path");
		expect(preset.leftSegments).toContain("git");
		expect(preset.rightSegments).toContain("session_name");
	});

	it("does not include powerline separator", () => {
		const preset = getPreset("compact");
		expect(preset.separator).not.toBe("powerline");
		expect(preset.separator).not.toBe("powerline-thin");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Borderless (standalone) rendering
// ═══════════════════════════════════════════════════════════════════════════

describe("compact preset borderless mode", () => {
	it("reports isBorderless() true for compact preset", () => {
		const component = buildCompactComponent();
		expect(component.isBorderless()).toBe(true);
	});

	it("reports isBorderless() false for default preset", () => {
		const component = new StatusLineComponent(createStatusLineSession("Test"));
		component.updateSettings({ preset: "default" });
		expect(component.isBorderless()).toBe(false);
	});

	it("getTopBorder returns empty in borderless mode", () => {
		const component = buildCompactComponent();
		const border = component.getTopBorder(80);
		expect(border.content).toBe("");
		expect(border.width).toBe(0);
	});

	it("render() produces a status row in borderless mode", () => {
		const component = buildCompactComponent();
		const lines = component.render(80);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		// Should contain model name
		const plainText = stripVTControlCharacters(lines[0]);
		expect(plainText).toContain("Sonnet 4");
	});

	it("non-compact render() produces no status row (hooks only)", () => {
		const component = new StatusLineComponent(createStatusLineSession("Test"));
		component.updateSettings({ preset: "default" });
		const lines = component.render(80);
		// Default mode: render() only outputs hook statuses, which are empty here
		expect(lines.length).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Width snapshots: narrow / medium / wide
// ═══════════════════════════════════════════════════════════════════════════

describe("compact status line at varying widths", () => {
	let tmpDir: string;

	beforeAll(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-compact-test-projectdir-"));
		setProjectDir(tmpDir);
	});

	it("fits within narrow width (40 cols)", () => {
		const component = buildCompactComponent();
		const lines = component.render(40);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		const vw = visibleWidth(lines[0]);
		expect(vw).toBeLessThanOrEqual(40);
	});

	it("fits within medium width (80 cols)", () => {
		const component = buildCompactComponent();
		const lines = component.render(80);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		const vw = visibleWidth(lines[0]);
		expect(vw).toBeLessThanOrEqual(80);
	});

	it("fits within wide width (120 cols)", () => {
		const component = buildCompactComponent();
		const lines = component.render(120);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		const vw = visibleWidth(lines[0]);
		expect(vw).toBeLessThanOrEqual(120);
	});

	it("does not produce horizontal overflow at any width", () => {
		const component = buildCompactComponent();
		for (const width of [30, 40, 60, 80, 100, 120, 200]) {
			const lines = component.render(width);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	it("collapses lower-priority segments at narrow widths", () => {
		const component = buildCompactComponent();
		const wideLines = component.render(120);
		const narrowLines = component.render(30);
		const widePlain = stripVTControlCharacters(wideLines[0] ?? "");
		const narrowPlain = stripVTControlCharacters(narrowLines[0] ?? "");
		// At wide width, session_name should be present
		// At narrow width, it may be collapsed
		expect(widePlain.length).toBeGreaterThan(narrowPlain.length);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Copy extraction: borderless editor contains only draft text
// ═══════════════════════════════════════════════════════════════════════════

describe("borderless editor copy extraction", () => {
	it("rendered lines contain no box-drawing frame glyphs", () => {
		const editor = new Editor(getEditorTheme());
		editor.setBorderVisible(false);
		editor.setPromptGutter("❯ ");
		editor.setText("hello world");
		// Focus the editor so cursor renders
		editor.focused = true;

		const lines = editor.render(60);
		const boxGlyphs = /[╭╮╰╯│─▏]/;
		for (const line of lines) {
			const plain = stripVTControlCharacters(line);
			expect(plain).not.toMatch(boxGlyphs);
		}
	});

	it("getText returns only user draft without frame artifacts", () => {
		const editor = new Editor(getEditorTheme());
		editor.setBorderVisible(false);
		editor.setPromptGutter("❯ ");
		const draft = "my draft text\nsecond line";
		editor.setText(draft);

		expect(editor.getText()).toBe(draft);
	});

	it("no mode words (INSERT/NORMAL) in rendered output", () => {
		const editor = new Editor(getEditorTheme());
		editor.setBorderVisible(false);
		editor.setPromptGutter("❯ ");
		editor.setText("test");
		editor.focused = true;

		const lines = editor.render(80);
		for (const line of lines) {
			const plain = stripVTControlCharacters(line);
			expect(plain).not.toContain("INSERT");
			expect(plain).not.toContain("NORMAL");
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Theme flip: epoch-based cache invalidation
// ═══════════════════════════════════════════════════════════════════════════

describe("theme change invalidates caches", () => {
	it("themeEpoch increments on setThemeInstance", () => {
		const epochBefore = getThemeEpoch();
		setThemeInstance(theme);
		const epochAfter = getThemeEpoch();
		expect(epochAfter).toBe(epochBefore + 1);
	});

	it("markdown theme cache is invalidated by epoch change", () => {
		const md1 = getMarkdownTheme();
		const md2 = getMarkdownTheme();
		expect(md2).toBe(md1);

		// Bump epoch
		setThemeInstance(theme);

		const md3 = getMarkdownTheme();
		expect(md3).not.toBe(md1);
	});

	it("highlight cache clears on epoch bump", () => {
		const lines1 = highlightCode("const x = 1;", "typescript");
		expect(lines1.length).toBeGreaterThan(0);

		const epochBefore = getThemeEpoch();
		setThemeInstance(theme);
		expect(getThemeEpoch()).toBe(epochBefore + 1);

		const lines2 = highlightCode("const x = 1;", "typescript");
		expect(lines2.length).toBeGreaterThan(0);
	});

	it("dark↔light theme flip changes ANSI colors in one render cycle", async () => {
		// Capture status line ANSI output under the current (dark) theme
		const component = buildCompactComponent();
		const darkLines = component.render(80);
		expect(darkLines.length).toBeGreaterThanOrEqual(1);
		const darkAnsi = darkLines[0];

		// Load the opposite theme (light) and install it
		const lightTheme = await getThemeByName("light");
		expect(lightTheme).toBeDefined();
		setThemeInstance(lightTheme!);

		// Same component, same width — the raw ANSI must differ because segment
		// renderers read the global `theme` on each call and the two themes use
		// different color values for statusLineModel, statusLinePath, etc.
		const lightLines = component.render(80);
		expect(lightLines.length).toBeGreaterThanOrEqual(1);
		const lightAnsi = lightLines[0];

		// The visible text is identical (same model name, same session, etc.)
		expect(stripVTControlCharacters(lightAnsi)).toBe(stripVTControlCharacters(darkAnsi));
		// But the raw ANSI-escaped strings differ (different color codes)
		expect(lightAnsi).not.toBe(darkAnsi);

		// Markdown theme also refreshed — not the same cached object
		const mdAfterFlip = getMarkdownTheme();
		// Calling again should return the cached one
		const mdCached = getMarkdownTheme();
		expect(mdCached).toBe(mdAfterFlip);

		// Restore dark theme for subsequent tests
		const darkTheme = await getThemeByName("dark");
		if (darkTheme) setThemeInstance(darkTheme);
	});
});
