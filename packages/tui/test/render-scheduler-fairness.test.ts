import { describe, expect, it } from "bun:test";
import { type Component, type RenderScheduler, type RenderTimer, TUI } from "@oh-my-pi/pi-tui";
import { VirtualTerminal } from "./virtual-terminal";

type ScheduledPaint = {
	kind: "immediate" | "render";
	callback: () => void;
	canceled: boolean;
};

/**
 * One call to runTurn models one event-loop turn: ready raw input is delivered,
 * then at most the paint that was queued before the turn began may run. Work
 * queued reentrantly by that paint is necessarily deferred to the next turn.
 */
class TurnScheduler implements RenderScheduler {
	#now = 0;
	#queue: ScheduledPaint[] = [];
	#callbackDepth = 0;
	maxCallbackDepth = 0;

	now(): number {
		return this.#now;
	}

	scheduleImmediate(callback: () => void): void {
		this.#queue.push({ kind: "immediate", callback, canceled: false });
	}

	scheduleRender(callback: () => void, _delayMs: number): RenderTimer {
		const paint: ScheduledPaint = { kind: "render", callback, canceled: false };
		this.#queue.push(paint);
		return { cancel: () => (paint.canceled = true) };
	}

	get queuedPaints(): number {
		let count = 0;
		for (const paint of this.#queue) if (!paint.canceled) count++;
		return count;
	}

	get nextPaintKind(): ScheduledPaint["kind"] | undefined {
		return this.#queue.find(paint => !paint.canceled)?.kind;
	}

	runTurn(input: () => void): void {
		this.#now += 40;
		input();
		let paint: ScheduledPaint | undefined;
		while ((paint = this.#queue.shift())?.canceled) {}
		if (paint === undefined) return;
		this.#callbackDepth++;
		this.maxCallbackDepth = Math.max(this.maxCallbackDepth, this.#callbackDepth);
		try {
			paint.callback();
		} finally {
			this.#callbackDepth--;
		}
	}
}

class StaticRow implements Component {
	renders = 0;
	readonly #line: string;

	constructor(index: number) {
		this.#line = `history-${index}`;
	}

	invalidate(): void {}

	render(): readonly string[] {
		this.renders++;
		return [this.#line];
	}
}

class SustainedAnimation implements Component {
	renders = 0;
	#tui: TUI | undefined;

	attach(tui: TUI): void {
		this.#tui = tui;
	}

	invalidate(): void {}

	render(): readonly string[] {
		this.renders++;
		const tui = this.#tui!;
		// Exercise the dangerous case once: a forced invalidation from inside a
		// forced paint. Every later frame is component-local animation.
		if (this.renders === 1) tui.requestRender(true);
		tui.requestComponentRender(this);
		return [`animation-${this.renders}`];
	}
}

describe("TUI render scheduler fairness", () => {
	it("yields sustained long-tree animation to input with one trailing partial paint", () => {
		const scheduler = new TurnScheduler();
		const terminal = new VirtualTerminal(80, 24, 10_000);
		const tui = new TUI(terminal, true, { renderScheduler: scheduler });
		const history = Array.from({ length: 4_096 }, (_unused, index) => new StaticRow(index));
		const animation = new SustainedAnimation();
		animation.attach(tui);
		for (const row of history) tui.addChild(row);
		tui.addChild(animation);

		let inputs = 0;
		tui.addInputListener(() => {
			inputs++;
			return { consume: true };
		});

		try {
			tui.start();
			expect(scheduler.queuedPaints).toBe(1);

			for (let turn = 1; turn <= 8; turn++) {
				const rendersBefore = tui.renderMetrics.renderPasses;
				scheduler.runTurn(() => terminal.sendInput("x"));

				// Ready input is observed in this turn even while animation keeps
				// invalidating itself, and one callback performs at most one paint.
				expect(inputs).toBe(turn);
				expect(tui.renderMetrics.renderPasses - rendersBefore).toBe(1);
				expect(scheduler.queuedPaints).toBe(1);
				expect(scheduler.nextPaintKind).toBe("render");
			}

			expect(scheduler.maxCallbackDepth).toBe(1);
			expect(animation.renders).toBe(8);
			// Initial paint plus the one forced trailing replay touch history.
			// Sustained component-scoped frames reuse every historical root.
			for (const row of history) expect(row.renders).toBe(2);
		} finally {
			tui.stop();
		}
	});
});
