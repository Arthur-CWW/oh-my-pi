import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getHubModel, pressHub } from "./helpers/agent-hub-input";
import { beforeAll, describe, expect, it } from "bun:test";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { AttentionLedger } from "@oh-my-pi/pi-coding-agent/session/attention-ledger";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import {
	type AgentHubAttentionInterpreter,
	AgentHubOverlayComponent,
	createAgentHubMvuMountSpec,
	reduceAgentHubMvuInput,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { setKeybindings } from "@oh-my-pi/pi-tui";


beforeAll(async () => {
	setKeybindings(KeybindingsManager.inMemory());
	await initTheme(false);
});

function press(hub: AgentHubOverlayComponent, sequence: string): void {
	pressHub(hub, sequence);
}

function text(hub: AgentHubOverlayComponent): string {
	return Bun.stripANSI(hub.render(120).join("\n"));
}

function fixture(attention: AgentHubAttentionInterpreter) {
	const registry = new AgentRegistry();
	registry.register({ id: "Alpha", displayName: "Alpha", kind: "sub", session: null, status: "running" });
	registry.register({ id: "Beta", displayName: "Beta", kind: "sub", session: null, status: "running" });
	const observers = new SessionObserverRegistry();
	const hub = new AgentHubOverlayComponent({
		observers,
		hubKeys: [],
		onDone: () => {},
		requestRender: () => {},
		registry,
		irc: new IrcBus(registry),
		externalIrc: null,
		attention,
	});
	return { hub, registry, observers };
}

describe("Agent Hub attention MVU route", () => {
	it("shows the staged target and durable receipt without deleting Hidden rows", async () => {
		const calls: string[] = [];
		const receipt = Promise.withResolvers<{ receiptId: string; message: string }>();
		const { hub, observers } = fixture({
			commit(target, action) {
				calls.push(`${target.key}:${action}`);
				return receipt.promise;
			},
		});
		try {
			press(hub, "a");
			expect(text(hub)).toContain("Triage Alpha");
			press(hub, "h");
			expect(text(hub)).toContain("hidden staged · Enter to commit · Esc to back");
			press(hub, "\r");
			receipt.resolve({ receiptId: "ledger-7", message: "hidden recorded" });
			await receipt.promise;
			await Promise.resolve();
			const rendered = text(hub);
			expect(calls).toEqual(["agent:Alpha:hidden"]);
			expect(rendered).toContain("Receipt ledger-7: hidden recorded");
			expect(rendered).toContain("Alpha");
		} finally {
			hub.dispose();
			observers.dispose();
		}
	});

	it("preserves stable selection across source refresh", () => {
		const { hub, registry, observers } = fixture({
			commit: async () => ({ receiptId: "unused", message: "unused" }),
		});
		try {
			press(hub, "j");
			expect(hub.getSelectedSelection()?.id).toBe("Beta");
			registry.setStatus("Alpha", "idle");
			hub.render(120);
			expect(hub.getSelectedSelection()?.id).toBe("Beta");
		} finally {
			hub.dispose();
			observers.dispose();
		}
	});

	it("fences a stale attention receipt after selection changes", async () => {
		const pending = Promise.withResolvers<{ receiptId: string; message: string }>();
		const { hub, observers } = fixture({ commit: () => pending.promise });
		try {
			press(hub, "a");
			press(hub, "n");
			press(hub, "\r");
			press(hub, "j");
			pending.resolve({ receiptId: "stale", message: "must not render" });
			await pending.promise;
			await Promise.resolve();
			expect(hub.getSelectedSelection()?.id).toBe("Beta");
			expect(text(hub)).not.toContain("Receipt stale");
		} finally {
			hub.dispose();
			observers.dispose();
		}
	});
	it("commits pending-g, triage, focus, and staged receipts into the replayable route model", () => {
		const pending = Promise.withResolvers<{ receiptId: string; message: string }>();
		const { hub, observers } = fixture({ commit: () => pending.promise });
		try {
			press(hub, "g");
			expect(getHubModel(hub).viewer.pendingG).toBe(true);
			press(hub, "\x1b");
			expect(getHubModel(hub).viewer.pendingG).toBe(false);

			press(hub, "a");
			expect(getHubModel(hub).focus).toBe("triage");
			expect(getHubModel(hub).viewer.triage?.target.label).toBe("Alpha");
			press(hub, "n");
			expect(getHubModel(hub).viewer.triage?.staged).toBe("now");
			press(hub, "\r");

			const committed = getHubModel(hub);
			expect(committed.focus).toBe("list");
			expect(committed.viewer).toEqual({ pendingG: false });
			expect(committed.stagedReceipt).toMatchObject({
				target: { key: "agent:Alpha", label: "Alpha" },
				action: "now",
				state: "pending",
			});

			hub.applyMvuModel(committed);
			expect(text(hub)).toContain("Committing now for Alpha");
		} finally {
			hub.dispose();
			observers.dispose();
		}
	});

	it("replays captured triage input deterministically without touching the renderer", () => {
		const pending = Promise.withResolvers<{ receiptId: string; message: string }>();
		const { hub, observers } = fixture({ commit: () => pending.promise });
		try {
			const spec = createAgentHubMvuMountSpec(hub);
			const event = (sequence: string) => {
				const decoded = makeTerminalInputAdapter().decode(sequence);
				if (decoded === undefined || decoded._tag === "Mouse" || decoded._tag === "Paste") {
					throw new Error(`Expected key event for ${JSON.stringify(sequence)}`);
				}
				return decoded;
			};
			const messages = [
				hub.createMvuInput("app.attention.open", event("a")),
				hub.createMvuInput("app.attention.hidden", event("h")),
				hub.createMvuInput("tui.select.confirm", event("\r")),
			] as const;
			const replay = () =>
				messages.reduce(
					(model, message) => reduceAgentHubMvuInput(model, message).model,
					spec.initialModel,
				);

			const first = replay();
			const second = replay();
			expect(first).toEqual(second);
			expect(first.stagedReceipt).toMatchObject({
				target: { key: "agent:Alpha", label: "Alpha" },
				action: "hidden",
				state: "pending",
			});
			expect(hub.captureMvuModel(0)).toEqual(spec.initialModel);
		} finally {
			hub.dispose();
			observers.dispose();
		}
	});

	it("commits triage through the production append-only attention ledger", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-hub-attention-"));
		const ledger = new AttentionLedger({
			filePath: path.join(directory, "attention.jsonl"),
			now: () => new Date("2026-07-19T00:00:00.000Z"),
			idFactory: () => "attention-production-1",
		});
		const { hub, observers } = fixture(ledger);
		try {
			press(hub, "a");
			press(hub, "w");
			press(hub, "\r");
			let records = await ledger.list();
			for (let attempts = 0; records.length === 0 && attempts < 20; attempts++) {
				await Bun.sleep(1);
				records = await ledger.list();
			}
			expect(records).toEqual([
				{
					version: 1,
					receiptId: "attention-production-1",
					createdAt: "2026-07-19T00:00:00.000Z",
					target: { key: "agent:Alpha", label: "Alpha" },
					action: "waiting",
				},
			]);
			await Bun.sleep(0);
			expect(getHubModel(hub).stagedReceipt).toMatchObject({
				receiptId: "attention-production-1",
				state: "succeeded",
			});
		} finally {
			hub.dispose();
			observers.dispose();
			await fs.rm(directory, { recursive: true, force: true });
		}
	});
});
