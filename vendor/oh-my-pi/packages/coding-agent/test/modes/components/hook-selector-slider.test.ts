import { beforeAll, describe, expect, it } from "bun:test";
import {
	HOOK_SELECTOR_ROUTE,
	type HookModalCommand,
	type HookModalModel,
	type HookModalMsg,
	HookSelectorComponent,
	type HookSelectorSlider,
} from "@oh-my-pi/pi-coding-agent/modes/components/hook-selector";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";

beforeAll(async () => {
	await initTheme();
});

interface Harness {
	readonly component: HookSelectorComponent;
	readonly changes: number[];
	readonly selected: string[];
	readonly commands: HookModalCommand[];
	readonly cancelled: number;
	readonly model: () => HookModalModel;
	readonly dispatch: (sequence: string) => void;
	readonly render: () => string;
}

function messagesForInput(sequence: string, model: HookModalModel): readonly HookModalMsg[] {
	switch (sequence) {
		case LEFT:
			return [{ _tag: "MoveSlider", delta: -1 }];
		case RIGHT:
			return [{ _tag: "MoveSlider", delta: 1 }];
		case "\n":
			return [{ _tag: "Select" }];
		case "\x1b":
			return [{ _tag: "Back" }];
		default:
			return model.region === "filter"
				? [{ _tag: "FilterChanged", query: `${model.query}${sequence}` }]
				: [{ _tag: "BeginFilter" }, { _tag: "FilterChanged", query: sequence }];
	}
}

function makeHarness(
	slider?: HookSelectorSlider,
	config: {
		readonly title?: string;
		readonly options?: readonly string[];
		readonly maxVisible?: number;
	} = {},
): Harness {
	const changes: number[] = [];
	const selected: string[] = [];
	const commands: HookModalCommand[] = [];
	let cancelled = 0;
	const options = (config.options ?? ["Approve and execute", "Refine plan"]).map((label, index) => ({
		id: `option-${index}`,
		label,
		disabled: false,
	}));
	let model = HOOK_SELECTOR_ROUTE.makeInitialModel(
		options,
		0,
		slider?.index ?? 0,
		slider?.segments.length ?? 0,
		{
			title: config.title ?? "Plan mode - next step",
			sliderCaption: slider?.caption,
			sliderSegments: slider?.segments,
			maxVisible: config.maxVisible,
		},
	);
	const component = new HookSelectorComponent();

	const interpret = (command: HookModalCommand): void => {
		commands.push(command);
		switch (command._tag) {
			case "SliderChanged":
				changes.push(command.index);
				break;
			case "SelectionRequested":
				selected.push(command.label);
				break;
			case "CloseRequested":
				cancelled += 1;
				break;
			case "ExternalEditorRequested":
				break;
		}
	};
	const commit = (message: HookModalMsg): void => {
		const transition = HOOK_SELECTOR_ROUTE.update(model, message);
		model = transition.model;
		component.apply(model);
		for (const command of transition.commands) interpret(command);
	};
	component.apply(model);

	return {
		component,
		changes,
		selected,
		commands,
		get cancelled() {
			return cancelled;
		},
		model: () => model,
		dispatch: sequence => {
			for (const message of messagesForInput(sequence, model)) commit(message);
		},
		render: () =>
			component
				.render(80)
				.map(line => Bun.stripANSI(line))
				.join("\n"),
	};
}

function modelSlider(index: number): HookSelectorSlider {
	return {
		caption: "continue with",
		index,
		segments: [
			{ label: "smol", detail: "gpt-5-mini" },
			{ label: "default", detail: "claude-sonnet" },
			{ label: "slow", detail: "claude-opus" },
		],
	};
}

describe("HookSelectorComponent model slider", () => {
	it("renders every tier label plus the active tier's resolved model name", () => {
		const h = makeHarness(modelSlider(1));
		const text = h.render();
		expect(text).toContain("smol");
		expect(text).toContain("default");
		expect(text).toContain("slow");
		// Only the active tier's detail is shown beneath the track.
		expect(text).toContain("claude-sonnet");
		expect(text).not.toContain("gpt-5-mini");
		expect(text).not.toContain("claude-opus");
	});

	it("advances on right arrow, updating selection and the displayed model name", () => {
		const h = makeHarness(modelSlider(1));
		h.dispatch(RIGHT);
		expect(h.changes).toEqual([2]);
		const text = h.render();
		expect(text).toContain("claude-opus");
		expect(text).not.toContain("claude-sonnet");
	});

	it("moves left and right from any list position without selecting an option", () => {
		const h = makeHarness(modelSlider(2));
		h.dispatch(LEFT); // 2 -> 1
		h.dispatch(LEFT); // 1 -> 0
		expect(h.changes).toEqual([1, 0]);
		expect(h.render()).toContain("gpt-5-mini");
		// The slider never triggers option selection or cancellation.
		expect(h.selected).toEqual([]);
		expect(h.cancelled).toBe(0);
	});

	it("clamps at both edges and only emits a command on real movement", () => {
		const h = makeHarness(modelSlider(0));
		h.dispatch(LEFT); // already at first segment -> no-op
		expect(h.changes).toEqual([]);
		h.dispatch(RIGHT); // 0 -> 1
		h.dispatch(RIGHT); // 1 -> 2
		h.dispatch(RIGHT); // already last -> no-op
		expect(h.changes).toEqual([1, 2]);
		expect(h.commands).toEqual([
			{ _tag: "SliderChanged", index: 1 },
			{ _tag: "SliderChanged", index: 2 },
		]);
	});

	it("clamps an initial index beyond the segment range", () => {
		const h = makeHarness(modelSlider(99));
		expect(h.model().sliderIndex).toBe(2);
		// Active segment is the last one; right is a no-op, left advances toward 1.
		h.dispatch(RIGHT);
		expect(h.changes).toEqual([]);
		h.dispatch(LEFT);
		expect(h.changes).toEqual([1]);
	});

	it("treats left and right as slider no-ops when no slider is configured", () => {
		const h = makeHarness();
		h.dispatch(LEFT);
		h.dispatch(RIGHT);
		expect(h.commands).toEqual([]);
		expect(h.selected).toEqual([]);
		expect(h.cancelled).toBe(0);
	});

	it("fuzzy-filters overflowing option lists from typed input", () => {
		const h = makeHarness(undefined, {
			title: "Choose provider",
			options: ["Ollama", "Kagi", "OpenCode Go", "Tavily"],
			maxVisible: 3,
		});

		h.dispatch("o");
		h.dispatch("g");
		const rendered = h.render();

		expect(rendered).toContain("OpenCode Go");
		expect(rendered).not.toContain("Ollama");
		expect(rendered).toContain("Search: og");

		h.dispatch("\n");
		expect(h.selected).toEqual(["OpenCode Go"]);
		expect(h.commands).toContainEqual({
			_tag: "SelectionRequested",
			id: "option-2",
			label: "OpenCode Go",
		});
	});
});
