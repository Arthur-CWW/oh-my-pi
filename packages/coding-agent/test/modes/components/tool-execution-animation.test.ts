import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ToolExecutionComponent } from "@oh-my-pi/pi-coding-agent/modes/components/tool-execution";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { TODO_STRIKE_TOTAL_FRAMES } from "@oh-my-pi/pi-coding-agent/tools/todo";
import {
	type Component,
	Container,
	ImageBudget,
	ImageProtocol,
	TERMINAL,
	TUI,
} from "@oh-my-pi/pi-tui";
import { StressRenderScheduler } from "../../../../tui/test/render-stress-scheduler";
import { VirtualTerminal } from "../../../../tui/test/virtual-terminal";

const terminal = TERMINAL as unknown as { imageProtocol: ImageProtocol | null };
const originalImageProtocol = TERMINAL.imageProtocol;

class LongTranscript implements Component {
	renders = 0;
	readonly #rows = Array.from({ length: 12_000 }, (_unused, index) => `history-${index}`);

	invalidate(): void {}

	render(): readonly string[] {
		this.renders++;
		return this.#rows;
	}
}

class RenderRecorder {
	fullRequests = 0;
	readonly componentRequests: Component[] = [];
	readonly imageBudget = new ImageBudget(8, () => {});
	readonly nextComponentRequest = Promise.withResolvers<Component>();

	requestRender(): void {
		this.fullRequests++;
	}

	requestComponentRender(component: Component): void {
		this.componentRequests.push(component);
		this.nextComponentRequest.resolve(component);
	}
}

function streamingWrite(ui: TUI, suffix: string): ToolExecutionComponent {
	const component = new ToolExecutionComponent(
		"write",
		{ path: `/tmp/${suffix}`, content: "a" },
		{ showImages: false },
		undefined,
		ui,
	);
	component.updateArgs({ path: `/tmp/${suffix}`, content: "ab" });
	return component;
}

function waitingPoll(ui: TUI): ToolExecutionComponent {
	const component = new ToolExecutionComponent("job", { poll: ["job-1"] }, {}, undefined, ui);
	component.updateResult(
		{
			content: [{ type: "text", text: "" }],
			details: { jobs: [{ id: "job-1", type: "task", status: "running", label: "job", durationMs: 1_000 }] },
		},
		false,
	);
	return component;
}

function completedTodo(ui: TUI): ToolExecutionComponent {
	const component = new ToolExecutionComponent("todo", { ops: [{ op: "done", task: "ship" }] }, {}, undefined, ui);
	component.updateResult(
		{
			content: [{ type: "text", text: "" }],
			details: {
				storage: "session",
				phases: [{ name: "Build", tasks: [{ content: "ship", status: "completed" }] }],
				completedTasks: [{ phase: "Build", content: "ship" }],
			},
		},
		false,
	);
	return component;
}

describe("ToolExecutionComponent local animation paints", () => {
	beforeAll(async () => {
		await Settings.init({ inMemory: true, cwd: process.cwd() });
		await initTheme();
	});

	afterEach(() => {
		vi.useRealTimers();
		terminal.imageProtocol = originalImageProtocol;
	});

	it("coalesces simultaneous spinners without recomposing a long transcript", async () => {
		vi.useFakeTimers();
		const virtualTerminal = new VirtualTerminal(80, 24, 20_000);
		const scheduler = new StressRenderScheduler();
		const tui = new TUI(virtualTerminal, undefined, { renderScheduler: scheduler });
		const transcript = new LongTranscript();
		const tools = [streamingWrite(tui, "one"), streamingWrite(tui, "two"), streamingWrite(tui, "three")];
		tui.addChild(transcript);
		for (const tool of tools) tui.addChild(tool);

		try {
			tui.start();
			await scheduler.drain(virtualTerminal);
			const transcriptRenders = transcript.renders;
			const paintBaseline = tui.renderMetrics.renderPasses;

			vi.advanceTimersByTime(34);
			await scheduler.drain(virtualTerminal);

			expect(tui.renderMetrics.renderPasses - paintBaseline).toBe(1);
			expect(transcript.renders).toBe(transcriptRenders);
		} finally {
			for (const tool of tools) tool.dispose();
			tui.stop();
			await virtualTerminal.flush();
		}
	});

	it("uses only component requests for spinner and todo-strike ticks", () => {
		vi.useFakeTimers();
		const recorder = new RenderRecorder();
		const ui = recorder as unknown as TUI;
		const spinner = streamingWrite(ui, "recorded");
		const todo = completedTodo(ui);

		vi.advanceTimersByTime(70);

		expect(recorder.fullRequests).toBe(0);
		expect(recorder.componentRequests).toContain(spinner);
		expect(recorder.componentRequests).toContain(todo);
		spinner.dispose();
		todo.dispose();
	});

	it("cleans every interval on finalization, sealing, displacement, and disposal", () => {
		vi.useFakeTimers();
		const recorder = new RenderRecorder();
		const ui = recorder as unknown as TUI;
		const baseline = vi.getTimerCount();

		const finalized = streamingWrite(ui, "finalized");
		expect(vi.getTimerCount()).toBe(baseline + 1);
		finalized.updateResult({ content: [{ type: "text", text: "done" }] }, false);
		expect(vi.getTimerCount()).toBe(baseline);

		const todo = completedTodo(ui);
		expect(vi.getTimerCount()).toBe(baseline + 1);
		vi.advanceTimersByTime(65 * (TODO_STRIKE_TOTAL_FRAMES + 1));
		expect(vi.getTimerCount()).toBe(baseline);

		const host = new Container();
		const displacedPoll = waitingPoll(ui);
		host.addChild(displacedPoll);
		expect(vi.getTimerCount()).toBe(baseline + 1);
		host.removeChild(displacedPoll);
		displacedPoll.seal();
		expect(vi.getTimerCount()).toBe(baseline);
		displacedPoll.updateResult(
			{
				content: [{ type: "text", text: "" }],
				details: { jobs: [{ id: "job-1", type: "task", status: "running", label: "job", durationMs: 2_000 }] },
			},
			false,
		);
		expect(vi.getTimerCount()).toBe(baseline);

		const detached = streamingWrite(ui, "detached");
		host.addChild(detached);
		expect(vi.getTimerCount()).toBe(baseline + 1);
		host.removeChild(detached);
		detached.dispose();
		expect(vi.getTimerCount()).toBe(baseline);
		detached.updateArgs({ path: "/tmp/detached", content: "late" });
		expect(vi.getTimerCount()).toBe(baseline);
	});

	it("requests a component repaint when Kitty image conversion completes", async () => {
		terminal.imageProtocol = ImageProtocol.Kitty;
		const recorder = new RenderRecorder();
		const webpBase64 = Buffer.from(
			await Bun.file(`${import.meta.dir}/../../../../../assets/python.webp`).arrayBuffer(),
		).toBase64();
		const component = new ToolExecutionComponent("image_result", {}, {}, undefined, recorder as unknown as TUI);

		component.updateResult(
			{ content: [{ type: "image", data: webpBase64, mimeType: "image/webp" }] },
			false,
		);
		await recorder.nextComponentRequest.promise;

		expect(recorder.fullRequests).toBe(0);
		expect(recorder.componentRequests).toEqual([component]);
		component.dispose();
	});
});
