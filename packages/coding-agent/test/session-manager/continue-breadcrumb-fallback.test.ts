import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { getTerminalId } from "@oh-my-pi/pi-tui";
import { getConfigRootDir, getTerminalSessionsDir, setAgentDir } from "@oh-my-pi/pi-utils";
import { makeAssistantMessage } from "./helpers";

describe("SessionManager.continueRecent breadcrumb fallback", () => {
	let testAgentDir: string;
	let cwd: string;
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	const originalTmuxPane = process.env.TMUX_PANE;
	const fallbackAgentDir = path.join(getConfigRootDir(), "agent");

	beforeEach(() => {
		process.env.TMUX_PANE = "%continue-current";
		testAgentDir = path.join(import.meta.dir, `.tmp-continue-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		setAgentDir(testAgentDir);
		cwd = path.join(testAgentDir, "project");
		fs.mkdirSync(cwd, { recursive: true });
	});

	afterEach(async () => {
		if (originalTmuxPane === undefined) delete process.env.TMUX_PANE;
		else process.env.TMUX_PANE = originalTmuxPane;
		if (originalAgentDir) {
			setAgentDir(originalAgentDir);
		} else {
			setAgentDir(fallbackAgentDir);
			delete process.env.PI_CODING_AGENT_DIR;
		}
		if (testAgentDir) await fsp.rm(testAgentDir, { recursive: true, force: true });
	});

	async function makeSession(text: string, mtime: Date): Promise<string> {
		const session = SessionManager.create(cwd);
		session.appendMessage({ role: "user", content: text, timestamp: mtime.getTime() });
		session.appendMessage(makeAssistantMessage());
		await session.flush();
		const file = session.getSessionFile();
		if (!file) throw new Error("Expected persisted session file");
		await session.close();
		fs.utimesSync(file, mtime, mtime);
		return file;
	}

	function clearBreadcrumbs(): void {
		fs.rmSync(getTerminalSessionsDir(), { recursive: true, force: true });
	}

	function writeBreadcrumbForTerminal(terminalId: string, breadcrumbCwd: string, sessionFile: string): void {
		const dir = getTerminalSessionsDir();
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, terminalId), `${breadcrumbCwd}\n${sessionFile}\n`);
	}

	it("uses this terminal breadcrumb with provenance", async () => {
		const file = await makeSession("current terminal", new Date("2026-01-01T00:00:00.000Z"));
		clearBreadcrumbs();
		const terminalId = getTerminalId();
		if (!terminalId) throw new Error("Expected deterministic terminal id");
		writeBreadcrumbForTerminal(terminalId, cwd, file);

		const resumed = await SessionManager.continueRecent(cwd);
		try {
			expect(resumed.getSessionFile()).toBe(file);
			expect(resumed.getContinueProvenance()).toBe("this terminal's last session");
		} finally {
			await resumed.close();
		}
	});

	it("different-terminal same-cwd breadcrumb wins over bare most-recent session", async () => {
		const breadcrumbFile = await makeSession("breadcrumb target", new Date("2026-01-01T00:00:00.000Z"));
		const newestFile = await makeSession("newest bare", new Date("2026-01-02T00:00:00.000Z"));
		clearBreadcrumbs();
		writeBreadcrumbForTerminal("other-terminal", cwd, breadcrumbFile);

		const resumed = await SessionManager.continueRecent(cwd);
		try {
			expect(resumed.getSessionFile()).toBe(breadcrumbFile);
			expect(resumed.getSessionFile()).not.toBe(newestFile);
			expect(resumed.getContinueProvenance()).toBe("last session in this folder — breadcrumb recovered");
		} finally {
			await resumed.close();
		}
	});

	it("falls back to the most recent session when no breadcrumbs exist", async () => {
		await makeSession("older", new Date("2026-01-01T00:00:00.000Z"));
		const newestFile = await makeSession("newer", new Date("2026-01-02T00:00:00.000Z"));
		clearBreadcrumbs();

		const resumed = await SessionManager.continueRecent(cwd);
		try {
			expect(resumed.getSessionFile()).toBe(newestFile);
			expect(resumed.getContinueProvenance()).toBe("last session in this folder — breadcrumb missed");
		} finally {
			await resumed.close();
		}
	});

	it("reports fresh-session provenance when no sessions exist", async () => {
		clearBreadcrumbs();

		const resumed = await SessionManager.continueRecent(cwd);
		try {
			expect(resumed.getEntries()).toEqual([]);
			expect(resumed.getContinueProvenance()).toBe("new session — no prior session found");
		} finally {
			await resumed.close();
		}
	});
});
