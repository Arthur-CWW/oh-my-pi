import { describe, expect, it } from "bun:test";
import type { KeyId } from "@oh-my-pi/pi-tui";
import type { CommandModeCommand } from "@oh-my-pi/pi-coding-agent/modes/command-registry";
import {
	createCommandDraftRestorer,
	makeCommandModalModel,
	updateCommandModal,
	updateCommandModalFromInput,
} from "@oh-my-pi/pi-coding-agent/modes/components/command-line";
import type { MvuEnvelope } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-lease";
import {
	makeHookModalModel,
	updateHookModal,
} from "@oh-my-pi/pi-coding-agent/modes/components/hook-selector";
import {
	makeModelModalModel,
	updateModelModal,
} from "@oh-my-pi/pi-coding-agent/modes/components/model-selector";
import {
	createPlanReviewSettlement,
	makePlanModalModel,
	updatePlanModal,
} from "@oh-my-pi/pi-coding-agent/modes/components/plan-review-overlay";
import {
	PLUGIN_SETTINGS_COMPONENT_ID,
	makePluginSettingsModalModel,
	updatePluginSettingsModal,
} from "@oh-my-pi/pi-coding-agent/modes/components/plugin-settings";
import {
	makeSettingsModalModel,
	updateSettingsModal,
} from "@oh-my-pi/pi-coding-agent/modes/components/settings-selector";
import { DialogFifo } from "@oh-my-pi/pi-coding-agent/modes/controllers/extension-ui-controller";

describe("production modal reducers", () => {
	it("restores the exact settings focus and backs one layer at a time", () => {
		let model = makeSettingsModalModel("dark");
		model = updateSettingsModal(model, { _tag: "SetRegion", region: "settings", focusIndex: 4 }).model;
		model = updateSettingsModal(model, {
			_tag: "Push",
			region: "submenu",
			layer: { _tag: "Setting", path: "statusLine.preset" },
		}).model;
		model = updateSettingsModal(model, { _tag: "FocusNext", count: 3 }).model;

		const back = updateSettingsModal(model, { _tag: "Back" });
		expect(back.model.region).toBe("settings");
		expect(back.model.focusIndex).toBe(4);
		expect(back.model.depth).toHaveLength(0);
		expect(back.commands).toEqual([]);

		const previewed = updateSettingsModal(back.model, { _tag: "PreviewTheme", theme: "light" }).model;
		expect(updateSettingsModal(previewed, { _tag: "Back" }).commands).toEqual([
			{ _tag: "ThemeRollbackRequested", theme: "dark" },
			{ _tag: "CloseRequested" },
		]);
	});

	it("keeps plugin detail and config as nested layers and interprets operations", () => {
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

		const operation = updatePluginSettingsModal(model, {
			_tag: "RunPluginOperation",
			operation: "save-config",
			pluginId: "demo",
			key: "token",
			value: "secret",
		});
		expect(operation.commands).toEqual([
			{
				_tag: "PluginOperationRequested",
				operation: "save-config",
				pluginId: "demo",
				kind: "npm",
				key: "token",
				value: "secret",
				receiptId: "plugin-settings:1",
				stamp: {
					region: "config",
					depth: [
						{
							layer: { _tag: "PluginDetail", id: "demo", kind: "npm" },
							returnRegion: "list",
							returnFocusIndex: 2,
						},
						{
							layer: { _tag: "Config", pluginId: "demo", key: "token" },
							returnRegion: "detail",
							returnFocusIndex: 3,
						},
					],
					componentId: PLUGIN_SETTINGS_COMPONENT_ID,
					leaseGeneration: 0,
					sourceRevision: 0,
					requestGeneration: 1,
				},
			},
		]);
		const detail = updatePluginSettingsModal(model, { _tag: "Back" }).model;
		expect([detail.region, detail.focusIndex, detail.depth.length]).toEqual(["detail", 3, 1]);
		const list = updatePluginSettingsModal(detail, { _tag: "Back" }).model;
		expect([list.region, list.focusIndex, list.depth.length]).toEqual(["list", 2, 0]);
	});

	it("models provider to role to thinking without losing the parent focus", () => {
		let model = makeModelModalModel();
		model = updateModelModal(model, { _tag: "SelectProvider", providerId: "anthropic" }).model;
		model = updateModelModal(model, { _tag: "SetRegion", region: "models", focusIndex: 5 }).model;
		model = updateModelModal(model, { _tag: "SelectModel", modelId: "claude" }).model;
		model = updateModelModal(model, { _tag: "SetRegion", region: "role", focusIndex: 2 }).model;
		model = updateModelModal(model, { _tag: "SelectRole", role: "slow", requiresThinking: true }).model;

		const role = updateModelModal(model, { _tag: "Back" }).model;
		expect([role.region, role.focusIndex, role.depth.length]).toEqual(["role", 2, 1]);
		const models = updateModelModal(role, { _tag: "Back" }).model;
		expect([models.region, models.focusIndex, models.depth.length]).toEqual(["models", 5, 0]);
	});

	it("commits plan annotation and settles its external contract once", () => {
		let model = makePlanModalModel();
		model = updatePlanModal(model, { _tag: "SetRegion", region: "body", focusIndex: 7 }).model;
		model = updatePlanModal(model, { _tag: "BeginAnnotation", sectionId: "scope" }).model;
		model = updatePlanModal(model, { _tag: "EditAnnotation", value: "  explain fallback  " }).model;
		const committed = updatePlanModal(model, { _tag: "CommitAnnotation" });
		expect(committed.model.annotations.scope).toEqual(["explain fallback"]);
		expect([committed.model.region, committed.model.focusIndex]).toEqual(["body", 7]);
		expect(committed.commands).toEqual([
			{ _tag: "FeedbackChanged", sectionId: "scope", annotations: ["explain fallback"] },
		]);

		const results: Array<string | undefined> = [];
		const settle = createPlanReviewSettlement<string>(result => results.push(result));
		expect(settle("approve")).toBe(true);
		expect(settle(undefined)).toBe(false);
		expect(results).toEqual(["approve"]);
	});

	it("backs Hook filter before close and never selects a disabled option", () => {
		let model = makeHookModalModel([
			{ id: "a", label: "Alpha", disabled: false },
			{ id: "b", label: "Beta", disabled: true },
			{ id: "c", label: "Gamma", disabled: false },
		]);
		model = updateHookModal(model, { _tag: "Move", delta: 1 }).model;
		expect(model.selectedId).toBe("c");
		model = updateHookModal(model, { _tag: "BeginFilter" }).model;
		model = updateHookModal(model, { _tag: "FilterChanged", query: "gam" }).model;
		const back = updateHookModal(model, { _tag: "Back" });
		expect([back.model.region, back.model.query, back.model.depth.length]).toEqual(["options", "", 0]);
		expect(back.commands).toEqual([]);
		expect(updateHookModal(back.model, { _tag: "Back" }).commands).toEqual([{ _tag: "CloseRequested" }]);
	});
});

