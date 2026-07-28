import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry, type AgentStatus } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";

type SessionEventListener = Parameters<AgentSession["subscribe"]>[0];

function journalMessage(message: object, id: string): string {
	return `${JSON.stringify({ type: "message", id, parentId: null, timestamp: new Date().toISOString(), message })}\n`;
}

function renderText(hub: AgentHubOverlayComponent, width = 160): string {
	return Bun.stripANSI(hub.render(width).join("\n"));
}

async function waitForText(hub: AgentHubOverlayComponent, expected: string): Promise<string> {
	const deadline = Date.now() + 1_000;
	let rendered = renderText(hub);
	while (!rendered.includes(expected)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${expected}`);
		await Bun.sleep(10);
		rendered = renderText(hub);
	}
	return rendered;
}
async function fixture(
	options: { status?: AgentStatus; output?: number; duration?: number; liveEvidence?: boolean } = {},
) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-hub-rate-"));
	const sessionFile = path.join(directory, "child.jsonl");
	const now = Date.now();
	await Bun.write(
		sessionFile,
		journalMessage(
			{
				role: "assistant",
				content: [{ type: "text", text: "first live text" }],
				timestamp: now - 1_000,
				duration: options.duration,
				usage: { input: 1, output: options.output ?? 10, cacheRead: 0, cacheWrite: 0, cost: 0 },
				model: "test-model",
				provider: "test-provider",
				stopReason: "stop",
			},
			"first",
		),
	);
	const assistantMessage = {
		role: "assistant" as const,
		content: [{ type: "text" as const, text: "first live text" }],
		timestamp: now - 1_000,
		duration: options.duration,
		usage: { input: 1, output: options.output ?? 10, cacheRead: 0, cacheWrite: 0, cost: 0 },
		model: "test-model",
		provider: "test-provider",
		stopReason: "stop" as const,
	};
	const liveMessages = [
		{ role: "user" as const, content: [{ type: "text" as const, text: "prompt" }], timestamp: now - 2_000 },
	];
	const state: {
		messages: typeof liveMessages;
		streamMessage: typeof assistantMessage | null;
	} = {
		messages: liveMessages,
		streamMessage: options.liveEvidence === false ? null : assistantMessage,
	};
	let listener: SessionEventListener | undefined;
	const session = {
		state,
		// A task child can remain registry-running while AgentSession's transient
		// streaming getter is false from the Hub's observation point.
		get isStreaming() {
			return false;
		},
		subscribe(next: SessionEventListener) {
			listener = next;
			return () => {
				listener = undefined;
			};
		},
	} as unknown as AgentSession;
	const registry = new AgentRegistry();
	registry.register({
		id: "AIdleWorker",
		displayName: "AIdleWorker",
		kind: "sub",
		session,
		status: "idle",
	});
	registry.register({
		id: "RateWorker",
		displayName: "RateWorker",
		kind: "sub",
		session,
		sessionFile,
		status: options.status ?? "running",
	});
	const onDone = vi.fn();
	const hub = new AgentHubOverlayComponent({
		observers: new SessionObserverRegistry(),
		hubKeys: [],
		registry,
		irc: new IrcBus(registry),
		onDone,
		requestRender: () => {},
	});
	hub.handleInput("n");
	hub.handleInput("p");
	return {
		hub,
		registry,
		sessionFile,
		setLiveOutput(output: number) {
			assistantMessage.usage.output = output;
		},
		setLiveText(text: string) {
			assistantMessage.content[0]!.text = text;
		},
		async completeLive(text: string) {
			assistantMessage.content[0]!.text = text;
			await fs.appendFile(sessionFile, journalMessage(assistantMessage, "completed-live"));
			state.streamMessage = null;
		},
		emit(event: object) {
			Reflect.apply(listener!, session, [event]);
		},
		onDone,
		async dispose() {
			hub.dispose();
			await fs.rm(directory, { recursive: true, force: true });
		},
	};
}

beforeAll(async () => initTheme());
beforeEach(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
});
afterEach(() => {
	vi.useRealTimers();
	resetSettingsForTest();
});

describe("Agent Hub live token rate preview", () => {
	it("updates the badge and transcript through the debounced live journal path", async () => {
		const view = await fixture({ duration: 1_000 });
		try {
			expect(renderText(view.hub)).toContain("10.0 tok/s");
			await fs.appendFile(
				view.sessionFile,
				journalMessage(
					{
						role: "assistant",
						content: [{ type: "text", text: "journal update visible" }],
						timestamp: Date.now() - 1_000,
						duration: 1_000,
						usage: { input: 1, output: 40, cacheRead: 0, cacheWrite: 0, cost: 0 },
						model: "test-model",
						provider: "test-provider",
						stopReason: "stop",
					},
					"update",
				),
			);
			view.setLiveOutput(40);
			view.emit({
				type: "message_update",
				message: { role: "assistant" },
				assistantMessageEvent: { type: "text_delta", delta: "x" },
			});
			await Bun.sleep(100);
			const updated = renderText(view.hub);
			expect(updated).toContain("40.0 tok/s");
			expect(updated).toContain("journal update visible");
		} finally {
			await view.dispose();
		}
	});

	it("renders bounded live deltas without rescanning finalized history", async () => {
		const view = await fixture({ duration: 1_000 });
		try {
			view.setLiveText(`discarded prefix sentinel${"x".repeat(300_000)} visible bounded suffix`);
			view.emit({
				type: "message_update",
				message: { role: "assistant" },
				assistantMessageEvent: { type: "text_delta", delta: "suffix" },
			});
			await Bun.sleep(100);
			const bounded = renderText(view.hub);
			expect(bounded).toContain("visible bounded suffix");
			expect(bounded).not.toContain("discarded prefix sentinel");
			renderText(view.hub);
			const baselineScans = view.hub.getRetentionMetrics().previewFinalizedPrefixScans;
			for (let index = 1; index <= 4; index++) {
				view.setLiveText(`production-shaped live delta ${index}`);
				view.emit({
					type: "message_update",
					message: { role: "assistant" },
					assistantMessageEvent: { type: "text_delta", delta: String(index) },
				});
				await Bun.sleep(100);
				expect(renderText(view.hub)).toContain(`production-shaped live delta ${index}`);
			}
			expect(view.hub.getRetentionMetrics().previewFinalizedPrefixScans).toBe(baselineScans);
		} finally {
			await view.dispose();
		}
	});

	it("hands a completed live message to the journal without duplication", async () => {
		const view = await fixture({ duration: 1_000 });
		try {
			view.setLiveText("handoff sentinel");
			view.emit({
				type: "message_update",
				message: { role: "assistant" },
				assistantMessageEvent: { type: "text_delta", delta: "sentinel" },
			});
			await Bun.sleep(100);
			expect(renderText(view.hub)).toContain("handoff sentinel");

			await view.completeLive("handoff sentinel");
			view.emit({ type: "message_end", message: { role: "assistant" } });
			const completed = await waitForText(view.hub, "handoff sentinel");
			expect(completed.split("handoff sentinel")).toHaveLength(2);
		} finally {
			await view.dispose();
		}
	});

	it("does not project transient state for idle or parked children", async () => {
		const idle = await fixture({ status: "idle" });
		const parked = await fixture({ status: "parked" });
		try {
			idle.setLiveText("idle transient sentinel");
			parked.setLiveText("parked transient sentinel");
			expect(renderText(idle.hub)).not.toContain("idle transient sentinel");
			expect(renderText(parked.hub)).not.toContain("parked transient sentinel");
		} finally {
			await idle.dispose();
			await parked.dispose();
		}
	});

	it("omits the badge with insufficient duration and while idle", async () => {
		const tooNew = await fixture({ duration: 50 });
		const idle = await fixture({ duration: 1_000, status: "idle" });
		try {
			expect(renderText(tooNew.hub)).not.toContain("tok/s");
			expect(renderText(idle.hub)).not.toContain("tok/s");
		} finally {
			await tooNew.dispose();
			await idle.dispose();
		}
	});

	it("keeps the cockpit preview read-only when i or printable text is pressed", async () => {
		const view = await fixture();
		try {
			view.hub.handleInput("i");
			for (const character of "EDITOR_SENTINEL") view.hub.handleInput(character);
			const preview = renderText(view.hub, 160);
			expect(preview).not.toContain("INPUT");
			expect(preview).not.toContain("EDITOR_SENTINEL");
			expect(preview).not.toContain("Ctrl+Enter");
		} finally {
			await view.dispose();
		}
	});

	it("falls back to completed transcript usage when the live state has no assistant evidence", async () => {
		const view = await fixture({ duration: 1_000, liveEvidence: false });
		try {
			expect(await waitForText(view.hub, "10.0 tok/s")).toContain("10.0 tok/s");
		} finally {
			await view.dispose();
		}
	});

	it("exits empty roster search with Backspace or Esc", async () => {
		const view = await fixture();
		try {
			view.hub.handleInput("/");
			for (const character of "Rate") view.hub.handleInput(character);
			for (let index = 0; index < 4; index++) view.hub.handleInput("\x7f");
			expect(renderText(view.hub)).toContain("/▏");
			view.hub.handleInput("\x7f");
			expect(renderText(view.hub)).not.toContain("/▏");

			view.hub.handleInput("/");
			view.hub.handleInput("x");
			view.hub.handleInput("\u001b");
			expect(renderText(view.hub)).not.toContain("/x");
			expect(view.onDone).not.toHaveBeenCalled();
		} finally {
			await view.dispose();
		}
	});

	it("opens agent pages read-only and Esc exits one level", async () => {
		const view = await fixture();
		try {
			view.hub.handleInput("\r");
			const opened = renderText(view.hub);
			expect(opened).not.toContain("i:input");
			expect(opened).not.toContain("Ctrl+Enter");
			view.hub.handleInput("i");
			view.hub.handleInput("x");
			expect(renderText(view.hub)).not.toContain("DRAFT_IN_INPUT");

			view.hub.handleInput("\u001b");
			expect(renderText(view.hub)).toContain("Agent Hub · tree");
			expect(view.onDone).not.toHaveBeenCalled();
			view.hub.handleInput("\u001b");
			expect(view.onDone).toHaveBeenCalledTimes(1);
		} finally {
			await view.dispose();
		}
	});

	it("lists read-only scrolling, search, cycling, and rich/plain bindings in the keymap overlay", async () => {
		const view = await fixture();
		try {
			view.hub.handleInput("?");
			const legend = renderText(view.hub);
			expect(legend).toContain("/ search");
			expect(legend).toContain("J scroll five lines down");
			expect(legend).toContain("K scroll five lines up");
			expect(legend).toContain("[ / ] cycle siblings");
			expect(legend).toContain("v rich/plain preview");
			expect(legend).not.toContain("input/navigation mode");
		} finally {
			await view.dispose();
		}
	});
});
