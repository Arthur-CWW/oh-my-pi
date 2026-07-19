import type { AuthStorage } from "@oh-my-pi/pi-ai";
import { type Keybinding, TabBar } from "@oh-my-pi/pi-tui";
import { editorKey } from "../../components/keybinding-hints";
import type { MvuEnvelope } from "../../mvu/input-lease";
import type { Transition } from "../../mvu/schema";
import { getTabBarTheme } from "../../shared";
import type { OAuthSelectorAdapter } from "../../mvu/oauth-selector-adapter";
import {
	makeSignInAdapter,
	makeSignInModel,
	SignInTab,
	type SignInCommand,
	type SignInMessage,
	type SignInModel,
	updateSignIn,
} from "./sign-in";
import type { SetupScene, SetupSceneController, SetupSceneHost } from "./types";
import {
	makeWebSearchModel,
	updateWebSearch,
	WebSearchTab,
	type WebSearchCommand,
	type WebSearchMessage,
	type WebSearchModel,
} from "./web-search";

export interface ProvidersSceneModel {
	readonly activeTab: 0 | 1;
	readonly generation: number;
	readonly signInAdapter: OAuthSelectorAdapter;
	readonly signIn: SignInModel;
	readonly webSearch: WebSearchModel;
}

export type ProvidersSceneMessage = MvuEnvelope | Exclude<SignInMessage, MvuEnvelope> | Exclude<WebSearchMessage, MvuEnvelope>;
export type ProvidersSceneCommand = SignInCommand | WebSearchCommand | { readonly _tag: "ProvidersFinish"; readonly result: "skipped" };

export function makeProvidersSceneModel(host: SetupSceneHost, generation: number): ProvidersSceneModel {
	const authStorage = host.ctx.session.modelRegistry.authStorage as AuthStorage;
	return {
		activeTab: 0,
		generation,
		signInAdapter: makeSignInAdapter(authStorage),
		signIn: makeSignInModel(authStorage, generation),
		webSearch: makeWebSearchModel(host.ctx.settings.get("providers.webSearch"), generation),
	};
}

function convertFinish(commands: readonly (SignInCommand | WebSearchCommand)[]): readonly ProvidersSceneCommand[] {
	return commands.map(command => command._tag === "SignInFinish" || command._tag === "WebSearchFinish"
		? { _tag: "ProvidersFinish", result: "skipped" } as const
		: command);
}

export function updateProvidersScene(
	model: ProvidersSceneModel,
	message: ProvidersSceneMessage,
): Transition<ProvidersSceneModel, ProvidersSceneCommand> {
	if (message._tag !== "MvuInput") {
		if (message._tag === "OAuthPromptChanged" || message._tag === "OAuthSettled") {
			const transition = updateSignIn(model.signIn, message, model.signInAdapter);
			return { model: { ...model, signIn: transition.model }, commands: convertFinish(transition.commands), dirtyKeys: transition.dirtyKeys };
		}
		const transition = updateWebSearch(model.webSearch, message);
		return { model: { ...model, webSearch: transition.model }, commands: convertFinish(transition.commands), dirtyKeys: transition.dirtyKeys };
	}
	if (model.signIn.providerId !== undefined) {
		const transition = updateSignIn(model.signIn, message, model.signInAdapter);
		return { model: { ...model, signIn: transition.model }, commands: convertFinish(transition.commands), dirtyKeys: transition.dirtyKeys };
	}
	const tabMatch = /^setup\.tab\.index:(\d+)$/.exec(String(message.action));
	let nextTab: 0 | 1 | undefined;
	if (tabMatch !== null) nextTab = Number(tabMatch[1]) === 1 ? 1 : 0;
	else if (message.action === "app.modal.focusNext") nextTab = model.activeTab === 0 ? 1 : 0;
	else if (message.action === "app.modal.focusPrevious") nextTab = model.activeTab === 0 ? 1 : 0;
	if (nextTab !== undefined && nextTab !== model.activeTab) {
		if (nextTab === 0) return { model: { ...model, activeTab: 0 }, commands: [], dirtyKeys: new Set(["setup.providers.tabs"]) };
		const activated = updateWebSearch(model.webSearch, { _tag: "WebSearchActivated" });
		return {
			model: { ...model, activeTab: 1, webSearch: activated.model },
			commands: convertFinish(activated.commands),
			dirtyKeys: new Set(["setup.providers.tabs", ...activated.dirtyKeys]),
		};
	}
	if (message.action === "ui.dismiss") return { model, commands: [{ _tag: "ProvidersFinish", result: "skipped" }], dirtyKeys: new Set() };
	if (model.activeTab === 0) {
		const transition = updateSignIn(model.signIn, message, model.signInAdapter);
		return { model: { ...model, signIn: transition.model }, commands: convertFinish(transition.commands), dirtyKeys: transition.dirtyKeys };
	}
	const transition = updateWebSearch(model.webSearch, message);
	return { model: { ...model, webSearch: transition.model }, commands: convertFinish(transition.commands), dirtyKeys: transition.dirtyKeys };
}

