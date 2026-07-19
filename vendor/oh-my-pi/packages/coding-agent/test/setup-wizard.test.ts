import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { AuthStorage, SqliteAuthCredentialStore } from "@oh-my-pi/pi-ai";
import { Key, type Keybinding, type KeyId } from "@oh-my-pi/pi-tui";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	CURRENT_SETUP_VERSION,
	markSetupWizardComplete,
	selectSetupScenes,
	type SetupScene,
} from "@oh-my-pi/pi-coding-agent/modes/setup-wizard";
import { makeGlyphSceneModel } from "@oh-my-pi/pi-coding-agent/modes/setup-wizard/scenes/glyph";
import {
	makeSignInAdapter,
	makeSignInModel,
} from "@oh-my-pi/pi-coding-agent/modes/setup-wizard/scenes/sign-in";
import {
	type ProvidersSceneModel,
	updateProvidersScene,
} from "@oh-my-pi/pi-coding-agent/modes/setup-wizard/scenes/providers";
import { makeWebSearchModel } from "@oh-my-pi/pi-coding-agent/modes/setup-wizard/scenes/web-search";
import {
	makeSetupWizardModel,
	updateSetupWizard,
} from "@oh-my-pi/pi-coding-agent/modes/setup-wizard/wizard-overlay";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { MvuEnvelope } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-lease";

const input = <TAction extends Keybinding>(action: TAction, key: KeyId = Key.enter, text?: string): MvuEnvelope => ({
	_tag: "MvuInput",
	action,
	event: text === undefined ? { _tag: "Press", key, repeat: false } : { _tag: "Press", key, text, repeat: false },
});

function scene(id: string, minVersion: number): SetupScene {
	return { id, title: id, minVersion, mount: () => ({ title: id, render: () => [] }) };
}


afterEach(async () => {
	await initTheme(false, "unicode", false, "titanium", "light");
});

describe("setup wizard scene selection", () => {
	it("selects only scenes newer than the stored setup version", async () => {
		const scenes = [scene("old", 1), scene("new", 2), scene("latest", 3)];
		const selected = await selectSetupScenes(1, scenes, undefined, { force: false });
		expect(selected.map(value => value.id)).toEqual(["new", "latest"]);
	});

	it("persists the current setup version", async () => {
		const settings = Settings.isolated();
		await markSetupWizardComplete(settings);
		expect(settings.get("setupVersion")).toBe(CURRENT_SETUP_VERSION);
	});
});

describe("setup wizard parent reducer", () => {
	it("replays splash, nested glyph selection, and stale-fenced preview state", () => {
		const initial = makeSetupWizardModel(100);
		const entered = updateSetupWizard(initial, input("setup.input"), 1);
		expect(entered.model.phase).toBe("transition");
		expect(entered.commands.some(command => command._tag === "MountScene")).toBe(true);

		const glyph = makeGlyphSceneModel("unicode", entered.model.sceneGeneration);
		const mounted = updateSetupWizard(entered.model, {
			_tag: "SetupSceneMounted",
			generation: entered.model.sceneGeneration,
			scene: { _tag: "Glyph", model: glyph },
		}, 1);
		const visible = updateSetupWizard(mounted.model, { _tag: "SetupTick", now: 600 }, 1);
		expect(visible.model.phase).toBe("scene");

		const moved = updateSetupWizard(visible.model, input("tui.select.down", Key.down), 1);
		expect(moved.model.scene?._tag).toBe("Glyph");
		if (moved.model.scene?._tag !== "Glyph") throw new Error("Glyph scene missing");
		expect(moved.model.scene.model.selector.selectedId).toBe("ascii");
		expect(moved.model.scene.model.previewing).toBe("ascii");

		const stale = updateSetupWizard(moved.model, {
			_tag: "GlyphPreviewSettled",
			generation: moved.model.scene.model.generation - 1,
			previewGeneration: moved.model.scene.model.previewGeneration,
			preset: "ascii",
		}, 1);
		expect(stale.model).toBe(moved.model);
	});

	it("keeps Ctrl-C inside an active OAuth prompt, then exits under the same parent model", () => {
		const authStorage = new AuthStorage(new SqliteAuthCredentialStore(new Database(":memory:")));
		const signInAdapter = makeSignInAdapter(authStorage);
		const providers: ProvidersSceneModel = {
			activeTab: 0,
			generation: 4,
			signInAdapter,
			signIn: makeSignInModel(authStorage, 4),
			webSearch: makeWebSearchModel(Settings.isolated().get("providers.webSearch"), 4),
		};
		const providerId = providers.signIn.selector.selectedId;
		if (providerId === undefined) throw new Error("OAuth provider list is empty");
		const modal = {
			...providers,
			signIn: { ...providers.signIn, providerId, requestGeneration: 1 },
		};
		const cancelled = updateProvidersScene(modal, input("setup.cancel", "c"));
		expect(cancelled.model.signIn.providerId).toBeUndefined();
		expect(cancelled.commands.some(command => command._tag === "CancelOAuth")).toBe(true);
		const parent = {
			...makeSetupWizardModel(0),
			phase: "scene" as const,
			sceneIndex: 0,
			sceneGeneration: 4,
			scene: { _tag: "Providers" as const, model: cancelled.model },
		};
		const exiting = updateSetupWizard(parent, input("setup.cancel", "c"), 1);
		expect(exiting.model.exiting).toBe(true);
		expect(exiting.commands.some(command => command._tag === "ExitSetup")).toBe(true);
	});
});
