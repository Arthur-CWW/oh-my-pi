import { beforeAll, describe, expect, it } from "bun:test";
import * as os from "node:os";
import { stripVTControlCharacters } from "node:util";
import type { InstalledPlugin } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/types";
import type { InstalledPluginSummary } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/marketplace/types";
import {
	makePluginSettingsModalModel,
	type PluginSettingsModalModel,
	updatePluginSettingsModal,
	MarketplacePluginDetailComponent,
	PluginListComponent,
	type PluginListEntry,
	PluginSettingsComponent,
} from "@oh-my-pi/pi-coding-agent/modes/components/plugin-settings";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

const npm = (name: string, opts: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
	name,
	version: "1.2.3",
	path: `/cache/npm/${name}`,
	manifest: { version: "1.2.3", description: `desc ${name}` },
	enabledFeatures: null,
	enabled: true,
	...opts,
});

const marketplace = (
	id: string,
	opts: Partial<Omit<InstalledPluginSummary, "id" | "entries">> & {
		entry?: Partial<InstalledPluginSummary["entries"][number]>;
	} = {},
): InstalledPluginSummary => ({
	id,
	scope: opts.scope ?? "user",
	shadowedBy: opts.shadowedBy,
	entries: [
		{
			scope: opts.scope ?? "user",
			installPath: `/cache/marketplace/${id}`,
			version: "0.4.2",
			installedAt: "2026-01-02T03:04:05.000Z",
			lastUpdated: "2026-02-03T04:05:06.000Z",
			enabled: true,
			...opts.entry,
		},
	],
});

describe("PluginListComponent", () => {
	it("renders marketplace plugins when no npm plugins are installed", () => {
		const entries: PluginListEntry[] = [
			{ kind: "marketplace", plugin: marketplace("developer-essentials@claude-code-workflows") },
			{ kind: "marketplace", plugin: marketplace("hyperpowers@withzombies-hyper") },
		];

		const component = new PluginListComponent(entries, {
			onNpmSelect: () => {},
			onMarketplaceSelect: () => {},
			onCancel: () => {},
		});

		const text = stripVTControlCharacters(component.render(120).join("\n"));
		expect(text).not.toContain("No plugins installed");
		expect(text).toContain("developer-essentials@claude-code-workflows");
		expect(text).toContain("hyperpowers@withzombies-hyper");
		expect(text).toContain("[marketplace]");
	});

	it("renders npm and marketplace plugins together with kind badges", () => {
		const entries: PluginListEntry[] = [
			{ kind: "npm", plugin: npm("local-plugin") },
			{ kind: "marketplace", plugin: marketplace("remote@mkt") },
		];

		const component = new PluginListComponent(entries, {
			onNpmSelect: () => {},
			onMarketplaceSelect: () => {},
			onCancel: () => {},
		});

		const text = stripVTControlCharacters(component.render(120).join("\n"));
		expect(text).toContain("local-plugin");
		expect(text).toContain("[npm]");
		expect(text).toContain("remote@mkt");
		expect(text).toContain("[marketplace]");
	});

	it("marks shadowed marketplace entries and surfaces scope tag", () => {
		const entries: PluginListEntry[] = [
			{
				kind: "marketplace",
				plugin: marketplace("shared@mkt", { scope: "user", shadowedBy: "project" }),
			},
		];

		const component = new PluginListComponent(entries, {
			onNpmSelect: () => {},
			onMarketplaceSelect: () => {},
			onCancel: () => {},
		});

		const text = stripVTControlCharacters(component.render(120).join("\n"));
		expect(text).toContain("[user]");
		expect(text).toContain("shadowed");
	});

	it("empty-state mentions both npm and marketplace install commands", () => {
		const component = new PluginListComponent([], {
			onNpmSelect: () => {},
			onMarketplaceSelect: () => {},
			onCancel: () => {},
		});

		const text = stripVTControlCharacters(component.render(120).join("\n"));
		expect(text).toContain("No plugins installed");
		expect(text).toContain("omp plugin install <package>");
		expect(text).toContain("omp plugin install <name>@<marketplace>");
	});

	it("opens the selected marketplace entry through the plugin reducer", () => {
		const model = loadedPluginSettingsModel([
			{ kind: "npm", plugin: npm("filler") },
			{ kind: "marketplace", plugin: marketplace("pick@mkt") },
		]);
		const selected = updatePluginSettingsModal(model, {
			_tag: "SelectIndex",
			index: 1,
			activate: true,
		});

		expect(selected.commands).toEqual([]);
		expect(selected.model.region).toBe("detail");
		expect(selected.model.depth.at(-1)?.layer).toEqual({
			_tag: "PluginDetail",
			id: "pick@mkt",
			kind: "marketplace",
		});
	});
});

