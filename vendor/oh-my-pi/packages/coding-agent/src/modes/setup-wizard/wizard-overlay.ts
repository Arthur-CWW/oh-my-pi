import { Effect, Exit, Queue, Scope, Stream } from "effect";
import * as Schema from "effect/Schema";
import type { OAuthProvider } from "@oh-my-pi/pi-ai/oauth/types";
import {
	Ellipsis,
	type Component,
	type Keybinding,
	padding,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import { APP_NAME } from "@oh-my-pi/pi-utils";
import { setPreferredSearchProvider } from "../../web/search/provider";
import { getSearchProvider } from "../../web/search/provider";
import { keyHint } from "../components/keybinding-hints";
import { gradientLogo, PI_LOGO } from "../components/welcome";
import type { MvuEnvelope, MvuInputRoute } from "../mvu/input-lease";
import { mountMvuOverlay, type MvuRouteHandle } from "../mvu/route-host";
import { mountMvuRuntime, type MvuRuntime, type MvuRuntimeBoundary, type MvuRuntimeConfig } from "../mvu/runtime";
import {
	makeComponentId,
	type KeyEvent,
	type Mouse,
	type RouteStamp,
	type SourceEnvelope,
	type Transition,
} from "../mvu/schema";
import { setSymbolPreset, theme } from "../theme/theme";
import type { InteractiveModeContext } from "../types";
import {
	GlyphSceneController,
	makeGlyphSceneModel,
	type GlyphSceneCommand,
	type GlyphSceneMessage,
	type GlyphSceneModel,
	updateGlyphScene,
} from "./scenes/glyph";
import {
	makeProvidersSceneModel,
	ProvidersSceneController,
	type ProvidersSceneCommand,
	type ProvidersSceneMessage,
	type ProvidersSceneModel,
	updateProvidersScene,
} from "./scenes/providers";
import {
	commitThemeSceneValue,
	loadThemeSceneChoices,
	makeThemeSceneModel,
	previewThemeSceneValue,
	restoreThemeScene,
	ThemeSceneController,
	type ThemeSceneCommand,
	type ThemeSceneMessage,
	type ThemeSceneModel,
	updateThemeScene,
} from "./scenes/theme";
import { renderSetupOutro, SETUP_OUTRO_MS } from "./scenes/outro";
import { renderSetupSplash, SETUP_SPLASH_MS, SETUP_TICK_MS } from "./scenes/splash";
import type { SetupScene, SetupSceneController, SetupSceneHost, SetupSceneResult } from "./scenes/types";
import type { SignInCommand, SignInModel } from "./scenes/sign-in";
import type { WebSearchCommand } from "./scenes/web-search";

export type WizardPhase = "splash" | "transition" | "scene" | "outro" | "done";
const SETUP_WIZARD_COMPONENT_ID = makeComponentId("setup.wizard");
const SCENE_MARGIN_X = 4;
const MIN_CONTENT_WIDTH = 20;
const SCENE_TRANSITION_MS = 420;
const ROUTE_QUEUE_CAPACITY = 64;

export type SetupSceneState =
	| { readonly _tag: "Glyph"; readonly model: GlyphSceneModel }
	| { readonly _tag: "Theme"; readonly model: ThemeSceneModel }
	| { readonly _tag: "Providers"; readonly model: ProvidersSceneModel }
	| { readonly _tag: "Custom"; readonly generation: number };

export interface SetupWizardModel {
	readonly phase: WizardPhase;
	readonly phaseStartedAt: number;
	readonly clock: number;
	readonly sceneIndex: number;
	readonly sceneGeneration: number;
	readonly leaseGeneration: number;
	readonly scene: SetupSceneState | undefined;
	readonly exiting: boolean;
}

export type SetupWizardMessage =
	| MvuEnvelope
	| { readonly _tag: "SetupTick"; readonly now: number }
	| { readonly _tag: "SetupSceneMounted"; readonly generation: number; readonly scene: SetupSceneState }
	| { readonly _tag: "SetupSceneFinishRequested"; readonly generation: number; readonly result: SetupSceneResult }
	| { readonly _tag: "SetupExited"; readonly generation: number; readonly now: number; readonly error?: string }
	| Exclude<GlyphSceneMessage, MvuEnvelope>
	| Exclude<ThemeSceneMessage, MvuEnvelope>
	| Exclude<ProvidersSceneMessage, MvuEnvelope>;

type SceneCommand = GlyphSceneCommand | ThemeSceneCommand | ProvidersSceneCommand;

type SetupWizardCommand =
	| { readonly _tag: "Project"; readonly model: SetupWizardModel }
	| { readonly _tag: "MountScene"; readonly index: number; readonly generation: number; readonly stamp: RouteStamp }
	| { readonly _tag: "SwitchScene"; readonly index: number; readonly generation: number; readonly stamp: RouteStamp }
	| { readonly _tag: "UnmountScene" }
	| { readonly _tag: "ExitSetup"; readonly model: SetupWizardModel; readonly stamp: RouteStamp }
	| { readonly _tag: "Complete" }
	| { readonly _tag: "SceneEffect"; readonly effect: SceneCommand; readonly stamp: RouteStamp };

function centerLine(line: string, width: number): string {
	const lineWidth = visibleWidth(line);
	if (lineWidth >= width) return truncateToWidth(line, width, Ellipsis.Omit);
	return padding(Math.floor((width - lineWidth) / 2)) + line;
}

function clampLine(line: string, width: number): string {
	const truncated = truncateToWidth(line, width, Ellipsis.Omit);
	return truncated + padding(Math.max(0, width - visibleWidth(truncated)));
}

function indentLine(line: string, width: number, indent: number): string {
	return padding(Math.min(indent, Math.max(0, width - 1))) + truncateToWidth(line, Math.max(1, width - indent), Ellipsis.Omit);
}

function rowNoise(y: number): number {
	const n = Math.sin((y + 1) * 91.345) * 47453.5453;
	return n - Math.floor(n);
}

function dissolveFrames(from: string[], to: string[], progress: number, height: number): string[] {
	const lines: string[] = [];
	for (let y = 0; y < height; y += 1) {
		const threshold = Math.min(1, Math.max(0, progress * 1.45 - rowNoise(y) * 0.45));
		lines.push(threshold >= 0.5 ? (to[y] ?? "") : (from[y] ?? ""));
	}
	return lines;
}

export function makeSetupWizardModel(now: number): SetupWizardModel {
	return {
		phase: "splash",
		phaseStartedAt: now,
		clock: now,
		sceneIndex: 0,
		sceneGeneration: 0,
		leaseGeneration: 0,
		scene: undefined,
		exiting: false,
	};
}

function setupStamp(model: SetupWizardModel): RouteStamp {
	let sourceRevision = model.sceneGeneration;
	let requestGeneration = 0;
	if (model.scene?._tag === "Glyph") requestGeneration = model.scene.model.previewGeneration;
	else if (model.scene?._tag === "Theme") {
		sourceRevision = model.scene.model.sourceRevision;
		requestGeneration = model.scene.model.requestGeneration;
	} else if (model.scene?._tag === "Providers") {
		const child = model.scene.model.activeTab === 0 ? model.scene.model.signIn : model.scene.model.webSearch;
		sourceRevision = child.sourceRevision;
		requestGeneration = child.requestGeneration;
	}
	return { componentId: SETUP_WIZARD_COMPONENT_ID, leaseGeneration: model.leaseGeneration, sourceRevision, requestGeneration };
}

function normalizeInput(message: MvuEnvelope): MvuEnvelope {
	if (message.action !== "setup.input" || message.event._tag !== "Press") return message;
	let action: Keybinding | undefined;
	switch (String(message.event.key)) {
		case "enter":
		case "return": action = "tui.select.confirm"; break;
		case "up": action = "tui.select.up"; break;
		case "down": action = "tui.select.down"; break;
		case "pageUp": action = "tui.select.pageUp"; break;
		case "pageDown": action = "tui.select.pageDown"; break;
		case "left": action = "app.modal.focusPrevious"; break;
		case "right":
		case "tab": action = "app.modal.focusNext"; break;
		case "backspace": action = "app.selector.filterDelete"; break;
	}
	return action === undefined ? message : { ...message, action };
}

function project(model: SetupWizardModel, commands: readonly SetupWizardCommand[] = []): Transition<SetupWizardModel, SetupWizardCommand> {
	return { model, commands: [{ _tag: "Project", model }, ...commands], dirtyKeys: new Set(["setup.wizard"]) };
}

function beginScene(model: SetupWizardModel, sceneCount: number): Transition<SetupWizardModel, SetupWizardCommand> {
	if (sceneCount === 0) return project({ ...model, phase: "outro", phaseStartedAt: model.clock, scene: undefined });
	const next = { ...model, phase: "transition" as const, phaseStartedAt: model.clock, sceneGeneration: model.sceneGeneration + 1, scene: undefined };
	return project(next, [{ _tag: "MountScene", index: next.sceneIndex, generation: next.sceneGeneration, stamp: setupStamp(next) }]);
}

function advanceScene(model: SetupWizardModel, sceneCount: number): Transition<SetupWizardModel, SetupWizardCommand> {
	const sceneIndex = model.sceneIndex + 1;
	const generation = model.sceneGeneration + 1;
	if (sceneIndex >= sceneCount) {
		const next = { ...model, phase: "outro" as const, phaseStartedAt: model.clock, sceneIndex, sceneGeneration: generation, scene: undefined };
		return project(next, [{ _tag: "UnmountScene" }]);
	}
	const next = { ...model, phase: "transition" as const, phaseStartedAt: model.clock, sceneIndex, sceneGeneration: generation, scene: undefined };
	return project(next, [{ _tag: "SwitchScene", index: sceneIndex, generation, stamp: setupStamp(next) }]);
}

function wrapSceneTransition(
	model: SetupWizardModel,
	scene: SetupSceneState,
	transition: Transition<GlyphSceneModel | ThemeSceneModel | ProvidersSceneModel, SceneCommand>,
	sceneCount: number,
): Transition<SetupWizardModel, SetupWizardCommand> {
	if (scene._tag !== "Custom" && transition.model === scene.model && transition.commands.length === 0 && transition.dirtyKeys.size === 0) {
		return { model, commands: [], dirtyKeys: new Set() };
	}
	if (transition.commands.some(command => command._tag === "GlyphFinish" || command._tag === "ThemeFinish" || command._tag === "ProvidersFinish")) {
		return advanceScene({ ...model, scene: { ...scene, model: transition.model } as SetupSceneState }, sceneCount);
	}
	const next = { ...model, scene: { ...scene, model: transition.model } as SetupSceneState };
	return project(next, transition.commands.map(effect => ({ _tag: "SceneEffect", effect, stamp: setupStamp(next) })));
}

export function updateSetupWizard(
	model: SetupWizardModel,
	message: SetupWizardMessage,
	sceneCount: number,
): Transition<SetupWizardModel, SetupWizardCommand> {
	if (message._tag === "SetupTick") {
		const timed = { ...model, clock: message.now };
		if (model.phase === "splash" && message.now - model.phaseStartedAt >= SETUP_SPLASH_MS) return beginScene(timed, sceneCount);
		if (model.phase === "transition" && model.scene !== undefined && message.now - model.phaseStartedAt >= SCENE_TRANSITION_MS) return project({ ...timed, phase: "scene", phaseStartedAt: message.now });
		if (model.phase === "outro" && message.now - model.phaseStartedAt >= SETUP_OUTRO_MS) return project({ ...timed, phase: "done" }, [{ _tag: "Complete" }]);
		return project(timed);
	}
	if (message._tag === "SetupSceneMounted") {
		if (message.generation !== model.sceneGeneration || model.phase !== "transition") return { model, commands: [], dirtyKeys: new Set() };
		return project({ ...model, scene: message.scene });
	}
	if (message._tag === "SetupSceneFinishRequested") {
		if (message.generation !== model.sceneGeneration || model.phase === "done" || model.phase === "outro") return { model, commands: [], dirtyKeys: new Set() };
		return advanceScene(model, sceneCount);
	}
	if (message._tag === "SetupExited") {
		if (message.generation !== model.sceneGeneration || !model.exiting) return { model, commands: [], dirtyKeys: new Set() };
		return project({ ...model, phase: "outro", phaseStartedAt: message.now, clock: message.now, scene: undefined, exiting: false });
	}
	if (message._tag !== "MvuInput") {
		if (model.scene?._tag === "Glyph" && (message._tag === "GlyphPreviewSettled" || message._tag === "GlyphCommitSettled")) {
			return wrapSceneTransition(model, model.scene, updateGlyphScene(model.scene.model, message), sceneCount);
		}
		if (model.scene?._tag === "Theme" && (message._tag === "ThemePreviewSettled" || message._tag === "ThemeThemesLoaded" || message._tag === "ThemeCommitSettled" || message._tag === "ThemeRestoreSettled")) {
			return wrapSceneTransition(model, model.scene, updateThemeScene(model.scene.model, message), sceneCount);
		}
		if (model.scene?._tag === "Providers" && (message._tag === "OAuthPromptChanged" || message._tag === "OAuthSettled" || message._tag === "WebSearchReadinessSettled" || message._tag === "WebSearchApplySettled")) {
			return wrapSceneTransition(model, model.scene, updateProvidersScene(model.scene.model, message), sceneCount);
		}
		return { model, commands: [], dirtyKeys: new Set() };
	}
	const normalized = normalizeInput(message);
	const routed = normalized.stamp === undefined ? model : { ...model, leaseGeneration: normalized.stamp.leaseGeneration };
	if (normalized.action === "setup.cancel") {
		if (routed.scene?._tag === "Providers" && routed.scene.model.signIn.providerId !== undefined) {
			return wrapSceneTransition(routed, routed.scene, updateProvidersScene(routed.scene.model, normalized), sceneCount);
		}
		if (routed.phase === "done" || routed.phase === "outro" || routed.exiting) return { model: routed, commands: [], dirtyKeys: new Set() };
		const next = { ...routed, exiting: true };
		return project(next, [{ _tag: "ExitSetup", model: next, stamp: setupStamp(next) }]);
	}
	if (routed.phase === "splash") {
		if (normalized.action === "tui.select.confirm" || normalized.action === "ui.dismiss") return beginScene(routed, sceneCount);
		return { model: routed, commands: [], dirtyKeys: new Set() };
	}
	if (routed.phase === "outro") {
		if (normalized.action === "tui.select.confirm" || normalized.action === "ui.dismiss") return project({ ...routed, phase: "done" }, [{ _tag: "Complete" }]);
		return { model: routed, commands: [], dirtyKeys: new Set() };
	}
	if (routed.phase !== "scene" && routed.phase !== "transition") return { model: routed, commands: [], dirtyKeys: new Set() };
	if (routed.scene?._tag === "Glyph") return wrapSceneTransition(routed, routed.scene, updateGlyphScene(routed.scene.model, normalized), sceneCount);
	if (routed.scene?._tag === "Theme") return wrapSceneTransition(routed, routed.scene, updateThemeScene(routed.scene.model, normalized), sceneCount);
	if (routed.scene?._tag === "Providers") return wrapSceneTransition(routed, routed.scene, updateProvidersScene(routed.scene.model, normalized), sceneCount);
	return { model: routed, commands: [], dirtyKeys: new Set() };
}

const SetupWizardMessageSchema: Schema.ConstraintDecoder<SetupWizardMessage, never> = Schema.toType(
	Schema.declare<SetupWizardMessage>((input): input is SetupWizardMessage => {
		if (typeof input !== "object" || input === null || !("_tag" in input)) return false;
		switch ((input as { readonly _tag?: string })._tag) {
			case "MvuInput":
			case "SetupTick":
			case "SetupSceneMounted":
			case "SetupSceneFinishRequested":
			case "SetupExited":
			case "GlyphPreviewSettled":
			case "GlyphCommitSettled":
			case "ThemePreviewSettled":
			case "ThemeThemesLoaded":
			case "ThemeCommitSettled":
			case "ThemeRestoreSettled":
			case "WebSearchActivated":
			case "WebSearchReadinessSettled":
			case "WebSearchApplySettled":
			case "OAuthPromptChanged":
			case "OAuthSettled":
				return true;
			default:
				return false;
		}
	}),
);

export class SetupWizardComponent implements Component {
	#projection: SetupWizardModel;
	#activeScene: SetupSceneController | undefined;
	#activeHost: SetupSceneHost | undefined;
	#route: MvuRouteHandle | undefined;
	#runtime: MvuRuntime<SetupWizardModel, SetupWizardMessage> | undefined;
	#sourceQueue: Queue.Queue<SourceEnvelope<SetupWizardMessage>> | undefined;
	#timer: NodeJS.Timeout | undefined;
	#bodyRowStart = 0;
	#done = Promise.withResolvers<void>();
	#disposed = false;
	readonly #oauthRuns = new Map<string, { readonly abort: AbortController; promptResolver?: (value: string) => void }>();

	constructor(
		readonly ctx: InteractiveModeContext,
		readonly scenes: readonly SetupScene[],
	) {
		this.#projection = makeSetupWizardModel(performance.now());
	}

	async run(): Promise<void> {
		if (this.#route !== undefined) return this.#done.promise;
		const runtimeScope = Scope.makeUnsafe("sequential");
		this.#sourceQueue = await Effect.runPromise(Scope.provide(runtimeScope)(Queue.bounded<SourceEnvelope<SetupWizardMessage>>(ROUTE_QUEUE_CAPACITY)));
		const boundary: MvuRuntimeBoundary<SetupWizardModel, SetupWizardMessage, SetupWizardCommand> = {
			messageSchema: SetupWizardMessageSchema,
			currentStamp: setupStamp,
			commandStamp: command => {
				if (command._tag === "Project") return setupStamp(command.model);
				if (command._tag === "MountScene" || command._tag === "SwitchScene" || command._tag === "ExitSetup" || command._tag === "SceneEffect") return command.stamp;
				return undefined;
			},
		};
		const config: MvuRuntimeConfig<SetupWizardModel, SetupWizardMessage, SetupWizardCommand, never> = {
			componentId: SETUP_WIZARD_COMPONENT_ID,
			initialModel: this.#projection,
			update: (model, message) => updateSetupWizard(model, message, this.scenes.length),
			interpret: command => this.#interpret(command),
			sources: [Stream.fromQueue(this.#sourceQueue)],
			boundary,
			inputCapacity: ROUTE_QUEUE_CAPACITY,
			messageCapacity: ROUTE_QUEUE_CAPACITY,
			commandCapacity: ROUTE_QUEUE_CAPACITY,
		};
		this.#runtime = await Effect.runPromise(Scope.provide(runtimeScope)(mountMvuRuntime(config)));
		const route: MvuInputRoute<SetupWizardModel> = {
			componentId: SETUP_WIZARD_COMPONENT_ID,
			focusedRoot: this,
			context: model => {
				if (model.scene?._tag === "Theme") return { contexts: ["setup.theme", "selector.global"], mode: "Browse", focus: "list", capabilities: new Set(["selector.preview"]) };
				if (model.scene?._tag === "Providers") {
					const modal = model.scene.model.signIn.providerId !== undefined;
					return { contexts: modal ? ["setup.providers", "oauth.prompt"] : ["setup.providers", "providers.tabs"], mode: "Browse", focus: modal ? "input" : "list", capabilities: modal ? new Set(["oauth.prompt"]) : new Set(["selector.preview"]) };
				}
				return { contexts: ["setup.glyph", "selector.global"], mode: "Browse", focus: "list", capabilities: new Set(["selector.preview"]) };
			},
			actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
			pasteToMsg: event => ({ _tag: "MvuInput", action: "setup.input", event }),
			mouseToMsg: event => this.#mouseMessage(event),
		};
		try {
			this.#route = await Effect.runPromise(Scope.provide(this.ctx.mvuScope)(mountMvuOverlay({
				tui: this.ctx.ui,
				leaseManager: this.ctx.mvuInputLeaseManager,
				route,
				component: this,
				runtime: this.#runtime,
				runtimeScope,
				overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0, fullscreen: true },
			})));
		} catch (error) {
			await Effect.runPromise(Scope.close(runtimeScope, Exit.void));
			throw error;
		}
		this.#startTimer();
		this.ctx.ui.requestRender();
		return this.#done.promise;
	}

	async disposeAsync(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#stopTimer();
		const route = this.#route;
		this.#route = undefined;
		if (route !== undefined) await Effect.runPromise(route.close());
		this.#disposeActiveScene();
	}

	dispose(): void {
		this.#stopTimer();
		this.#disposeActiveScene();
	}

	invalidate(): void { this.#activeScene?.invalidate?.(); }

	render(width: number): readonly string[] {
		const model = this.#projection;
		const safeWidth = Math.max(1, width);
		const height = Math.max(1, this.ctx.ui.terminal.rows);
		let lines: string[];
		switch (model.phase) {
			case "splash": lines = renderSetupSplash(safeWidth, height, model.clock - model.phaseStartedAt); break;
			case "transition": {
				const elapsed = model.clock - model.phaseStartedAt;
				const splash = renderSetupSplash(safeWidth, height, SETUP_SPLASH_MS + elapsed);
				lines = dissolveFrames(splash, this.#renderScene(safeWidth, height), Math.min(1, elapsed / SCENE_TRANSITION_MS), height);
				break;
			}
			case "scene": lines = this.#renderScene(safeWidth, height); break;
			case "outro": lines = renderSetupOutro(safeWidth, height, model.clock - model.phaseStartedAt); break;
			case "done": lines = []; break;
		}
		const fitted = lines.slice(0, height).map(line => clampLine(line, safeWidth));
		while (fitted.length < height) fitted.push(padding(safeWidth));
		return fitted;
	}

	#renderScene(width: number, height: number): string[] {
		const scene = this.scenes[this.#projection.sceneIndex];
		const title = this.#activeScene?.title ?? scene?.title ?? "Setup";
		const subtitle = this.#activeScene?.subtitle;
		const contentWidth = Math.max(MIN_CONTENT_WIDTH, width - SCENE_MARGIN_X * 2);
		const logo = gradientLogo(PI_LOGO, 0);
		const header = [
			"",
			...logo.map(line => centerLine(line, width)),
			centerLine(theme.bold(theme.fg("accent", APP_NAME)), width),
			centerLine(theme.fg("muted", `Setup step ${this.#projection.sceneIndex + 1} of ${this.scenes.length}`), width),
			"",
			indentLine(theme.bold(title), width, SCENE_MARGIN_X),
		];
		if (subtitle !== undefined) header.push(indentLine(theme.fg("muted", subtitle), width, SCENE_MARGIN_X));
		header.push("");
		this.#bodyRowStart = header.length;
		const footer = [
			"",
			centerLine(`${theme.fg("dim", "↑/↓ select · enter confirm · ")}${keyHint("ui.dismiss", "skip")}${theme.fg("dim", " · ctrl+c exit setup")}`, width),
		];
		const body = this.#activeScene?.render(contentWidth).slice(0, Math.max(0, height - header.length - footer.length)) ?? [];
		const lines = [...header, ...body.map(line => indentLine(line, width, SCENE_MARGIN_X))];
		while (lines.length + footer.length < height) lines.push("");
		lines.push(...footer);
		return lines;
	}

	#mouseMessage(event: Mouse): MvuEnvelope | undefined {
		const mouse = event.event;
		if ((this.#projection.phase === "splash" || this.#projection.phase === "outro") && mouse.leftClick) {
			return { _tag: "MvuInput", action: "tui.select.confirm", event };
		}
		if (this.#projection.phase !== "scene" && this.#projection.phase !== "transition") return undefined;
		if (mouse.wheel !== null) return { _tag: "MvuInput", action: mouse.wheel === -1 ? "tui.select.up" : "tui.select.down", event };
		if (!mouse.leftClick) return { _tag: "MvuInput", action: "setup.mouse", event };
		const line = mouse.row - this.#bodyRowStart;
		const col = mouse.col - SCENE_MARGIN_X;
		let action: Keybinding | undefined;
		if (this.#activeScene instanceof GlyphSceneController) {
			const index = this.#activeScene.hitTest(line);
			if (index !== undefined) action = `setup.select.index:${index}` as Keybinding;
		} else if (this.#activeScene instanceof ThemeSceneController) {
			const index = this.#activeScene.hitTest(line);
			if (index !== undefined) action = `setup.select.index:${index}` as Keybinding;
		} else if (this.#activeScene instanceof ProvidersSceneController) action = this.#activeScene.mouseAction(line, col);
		return action === undefined ? undefined : { _tag: "MvuInput", action, event };
	}

	#startTimer(): void {
		if (this.#timer !== undefined) return;
		this.#timer = setInterval(() => {
			if (this.#disposed || this.#runtime === undefined) return;
			Effect.runFork(this.#runtime.dispatch({ _tag: "SetupTick", now: performance.now() }));
		}, SETUP_TICK_MS);
	}

	#stopTimer(): void {
		if (this.#timer === undefined) return;
		clearInterval(this.#timer);
		this.#timer = undefined;
	}

	#host(generation: number): SetupSceneHost {
		return {
			ctx: this.ctx,
			requestRender: () => this.ctx.ui.requestRender(),
			finish: result => {
				if (this.#runtime !== undefined) Effect.runFork(this.#runtime.dispatch({ _tag: "SetupSceneFinishRequested", generation, result }));
			},
			setFocus: () => {},
			restoreFocus: () => {},
		};
	}

	#mountScene(index: number, generation: number): Effect.Effect<SetupSceneState> {
		const self = this;
		return Effect.gen(function* () {
			const descriptor = self.scenes[index];
			if (descriptor === undefined) return { _tag: "Custom", generation } as const;
			const host = self.#host(generation);
			const controller = descriptor.mount(host);
			self.#activeHost = host;
			self.#activeScene = controller;
			yield* Effect.promise(() => Promise.resolve(controller.onMount?.()));
			if (controller instanceof GlyphSceneController) {
				const model = makeGlyphSceneModel(theme.getSymbolPreset(), generation);
				controller.apply(model);
				return { _tag: "Glyph", model } as const;
			}
			if (controller instanceof ThemeSceneController) {
				const model = makeThemeSceneModel(host, generation);
				controller.apply(model);
				return { _tag: "Theme", model } as const;
			}
			if (controller instanceof ProvidersSceneController) {
				const model = makeProvidersSceneModel(host, generation);
				controller.apply(model);
				return { _tag: "Providers", model } as const;
			}
			return { _tag: "Custom", generation } as const;
		});
	}

	#disposeActiveScene(): void {
		for (const run of this.#oauthRuns.values()) {
			run.abort.abort();
			run.promptResolver?.("");
		}
		this.#oauthRuns.clear();
		this.#activeScene?.onUnmount?.();
		this.#activeScene?.dispose?.();
		this.#activeScene = undefined;
		this.#activeHost = undefined;
	}

	#applyProjection(model: SetupWizardModel): void {
		this.#projection = model;
		if (model.scene?._tag === "Glyph" && this.#activeScene instanceof GlyphSceneController) this.#activeScene.apply(model.scene.model);
		else if (model.scene?._tag === "Theme" && this.#activeScene instanceof ThemeSceneController) this.#activeScene.apply(model.scene.model);
		else if (model.scene?._tag === "Providers" && this.#activeScene instanceof ProvidersSceneController) this.#activeScene.apply(model.scene.model);
		this.ctx.ui.requestRender();
	}

	#emit(stamp: RouteStamp, message: SetupWizardMessage): void {
		if (this.#sourceQueue === undefined) return;
		Effect.runFork(Queue.offer(this.#sourceQueue, { _tag: "MvuSource", stamp, message }));
	}

	#sceneResult<A extends SetupWizardMessage>(stamp: RouteStamp, message: A): readonly SourceEnvelope<SetupWizardMessage>[] {
		return [{ _tag: "MvuSource", stamp, message }];
	}

	#interpret(command: SetupWizardCommand): Effect.Effect<readonly (SetupWizardMessage | SourceEnvelope<SetupWizardMessage>)[]> {
		switch (command._tag) {
			case "Project": return Effect.sync(() => { this.#applyProjection(command.model); return []; });
			case "Complete": return Effect.sync(() => { this.#stopTimer(); this.#done.resolve(); return []; });
			case "UnmountScene": return Effect.sync(() => { this.#disposeActiveScene(); return []; });
			case "MountScene":
				return this.#mountScene(command.index, command.generation).pipe(Effect.map(scene => this.#sceneResult(command.stamp, { _tag: "SetupSceneMounted", generation: command.generation, scene })));
			case "SwitchScene":
				return Effect.sync(() => this.#disposeActiveScene()).pipe(Effect.andThen(this.#mountScene(command.index, command.generation)), Effect.map(scene => this.#sceneResult(command.stamp, { _tag: "SetupSceneMounted", generation: command.generation, scene })));
			case "ExitSetup":
				return Effect.tryPromise({
					try: async () => {
						if (command.model.scene?._tag === "Theme" && command.model.scene.model.previewDirty) await restoreThemeScene(command.model.scene.model);
						this.#disposeActiveScene();
					},
					catch: error => error instanceof Error ? error.message : String(error),
				}).pipe(Effect.match({
					onFailure: error => this.#sceneResult(command.stamp, { _tag: "SetupExited", generation: command.model.sceneGeneration, now: performance.now(), error }),
					onSuccess: () => this.#sceneResult(command.stamp, { _tag: "SetupExited", generation: command.model.sceneGeneration, now: performance.now() }),
				}));
			case "SceneEffect": return this.#interpretScene(command.effect, command.stamp);
		}
	}

	#interpretScene(effect: SceneCommand, stamp: RouteStamp): Effect.Effect<readonly (SetupWizardMessage | SourceEnvelope<SetupWizardMessage>)[]> {
		switch (effect._tag) {
			case "GlyphPreview":
				return Effect.tryPromise({ try: () => setSymbolPreset(effect.preset), catch: error => error instanceof Error ? error.message : String(error) }).pipe(Effect.match({
					onFailure: error => this.#sceneResult(stamp, { _tag: "GlyphPreviewSettled", generation: effect.generation, previewGeneration: effect.previewGeneration, preset: effect.preset, error }),
					onSuccess: () => { this.ctx.ui.invalidate(); return this.#sceneResult(stamp, { _tag: "GlyphPreviewSettled", generation: effect.generation, previewGeneration: effect.previewGeneration, preset: effect.preset }); },
				}));
			case "GlyphCommit":
				return Effect.tryPromise({ try: async () => { this.ctx.settings.set("symbolPreset", effect.preset); await setSymbolPreset(effect.preset); }, catch: error => error instanceof Error ? error.message : String(error) }).pipe(Effect.match({
					onFailure: error => this.#sceneResult(stamp, { _tag: "GlyphCommitSettled", generation: effect.generation, previewGeneration: effect.previewGeneration, preset: effect.preset, error }),
					onSuccess: () => { this.ctx.ui.invalidate(); return this.#sceneResult(stamp, { _tag: "GlyphCommitSettled", generation: effect.generation, previewGeneration: effect.previewGeneration, preset: effect.preset }); },
				}));
			case "GlyphFinish":
			case "ThemeFinish":
			case "ProvidersFinish": return Effect.succeed([]);
			case "ThemePreview": return Effect.tryPromise({ try: () => previewThemeSceneValue(effect.model, effect.value), catch: error => error instanceof Error ? error.message : String(error) }).pipe(Effect.match({ onFailure: error => this.#sceneResult(stamp, { _tag: "ThemePreviewSettled", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, value: effect.value, error }), onSuccess: () => { this.ctx.ui.invalidate(); return this.#sceneResult(stamp, { _tag: "ThemePreviewSettled", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, value: effect.value }); } }));
			case "ThemeLoadAll": return Effect.tryPromise({ try: loadThemeSceneChoices, catch: error => error instanceof Error ? error.message : String(error) }).pipe(Effect.match({ onFailure: error => this.#sceneResult(stamp, { _tag: "ThemeThemesLoaded", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, error }), onSuccess: themes => this.#sceneResult(stamp, { _tag: "ThemeThemesLoaded", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, themes }) }));
			case "ThemeCommit": return Effect.tryPromise({ try: () => commitThemeSceneValue(this.#activeHost!, effect.model, effect.value), catch: error => error instanceof Error ? error.message : String(error) }).pipe(Effect.match({ onFailure: error => this.#sceneResult(stamp, { _tag: "ThemeCommitSettled", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, error }), onSuccess: () => { this.ctx.ui.invalidate(); return this.#sceneResult(stamp, { _tag: "ThemeCommitSettled", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration }); } }));
			case "ThemeRestore": return Effect.tryPromise({ try: () => restoreThemeScene(effect.model), catch: error => error instanceof Error ? error.message : String(error) }).pipe(Effect.match({ onFailure: error => this.#sceneResult(stamp, { _tag: "ThemeRestoreSettled", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, finish: effect.finish, error }), onSuccess: () => { this.ctx.ui.invalidate(); return this.#sceneResult(stamp, { _tag: "ThemeRestoreSettled", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, finish: effect.finish }); } }));
			case "CheckWebSearchReadiness": return Effect.tryPromise({ try: async () => { const provider = await getSearchProvider(effect.providerId); return provider.isExplicitlyAvailable(this.ctx.session.modelRegistry.authStorage); }, catch: error => error instanceof Error ? error.message : String(error) }).pipe(Effect.match({
				onFailure: () => this.#sceneResult(stamp, { _tag: "WebSearchReadinessSettled", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, providerId: effect.providerId, ready: false }),
				onSuccess: ready => this.#sceneResult(stamp, { _tag: "WebSearchReadinessSettled", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, providerId: effect.providerId, ready }),
			}));
			case "ApplyWebSearch": return Effect.try({ try: () => { this.ctx.settings.set("providers.webSearch", effect.value); setPreferredSearchProvider(effect.value); }, catch: error => error instanceof Error ? error.message : String(error) }).pipe(Effect.match({ onFailure: error => this.#sceneResult(stamp, { _tag: "WebSearchApplySettled", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, value: effect.value, error }), onSuccess: () => this.#sceneResult(stamp, { _tag: "WebSearchApplySettled", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, value: effect.value }) }));
			case "CancelOAuth": return Effect.sync(() => { const key = this.#oauthKey(effect.model); const run = this.#oauthRuns.get(key); run?.abort.abort(); run?.promptResolver?.(""); this.#oauthRuns.delete(key); return []; });
			case "SubmitOAuthPrompt": return Effect.sync(() => { const run = this.#oauthRuns.get(this.#oauthKey(effect.model)); run?.promptResolver?.(effect.value); if (run !== undefined) run.promptResolver = undefined; return []; });
			case "StartOAuth": return this.#startOAuth(effect, stamp);
			case "SignInFinish":
			case "WebSearchFinish": return Effect.succeed([]);
		}
	}

	#oauthKey(model: SignInModel): string {
		return `${model.generation}:${model.sourceRevision}:${model.requestGeneration}`;
	}

	#startOAuth(effect: Extract<SignInCommand, { readonly _tag: "StartOAuth" }>, stamp: RouteStamp): Effect.Effect<readonly SourceEnvelope<SetupWizardMessage>[]> {
		const key = this.#oauthKey(effect.model);
		const abort = new AbortController();
		const run: { readonly abort: AbortController; promptResolver?: (value: string) => void } = { abort };
		this.#oauthRuns.set(key, run);
		return Effect.promise(async () => {
			let prompt = effect.model.prompt;
			const emitPrompt = (next: typeof prompt): void => {
				prompt = next;
				this.#emit(stamp, { _tag: "OAuthPromptChanged", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, prompt: next });
			};
			const ask = (message: string, placeholder?: string): Promise<string> => {
				const pending = Promise.withResolvers<string>();
				run.promptResolver = pending.resolve;
				emitPrompt({ ...prompt, stage: "prompt", message, placeholder, draft: "" });
				return pending.promise;
			};
			try {
				await this.ctx.session.modelRegistry.authStorage.login(effect.providerId as OAuthProvider, {
					signal: abort.signal,
					onAuth: info => emitPrompt({ ...prompt, stage: "auth", url: info.url, instructions: info.instructions, message: undefined, placeholder: undefined, draft: "" }),
					onPrompt: value => ask(value.message, value.placeholder),
					onProgress: message => emitPrompt({ ...prompt, stage: "progress", message, draft: "" }),
					onManualCodeInput: () => ask("Paste the authorization code (or full redirect URL):"),
				});
				await this.ctx.session.modelRegistry.refresh();
				this.#emit(stamp, { _tag: "OAuthSettled", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, providerId: effect.providerId, cancelled: false });
			} catch (error) {
				this.#emit(stamp, { _tag: "OAuthSettled", generation: effect.model.generation, sourceRevision: effect.model.sourceRevision, requestGeneration: effect.model.requestGeneration, providerId: effect.providerId, cancelled: abort.signal.aborted, ...(abort.signal.aborted ? {} : { error: error instanceof Error ? error.message : String(error) }) });
			} finally {
				this.#oauthRuns.delete(key);
			}
		}).pipe(Effect.forkDetach, Effect.as([]));
	}
}
