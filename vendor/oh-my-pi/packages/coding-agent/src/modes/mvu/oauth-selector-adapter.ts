import { Effect, Queue, Ref, Scope, Stream } from "effect";
import type { OAuthProviderInfo } from "@oh-my-pi/pi-ai/oauth/types";
import type { CredentialOrigin, AuthStorage } from "../../session/auth-storage";
import {
	makeSelectorModel,
	type SelectorActivation,
	type SelectorActionStamp,
	type SelectorAdapter,
	type SelectorCommand,
	type SelectorModel,
	type SelectorMsg,
	updateSelector,
} from "./selector";
import { makeComponentId, type ComponentId, type Transition } from "./schema";
import type { Keybinding } from "@oh-my-pi/pi-tui";

export type OAuthProviderId = string & { readonly __oauthProviderId: unique symbol };
export type OAuthAction = Keybinding;

export const makeOAuthProviderId = (id: string): OAuthProviderId => id as OAuthProviderId;

export type OAuthAuthState = "unchecked" | "checking" | "valid" | "invalid";

export interface OAuthProviderItem {
	readonly id: OAuthProviderId;
	readonly name: string;
	readonly available: boolean;
	readonly origin?: CredentialOrigin;
	readonly authState: OAuthAuthState;
	readonly searchText: string;
	readonly provider: OAuthProviderInfo;
}

export type OAuthSelectorMsg = SelectorMsg<OAuthProviderId, OAuthAction> | OAuthValidationMsg;

export interface OAuthValidationStarted {
	readonly _tag: "OAuthValidationStarted";
	readonly providerId: OAuthProviderId;
	readonly sourceRevision: number;
	readonly generation: number;
}

export interface OAuthValidationSettled {
	readonly _tag: "OAuthValidationSettled";
	readonly providerId: OAuthProviderId;
	readonly sourceRevision: number;
	readonly generation: number;
	readonly state: "valid" | "invalid";
}

export type OAuthValidationMsg = OAuthValidationStarted | OAuthValidationSettled;

export interface OAuthSelectorModel extends SelectorModel<OAuthProviderId, OAuthAction> {
	readonly validationGeneration: number;
	readonly validation: ReadonlyMap<OAuthProviderId, OAuthAuthState>;
}

export interface OAuthSelectorOptions {
	readonly mode: "login" | "logout";
	readonly providers: readonly OAuthProviderInfo[];
	readonly authStorage?: Pick<AuthStorage, "has" | "hasAuth" | "getCredentialOrigin">;
	readonly componentId?: ComponentId;
	readonly sourceRevision?: number;
}

export interface OAuthSelectorAdapter {
	readonly componentId: ComponentId;
	readonly mode: "login" | "logout";
	readonly items: ReadonlyMap<OAuthProviderId, OAuthProviderItem>;
	readonly selector: SelectorAdapter<OAuthProviderId, OAuthProviderItem, OAuthProviderItem, OAuthProviderItem, OAuthAction>;
	readonly initialModel: OAuthSelectorModel;
	readonly sourceRevision: number;
	readonly update: (
		model: OAuthSelectorModel,
		message: OAuthSelectorMsg,
	) => Transition<OAuthSelectorModel, SelectorCommand<OAuthAction, OAuthProviderId>>;
}

export interface OAuthProviderSelection extends SelectorActionStamp<OAuthProviderId, OAuthAction> {
	readonly _tag: "OAuthProviderSelected";
	readonly mode: "login" | "logout";
	readonly providerId: OAuthProviderId;
}

export interface OAuthSelectorClosed {
	readonly _tag: "OAuthSelectorClosed";
}

export type OAuthSelectorOutput = OAuthProviderSelection | OAuthSelectorClosed;

const CONFIRM_ACTION = "tui.select.confirm" as OAuthAction;

function providerHasAuth(
	mode: "login" | "logout",
	provider: OAuthProviderInfo,
	authStorage: OAuthSelectorOptions["authStorage"],
): boolean {
	if (!authStorage) return false;
	return mode === "logout" ? authStorage.has(provider.id) : authStorage.hasAuth(provider.id);
}

function providerSearchText(
	provider: OAuthProviderInfo,
	origin: CredentialOrigin | undefined,
): string {
	const originText = origin === undefined ? "" : ` ${origin.kind} ${origin.envVar ?? ""}`;
	return `${provider.name} ${provider.id}${provider.available ? "" : " unavailable"}${originText}`;
}

function toItem(
	mode: "login" | "logout",
	provider: OAuthProviderInfo,
	authStorage: OAuthSelectorOptions["authStorage"],
): OAuthProviderItem {
	const origin = authStorage?.getCredentialOrigin(provider.id);
	return {
		id: makeOAuthProviderId(provider.id),
		name: provider.name,
		available: provider.available,
		origin,
		authState: providerHasAuth(mode, provider, authStorage) ? "unchecked" : "unchecked",
		searchText: providerSearchText(provider, origin),
		provider,
	};
}