/** Projection-only scene. Its parent SetupWizard runtime owns both tab models. */
export class ProvidersSceneController implements SetupSceneController {
	readonly title = "Set up your providers";
	readonly subtitle = `Sign in and pick a web search provider. Press ${editorKey("ui.dismiss")} when you're done.`;
	#projection: ProvidersSceneModel;
	readonly #signIn: SignInTab;
	readonly #webSearch: WebSearchTab;
	#tabRows = 1;

	constructor(readonly host: SetupSceneHost) {
		this.#projection = makeProvidersSceneModel(host, 0);
		this.#signIn = new SignInTab(host);
		this.#webSearch = new WebSearchTab(host);
		this.apply(this.#projection);
	}

	apply(model: ProvidersSceneModel): void {
		this.#projection = model;
		this.#signIn.apply(model.signIn, makeSignInAdapter(this.host.ctx.session.modelRegistry.authStorage, model.signIn.sourceRevision));
		this.#webSearch.apply(model.webSearch);
	}

	get modal(): boolean { return this.#projection.signIn.providerId !== undefined; }
	invalidate(): void { this.#signIn.invalidate(); this.#webSearch.invalidate(); }
	dispose(): void {}

	mouseAction(line: number, col: number): Keybinding | undefined {
		if (line >= 0 && line < this.#tabRows) {
			if (this.modal) return undefined;
			const hit = this.#tabBarProjection().tabAt(line, col);
			if (hit === undefined) return undefined;
			return `setup.tab.index:${hit.id === "web-search" ? 1 : 0}` as Keybinding;
		}
		const bodyLine = line - this.#tabRows - 1;
		const index = this.#projection.activeTab === 0 ? this.#signIn.hitTest(bodyLine) : this.#webSearch.hitTest(bodyLine);
		return index === undefined ? undefined : `setup.select.index:${index}` as Keybinding;
	}

	render(width: number): readonly string[] {
		const tabLines = this.#tabBarProjection().render(width);
		this.#tabRows = tabLines.length;
		const tab = this.#projection.activeTab === 0 ? this.#signIn : this.#webSearch;
		return [...tabLines, "", ...tab.render(width)];
	}

	#tabBarProjection(): TabBar {
		const projection = new TabBar(
			"Providers",
			[{ id: "sign-in", label: "Sign in" }, { id: "web-search", label: "Web search" }],
			getTabBarTheme(),
		);
		projection.selectTab(this.#projection.activeTab === 0 ? "sign-in" : "web-search");
		return projection;
	}
}

export const providersSetupScene: SetupScene = {
	id: "providers",
	title: "Set up your providers",
	minVersion: 1,
	mount: host => new ProvidersSceneController(host),
};
