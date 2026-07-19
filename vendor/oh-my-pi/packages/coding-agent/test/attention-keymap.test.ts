import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import type { Keybinding, KeyId } from "@oh-my-pi/pi-tui";
import { KeybindingsManager } from "../src/config/keybindings";
import {
	ATTENTION_FAMILY_KEYMAP,
	MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX,
	MVU_KEYMAP_TABLES,
} from "../src/config/mvu-keybindings";
import { compileKeymapRegistry } from "../src/modes/mvu/keymap-registry";

const active = (mode: "Browse" | "Triage", focus: "list" | "triage") => ({
	contexts: ["attention.family"],
	mode,
	focus,
	capabilities: new Set(["attention"]),
});

describe("attention keymap", () => {
	it("uses one triage table for every attention-capable route", () => {
		const registry = Effect.runSync(
			compileKeymapRegistry(
				MVU_KEYMAP_TABLES,
				KeybindingsManager.inMemory(),
				MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX,
			),
		);
		expect(registry.resolve(active("Browse", "list"), "a" as KeyId)).toBe("app.attention.open");
		const actions: Record<string, Keybinding> = {
			n: "app.attention.now",
			x: "app.attention.next",
			w: "app.attention.waiting",
			l: "app.attention.later",
			h: "app.attention.hidden",
			s: "app.attention.snooze",
			t: "app.attention.tags",
			b: "app.attention.bookmark",
			o: "app.attention.note",
		};
		for (const [key, action] of Object.entries(actions)) {
			expect(registry.resolve(active("Triage", "triage"), key as KeyId)).toBe(action);
		}
	});

	it("does not claim lifecycle g chords in triage", () => {
		const registry = Effect.runSync(compileKeymapRegistry([ATTENTION_FAMILY_KEYMAP], KeybindingsManager.inMemory()));
		expect(registry.resolve(active("Triage", "triage"), "g" as KeyId)).toBeUndefined();
	});
});
