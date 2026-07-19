import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import type { KeyId } from "@oh-my-pi/pi-tui";
import { KeybindingsManager } from "../src/config/keybindings";
import {
	AGENT_HUB_MVU_KEYMAP,
	MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX,
	MVU_KEYMAP_TABLES,
	SELECTOR_GLOBAL_KEYMAP,
} from "../src/config/mvu-keybindings";
import { compileKeymapRegistry } from "../src/modes/mvu/keymap-registry";
import {
	type ActionId,
	type ActiveKeymapContextMatrix,
	type KeymapBinding,
	type KeymapTable,
	makeKeymapId,
} from "../src/modes/mvu/schema";

const action = (value: string): ActionId => value as ActionId;
const binding = (key: string, actionId: string, override?: KeymapBinding["override"]): KeymapBinding => ({
	source: { _tag: "Literal" },
	key: key as KeyId,
	action: action(actionId),
	when: { mode: "Browse", focus: "list" },
	override,
});
const capabilityBinding = (key: string, actionId: string, capability: string): KeymapBinding => ({
	source: { _tag: "Literal" },
	key: key as KeyId,
	action: action(actionId),
	when: { mode: "Browse", focus: "list", capability },
});
const resolvedBinding = (actionId: string, literals: readonly string[] = []): KeymapBinding => ({
	source: {
		_tag: "ResolvedAction",
		...(literals.length === 0 ? {} : { literals: literals as readonly KeyId[] }),
	},
	action: action(actionId),
	when: { mode: "Browse", focus: "list" },
});
const table = (
	id: string,
	layer: KeymapTable["layer"],
	bindings: readonly KeymapBinding[],
	contexts: readonly string[] = ["test"],
	supersedesContexts?: readonly string[],
): KeymapTable => ({
	id: makeKeymapId(id),
	layer,
	contexts,
	...(supersedesContexts === undefined ? {} : { supersedesContexts }),
	bindings,
});
const manager = KeybindingsManager.inMemory();

function compile(tables: readonly KeymapTable[], matrix: ActiveKeymapContextMatrix = []): void {
	Effect.runSync(compileKeymapRegistry(tables, manager, matrix));
}

