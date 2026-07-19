import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { setKeybindings } from "@oh-my-pi/pi-tui";
import { wrapTextWithAnsi } from "@oh-my-pi/pi-tui/utils";
import { AgentHubFoldSequence } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-fold-sequence";
import { renderAgentHubFooter } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-interaction-help";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { matchesUiDismiss } from "@oh-my-pi/pi-coding-agent/modes/utils/keybinding-matchers";
import {
	INITIAL_AGENT_HUB_VIEWER_SEQUENCE,
	applyAgentHubViewerSequenceAction,
	reduceAgentHubViewerSequence,
	type AgentHubViewerSequenceOptions,
	type AgentHubViewerSequenceModel,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-viewer-sequence";
import {
	getInteractions,
	resolveViewerScrollDelta,
	VIEWER_NAVIGATION_INTERACTION_IDS,
} from "@oh-my-pi/pi-coding-agent/modes/interaction-registry";

beforeAll(async () => {
	setKeybindings(KeybindingsManager.inMemory());
	await initTheme(false);
});

afterEach(() => {
	setKeybindings(KeybindingsManager.inMemory());
});

function viewerDriver() {
	let model: AgentHubViewerSequenceModel = INITIAL_AGENT_HUB_VIEWER_SEQUENCE;
	const options = (overrides: Partial<AgentHubViewerSequenceOptions> = {}): AgentHubViewerSequenceOptions => ({
		prefix: false,
		down: false,
		up: false,
		displayRows: true,
		dismiss: false,
		...overrides,
	});
	return {
		send(key: string, overrides: Partial<AgentHubViewerSequenceOptions> = {}) {
			const transition = reduceAgentHubViewerSequence(model, key, options(overrides));
			model = transition.model;
			return transition.action;
		},
		model: () => model,
	};
}

describe("Agent Hub Vim key grammar", () => {
	it("binds za to the identity selected when the fold prefix starts", () => {
		const sequence = new AgentHubFoldSequence();
		expect(sequence.handle("z", "Parent", false)).toEqual({ kind: "pending" });
		expect(sequence.handle("a", "DifferentAfterRefresh", false)).toEqual({ kind: "toggle", agentId: "Parent" });
		expect(sequence.handle("z", "Parent", false)).toEqual({ kind: "pending" });
		expect(sequence.handle("u", "Parent", false)).toEqual({ kind: "cancelled" });
		expect(sequence.handle("a", "Parent", false)).toEqual({ kind: "unhandled" });
	});

	it("uses one read-only navigation registry for every Hub lane", () => {
		const normal = getInteractions({
			surfaces: ["viewer", "hub.table", "hub.chat", "hub.inspector"],
			modes: ["normal"],
			ids: VIEWER_NAVIGATION_INTERACTION_IDS,
		});
		expect(normal.map(entry => entry.semantics)).toEqual([
			"line-down",
			"line-up",
			"display-row-down",
			"display-row-up",
			"five-lines-down",
			"five-lines-up",
			"half-page-down",
			"half-page-up",
			"full-page-down",
			"full-page-up",
			"first-line",
			"last-line",
		]);
		expect(resolveViewerScrollDelta("j", 20)).toBe(1);
		expect(resolveViewerScrollDelta("k", 20)).toBe(-1);
		expect(resolveViewerScrollDelta("J", 20)).toBe(5);
		expect(resolveViewerScrollDelta("K", 20)).toBe(-5);
		expect(resolveViewerScrollDelta("d", 20)).toBe(10);
		expect(resolveViewerScrollDelta("u", 20)).toBe(-10);
		expect(resolveViewerScrollDelta("\x1b[6~", 20)).toBe(20);
		expect(resolveViewerScrollDelta("\x1b[5~", 20)).toBe(-20);
	});

	it("moves through wrapped display rows with gj/gk and preserves g/G", () => {
		const wrappedLine = wrapTextWithAnsi("abcdefghijklmnopqrstuvwx", 8);
		const displayRows = [...wrappedLine, ...wrapTextWithAnsi("next", 8)];
		expect(wrappedLine).toHaveLength(3);

		const sequence = viewerDriver();
		const motion = (offset: number, key: "j" | "k"): number => {
			expect(sequence.send("g", { prefix: true })).toEqual({ kind: "pending" });
			const action = sequence.send(key, key === "j" ? { down: true } : { up: true });
			return applyAgentHubViewerSequenceAction(offset, displayRows.length - 1, action);
		};

		let offset = motion(0, "j");
		expect(offset).toBe(1);
		offset = motion(offset, "j");
		expect(offset).toBe(2);
		offset = motion(offset, "j");
		expect(offset).toBe(3);
		expect(displayRows[offset]).toBe("next");
		offset = motion(offset, "k");
		expect(offset).toBe(2);
		expect(motion(0, "k")).toBe(0);
		expect(motion(displayRows.length - 1, "j")).toBe(displayRows.length - 1);

		expect(sequence.send("g", { prefix: true })).toEqual({ kind: "pending" });
		expect(sequence.send("g", { prefix: true })).toEqual({ kind: "first-line" });
		expect(sequence.send("G")).toEqual({ kind: "unhandled" });
	});

	it("waits indefinitely on g, dispatches the namespace, and cancels only on live ui.dismiss", () => {
		const sequence = viewerDriver();
		const send = (key: string) =>
			sequence.send(key, {
				prefix: key === "g",
				down: key === "j",
				up: key === "k",
				dismiss: matchesUiDismiss(key),
			});
		expect(send("g")).toEqual({ kind: "pending" });
		expect(sequence.model().pendingG).toBe(true);
		expect(send("a")).toEqual({ kind: "attach-owner" });
		expect(send("g")).toEqual({ kind: "pending" });
		expect(send("x")).toEqual({ kind: "open-errors" });
		for (const [key, kind] of [
			["m", "open-messages"],
			["b", "open-bookmarks"],
			["r", "refresh"],
			["s", "send"],
		] as const) {
			expect(send("g")).toEqual({ kind: "pending" });
			expect(send(key)).toEqual({ kind });
		}
		expect(send("g")).toEqual({ kind: "pending" });
		expect(send("t")).toEqual({ kind: "unknown", chord: "gt" });

		setKeybindings(KeybindingsManager.inMemory({ "app.interrupt": "ctrl+q" }));
		expect(send("g")).toEqual({ kind: "pending" });
		expect(send("\x11")).toEqual({ kind: "unknown", chord: "g\x11" });
		expect(send("g")).toEqual({ kind: "pending" });
		expect(send("\x1b")).toEqual({ kind: "cancelled" });

		setKeybindings(KeybindingsManager.inMemory({ "ui.dismiss": "ctrl+g" }));
		expect(send("g")).toEqual({ kind: "pending" });
		expect(send("\x1b")).toEqual({ kind: "unknown", chord: "g\x1b" });
		expect(send("g")).toEqual({ kind: "pending" });
		expect(send("\x07")).toEqual({ kind: "cancelled" });
		expect(sequence.model().pendingG).toBe(false);
	});

	it("stages the full attention table, commits on Enter, and backs one reversible layer", () => {
		const target = { key: "session:s1:agent:Worker", label: "Worker" };
		for (const [key, action] of [
			["n", "now"],
			["x", "next"],
			["w", "waiting"],
			["l", "later"],
			["h", "hidden"],
			["s", "snooze"],
			["t", "tags"],
			["b", "bookmark"],
			["o", "note"],
		] as const) {
			const sequence = viewerDriver();
			expect(sequence.send("a", { target })).toEqual({ kind: "open-triage", target });
			expect(sequence.send(key)).toEqual({ kind: "stage-attention", target, action });
			expect(sequence.send("\r", { enter: true })).toEqual({ kind: "commit-attention", target, action });
			expect(sequence.model()).toEqual(INITIAL_AGENT_HUB_VIEWER_SEQUENCE);
		}

		const backed = viewerDriver();
		backed.send("a", { target });
		backed.send("h");
		expect(backed.send("\x1b", { dismiss: true })).toEqual({ kind: "cancelled" });
		expect(backed.model()).toEqual(INITIAL_AGENT_HUB_VIEWER_SEQUENCE);

		const chord = viewerDriver();
		chord.send("g", { prefix: true });
		expect(chord.send("a", { target })).toEqual({ kind: "attach-owner" });
		expect(chord.model().triage).toBeUndefined();
	});

	it("renders the pending continuations at the footer edge and removes them on cancel", () => {
		const pending = Bun.stripANSI(
			renderAgentHubFooter({
				width: 100,
				surface: "hub.table",
				mode: "normal",
				pending: "g: gg gj gk gx gm gr gs gb ga",
			}),
		);
		expect(pending.trimEnd().endsWith("g: gg gj gk gx gm gr gs gb ga")).toBe(true);
		const cancelled = Bun.stripANSI(renderAgentHubFooter({ width: 100, surface: "hub.table", mode: "normal" }));
		expect(cancelled).not.toContain("g: gg");
	});

	it("publishes the approved roster matrix without retired aliases", () => {
		const table = getInteractions({ surfaces: ["hub.table"], modes: ["normal"] });
		const keys = new Map(table.map(entry => [entry.id, entry.keys]));
		expect(keys.get("hub.table.next-row")).toEqual(["j", "↓"]);
		expect(keys.get("hub.table.previous-row")).toEqual(["k", "↑"]);
		expect(keys.get("hub.table.next-orchestrator")).toEqual(["n"]);
		expect(keys.get("hub.table.previous-orchestrator")).toEqual(["p"]);
		expect(table.some(entry => entry.keys?.includes("H") || entry.keys?.includes("L"))).toBe(false);
		expect(table.some(entry => entry.keys?.some(key => key.includes("Ctrl+S")))).toBe(false);
		expect(table.some(entry => entry.keys?.some(key => key.includes("[")))).toBe(false);
		const chat = getInteractions({ surfaces: ["hub.chat"], modes: ["normal"] });
		expect(chat.some(entry => entry.keys?.some(key => key.includes("[")))).toBe(false);
		const inspector = getInteractions({ surfaces: ["hub.inspector"], modes: ["normal"] });
		expect(inspector.find(entry => entry.id === "hub.inspector.cycle-sections")?.keys).toEqual(["[ / ]", "← / →"]);
	});

	it("has no Hub input mode and keeps filter text literal", () => {
		const normal = getInteractions({ surfaces: ["viewer", "hub.table", "hub.chat"], modes: ["normal"] });
		expect(normal.some(entry => entry.id.includes(".input"))).toBe(false);
		for (const surface of ["hub.table", "hub.chat"] as const) {
			const filter = getInteractions({ surfaces: [surface], modes: ["filter"] });
			expect(filter.some(entry => entry.semantics === "literal-input" && entry.keys?.includes("text"))).toBe(true);
		}
	});
	it("reserves y for selected-child identity yank in Hub table mode", () => {
		const yank = getInteractions({ surfaces: ["hub.table"], modes: ["normal"] }).find(
			entry => entry.id === "hub.table.yank-identity",
		);
		expect(yank?.keys).toEqual(["y"]);
		expect(yank?.description).toContain("identity");
	});
});