export function makeOAuthSelectorAdapter(options: OAuthSelectorOptions): OAuthSelectorAdapter {
	const sourceRevision = options.sourceRevision ?? 0;
	const providers = options.mode === "logout"
		? options.providers.filter(provider => providerHasAuth(options.mode, provider, options.authStorage))
		: options.providers;
	const items = new Map(providers.map(provider => {
		const item = toItem(options.mode, provider, options.authStorage);
		return [item.id, item] as const;
	}));
	const ids = providers.map(provider => makeOAuthProviderId(provider.id));
	const searchTextById = new Map(ids.map(id => [id, items.get(id)?.searchText ?? id] as const));
	const componentId = options.componentId ?? makeComponentId(`oauth-selector:${options.mode}`);
	const selector: SelectorAdapter<OAuthProviderId, OAuthProviderItem, OAuthProviderItem, OAuthProviderItem, OAuthAction> = {
		componentId,
		capabilities: new Set(["selector.filter", "selector.validation"]),
		keyOf: item => item.id,
		searchText: item => item.searchText,
		row: (item, context) => ({ ...item, authState: context.selected ? item.authState : item.authState }),
		preview: item => item,
		activate: (id, model): SelectorActivation<OAuthAction, OAuthProviderId> => {
			const item = items.get(id);
			if (!item || !item.available || model.selectedId !== id) return { _tag: "Noop" };
			return { _tag: "Command", action: CONFIRM_ACTION, id };
		},
	};
	const initialModel: OAuthSelectorModel = {
		...makeSelectorModel<OAuthProviderId, OAuthAction>(ids, sourceRevision, searchTextById),
		validationGeneration: 0,
		validation: new Map(ids.map(id => [id, "unchecked"] as const)),
	};
	const update = (
		model: OAuthSelectorModel,
		message: OAuthSelectorMsg,
	): Transition<OAuthSelectorModel, SelectorCommand<OAuthAction, OAuthProviderId>> => {
		if (message._tag === "SourceReplaced") {
			const transition = updateSelector(model, message);
			const validation = new Map(message.orderedIds.map(id => [id, "unchecked"] as const));
			return {
				model: { ...transition.model, validationGeneration: 0, validation },
				commands: transition.commands,
				dirtyKeys: new Set([...transition.dirtyKeys, "oauth:source", "oauth:validation"]),
			};
		}
		if (message._tag === "OAuthValidationStarted") {
			if (message.sourceRevision !== model.sourceRevision || message.generation < model.validationGeneration) {
				return { model, commands: [], dirtyKeys: new Set() };
			}
			const validation = new Map(model.validation);
			validation.set(message.providerId, "checking");
			return {
				model: { ...model, validationGeneration: message.generation, validation },
				commands: [],
				dirtyKeys: new Set([`oauth:${message.providerId}:status`]),
			};
		}
		if (message._tag === "OAuthValidationSettled") {
			if (message.sourceRevision !== model.sourceRevision || message.generation !== model.validationGeneration) {
				return { model, commands: [], dirtyKeys: new Set() };
			}
			const validation = new Map(model.validation);
			validation.set(message.providerId, message.state);
			return {
				model: { ...model, validation },
				commands: [],
				dirtyKeys: new Set([`oauth:${message.providerId}:status`]),
			};
		}
		const transition = updateSelector(model, message);
		return {
			model: { ...model, ...transition.model },
			commands: transition.commands,
			dirtyKeys: transition.dirtyKeys,
		};
	};
	return { componentId, mode: options.mode, items, selector, initialModel, sourceRevision, update };
}

export function oauthSelectorOutput(
	command: SelectorCommand<OAuthAction, OAuthProviderId>,
	adapter: OAuthSelectorAdapter,
): OAuthSelectorOutput | undefined {
	if (command._tag === "CloseRequested") return { _tag: "OAuthSelectorClosed" };
	if (command._tag !== "Activate" || command.action !== CONFIRM_ACTION) return undefined;
	if (!adapter.items.has(command.id)) return undefined;
	return {
		_tag: "OAuthProviderSelected",
		mode: adapter.mode,
		providerId: command.id,
		id: command.id,
		action: command.action,
		sourceRevision: command.sourceRevision,
		requestGeneration: command.requestGeneration,
		nonce: command.nonce,
	};
}

export interface OAuthValidationSource<R = never> {
	readonly stream: Stream.Stream<OAuthValidationMsg, never>;
	readonly refresh: (
		sourceRevision: number,
		providers: readonly OAuthProviderId[],
	) => Effect.Effect<void, never, R | Scope.Scope>;
	readonly stop: Effect.Effect<void, never>;
}

export interface OAuthValidationSourceOptions<R, E = never> {
	readonly validate: (providerId: OAuthProviderId) => Effect.Effect<boolean, E, R>;
}

/**
 * Starts one scoped validation worker per provider refresh. Results are offered
 * only while their generation is current; no timer or detached promise can
 * update a route after replacement/unmount.
 */
export function makeOAuthValidationSource<R, E = never>(
	options: OAuthValidationSourceOptions<R, E>,
): Effect.Effect<OAuthValidationSource<R>, never, R | Scope.Scope> {
	return Effect.gen(function* () {
		const queue = yield* Queue.bounded<OAuthValidationMsg>(64);
		const generation = yield* Ref.make(0);
		const stream = Stream.fromQueue(queue);
		const refresh = (sourceRevision: number, providers: readonly OAuthProviderId[]) =>
			Effect.gen(function* () {
				const current = (yield* Ref.get(generation)) + 1;
				yield* Ref.set(generation, current);
				for (const providerId of providers) {
					yield* Queue.offer(queue, {
						_tag: "OAuthValidationStarted",
						providerId,
						sourceRevision,
						generation: current,
					});
					yield* Effect.forkScoped(
						Effect.gen(function* () {
							const valid = yield* options.validate(providerId).pipe(Effect.catch(() => Effect.succeed(false)));
							if ((yield* Ref.get(generation)) !== current) return;
							yield* Queue.offer(queue, {
								_tag: "OAuthValidationSettled",
								providerId,
								sourceRevision,
								generation: current,
								state: valid ? "valid" : "invalid",
							});
						}),
					);
				}
			});
		const stop = Ref.update(generation, value => value + 1).pipe(Effect.asVoid);
		return { stream, refresh, stop } satisfies OAuthValidationSource<R>;
	});
}