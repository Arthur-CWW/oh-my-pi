import * as Effect from "effect/Effect";
import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
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

afterEach(() => {
	vi.restoreAllMocks();
});

const SESSION_SELECTOR_KEYMAP: KeymapTable = {
	id: makeKeymapId("test.session-selector-delete"),
	layer: "adapter",
	contexts: ["selector.global"],
	bindings: [
		{ key: "delete" as KeyId, action: "app.session.delete" as Keybinding, when: { mode: "Browse", focus: "list" } },
	],
};

function createSession(id: string, title: string): SessionInfo {
	return {
		path: `/tmp/${id}.jsonl`,
		id,
		cwd: "/tmp",
		title,
		created: new Date("2024-01-01T00:00:00Z"),
		modified: new Date("2024-01-02T00:00:00Z"),
		messageCount: 1,
		size: 0,
		firstMessage: `${title} first message`,
		allMessagesText: `${title} first message`,
	};
}

function createSelector(onDelete: (session: SessionInfo) => Promise<boolean>): SessionSelectorComponent {
	return new SessionSelectorComponent(
		[createSession("session-a", "Alpha"), createSession("session-b", "Beta")],
		() => {},
		() => {},
		() => {},
		{ onDelete },
	);
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

function renderText(selector: SessionSelectorComponent): string {
	return selector.render(120).join("\n");
}

describe("SessionSelectorComponent delete confirmation", () => {
	it("keeps the session visible and shows the error when delete fails after confirmation", async () => {
		const onDelete = vi.fn(async () => {
			throw new Error("disk failed");
		});
		const selector = createSelector(onDelete);
		const dispatch = driveSelector(selector);

		await dispatch("\x1b[3~");
		expect(renderText(selector)).toContain("Delete session?");
		expect(renderText(selector)).toContain("Alpha");

		await dispatch("\n");

		const rendered = renderText(selector);
		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(rendered).toContain("Error: disk failed");
		expect(rendered).toContain("Alpha");
		expect(rendered).toContain("Beta");
		expect(rendered).not.toContain("Delete session?");
	});

	it("keeps the session visible when delete is canceled upstream", async () => {
		const onDelete = vi.fn(async () => false);
		const selector = createSelector(onDelete);
		const dispatch = driveSelector(selector);

		await dispatch("\x1b[3~");
		await dispatch("\n");

		const rendered = renderText(selector);
		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(rendered).toContain("Alpha");
		expect(rendered).toContain("Beta");
		expect(rendered).not.toContain("Error:");
	});

	it("removes the session row after a successful delete", async () => {
		const onDelete = vi.fn(async () => true);
		const selector = createSelector(onDelete);
		const dispatch = driveSelector(selector);

		await dispatch("\x1b[3~");
		await dispatch("\n");

		const rendered = renderText(selector);
		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(rendered).not.toContain("Alpha");
		expect(rendered).toContain("Beta");
	});
});
