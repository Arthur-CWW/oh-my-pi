import { type Component, type RenderScheduler, TUI } from "../src/index";
import { VirtualTerminal } from "../test/virtual-terminal";

const BURST_SIZE = 1000;

class BurstScheduler implements RenderScheduler {
	#immediate: (() => void)[] = [];
	#renders = new Map<number, () => void>();
	#nextId = 0;
	#now = 0;

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

	drain(): void {
		while (this.#immediate.length > 0 || this.#renders.size > 0) {
			const immediate = this.#immediate;
			this.#immediate = [];
			for (const callback of immediate) callback();

			const renders = [...this.#renders.values()];
			this.#renders.clear();
			this.#now += 100;
			for (const callback of renders) callback();
		}
	}
}

class StreamRow implements Component {
	#line = "stream-0";

	set(sequence: number): void {
		this.#line = `stream-${sequence}`;
	}

	render(_width: number): readonly string[] {
		return [this.#line];
	}
}

const terminal = new VirtualTerminal(80, 8);
const scheduler = new BurstScheduler();
const tui = new TUI(terminal, undefined, { renderScheduler: scheduler });
const stream = new StreamRow();
tui.addChild(stream);
tui.start();
scheduler.drain();

const before = { ...tui.renderMetrics };
for (let sequence = 1; sequence <= BURST_SIZE; sequence++) {
	stream.set(sequence);
	tui.invalidate();
	tui.requestRender();
}
scheduler.drain();

console.log(
	JSON.stringify({
		mode: "render-scheduler-burst",
		burstSize: BURST_SIZE,
		invalidations: tui.renderMetrics.invalidations - before.invalidations,
		renderRequests: tui.renderMetrics.renderRequests - before.renderRequests,
		scheduledPaints: tui.renderMetrics.scheduledPaints - before.scheduledPaints,
		renderPasses: tui.renderMetrics.renderPasses - before.renderPasses,
		finalRow: terminal.getViewport().map(line => Bun.stripANSI(line).trimEnd()).find(Boolean),
	}),
);

tui.stop();
