import { describe, expect, test } from "bun:test";
import { EXTENSION_DASHBOARD_ROUTE, ExtensionDashboard } from "@oh-my-pi/pi-coding-agent/modes/components/extensions/extension-dashboard";
import { ExtensionList } from "@oh-my-pi/pi-coding-agent/modes/components/extensions/extension-list";
import {
	reduceExtensionDashboard,
	replaceExtensionSource,
	type ExtensionDashboardModel,
} from "@oh-my-pi/pi-coding-agent/modes/components/extensions/state-manager";
import type { Extension } from "@oh-my-pi/pi-coding-agent/modes/components/extensions/types";
import type { Component } from "@oh-my-pi/pi-tui";

function extension(overrides: Partial<Extension> & Pick<Extension, "id">): Extension {
	return {
		kind: "skill",
		name: overrides.id.replace(/^skill:/, ""),
		displayName: overrides.id.replace(/^skill:/, ""),
		path: `/tmp/${overrides.id}`,
		source: { provider: "native", providerName: "Native", level: "native" },
		state: "active",
		raw: {},
		...overrides,
	};
}


function dashboardModel(extensions: Extension[]): ExtensionDashboardModel {
	return {
		sourceRevision: 3,
		requestGeneration: 0,
		loadState: "Idle",
		tabs: [
			{ id: "all", label: "ALL", enabled: true, count: extensions.length },
			{ id: "native", label: "NATIVE", enabled: true, count: extensions.length },
		],
		activeTabId: "all",
		extensions,
		disabledIds: [],
		query: "",
		selectedKey: extensions[1]?.id ?? extensions[0]?.id,
		viewportOffset: 0,
		viewportSize: 5,
		mode: "Browse",
	};
}

describe("Extension dashboard MVU adapter", () => {
	test("exports route grammar and keeps stable selection through reorder while fencing stale sources", () => {
		expect(String(EXTENSION_DASHBOARD_ROUTE.componentId)).toBe("extension-dashboard");
		expect(EXTENSION_DASHBOARD_ROUTE.context).toBe("selector.global");
		const alpha = extension({ id: "skill:alpha" });
		const beta = extension({ id: "skill:beta" });
		const model = dashboardModel([alpha, beta]);

		const stale = replaceExtensionSource(model, [beta], [], 2);
		expect(stale).toBe(model);

		const reordered = replaceExtensionSource(model, [beta, alpha], [], 4);
		expect(reordered.selectedKey).toBe("skill:beta");
		expect(reordered.extensions.map(item => item.id)).toEqual(["skill:beta", "skill:alpha"]);
	});

	test("enters reversible preview focus and projects provider toggle actions", () => {
		const alpha = extension({ id: "skill:alpha" });
		const browse = dashboardModel([alpha]);
		const preview = reduceExtensionDashboard(browse, { _tag: "Activate" });
		expect(preview.model.mode).toBe("PreviewFocus");
		expect(reduceExtensionDashboard(preview.model, { _tag: "Back" }).model.mode).toBe("Browse");

		const provider = { ...browse, activeTabId: "native", selectedKey: "provider:native:master" };
		expect(reduceExtensionDashboard(provider, { _tag: "ToggleSelected" }).commands).toEqual([
			{ _tag: "ToggleProvider", providerId: "native", requestGeneration: 1 },
		]);
		const item = { ...provider, selectedKey: alpha.id };
		expect(reduceExtensionDashboard(item, { _tag: "ToggleSelected" }).commands).toEqual([
			{ _tag: "ToggleExtension", extensionId: alpha.id, disabled: true, requestGeneration: 1 },
		]);
	});

	test("requests the mounted dashboard root once for ordinary navigation", async () => {
		const model = dashboardModel([
			extension({ id: "skill:alpha" }),
			extension({ id: "skill:beta" }),
		]);
		const dashboard = await ExtensionDashboard.fromModel(model);
		let requestedRoot: Component | undefined;
		dashboard.onRequestComponentRender = component => {
			requestedRoot = component;
		};
		const moved = reduceExtensionDashboard(model, { _tag: "Move", delta: 1 }).model;
		dashboard.apply(moved);
		expect(requestedRoot).toBe(dashboard);
		await dashboard.dispose();
	});

	test("extension list apply invalidates only its long-lived component", () => {
		let requestedRoot: Component | undefined;
		const list = new ExtensionList(component => {
			requestedRoot = component;
		});
		list.apply({
			query: "",
			rows: [],
			totalRows: 0,
			focused: true,
		});
		expect(requestedRoot).toBe(list);
	});

	test("stale refresh completions cannot replace the committed projection", async () => {
		const model = dashboardModel([extension({ id: "skill:alpha" })]);
		const pending = reduceExtensionDashboard(model, { _tag: "RefreshRequested" }).model;
		const newer = reduceExtensionDashboard(pending, { _tag: "RefreshRequested" }).model;
		const stale = reduceExtensionDashboard(newer, {
			_tag: "SourceLoaded",
			requestGeneration: pending.requestGeneration,
			extensions: [extension({ id: "skill:stale" })],
			disabledIds: [],
		});
		expect(stale.model).toBe(newer);
		const dashboard = await ExtensionDashboard.fromModel(newer);
		const before = dashboard.render(80);
		await dashboard.dispose();
		dashboard.apply({ ...newer, query: "ignored-after-dispose" });
		expect(dashboard.render(80)).toEqual(before);
	});
});
