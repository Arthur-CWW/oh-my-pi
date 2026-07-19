import * as Effect from "effect/Effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { MVU_KEYMAP_TABLES } from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { HistorySearchComponent } from "@oh-my-pi/pi-coding-agent/modes/components/history-search";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { HistoryStorage } from "@oh-my-pi/pi-coding-agent/session/history-storage";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

beforeAll(() => {
	initTheme();
});

const tempDirs: string[] = [];

beforeEach(() => {
	HistoryStorage.resetInstance();
	vi.useFakeTimers();
});

afterEach(async () => {
	HistoryStorage.resetInstance();
	vi.useRealTimers();
	await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function makeStorage(prompts: string[]): Promise<HistoryStorage> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-history-selector-"));
	tempDirs.push(dir);
	HistoryStorage.resetInstance();
	const storage = HistoryStorage.open(path.join(dir, "history.db"));
	const writes = prompts.map(prompt => storage.add(prompt));
	vi.advanceTimersByTime(100);
	await Promise.all(writes);
	return storage;
}

function render(component: HistorySearchComponent, width = 80): { raw: string; plain: string } {
	const lines = component.render(width);
	const raw = lines.join("\n");
	return { raw, plain: Bun.stripANSI(raw) };
}

function driveRoute(component: HistorySearchComponent): (sequence: string) => void {
	const spec = component.mountSpec;
	const adapter = makeTerminalInputAdapter();
	const registry = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, KeybindingsManager.inMemory()));
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

function filter(component: HistorySearchComponent, query: string): void {
	const dispatch = driveRoute(component);
	dispatch("/");
	for (const character of query) dispatch(character);
}

describe("HistorySearchComponent", () => {
	it("paints the selected row with the selectedBg highlight bar and a relative timestamp", async () => {
		const component = new HistorySearchComponent(
			await makeStorage(["older prompt", "deploy the release"]),
			() => {},
			() => {},
		);

		const { raw, plain } = render(component);

		expect(plain).toContain("deploy the release");
		const selectedRow = raw.split("\n").find(line => line.includes("deploy the release"));
		expect(selectedRow).toBeDefined();
		expect(selectedRow).toContain(theme.getBgAnsi("selectedBg"));
		expect(plain).toContain("now");
	});

	it("highlights the matched query tokens within results", async () => {
		const component = new HistorySearchComponent(
			await makeStorage(["deploy the needle rollback", "routine status update"]),
			() => {},
			() => {},
		);

		filter(component, "needle");

		const { raw, plain } = render(component);
		expect(plain).toContain("deploy the needle rollback");
		expect(plain).not.toContain("routine status update");
		expect(raw).toContain(theme.fg("accent", "needle"));
	});

	it("distinguishes an empty query from an unmatched query", async () => {
		const empty = new HistorySearchComponent(await makeStorage([]), () => {}, () => {});
		expect(render(empty).plain).toContain("No history yet");

		const unmatched = new HistorySearchComponent(await makeStorage(["deploy the release"]), () => {}, () => {});
		filter(unmatched, "zzzz");
		expect(render(unmatched).plain).toContain("No matching history");
	});
});