function loadedPluginSettingsModel(entries: readonly PluginListEntry[]): PluginSettingsModalModel {
	const loading = updatePluginSettingsModal(makePluginSettingsModalModel(), { _tag: "LoadEntries" });
	const stamp = loading.model.pendingEntries;
	if (stamp === undefined) throw new Error("plugin entry request stamp missing");
	return updatePluginSettingsModal(loading.model, { _tag: "EntriesLoaded", entries, ...stamp }).model;
}

describe("PluginSettingsComponent", () => {
	it("commits a marketplace toggle through the pure model before rendering it", () => {
		const plugin = marketplace("toggle@mkt");
		let model = loadedPluginSettingsModel([{ kind: "marketplace", plugin }]);
		model = updatePluginSettingsModal(model, { _tag: "SelectIndex", index: 0, activate: true }).model;

		const toggled = updatePluginSettingsModal(model, { _tag: "SelectIndex", index: 0, activate: true });
		expect(toggled.commands).toHaveLength(1);
		expect(toggled.commands[0]).toMatchObject({
			_tag: "PluginOperationRequested",
			operation: "disable",
			pluginId: "toggle@mkt",
			kind: "marketplace",
			scope: "user",
		});
		expect(toggled.model.entries[0]).toEqual({ kind: "marketplace", plugin });

		const stamp = toggled.model.pendingAction;
		if (stamp === undefined) throw new Error("plugin operation stamp missing");
		const receipt = toggled.model.receipt;
		if (receipt._tag !== "Pending") throw new Error("pending plugin receipt missing");
		const committed = updatePluginSettingsModal(toggled.model, {
			_tag: "ActionSucceeded",
			receiptId: receipt.receiptId,
			message: "saved",
			...stamp,
		}).model;
		const committedEntry = committed.entries[0];
		expect(committedEntry?.kind).toBe("marketplace");
		if (committedEntry?.kind !== "marketplace") throw new Error("committed marketplace entry missing");
		expect(committedEntry.plugin.entries.every(entry => !entry.enabled)).toBe(true);

		const component = new PluginSettingsComponent();
		component.apply(committed);
		const text = stripVTControlCharacters(component.render(120).join("\n"));
		expect(text).toContain("toggle@mkt");
		expect(text).toContain("Enabled");
		expect(text).toContain("false");
	});

	it("closes on dismiss while the plugin list is still loading", () => {
		const loading = updatePluginSettingsModal(makePluginSettingsModalModel(), { _tag: "LoadEntries" });
		const component = new PluginSettingsComponent();
		component.apply(loading.model);
		expect(stripVTControlCharacters(component.render(120).join("\n"))).toContain("Loading plugins");

		const dismissed = updatePluginSettingsModal(loading.model, { _tag: "Back" });
		expect(dismissed.commands).toEqual([{ _tag: "CloseRequested" }]);

		const ignored = updatePluginSettingsModal(loading.model, {
			_tag: "SelectIndex",
			index: 0,
			activate: true,
		});
		expect(ignored.commands).toEqual([]);
		expect(ignored.model).toEqual(loading.model);
	});

	it("mounts marketplace entries from a successful partial service result", () => {
		const model = loadedPluginSettingsModel([
			{ kind: "marketplace", plugin: marketplace("survivor@mkt") },
		]);
		expect(model.loaded).toBe(true);
		expect(model.loading).toBe(false);

		const component = new PluginSettingsComponent();
		component.apply(model);
		expect(stripVTControlCharacters(component.render(120).join("\n"))).toContain("survivor@mkt");

		expect(updatePluginSettingsModal(model, { _tag: "Back" }).commands).toEqual([
			{ _tag: "CloseRequested" },
		]);
	});
});

