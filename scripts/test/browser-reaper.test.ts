import { describe, expect, test } from "bun:test";
import { classifyGroup, groupBrowserProcesses, type ProcessRow } from "../browser-reaper";

const row = (pid: number, ppid: number, command: string, ageSeconds = 7_200, rssKb = 1_024): ProcessRow => ({
	pid,
	ppid,
	command,
	ageSeconds,
	rssKb,
});

describe("browser orphan classification", () => {
	test("reaps only old parentless automation groups", () => {
		const [group] = groupBrowserProcesses([
			row(40, 999, "/Applications/Chromium --headless=new --user-data-dir=/tmp/profile"),
			row(41, 40, "/Applications/Chromium Helper --type=renderer"),
		]);

		expect(group).toBeDefined();
		expect(group!.members.map(member => member.pid)).toEqual([40, 41]);
		expect(classifyGroup(group!, 3_600)).toEqual({ reap: true, reason: "stale parentless headless orphan" });
	});

	test("protects automation owned by a live non-OMP parent", () => {
		const [group] = groupBrowserProcesses([
			row(10, 1, "/usr/bin/node worker.js"),
			row(20, 10, "/Applications/Chromium --headless=new"),
		]);

		expect(classifyGroup(group!, 3_600)).toEqual({ reap: false, reason: "protected: live non-OMP parent" });
	});

	test("protects browsers belonging to a live OMP session", () => {
		const [group] = groupBrowserProcesses([
			row(10, 1, "/usr/local/bin/omp --resume session-1"),
			row(20, 10, "/Applications/Chromium --headless=new"),
		]);

		expect(classifyGroup(group!, 3_600)).toEqual({ reap: false, reason: "protected: live OMP ancestor" });
	});

	test("protects interactive, guarded, and young browser groups", () => {
		const [interactive] = groupBrowserProcesses([row(20, 1, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]);
		const [guarded] = groupBrowserProcesses([
			row(30, 1, "/usr/bin/google-chrome-stable --headless --user-data-dir=/home/arthur/.local/share/chrome-agent"),
		]);
		const [young] = groupBrowserProcesses([row(40, 1, "/Applications/Chromium --headless=new", 59)]);

		expect(classifyGroup(interactive!, 3_600).reason).toBe("protected: interactive/default Chrome");
		expect(classifyGroup(guarded!, 3_600).reason).toBe("protected: guarded Chrome profile");
		expect(classifyGroup(young!, 60)).toEqual({ reap: false, reason: "young orphan (<1m)" });
	});
});
