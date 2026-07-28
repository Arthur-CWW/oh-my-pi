import { describe, expect, it } from "bun:test";
import {
	KNOWN_CRAWL_SCRIPTS,
	LOOPED_SCRAPING_COMMANDS,
	SCRAPING_DESKTOP_SKILLS,
	shouldInjectScrapingDesktopReminder,
	type ScrapingDesktopActivity,
} from "@oh-my-pi/pi-coding-agent/session/scraping-desktop-reminder";

const MAC_RUNTIME = { platform: "darwin" as const, hostname: "arthurs-mac", cwd: "/Users/arthur/agents" };

function matches(activity: ScrapingDesktopActivity): boolean {
	return shouldInjectScrapingDesktopReminder({ ...MAC_RUNTIME, activity });
}

describe("scraping desktop reminder predicate", () => {
	it("matches only after more than two browser tabs are opened in one turn", () => {
		expect(matches({ type: "tool", toolName: "browser", args: { action: "open" }, browserOpenCount: 2 })).toBe(
			false,
		);
		expect(matches({ type: "tool", toolName: "browser", args: { action: "open" }, browserOpenCount: 3 })).toBe(
			true,
		);
		expect(matches({ type: "tool", toolName: "browser", args: { action: "run" }, browserOpenCount: 5 })).toBe(
			false,
		);
	});

	it.each([...LOOPED_SCRAPING_COMMANDS])("matches looped %s invocations", command => {
		expect(
			matches({
				type: "tool",
				toolName: "bash",
				args: { command: `for url in one two; do ${command} "$url"; done` },
				browserOpenCount: 0,
			}),
		).toBe(true);
	});

	it("does not match listed commands outside a shell loop or unlisted commands inside one", () => {
		for (const command of LOOPED_SCRAPING_COMMANDS) {
			expect(
				matches({ type: "tool", toolName: "bash", args: { command: `${command} https://example.com` }, browserOpenCount: 0 }),
			).toBe(false);
		}
		expect(
			matches({
				type: "tool",
				toolName: "bash",
				args: { command: "for value in one two; do echo $value; done" },
				browserOpenCount: 0,
			}),
		).toBe(false);
	});

	it.each([...KNOWN_CRAWL_SCRIPTS])("matches known crawl script %s", script => {
		expect(
			matches({ type: "tool", toolName: "bash", args: { command: `bun ${script}` }, browserOpenCount: 0 }),
		).toBe(true);
	});

	it("does not match an unknown script with a scraping-like name", () => {
		expect(
			matches({ type: "tool", toolName: "bash", args: { command: "bun scripts/crawl-random.ts" }, browserOpenCount: 0 }),
		).toBe(false);
	});

	it.each([...SCRAPING_DESKTOP_SKILLS])("matches loaded scraping skill %s", skillName => {
		expect(matches({ type: "skill", skillName })).toBe(true);
		expect(
			matches({
				type: "tool",
				toolName: "read",
				args: { path: `skill://${skillName}` },
				browserOpenCount: 0,
			}),
		).toBe(true);
	});

	it("does not match unrelated skills or ordinary file reads", () => {
		expect(matches({ type: "skill", skillName: "browser-control" })).toBe(false);
		expect(
			matches({ type: "tool", toolName: "read", args: { path: "README.md" }, browserOpenCount: 0 }),
		).toBe(false);
	});

	it("gates on local darwin and excludes the desktop hostname", () => {
		const activity: ScrapingDesktopActivity = { type: "skill", skillName: "playwright" };
		expect(shouldInjectScrapingDesktopReminder({ ...MAC_RUNTIME, platform: "linux", activity })).toBe(false);
		expect(shouldInjectScrapingDesktopReminder({ ...MAC_RUNTIME, hostname: "desktop", activity })).toBe(false);
		expect(shouldInjectScrapingDesktopReminder({ ...MAC_RUNTIME, hostname: "desktop.eth", activity })).toBe(false);
		expect(shouldInjectScrapingDesktopReminder({ ...MAC_RUNTIME, cwd: "ssh://desktop.eth/work", activity })).toBe(false);
	});
});
