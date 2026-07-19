import { describe, expect, it } from "bun:test";
import {
	type Component,
	type InputDispatchRecord,
	type InputRouteDecision,
	type InputRouteTrace,
	TUI,
} from "@oh-my-pi/pi-tui";
import { VirtualTerminal } from "./virtual-terminal";

class FocusedInput implements Component {
	readonly inputs: string[] = [];

	render(): readonly string[] {
		return ["focused"];
	}

	handleInput(data: string): void {
		this.inputs.push(data);
	}
}

function trace(sequenceId: number, leaseId: string, expectedConsumer: "mvu" | "legacy"): InputRouteTrace {
	return { sequenceId, leaseId, resolvedAction: "app.selector.move", expectedConsumer };
}

function startTui(): { terminal: VirtualTerminal; tui: TUI; focused: FocusedInput } {
	const terminal = new VirtualTerminal(40, 6);
	const tui = new TUI(terminal);
	const focused = new FocusedInput();
	tui.addChild(focused);
	tui.setFocus(focused);
	tui.start();
	return { terminal, tui, focused };
}

describe("TUI input router", () => {
	it("consumes MVU input without invoking listeners or focused components", () => {
		const { terminal, tui, focused } = startTui();
		const listenerInputs: string[] = [];
		const routerCalls: Array<{ data: string; sequenceId: number }> = [];
		const records: InputDispatchRecord[] = [];
		tui.addInputListener(data => {
			listenerInputs.push(data);
			return undefined;
		});
		tui.setInputRouter((data, sequenceId): InputRouteDecision => {
			routerCalls.push({ data, sequenceId });
			return { consume: true, trace: trace(sequenceId, "mvu-1", "mvu") };
		});
		tui.setInputDispatchObserver(record => records.push(record));

		try {
			terminal.sendInput("j");
			expect(routerCalls).toEqual([{ data: "j", sequenceId: 1 }]);
			expect(listenerInputs).toEqual([]);
			expect(focused.inputs).toEqual([]);
			expect(records).toEqual([
			{
				sequenceId: 1,
				leaseId: "mvu-1",
				resolvedAction: "app.selector.move",
				expectedConsumer: "mvu",
				actualConsumer: "router",
			},
		]);
		} finally {
			tui.stop();
		}
	});

	it("forwards a Legacy decision through listeners and focused input exactly once", () => {
		const { terminal, tui, focused } = startTui();
		const listenerInputs: string[] = [];
		const records: InputDispatchRecord[] = [];
		tui.addInputListener(data => {
			listenerInputs.push(data);
			return { data: `${data}!` };
		});
		tui.setInputRouter((data, sequenceId): InputRouteDecision => ({
			consume: false,
			data,
			trace: trace(sequenceId, "legacy-1", "legacy"),
		}));
		tui.setInputDispatchObserver(record => records.push(record));

		try {
			terminal.sendInput("x");
			expect(listenerInputs).toEqual(["x"]);
			expect(focused.inputs).toEqual(["x!"]);
			expect(records.at(-1)).toEqual({
			sequenceId: 1,
			leaseId: "legacy-1",
			resolvedAction: "app.selector.move",
			expectedConsumer: "legacy",
			actualConsumer: "focused",
		});
		} finally {
			tui.stop();
		}
	});

	it("preserves ordinary listener and focused routing when no router is installed", () => {
		const { terminal, tui, focused } = startTui();
		const listenerInputs: string[] = [];
		const records: InputDispatchRecord[] = [];
		tui.addInputListener(data => {
			listenerInputs.push(data);
			return { data: `${data}-legacy` };
		});
		tui.setInputDispatchObserver(record => records.push(record));

		try {
			terminal.sendInput("k");
			expect(listenerInputs).toEqual(["k"]);
			expect(focused.inputs).toEqual(["k-legacy"]);
			expect(records).toEqual([
			{
				sequenceId: 1,
				leaseId: "legacy",
				expectedConsumer: "legacy",
				actualConsumer: "focused",
			},
		]);
		} finally {
			tui.stop();
		}
	});

	it("gives a consuming listener precedence over focused input", () => {
		const { terminal, tui, focused } = startTui();
		const listenerInputs: string[] = [];
		const records: InputDispatchRecord[] = [];
		tui.setInputRouter((_data, sequenceId): InputRouteDecision => ({
			consume: false,
			trace: trace(sequenceId, "legacy-2", "legacy"),
		}));
		tui.addInputListener(data => {
			listenerInputs.push(data);
			return { consume: true, data: "must-not-forward" };
		});
		tui.setInputDispatchObserver(record => records.push(record));

		try {
			terminal.sendInput("enter");
			expect(listenerInputs).toEqual(["enter"]);
			expect(focused.inputs).toEqual([]);
			expect(records.at(-1)?.actualConsumer).toBe("listener");
		} finally {
			tui.stop();
		}
	});

	it("bypasses routing and legacy forwarding for protocol responses", () => {
		const { terminal, tui, focused } = startTui();
		const routerInputs: string[] = [];
		const listenerInputs: string[] = [];
		const records: InputDispatchRecord[] = [];
		tui.setInputRouter((data, sequenceId): InputRouteDecision => {
			routerInputs.push(data);
			return { consume: true, trace: trace(sequenceId, "mvu-2", "mvu") };
		});
		tui.addInputListener(data => {
			listenerInputs.push(data);
			return { consume: true };
		});
		tui.setInputDispatchObserver(record => records.push(record));

		try {
			terminal.sendInput("\x1b[6;20;40t");
			terminal.sendInput("j");
			expect(routerInputs).toEqual(["j"]);
			expect(listenerInputs).toEqual([]);
			expect(focused.inputs).toEqual([]);
			expect(records.map(record => record.actualConsumer)).toEqual(["protocol", "router"]);
			expect(records[0]).toMatchObject({
			sequenceId: 1,
			leaseId: "protocol",
			expectedConsumer: "legacy",
		});
			expect(records[1]?.sequenceId).toBe(2);
		} finally {
			tui.stop();
		}
	});
});
