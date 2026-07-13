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
	const liveMessages =
		options.liveEvidence === false
			? [{ role: "user" as const, content: [{ type: "text" as const, text: "prompt" }], timestamp: now - 2_000 }]
			: [assistantMessage];
	let listener: SessionEventListener | undefined;
	const session = {
		state: {
			messages: liveMessages,
			streamMessage: options.liveEvidence === false ? null : assistantMessage,
		},
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
			view.emit({ type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "x" } });
			await Bun.sleep(100);
			const updated = renderText(view.hub);
			expect(updated).toContain("40.0 tok/s");
			expect(updated).toContain("journal update visible");
		} finally {
			await view.dispose();
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

	it("never renders editor contents in the cockpit preview", async () => {
		const view = await fixture();
		try {
			view.hub.handleInput("i");
			for (const character of "EDITOR_SENTINEL") view.hub.handleInput(character);
			const inputMode = renderText(view.hub, 160);
			expect(inputMode).toContain("INPUT");
			expect(inputMode).not.toContain("EDITOR_SENTINEL");
			view.hub.handleInput("\u001b");
			expect(renderText(view.hub, 120)).not.toContain("EDITOR_SENTINEL");
		} finally {
			await view.dispose();
		}
	});

	it("falls back to completed transcript usage when the live state has no assistant evidence", async () => {
		const view = await fixture({ duration: 1_000, liveEvidence: false });
		try {
			expect(renderText(view.hub)).toContain("10.0 tok/s");
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

	it("opens agent pages in navigation mode and Esc exits one level", async () => {
		const view = await fixture();
		try {
			view.hub.handleInput("\r");
			expect(renderText(view.hub)).toContain("i:input");
			for (const character of "IGNORED_IN_NAV") view.hub.handleInput(character);
			expect(renderText(view.hub)).not.toContain("IGNORED_IN_NAV");

			view.hub.handleInput("i");
			for (const character of "DRAFT_IN_INPUT") view.hub.handleInput(character);
			expect(renderText(view.hub)).toContain("DRAFT_IN_INPUT");
			view.hub.handleInput("\u001b");
			expect(renderText(view.hub)).not.toContain("DRAFT_IN_INPUT");
			expect(renderText(view.hub)).toContain("Agent Hub > RateWorker");
			view.hub.handleInput("\u001b");
			expect(renderText(view.hub)).toContain("Agent Hub · tree");
			expect(view.onDone).not.toHaveBeenCalled();
			view.hub.handleInput("\u001b");
			expect(view.onDone).toHaveBeenCalledTimes(1);
		} finally {
			await view.dispose();
		}
	});

	it("lists search, modal, cycling, and rich/plain bindings in the keymap overlay", async () => {
		const view = await fixture();
		try {
			view.hub.handleInput("?");
			const legend = renderText(view.hub);
			expect(legend).toContain("/ search");
			expect(legend).toContain("i/Esc input/navigation mode");
			expect(legend).toContain("[ / ] cycle siblings");
			expect(legend).toContain("v rich/plain preview");
		} finally {
			await view.dispose();
		}
	});
});
