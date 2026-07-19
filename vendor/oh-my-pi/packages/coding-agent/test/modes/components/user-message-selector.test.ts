import * as Effect from "effect/Effect";
import { beforeAll, describe, expect, it } from "bun:test";
import { MVU_KEYMAP_TABLES } from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { UserMessageSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/user-message-selector";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

function driveSelector(selector: UserMessageSelectorComponent): (sequence: string) => void {
	const spec = selector.mountSpec;
	const adapter = makeTerminalInputAdapter();
	const registry = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, KeybindingsManager.inMemory()));
	let model = spec.initialModel;
	return sequence => {
		const event = adapter.decode(sequence);
		if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) {
			throw new Error(`Expected a decoded key event for ${JSON.stringify(sequence)}`);
		}
		const action = registry.resolve(spec.route.context(model), event.key);
		if (action === undefined) throw new Error(`Unmapped user message key ${JSON.stringify(sequence)}`);
		const envelope = spec.route.actionToMsg(action, event);
		if (envelope === undefined) throw new Error(`Unmapped user message action ${String(action)}`);
		const transition = spec.update(model, envelope);
		model = transition.model;
		for (const command of transition.commands) Effect.runSync(spec.interpret(command));
	};
}

describe("UserMessageSelectorComponent", () => {
	it("fuzzy-filters overflowing message lists from typed input", () => {
		const selected: string[] = [];
		const messages = Array.from({ length: 11 }, (_, index) => ({
			id: `message-${index}`,
			text: index === 7 ? "Deploy the needle rollback plan" : `Routine status update ${index}`,
		}));
		const component = new UserMessageSelectorComponent(
			messages,
			id => selected.push(id),
			() => {},
		);
		const dispatch = driveSelector(component);

		dispatch("/");
		for (const char of "needle") dispatch(char);

		const rendered = component
			.render(80)
			.map(line => Bun.stripANSI(line))
			.join("\n");
		expect(rendered).toContain("Deploy the needle rollback plan");
		expect(rendered).not.toContain("Routine status update");
		expect(rendered).toContain("Search: needle");

		dispatch("\n");
		expect(selected).toEqual(["message-7"]);
	});
});
