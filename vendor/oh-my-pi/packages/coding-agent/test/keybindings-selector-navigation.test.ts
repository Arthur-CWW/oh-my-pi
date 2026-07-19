import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import * as Effect from "effect/Effect";
import { MVU_KEYMAP_TABLES } from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import type { Keybinding } from "@oh-my-pi/pi-tui";
import type { SelectorSurfaceMountSpec } from "@oh-my-pi/pi-coding-agent/modes/components/selector-adapter";
import { createSessionTreeRoute, updateSessionTree, viewSessionTree } from "@oh-my-pi/pi-coding-agent/modes/components/tree-selector";
import { EXTENSION_DASHBOARD_ROUTE } from "@oh-my-pi/pi-coding-agent/modes/components/extensions/extension-dashboard";
import { reduceExtensionDashboard, type ExtensionDashboardModel } from "@oh-my-pi/pi-coding-agent/modes/components/extensions/state-manager";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { ExtensionList } from "@oh-my-pi/pi-coding-agent/modes/components/extensions/extension-list";
import type { Extension } from "@oh-my-pi/pi-coding-agent/modes/components/extensions/types";
import { HistorySearchComponent } from "@oh-my-pi/pi-coding-agent/modes/components/history-search";
import { SessionSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/session-selector";
import { UserMessageSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/user-message-selector";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { HistoryStorage } from "@oh-my-pi/pi-coding-agent/session/history-storage";
import type { SessionTreeNode } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import type { SessionInfo } from "@oh-my-pi/pi-coding-agent/session/session-listing";
import { setKeybindings } from "@oh-my-pi/pi-tui";

const CTRL_N = "\x0e";
const CTRL_P = "\x10";
const TEST_KEYBINDINGS = KeybindingsManager.inMemory({
	"app.navigation.up": "ctrl+p",
	"app.navigation.down": "ctrl+n",
});

const tempDirs: string[] = [];

beforeAll(() => {
	initTheme();
});

afterEach(async () => {
	setKeybindings(KeybindingsManager.inMemory());
	HistoryStorage.resetInstance();
	await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

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

function createMessageNode(id: string, parentId: string | null, content: string): SessionTreeNode {
	const message: AgentMessage = { role: "user", content, timestamp: 1 };
	return {
		entry: {
			type: "message",
			id,
			parentId,
			timestamp: "2024-01-01T00:00:00Z",
			message,
		},
		children: [],
	};
}

function createExtension(id: string, displayName: string): Extension {
	return {
		id,
		kind: "tool",
		name: id,
		displayName,
		description: displayName,
		path: `/tmp/${id}.md`,
		source: {
			provider: "test-provider",
			providerName: "Test Provider",
			level: "project",
		},
		state: "active",
		raw: {},
	};
}

async function createHistoryStorage(prompts: string[]): Promise<HistoryStorage> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-history-nav-"));
	tempDirs.push(dir);
	HistoryStorage.resetInstance();
	const storage = HistoryStorage.open(path.join(dir, "history.db"));
	// add() batches writes behind a 100ms AsyncDrain timer. Drive that timer with
	// fake timers so the flush is instant instead of waiting real wall-clock time.
	vi.useFakeTimers();
	try {
		const writes = prompts.map(prompt => storage.add(prompt));
		vi.advanceTimersByTime(100);
		await Promise.all(writes);
	} finally {
		vi.useRealTimers();
	}
	return storage;
}
function driveSelector<Id, Item>(
	spec: SelectorSurfaceMountSpec<Id, Item>,
	keybindings: KeybindingsManager,
): (sequence: string) => void {
	const adapter = makeTerminalInputAdapter();
	const registry = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, keybindings));
	let model = spec.initialModel;
	return sequence => {
		const event = adapter.decode(sequence);
		if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) {
			throw new Error(`Expected a decoded key event for ${JSON.stringify(sequence)}`);
		}
		const action = registry.resolve(spec.route.context(model), event.key);
		if (action === undefined) throw new Error(`Unmapped selector key ${JSON.stringify(sequence)}`);
		const envelope = spec.route.actionToMsg(action, event);
		if (envelope === undefined) throw new Error(`Unmapped selector action ${String(action)}`);
		const transition = spec.update(model, envelope);
		model = transition.model;
		for (const command of transition.commands) Effect.runSync(spec.interpret(command));
	};
}
function driveTree(
	roots: readonly SessionTreeNode[],
	keybindings: KeybindingsManager,
	onActivate: (id: string) => void,
): (sequence: string) => void {
	const route = createSessionTreeRoute(roots);
	const adapter = makeTerminalInputAdapter();
	const registry = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, keybindings));
	let model = route.initialModel;
	return sequence => {
		const event = adapter.decode(sequence);
		if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) throw new Error("Expected key event");
		const action = registry.resolve(route.context(model), event.key);
		if (action === undefined) throw new Error(`Unmapped tree key ${JSON.stringify(sequence)}`);
		const message = route.actionToMsg(action, event);
		if (message === undefined) throw new Error(`Unmapped tree action ${String(action)}`);
		const transition = updateSessionTree(model, message);
		model = transition.model;
		route.focusedRoot.apply(viewSessionTree(model, { offset: model.tree.viewportOffset, height: model.tree.viewportSize }));
		for (const command of transition.commands) {
			if (command._tag === "NavigateRequested") onActivate(command.targetId);
		}
	};
}

