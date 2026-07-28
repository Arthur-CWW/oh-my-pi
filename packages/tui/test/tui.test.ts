import { describe, expect, it } from "bun:test";
import { Container, type Component, type Focusable, type RenderScheduler, TUI } from "@oh-my-pi/pi-tui";
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

class InputLine extends StreamingLine {
	inputs = 0;

	handleInput(): void {
		this.inputs++;
		this.set(this.inputs);
	}
}

class CountingLine implements Component {
	renders = 0;

	render(): readonly string[] {
		this.renders++;
		return ["history"];
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

	it("lets a scheduled reset preempt an ordinary queued paint", async () => {
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
			expect(tui.renderMetrics.renderPasses - paintBaseline).toBe(0);
			expect(scheduler.pending).toBe(1);
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
	it("keeps keystroke work independent of a 10k-child transcript", async () => {
		const terminal = new VirtualTerminal(40, 4);
		const scheduler = new DeterministicScheduler();
		const tui = new TUI(terminal, undefined, { renderScheduler: scheduler });
		const transcript = new Container();
		const history: CountingLine[] = [];
		for (let i = 0; i < 10_000; i++) {
			const line = new CountingLine();
			history.push(line);
			transcript.addChild(line);
		}
		const editor = new InputLine();
		tui.addChild(transcript);
		tui.addChild(editor);

		try {
			tui.start();
			await scheduler.drain(terminal);
			tui.setFocus(editor);
			await scheduler.drain(terminal);
			const historyRenders = history.reduce((sum, line) => sum + line.renders, 0);

			terminal.sendInput("x");
			await scheduler.drain(terminal);

			expect(editor.inputs).toBe(1);
			expect(history.reduce((sum, line) => sum + line.renders, 0)).toBe(historyRenders);
			expect(tui.renderMetrics.componentRenderRequests).toBeGreaterThan(0);
			expect(tui.renderMetrics).toMatchObject({
				composeMs: expect.any(Number),
				prepareMs: expect.any(Number),
				auditMs: expect.any(Number),
				diffMs: expect.any(Number),
				writeMs: expect.any(Number),
			});
		} finally {
			tui.stop();
			await scheduler.drain(terminal);
		}
	});

	it("drops superseded component animation frames", async () => {
		const terminal = new VirtualTerminal(40, 4);
		const scheduler = new DeterministicScheduler();
		const tui = new TUI(terminal, undefined, { renderScheduler: scheduler });
		const stream = new StreamingLine();
		tui.addChild(stream);
		try {
			tui.start();
			await scheduler.drain(terminal);
			for (let frame = 0; frame < 100; frame++) {
				stream.set(frame);
				tui.requestComponentRender(stream);
			}
			await scheduler.drain(terminal);
			expect(tui.renderMetrics.supersededComponentFrames).toBe(99);
			expect(tui.renderMetrics.renderPasses).toBe(2);
		} finally {
			tui.stop();
			await scheduler.drain(terminal);
		}
	});

});
