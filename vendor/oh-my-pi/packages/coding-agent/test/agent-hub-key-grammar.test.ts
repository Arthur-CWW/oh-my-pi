import { describe, expect, it } from "bun:test";
import { wrapTextWithAnsi } from "@oh-my-pi/pi-tui/utils";
import { AgentHubFoldSequence } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-fold-sequence";
import {
	AgentHubViewerSequence,
	applyAgentHubViewerSequenceAction,
	type AgentHubViewerSequenceOptions,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-viewer-sequence";
import {
	getInteractions,
	resolveViewerScrollDelta,
	VIEWER_NAVIGATION_INTERACTION_IDS,
} from "@oh-my-pi/pi-coding-agent/modes/interaction-registry";

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

		const sequence = new AgentHubViewerSequence();
		const options = (overrides: Partial<AgentHubViewerSequenceOptions>): AgentHubViewerSequenceOptions => ({
			prefix: false,
			down: false,
			up: false,
			displayRows: true,
			interrupt: false,
			...overrides,
		});
		const motion = (offset: number, key: "j" | "k", nowMs: number): number => {
			expect(sequence.handle("g", options({ prefix: true }), nowMs)).toEqual({ kind: "pending" });
			const action = sequence.handle(key, options(key === "j" ? { down: true } : { up: true }), nowMs + 1);
			return applyAgentHubViewerSequenceAction(offset, displayRows.length - 1, action);
		};

		let offset = motion(0, "j", 0);
		expect(offset).toBe(1);
		offset = motion(offset, "j", 2);
		expect(offset).toBe(2);
		offset = motion(offset, "j", 4);
		expect(offset).toBe(3);
		expect(displayRows[offset]).toBe("next");
		offset = motion(offset, "k", 6);
		expect(offset).toBe(2);
		expect(motion(0, "k", 8)).toBe(0);
		expect(motion(displayRows.length - 1, "j", 10)).toBe(displayRows.length - 1);

		expect(sequence.handle("g", options({ prefix: true }), 12)).toEqual({ kind: "pending" });
		expect(sequence.handle("g", options({ prefix: true }), 13)).toEqual({ kind: "first-line" });
		expect(sequence.handle("G", options({}), 14)).toEqual({ kind: "unhandled" });
	});

	it("expires or escapes a lone g prefix without consuming the next movement", () => {
		const sequence = new AgentHubViewerSequence(100);
		const base: AgentHubViewerSequenceOptions = {
			prefix: false,
			down: false,
			up: false,
			displayRows: true,
			interrupt: false,
		};
		expect(sequence.handle("g", { ...base, prefix: true }, 0)).toEqual({ kind: "pending" });
		expect(sequence.handle("j", { ...base, down: true }, 100)).toEqual({ kind: "unhandled" });
		expect(sequence.handle("g", { ...base, prefix: true }, 200)).toEqual({ kind: "pending" });
		expect(sequence.handle("\x1b", { ...base, interrupt: true }, 201)).toEqual({ kind: "cancelled" });
		expect(sequence.handle("j", { ...base, down: true }, 202)).toEqual({ kind: "unhandled" });
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
