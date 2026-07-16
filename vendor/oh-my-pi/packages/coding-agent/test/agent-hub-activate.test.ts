/**
 * Hub Enter contract: every row opens a transcript preview. Only lifecycle-
 * attachable local agents allow `i` to switch to the main composer; read-only
 * rows never invoke focus.
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
		showOverlay(component: AgentHubOverlayComponent, options?: Record<string, unknown>): { hide(): void };
		setFocus(target: object): void;
		requestRender(): void;
	};
	editor: object;
	collabGuest: { agentRegistry: AgentRegistry; hubRemote: undefined };
	focusAgentHubInput(id: string): Promise<void>;
	session: { getToolByName(name: string): undefined; extensionRunner: undefined };
	sessionManager: { getCwd(): string; getSessionFile(): null; getSessionId(): string };
};

function showAgentHubForHarness(
	harness: AgentHubControllerHarness,
	observers: SessionObserverRegistry,
	options?: { requireContent?: boolean },
): void {
	const controller = new SelectorController(harness as unknown as InteractiveModeContext);
	controller.showAgentHub(observers, options);
}

function makeHub(
	focusAgent: (id: string) => Promise<void>,
	options: {
		status?: AgentStatus;
		sessionFile?: string | null;
		lifecycle?: AgentLifecycleManager;
		revive?: () => Promise<AgentSession>;
		sessionId?: string;
		copyIdentity?: (payload: string) => void;
	} = {},
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
	const lifecycle = options.lifecycle ?? (options.revive ? new AgentLifecycleManager(agents) : undefined);
	if (options.revive) lifecycle?.adopt(AGENT_ID, { idleTtlMs: 0, revive: options.revive });
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
		lifecycle,
		focusAgent,
		externalIrc: null,
		sessionId: options.sessionId,
		copyIdentity: options.copyIdentity,
	});
	return {
		hub,
		agents,
		lifecycle,
		doneCalls: () => doneCalls,
		done: done.promise,
		renderRequested: renderRequested.promise,
	};
}

it("c and C copy semantic Hub row units instead of characters", async () => {
	await initTheme();
	const copied: string[] = [];
	const { hub } = makeHub(async () => {}, { copyIdentity: payload => copied.push(payload) });
	hub.handleInput("c");
	hub.handleInput("C");
	await Bun.sleep(0);
	expect(copied).toEqual(["Worker", "Worker · running · parent Main"]);
	hub.dispose();
});

it("y yanks the selected child's session handle and history URL", async () => {
	await initTheme();
	const copied: string[] = [];
	const { hub } = makeHub(async () => {}, {
		sessionId: "019f6141-df73-7000-b792-985f12d9db5d",
		copyIdentity: payload => { copied.push(payload); },
	});
	hub.handleInput("y");
	await Bun.sleep(0);
	expect(copied).toEqual(["019f6141-df73-7000-b792-985f12d9db5d/Worker\nhistory://Worker"]);
	expect(renderedText(hub)).toContain("Yanked 019f6141-df73-7000-b792-985f12d9db5d/Worker + history://Worker");
	hub.dispose();
});
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
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("Enter on a running agent opens read-only preview and never reaches the no-reviver error", () => {
		const message =
			'Agent "Worker" is running and cannot be revived (no reviver registered). Its transcript remains readable at history://Worker.';
		let focusCalls = 0;
		const { hub, doneCalls } = makeHub(() => {
			focusCalls++;
			return Promise.reject(new Error(message));
		});

		hub.handleInput("\r");
		let rendered = renderedText(hub);
		expect(rendered).toContain(`Agent Hub > ${AGENT_ID}`);
		expect(rendered).toContain("read-only — running");
		expect(rendered).not.toContain(message);
		expect(focusCalls).toBe(0);
		expect(doneCalls()).toBe(0);

		hub.handleInput("i");
		rendered = renderedText(hub);
		expect(rendered).toContain("input unavailable");
		expect(rendered).not.toContain(message);
		expect(focusCalls).toBe(0);
		hub.dispose();
	});

	it("Enter on a revivable parked row opens attachable preview; i focuses the composer", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-parked-open-");
		const sessionFile = `${tempDir.path()}/Worker.jsonl`;
		await Bun.write(sessionFile, "");
		const focusedIds: string[] = [];
		const { hub, agents, lifecycle, doneCalls, done } = makeHub(
			async id => {
				focusedIds.push(id);
			},
			{ status: "parked", sessionFile, revive: async () => liveSession() },
		);

		revealParked(hub, AGENT_ID);
		hub.handleInput("\r");

		const rendered = renderedText(hub);
		expect(focusedIds).toEqual([]);
		expect(doneCalls()).toBe(0);
		expect(agents.get(AGENT_ID)?.status).toBe("parked");
		expect(rendered).toContain(`Agent Hub > ${AGENT_ID}`);
		expect(rendered).toContain("No messages yet.");
		expect(rendered).toContain("i:focus input");

		hub.handleInput("i");
		await done;
		expect(focusedIds).toEqual([AGENT_ID]);
		expect(doneCalls()).toBe(1);
		hub.dispose();
		await lifecycle?.dispose();
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

	it("a non-revivable parked row stays read-only and Esc returns to the roster", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-non-revivable-");
		const sessionFile = `${tempDir.path()}/Worker.jsonl`;
		await Bun.write(sessionFile, "");
		let focusCalls = 0;
		const { hub } = makeHub(
			async () => {
				focusCalls++;
			},
			{ status: "parked", sessionFile },
		);

		revealParked(hub, AGENT_ID);
		hub.handleInput("\r");
		expect(renderedText(hub)).toContain("read-only — no reviver");
		hub.handleInput("i");
		expect(focusCalls).toBe(0);
		expect(renderedText(hub)).toContain("input unavailable");
		hub.handleInput("\x1b");
		expect(renderedText(hub)).not.toContain(`Agent Hub > ${AGENT_ID}`);
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
			await waitForRenderedText(hub, "retained message 1999");
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
		const copied: string[] = [];
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
			copyIdentity: payload => { copied.push(payload); },
		});

		await waitForRenderedText(hub, "Archived");
		hub.handleInput("\r");
		await waitForRenderedText(hub, "archived transcript body");
		const opened = renderedText(hub);
		expect(opened).toContain("archived transcript body");
		expect(opened).toContain("openai-codex/gpt-5.6-terra:high");
		expect(opened).toContain("completed archived · openai-codex/gpt-5.6-terra:high · read-only");
		expect(opened).not.toContain("Enter:send");
		expect(opened).not.toContain("R:revive");

		hub.handleInput("c");
		hub.handleInput("C");
		await Bun.sleep(0);
		expect(copied[0]?.length).toBeGreaterThan(1);
		expect(copied[1]).toContain("archived transcript body");

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

	it("does not use brackets for duplicate archived transcript navigation", async () => {
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
		expect(renderedText(hub)).toContain("Agent Hub > Newest");
		hub.handleInput("[");
		expect(renderedText(hub)).toContain("Agent Hub > Newest");

		hub.handleInput("h");
		hub.handleInput("\r");
		expect(renderedText(hub)).toContain("Agent Hub > Newest");
		hub.dispose();
	});

	it("selector controller keeps Enter in preview, then i focuses the editor", async () => {
		const agents = AgentRegistry.global();
		agents.register({
			id: AGENT_ID,
			displayName: AGENT_ID,
			kind: "sub",
			parentId: "Main",
			session: liveSession(),
			sessionFile: null,
			status: "idle",
		});
		AgentLifecycleManager.global().adopt(AGENT_ID, { idleTtlMs: 0 });

		const editor = {};
		let capturedHub: AgentHubOverlayComponent | undefined;
		let overlayOptions: Record<string, unknown> | undefined;
		let hideCalls = 0;
		const focusedIds: string[] = [];
		const focusResolved = Promise.withResolvers<void>();
		const editorFocused = Promise.withResolvers<void>();
		const focusTargets: object[] = [];
		const ctx: AgentHubControllerHarness = {
			keybindings: { getKeys: () => [] },
			ui: {
				showOverlay: (component, options) => {
					capturedHub = component;
					overlayOptions = options;
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
			focusAgentHubInput: async id => {
				focusedIds.push(id);
				focusResolved.resolve();
			},
			session: { getToolByName: () => undefined, extensionRunner: undefined },
			sessionManager: { getCwd: () => "/tmp", getSessionFile: () => null, getSessionId: () => "session-test" },
			hideThinkingBlock: false,
		};
		showAgentHubForHarness(ctx, new SessionObserverRegistry());

		if (!capturedHub) throw new Error("Expected Agent Hub overlay");
		const shownHub = capturedHub;
		expect(focusTargets[0]).toBe(shownHub);
		expect(overlayOptions).toMatchObject({ fullscreen: true });

		shownHub.handleInput("\r");
		expect(focusedIds).toEqual([]);
		expect(hideCalls).toBe(0);
		shownHub.handleInput("i");
		await editorFocused.promise;

		expect(focusedIds).toEqual([AGENT_ID]);
		expect(hideCalls).toBe(1);
		expect(focusTargets.at(-1)).toBe(editor);
		shownHub.dispose();
	});
});

describe("Agent hub external transcript preview", () => {
	beforeAll(() => {
		initTheme();
	});

	it("opens an external journal read-only with a friendly session title", async () => {
		using tempDir = TempDir.createSync("@omp-agent-hub-external-preview-");
		const previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
		process.env.OMP_SESSION_CONTROL_DB = `${tempDir.path()}/session-control.sqlite`;
		const bus = new IrcExternalBus(`${tempDir.path()}/irc-bus.sqlite`);
		let hub: AgentHubOverlayComponent | undefined;
		try {
			const sessionFile = `${tempDir.path()}/external.jsonl`;
			const timestamp = "2026-07-16T08:00:00.000Z";
			const entries = [
				{
					type: "session",
					version: CURRENT_SESSION_VERSION,
					id: "019f6699-32f0-7000-9000-000000000000",
					timestamp,
					cwd: `${tempDir.path()}/workstreams/alpha`,
				},
				{
					type: "session_init",
					id: "external-init",
					parentId: null,
					timestamp,
					systemPrompt: "External peer system prompt from the journal head.",
					task: "First external user message from session init.",
					tools: [],
					subagent: {
						agentId: "Main",
						parentSessionFile: sessionFile,
						parentSessionId: "external-parent",
						displayName: "Main",
						model: "openai-codex/gpt-5.6",
						taskDepth: 1,
						parentTaskPrefix: "Main",
						isolated: false,
					},
				},
				{
					type: "message",
					id: "external-message",
					parentId: null,
					timestamp,
					message: { role: "user", content: "external transcript content", timestamp: Date.parse(timestamp) },
				},
			];
			for (let index = 0; index < 40; index++) {
				entries.push({
					type: "message",
					id: `external-message-${index}`,
					parentId: null,
					timestamp,
					message: { role: "user", content: `peer journal line ${index}`, timestamp: Date.parse(timestamp) },
				});
			}
			await Bun.write(sessionFile, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
			const rawHandle = "019f6699-32f0-7000-9000-000000000000/Main";
			bus.registerPeer({
				sessionId: "019f6699-32f0-7000-9000-000000000000",
				name: rawHandle,
				cwd: `${tempDir.path()}/workstreams/alpha`,
				sessionFile,
			});
			let focusCalls = 0;
			const agents = new AgentRegistry();
			hub = new AgentHubOverlayComponent({
				observers: new SessionObserverRegistry(),
				hubKeys: [],
				onDone: () => {},
				requestRender: () => {},
				registry: agents,
				irc: new IrcBus(agents),
				focusAgent: async () => {
					focusCalls++;
				},
				externalIrc: bus,
				externalSessionId: "current-test-session",
			});

			await waitForRenderedText(hub, "OX5.6gpt");
			let rendered = renderedText(hub);
			expect(rendered).toContain("System prompt");
			expect(rendered).toContain("External peer system prompt from the journal head.");
			expect(rendered).toContain("First user message");
			expect(rendered).toContain("First external user message from session init.");

			hub.handleInput("\r");
			await waitForRenderedText(hub, "peer journal line 39");
			rendered = renderedText(hub);
			expect(rendered).toContain("Agent Hub > Main · alpha ·");
			expect(rendered).toContain("read-only — external session");
			expect(rendered).not.toContain(rawHandle);
			hub.handleInput("u");
			const scrolledUp = renderedText(hub);
			expect(scrolledUp).not.toBe(rendered);
			hub.handleInput("j");
			expect(renderedText(hub)).not.toBe(scrolledUp);
			hub.handleInput("d");
			expect(renderedText(hub)).toContain("peer journal line 39");

			hub.handleInput("i");
			rendered = renderedText(hub);
			expect(rendered).toContain("input unavailable");
			expect(focusCalls).toBe(0);
		} finally {
			hub?.dispose();
			bus.close();
			if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
			else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
		}
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
			focusAgentHubInput: async () => {},
			session: { getToolByName: () => undefined, extensionRunner: undefined },
			sessionManager: { getCwd: () => "/tmp", getSessionFile: () => null, getSessionId: () => "session-test" },
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