describe("MVU keymap registry conflicts", () => {
	it("accepts deterministic global/family/adapter layering with an exact override", () => {
		const registry = Effect.runSync(
			compileKeymapRegistry(
				[
					table("global", "global", [binding("j", "app.navigation.down")]),
					table("family", "family", [
						binding("j", "app.selector.preview", { replaces: action("app.navigation.down"), reason: "preview takes the family slot" }),
					]),
				],
				manager,
			),
		);
		expect(registry.resolve({ contexts: ["test"], mode: "Browse", focus: "list", capabilities: new Set() }, "j" as KeyId)).toBe("app.selector.preview");
	});

	it("separates resolved action keys from literal contextual keys", () => {
		const configured = KeybindingsManager.inMemory({ "app.navigation.down": "ctrl+n" });
		const registry = Effect.runSync(compileKeymapRegistry([
			table("resolved", "global", [resolvedBinding("app.navigation.down", ["down"])]),
			table("literal", "adapter", [binding("delete", "app.session.delete")]),
		], configured));
		const active = { contexts: ["test"], mode: "Browse" as const, focus: "list" as const, capabilities: new Set<string>() };

		expect(registry.resolve(active, "ctrl+n" as KeyId)).toBe("app.navigation.down");
		expect(registry.resolve(active, "down" as KeyId)).toBe("app.navigation.down");
		expect(registry.resolve(active, "j" as KeyId)).toBeUndefined();
		expect(registry.resolve(active, "delete" as KeyId)).toBe("app.session.delete");
		expect(registry.resolve(active, "ctrl+d" as KeyId)).toBeUndefined();
	});

	it("rejects duplicate claims in one active tuple", () => {
		expect(() => compile([
			table("one", "global", [binding("j", "app.navigation.down")]),
			table("two", "global", [binding("j", "app.navigation.down")]),
		])).toThrow();
	});

	it("rejects implicit replacement, missing targets, and override chains", () => {
		expect(() => compile([
			table("one", "global", [binding("j", "app.navigation.down")]),
			table("two", "family", [binding("j", "app.selector.preview")]),
		])).toThrow();
		expect(() => compile([table("one", "global", [binding("j", "app.navigation.down", {
			replaces: action("app.navigation.up"), reason: "wrong target",
		})])])).toThrow();
		expect(() => compile([
			table("one", "global", [binding("j", "app.navigation.down")]),
			table("two", "family", [binding("j", "app.selector.preview", {
				replaces: action("app.navigation.down"), reason: "first replacement",
			})]),
			table("three", "adapter", [binding("j", "app.selector.filter", {
				replaces: action("app.selector.preview"), reason: "replacement chain",
			})]),
		])).toThrow();
	});
	it("rejects a family and adapter collision only when their contexts are simultaneously active", () => {
		const tables = [
			table("family", "family", [binding("j", "app.selector.preview")], ["family"]),
			table("adapter", "adapter", [binding("j", "app.agents.hub")], ["adapter"]),
		];
		expect(() => compile(tables)).not.toThrow();
		expect(() =>
			compile(tables, [{
				contexts: ["family", "adapter"],
				mode: "Browse",
				focus: "list",
				capabilities: new Set(),
			}]),
		).toThrow();
	});

	it("resolves the combined claim independently of active context order", () => {
		const registry = Effect.runSync(
			compileKeymapRegistry(
				[
					table("family", "family", [binding("j", "app.selector.preview")], ["family"]),
					table("adapter", "adapter", [binding("j", "app.agents.hub")], ["adapter"], ["family"]),
				],
				manager,
			),
		);
		const capabilities = new Set<string>();
		const familyFirst = { contexts: ["family", "adapter"], mode: "Browse" as const, focus: "list" as const, capabilities };
		const adapterFirst = { ...familyFirst, contexts: ["adapter", "family"] };
		expect(registry.resolve(familyFirst, "j" as KeyId)).toBe("app.agents.hub");
		expect(registry.resolve(adapterFirst, "j" as KeyId)).toBe("app.agents.hub");
	});

	it("keeps the declared Hub adapter layering valid with selector globals", () => {
		const registry = Effect.runSync(
			compileKeymapRegistry([SELECTOR_GLOBAL_KEYMAP, AGENT_HUB_MVU_KEYMAP], manager),
		);
		const active = {
			contexts: ["selector.global", "hub.route"],
			mode: "Browse" as const,
			focus: "list" as const,
			capabilities: new Set<string>(),
		};
		const reversed = { ...active, contexts: [...active.contexts].reverse() };
		expect(registry.resolve(active, "j" as KeyId)).toBe("app.agents.hub");
		expect(registry.resolve(reversed, "j" as KeyId)).toBe("app.agents.hub");
	});

	it("validates selector, Hub, setup, and dock routes without treating adapters as globally active", () => {
		const registry = Effect.runSync(
			compileKeymapRegistry(
				MVU_KEYMAP_TABLES,
				manager,
				MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX,
			),
		);
		const browse = {
			mode: "Browse" as const,
			focus: "list" as const,
			capabilities: new Set<string>(),
		};
		expect(registry.resolve({ ...browse, contexts: ["selector.global"] }, "j" as KeyId)).toBe("app.navigation.down");
		expect(registry.resolve({ ...browse, contexts: ["selector.global", "hub.route"] }, "p" as KeyId)).toBe("app.agents.hub");
		expect(registry.resolve({ ...browse, contexts: ["setup.glyph", "selector.global"] }, "p" as KeyId)).toBe("setup.input");
		expect(registry.resolve({ ...browse, contexts: ["errors.dock", "selector.global"] }, "p" as KeyId)).toBe("app.errors.togglePin");
	});
	it("routes shared filter deletion and tree label editing as semantic actions", () => {
		const registry = Effect.runSync(
			compileKeymapRegistry(MVU_KEYMAP_TABLES, manager, MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX),
		);
		const capability = new Set(["selector.filter"]);
		expect(registry.resolve({
			contexts: ["selector.global", "selector.filter"],
			mode: "Filter",
			focus: "list",
			capabilities: capability,
		}, "backspace" as KeyId)).toBe("app.selector.filterDelete");
		expect(registry.resolve({
			contexts: ["selector.global", "selector.filter"],
			mode: "TreeFilter",
			focus: "list",
			capabilities: capability,
		}, "backspace" as KeyId)).toBe("app.selector.filterDelete");
		const labelContext = {
			contexts: ["selector.global", "selector.filter"],
			mode: "TreeLabelEdit" as const,
			focus: "preview" as const,
			capabilities: capability,
		};
		expect(registry.resolve(labelContext, "x" as KeyId)).toBe("app.tree.labelAppend");
		expect(registry.resolve(labelContext, "backspace" as KeyId)).toBe("app.tree.labelDelete");
		expect(registry.resolve(labelContext, "enter" as KeyId)).toBe("app.tree.labelCommit");
	});
	it("rejects cross-context collisions introduced by resolved user keys", () => {
		const configured = KeybindingsManager.inMemory({ "app.navigation.down": "ctrl+n" });
		expect(() =>
			Effect.runSync(
				compileKeymapRegistry(
					[
						table("global", "global", [resolvedBinding("app.navigation.down")], ["global"]),
						table("family", "family", [binding("ctrl+n", "app.selector.preview")], ["family"]),
					],
					configured,
					[{
						contexts: ["global", "family"],
						mode: "Browse",
						focus: "list",
						capabilities: new Set(),
					}],
				),
			),
		).toThrow();
	});
	it("rejects a production model-selector collision introduced by a user remap", () => {
		const configured = KeybindingsManager.inMemory({ "app.navigation.down": "tab" });
		expect(() =>
			Effect.runSync(
				compileKeymapRegistry(
					MVU_KEYMAP_TABLES,
					configured,
					MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX,
				),
			),
		).toThrow();
	});
	it("allows disjoint capability claims and validates combined capability states", () => {
		const matrix = [
			{ contexts: ["family", "adapter"], mode: "Browse" as const, focus: "list" as const, capabilities: new Set(["family"]) },
			{ contexts: ["family", "adapter"], mode: "Browse" as const, focus: "list" as const, capabilities: new Set(["adapter"]) },
		];
		const registry = Effect.runSync(
			compileKeymapRegistry(
				[
					table("family", "family", [capabilityBinding("j", "app.selector.preview", "family")], ["family"]),
					table("adapter", "adapter", [capabilityBinding("j", "app.agents.hub", "adapter")], ["adapter"]),
				],
				manager,
				matrix,
			),
		);
		expect(registry.resolve(matrix[0], "j" as KeyId)).toBe("app.selector.preview");
		expect(registry.resolve(matrix[1], "j" as KeyId)).toBe("app.agents.hub");
	});
});
