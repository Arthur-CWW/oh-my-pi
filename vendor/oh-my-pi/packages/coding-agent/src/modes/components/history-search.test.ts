import * as Effect from "effect/Effect";
import { beforeAll, describe, expect, it } from "bun:test";
import type { Keybinding } from "@oh-my-pi/pi-tui";
import { KeybindingsManager } from "../../config/keybindings";
import { MVU_KEYMAP_TABLES } from "../../config/mvu-keybindings";
import { compileKeymapRegistry } from "../mvu/keymap-registry";
import { makeTerminalInputAdapter } from "../mvu/input-adapter";
import type { HistoryEntry, HistoryStorage } from "../../session/history-storage";
import { initTheme } from "../theme/theme";
import { HistorySearchComponent } from "./history-search";

beforeAll(async () => {
	await initTheme();
});

function makeEntry(id: number, prompt: string): HistoryEntry {
	return { id, prompt, created_at: id };
}

function makeStorage(entries: HistoryEntry[], searches: string[]): HistoryStorage {
	const tokenize = (query: string) =>
		query
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter(Boolean);
	return {
		getRecent: (limit: number) => entries.slice(0, limit),
		search: (query: string, limit: number) => {
			searches.push(query);
			const tokens = tokenize(query);
			return entries.filter(entry => tokens.every(token => entry.prompt.toLowerCase().includes(token))).slice(0, limit);
		},
	} as unknown as HistoryStorage;
}

function renderPlain(component: HistorySearchComponent): string {
	return Bun.stripANSI(component.render(100).join("\n"));
}

function driveRoute(component: HistorySearchComponent): (sequence: string) => void {
	const spec = component.mountSpec;
	const adapter = makeTerminalInputAdapter();
	const baseRegistry = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, KeybindingsManager.inMemory()));
	const registry = {
		resolve: (context: Parameters<typeof baseRegistry.resolve>[0], key: Parameters<typeof baseRegistry.resolve>[1]) =>
			String(key) === "ctrl+r" ? ("app.history.cycle" as Keybinding) : baseRegistry.resolve(context, key),
	};
	let model = spec.initialModel;
	return sequence => {
		const event = adapter.decode(sequence);
		if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) {
			throw new Error(`Expected a decoded key event for ${JSON.stringify(sequence)}`);
		}
		const action = registry.resolve(spec.route.context(model), event.key);
		if (action === undefined) throw new Error(`Unmapped history key ${JSON.stringify(sequence)}`);
		const envelope = spec.route.actionToMsg(action, event);
		if (envelope === undefined) throw new Error(`Unmapped history action ${String(action)}`);
		const pending = [envelope];
		while (pending.length > 0) {
			const message = pending.shift()!;
			const transition = spec.update(model, message);
			model = transition.model;
			for (const command of transition.commands) pending.push(...Effect.runSync(spec.interpret(command)));
		}
	};
}

describe("HistorySearchComponent behavior", () => {
	it("opens with an initial query, filters as it is typed, and accepts the selected prompt", () => {
		const entries = [
			makeEntry(3, "release latest to production"),
			makeEntry(2, "release older to staging"),
			makeEntry(1, "deploy unrelated change"),
		];
		const searches: string[] = [];
		const selected: string[] = [];
		const component = new HistorySearchComponent(
			makeStorage(entries, searches),
			prompt => selected.push(prompt),
			() => {},
			"release",
		);
		const dispatch = driveRoute(component);

		expect(searches).toEqual(["release"]);
		let rendered = renderPlain(component);
		expect(rendered).toContain("release latest to production");
		expect(rendered).toContain("release older to staging");
		expect(rendered).not.toContain("deploy unrelated change");

		for (const character of " latest") dispatch(character);
		expect(searches.at(-1)).toBe("release latest");
		rendered = renderPlain(component);
		expect(rendered).toContain("release latest to production");
		expect(rendered).not.toContain("release older to staging");

		dispatch("\n");
		expect(selected).toEqual(["release latest to production"]);
	});

	it("cycles older matching rows with repeated Ctrl-R and wraps to the newest row", () => {
		const entries = [makeEntry(3, "fix newest"), makeEntry(2, "fix older"), makeEntry(1, "fix oldest")];
		const selected: string[] = [];
		const component = new HistorySearchComponent(makeStorage(entries, []), prompt => selected.push(prompt), () => {}, "fix");
		const dispatch = driveRoute(component);

		dispatch("\x12");
		dispatch("\n");
		dispatch("\x12");
		dispatch("\n");
		dispatch("\x12");
		dispatch("\n");

		expect(selected).toEqual(["fix older", "fix oldest", "fix newest"]);
	});

	it("cancels without changing the caller's draft", () => {
		let callerDraft = "keep this draft";
		let cancelCalls = 0;
		const component = new HistorySearchComponent(
			makeStorage([makeEntry(1, "existing prompt")], []),
			() => {
				callerDraft = "changed";
			},
			() => {
				cancelCalls++;
			},
			"existing",
		);
		const dispatch = driveRoute(component);
		dispatch("\x1b");

		expect(cancelCalls).toBe(1);
		expect(callerDraft).toBe("keep this draft");
	});
});
