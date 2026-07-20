import * as Effect from "effect/Effect";
import { beforeAll, describe, expect, it } from "bun:test";
import type { Keybinding, KeyId } from "@oh-my-pi/pi-tui";
import { MVU_KEYMAP_TABLES } from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { makeKeymapId, type KeymapTable } from "@oh-my-pi/pi-coding-agent/modes/mvu/schema";
import { SessionSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/session-selector";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { SessionInfo } from "@oh-my-pi/pi-coding-agent/session/session-listing";

beforeAll(() => {
	initTheme();
});

const SESSION_SELECTOR_KEYMAP: KeymapTable = {
	id: makeKeymapId("test.session-selector"),
	layer: "adapter",
	contexts: ["selector.global"],
	bindings: [
		{ key: "tab" as KeyId, action: "app.session.togglePath" as Keybinding, when: { mode: "Browse", focus: "list" } },
	],
};

function createSession(id: string, title: string, cwd: string): SessionInfo {
	return {
		path: `${cwd}/${id}.jsonl`,
		id,
		cwd,
		title,
		created: new Date("2024-01-01T00:00:00Z"),
		modified: new Date("2024-01-02T00:00:00Z"),
		messageCount: 1,
		size: 0,
		firstMessage: `${title} first message`,
		allMessagesText: `${title} first message`,
	};
}

function driveSelector(selector: SessionSelectorComponent): (sequence: string) => Promise<void> {
	const spec = selector.mountSpec;
	const adapter = makeTerminalInputAdapter();
	const registry = Effect.runSync(compileKeymapRegistry([...MVU_KEYMAP_TABLES, SESSION_SELECTOR_KEYMAP], KeybindingsManager.inMemory()));
	let model = spec.initialModel;
	return async sequence => {
		const event = adapter.decode(sequence);
		if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) {
			throw new Error(`Expected a decoded key event for ${JSON.stringify(sequence)}`);
		}
		const action = registry.resolve(spec.route.context(model), event.key);
		if (action === undefined) throw new Error(`Unmapped session selector key ${JSON.stringify(sequence)}`);
		const envelope = spec.route.actionToMsg(action, event);
		if (envelope === undefined) throw new Error(`Unmapped session selector action ${String(action)}`);
		const pending = [envelope];
		while (pending.length > 0) {
			const message = pending.shift()!;
			const transition = spec.update(model, message);
			model = transition.model;
			for (const command of transition.commands) pending.push(...await Effect.runPromise(spec.interpret(command)));
		}
	};
}

const TAB = "\t";

describe("SessionSelectorComponent scope toggle", () => {
	it("loads the all-projects list on Tab and surfaces each session's directory", async () => {
		const folder = [createSession("local", "Local", "/work/current")];
		const global = [
			createSession("local", "Local", "/work/current"),
			createSession("remote", "Remote", "/work/other-project"),
		];
		let loads = 0;
		const selector = new SessionSelectorComponent(
			folder,
			() => {},
			() => {},
			() => {},
			{
				loadAllSessions: async () => {
					loads++;
					return global;
				},
			},
		);
		const dispatch = driveSelector(selector);

		expect(selector.render(120).join("\n")).toContain("(current folder)");
		expect(selector.render(120).join("\n")).not.toContain("other-project");

		await dispatch(TAB);

		const rendered = selector.render(120).join("\n");
		expect(rendered).toContain("(all projects)");
		expect(rendered).toContain("other-project");
		expect(loads).toBe(1);

		await dispatch(TAB);
		expect(selector.render(120).join("\n")).toContain("(current folder)");
		expect(loads).toBe(1);

		await dispatch(TAB);
		expect(loads).toBe(1);
	});

	it("returns the full selected session, including its cwd", async () => {
		const folder = [createSession("local", "Local", "/work/current")];
		const remote = createSession("remote", "Remote", "/work/other-project");
		const selected: SessionInfo[] = [];
		const selector = new SessionSelectorComponent(
			folder,
			session => selected.push(session),
			() => {},
			() => {},
			{ loadAllSessions: async () => [remote] },
		);
		const dispatch = driveSelector(selector);

		await dispatch(TAB);
		await dispatch("\n");

		expect(selected).toHaveLength(1);
		expect(selected[0]?.path).toBe(remote.path);
		expect(selected[0]?.cwd).toBe("/work/other-project");
	});

	it("opens directly in all-projects scope when started there with a preloaded list", () => {
		const global = [createSession("remote", "Remote", "/work/other-project")];
		const selector = new SessionSelectorComponent(
			[],
			() => {},
			() => {},
			() => {},
			{ allSessions: global, startInAllScope: true, loadAllSessions: async () => global },
		);

		const rendered = selector.render(120).join("\n");
		expect(rendered).toContain("(all projects)");
		expect(rendered).toContain("other-project");
	});
});

describe("SessionSelectorComponent filtering and dismissal", () => {
	it("enters slash filtering, shows the query, and appends/deletes it with Backspace", async () => {
		const selector = new SessionSelectorComponent(
			[createSession("alpha", "Alpha", "/work/current"), createSession("beta", "Beta", "/work/current")],
			() => {},
			() => {},
			() => {},
		);
		const dispatch = driveSelector(selector);

		await dispatch("/");
		expect(selector.render(120).join("\n")).toContain("Type to search");

		await dispatch("a");
		await dispatch("l");
		await dispatch("p");
		expect(selector.render(120).join("\n")).toContain("Search: alp");
		expect(selector.render(120).join("\n")).toContain("Alpha");
		expect(selector.render(120).join("\n")).not.toContain("Beta");

		await dispatch("\x7f");
		expect(selector.render(120).join("\n")).toContain("Search: al");
		expect(selector.render(120).join("\n")).toContain("Alpha");
		expect(selector.render(120).join("\n")).not.toContain("Beta");

		await dispatch("\x7f");
		await dispatch("\x7f");
		expect(selector.render(120).join("\n")).toContain("Type to search");
		expect(selector.render(120).join("\n")).toContain("Beta");
	});

	it("clears the filter on the first Esc and dismisses on the second", async () => {
		let cancels = 0;
		const selector = new SessionSelectorComponent(
			[createSession("alpha", "Alpha", "/work/current")],
			() => {},
			() => {
				cancels++;
			},
			() => {},
		);
		const dispatch = driveSelector(selector);

		await dispatch("/");
		await dispatch("a");
		await dispatch("\x1b");
		expect(cancels).toBe(0);
		expect(selector.render(120).join("\n")).toContain("Alpha");

		await dispatch("\x1b");
		expect(cancels).toBe(1);
	});

	it("dismisses an empty selector with ui.dismiss", async () => {
		let cancels = 0;
		const selector = new SessionSelectorComponent(
			[],
			() => {},
			() => {
				cancels++;
			},
			() => {},
		);

		await driveSelector(selector)("\x1b");
		expect(cancels).toBe(1);
	});

	it("closes populated and empty selectors through app.interrupt", async () => {
		for (const sessions of [
			[createSession("alpha", "Alpha", "/work/current")],
			[],
		]) {
			let exits = 0;
			const selector = new SessionSelectorComponent(
				sessions,
				() => {},
				() => {},
				() => {
					exits++;
				},
			);

			await driveSelector(selector)("\x03");
			expect(exits).toBe(1);
		}
	});
});
