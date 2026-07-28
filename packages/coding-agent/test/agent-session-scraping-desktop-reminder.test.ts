import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import {
	SCRAPING_DESKTOP_REMINDER_MESSAGE_TYPE,
	SCRAPING_DESKTOP_REMINDER_STATE_TYPE,
} from "@oh-my-pi/pi-coding-agent/session/scraping-desktop-reminder";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

const MAC_RUNTIME = { platform: "darwin" as const, hostname: "arthurs-mac" };

describe("AgentSession scraping desktop reminder", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	const sessions: AgentSession[] = [];

	function createSession(sessionManager: SessionManager, enabled = true): AgentSession {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled test model");
		const session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] } }),
			sessionManager,
			settings: Settings.isolated({
				"compaction.enabled": false,
				"reminders.scrapingDesktop": enabled,
			}),
			modelRegistry,
			scrapingDesktopRuntime: MAC_RUNTIME,
		});
		sessions.push(session);
		return session;
	}

	function emitKnownCrawler(session: AgentSession, callId: string): void {
		session.agent.emitExternalEvent({
			type: "tool_execution_start",
			toolCallId: callId,
			toolName: "bash",
			args: { command: "bun vendor/badlogic/pi-skills/browser-tools/browser-hn-scraper.js" },
		});
	}

	async function drainSessionEvents(): Promise<void> {
		for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();
	}

	async function waitForReminder(sessionManager: SessionManager): Promise<void> {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			if (
				sessionManager
					.getEntries()
					.some(entry => entry.type === "custom_message" && entry.customType === SCRAPING_DESKTOP_REMINDER_MESSAGE_TYPE)
			) {
				return;
			}
			await Promise.resolve();
		}
		throw new Error("Scraping desktop reminder was not injected");
	}

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-scraping-desktop-reminder-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
	});

	afterEach(async () => {
		for (const session of sessions.splice(0)) await session.dispose();
		authStorage.close();
		await tempDir.remove();
	});

	it("persists one advisory per session and does not repeat after reload", async () => {
		const sessionManager = SessionManager.create(tempDir.path(), path.join(tempDir.path(), "sessions"));
		const session = createSession(sessionManager);

		emitKnownCrawler(session, "crawl-1");
		await waitForReminder(sessionManager);
		emitKnownCrawler(session, "crawl-2");
		await drainSessionEvents();

		expect(
			sessionManager
				.getEntries()
				.filter(entry => entry.type === "custom" && entry.customType === SCRAPING_DESKTOP_REMINDER_STATE_TYPE),
		).toHaveLength(1);
		const reminderEntries = sessionManager
			.getEntries()
			.filter(entry => entry.type === "custom_message" && entry.customType === SCRAPING_DESKTOP_REMINDER_MESSAGE_TYPE);
		expect(reminderEntries).toHaveLength(1);
		const reminderEntry = reminderEntries[0];
		if (!reminderEntry || reminderEntry.type !== "custom_message") throw new Error("Expected reminder message entry");
		const reminderContent = reminderEntry.content;
		expect(typeof reminderContent).toBe("string");
		expect(reminderContent).toContain("gpu-workload-dispatch");
		expect(reminderContent).toContain("remote-chrome-control");
		expect(reminderContent).toContain("ssh desktop.eth");

		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("Expected persisted session file");
		await sessionManager.flush();
		await session.dispose();
		sessions.splice(sessions.indexOf(session), 1);

		const reopenedManager = await SessionManager.open(sessionFile, tempDir.path());
		const reopenedSession = createSession(reopenedManager);
		emitKnownCrawler(reopenedSession, "crawl-after-reload");
		await drainSessionEvents();

		expect(
			reopenedManager
				.getEntries()
				.filter(entry => entry.type === "custom" && entry.customType === SCRAPING_DESKTOP_REMINDER_STATE_TYPE),
		).toHaveLength(1);
		expect(
			reopenedManager
				.getEntries()
				.filter(entry => entry.type === "custom_message" && entry.customType === SCRAPING_DESKTOP_REMINDER_MESSAGE_TYPE),
		).toHaveLength(1);
	});

	it("honors the reminders.scrapingDesktop kill switch", async () => {
		const sessionManager = SessionManager.create(tempDir.path(), path.join(tempDir.path(), "disabled-sessions"));
		const session = createSession(sessionManager, false);

		emitKnownCrawler(session, "disabled-crawl");
		await drainSessionEvents();

		expect(
			sessionManager
				.getEntries()
				.some(
					entry =>
						(entry.type === "custom" && entry.customType === SCRAPING_DESKTOP_REMINDER_STATE_TYPE) ||
						(entry.type === "custom_message" && entry.customType === SCRAPING_DESKTOP_REMINDER_MESSAGE_TYPE),
				),
		).toBe(false);
	});
});
