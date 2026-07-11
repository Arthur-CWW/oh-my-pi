import { describe, expect, it } from "bun:test";
import { type Component, type Focusable, type RenderScheduler, TUI } from "@oh-my-pi/pi-tui";
import { VirtualTerminal } from "./virtual-terminal";

class DeterministicScheduler implements RenderScheduler {
	#immediate: (() => void)[] = [];
	#renders = new Map<number, () => void>();
	#nextId = 0;
	#now = 0;

	get pending(): number {
		return this.#immediate.length + this.#renders.size;
	}

	now(): number {
		return this.#now;
	}

	scheduleImmediate(callback: () => void): void {
		this.#immediate.push(callback);
	}

	scheduleRender(callback: () => void, _delayMs: number): { cancel(): void } {
		const id = this.#nextId++;
		this.#renders.set(id, callback);
		return { cancel: () => this.#renders.delete(id) };
	}

	async drain(term: VirtualTerminal): Promise<void> {
		while (this.#immediate.length > 0 || this.#renders.size > 0) {
			const immediate = this.#immediate;
			this.#immediate = [];
			for (const callback of immediate) callback();

			const renders = [...this.#renders.values()];
			this.#renders.clear();
			this.#now += 100;
			for (const callback of renders) callback();
		}
		await term.flush();
	}
}

class StreamingLine implements Component, Focusable {
	#line = "stream-0";
	focused = false;

	set(sequence: number): void {
		this.#line = `stream-${sequence}`;
	}

	render(_width: number): readonly string[] {
		return [this.#line];
	}
}

function visible(term: VirtualTerminal): string[] {
	return term.getViewport().map(line => Bun.stripANSI(line).trimEnd()).filter(Boolean);
}

describe("TUI render scheduler", () => {
	it("coalesces a 1000-invalidation stream burst into one paint", async () => {
		const terminal = new VirtualTerminal(40, 4);
		const scheduler = new DeterministicScheduler();
		const tui = new TUI(terminal, undefined, { renderScheduler: scheduler });
		const stream = new StreamingLine();
		tui.addChild(stream);

		try {
			tui.start();
			await scheduler.drain(terminal);
			const paintBaseline = tui.renderMetrics.renderPasses;
			const scheduledBaseline = tui.renderMetrics.scheduledPaints;
			const requestBaseline = tui.renderMetrics.renderRequests;
			const invalidationBaseline = tui.renderMetrics.invalidations;

			for (let sequence = 1; sequence <= 1000; sequence++) {
				stream.set(sequence);
				tui.invalidate();
				tui.requestRender();
			}
			await scheduler.drain(terminal);

			expect(tui.renderMetrics.renderPasses - paintBaseline).toBe(1);
			expect(tui.renderMetrics.scheduledPaints - scheduledBaseline).toBe(1);
			expect(tui.renderMetrics.renderRequests - requestBaseline).toBe(1000);
			expect(tui.renderMetrics.invalidations - invalidationBaseline).toBe(1000);
			expect(visible(terminal)).toEqual(["stream-1000"]);
		} finally {
			tui.stop();
			await scheduler.drain(terminal);
			expect(scheduler.pending).toBe(0);
		}
	});

	it("lets a synchronous reset preempt an ordinary queued paint", async () => {
		const terminal = new VirtualTerminal(40, 4);
		const scheduler = new DeterministicScheduler();
		const tui = new TUI(terminal, undefined, { renderScheduler: scheduler });
		const stream = new StreamingLine();
		tui.addChild(stream);

		try {
			tui.start();
			await scheduler.drain(terminal);
			stream.set(1);
			tui.requestRender();
			const paintBaseline = tui.renderMetrics.renderPasses;

			tui.resetDisplay();
			expect(tui.renderMetrics.renderPasses - paintBaseline).toBe(1);
			await scheduler.drain(terminal);

			expect(tui.renderMetrics.renderPasses - paintBaseline).toBe(1);
			expect(visible(terminal)).toEqual(["stream-1"]);
		} finally {
			tui.stop();
			await scheduler.drain(terminal);
			expect(scheduler.pending).toBe(0);
		}
	});

	it("keeps a focused streaming component on the next scheduled paint", async () => {
		const terminal = new VirtualTerminal(40, 4);
		const scheduler = new DeterministicScheduler();
		const tui = new TUI(terminal, undefined, { renderScheduler: scheduler });
		const stream = new StreamingLine();
		tui.addChild(stream);

		try {
			tui.start();
			await scheduler.drain(terminal);
			tui.setFocus(stream);
			await scheduler.drain(terminal);
			const paintBaseline = tui.renderMetrics.renderPasses;
			stream.set(1);
			tui.requestComponentRender(stream);
			await scheduler.drain(terminal);

			expect(tui.renderMetrics.renderPasses - paintBaseline).toBe(1);
			expect(visible(terminal)).toEqual(["stream-1"]);
		} finally {
			tui.stop();
			await scheduler.drain(terminal);
			expect(scheduler.pending).toBe(0);
		}
	});
});
