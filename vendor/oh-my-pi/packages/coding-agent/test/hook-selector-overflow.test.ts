import { beforeAll, describe, expect, it } from "bun:test";
import {
	HookSelectorComponent,
	type HookModalCommand,
	type HookModalModel,
	type HookModalMsg,
	type HookSelectorOptionInput,
	type HookSelectorOptions,
	makeHookModalModel,
	updateHookModal,
} from "@oh-my-pi/pi-coding-agent/modes/components/hook-selector";
import type { MvuEnvelope } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-lease";
import { getThemeByName, setThemeInstance, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { Key, type Keybinding, type KeyId, visibleWidth } from "@oh-my-pi/pi-tui";

interface HookSelectorHarness {
	readonly component: HookSelectorComponent;
	readonly model: HookModalModel;
	dispatch(envelope: MvuEnvelope): readonly HookModalCommand[];
}

function press(action: Keybinding, key: KeyId, text?: string): MvuEnvelope {
	return {
		_tag: "MvuInput",
		action,
		event: {
			_tag: "Press",
			key,
			...(text === undefined ? {} : { text }),
			repeat: false,
		},
	};
}

function makeHarness(
	title: string,
	inputs: readonly HookSelectorOptionInput[],
	options: HookSelectorOptions = {},
): HookSelectorHarness {
	const modalOptions = inputs.map((input, index) => {
		const option = typeof input === "string" ? { label: input } : input;
		return {
			id: String(index),
			label: option.label,
			...(option.description === undefined ? {} : { description: option.description }),
			disabled: options.disabledIndices?.includes(index) ?? false,
		};
	});
	let model = makeHookModalModel(
		modalOptions,
		options.initialIndex,
		options.slider?.index,
		options.slider?.segments.length,
		{
			title,
			...(options.slider?.caption === undefined ? {} : { sliderCaption: options.slider.caption }),
			...(options.slider?.segments === undefined ? {} : { sliderSegments: options.slider.segments }),
			...(options.helpText === undefined ? {} : { helpText: options.helpText }),
			...(options.outline === undefined ? {} : { outline: options.outline }),
			...(options.maxVisible === undefined ? {} : { maxVisible: options.maxVisible }),
			...(options.selectionMarker === undefined ? {} : { selectionMarker: options.selectionMarker }),
			...(options.checkedIndices === undefined ? {} : { checkedIndices: options.checkedIndices }),
			...(options.markableCount === undefined ? {} : { markableCount: options.markableCount }),
		},
	);
	const component = new HookSelectorComponent();
	component.apply(model);

	return {
		component,
		get model() {
			return model;
		},
		dispatch(envelope) {
			let message: HookModalMsg | undefined;
			switch (envelope.action) {
				case "app.navigation.up":
				case "tui.select.up":
				case "tui.select.pageUp":
					message = { _tag: "Move", delta: -1 };
					break;
				case "app.navigation.down":
				case "tui.select.down":
				case "tui.select.pageDown":
					message = { _tag: "Move", delta: 1 };
					break;
				case "app.selector.filter": {
					const text = envelope.event._tag === "Paste"
						? envelope.event.text
						: envelope.event._tag === "Press"
							? envelope.event.text
							: undefined;
					message = model.region === "filter" && text !== undefined
						? { _tag: "FilterChanged", query: model.query + text }
						: { _tag: "BeginFilter" };
					break;
				}
				case "tui.select.confirm":
					message = { _tag: "Select" };
					break;
				case "ui.dismiss":
					message = { _tag: "Back" };
					break;
			}
			if (message === undefined) return [];
			const transition = updateHookModal(model, message);
			model = transition.model;
			component.apply(model);
			return transition.commands;
		},
	};
}

beforeAll(async () => {
	const theme = await getThemeByName("dark");
	if (!theme) {
		throw new Error("Failed to load dark theme for tests");
	}
	setThemeInstance(theme);
});
describe("HookSelectorComponent", () => {
	it("keeps outlined options within render width", () => {
		const options = [
			"aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;b",
			"bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;a",
			"a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b",
		];
		const { component } = makeHarness("Which pattern do you prefer?", options, {
			outline: true,
			initialIndex: 0,
		});

		const width = 80;
		const lines = component.render(width);
		for (const line of lines) {
			expect(visibleWidth(Bun.stripANSI(line))).toBeLessThanOrEqual(width);
		}
	});

	it("wraps outlined option text without omitting the tail", () => {
		const options = [
			"Option A: Move to OMP-native only by migrating reusable shared AI instructions into .omp/AGENTS.md, .omp/rules, .omp/skills, and .omp/agents while deliberately not creating a root .github directory.",
			"Option B: Keep dual support by migrating canonical instructions into .omp while also maintaining a root .github/copilot-instructions.md compatibility bridge for editors that do not understand OMP resources yet.",
		];
		const { component } = makeHarness("Which migration stance should be used?", options, {
			outline: true,
			initialIndex: 0,
		});

		const width = 72;
		const lines = component.render(width);
		const plain = lines.map(line => Bun.stripANSI(line)).join("\n");
		const normalizedPlain = plain.replace(/[\u2500-\u257f]/g, " ").replace(/\s+/g, " ");
		expect(normalizedPlain).toContain("not creating a root .github directory");
		expect(normalizedPlain).toContain("do not understand OMP resources yet");
		for (const line of lines) {
			expect(visibleWidth(Bun.stripANSI(line))).toBeLessThanOrEqual(width);
		}
	});

	it("renders option descriptions as separate wrapped rows", () => {
		const options = [
			{
				label: "Use existing local credentials",
				description:
					"Authenticate via the provider keys and OAuth state already configured under ~/.omp without opening a new browser-based setup flow.",
			},
			{
				label: "Set up Oh My Pi in terminal",
				description:
					"Launch the local terminal UI to add provider keys, select models, and keep the current editor session waiting for the configured credentials.",
			},
		];
		const { component } = makeHarness("How should authentication continue?", options, {
			outline: true,
			initialIndex: 0,
		});

		const width = 76;
		const lines = component.render(width);
		const plainLines = lines.map(line => Bun.stripANSI(line));
		const normalizedPlain = plainLines
			.join("\n")
			.replace(/[\u2500-\u257f]/g, " ")
			.replace(/\s+/g, " ");
		const labelLineIndex = plainLines.findIndex(line => line.includes("Use existing local credentials"));
		const descriptionLineIndex = plainLines.findIndex(line => line.includes("Authenticate via the provider keys"));
		expect(labelLineIndex).toBeGreaterThanOrEqual(0);
		expect(descriptionLineIndex).toBeGreaterThan(labelLineIndex);
		expect(normalizedPlain).toContain("without opening a new browser-based setup flow");
		expect(normalizedPlain).toContain("keep the current editor session waiting for the configured credentials");
		for (const line of lines) {
			expect(visibleWidth(Bun.stripANSI(line))).toBeLessThanOrEqual(width);
		}
	});

	it("collapses to labels with only the highlighted description when descriptions overflow", () => {
		const options = [
			{ label: "Path A", description: "Reuse existing credentials." },
			{ label: "Path B", description: "Authorize a provider in the browser." },
			{ label: "Path C", description: "Edit provider keys manually." },
			{ label: "Path D", description: "Continue with offline-only tools." },
		];
		const harness = makeHarness("Which setup path should be used?", options, {
			outline: true,
			initialIndex: 0,
			maxVisible: 6,
		});
		const { component } = harness;

		const plain = component
			.render(76)
			.map(line => Bun.stripANSI(line))
			.join("\n");
		// Every option label stays on screen so the user can see the whole menu...
		expect(plain).toContain("Path A");
		expect(plain).toContain("Path B");
		expect(plain).toContain("Path C");
		expect(plain).toContain("Path D");
		// ...but only the highlighted option expands its description.
		expect(plain).toContain("Reuse existing credentials.");
		expect(plain).not.toContain("Authorize a provider in the browser.");
		expect(plain).not.toContain("Edit provider keys manually.");
		expect(plain).toContain("(1/4)");

		// The detail pane follows the cursor: moving down expands Path B and
		// collapses Path A's description.
		harness.dispatch(press("tui.select.down", Key.down));
		const afterDown = component
			.render(76)
			.map(line => Bun.stripANSI(line))
			.join("\n");
		expect(afterDown).toContain("Path A");
		expect(afterDown).toContain("Path D");
		expect(afterDown).toContain("Authorize a provider in the browser.");
		expect(afterDown).not.toContain("Reuse existing credentials.");
		expect(afterDown).toContain("(2/4)");
	});

	it("counts wrapped outlined rows toward the visible row cap", () => {
		const options = [
			"Option A: Use the existing terminal session and preserve the current credentials while the setup prompt remains open for the editor.",
			"Option B: Open a browser authorization flow and wait for the provider callback before returning to the editor.",
			"Option C: Edit the local provider configuration file manually and retry the current request afterward.",
			"Option D: Continue without provider access and keep only offline tools enabled for the session.",
		];
		const { component } = makeHarness("Which setup path should be used?", options, {
			outline: true,
			initialIndex: 0,
			maxVisible: 3,
		});

		const plainLines = component.render(50).map(line => Bun.stripANSI(line));
		const plain = plainLines.join("\n");
		expect(plain).toContain("Option A");
		expect(plain).not.toContain("Option B");
		expect(plain).toContain("(1/4)");
		for (const line of plainLines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(50);
		}
	});

	it("filters options by description text", () => {
		const harness = makeHarness(
			"Which setup path should be used?",
			[
				{ label: "Path A", description: "Reuse the credentials already available in the environment." },
				{ label: "Path B", description: "Launch a browser flow to authorize a new provider account." },
				{ label: "Path C", description: "Open the local settings file and edit provider keys manually." },
				{ label: "Path D", description: "Skip provider setup and continue with offline-only tools." },
			],
			{ outline: true, maxVisible: 3 },
		);
		const { component } = harness;

		for (const key of "browser") {
			harness.dispatch(press("app.selector.filter", key as KeyId, key));
		}

		const plain = component
			.render(76)
			.map(line => Bun.stripANSI(line))
			.join("\n");
		expect(plain).toContain("Path B");
		expect(plain).toContain("Launch a browser flow");
		expect(plain).not.toContain("Path A");
	});

	it("skips disabled options during keyboard navigation", () => {
		const harness = makeHarness("Pick one", ["First", "Disabled", "Third"], {
			disabledIndices: [1],
		});

		harness.dispatch(press("tui.select.down", Key.down));
		const commands = harness.dispatch(press("tui.select.confirm", Key.enter));

		expect(commands).toEqual([{ _tag: "SelectionRequested", id: "2", label: "Third" }]);
	});

	it("does not select disabled options", () => {
		const harness = makeHarness("Pick one", ["Disabled"], {
			disabledIndices: [0],
		});

		const commands = harness.dispatch(press("tui.select.confirm", Key.enter));

		expect(commands).toEqual([]);
	});

	it("renders disabled options dimmed", () => {
		const { component } = makeHarness("Pick one", ["First", "Disabled"], {
			disabledIndices: [1],
		});

		expect(component.render(80).join("\n")).toContain(theme.fg("dim", "Disabled"));
	});

	it("renders radio markers instead of a cursor arrow for single-choice markable rows", () => {
		const { component } = makeHarness("Pick one", ["Apple", "Banana", "Other (type your own)"], {
			selectionMarker: "radio",
			markableCount: 2,
			initialIndex: 0,
		});

		const lines = Bun.stripANSI(component.render(80).join("\n")).split("\n");
		const apple = lines.find(line => line.includes("Apple"));
		const banana = lines.find(line => line.includes("Banana"));
		expect(apple).toBeDefined();
		expect(banana).toBeDefined();
		// Cursor row shows the filled radio; the legacy cursor arrow is gone.
		expect(apple).toContain(theme.radio.selected);
		expect(apple).not.toContain(theme.nav.cursor);
		// Non-cursor markable row shows the empty radio.
		expect(banana).toContain(theme.radio.unselected);
	});

	it("keeps the cursor arrow on control rows beyond markableCount", () => {
		const { component } = makeHarness("Pick one", ["Apple", "Banana", "Other (type your own)"], {
			selectionMarker: "radio",
			markableCount: 2,
			initialIndex: 2,
		});

		const lines = Bun.stripANSI(component.render(80).join("\n")).split("\n");
		const other = lines.find(line => line.includes("Other"));
		expect(other).toBeDefined();
		// The trailing action keeps the classic cursor and gets no radio marker.
		expect(other).toContain(theme.nav.cursor);
		expect(other).not.toContain(theme.radio.selected);
	});

	it("renders checkbox markers reflecting checked state and exempts control rows", () => {
		const { component } = makeHarness("Pick many", ["Apple", "Banana", "Done selecting", "Other (type your own)"], {
			selectionMarker: "checkbox",
			markableCount: 2,
			checkedIndices: [0],
			initialIndex: 1,
		});

		const lines = Bun.stripANSI(component.render(80).join("\n")).split("\n");
		const apple = lines.find(line => line.includes("Apple"));
		const banana = lines.find(line => line.includes("Banana"));
		const done = lines.find(line => line.includes("Done selecting"));
		expect(apple).toBeDefined();
		expect(banana).toBeDefined();
		expect(done).toBeDefined();
		expect(apple).toContain(theme.checkbox.checked);
		expect(banana).toContain(theme.checkbox.unchecked);
		// Control rows beyond markableCount carry no checkbox marker.
		expect(done).not.toContain(theme.checkbox.checked);
		expect(done).not.toContain(theme.checkbox.unchecked);
	});
});