describe("Hook dialog FIFO", () => {
	it("skips a queued abort, preserves FIFO, and ignores duplicate settlement", async () => {
		const fifo = new DialogFifo<string>();
		const mounted: string[] = [];
		const hidden: string[] = [];
		const controllers = [new AbortController(), new AbortController(), new AbortController()];
		const settlers: Array<(value: string | undefined) => void> = [];
		const present = (name: string, index: number) =>
			fifo.present(controllers[index]!.signal, settle => {
				mounted.push(name);
				settlers[index] = settle;
				return () => hidden.push(name);
			});

		const first = present("first", 0);
		const second = present("second", 1);
		const third = present("third", 2);
		controllers[1]!.abort();
		expect(await second).toBeUndefined();
		expect(mounted).toEqual(["first"]);
		settlers[0]!("one");
		settlers[0]!("duplicate");
		expect(await first).toBe("one");
		expect(mounted).toEqual(["first", "third"]);
		settlers[2]!("three");
		expect(await third).toBe("three");
		expect(hidden).toEqual(["first", "third"]);
	});
});

describe("colon command modal", () => {
	it("cycles completion, navigates history, shows failure, and restores draft bytes", () => {
		let model = makeCommandModalModel(["version", "jobs"]);
		model = updateCommandModal(model, {
			_tag: "ValueChanged",
			value: "v",
			completions: [
				{ value: "version", label: "version" },
				{ value: "view", label: "view" },
			],
		}).model;
		model = updateCommandModal(model, { _tag: "CycleCompletion", delta: 1 }).model;
		model = updateCommandModal(model, { _tag: "AcceptCompletion" }).model;
		expect(model.value).toBe("view");
		model = updateCommandModal(model, { _tag: "NavigateHistory", delta: -1 }).model;
		expect(model.value).toBe("jobs");
		const failed = updateCommandModal(model, { _tag: "CommandFinished", handled: false, error: "bad\ncommand" });
		expect(failed.model.region).toBe("output");
		expect(failed.model.output).toBe("Command failed: bad command");
		expect(updateCommandModal(failed.model, { _tag: "Back" }).commands).toEqual([{ _tag: "CloseRequested" }]);

		let draft = "α\n\u0000exact";
		const restore = createCommandDraftRestorer(() => draft, value => {
			draft = value;
		});
		draft = "mutated";
		restore();
		expect(draft).toBe("α\n\u0000exact");
	});

	it("routes editing, completion, submit, and history grammar through the command reducer", () => {
		const commands: readonly CommandModeCommand[] = ["first", "second"].map(name => ({
			name,
			description: name,
			run: () => {},
		}));
		const press = (action: MvuEnvelope["action"], key: KeyId, text?: string): MvuEnvelope => ({
			_tag: "MvuInput",
			action,
			event: {
				_tag: "Press",
				key,
				...(text === undefined ? {} : { text }),
				repeat: false,
			},
		});

		let model = makeCommandModalModel([], commands);
		model = updateCommandModalFromInput(model, press("app.command.completionNext", "tab"), commands).model;
		expect(model.value).toBe("second");
		model = updateCommandModalFromInput(model, press("app.command.backspace", "backspace"), commands).model;
		expect(model.value).toBe("secon");
		model = updateCommandModalFromInput(model, press("app.command.input", "d", "d"), commands).model;
		expect(model.value).toBe("second");
		const submitted = updateCommandModalFromInput(model, press("app.command.submit", "enter"), commands);
		expect(submitted.model.pending).toBe(true);
		expect(submitted.commands).toEqual([{ _tag: "DispatchCommandRequested", value: "second" }]);

		model = makeCommandModalModel(["older", "newer"], []);
		model = updateCommandModalFromInput(model, press("app.command.input", "d", "draft"), []).model;
		model = updateCommandModalFromInput(model, press("app.command.previous", "up"), []).model;
		expect(model.value).toBe("newer");
		model = updateCommandModalFromInput(model, press("app.command.previous", "ctrl+p"), []).model;
		expect(model.value).toBe("older");
		model = updateCommandModalFromInput(model, press("app.command.next", "down"), []).model;
		expect(model.value).toBe("newer");
		model = updateCommandModalFromInput(model, press("app.command.next", "ctrl+n"), []).model;
		expect(model.value).toBe("draft");
	});
});
