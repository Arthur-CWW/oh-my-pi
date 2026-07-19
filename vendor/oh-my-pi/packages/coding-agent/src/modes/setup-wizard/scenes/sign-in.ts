import type { AuthStorage } from "@oh-my-pi/pi-ai";
import { PASTE_CODE_LOGIN_PROVIDERS } from "@oh-my-pi/pi-ai";
import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import { type Keybinding, type SelectItem, SelectList, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import { getAgentDbPath } from "@oh-my-pi/pi-utils";
import {
	EMPTY_OAUTH_PROMPT,
	LoginDialogComponent,
	type OAuthPromptModel,
} from "../../components/login-dialog";
import type { MvuEnvelope } from "../../mvu/input-lease";
import {
	makeOAuthProviderId,
	makeOAuthSelectorAdapter,
	type OAuthProviderId,
	type OAuthSelectorAdapter,
	type OAuthSelectorModel,
} from "../../mvu/oauth-selector-adapter";
import type { Transition } from "../../mvu/schema";
import { getSelectListTheme, theme } from "../../theme/theme";
import type { SetupSceneHost } from "./types";

export interface SignInModel {
	readonly selector: OAuthSelectorModel;
	readonly generation: number;
	readonly sourceRevision: number;
	readonly requestGeneration: number;
	readonly providerId: OAuthProviderId | undefined;
	readonly prompt: OAuthPromptModel;
	readonly status: readonly { readonly tone: "dim" | "warning" | "success" | "error"; readonly text: string }[];
}

export type SignInMessage =
	| MvuEnvelope
	| { readonly _tag: "OAuthPromptChanged"; readonly generation: number; readonly sourceRevision: number; readonly requestGeneration: number; readonly prompt: OAuthPromptModel }
	| { readonly _tag: "OAuthSettled"; readonly generation: number; readonly sourceRevision: number; readonly requestGeneration: number; readonly providerId: OAuthProviderId; readonly cancelled: boolean; readonly error?: string };

export type SignInCommand =
	| { readonly _tag: "StartOAuth"; readonly model: SignInModel; readonly providerId: OAuthProviderId; readonly manualInput: boolean }
	| { readonly _tag: "CancelOAuth"; readonly model: SignInModel }
	| { readonly _tag: "SubmitOAuthPrompt"; readonly model: SignInModel; readonly value: string }
	| { readonly _tag: "SignInFinish"; readonly result: "skipped" };

function providerItems(adapter: OAuthSelectorAdapter): readonly SelectItem[] {
	return [...adapter.items.values()].map(item => ({
		value: item.id,
		label: item.name,
		description: item.available ? undefined : "unavailable",
	}));
}

export function makeSignInAdapter(authStorage: AuthStorage, sourceRevision = 0): OAuthSelectorAdapter {
	return makeOAuthSelectorAdapter({
		mode: "login",
		providers: getOAuthProviders(),
		authStorage,
		sourceRevision,
	});
}

export function makeSignInModel(authStorage: AuthStorage, generation: number): SignInModel {
	const adapter = makeSignInAdapter(authStorage);
	return {
		selector: adapter.initialModel,
		generation,
		sourceRevision: 0,
		requestGeneration: 0,
		providerId: undefined,
		prompt: EMPTY_OAUTH_PROMPT,
		status: [],
	};
}

function signInInputText(message: MvuEnvelope): string | undefined {
	const event = message.event;
	if (event._tag === "Paste") return event.text;
	if (event._tag !== "Press") return undefined;
	return event.text ?? String(event.key);
}

function signInMove(model: SignInModel, adapter: OAuthSelectorAdapter, delta: -1 | 1): SignInModel {
	return { ...model, selector: adapter.update(model.selector, { _tag: "Move", delta }).model };
}

export function updateSignIn(model: SignInModel, message: SignInMessage, adapter: OAuthSelectorAdapter): Transition<SignInModel, SignInCommand> {
	if (message._tag === "OAuthPromptChanged") {
		if (message.generation !== model.generation || message.sourceRevision !== model.sourceRevision || message.requestGeneration !== model.requestGeneration || model.providerId === undefined) return { model, commands: [], dirtyKeys: new Set() };
		return { model: { ...model, prompt: message.prompt }, commands: [], dirtyKeys: new Set(["setup.providers.oauth.prompt"]) };
	}
	if (message._tag === "OAuthSettled") {
		if (message.generation !== model.generation || message.sourceRevision !== model.sourceRevision || message.requestGeneration !== model.requestGeneration || message.providerId !== model.providerId) return { model, commands: [], dirtyKeys: new Set() };
		const status = message.cancelled
			? [{ tone: "dim", text: "Login cancelled." }] as const
			: message.error !== undefined
				? [{ tone: "error", text: `Login failed: ${message.error}` }] as const
				: [
						{ tone: "success", text: `${theme.status.success} Signed in to ${message.providerId}` },
						{ tone: "dim", text: `Credentials saved to ${getAgentDbPath()}` },
					] as const;
		return {
			model: { ...model, providerId: undefined, prompt: EMPTY_OAUTH_PROMPT, status },
			commands: [],
			dirtyKeys: new Set(["setup.providers", "setup.providers.oauth"]),
		};
	}
	const text = signInInputText(message);
	if (model.providerId !== undefined) {
		if (message.action === "setup.cancel" || message.action === "ui.dismiss") {
			const next = {
				...model,
				requestGeneration: model.requestGeneration + 1,
				providerId: undefined,
				prompt: EMPTY_OAUTH_PROMPT,
				status: [{ tone: "dim", text: "Login cancelled." }] as const,
			};
			return { model: next, commands: [{ _tag: "CancelOAuth", model }], dirtyKeys: new Set(["setup.providers.oauth"]) };
		}
		if (model.prompt.stage !== "prompt") return { model, commands: [], dirtyKeys: new Set() };
		if (message.action === "app.selector.filterDelete") {
			return { model: { ...model, prompt: { ...model.prompt, draft: model.prompt.draft.slice(0, -1) } }, commands: [], dirtyKeys: new Set(["setup.providers.oauth.prompt"]) };
		}
		if (message.action === "tui.select.confirm") {
			return { model, commands: [{ _tag: "SubmitOAuthPrompt", model, value: model.prompt.draft }], dirtyKeys: new Set() };
		}
		if (text !== undefined && text.length > 0 && text !== "enter") {
			return { model: { ...model, prompt: { ...model.prompt, draft: model.prompt.draft + text } }, commands: [], dirtyKeys: new Set(["setup.providers.oauth.prompt"]) };
		}
		return { model, commands: [], dirtyKeys: new Set() };
	}
	if (message.action === "ui.dismiss") return { model, commands: [{ _tag: "SignInFinish", result: "skipped" }], dirtyKeys: new Set() };
	const indexed = /^setup\.select\.index:(\d+)$/.exec(String(message.action));
	if (indexed !== null) {
		const target = Math.max(0, Math.min(Number(indexed[1]), model.selector.filteredIds.length - 1));
		const current = model.selector.selectedId === undefined ? 0 : Math.max(0, model.selector.filteredIds.indexOf(model.selector.selectedId));
		let next = model;
		const direction = target < current ? -1 : 1;
		for (let remaining = Math.abs(target - current); remaining > 0; remaining -= 1) next = signInMove(next, adapter, direction);
		return { model: next, commands: [], dirtyKeys: new Set(["setup.providers.sign-in"]) };
	}
	if (message.action === "tui.select.up") return { model: signInMove(model, adapter, -1), commands: [], dirtyKeys: new Set(["setup.providers.sign-in"]) };
	if (message.action === "tui.select.down") return { model: signInMove(model, adapter, 1), commands: [], dirtyKeys: new Set(["setup.providers.sign-in"]) };
	if (message.action === "app.selector.filter") {
		return { model: { ...model, selector: adapter.update(model.selector, { _tag: "BeginFilter" }).model }, commands: [], dirtyKeys: new Set(["setup.providers.sign-in"]) };
	}
	if (message.action === "app.selector.filterDelete") {
		return { model: { ...model, selector: adapter.update(model.selector, { _tag: "FilterDelete" }).model }, commands: [], dirtyKeys: new Set(["setup.providers.sign-in"]) };
	}
	if ((message.action === "app.selector.filterAppend" || model.selector.mode._tag === "Filter") && text !== undefined && text.length > 0) {
		let selector = model.selector;
		if (selector.mode._tag !== "Filter") selector = adapter.update(selector, { _tag: "BeginFilter" }).model;
		selector = adapter.update(selector, { _tag: "FilterAppend", text }).model;
		return { model: { ...model, selector }, commands: [], dirtyKeys: new Set(["setup.providers.sign-in"]) };
	}
	if (text !== undefined && text >= "1" && text <= "9") {
		const target = Math.max(0, Math.min(Number(text) - 1, model.selector.filteredIds.length - 1));
		const current = model.selector.selectedId === undefined ? 0 : Math.max(0, model.selector.filteredIds.indexOf(model.selector.selectedId));
		let next = model;
		const direction = target < current ? -1 : 1;
		for (let remaining = Math.abs(target - current); remaining > 0; remaining -= 1) next = signInMove(next, adapter, direction);
		return { model: next, commands: [], dirtyKeys: new Set(["setup.providers.sign-in"]) };
	}
	if (message.action !== "tui.select.confirm") return { model, commands: [], dirtyKeys: new Set() };
	const providerId = model.selector.selectedId;
	if (providerId === undefined || !adapter.items.get(providerId)?.available) return { model, commands: [], dirtyKeys: new Set() };
	const requestGeneration = model.requestGeneration + 1;
	const next = {
		...model,
		requestGeneration,
		providerId,
		prompt: EMPTY_OAUTH_PROMPT,
		status: [{ tone: "dim", text: "Starting OAuth flow…" }] as const,
	};
	return {
		model: next,
		commands: [{ _tag: "StartOAuth", model: next, providerId, manualInput: PASTE_CODE_LOGIN_PROVIDERS.has(String(providerId)) }],
		dirtyKeys: new Set(["setup.providers", "setup.providers.oauth"]),
	};
}

/** Projection-only sign-in tab; OAuth activity is interpreted by the parent runtime. */
export class SignInTab {
	readonly id = "sign-in";
	readonly label = "Sign in";
	#projection: SignInModel;
	#adapter: OAuthSelectorAdapter;
	#selector: SelectList;
	readonly #promptRenderer = new LoginDialogComponent();
	#selectorRowStart = 2;

	constructor(readonly host: SetupSceneHost) {
		const authStorage = host.ctx.session.modelRegistry.authStorage;
		this.#adapter = makeSignInAdapter(authStorage);
		this.#projection = makeSignInModel(authStorage, 0);
		this.#selector = new SelectList(providerItems(this.#adapter), 10, getSelectListTheme());
		this.apply(this.#projection, this.#adapter);
	}

	get modal(): boolean { return this.#projection.providerId !== undefined; }
	get activeProvider(): string | undefined { return this.#projection.providerId; }

	apply(model: SignInModel, adapter = this.#adapter): void {
		this.#projection = model;
		this.#adapter = adapter;
		const expected = providerItems(adapter);
		if (expected.length !== model.selector.orderedIds.length) this.#selector = new SelectList(expected, 10, getSelectListTheme());
		const selected = model.selector.selectedId;
		this.#selector.setSelectedIndex(selected === undefined ? 0 : Math.max(0, model.selector.filteredIds.indexOf(selected)));
		this.#promptRenderer.apply(model.prompt);
	}

	invalidate(): void { this.#selector.invalidate(); }
	hitTest(line: number): number | undefined { return this.#selector.hitTest(line - this.#selectorRowStart); }
	render(width: number): readonly string[] {
		const lines: string[] = [];
		if (this.#projection.providerId !== undefined) {
			lines.push(theme.bold(`Signing in to ${this.#projection.providerId}`));
			lines.push(...this.#promptRenderer.render(width));
		} else {
			lines.push(theme.fg("muted", "Choose a provider to sign in."), "");
			this.#selectorRowStart = lines.length;
			lines.push(...this.#selector.render(width));
		}
		for (const status of this.#projection.status) {
			const rendered = theme.fg(status.tone, status.text);
			lines.push(...wrapTextWithAnsi(rendered, width));
		}
		return lines;
	}
}

export { makeOAuthProviderId };
