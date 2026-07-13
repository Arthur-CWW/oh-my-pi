/**
 * Hub Enter contract: live rows delegate to the `focusAgent` dep and close the
 * hub on success; parked rows open read-only history without revival. Focus
 * failures keep the hub open and surface the error as a notice.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import * as fs from "node:fs/promises";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry, type AgentStatus } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { CURRENT_SESSION_VERSION } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { CHILD_LIFECYCLE_CUSTOM_TYPE, type ChildLifecycleState } from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";
import { TempDir } from "@oh-my-pi/pi-utils";
const AGENT_ID = "Worker";

function liveSession(): AgentSession {
	const session: Pick<AgentSession, "subscribe"> = { subscribe: () => () => {} };
	return session as AgentSession;
}

type AgentHubControllerHarness = Pick<InteractiveModeContext, "hideThinkingBlock"> & {
	keybindings: { getKeys(key: string): string[] };
	ui: {
		showOverlay(component: AgentHubOverlayComponent): { hide(): void };
		setFocus(target: object): void;
		requestRender(): void;
	};
	editor: object;
	collabGuest: { agentRegistry: AgentRegistry; hubRemote: undefined };
	focusAgentSession(id: string): Promise<void>;
	session: { getToolByName(name: string): undefined; extensionRunner: undefined };
	sessionManager: { getCwd(): string; getSessionFile(): null };
};

function showAgentHubForHarness(
	harness: AgentHubControllerHarness,
	observers: SessionObserverRegistry,
	options?: { requireContent?: boolean },
): void {
	const args = options ? [observers, options] : [observers];
	Reflect.apply(SelectorController.prototype.showAgentHub, { ctx: harness }, args);
}

function makeHub(
	focusAgent: (id: string) => Promise<void>,
	options: { status?: AgentStatus; sessionFile?: string | null; lifecycle?: AgentLifecycleManager } = {},
) {
	const agents = new AgentRegistry();
	const status = options.status ?? "running";
	agents.register({
		id: AGENT_ID,
		displayName: AGENT_ID,
		kind: "sub",
		parentId: "Main",
		session: status === "parked" ? null : liveSession(),
		sessionFile: options.sessionFile ?? null,
		status,
	});
	let doneCalls = 0;
	const done = Promise.withResolvers<void>();
	const renderRequested = Promise.withResolvers<void>();
	const hub = new AgentHubOverlayComponent({
		observers: new SessionObserverRegistry(),
		hubKeys: [],
		onDone: () => {
			doneCalls++;
			done.resolve();
		},
		requestRender: () => renderRequested.resolve(),
		registry: agents,
		irc: new IrcBus(agents),
		lifecycle: options.lifecycle,
		focusAgent,
		externalIrc: null,
	});
	return { hub, agents, doneCalls: () => doneCalls, done: done.promise, renderRequested: renderRequested.promise };
}

function renderedText(hub: AgentHubOverlayComponent): string {
	return hub
		.render(120)
		.map(line => Bun.stripANSI(line))
		.join("\n");
}
function revealParked(hub: AgentHubOverlayComponent, id: string): void {
	hub.handleInput("/");
	for (const character of id) hub.handleInput(character);
	hub.handleInput("\r");
}

async function waitForRenderedText(hub: AgentHubOverlayComponent, text: string): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (!renderedText(hub).includes(text)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${text}`);
		await Bun.sleep(1);
	}
}

async function writeArchivedChildJournal(options: {
	file: string;
	parentFile: string;
	agentId: string;
	updatedAt: string;
	state: Extract<ChildLifecycleState, "completed" | "failed" | "interrupted">;
	modelId: string;
	thinkingLevel: string;
	message: string;
}): Promise<void> {
	const entries = [
		{
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: options.agentId,
			timestamp: options.updatedAt,
			cwd: "/tmp",
		},
		{
			type: "session_init",
			id: "init",
			parentId: null,
			timestamp: options.updatedAt,
			systemPrompt: "child",
			task: "archive test",
			tools: [],
			subagent: {
				agentId: options.agentId,
				parentSessionFile: options.parentFile,
				parentSessionId: "parent",
				displayName: options.agentId,
				model: options.modelId,
				taskDepth: 1,
				parentTaskPrefix: options.agentId,
				isolated: false,
			},
		},
		{
			type: "message",
			id: "message",
			parentId: null,
			timestamp: options.updatedAt,
			message: { role: "user", content: options.message, timestamp: Date.parse(options.updatedAt) },
		},
		{
			type: "custom",
			id: "lifecycle",
			parentId: null,
			timestamp: options.updatedAt,
			customType: CHILD_LIFECYCLE_CUSTOM_TYPE,
			data: {
				version: 1,
				agentId: options.agentId,
				childSessionFile: options.file,
				parentSessionFile: options.parentFile,
				state: options.state,
				updatedAt: options.updatedAt,
				modelId: options.modelId,
				thinkingLevel: options.thinkingLevel,
			},
		},
	];
	await Bun.write(options.file, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
}

describe("Agent hub Enter activation", () => {
	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true });
		vi.spyOn(IrcExternalBus.prototype, "listPeers").mockReturnValue([]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		resetSettingsForTest();
		AgentRegistry.resetGlobalForTests();
	});

	it("Enter focuses the selected agent and closes the hub", async () => {
		const focusedIds: string[] = [];
		const { hub, doneCalls, done } = makeHub(async id => {
			focusedIds.push(id);
		});

		hub.handleInput("\r");
		await done; // activation is fire-and-forget async; onDone signals completion

		expect(focusedIds).toEqual([AGENT_ID]);
		expect(doneCalls()).toBe(1);
		hub.dispose();
	});

	it("Enter on a parked row opens history without reviving it", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-parked-open-");
		const sessionFile = `${tempDir.path()}/Worker.jsonl`;
		await Bun.write(sessionFile, "");
		const focusedIds: string[] = [];
		const { hub, agents, doneCalls } = makeHub(
			async id => {
				focusedIds.push(id);
			},
			{ status: "parked", sessionFile },
		);

		revealParked(hub, AGENT_ID);
		hub.handleInput("\r");

		const rendered = Bun.stripANSI(hub.render(120).join("\n"));
		expect(focusedIds).toEqual([]);
		expect(doneCalls()).toBe(0);
		expect(agents.get(AGENT_ID)?.status).toBe("parked");
		expect(rendered).toContain(`Agent Hub > ${AGENT_ID}`);
		expect(rendered).toContain("No messages yet.");
		expect(rendered).toContain("R:revive");
		hub.dispose();
	});

	it("R in parked history revives without focusing the main view", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-parked-revive-");
		const sessionFile = `${tempDir.path()}/Worker.jsonl`;
		await Bun.write(sessionFile, "");
		const agents = new AgentRegistry();
		agents.register({
			id: AGENT_ID,
			displayName: AGENT_ID,
			kind: "sub",
			parentId: "Main",
			session: null,
			sessionFile,
			status: "parked",
		});
		const lifecycle = new AgentLifecycleManager(agents);
		const revived = Promise.withResolvers<void>();
		agents.onChange(event => {
			if (event.type === "status_changed" && event.ref.id === AGENT_ID && event.ref.status === "idle") {
				revived.resolve();
			}
		});
		const session = liveSession();
		lifecycle.adopt(AGENT_ID, { idleTtlMs: 0, revive: async () => session });
		let focusCalls = 0;
		const hub = new AgentHubOverlayComponent({
			observers: new SessionObserverRegistry(),
			hubKeys: [],
			onDone: () => {},
			requestRender: () => {},
			registry: agents,
			irc: new IrcBus(agents),
			lifecycle,
			focusAgent: async () => {
				focusCalls++;
			},
			externalIrc: null,
		});

		revealParked(hub, AGENT_ID);
		hub.handleInput("\r");
		hub.handleInput("R");
		await revived.promise;

		expect(focusCalls).toBe(0);
		expect(agents.get(AGENT_ID)?.status).toBe("idle");
		expect(agents.get(AGENT_ID)?.session).toBe(session);
		hub.dispose();
		await lifecycle.dispose();
	});

	it("a focus failure keeps the hub open and shows the error as a notice", async () => {
		const message = 'Agent "X" is aborted and cannot be revived';
		const { hub, doneCalls, renderRequested } = makeHub(() => Promise.reject(new Error(message)));

		hub.handleInput("\r");
		await renderRequested; // the rejection path requests a render after setting the notice

		expect(doneCalls()).toBe(0);
		const rendered = Bun.stripANSI(hub.render(120).join("\n"));
		expect(rendered).toContain(message);
		hub.dispose();
	});

	it("bounds the selected transcript tail and releases it across repeated Hub lifecycles", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-retention-");
		const sessionFile = `${tempDir.path()}/Worker.jsonl`;
		const timestamp = "2026-07-12T00:00:00.000Z";
		const entries = Array.from({ length: 2_000 }, (_, index) => ({
			type: "message",
			id: `message-${index}`,
			parentId: null,
			timestamp,
			message: { role: "user", content: `retained message ${index}`, timestamp: Date.parse(timestamp) + index },
		}));
		await Bun.write(sessionFile, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);

		for (let cycle = 0; cycle < 25; cycle++) {
			const { hub } = makeHub(async () => {}, { sessionFile });
			expect(renderedText(hub)).toContain("retained message 1999");
			expect(hub.getRetentionMetrics()).toMatchObject({
				cachedTranscriptEntries: 200,
				materializedChatComponents: 200,
				liveTimers: 1,
			});

			hub.openChat(AGENT_ID);
			hub.handleInput("\x1b");
			expect(hub.getRetentionMetrics()).toMatchObject({
				cachedTranscriptEntries: 0,
				materializedChatComponents: 0,
				liveTimers: 1,
			});

			hub.dispose();
			expect(hub.getRetentionMetrics()).toMatchObject({
				activeIdentities: 0,
				activeSearchFieldEntries: 0,
				observerEntries: 0,
				cachedTranscriptEntries: 0,
				materializedChatComponents: 0,
				externalIdentityRows: 0,
				externalOrderEntries: 0,
				liveTimers: 0,
			});
		}
	});
	it("does not promote archived session journals into the active roster", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-persisted-");
		await Bun.write(`${tempDir.path()}/main.jsonl`, "");
		await Bun.write(`${tempDir.path()}/main/Worker.jsonl`, "");
		const agents = new AgentRegistry();
		const hub = new AgentHubOverlayComponent({
			observers: new SessionObserverRegistry(),
			hubKeys: [],
			onDone: () => {},
			requestRender: () => {},
			registry: agents,
			irc: new IrcBus(agents),
			focusAgent: async () => {},
			externalIrc: null,
		});

		const rendered = Bun.stripANSI(hub.render(120).join("\n"));
		expect(rendered).toContain("no subagents yet");
		expect(rendered).not.toContain("Worker");
		expect(agents.get("Worker")).toBeUndefined();
		hub.dispose();
	});

	it("opens archived transcripts read-only with route footer and never mutates their journal or registry", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-archived-open-");
		const parentFile = `${tempDir.path()}/Main.jsonl`;
		const childrenDir = `${tempDir.path()}/Main`;
		const childFile = `${childrenDir}/Archived.jsonl`;
		await fs.mkdir(childrenDir);
		await Bun.write(parentFile, "");
		await writeArchivedChildJournal({
			file: childFile,
			parentFile,
			agentId: "Archived",
			updatedAt: "2026-07-10T03:00:00.000Z",
			state: "completed",
			modelId: "openai-codex/gpt-5.6-terra",
			thinkingLevel: "high",
			message: "archived transcript body",
		});
		const before = await Bun.file(childFile).text();
		const agents = new AgentRegistry();
		agents.register({
			id: "Main",
			displayName: "main",
			kind: "main",
			session: null,
			sessionFile: parentFile,
			status: "parked",
		});
		const hub = new AgentHubOverlayComponent({
			observers: new SessionObserverRegistry(),
			hubKeys: [],
			onDone: () => {},
			requestRender: () => {},
			registry: agents,
			irc: new IrcBus(agents),
			focusAgent: async () => {},
			externalIrc: null,
		});

		await waitForRenderedText(hub, "Archived");
		hub.handleInput("\r");
		const opened = renderedText(hub);
		expect(opened).toContain("archived transcript body");
		expect(opened).toContain("openai-codex/gpt-5.6-terra:high");
		expect(opened).toContain("completed archived · openai-codex/gpt-5.6-terra:high · read-only");
		expect(opened).not.toContain("Enter:send");
		expect(opened).not.toContain("R:revive");

		hub.handleInput("R");
		hub.handleInput("x");
		hub.handleInput("s");
		hub.handleInput("\r");
		expect(await Bun.file(childFile).text()).toBe(before);
		expect(agents.get("Archived")).toBeUndefined();

		hub.handleInput("h");
		hub.handleInput("r");
		hub.handleInput("x");
		expect(renderedText(hub)).toContain("Completed children are read-only.");
		expect(await Bun.file(childFile).text()).toBe(before);
		expect(agents.list().map(ref => ref.id)).toEqual(["Main"]);
		hub.dispose();
	});

	it("cycles archived transcripts with brackets and Ctrl-s, then restores the drilled cursor on back", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-archived-cycle-");
		const parentFile = `${tempDir.path()}/Main.jsonl`;
		const childrenDir = `${tempDir.path()}/Main`;
		await fs.mkdir(childrenDir);
		await Bun.write(parentFile, "");
		await writeArchivedChildJournal({
			file: `${childrenDir}/Newest.jsonl`,
			parentFile,
			agentId: "Newest",
			updatedAt: "2026-07-10T03:00:00.000Z",
			state: "completed",
			modelId: "openai-codex/gpt-5.6-terra",
			thinkingLevel: "high",
			message: "newest transcript",
		});
		await writeArchivedChildJournal({
			file: `${childrenDir}/Older.jsonl`,
			parentFile,
			agentId: "Older",
			updatedAt: "2026-07-10T02:00:00.000Z",
			state: "failed",
			modelId: "openai-codex/gpt-5.6-terra",
			thinkingLevel: "medium",
			message: "older transcript",
		});
		const agents = new AgentRegistry();
		agents.register({
			id: "Main",
			displayName: "main",
			kind: "main",
			session: null,
			sessionFile: parentFile,
			status: "parked",
		});
		const hub = new AgentHubOverlayComponent({
			observers: new SessionObserverRegistry(),
			hubKeys: [],
			onDone: () => {},
			requestRender: () => {},
			registry: agents,
			irc: new IrcBus(agents),
			focusAgent: async () => {},
			externalIrc: null,
		});

		await waitForRenderedText(hub, "Newest");
		hub.handleInput("\r");
		expect(renderedText(hub)).toContain("Agent Hub > Newest");
		hub.handleInput("]");
		expect(renderedText(hub)).toContain("Agent Hub > Older");
		hub.handleInput("[");
		expect(renderedText(hub)).toContain("Agent Hub > Newest");
		hub.handleInput("\x13");
		hub.handleInput("n");
		expect(renderedText(hub)).toContain("Agent Hub > Older");
		hub.handleInput("\x13");
		hub.handleInput("p");
		expect(renderedText(hub)).toContain("Agent Hub > Newest");
		hub.handleInput("\x13");
		hub.handleInput("n");
		expect(renderedText(hub)).toContain("Agent Hub > Older");

		hub.handleInput("h");
		hub.handleInput("\r");
		expect(renderedText(hub)).toContain("Agent Hub > Older");
		hub.dispose();
	});

	it("selector controller restores focus to the editor after Enter focuses an agent", async () => {
		const agents = AgentRegistry.global();
		agents.register({
			id: AGENT_ID,
			displayName: AGENT_ID,
			kind: "sub",
			parentId: "Main",
			session: liveSession(),
			sessionFile: null,
			status: "running",
		});

		const editor = {};
		let capturedHub: AgentHubOverlayComponent | undefined;
		let hideCalls = 0;
		const focusedIds: string[] = [];
		const focusResolved = Promise.withResolvers<void>();
		const editorFocused = Promise.withResolvers<void>();
		const focusTargets: object[] = [];
		const ctx: AgentHubControllerHarness = {
			keybindings: { getKeys: () => [] },
			ui: {
				showOverlay: component => {
					capturedHub = component;
					return {
						hide: () => {
							hideCalls++;
						},
					};
				},
				setFocus: target => {
					focusTargets.push(target);
					if (target === editor) editorFocused.resolve();
				},
				requestRender: () => {},
			},
			editor,
			collabGuest: { agentRegistry: agents, hubRemote: undefined },
			focusAgentSession: async id => {
				focusedIds.push(id);
				focusResolved.resolve();
			},
			session: { getToolByName: () => undefined, extensionRunner: undefined },
			sessionManager: { getCwd: () => "/tmp", getSessionFile: () => null },
			hideThinkingBlock: false,
		};
		showAgentHubForHarness(ctx, new SessionObserverRegistry());

		if (!capturedHub) throw new Error("Expected Agent Hub overlay");
		const shownHub = capturedHub;
		expect(focusTargets[0]).toBe(shownHub);

		shownHub.handleInput("\r");
		await focusResolved.promise;
		await editorFocused.promise;

		expect(focusedIds).toEqual([AGENT_ID]);
		expect(hideCalls).toBe(1);
		expect(focusTargets.at(-1)).toBe(editor);
		shownHub.dispose();
	});
});

describe("Agent hub double-← gating", () => {
	beforeAll(() => {
		initTheme();
	});

	beforeEach(() => {
		vi.spyOn(IrcExternalBus.prototype, "listPeers").mockReturnValue([]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		resetSettingsForTest();
		AgentRegistry.resetGlobalForTests();
	});

	function setup(agents: AgentRegistry) {
		let shown: AgentHubOverlayComponent | undefined;
		const ctx: AgentHubControllerHarness = {
			keybindings: { getKeys: () => [] },
			ui: {
				showOverlay: component => {
					shown = component;
					return { hide: () => {} };
				},
				setFocus: () => {},
				requestRender: () => {},
			},
			editor: {},
			collabGuest: { agentRegistry: agents, hubRemote: undefined },
			focusAgentSession: async () => {},
			session: { getToolByName: () => undefined, extensionRunner: undefined },
			sessionManager: { getCwd: () => "/tmp", getSessionFile: () => null },
			hideThinkingBlock: false,
		};
		const controller = {
			showAgentHub: (observers: SessionObserverRegistry, options?: { requireContent?: boolean }) =>
				showAgentHubForHarness(ctx, observers, options),
		};
		return { controller, shown: () => shown };
	}

	function registerWorker(agents: AgentRegistry) {
		agents.register({
			id: AGENT_ID,
			displayName: AGENT_ID,
			kind: "sub",
			parentId: "Main",
			session: liveSession(),
			sessionFile: null,
			status: "running",
		});
	}

	it("requireContent keeps the hub closed when only Main is registered", () => {
		const agents = AgentRegistry.global();
		agents.register({
			id: "Main",
			displayName: "Main",
			kind: "main",
			session: null,
			sessionFile: null,
			status: "running",
		});
		const { controller, shown } = setup(agents);

		controller.showAgentHub(new SessionObserverRegistry(), { requireContent: true });

		expect(shown()).toBeUndefined();
	});

	it("requireContent opens the hub once a subagent exists", () => {
		const agents = AgentRegistry.global();
		registerWorker(agents);
		const { controller, shown } = setup(agents);

		controller.showAgentHub(new SessionObserverRegistry(), { requireContent: true });

		expect(shown()).toBeDefined();
		shown()!.dispose();
	});

	it("the explicit hub key opens the empty roster even with no subagents", () => {
		const agents = AgentRegistry.global();
		const { controller, shown } = setup(agents);

		controller.showAgentHub(new SessionObserverRegistry());

		expect(shown()).toBeDefined();
		shown()!.dispose();
	});
});
