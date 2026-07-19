import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	makeSettingsModalModel,
	type SettingsModalModel,
	SettingsSelectorComponent,
	updateSettingsModal,
} from "@oh-my-pi/pi-coding-agent/modes/components/settings-selector";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

beforeEach(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
});

afterEach(() => {
	resetSettingsForTest();
});

const models = new WeakMap<SettingsSelectorComponent, SettingsModalModel>();
const cancelCallbacks = new WeakMap<SettingsSelectorComponent, () => void>();
const inputAdapter = makeTerminalInputAdapter();

function send(comp: SettingsSelectorComponent, data: string): void {
	const model = models.get(comp);
	if (model === undefined) throw new Error("settings model not mounted");
	const event = inputAdapter.decode(data);
	if (event === undefined) throw new Error(`undecodable settings input: ${JSON.stringify(data)}`);
	const transition = updateSettingsModal(model, {
		_tag: "Input",
		action: event._tag === "Press" && event.key === "escape" ? "ui.dismiss" : "app.settings.input",
		event,
	});
	models.set(comp, transition.model);
	for (const command of transition.commands) {
		if (command._tag === "RenderSettings") comp.apply(command.model);
		else if (command._tag === "PersistSettingRequested") settings.set(command.path, command.value as never);
		else if (command._tag === "CloseRequested") cancelCallbacks.get(comp)?.();
	}
}

function createSelector(onCancel: () => void = () => {}): SettingsSelectorComponent {
	const comp = new SettingsSelectorComponent(
		{
			availableThinkingLevels: [],
			thinkingLevel: undefined,
			availableThemes: ["dark"],
		},
		{
			onChange: () => {},
			onCancel,
		},
	);
	const model = makeSettingsModalModel("dark", {
		values: {
			defaultThinkingLevel: ["auto"],
			"theme.dark": ["dark"],
			"theme.light": ["dark"],
		},
	});
	models.set(comp, model);
	cancelCallbacks.set(comp, onCancel);
	comp.apply(model);
	return comp;
}

/** Switch the selector to the memory tab. SETTING_TABS puts memory at index 4 (after appearance/model/interaction/context). */
function focusMemoryTab(comp: SettingsSelectorComponent): void {
	for (let i = 0; i < 4; i++) {
		send(comp, "\x1b[C");
	}
}

describe("SettingsSelectorComponent memory tab", () => {
	it("reveals condition-gated Hindsight rows the moment memory.backend changes via the submenu", () => {
		settings.set("memory.backend", "off");
		const comp = createSelector();
		focusMemoryTab(comp);
		// Width 70 keeps the flat single-column layout (the wide split layout
		// shows only the active section's rows, covered by the sidebar test).
		const before = comp.render(70).join("\n");
		expect(before).toContain("Memory Backend");
		expect(before).not.toContain("Hindsight API URL");

		// Memory Backend is the only visible row, so it's already selected at index 0.
		// Enter opens the SelectSubmenu pre-positioned on "off"; navigate to "hindsight" (index 2) and confirm.
		send(comp, "\n");
		send(comp, "\x1b[B");
		send(comp, "\x1b[B");
		send(comp, "\n");

		expect(settings.get("memory.backend")).toBe("hindsight");
		const after = comp.render(70).join("\n");
		expect(after).toContain("Memory Backend");
		expect(after).toContain("Hindsight API URL");
		expect(after).toContain("Hindsight Auto Recall");
	});

	it("hides Hindsight rows again when the backend is switched back to off without leaving the tab", () => {
		settings.set("memory.backend", "hindsight");
		const comp = createSelector();
		focusMemoryTab(comp);
		// Width 70 keeps the flat layout so all sections' rows render inline.
		expect(comp.render(70).join("\n")).toContain("Hindsight API URL");

		// Open Memory Backend → SelectSubmenu pre-selects the current value
		// ("hindsight" at index 2) → step up twice to reach "off" → Enter confirms.
		send(comp, "\n");
		send(comp, "\x1b[A");
		send(comp, "\x1b[A");
		send(comp, "\n");

		expect(settings.get("memory.backend")).toBe("off");
		const after = comp.render(70).join("\n");
		expect(after).toContain("Memory Backend");
		expect(after).not.toContain("Hindsight API URL");
		expect(after).not.toContain("Hindsight Auto Recall");
	});

	it("clears the global settings search on Escape before closing the selector", () => {
		let cancelCount = 0;
		const comp = createSelector(() => {
			cancelCount++;
		});

		// Typing starts the cross-tab search: banner shows the query and matches.
		send(comp, "b");
		const strip = (line: string): string => line.replace(/\x1b\[[0-9;]*m/g, "");
		const searching = comp.render(120).map(strip).join("\n");
		const banner =
			comp
				.render(120)
				.map(strip)
				.find(line => /\d+ match/.test(line)) ?? "";
		expect(banner).toContain(" b ");
		expect(searching).toMatch(/\d+ match/);

		// First Escape exits search mode without closing the panel.
		send(comp, "\x1b");
		expect(cancelCount).toBe(0);
		expect(comp.render(120).join("\n")).not.toContain("matches");

		send(comp, "\x1b");
		expect(cancelCount).toBe(1);
	});

	it("puts the exact global settings search hit before incidental matches", () => {
		const comp = createSelector();
		for (const ch of "image provider") send(comp, ch);

		const strip = (line: string): string => line.replace(/\x1b\[[0-9;]*m/g, "");
		const rendered = comp.render(120).map(strip).join("\n");
		const providersIndex = rendered.indexOf("Providers");
		const appearanceIndex = rendered.indexOf("Appearance");

		expect(rendered).toContain("Image Provider");
		expect(rendered).not.toContain("Include Model in Prompt");
		expect(rendered).not.toContain("Service Tier");
		expect(providersIndex).toBeGreaterThanOrEqual(0);
		if (appearanceIndex >= 0) {
			expect(appearanceIndex).toBeGreaterThan(providersIndex);
		}
	});

	it("supports editor hotkeys in the global search bar", () => {
		const comp = createSelector();
		const strip = (line: string): string => line.replace(/\x1b\[[0-9;]*m/g, "");
		const banner = (): string =>
			comp
				.render(120)
				.map(strip)
				.find(line => /\d+ match/.test(line)) ?? "";

		// alt+backspace deletes the trailing word from the query.
		for (const ch of "image provider") send(comp, ch);
		send(comp, "\x1b\x7f");
		expect(banner()).toContain("image");
		expect(banner()).not.toContain("provider");

		// Arrow keys move the cursor; typing inserts mid-query instead of appending.
		send(comp, "\x15"); // ctrl+u clears the rest of the query
		for (const ch of "model") send(comp, ch);
		for (let i = 0; i < 5; i++) send(comp, "\x1b[D");
		send(comp, "x");
		expect(banner()).toContain("xmodel");
	});

	it("delegates Escape to an open settings submenu before closing the selector", () => {
		let cancelCount = 0;
		settings.set("memory.backend", "off");
		const comp = createSelector(() => {
			cancelCount++;
		});
		focusMemoryTab(comp);

		send(comp, "\n");
		expect(comp.render(120).join("\n")).toContain("Esc to go back");

		send(comp, "\x1b");
		const afterBack = comp.render(120).join("\n");
		expect(cancelCount).toBe(0);
		expect(afterBack).toContain("Memory Backend");
		expect(afterBack).toContain("Esc to close");
		expect(afterBack).not.toContain("Esc to go back");

		send(comp, "\x1b");
		expect(cancelCount).toBe(1);
	});
});