describe("MarketplacePluginDetailComponent", () => {
	it("exposes the enable toggle and metadata", () => {
		const plugin = marketplace("plugin@mkt", {
			entry: { gitCommitSha: "abc1234", enabled: false },
		});

		const component = new MarketplacePluginDetailComponent(plugin, {
			onEnabledChange: () => {},
			onBack: () => {},
		});

		const text = stripVTControlCharacters(component.render(120).join("\n"));
		expect(text).toContain("plugin@mkt");
		expect(text).toContain("Enabled");
		// Read-only metadata must surface, including scope and the git commit SHA.
		expect(text).toContain("0.4.2");
		expect(text).toContain("abc1234");
		expect(text).toContain("user");
		expect(text).toContain("/cache/marketplace/plugin@mkt");
	});

	it("requests disabling an enabled marketplace plugin through the plugin reducer", () => {
		let model = loadedPluginSettingsModel([
			{ kind: "marketplace", plugin: marketplace("toggle@mkt") },
		]);
		model = updatePluginSettingsModal(model, { _tag: "SelectIndex", index: 0, activate: true }).model;
		const toggled = updatePluginSettingsModal(model, {
			_tag: "SelectIndex",
			index: 0,
			activate: true,
		});

		expect(toggled.commands[0]).toMatchObject({
			_tag: "PluginOperationRequested",
			operation: "disable",
			pluginId: "toggle@mkt",
			kind: "marketplace",
		});
	});

	it("shortens home-relative install paths to ~ before rendering", () => {
		const home = os.homedir();
		const installPath = `${home}/.omp/cache/plugins/sample@mkt`;
		const plugin = marketplace("sample@mkt", { entry: { installPath } });

		const component = new MarketplacePluginDetailComponent(plugin, {
			onEnabledChange: () => {},
			onBack: () => {},
		});

		const text = stripVTControlCharacters(component.render(120).join("\n"));
		// `shortenPath` keeps the rest of the path intact but replaces $HOME with `~`,
		// so the user's home directory never leaks into the rendered TUI surface.
		expect(text).toContain("~/.omp/cache/plugins/sample@mkt");
		expect(text).not.toContain(home);
	});
});
describe("PluginSettingsModalModel", () => {
	it("unwinds detail and nested config depth before closing", () => {
		let model = makePluginSettingsModalModel();
		model = updatePluginSettingsModal(model, { _tag: "SetRegion", region: "list", focusIndex: 2 }).model;
		model = updatePluginSettingsModal(model, {
			_tag: "Push",
			region: "detail",
			layer: { _tag: "PluginDetail", id: "demo", kind: "npm" },
		}).model;
		model = updatePluginSettingsModal(model, { _tag: "SetRegion", region: "detail", focusIndex: 3 }).model;
		model = updatePluginSettingsModal(model, {
			_tag: "Push",
			region: "config",
			layer: { _tag: "Config", pluginId: "demo", key: "token" },
		}).model;

		const detail = updatePluginSettingsModal(model, { _tag: "Back" }).model;
		expect([detail.region, detail.focusIndex, detail.depth.length]).toEqual(["detail", 3, 1]);
		const list = updatePluginSettingsModal(detail, { _tag: "Back" }).model;
		expect([list.region, list.focusIndex, list.depth.length]).toEqual(["list", 2, 0]);
		expect(updatePluginSettingsModal(list, { _tag: "Back" }).commands).toEqual([{ _tag: "CloseRequested" }]);
	});

	it("fences an async settings receipt to its route depth and request", () => {
		const model = updatePluginSettingsModal(
			updatePluginSettingsModal(makePluginSettingsModalModel(), {
				_tag: "Push",
				region: "detail",
				layer: { _tag: "PluginDetail", id: "demo", kind: "npm" },
			}).model,
			{ _tag: "RunPluginOperation", operation: "enable", pluginId: "demo", receiptId: "r1" },
		).model;
		const stamp = model.pendingAction;
		expect(stamp).toBeDefined();
		if (!stamp) throw new Error("pending action stamp missing");

		const changed = updatePluginSettingsModal(model, { _tag: "Back" }).model;
		const stale = updatePluginSettingsModal(changed, {
			_tag: "ActionSucceeded",
			receiptId: "r1",
			...stamp,
		}).model;
		expect(stale).toBe(changed);

		const settled = updatePluginSettingsModal(model, {
			_tag: "ActionSucceeded",
			receiptId: "r1",
			message: "enabled",
			...stamp,
		}).model;
		expect(settled.pendingAction).toBeUndefined();
		expect(settled.receipt).toMatchObject({ _tag: "Succeeded", receiptId: "r1", message: "enabled" });
	});
});
