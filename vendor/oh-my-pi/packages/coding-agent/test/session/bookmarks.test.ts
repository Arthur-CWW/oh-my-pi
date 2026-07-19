import * as Effect from "effect/Effect";
import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MVU_KEYMAP_TABLES } from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { BookmarksSelectorComponent } from "../../src/modes/components/bookmarks-selector";
import { BookmarkTargetSchema, BookmarksStore } from "../../src/session/bookmarks";
import { initTheme } from "../../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme(false);
});

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

function target(agentId = "worker-a") {
	return { kind: "agent" as const, sessionId: "session-a", agentId, title: "Worker A" };
}

function dispatchConfirm(selector: BookmarksSelectorComponent): void {
	const spec = selector.mountSpec;
	const adapter = makeTerminalInputAdapter();
	const registry = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, KeybindingsManager.inMemory()));
	const model = spec.initialModel;
	const event = adapter.decode("\n");
	if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) throw new Error("Expected enter key event");
	const action = registry.resolve(spec.route.context(model), event.key);
	if (action === undefined) throw new Error("Unmapped bookmark confirmation key");
	const envelope = spec.route.actionToMsg(action, event);
	if (envelope === undefined) throw new Error("Unmapped bookmark confirmation action");
	const transition = spec.update(model, envelope);
	for (const command of transition.commands) Effect.runSync(spec.interpret(command));
}

describe("bookmarks store", () => {
	it("round-trips records and deduplicates by target while updating metadata", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-bookmarks-"));
		roots.push(root);
		const store = new BookmarksStore({
			filePath: path.join(root, "bookmarks-v1.jsonl"),
			now: () => new Date("2026-01-01T00:00:00.000Z"),
			idFactory: () => "bookmark-a",
		});
		const first = await store.upsert({ target: target(), cwd: "/repo", tag: "triage", note: "first" });
		const second = await store.upsert({ target: target(), cwd: "/repo", tag: "done", note: "updated" });
		expect(second.id).toBe(first.id);
		expect(await store.list()).toEqual([{ ...first, tag: "done", note: "updated" }]);
		expect(BookmarkTargetSchema).toBeDefined();
	});
});

describe("bookmark selector", () => {
	it("renders title, tag, age, origin and jumps the selected row", () => {
		const record = {
			id: "bookmark-a",
			createdAt: "2026-01-01T00:00:00.000Z",
			tag: "triage",
			note: "follow up",
			target: target(),
			cwd: "/repo",
		};
		let jumped: string | undefined;
		const selector = new BookmarksSelectorComponent(
			[record],
			entry => {
				jumped = entry.target.kind === "agent" ? entry.target.agentId : undefined;
			},
			() => {},
			{ now: () => Date.parse("2026-01-01T01:00:00.000Z") },
		);
		const rendered = selector.render(120).join("\n");
		expect(rendered).toContain("Worker A");
		expect(rendered).toContain("triage");
		expect(rendered).toContain("1h ago");
		expect(rendered).toContain("origin: session-a");
		dispatchConfirm(selector);
		expect(jumped).toBe("worker-a");
	});
});
