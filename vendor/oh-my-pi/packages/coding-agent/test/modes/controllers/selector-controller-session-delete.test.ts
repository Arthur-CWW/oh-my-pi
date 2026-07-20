import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { SessionSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/session-selector";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import type { SessionInfo } from "@oh-my-pi/pi-coding-agent/session/session-listing";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { FileSessionStorage } from "@oh-my-pi/pi-coding-agent/session/session-storage";
import { withControllerFixture } from "../../helpers/controller-fixture";
import { Container, type TUI } from "@oh-my-pi/pi-tui";
import { VirtualTerminal } from "../../../../tui/test/virtual-terminal";

type TestContext = InteractiveModeContext;

function makeSessionInfo(path: string): SessionInfo {
	return {
		path,
		id: path,
		cwd: "/tmp/project",
		title: "Active session",
		created: new Date("2025-01-01T00:00:00Z"),
		modified: new Date("2025-01-01T00:00:00Z"),
		messageCount: 1,
		size: 0,
		firstMessage: "hello",
		allMessagesText: "hello",
	};
}

function createContext(tui: TUI, currentSessionFile: string): {
	ctx: TestContext;
	calls: string[];
	setCurrentSessionFile: (path: string) => void;
	showHookConfirm: (title: string, message: string) => Promise<boolean>;
	newSession: () => Promise<boolean>;
} {
	const calls: string[] = [];
	let sessionFile = currentSessionFile;
	const editorContainer = new Container();
	const chatContainer = new Container();
	const editor = new Container();
	editorContainer.addChild(editor);
	tui.addChild(editorContainer);
	tui.addChild(chatContainer);
	tui.setFocus(editor);
	vi.spyOn(tui, "requestRender").mockImplementation(() => {
		calls.push("ui.requestRender");
	});
	const showHookConfirm = vi.fn(async () => true);
	const newSession = vi.fn(async () => {
		calls.push("session.newSession");
		sessionFile = "/tmp/project/sessions/detached.jsonl";
		return true;
	});
	const session = {
		newSession,
		switchSession: vi.fn(async () => true),
	};
	const ctx = {
		editorContainer,
		editor,
		chatContainer,
		ui: tui,
		session,
		get viewSession() {
			return session;
		},
		sessionManager: {
			getCwd: () => "/tmp/project",
			getSessionDir: () => "/tmp/project/sessions",
			getSessionFile: () => sessionFile,
		},
		statusContainer: {
			clear: vi.fn(() => {
				calls.push("statusContainer.clear");
			}),
		},
		pendingMessagesContainer: {
			clear: vi.fn(() => {
				calls.push("pendingMessagesContainer.clear");
			}),
		},
		compactionQueuedMessages: [] as unknown[],
		streamingComponent: { active: true },
		streamingMessage: { active: true },
		pendingTools: {
			clear: vi.fn(() => {
				calls.push("pendingTools.clear");
			}),
		},
		loadingAnimation: {
			stop: vi.fn(() => {
				calls.push("loadingAnimation.stop");
			}),
		},
		statusLine: {
			invalidate: vi.fn(() => {
				calls.push("statusLine.invalidate");
			}),
			setSessionStartTime: vi.fn(() => {
				calls.push("statusLine.setSessionStartTime");
			}),
		},
		updateEditorTopBorder: vi.fn(() => {
			calls.push("updateEditorTopBorder");
		}),
		updateEditorBorderColor: vi.fn(() => {
			calls.push("updateEditorBorderColor");
		}),
		renderInitialMessages: vi.fn(() => {
			calls.push("renderInitialMessages");
		}),
		reloadTodos: vi.fn(async () => {
			calls.push("reloadTodos");
		}),
		showStatus: vi.fn((message: string) => {
			calls.push(`showStatus:${message}`);
		}),
		showError: vi.fn(),
		showHookConfirm,
		shutdown: vi.fn(async () => undefined),
		clearTransientSessionUi() {
			ctx.loadingAnimation?.stop();
			ctx.statusContainer.clear();
			ctx.pendingMessagesContainer.clear();
			ctx.pendingTools.clear();
		},
	} as unknown as TestContext;

	return {
		ctx,
		calls,
		setCurrentSessionFile(path: string) {
			sessionFile = path;
		},
		showHookConfirm,
		newSession,
	};
}

function renderText(selector: SessionSelectorComponent): string {
	return selector.render(120).join("\n");
}

async function waitForMountedSessionSelector(tui: TUI): Promise<SessionSelectorComponent> {
	for (let attempt = 0; attempt < 80; attempt += 1) {
		const focused = tui.getFocused();
		if (focused instanceof SessionSelectorComponent) return focused;
		await Bun.sleep(1);
	}
	throw new Error("Expected mounted session selector renderer");
}

async function driveSessionDelete(tui: TUI, settled: () => boolean): Promise<void> {
	const terminal = tui.terminal;
	if (!(terminal instanceof VirtualTerminal)) throw new Error("Expected virtual terminal");
	tui.start();
	try {
		terminal.sendInput("\x04");
		terminal.sendInput("\n");
		for (let attempt = 0; attempt < 80 && !settled(); attempt += 1) await Bun.sleep(1);
	} finally {
		tui.stop();
	}
}

beforeAll(() => {
	initTheme();
});

describe("SelectorController session deletion", () => {
	beforeEach(() => {
		vi.spyOn(SessionManager, "list").mockResolvedValue([]);
		vi.spyOn(SessionManager, "listAll").mockResolvedValue([]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("detaches the active session before selector deletion removes it", async () => {
		await withControllerFixture(async fixture => {
			const activeSession = makeSessionInfo("/tmp/project/sessions/active.jsonl");
			const { ctx, calls } = createContext(fixture.tui, activeSession.path);
			vi.spyOn(SessionManager, "list").mockResolvedValue([activeSession]);
			const deleteSessionWithArtifacts = vi
				.spyOn(FileSessionStorage.prototype, "deleteSessionWithArtifacts")
				.mockImplementation(async sessionPath => {
					calls.push(`delete:${sessionPath}`);
				});
			const controller = new SelectorController(ctx, fixture.getInputLeaseManager, fixture.scope);
			const handleResumeSession = vi.spyOn(controller, "handleResumeSession");

			await controller.showSessionSelector();
			const selector = await waitForMountedSessionSelector(fixture.tui);
			await driveSessionDelete(
				fixture.tui,
				() => deleteSessionWithArtifacts.mock.calls.length === 1 && !renderText(selector).includes("Active session"),
			);

			expect(deleteSessionWithArtifacts).toHaveBeenCalledWith(activeSession.path);
			expect(handleResumeSession).not.toHaveBeenCalled();
			expect(renderText(selector)).not.toContain("Active session");
			expect(calls.filter(call => call !== "ui.requestRender")).toEqual([
				"session.newSession",
				"loadingAnimation.stop",
				"statusContainer.clear",
				"pendingMessagesContainer.clear",
				"pendingTools.clear",
				"statusLine.invalidate",
				"statusLine.setSessionStartTime",
				"updateEditorTopBorder",
				"updateEditorBorderColor",
				"renderInitialMessages",
				"reloadTodos",
				`delete:${activeSession.path}`,
			]);
			expect(ctx.sessionManager.getSessionFile()).toBe("/tmp/project/sessions/detached.jsonl");
		});
	});
	it("shows inline selector errors when session deletion fails after detach", async () => {
		await withControllerFixture(async fixture => {
			const activeSession = makeSessionInfo("/tmp/project/sessions/active.jsonl");
			const { ctx, newSession } = createContext(fixture.tui, activeSession.path);
			vi.spyOn(SessionManager, "list").mockResolvedValue([activeSession]);
			const deleteSessionWithArtifacts = vi
				.spyOn(FileSessionStorage.prototype, "deleteSessionWithArtifacts")
				.mockRejectedValue(new Error("disk failed"));
			const controller = new SelectorController(ctx, fixture.getInputLeaseManager, fixture.scope);
			const handleResumeSession = vi.spyOn(controller, "handleResumeSession");

			await controller.showSessionSelector();
			const selector = await waitForMountedSessionSelector(fixture.tui);
			await driveSessionDelete(
				fixture.tui,
				() => renderText(selector).includes("Failed to delete session: disk failed"),
			);

			expect(newSession).toHaveBeenCalledTimes(1);
			expect(deleteSessionWithArtifacts).toHaveBeenCalledWith(activeSession.path);
			expect(handleResumeSession).not.toHaveBeenCalled();
			expect(ctx.showError).not.toHaveBeenCalled();
			expect(ctx.sessionManager.getSessionFile()).toBe("/tmp/project/sessions/detached.jsonl");
			expect(renderText(selector)).toContain("Failed to delete session: disk failed");
		});
	});
	it("creates a fresh session before deleting via slash command and then shows the selector", async () => {
		await withControllerFixture(async fixture => {
			const activeSessionPath = "/tmp/project/sessions/active.jsonl";
			const { ctx, calls, showHookConfirm, newSession } = createContext(fixture.tui, activeSessionPath);
			const deleteSessionWithArtifacts = vi
				.spyOn(FileSessionStorage.prototype, "deleteSessionWithArtifacts")
				.mockImplementation(async sessionPath => {
					calls.push(`delete:${sessionPath}`);
				});
			const exists = vi.spyOn(FileSessionStorage.prototype, "exists").mockResolvedValue(true);
			const controller = new SelectorController(ctx, fixture.getInputLeaseManager, fixture.scope);

			await controller.handleSessionDeleteCommand();
			await Bun.sleep(0);
			await Bun.sleep(0);

			expect(exists).toHaveBeenCalledWith(activeSessionPath);
			expect(showHookConfirm).toHaveBeenCalledWith(
				"Delete Session",
				"This will permanently delete the current session.\nYou will be returned to the session selector.",
			);
			expect(newSession).toHaveBeenCalledTimes(1);
			expect(deleteSessionWithArtifacts).toHaveBeenCalledWith(activeSessionPath);
			expect(calls).toEqual([
				"session.newSession",
				"loadingAnimation.stop",
				"statusContainer.clear",
				"pendingMessagesContainer.clear",
				"pendingTools.clear",
				"statusLine.invalidate",
				"statusLine.setSessionStartTime",
				"updateEditorTopBorder",
				"updateEditorBorderColor",
				"renderInitialMessages",
				"reloadTodos",
				"ui.requestRender",
				`delete:${activeSessionPath}`,
				"showStatus:Session deleted",
				"ui.requestRender",
				"ui.requestRender",
			]);
		});
	});
});