describe("selector navigation keybindings", () => {
	it("uses tui.select.down in the session selector", () => {
		setKeybindings(TEST_KEYBINDINGS);
		const selected: string[] = [];
		const selector = new SessionSelectorComponent(
			[createSession("session-a", "Alpha"), createSession("session-b", "Beta")],
			session => selected.push(session.path),
			() => {},
			() => {},
		);

		const dispatch = driveSelector(selector.mountSpec, TEST_KEYBINDINGS);
		dispatch(CTRL_N);
		dispatch("\n");

		expect(selected).toEqual(["/tmp/session-b.jsonl"]);
	});

	it("uses tui.select.down in the session tree", () => {
		setKeybindings(TEST_KEYBINDINGS);
		const root = createMessageNode("root", null, "Root");
		const child = createMessageNode("child", "root", "Child");
		root.children.push(child);
		const selected: string[] = [];
		const dispatch = driveTree([root], TEST_KEYBINDINGS, id => selected.push(id));
		dispatch(CTRL_N);
		dispatch("\n");

		expect(selected).toEqual(["child"]);
	});

	it("uses tui.select.up in the user message selector", () => {
		setKeybindings(TEST_KEYBINDINGS);
		const selected: string[] = [];
		const selector = new UserMessageSelectorComponent(
			[
				{ id: "first", text: "First" },
				{ id: "second", text: "Second" },
				{ id: "third", text: "Third" },
			],
			id => selected.push(id),
			() => {},
		);
		const dispatch = driveSelector(selector.mountSpec, TEST_KEYBINDINGS);
		dispatch(CTRL_P);
		dispatch("\n");


		expect(selected).toEqual(["second"]);
	});


	it("uses app.navigation.down in the extension dashboard route", () => {
		setKeybindings(TEST_KEYBINDINGS);
		const items = [createExtension("tool-a", "Tool A"), createExtension("tool-b", "Tool B")];
		let model: ExtensionDashboardModel = {
			sourceRevision: 0,
			requestGeneration: 0,
			loadState: "Idle",
			tabs: [{ id: "test-provider", label: "Test Provider", enabled: true, count: items.length }],
			activeTabId: "test-provider",
			extensions: items,
			disabledIds: [],
			query: "",
			selectedKey: undefined,
			viewportOffset: 0,
			viewportSize: 10,
			mode: "Browse",
		};
		const adapter = makeTerminalInputAdapter();
		const registry = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, TEST_KEYBINDINGS));
		const dispatch = (sequence: string) => {
			const event = adapter.decode(sequence);
			if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) throw new Error("Expected key event");
			const action = registry.resolve({ contexts: [EXTENSION_DASHBOARD_ROUTE.context], mode: model.mode, focus: "list", capabilities: new Set() }, event.key);
			if (action !== "app.navigation.down") throw new Error(`Expected navigation action, got ${String(action)}`);
			model = EXTENSION_DASHBOARD_ROUTE.update(model, { _tag: "Move", delta: 1 }).model;
		};
		dispatch(CTRL_N);
		expect(model.selectedKey).toBe("tool-a");
	});

	it("uses tui.select.down in history search", async () => {
		setKeybindings(TEST_KEYBINDINGS);
		const selected: string[] = [];
		const storage = await createHistoryStorage(["old prompt", "middle prompt", "new prompt"]);
		const selector = new HistorySearchComponent(
			storage,
			prompt => selected.push(prompt),
			() => {},
		);
		const dispatch = driveSelector(selector.mountSpec, TEST_KEYBINDINGS);
		dispatch(CTRL_N);
		dispatch("\n");

		expect(selected).toEqual(["middle prompt"]);
	});

	it("supports page and home/end navigation in history search", async () => {
		setKeybindings(KeybindingsManager.inMemory());
		const selected: string[] = [];
		// Added oldest-first; getRecent returns newest-first, so index 0 is "p14", index 14 is "p0".
		const storage = await createHistoryStorage(Array.from({ length: 15 }, (_, i) => `p${i}`));
		const selector = new HistorySearchComponent(
			storage,
			prompt => selected.push(prompt),
			() => {},
		);

		const PAGE_UP = "\x1b[5~";
		const PAGE_DOWN = "\x1b[6~";
		const HOME = "\x1b[H";
		const END = "\x1b[F";
		const dispatch = driveSelector(selector.mountSpec, KeybindingsManager.inMemory());
		dispatch(PAGE_DOWN); // index 0 -> 10  (p4)
		dispatch("\n");
		dispatch(END); // -> 14, last  (p0)
		dispatch("\n");
		dispatch(PAGE_UP); // index 14 -> 4  (p10)
		dispatch("\n");
		dispatch(HOME); // -> 0, first  (p14)
		dispatch("\n");

		expect(selected).toEqual(["p4", "p0", "p10", "p14"]);
	});
});
