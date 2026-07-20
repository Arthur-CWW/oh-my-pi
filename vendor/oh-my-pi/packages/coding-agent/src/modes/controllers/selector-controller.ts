import { AgentRegistry } from "../../registry/agent-registry";
import type { AgentHubTurnStatus } from "../components/agent-hub-selected-state";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { PASTE_CODE_LOGIN_PROVIDERS } from "@oh-my-pi/pi-ai";
import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import type { OAuthProvider } from "@oh-my-pi/pi-ai/oauth/types";
import type { Component, Keybinding, OverlayOptions } from "@oh-my-pi/pi-tui";
import { Container, extractPrintableText, Input, Loader, Spacer, Text } from "@oh-my-pi/pi-tui";
import { getAgentDbPath, getProjectDir, normalizePathForComparison } from "@oh-my-pi/pi-utils";
import * as Schema from "effect/Schema";
import { Effect, Scope } from "effect";
import { formatModelSelectorValue } from "../../config/model-resolver";
import { KEYBINDINGS } from "../../config/keybindings";
import { getRoleInfo } from "../../config/model-roles";
import { settings } from "../../config/settings";
import { disableProvider, enableProvider } from "../../discovery";
import { clearPluginRootsAndCaches, resolveActiveProjectRegistryPath } from "../../discovery/helpers";
import {
	getInstalledPluginsRegistryPath,
	getMarketplacesCacheDir,
	getMarketplacesRegistryPath,
	getPluginsCacheDir,
	MarketplaceManager,
} from "../../extensibility/plugins/marketplace";
import type { ExtensionUIDialogOptions, ExtensionUISelectItem } from "../../extensibility/extensions";
import {
	getAvailableThemes,
	getSymbolTheme,
	setColorBlindMode,
	setSymbolPreset,
	setTheme,
	theme,
} from "../../modes/theme/theme";
import type { InteractiveModeContext, InteractiveSelectorDialogOptions } from "../../modes/types";
import type { ResetCreditRedeemOutcome } from "../../session/auth-storage";
import type { SessionInfo } from "../../session/session-listing";
import { SessionManager } from "../../session/session-manager";
import { FileSessionStorage } from "../../session/session-storage";
import { type LogoutAccount, toLogoutAccounts } from "../../slash-commands/helpers/logout";
import {
	describeRedeemOutcome,
	type ResetUsageAccount,
	toResetUsageAccounts,
} from "../../slash-commands/helpers/reset-usage";
import { AUTO_THINKING, type ConfiguredThinkingLevel } from "../../thinking";
import {
	isImageProviderPreference,
	isSearchProviderId,
	isSearchProviderPreference,
	setExcludedSearchProviders,
	setPreferredImageProvider,
	setPreferredSearchProvider,
} from "../../tools";
import { shortenPath } from "../../tools/render-utils";
import { copyToClipboard } from "../../utils/clipboard";
import { getEditorCommand, openInEditor } from "../../utils/external-editor";
import { setSessionTerminalTitle } from "../../utils/title-generator";
import {
	AGENT_DASHBOARD_ROUTE,
	AgentDashboard,
	reduceAgentDashboard,
	type AgentDashboardCommand,
	type AgentDashboardMessage,
	type AgentDashboardModel,
} from "../components/agent-dashboard";
import { createAgentHubRolloutDataSource } from "../components/agent-hub-rollout-state";
import { AgentHubOverlayComponent, createAgentHubMvuMountSpec } from "../components/agent-hub";
import type { InputLeaseHandle, InputLeaseManager, MvuEnvelope, MvuInputRoute } from "../mvu/input-lease";
import {
	KeyEventSchema,
	RouteStampSchema,
	type ComponentId,
	type KeyEvent,
	type RouteStamp,
	type SourceEnvelope,
	type Transition,
} from "../mvu/schema";
import type { MvuRuntime, MvuRuntimeBoundary } from "../mvu/runtime";
import { mountMvuEditorReplacement, mountMvuOverlay, type MvuRouteHandle } from "../mvu/route-host";
import { BookmarksSelectorComponent } from "../components/bookmarks-selector";
import { AssistantMessageComponent } from "../components/assistant-message";
import {
	createCopySelectorRoute,
	type CopySelectorCommand,
	type CopySelectorModel,
	updateCopySelector,
	viewCopySelector,
} from "../components/copy-selector";
import {
	EXTENSION_DASHBOARD_ROUTE,
	ExtensionDashboard,
	loadAllExtensions,
	toggleProvider,
	type ExtensionDashboardCommand,
	type ExtensionDashboardMessage,
	type ExtensionDashboardModel,
	reduceExtensionDashboard,
} from "../components/extensions";
import { keyHint } from "../components/keybinding-hints";
import { HistorySearchComponent } from "../components/history-search";
import {
	LogoutAccountSelectorComponent,
	logoutAccountSelectorOutput,
	makeLogoutAccountSelectorAdapter,
	type LogoutAccountAction,
	type LogoutAccountId,
	type LogoutAccountSelectorAdapter,
} from "../components/logout-account-selector";
import { ModelSelectorComponent } from "../components/model-selector";
import {
	makeOAuthSelectorAdapter,
	OAuthSelectorComponent,
	oauthSelectorOutput,
	type OAuthAction,
	type OAuthProviderId,
	type OAuthSelectorAdapter,
	type OAuthSelectorModel,
	type OAuthSelectorMsg,
} from "../components/oauth-selector";
import { PluginSelectorComponent } from "../components/plugin-selector";
import {
	makeResetUsageSelectorAdapter,
	makeResetSpendDeduplication,
	makeSpendResetInterpreter,
	ResetUsageSelectorComponent,
	resetUsageSelectorOutput,
	resetSpendOutputToSelectorMsg,
	type ResetUsageAction,
	type ResetSpendCommand,
	type ResetSpendOutput,
	type ResetUsageAccountId,
	type ResetUsageSelectorAdapter,
} from "../components/reset-usage-selector";
import { SessionSelectorComponent } from "../components/session-selector";
import { ToolExecutionComponent } from "../components/tool-execution";
import {
	HookSelectorComponent,
	makeHookModalModel,
	type HookModalCommand,
	type HookModalModel,
	type HookSelectorOptionInput,
	type HookSelectorSlider,
	type HookSelectorSliderSegment,
	updateHookModal,
} from "../components/hook-selector";
import { HookInputComponent, makeHookInputModel, type HookInputModel, updateHookInput } from "../components/hook-input";
import { HookEditorComponent, makeHookEditorModel, type HookEditorModel, updateHookEditor } from "../components/hook-editor";
import { TranscriptBlock } from "../components/transcript-container";
import {
	SETTINGS_MODAL_COMPONENT_ID,
	type SettingsModalCommand,
	type SettingsModalModel,
	type SettingsModalMsg,
	updateSettingsModal,
} from "../components/settings-selector";
import { selectorActionToMsg } from "../components/selector-adapter";
import type { SelectorCommand, SelectorModel, SelectorMsg } from "../mvu/selector";
import {
	createSessionTreeRoute,
	sessionTreeActionToMsg,
	type SessionTreeCommand,
	type SessionTreeModel,
	type SessionTreeNavigationSettled,
	updateSessionTree,
	viewSessionTree,
} from "../components/tree-selector";
import { BookmarksStore, type BookmarkRecord, type BookmarkTarget } from "../../session/bookmarks";
import { AttentionLedger } from "../../session/attention-ledger";
import { UserMessageSelectorComponent } from "../components/user-message-selector";
import type { SessionObserverRegistry } from "../session-observer-registry";
import type { TranscriptDisplayContext } from "../transcript-display";
import { computeContextBreakdown } from "../utils/context-usage";
import { buildCopyTargets } from "../utils/copy-targets";
import {
	createSettingsSelector,
	interpretSettingsModalCommand,
	SETTINGS_SELECTOR_ROUTE,
} from "./settings-selector-construction";
interface MvuMountSpec<Model, Command, Msg = MvuEnvelope> {
	readonly componentId: ComponentId;
	readonly component: Component;
	readonly initialModel: Model;
	readonly route: MvuInputRoute<Model>;
	readonly update: (model: Model, message: Msg) => Transition<Model, Command>;
	readonly interpret: (command: Command) => Effect.Effect<readonly (Msg | SourceEnvelope<Msg>)[]>;
	readonly boundary?: MvuRuntimeBoundary<Model, Msg, Command>;
	readonly bindRuntime?: (runtime: MvuRuntime<Model, Msg>) => void;
}

type SettingsRouteRuntimeMessage =
	| MvuEnvelope
	| { readonly _tag: "Settings"; readonly message: SettingsModalMsg };

const SETTINGS_ROUTE_RUNTIME_MESSAGE_SCHEMA = Schema.declare<SettingsRouteRuntimeMessage>(
	(input): input is SettingsRouteRuntimeMessage => {
		if (typeof input !== "object" || input === null || !("_tag" in input)) return false;
		const tag = (input as { readonly _tag?: unknown })._tag;
		return tag === "MvuInput" || tag === "Settings";
	},
);

function settingsRouteStamp(model: SettingsModalModel): RouteStamp {
	return {
		componentId: SETTINGS_MODAL_COMPONENT_ID,
		leaseGeneration: model.plugins.leaseGeneration,
		sourceRevision: model.plugins.sourceRevision,
		requestGeneration: model.plugins.requestGeneration,
	};
}

type CopyRouteCommand =
	| CopySelectorCommand
	| {
			readonly _tag: "RenderCopy";
			readonly model: CopySelectorModel;
			readonly dirtyKeys: ReadonlySet<string>;
		};

type SessionTreeRouteCommand =
	| SessionTreeCommand
	| {
			readonly _tag: "RenderSessionTree";
			readonly model: SessionTreeModel;
			readonly dirtyKeys: ReadonlySet<string>;
		};
type SessionTreeRuntimeMessage = MvuEnvelope | SessionTreeNavigationSettled;
type ResetRouteRuntimeMessage = MvuEnvelope | ResetSpendOutput;

const KEYBINDING_SCHEMA = Schema.declare<keyof typeof KEYBINDINGS>(
	(input): input is keyof typeof KEYBINDINGS =>
		typeof input === "string" && Object.hasOwn(KEYBINDINGS, input),
);

const SESSION_TREE_RUNTIME_MESSAGE_SCHEMA: Schema.ConstraintDecoder<SessionTreeRuntimeMessage, never> = Schema.toType(
	Schema.Union([
		Schema.Struct({
			_tag: Schema.Literal("MvuInput"),
			action: KEYBINDING_SCHEMA,
			event: KeyEventSchema,
			stamp: Schema.optional(RouteStampSchema),
		}),
		Schema.Struct({
			_tag: Schema.Literal("NavigationSettled"),
			targetId: Schema.String,
			requestGeneration: Schema.Number,
			sourceRevision: Schema.Number,
			leaseGeneration: Schema.optional(Schema.Number),
			status: Schema.Literals(["success", "cancelled", "aborted", "failed"]),
			editorText: Schema.optional(Schema.String),
			error: Schema.optional(Schema.String),
		}),
	]),
);

const RESET_ROUTE_RUNTIME_MESSAGE_SCHEMA = Schema.toType(
	Schema.Union([
		Schema.Struct({
			_tag: Schema.Literal("MvuInput"),
			action: KEYBINDING_SCHEMA,
			event: KeyEventSchema,
			stamp: Schema.optional(RouteStampSchema),
		}),
		Schema.Struct({
			_tag: Schema.Literal("ResetSpendReceipt"),
			receiptId: Schema.String,
			id: Schema.String,
			action: KEYBINDING_SCHEMA,
			sourceRevision: Schema.Number,
			requestGeneration: Schema.Number,
			nonce: Schema.String,
			outcome: Schema.optional(Schema.Unknown),
			duplicate: Schema.Boolean,
		}),
		Schema.Struct({
			_tag: Schema.Literal("ResetSpendFailure"),
			receiptId: Schema.String,
			id: Schema.String,
			action: KEYBINDING_SCHEMA,
			sourceRevision: Schema.Number,
			requestGeneration: Schema.Number,
			nonce: Schema.String,
			error: Schema.String,
		}),
	]),
) as unknown as Schema.ConstraintDecoder<ResetRouteRuntimeMessage, never>;

type AgentDashboardRuntimeMessage =
	| MvuEnvelope
	| { readonly _tag: "AgentDashboard"; readonly message: AgentDashboardMessage };

type AgentDashboardRouteCommand =
	| AgentDashboardCommand
	| { readonly _tag: "RenderAgentDashboard"; readonly model: AgentDashboardModel };

type ExtensionDashboardRuntimeMessage =
	| MvuEnvelope
	| { readonly _tag: "ExtensionDashboard"; readonly message: ExtensionDashboardMessage };

type ExtensionDashboardRouteCommand =
	| ExtensionDashboardCommand
	| {
			readonly _tag: "RenderExtensionDashboard";
			readonly model: ExtensionDashboardModel;
	  };

type OAuthRouteCommand =
	| SelectorCommand<OAuthAction, OAuthProviderId>
	| { readonly _tag: "RenderOAuth"; readonly model: OAuthSelectorModel };

type LogoutRouteCommand =
	| SelectorCommand<LogoutAccountAction, LogoutAccountId>
	| {
			readonly _tag: "RenderLogout";
			readonly model: SelectorModel<LogoutAccountId, LogoutAccountAction>;
	  };

type ResetRouteModel = SelectorModel<ResetUsageAccountId, ResetUsageAction> & {
	readonly leaseGeneration: number;
};
type StampedResetSpendCommand = ResetSpendCommand & { readonly leaseGeneration: number };
type ResetRouteCommand =
	| Exclude<SelectorCommand<ResetUsageAction, ResetUsageAccountId>, { readonly _tag: "SpendReset" }>
	| StampedResetSpendCommand
	| { readonly _tag: "RenderReset"; readonly model: ResetRouteModel }
	| { readonly _tag: "FinalizeReset"; readonly output: ResetSpendOutput };

function agentDashboardMessage(
	envelope: MvuEnvelope,
	model: AgentDashboardModel,
): AgentDashboardMessage | undefined {
	if (envelope.event._tag !== "Press" && envelope.event._tag !== "Paste") return undefined;
	const text = envelope.event._tag === "Paste" ? envelope.event.text : envelope.event.text ?? String(envelope.event.key);
	const screen = model.screen;
	if (screen._tag === "CreateDraft") {
		if (
			(envelope.action === "app.selector.filterAppend" || envelope.action === "app.selector.filter") &&
			text.length > 0
		) return { _tag: "CreateAppend", text };
		if (envelope.action === "app.selector.filterDelete") return { _tag: "CreateDelete" };
		if (envelope.action === "tui.select.confirm") return { _tag: "CreateSubmit" };
		if (envelope.action === "ui.dismiss") return { _tag: "CreateCancel" };
		return undefined;
	}
	if (screen._tag === "ModelEdit") {
		if (
			(envelope.action === "app.selector.filterAppend" || envelope.action === "app.selector.filter") &&
			text.length > 0
		) {
			return { _tag: "ModelDraftSet", value: `${screen.draft}${text}` };
		}
		if (envelope.action === "app.selector.filterDelete") {
			return { _tag: "ModelDraftSet", value: removeLastText(screen.draft) };
		}
		if (envelope.action === "tui.select.confirm") return { _tag: "ModelSave" };
		if (envelope.action === "ui.dismiss") return { _tag: "Back" };
		return undefined;
	}
	if (screen._tag === "CreateReview") {
		if (envelope.action === "tui.select.confirm") return { _tag: "CreateSave" };
		if (
			(envelope.action === "app.selector.filterAppend" || envelope.action === "app.selector.filter") &&
			text.toLowerCase() === "r"
		) return { _tag: "CreateRegenerate" };
		if (envelope.action === "ui.dismiss") return { _tag: "CreateCancel" };
		return undefined;
	}
	if (screen._tag === "CreatePending") {
		return envelope.action === "ui.dismiss" ? { _tag: "CreateCancel" } : undefined;
	}
	switch (envelope.action) {
		case "app.navigation.up": return { _tag: "Move", delta: -1 };
		case "app.navigation.down": return { _tag: "Move", delta: 1 };
		case "tui.select.pageUp": return { _tag: "Page", delta: -1 };
		case "tui.select.pageDown": return { _tag: "Page", delta: 1 };
		case "tui.select.first": return { _tag: "Jump", target: "first" };
		case "tui.select.last": return { _tag: "Jump", target: "last" };
		case "app.selector.filter": return { _tag: "BeginFilter" };
		case "app.selector.filterAppend":
			return text.length > 0 ? { _tag: "FilterAppend", text } : undefined;
		case "app.selector.filterDelete": return { _tag: "FilterDelete" };
		case "app.selector.preview": return { _tag: "ToggleSelected" };
		case "tui.select.confirm": return { _tag: "EditSelected" };
		case "ui.dismiss": return { _tag: "Back" };
		default: return undefined;
	}
}

function extensionDashboardMessage(
	envelope: MvuEnvelope,
	model: ExtensionDashboardModel,
): ExtensionDashboardMessage | undefined {
	if (envelope.event._tag !== "Press" && envelope.event._tag !== "Paste") return undefined;
	const text = envelope.event._tag === "Paste" ? envelope.event.text : envelope.event.text ?? String(envelope.event.key);
	switch (envelope.action) {
		case "app.navigation.up": return { _tag: "Move", delta: -1 };
		case "app.navigation.down": return { _tag: "Move", delta: 1 };
		case "app.selector.filter":
			return model.mode === "Filter" && text.length > 0 ? { _tag: "FilterAppend", text } : { _tag: "BeginFilter" };
		case "app.selector.filterAppend":
			return text.length > 0 ? { _tag: "FilterAppend", text } : undefined;
		case "app.selector.filterDelete": return { _tag: "FilterDelete" };
		case "app.selector.preview": return { _tag: "ToggleSelected" };
		case "tui.select.confirm": return { _tag: "Activate" };
		case "ui.dismiss": return { _tag: "Back" };
		default: return undefined;
	}
}

const INPUT_CAPACITY = 256;
const MESSAGE_CAPACITY = 256;
const COMMAND_CAPACITY = 64;

const MANUAL_LOGIN_TIP = "Tip: You can complete pairing with /login <redirect URL>.";

export function getAgentHubTurnStatus(registry: AgentRegistry, agentId: string): AgentHubTurnStatus | undefined {
	const ref = registry.get(agentId);
	if (!ref?.quota) return undefined;
	let state: "running" | "completed" | "cancelled" = "completed";
	if (ref.status === "running") state = "running";
	else if (ref.status === "aborted") state = "cancelled";
	return {
		inputId: ref.id,
		state,
		canCancel: false,
		provider: ref.quota.originalProvider,
		reroutedProvider: ref.quota.reroutedProvider,
		originalModel: ref.quota.originalModel,
		reroutedModel: ref.quota.reroutedModel,
		ratePerHour: ref.quota.ratePerHour,
		projectedEmptyAt: ref.quota.projectedEmptyAt,
		resetAt: ref.quota.resetAt,
		deficitPerHour: ref.quota.deficitPerHour,
		decisionReason: ref.quota.decisionReason,
		quotaPoolId: ref.quota.quotaPoolId,
		limitWindowId: ref.quota.limitWindowId,
	};
}

type HookSurfaceModel =
	| { readonly _tag: "Selector"; readonly model: HookModalModel }
	| { readonly _tag: "Input"; readonly model: HookInputModel }
	| { readonly _tag: "Editor"; readonly model: HookEditorModel };

type HookRouteModel = {
	readonly surface: HookSurfaceModel;
	readonly componentId: ComponentId;
	readonly leaseGeneration: number;
	readonly sourceRevision: number;
	readonly requestGeneration: number;
};

type HookRouteMsg =
	| MvuEnvelope
	| {
			readonly _tag: "ExternalEditorResult";
			readonly stamp: RouteStamp;
			readonly value: string | null;
			readonly error?: string;
	  };

type HookRouteCommand =
	| { readonly _tag: "Render"; readonly model: HookRouteModel; readonly stamp: RouteStamp }
	| { readonly _tag: "Resolve"; readonly value: string; readonly stamp: RouteStamp }
	| { readonly _tag: "Cancel"; readonly stamp: RouteStamp }
	| { readonly _tag: "Reject"; readonly reason: string; readonly stamp: RouteStamp }
	| { readonly _tag: "SliderChanged"; readonly index: number; readonly stamp: RouteStamp }
	| { readonly _tag: "ExternalEditorRequested"; readonly value: string; readonly stamp: RouteStamp };

const HOOK_FLOW_COMPONENT_ID = "hook-flow" as ComponentId;

function hookStamp(model: HookRouteModel): RouteStamp {
	return {
		componentId: model.componentId,
		leaseGeneration: model.leaseGeneration,
		sourceRevision: model.sourceRevision,
		requestGeneration: model.requestGeneration,
	};
}

function hookText(event: KeyEvent): string | undefined {
	if (event._tag === "Paste") return event.text;
	if (event._tag !== "Press") return undefined;
	return event.text ?? String(event.key);
}

function removeLastText(value: string): string {
	const chars = [...value];
	chars.pop();
	return chars.join("");
}

function hookPrintableText(event: KeyEvent): string | undefined {
	if (event._tag === "Paste") return event.text;
	const text = hookText(event);
	if (text === undefined || text === "backspace") return undefined;
	return extractPrintableText(text);
}

function appendHookText(value: string, event: KeyEvent): string {
	const printable = hookPrintableText(event);
	return printable === undefined ? value : value + printable;
}

class HookFlowComponent extends Container {
	readonly #selector = new HookSelectorComponent();
	readonly #input = new HookInputComponent();
	readonly #editor = new HookEditorComponent();

	constructor(model: HookRouteModel) {
		super();
		this.apply(model);
	}

	apply(model: HookRouteModel): void {
		this.clear();
		switch (model.surface._tag) {
			case "Selector":
				this.#selector.apply(model.surface.model);
				this.addChild(this.#selector);
				break;
			case "Input":
				this.#input.apply(model.surface.model);
				this.addChild(this.#input);
				break;
			case "Editor":
				this.#editor.apply(model.surface.model);
				this.addChild(this.#editor);
				break;
		}
		this.invalidate();
	}
}

interface HookDialogRequest<Result> {
	readonly start: () => void;
	readonly settled: () => boolean;
}

class HookDialogFifo<Result> {
	#active = false;
	#queue: HookDialogRequest<Result>[] = [];

	present(
		signal: AbortSignal | undefined,
		mount: (
			settle: (value: Result | undefined) => void,
			fail: (error: Error) => void,
		) => Promise<() => Promise<void>>,
	): Promise<Result | undefined> {
		const { promise, resolve, reject } = Promise.withResolvers<Result | undefined>();
		let settled = false;
		let started = false;
		let hide: (() => Promise<void>) | undefined;
		let request: HookDialogRequest<Result>;
		const settle = (value: Result | undefined): void => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			if (started) {
				void hide?.().finally(() => {
					this.#active = false;
					this.#advance();
				});
			} else {
				const index = this.#queue.indexOf(request);
				if (index >= 0) this.#queue.splice(index, 1);
			}
			resolve(value);
		};
		const fail = (error: Error): void => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			if (started) {
				void hide?.().finally(() => {
					this.#active = false;
					this.#advance();
				});
			} else {
				const index = this.#queue.indexOf(request);
				if (index >= 0) this.#queue.splice(index, 1);
			}
			reject(error);
		};
		const onAbort = (): void => settle(undefined);
		request = {
			settled: () => settled,
			start: () => {
				if (settled) {
					this.#advance();
					return;
				}
				started = true;
				this.#active = true;
				void mount(settle, fail).then(close => {
					hide = close;
					if (settled) void close();
				}).catch(error => fail(error instanceof Error ? error : new Error(String(error))));
			},
		};
		if (signal?.aborted) {
			settled = true;
			resolve(undefined);
			return promise;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		this.#queue.push(request);
		this.#advance();
		return promise;
	}

	#advance(): void {
		if (this.#active) return;
		while (this.#queue.length > 0) {
			const next = this.#queue.shift();
			if (next === undefined || next.settled()) continue;
			next.start();
			return;
		}
	}
}

function hookRouteUpdate(model: HookRouteModel, message: HookRouteMsg): Transition<HookRouteModel, HookRouteCommand> {
	if (message._tag === "ExternalEditorResult") {
		const current = hookStamp(model);
		if (
			message.stamp.componentId !== current.componentId ||
			message.stamp.leaseGeneration !== current.leaseGeneration ||
			message.stamp.requestGeneration !== current.requestGeneration
		) return { model, commands: [], dirtyKeys: new Set() };
		if (model.surface._tag !== "Editor") return { model, commands: [], dirtyKeys: new Set() };
		if (message.error !== undefined) {
			return { model, commands: [{ _tag: "Reject", reason: message.error, stamp: current }], dirtyKeys: new Set(["editor"]) };
		}
		const value = message.value ?? model.surface.model.text;
		const nextModel = {
			...model,
			surface: { _tag: "Editor", model: { ...model.surface.model, text: value, cursor: value.length } } as const,
		};
		return {
			model: nextModel,
			commands: [{ _tag: "Render", model: nextModel, stamp: current }],
			dirtyKeys: new Set(["editor"]),
		};
	}
	const envelope = message;
	const event = envelope.event;
	const stamp: RouteStamp = envelope.stamp ?? hookStamp(model);
	const base = {
		...model,
		leaseGeneration: stamp.leaseGeneration,
		sourceRevision: stamp.sourceRevision,
		requestGeneration: stamp.requestGeneration,
	};
	const emit = (
		next: HookRouteModel,
		commands: readonly HookRouteCommand[] = [],
	): Transition<HookRouteModel, HookRouteCommand> => ({
		model: next,
		commands: [{ _tag: "Render", model: next, stamp: hookStamp(next) }, ...commands],
		dirtyKeys: new Set(["selector", "input", "editor"]),
	});
	const cancel = (next: HookRouteModel): Transition<HookRouteModel, HookRouteCommand> =>
		emit(next, [{ _tag: "Cancel", stamp: hookStamp(next) }]);
	if (base.surface._tag === "Selector") {
		let selectorMessage: Parameters<typeof updateHookModal>[1] | undefined;
		switch (envelope.action) {
			case "app.navigation.up":
			case "tui.select.up": selectorMessage = { _tag: "Move", delta: -1 }; break;
			case "app.navigation.down":
			case "tui.select.down": selectorMessage = { _tag: "Move", delta: 1 }; break;
			case "app.selector.filter":
				selectorMessage = event._tag === "Paste" && event.text.length > 0
					? { _tag: "FilterChanged", query: event.text }
					: { _tag: "BeginFilter" };
				break;
			case "app.selector.filterAppend": {
				const text = hookText(event);
				if (text === undefined) break;
				selectorMessage = {
					_tag: "FilterChanged",
					query: base.surface.model.region === "filter"
						? appendHookText(base.surface.model.query, event)
						: text,
				};
				break;
			}
			case "app.selector.filterDelete":
				selectorMessage = {
					_tag: "FilterChanged",
					query: removeLastText(base.surface.model.query),
				};
				break;
			case "app.hook.sliderLeft": selectorMessage = { _tag: "MoveSlider", delta: -1 }; break;
			case "app.hook.sliderRight": selectorMessage = { _tag: "MoveSlider", delta: 1 }; break;
			case "tui.select.confirm": selectorMessage = { _tag: "Select" }; break;
			case "ui.dismiss": selectorMessage = { _tag: "Back" }; break;
			case "app.editor.external": selectorMessage = { _tag: "ExternalEditor" }; break;
			case "tui.select.pageUp": selectorMessage = { _tag: "Move", delta: -1 }; break;
			case "tui.select.pageDown": selectorMessage = { _tag: "Move", delta: 1 }; break;
			default: break;
		}
		if (selectorMessage === undefined) return { model: base, commands: [], dirtyKeys: new Set() };
		const transition = updateHookModal(base.surface.model, selectorMessage);
		const mapped = transition.commands.flatMap((command: HookModalCommand): readonly HookRouteCommand[] => {
			const commandStamp = hookStamp(base);
			switch (command._tag) {
				case "SelectionRequested": return [{ _tag: "Resolve", value: command.label, stamp: commandStamp }];
				case "CloseRequested": return [{ _tag: "Cancel", stamp: commandStamp }];
				case "SliderChanged": return [{ _tag: "SliderChanged", index: command.index, stamp: commandStamp }];
				case "ExternalEditorRequested": return [{ _tag: "ExternalEditorRequested", value: "", stamp: commandStamp }];
			}
		});
		return emit({ ...base, surface: { _tag: "Selector", model: transition.model } }, mapped);
	}
	if (base.surface._tag === "Input") {
		const input = base.surface.model;
		const text = hookText(event);
		if ((envelope.action === "app.selector.filterAppend" || envelope.action === "app.selector.filter") && text !== undefined) {
			const transition = updateHookInput(input, { _tag: "ValueChanged", value: appendHookText(input.value, event) });
			return emit({ ...base, surface: { _tag: "Input", model: transition.model } });
		}
		if (envelope.action === "app.selector.filterDelete") {
			const transition = updateHookInput(input, { _tag: "ValueChanged", value: removeLastText(input.value) });
			return emit({ ...base, surface: { _tag: "Input", model: transition.model } });
		}
		if (envelope.action === "tui.select.confirm") {
			const transition = updateHookInput(input, { _tag: "Submit" });
			return emit(base, transition.commands.map(command =>
				command._tag === "Resolve"
					? { _tag: "Resolve", value: command.value, stamp: hookStamp(base) }
					: { _tag: "Cancel", stamp: hookStamp(base) },
			));
		}
		if (envelope.action === "ui.dismiss") return cancel(base);
		return { model: base, commands: [], dirtyKeys: new Set() };
	}
	const editor = base.surface.model;
	if (envelope.action === "app.selector.filterAppend" || envelope.action === "app.selector.filter") {
		const text = hookPrintableText(event);
		if (text !== undefined) {
			const transition = updateHookEditor(editor, { _tag: "InsertText", text });
			return emit({ ...base, surface: { _tag: "Editor", model: transition.model } });
		}
	}
	if (envelope.action === "app.selector.filterDelete") {
		const transition = updateHookEditor(editor, { _tag: "DeleteBackward" });
		return emit({ ...base, surface: { _tag: "Editor", model: transition.model } });
	}
	if (envelope.action === "tui.editor.cursorLeft" || envelope.action === "tui.editor.cursorRight") {
		const transition = updateHookEditor(editor, {
			_tag: "MoveCursor",
			delta: envelope.action === "tui.editor.cursorLeft" ? -1 : 1,
		});
		return emit({ ...base, surface: { _tag: "Editor", model: transition.model } });
	}
	if (envelope.action === "tui.select.confirm" && !editor.promptStyle) {
		const transition = updateHookEditor(editor, { _tag: "InsertText", text: "\n" });
		return emit({ ...base, surface: { _tag: "Editor", model: transition.model } });
	}
	if (envelope.action === "tui.select.confirm" || envelope.action === "app.hook.submit") {
		const transition = updateHookEditor(editor, { _tag: "Submit" });
		return emit(base, transition.commands.map(command => {
			switch (command._tag) {
				case "Resolve":
					return { _tag: "Resolve", value: command.value, stamp: hookStamp(base) };
				case "Cancel":
					return { _tag: "Cancel", stamp: hookStamp(base) };
				case "ExternalEditorRequested":
					return { _tag: "ExternalEditorRequested", value: command.value, stamp: hookStamp(base) };
			}
		}));
	}
	if (envelope.action === "app.editor.external") {
		const next = { ...base, requestGeneration: base.requestGeneration + 1 };
		return emit(next, [{ _tag: "ExternalEditorRequested", value: editor.text, stamp: hookStamp(next) }]);
	}
	if (envelope.action === "ui.dismiss") return cancel(base);
	return { model: base, commands: [], dirtyKeys: new Set() };
}

export class SelectorController {
	#lastHubSelection: { kind: "agent" | "external"; id: string; viewportOffset: number } | undefined;
	readonly #bookmarks = new BookmarksStore();
	readonly #attention = new AttentionLedger();
	#activeHub: AgentHubOverlayComponent | undefined;
	#activeMvuRoute: MvuRouteHandle | undefined;
	#routeTransition: Promise<void> = Promise.resolve();
	readonly #getInputLeaseManager: () => InputLeaseManager;
	readonly #mvuScope: Scope.Scope;
	readonly #hookDialogs = new HookDialogFifo<string>();
	readonly #resetSpendDeduplication = makeResetSpendDeduplication();
	#resetUsageMountGeneration = 0;

	constructor(
		private ctx: InteractiveModeContext,
		getInputLeaseManager: () => InputLeaseManager,
		mvuScope: Scope.Scope,
	) {
		this.#getInputLeaseManager = getInputLeaseManager;
		this.#mvuScope = mvuScope;
	}

	#serializeRouteTransition<Result>(transition: () => Promise<Result>): Promise<Result> {
		const operation = this.#routeTransition.then(transition, transition);
		this.#routeTransition = operation.then(() => undefined, () => undefined);
		return operation;
	}

	#scheduleRouteTransition(transition: () => Promise<void>): void {
		void this.#serializeRouteTransition(transition).catch(error => {
			this.ctx.showError(error instanceof Error ? error.message : String(error));
		});
	}

	showHookSelector(
		title: string,
		options: ExtensionUISelectItem[],
		dialogOptions?: InteractiveSelectorDialogOptions,
		extra?: { readonly slider?: HookSelectorSlider },
	): Promise<string | undefined> {
		const rows = options.map((option, index) => {
			const normalized = typeof option === "string" ? { label: option } : option;
			return {
				id: `${index}`,
				label: normalized.label,
				...(normalized.description === undefined ? {} : { description: normalized.description }),
				disabled: dialogOptions?.disabledIndices?.includes(index) ?? false,
			};
		});
		const slider = extra?.slider;
		const model = makeHookModalModel(rows, dialogOptions?.initialIndex ?? 0, slider?.index ?? 0, slider?.segments.length ?? 0, {
			title,
			helpText: dialogOptions?.helpText,
			outline: dialogOptions?.outline,
			maxVisible: Math.max(4, Math.min(15, this.ctx.ui.terminal.rows - 12)),
			selectionMarker: dialogOptions?.selectionMarker,
			checkedIndices: dialogOptions?.checkedIndices,
			markableCount: dialogOptions?.markableCount,
			sliderCaption: slider?.caption,
			sliderSegments: slider?.segments,
		});
		return this.#presentHookDialog(model, dialogOptions?.signal, slider?.onChange, dialogOptions?.onExternalEditor);
	}

	showHookInput(title: string, placeholder?: string, dialogOptions?: ExtensionUIDialogOptions): Promise<string | undefined> {
		return this.#presentHookDialog(makeHookInputModel(title, placeholder), dialogOptions?.signal, undefined, undefined);
	}

	showHookEditor(
		title: string,
		prefill?: string,
		dialogOptions?: ExtensionUIDialogOptions,
		editorOptions?: { readonly promptStyle?: boolean },
	): Promise<string | undefined> {
		return this.#presentHookDialog(
			makeHookEditorModel(title, prefill ?? "", editorOptions?.promptStyle ?? false),
			dialogOptions?.signal,
			undefined,
			undefined,
		);
	}

	hideHookSelector(): void {
		this.#closeActiveMvuRoute();
	}

	hideHookInput(): void {
		this.#closeActiveMvuRoute();
	}

	hideHookEditor(): void {
		this.#closeActiveMvuRoute();
	}

	#presentHookDialog(
		surfaceModel: HookModalModel | HookInputModel | HookEditorModel,
		signal: AbortSignal | undefined,
		onSlider: ((index: number) => void) | undefined,
		onExternalEditor: (() => void) | undefined,
	): Promise<string | undefined> {
		return this.#hookDialogs.present(signal, (settle, fail) =>
			this.#mountHookDialog(surfaceModel, settle, fail, onSlider, onExternalEditor),
		);
	}

	#mountHookDialog(
		surfaceModel: HookModalModel | HookInputModel | HookEditorModel,
		settle: (value: string | undefined) => void,
		fail: (error: Error) => void,
		onSlider: ((index: number) => void) | undefined,
		onExternalEditor: (() => void) | undefined,
	): Promise<() => Promise<void>> {
		const mount = this.#serializeRouteTransition(async () => {
			if (this.#activeMvuRoute !== undefined) {
				await Effect.runPromise(this.#activeMvuRoute.close());
				this.#activeMvuRoute = undefined;
			}
			const initial: HookRouteModel = {
				surface:
					"title" in surfaceModel
						? "options" in surfaceModel
							? { _tag: "Selector", model: surfaceModel }
							: "promptStyle" in surfaceModel
								? { _tag: "Editor", model: surfaceModel }
								: { _tag: "Input", model: surfaceModel }
						: { _tag: "Input", model: makeHookInputModel("") },
				componentId: HOOK_FLOW_COMPONENT_ID,
				leaseGeneration: 0,
				sourceRevision: 0,
				requestGeneration: 0,
			};
			const component = new HookFlowComponent(initial);
			let handle: MvuRouteHandle | undefined;
			let closed = false;
			const close = async (): Promise<void> => {
				if (closed) return;
				closed = true;
				if (this.#activeMvuRoute === handle) this.#activeMvuRoute = undefined;
				if (handle !== undefined) await Effect.runPromise(handle.close());
			};
			const route: MvuInputRoute<HookRouteModel> = {
				componentId: HOOK_FLOW_COMPONENT_ID,
				focusedRoot: component,
				context: model => ({
					contexts: ["selector.global", "selector.filter", "hook.route"],
					mode: model.surface._tag === "Selector" && model.surface.model.region === "options" ? "Browse" : "Filter",
					focus: "list",
					capabilities: new Set(
						model.surface._tag === "Selector"
							? ["selector.filter", "hook.slider"]
							: model.surface._tag === "Editor"
								? ["selector.filter", "hook.editor"]
								: ["selector.filter"],
					),
				}),
				actionToMsg: (action: Keybinding, event: KeyEvent) => ({ _tag: "MvuInput", action, event }),
				pasteToMsg: event => ({ _tag: "MvuInput", action: "app.selector.filter", event }),
			};
			const spec: MvuMountSpec<HookRouteModel, HookRouteCommand, HookRouteMsg> = {
				componentId: HOOK_FLOW_COMPONENT_ID,
				component,
				initialModel: initial,
				route,
				update: hookRouteUpdate,
				interpret: command => {
					if (command._tag === "Render") {
						return Effect.sync(() => {
							component.apply(command.model);
							this.ctx.ui.requestComponentRender(component);
							return [];
						});
					}
					if (command._tag === "SliderChanged") {
						return Effect.sync(() => {
							onSlider?.(command.index);
							return [];
						});
					}
					if (command._tag === "ExternalEditorRequested") {
						return Effect.promise(async () => {
							if (onExternalEditor !== undefined) {
								onExternalEditor();
								return [];
							}
							const editorCommand = getEditorCommand();
							if (!editorCommand) return [];
							this.ctx.ui.stop();
							try {
								const value = await openInEditor(editorCommand, command.value);
								return [{ _tag: "ExternalEditorResult", stamp: command.stamp, value }];
							} catch (error) {
								return [{
									_tag: "ExternalEditorResult",
									stamp: command.stamp,
									value: null,
									error: error instanceof Error ? error.message : String(error),
								}];
							} finally {
								this.ctx.ui.start();
								this.ctx.ui.requestRender(true);
							}
						});
					}
					return Effect.promise(async () => {
						await close();
						if (command._tag === "Resolve") settle(command.value);
						else if (command._tag === "Cancel") settle(undefined);
						else fail(new Error(command.reason));
						return [];
					});
				},
			};
			handle = await Effect.runPromise(
				Scope.provide(this.#mvuScope)(
					mountMvuEditorReplacement({
						tui: this.ctx.ui,
						leaseManager: this.#getInputLeaseManager(),
						route,
						component,
						runtimeConfig: {
							componentId: spec.componentId,
							initialModel: spec.initialModel,
							update: spec.update,
							interpret: spec.interpret,
							inputCapacity: INPUT_CAPACITY,
							messageCapacity: MESSAGE_CAPACITY,
							commandCapacity: COMMAND_CAPACITY,
						},
						hideEditor: Effect.sync(() => {
							this.ctx.editorContainer.clear();
							this.ctx.editorContainer.addChild(component);
						}),
						restoreEditor: Effect.sync(() => {
							this.ctx.editorContainer.clear();
							this.ctx.editorContainer.addChild(this.ctx.editor);
						}),
						previousFocus: this.ctx.editor,
					}),
				),
			);
			this.#activeMvuRoute = handle;
			this.ctx.ui.requestRender();
			return close;
		});
		return mount;
	}

	#closeActiveMvuRoute(afterClose?: () => void): void {
		this.#scheduleRouteTransition(async () => {
			const active = this.#activeMvuRoute;
			if (active !== undefined) {
				this.#activeMvuRoute = undefined;
				await Effect.runPromise(active.close());
			}
			afterClose?.();
			this.ctx.ui.requestRender();
		});
	}

	#mountMvuEditor<Model, Command, Msg = MvuEnvelope>(
		spec: MvuMountSpec<Model, Command, Msg>,
		restoreEditor?: () => void,
		reservation?: InputLeaseHandle,
	): void {
		this.#scheduleRouteTransition(async () => {
			try {
				if (this.#activeMvuRoute !== undefined) {
					await Effect.runPromise(this.#activeMvuRoute.close());
					this.#activeMvuRoute = undefined;
				}
				const handle = await Effect.runPromise(
					Scope.provide(this.#mvuScope)(
						mountMvuEditorReplacement({
							tui: this.ctx.ui,
							leaseManager: this.#getInputLeaseManager(),
							route: spec.route,
							component: spec.component,
							bindRuntime: spec.bindRuntime,
							runtimeConfig: {
								componentId: spec.componentId,
								initialModel: spec.initialModel,
								update: spec.update,
								interpret: spec.interpret,
								inputCapacity: INPUT_CAPACITY,
								messageCapacity: MESSAGE_CAPACITY,
								commandCapacity: COMMAND_CAPACITY,
								boundary: spec.boundary,
							},
							hideEditor: Effect.sync(() => {
								this.ctx.editorContainer.clear();
								this.ctx.editorContainer.addChild(spec.component);
							}),
							restoreEditor: Effect.sync(() => {
								this.ctx.editorContainer.clear();
								this.ctx.editorContainer.addChild(this.ctx.editor);
								restoreEditor?.();
							}),
							previousFocus: this.ctx.editor,
						}),
					),
				);
				this.#activeMvuRoute = handle;
				this.ctx.ui.requestRender();
			} catch (error) {
				if (reservation !== undefined) await Effect.runPromise(reservation.revoke());
				throw error;
			}
		});
	}

	#mountMvuOverlay<Model, Command, Msg = MvuEnvelope>(
		spec: MvuMountSpec<Model, Command, Msg>,
		overlayOptions: OverlayOptions,
		restoreFocus: () => void,
	): void {
		this.#scheduleRouteTransition(async () => {
			if (this.#activeMvuRoute !== undefined) {
				await Effect.runPromise(this.#activeMvuRoute.close());
				this.#activeMvuRoute = undefined;
			}
			this.#activeMvuRoute = await Effect.runPromise(
				Scope.provide(this.#mvuScope)(
					mountMvuOverlay({
						tui: this.ctx.ui,
						leaseManager: this.#getInputLeaseManager(),
						route: spec.route,
						component: spec.component,
						runtimeConfig: {
							componentId: spec.componentId,
							initialModel: spec.initialModel,
							update: spec.update,
							interpret: spec.interpret,
							inputCapacity: INPUT_CAPACITY,
							messageCapacity: MESSAGE_CAPACITY,
							commandCapacity: COMMAND_CAPACITY,
							boundary: spec.boundary,
						},
						bindRuntime: spec.bindRuntime,
						overlayOptions,
						restoreFocus: Effect.sync(restoreFocus),
					}),
				),
			);
			this.ctx.ui.setFocus(spec.component);
			this.ctx.ui.requestRender();
		});
	}

	async #refreshOAuthProviderAuthState(): Promise<void> {
		const oauthProviders = getOAuthProviders();
		await Promise.all(
			oauthProviders.map(provider =>
				this.ctx.session.modelRegistry
					.getApiKeyForProvider(provider.id, this.ctx.session.sessionId)
					.catch(() => undefined),
			),
		);
	}

	#mountOAuthRoute(mode: "login" | "logout", adapter: OAuthSelectorAdapter): void {
		const component = new OAuthSelectorComponent(mode, adapter);
		const mountSpec: MvuMountSpec<OAuthSelectorModel, OAuthRouteCommand> = {
			componentId: adapter.componentId,
			component,
			initialModel: adapter.initialModel,
			route: {
				componentId: adapter.componentId,
				focusedRoot: component,
				context: model => ({
					contexts: ["selector.global", "selector.filter", `selector.oauth.${mode}`],
					mode: model.mode._tag,
					focus: "list",
					capabilities: adapter.selector.capabilities,
				}),
				actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
			},
			update: (model, envelope) => {
				let message: OAuthSelectorMsg | undefined;
				if (envelope.action === "tui.select.confirm" && model.mode._tag !== "Confirm" && model.selectedId !== undefined) {
					const activation = adapter.selector.activate(model.selectedId, model);
					message = activation._tag === "Command"
						? { _tag: "DirectActivate", action: activation.action }
						: undefined;
				} else {
					message = selectorActionToMsg(envelope.action, envelope.event, model, adapter.componentId);
				}
				if (message === undefined) return { model, commands: [], dirtyKeys: new Set() };
				const transition = adapter.update(model, message);
				return {
					model: transition.model,
					commands: [...transition.commands, { _tag: "RenderOAuth", model: transition.model }],
					dirtyKeys: transition.dirtyKeys,
				};
			},
			interpret: command =>
				Effect.sync(() => {
					if (command._tag === "RenderOAuth") {
						component.apply(command.model);
						this.ctx.ui.requestComponentRender(component);
						return [];
					}
					const output = oauthSelectorOutput(command, adapter);
					if (output?._tag === "OAuthSelectorClosed") {
						this.#closeActiveMvuRoute();
					} else if (output?._tag === "OAuthProviderSelected") {
						this.#closeActiveMvuRoute(() => {
							if (mode === "login") void this.#handleOAuthLogin(output.providerId);
							else void this.#showOAuthLogoutAccountSelector(output.providerId);
						});
					}
					return [];
				}),
		};
		this.#mountMvuEditor(mountSpec);
	}

	#mountLogoutRoute(providerId: string, providerName: string, adapter: LogoutAccountSelectorAdapter): void {
		const component = new LogoutAccountSelectorComponent(providerName, adapter);
		const mountSpec: MvuMountSpec<SelectorModel<LogoutAccountId, LogoutAccountAction>, LogoutRouteCommand> = {
			componentId: adapter.componentId,
			component,
			initialModel: adapter.initialModel,
			route: {
				componentId: adapter.componentId,
				focusedRoot: component,
				context: model => ({
					contexts: ["selector.global", "selector.logout-account"],
					mode: model.mode._tag,
					focus: "list",
					capabilities: adapter.selector.capabilities,
				}),
				actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
			},
			update: (model, envelope) => {
				let message: SelectorMsg<LogoutAccountId, LogoutAccountAction> | undefined;
				if (envelope.action === "tui.select.confirm" && model.selectedId !== undefined) {
					const activation = adapter.selector.activate(model.selectedId, model);
					message = activation._tag === "Command"
						? { _tag: "DirectActivate", action: activation.action }
						: undefined;
				} else {
					message = selectorActionToMsg(envelope.action, envelope.event, model, adapter.componentId);
				}
				if (message === undefined) return { model, commands: [], dirtyKeys: new Set() };
				const transition = adapter.update(model, message);
				return {
					model: transition.model,
					commands: [...transition.commands, { _tag: "RenderLogout", model: transition.model }],
					dirtyKeys: transition.dirtyKeys,
				};
			},
			interpret: command =>
				Effect.sync(() => {
					if (command._tag === "RenderLogout") {
						component.apply(command.model);
						this.ctx.ui.requestComponentRender(component);
						return [];
					}
					const output = logoutAccountSelectorOutput(command, adapter);
					if (output?._tag === "LogoutAccountSelectorClosed") {
						this.#closeActiveMvuRoute();
					} else if (output?._tag === "LogoutAccountSelected") {
						const account = adapter.rows.get(output.id)?.account;
						if (account) this.#closeActiveMvuRoute(() => void this.#handleCredentialLogout(providerId, account));
					}
					return [];
				}),
		};
		this.#mountMvuEditor(mountSpec);
	}

	#mountResetRoute(adapter: ResetUsageSelectorAdapter): void {
		const component = new ResetUsageSelectorComponent(adapter);
		const spend = makeSpendResetInterpreter({
			adapter,
			deduplication: this.#resetSpendDeduplication,
			redeem: target => Effect.promise(() => this.ctx.session.redeemResetCredit(target)),
		});
		const initialModel: ResetRouteModel = { ...adapter.initialModel, leaseGeneration: 0 };
		const mountSpec: MvuMountSpec<ResetRouteModel, ResetRouteCommand, ResetRouteRuntimeMessage> = {
			componentId: adapter.componentId,
			component,
			initialModel,
			route: {
				componentId: adapter.componentId,
				focusedRoot: component,
				context: model => ({
					contexts: ["selector.global", "selector.confirm", "selector.reset-usage"],
					mode: model.mode._tag,
					focus: "list",
					capabilities: adapter.selector.capabilities,
				}),
				actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
			},
			update: (model, envelope) => {
				if (envelope._tag !== "MvuInput") {
					const transition = adapter.update(model, resetSpendOutputToSelectorMsg(envelope));
					if (transition.model === model) return { model, commands: [], dirtyKeys: new Set() };
					const nextModel: ResetRouteModel = {
						...transition.model,
						leaseGeneration: model.leaseGeneration,
					};
					return {
						model: nextModel,
						commands: [
							{ _tag: "RenderReset", model: nextModel },
							{ _tag: "FinalizeReset", output: envelope },
						],
						dirtyKeys: transition.dirtyKeys,
					};
				}

				let message: SelectorMsg<ResetUsageAccountId, ResetUsageAction> | undefined;
				if (envelope.action === "tui.select.confirm" && model.mode._tag === "Confirm") {
					const selectedId = model.selectedId;
					message = selectedId === undefined
						? undefined
						: {
								_tag: "CommitArmed",
								id: selectedId,
								sourceRevision: model.sourceRevision,
								nonce: model.mode.arm.nonce,
								redeemable: adapter.redeemable(selectedId),
							};
				} else if (envelope.action === "tui.select.confirm" && model.selectedId !== undefined) {
					const activation = adapter.selector.activate(model.selectedId, model);
					message = activation._tag === "Confirm"
						? { _tag: "Arm", action: activation.action, nonce: activation.nonce }
						: undefined;
				} else {
					message = selectorActionToMsg(envelope.action, envelope.event, model, adapter.componentId);
				}
				if (message === undefined) return { model, commands: [], dirtyKeys: new Set() };
				const leaseGeneration = envelope.stamp?.leaseGeneration ?? model.leaseGeneration;
				const transition = adapter.update(model, message);
				const nextModel: ResetRouteModel = { ...transition.model, leaseGeneration };
				const commands: ResetRouteCommand[] = transition.commands.map(command =>
					command._tag === "SpendReset" ? { ...command, leaseGeneration } : command
				);
				commands.push({ _tag: "RenderReset", model: nextModel });
				return {
					model: nextModel,
					commands,
					dirtyKeys: transition.dirtyKeys,
				};
			},
			interpret: command => {
				if (command._tag === "RenderReset") {
					return Effect.sync(() => {
						component.apply(command.model);
						this.ctx.ui.requestComponentRender(component);
						return [];
					});
				}
				if (command._tag === "CloseRequested") {
					return Effect.sync(() => {
						this.#closeActiveMvuRoute();
						return [];
					});
				}
				if (command._tag === "FinalizeReset") {
					return Effect.sync(() => {
						const account = adapter.rows.get(command.output.id)?.account;
						const outcome = command.output._tag === "ResetSpendReceipt" ? command.output.outcome : undefined;
						if (outcome && account) {
							this.#closeActiveMvuRoute(() => this.#reportResetOutcome(account, outcome));
						} else if (command.output._tag === "ResetSpendFailure") {
							this.ctx.showError(command.output.error);
						}
						return [];
					});
				}
				const resetCommand: ResetSpendCommand | undefined = resetUsageSelectorOutput(command, adapter);
				return resetCommand === undefined ? Effect.succeed([]) : spend(resetCommand);
			},
			boundary: {
				messageSchema: RESET_ROUTE_RUNTIME_MESSAGE_SCHEMA,
				currentStamp: model => ({
					componentId: adapter.componentId,
					leaseGeneration: model.leaseGeneration,
					sourceRevision: model.sourceRevision,
					requestGeneration: model.actionRequestGeneration,
				}),
				commandStamp: command =>
					command._tag === "SpendReset"
						? {
								componentId: adapter.componentId,
								leaseGeneration: command.leaseGeneration,
								sourceRevision: command.sourceRevision,
								requestGeneration: command.requestGeneration,
							}
						: undefined,
			},
		};
		this.#mountMvuEditor(mountSpec);
	}
	/**
	 * Shows a selector component in place of the editor.
	 * @param create Factory that receives a `done` callback and returns the component and focus target
	 */
	showSelector(create: (done: () => void) => { component: Component; focus: Component }): void {
		const done = () => {
			this.ctx.editorContainer.clear();
			this.ctx.editorContainer.addChild(this.ctx.editor);
			this.ctx.ui.setFocus(this.ctx.editor);
		};
		const { component, focus } = create(done);
		this.ctx.editorContainer.clear();
		this.ctx.editorContainer.addChild(component);
		this.ctx.ui.setFocus(focus);
		this.ctx.ui.requestRender();
	}

	showSettingsSelector(): void {
		void getAvailableThemes().then(availableThemes => {
			const close = (): void => this.#closeActiveMvuRoute();
			const selector = createSettingsSelector(
				this.ctx,
				availableThemes,
				(id, value) => this.handleSettingChange(id, value),
				close,
			);
			const availableThinkingLevels = [...this.ctx.session.getAvailableThinkingLevels()];
			const initialModel = SETTINGS_SELECTOR_ROUTE.makeInitialModel(availableThemes, availableThinkingLevels);
			selector.apply(initialModel);
			const mountSpec: MvuMountSpec<SettingsModalModel, SettingsModalCommand, SettingsRouteRuntimeMessage> = {
				componentId: SETTINGS_SELECTOR_ROUTE.componentId,
				component: selector,
				initialModel,
				route: {
					componentId: SETTINGS_SELECTOR_ROUTE.componentId,
					focusedRoot: selector,
					context: () => ({
						contexts: ["modal.family", SETTINGS_SELECTOR_ROUTE.context],
						mode: "Browse",
						focus: "body",
						capabilities: new Set(),
					}),
					actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
					pasteToMsg: event => ({ _tag: "MvuInput", action: "app.settings.input", event }),
					mouseToMsg: event => ({ _tag: "MvuInput", action: "app.settings.pointer", event }),
				},
				update: (model, envelope) => {
					const message: SettingsModalMsg =
						envelope._tag === "Settings"
							? envelope.message
							: envelope.event._tag === "Mouse"
								? selector.pointerMessage(model, envelope.event.event)
								: { _tag: "Input", action: envelope.action, event: envelope.event };
					const transition = updateSettingsModal(model, message);
					return { ...transition, dirtyKeys: new Set(["modal", "settings"]) };
				},
				interpret: command => {
					if (command._tag === "RenderSettings") {
						return Effect.sync(() => {
							selector.apply(command.model);
							this.ctx.ui.requestComponentRender(selector);
							return [];
						});
					}
					return Effect.promise(async () => {
						const message = await interpretSettingsModalCommand(
							this.ctx,
							(id, value) => this.handleSettingChange(id, value),
							close,
							command,
						);
						return message === undefined ? [] : [{ _tag: "Settings" as const, message }];
					});
				},
				boundary: {
					messageSchema: SETTINGS_ROUTE_RUNTIME_MESSAGE_SCHEMA,
					currentStamp: settingsRouteStamp,
					commandStamp: command => {
						if (command._tag !== "PluginSettingsCommand") return undefined;
						const stamp = command.command.stamp;
						return {
							componentId: SETTINGS_MODAL_COMPONENT_ID,
							leaseGeneration: stamp.leaseGeneration,
							sourceRevision: stamp.sourceRevision,
							requestGeneration: stamp.requestGeneration,
						};
					},
				},
			};
			this.#mountMvuOverlay(
				mountSpec,
				{ anchor: "bottom-center", width: "100%", maxHeight: "100%", margin: 0, fullscreen: true },
				() => this.ctx.ui.setFocus(this.ctx.editor),
			);
		});
	}

	showHistorySearch(initialQuery = this.ctx.editor.getText()): void {
		const historyStorage = this.ctx.historyStorage;
		if (!historyStorage) return;
		const draft = this.ctx.editor.getText();
		let accepted = false;
		const component = new HistorySearchComponent(
			historyStorage,
			prompt => {
				accepted = true;
				this.#closeActiveMvuRoute(() => this.ctx.editor.setText(prompt));
			},
			() => this.#closeActiveMvuRoute(),
			initialQuery,
		);
		let reservation: InputLeaseHandle;
		try {
			reservation = this.#getInputLeaseManager().reserveMvu(component.mountSpec.route);
		} catch (error) {
			this.ctx.showError(error instanceof Error ? error.message : String(error));
			return;
		}
		this.#mountMvuEditor(
			component.mountSpec,
			() => {
				if (!accepted) this.ctx.editor.setText(draft);
			},
			reservation,
		);
	}

	/**
	 * Show the Extension Control Center dashboard.
	 * Replaces /status with a unified view of all providers and extensions.
	 */
	async showExtensionsDashboard(): Promise<void> {
		const cwd = getProjectDir();
		const settings = this.ctx.settings;
		const dashboard = await ExtensionDashboard.create(cwd, settings, this.ctx.ui.terminal.rows);
		dashboard.onRequestComponentRender = component => this.ctx.ui.requestComponentRender(component);
		const mountSpec: MvuMountSpec<
			ExtensionDashboardModel,
			ExtensionDashboardRouteCommand,
			ExtensionDashboardRuntimeMessage
		> = {
			componentId: EXTENSION_DASHBOARD_ROUTE.componentId,
			component: dashboard,
			initialModel: dashboard.initialModel,
			route: {
				componentId: EXTENSION_DASHBOARD_ROUTE.componentId,
				focusedRoot: dashboard,
				context: model => ({
					contexts: [EXTENSION_DASHBOARD_ROUTE.context, "selector.filter"],
					mode: model.mode,
					focus: model.mode === "PreviewFocus" ? "preview" : "list",
					capabilities: new Set(),
				}),
				actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
			},
			update: (model, runtimeMessage) => {
				const message = runtimeMessage._tag === "ExtensionDashboard"
					? runtimeMessage.message
					: extensionDashboardMessage(runtimeMessage, model);
				if (message === undefined) return { model, commands: [], dirtyKeys: new Set() };
				const transition = reduceExtensionDashboard(model, message);
				return {
					model: transition.model,
					commands: [
						...transition.commands,
						{ _tag: "RenderExtensionDashboard", model: transition.model },
					],
					dirtyKeys: new Set(["dashboard"]),
				};
			},
			interpret: command => {
				if (command._tag === "RenderExtensionDashboard") {
					return Effect.sync(() => {
						dashboard.apply(command.model);
						return [];
					});
				}
				if (command._tag === "CloseRequested") {
					return Effect.sync(() => {
						this.#closeActiveMvuRoute();
						return [];
					});
				}
				return Effect.promise(async () => {
					try {
						if (command._tag === "ToggleProvider") {
							toggleProvider(command.providerId);
						} else if (command._tag === "ToggleExtension") {
							const disabledIds = [
								...((settings.get("disabledExtensions") as string[] | undefined) ?? []),
							];
							const index = disabledIds.indexOf(command.extensionId);
							if (command.disabled && index < 0) disabledIds.push(command.extensionId);
							if (!command.disabled && index >= 0) disabledIds.splice(index, 1);
							settings.set("disabledExtensions", disabledIds);
						}
						const disabledIds =
							(settings.get("disabledExtensions") as string[] | undefined) ?? [];
						const extensions = await loadAllExtensions(cwd, disabledIds);
						return [{
							_tag: "ExtensionDashboard",
							message: {
								_tag: "SourceLoaded",
								requestGeneration: command.requestGeneration,
								extensions,
								disabledIds,
							},
						}] as const;
					} catch (error) {
						return [{
							_tag: "ExtensionDashboard",
							message: {
								_tag: "SourceFailed",
								requestGeneration: command.requestGeneration,
								error: error instanceof Error ? error.message : String(error),
							},
						}] as const;
					}
				});
			},
		};
		this.#mountMvuOverlay(mountSpec, { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 }, () =>
			this.ctx.ui.setFocus(this.ctx.editor),
		);
	}

	/**
	 * Show the Agent Control Center dashboard.
	 */
	async showAgentsDashboard(): Promise<void> {
		const activeModel = this.ctx.session.model;
		const activeModelPattern = activeModel ? `${activeModel.provider}/${activeModel.id}` : undefined;
		const defaultModelPattern = this.ctx.settings.getModelRole("default");
		const dashboard = await AgentDashboard.create(getProjectDir(), this.ctx.settings, this.ctx.ui.terminal.rows, {
			modelRegistry: this.ctx.session.modelRegistry,
			activeModelPattern,
			defaultModelPattern,
		});
		dashboard.onRequestComponentRender = component => this.ctx.ui.requestComponentRender(component);
		const mountSpec: MvuMountSpec<
			AgentDashboardModel,
			AgentDashboardRouteCommand,
			AgentDashboardRuntimeMessage
		> = {
			componentId: AGENT_DASHBOARD_ROUTE.componentId,
			component: dashboard,
			initialModel: dashboard.initialModel,
			route: {
				componentId: AGENT_DASHBOARD_ROUTE.componentId,
				focusedRoot: dashboard,
				context: model => {
					const nested = model.screen._tag !== "Browse";
					const selectorMode = model.selector.mode._tag;
					return {
						contexts: [AGENT_DASHBOARD_ROUTE.context, "selector.filter"],
						mode: nested ? "Filter" : selectorMode,
						focus: selectorMode === "PreviewFocus" ? "preview" : "list",
						capabilities: new Set(["selector.filter"]),
					};
				},
				actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
			},
			update: (model, runtimeMessage) => {
				const message = runtimeMessage._tag === "AgentDashboard"
					? runtimeMessage.message
					: agentDashboardMessage(runtimeMessage, model);
				if (message === undefined) return { model, commands: [], dirtyKeys: new Set() };
				const transition = reduceAgentDashboard(model, message);
				return {
					model: transition.model,
					commands: [
						...transition.commands,
						{ _tag: "RenderAgentDashboard", model: transition.model },
					],
					dirtyKeys: new Set(["dashboard"]),
				};
			},
			interpret: command => {
				if (command._tag === "RenderAgentDashboard") {
					return Effect.sync(() => {
						dashboard.apply(command.model);
						return [];
					});
				}
				if (command._tag === "CloseRequested") {
					return Effect.sync(() => {
						this.#closeActiveMvuRoute();
						return [];
					});
				}
				if (command._tag === "PersistDisabled") {
					return Effect.sync(() => {
						this.ctx.settings.set("task.disabledAgents", [...command.disabledNames]);
						return [];
					});
				}
				if (command._tag === "PersistOverrides") {
					return Effect.sync(() => {
						this.ctx.settings.set("task.agentModelOverrides", { ...command.overrides });
						return [];
					});
				}
				return Effect.promise(async () => [{
					_tag: "AgentDashboard",
					message: await dashboard.execute(command),
				}] as const);
			},
		};
		this.#mountMvuOverlay(mountSpec, { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 }, () =>
			this.ctx.ui.setFocus(this.ctx.editor),
		);
	}

	/**
	 * Handle setting changes from the settings selector.
	 * Most settings are saved directly via SettingsManager in the definitions.
	 * This handles side effects and session-specific settings.
	 */
	handleSettingChange(id: string, value: unknown): void {
		// Discovery provider toggles
		if (id.startsWith("discovery.")) {
			const providerId = id.replace("discovery.", "");
			if (value) {
				enableProvider(providerId);
			} else {
				disableProvider(providerId);
			}
			return;
		}

		switch (id) {
			// Session-managed settings (not in SettingsManager)
			case "autoCompact":
				this.ctx.session.setAutoCompactionEnabled(value as boolean);
				this.ctx.statusLine.setAutoCompactEnabled(value as boolean);
				break;
			case "steeringMode":
				this.ctx.session.setSteeringMode(value as "all" | "one-at-a-time");
				break;
			case "followUpMode":
				this.ctx.session.setFollowUpMode(value as "all" | "one-at-a-time");
				break;
			case "interruptMode":
				this.ctx.session.setInterruptMode(value as "immediate" | "wait");
				break;
			case "thinkingLevel":
			case "defaultThinkingLevel":
				this.ctx.session.setThinkingLevel(value as ConfiguredThinkingLevel, true);
				this.ctx.statusLine.invalidate();
				this.ctx.updateEditorBorderColor();
				break;
			case "personality":
				void this.ctx.session.refreshBaseSystemPrompt().catch(err => {
					this.ctx.showError(`Failed to apply personality: ${err}`);
				});
				break;

			case "autocompleteMaxVisible":
				this.ctx.editor.setAutocompleteMaxVisible(typeof value === "number" ? value : Number(value));
				break;

			// Settings with UI side effects
			case "showImages":
				for (const child of this.ctx.chatContainer.children) {
					if (child instanceof ToolExecutionComponent) {
						child.setShowImages(value as boolean);
					}
				}
				break;
			case "hideThinking":
				this.ctx.hideThinkingBlock = value as boolean;
				this.ctx.session.agent.hideThinkingSummary = value as boolean;
				for (const child of this.ctx.chatContainer.children) {
					if (child instanceof AssistantMessageComponent) {
						child.setHideThinkingBlock(value as boolean);
						child.invalidate();
					}
				}
				break;
			case "theme": {
				setTheme(value as string, true).then(result => {
					this.ctx.statusLine.invalidate();
					this.ctx.updateEditorTopBorder();
					this.ctx.ui.invalidate();
					if (!result.success) {
						this.ctx.showError(`Failed to load theme "${value}": ${result.error}\nFell back to dark theme.`);
					}
				});
				break;
			}
			case "symbolPreset": {
				setSymbolPreset(value as "unicode" | "nerd" | "ascii").then(() => {
					this.ctx.statusLine.invalidate();
					this.ctx.updateEditorTopBorder();
					this.ctx.ui.invalidate();
				});
				break;
			}
			case "colorBlindMode": {
				setColorBlindMode(value === "true" || value === true).then(() => {
					this.ctx.ui.invalidate();
				});
				break;
			}
			case "temperature": {
				const temp = typeof value === "number" ? value : Number(value);
				this.ctx.session.agent.temperature = temp >= 0 ? temp : undefined;
				break;
			}
			case "topP": {
				const topP = typeof value === "number" ? value : Number(value);
				this.ctx.session.agent.topP = topP >= 0 ? topP : undefined;
				break;
			}
			case "topK": {
				const topK = typeof value === "number" ? value : Number(value);
				this.ctx.session.agent.topK = topK >= 0 ? topK : undefined;
				break;
			}
			case "minP": {
				const minP = typeof value === "number" ? value : Number(value);
				this.ctx.session.agent.minP = minP >= 0 ? minP : undefined;
				break;
			}
			case "presencePenalty": {
				const presencePenalty = typeof value === "number" ? value : Number(value);
				this.ctx.session.agent.presencePenalty = presencePenalty >= 0 ? presencePenalty : undefined;
				break;
			}
			case "repetitionPenalty": {
				const repetitionPenalty = typeof value === "number" ? value : Number(value);
				this.ctx.session.agent.repetitionPenalty = repetitionPenalty >= 0 ? repetitionPenalty : undefined;
				break;
			}
			case "statusLinePreset":
			case "statusLine.preset":
			case "statusLineSeparator":
			case "statusLine.separator":
			case "statusLineShowHooks":
			case "statusLine.showHookStatus":
			case "statusLine.sessionAccent":
			case "statusLine.transparent":
			case "statusLineSegments":
			case "statusLineModelThinking":
			case "statusLinePathAbbreviate":
			case "statusLinePathMaxLength":
			case "statusLinePathStripWorkPrefix":
			case "statusLineGitShowBranch":
			case "statusLineGitShowStaged":
			case "statusLineGitShowUnstaged":
			case "statusLineGitShowUntracked":
			case "statusLineTimeFormat":
			case "statusLineTimeShowSeconds": {
				const statusLineSettings = {
					preset: settings.get("statusLine.preset"),
					leftSegments: settings.get("statusLine.leftSegments"),
					rightSegments: settings.get("statusLine.rightSegments"),
					separator: settings.get("statusLine.separator"),
					showHookStatus: settings.get("statusLine.showHookStatus"),
					sessionAccent: settings.get("statusLine.sessionAccent"),
					transparent: settings.get("statusLine.transparent"),
					segmentOptions: settings.get("statusLine.segmentOptions"),
				};
				this.ctx.statusLine.updateSettings(statusLineSettings);
				this.ctx.updateEditorTopBorder();
				this.ctx.ui.requestRender();
				break;
			}

			// Provider settings - update runtime preferences
			case "providers.webSearch":
				if (typeof value === "string" && isSearchProviderPreference(value)) {
					setPreferredSearchProvider(value);
				}
				break;
			case "providers.webSearchExclude":
				if (Array.isArray(value)) {
					setExcludedSearchProviders(value.filter(isSearchProviderId));
				}
				break;
			case "providers.image":
				if (isImageProviderPreference(value)) {
					setPreferredImageProvider(value);
				}
				break;

			// MCP update injection - live subscribe/unsubscribe
			case "mcp.notifications":
				this.ctx.mcpManager?.setNotificationsEnabled(value as boolean);
				break;

			// All other settings are handled by the definitions (get/set on SettingsManager)
			// No additional side effects needed
		}
	}

	showModelSelector(options?: { temporaryOnly?: boolean }): void {
		const currentContextTokens = computeContextBreakdown(this.ctx.session).usedTokens;
		const selector = new ModelSelectorComponent(
			this.ctx.ui,
			this.ctx.session.model,
			this.ctx.settings,
			this.ctx.session.modelRegistry,
			this.ctx.session.scopedModels,
			async (model, role, thinkingLevel, modelSelector) => {
				// `auto` is session-global: never bake it into a per-role selector,
				// because `model:<level>` cannot round-trip that value.
				const isAuto = thinkingLevel === AUTO_THINKING;
				const concreteThinking = isAuto ? undefined : thinkingLevel;
				try {
					if (role === null) {
						await this.ctx.session.setModelTemporary(model, concreteThinking);
						if (isAuto) this.ctx.session.setThinkingLevel(AUTO_THINKING, true);
						this.ctx.statusLine.invalidate();
						this.ctx.updateEditorBorderColor();
						this.ctx.showStatus(`Temporary model: ${modelSelector ?? model.id}`);
						this.#closeActiveMvuRoute();
						return;
					}

					if (role === "default") {
						await this.ctx.session.setModelExplicitRuntime(model, role, {
							selector: modelSelector,
							thinkingLevel: concreteThinking,
						});
						if (isAuto) this.ctx.session.setThinkingLevel(AUTO_THINKING, true);
						this.ctx.statusLine.invalidate();
						this.ctx.updateEditorBorderColor();
						this.ctx.showStatus(`Default model: ${modelSelector ?? model.id}`);
						return;
					}

					const runtimeSelector = formatModelSelectorValue(
						modelSelector ?? `${model.provider}/${model.id}`,
						concreteThinking,
					);
					const previousRole = this.ctx.settings.resolveModelRole(role);
					const persistGlobally =
						previousRole.winningLayer !== "config_overlay" &&
						previousRole.winningLayer !== "project" &&
						!previousRole.shadowedCandidates.some(
							candidate => candidate.layer === "config_overlay" || candidate.layer === "project",
						);
					if (persistGlobally) this.ctx.settings.assertModelRoleWritable(role);

					this.ctx.settings.setRuntimeModelRole(role, runtimeSelector);
					try {
						if (persistGlobally) this.ctx.settings.setModelRole(role, runtimeSelector);
					} catch (error) {
						if (
							previousRole.winningLayer === "runtime_override" &&
							previousRole.effectiveSelector !== undefined
						) {
							this.ctx.settings.setRuntimeModelRole(role, previousRole.effectiveSelector);
						} else {
							this.ctx.settings.clearRuntimeModelRole(role);
						}
						throw error;
					}

					if (isAuto) this.ctx.session.setThinkingLevel(AUTO_THINKING, true);
					const roleInfo = getRoleInfo(role, this.ctx.settings);
					this.ctx.showStatus(`${roleInfo.name} model: ${modelSelector ?? model.id}`);
				} catch (error) {
					this.ctx.showError(error instanceof Error ? error.message : String(error));
				}
			},
			() => this.#closeActiveMvuRoute(),
			{ ...options, currentContextTokens },
		);
		this.#mountMvuEditor(selector.mountSpec);
	}

	async showPluginSelector(mode: "install" | "uninstall" = "install"): Promise<void> {
		const mgr = new MarketplaceManager({
			marketplacesRegistryPath: getMarketplacesRegistryPath(),
			installedRegistryPath: getInstalledPluginsRegistryPath(),
			projectInstalledRegistryPath: (await resolveActiveProjectRegistryPath(getProjectDir())) ?? undefined,
			marketplacesCacheDir: getMarketplacesCacheDir(),
			pluginsCacheDir: getPluginsCacheDir(),
			clearPluginRootsCache: clearPluginRootsAndCaches,
		});

		const [marketplaces, installed] = await Promise.all([mgr.listMarketplaces(), mgr.listInstalledPlugins()]);
		const installedIds = new Set(installed.map(p => p.id));

		if (mode === "uninstall") {
			// Show only installed plugins for uninstall
			const items = installed.map(p => {
				const entry = p.entries[0];
				const atIdx = p.id.lastIndexOf("@");
				const pluginName = atIdx > 0 ? p.id.slice(0, atIdx) : p.id;
				const mkt = atIdx > 0 ? p.id.slice(atIdx + 1) : "unknown";
				return {
					plugin: { name: pluginName, version: entry?.version, description: undefined as string | undefined },
					marketplace: mkt,
					scope: p.scope,
				};
			});
			const uninstall = async (name: string, marketplace: string, scope: "user" | "project"): Promise<void> => {
				const pluginId = `${name}@${marketplace}`;
				this.ctx.showStatus(`Uninstalling ${pluginId}...`);
				try {
					await mgr.uninstallPlugin(pluginId, scope);
					this.ctx.showStatus(`Uninstalled ${pluginId}`);
				} catch (err) {
					this.ctx.showStatus(`Uninstall failed: ${err}`);
				}
				this.ctx.ui.requestRender();
			};
			const selector = new PluginSelectorComponent(marketplaces.length, items, new Set(), {
				onSelect: (name, marketplace, scope) => {
					if (scope === undefined) return;
					this.#closeActiveMvuRoute(() => void uninstall(name, marketplace, scope));
				},
				onCancel: () => this.#closeActiveMvuRoute(),
			});
			this.#mountMvuEditor(selector.mountSpec);
			return;
		}

		// Install mode: show all available plugins from all marketplaces
		const allPlugins: Array<{
			plugin: { name: string; version?: string; description?: string };
			marketplace: string;
		}> = [];
		for (const mkt of marketplaces) {
			const plugins = await mgr.listAvailablePlugins(mkt.name);
			for (const plugin of plugins) {
				allPlugins.push({ plugin, marketplace: mkt.name });
			}
		}

		const install = async (name: string, marketplace: string): Promise<void> => {
			this.ctx.showStatus(`Installing ${name} from ${marketplace}...`);
			try {
				const force = installedIds.has(`${name}@${marketplace}`);
				await mgr.installPlugin(name, marketplace, { force });
				this.ctx.showStatus(`Installed ${name} from ${marketplace}`);
			} catch (err) {
				this.ctx.showStatus(`Install failed: ${err}`);
			}
			this.ctx.ui.requestRender();
		};
		const selector = new PluginSelectorComponent(marketplaces.length, allPlugins, installedIds, {
			onSelect: (name, marketplace) => {
				this.#closeActiveMvuRoute(() => void install(name, marketplace));
			},
			onCancel: () => this.#closeActiveMvuRoute(),
		});
		this.#mountMvuEditor(selector.mountSpec);
	}

	showUserMessageSelector(): void {
		const userMessages = this.ctx.session.getUserMessagesForBranching();
		if (userMessages.length === 0) {
			this.ctx.showStatus("No messages to branch from");
			return;
		}
		const selector = new UserMessageSelectorComponent(
			userMessages.map(message => ({ id: message.entryId, text: message.text })),
			async entryId => {
				const result = await this.ctx.session.branch(entryId);
				this.#closeActiveMvuRoute(() => {
					if (result.cancelled) return;
					this.ctx.chatContainer.clear();
					this.ctx.renderInitialMessages({ clearTerminalHistory: true });
					this.ctx.editor.setText(result.selectedText);
					this.ctx.showStatus("Branched to new session");
				});
			},
			() => this.#closeActiveMvuRoute(),
		);
		this.#mountMvuEditor(selector.mountSpec);
	}

	showCopySelector(): void {
		const targets = buildCopyTargets(this.ctx.session);
		if (targets.length === 0) {
			this.ctx.showStatus("Nothing to copy yet.");
			return;
		}
		const spec = createCopySelectorRoute(targets);
		const viewport = (model: CopySelectorModel) => ({
			offset: model.tree.viewportOffset,
			height: Math.max(1, this.ctx.ui.terminal.rows - 5),
		});
		spec.focusedRoot.apply(viewCopySelector(spec.initialModel, viewport(spec.initialModel)));
		const mountSpec: MvuMountSpec<CopySelectorModel, CopyRouteCommand> = {
			componentId: spec.componentId,
			component: spec.focusedRoot,
			initialModel: spec.initialModel,
			route: {
				componentId: spec.componentId,
				focusedRoot: spec.focusedRoot,
				context: spec.context,
				actionToMsg: (action, event) =>
					spec.actionToMsg(action, event) === undefined ? undefined : { _tag: "MvuInput", action, event },
			},
			update: (model, envelope) => {
				const message = spec.actionToMsg(envelope.action, envelope.event);
				if (message === undefined) return { model, commands: [], dirtyKeys: new Set() };
				const transition = updateCopySelector(model, message);
				return {
					model: transition.model,
					commands: [
						...transition.commands,
						{ _tag: "RenderCopy", model: transition.model, dirtyKeys: transition.dirtyKeys },
					],
					dirtyKeys: transition.dirtyKeys,
				};
			},
			interpret: command =>
				Effect.sync(() => {
					if (command._tag === "RenderCopy") {
						spec.focusedRoot.apply(viewCopySelector(command.model, viewport(command.model), command.dirtyKeys));
						this.ctx.ui.requestComponentRender(spec.focusedRoot);
					} else if (command._tag === "CopyRequested") {
						this.#closeActiveMvuRoute(() => {
							if (command.target.content === undefined) return;
							void copyToClipboard(command.target.content);
							this.ctx.showStatus(command.target.copyMessage ?? "Copied to clipboard");
						});
					} else if (command._tag === "CloseRequested") {
						this.#closeActiveMvuRoute();
					}
					return [];
				}),
		};
		this.#mountMvuOverlay(
			mountSpec,
			{ anchor: "bottom-center", width: "100%", maxHeight: "100%", margin: 0 },
			() => this.ctx.ui.setFocus(this.ctx.editor),
		);
	}

	showTreeSelector(): void {
		const tree = this.ctx.sessionManager.getTree();
		const realLeafId = this.ctx.sessionManager.getLeafId();
		if (tree.length === 0) {
			this.ctx.showStatus("No entries in session");
			return;
		}
		const spec = createSessionTreeRoute(
			tree,
			realLeafId,
			settings.get("treeFilterMode"),
			0,
			settings.get("branchSummary.enabled"),
		);
		const viewport = (model: SessionTreeModel) => ({
			offset: model.tree.viewportOffset,
			height: Math.max(1, this.ctx.ui.terminal.rows - 4),
		});
		spec.focusedRoot.apply(viewSessionTree(spec.initialModel, viewport(spec.initialModel)));
		const mountSpec: MvuMountSpec<SessionTreeModel, SessionTreeRouteCommand, SessionTreeRuntimeMessage> = {
			componentId: spec.componentId,
			component: spec.focusedRoot,
			initialModel: spec.initialModel,
			route: {
				componentId: spec.componentId,
				focusedRoot: spec.focusedRoot,
				context: spec.context,
				actionToMsg: (action, event) =>
					spec.actionToMsg(action, event) === undefined ? undefined : { _tag: "MvuInput", action, event },
			},
			boundary: {
				messageSchema: SESSION_TREE_RUNTIME_MESSAGE_SCHEMA,
				currentStamp: model => ({
					componentId: spec.componentId,
					leaseGeneration: model.leaseGeneration ?? 0,
					sourceRevision: model.tree.sourceRevision,
					requestGeneration: model.requestGeneration,
				}),
			},
			update: (model, runtimeMessage) => {
				const stampedModel =
					runtimeMessage._tag === "MvuInput" && runtimeMessage.stamp !== undefined && model.leaseGeneration === undefined
						? { ...model, leaseGeneration: runtimeMessage.stamp.leaseGeneration }
						: model;
				const mappedMessage =
					runtimeMessage._tag === "NavigationSettled"
						? runtimeMessage
						: sessionTreeActionToMsg(String(runtimeMessage.action), runtimeMessage.event, stampedModel);
				if (mappedMessage === undefined) return { model: stampedModel, commands: [], dirtyKeys: new Set() };
				const transition = updateSessionTree(stampedModel, mappedMessage);
				return {
					model: transition.model,
					commands: [
						{ _tag: "RenderSessionTree", model: transition.model, dirtyKeys: transition.dirtyKeys },
						...transition.commands,
					],
					dirtyKeys: transition.dirtyKeys,
				};
			},
			interpret: command => {
				if (command._tag === "NavigateRequested") {
					const stamp = {
						componentId: spec.componentId,
						leaseGeneration: command.leaseGeneration,
						sourceRevision: command.sourceRevision,
						requestGeneration: command.requestGeneration,
					};
					return Effect.promise(async () => {
						try {
							const result = await this.ctx.session.navigateTree(command.targetId, {
								summarize: command.summarize,
								customInstructions: command.customInstructions,
							});
							const settled: SessionTreeNavigationSettled = {
								_tag: "NavigationSettled",
								targetId: command.targetId,
								requestGeneration: command.requestGeneration,
								sourceRevision: command.sourceRevision,
								leaseGeneration: command.leaseGeneration,
								status: result.aborted ? "aborted" : result.cancelled ? "cancelled" : "success",
								...(result.editorText === undefined ? {} : { editorText: result.editorText }),
							};
							return [{ _tag: "MvuSource", stamp, message: settled } satisfies SourceEnvelope<SessionTreeRuntimeMessage>];
						} catch (error) {
							const settled: SessionTreeNavigationSettled = {
								_tag: "NavigationSettled",
								targetId: command.targetId,
								requestGeneration: command.requestGeneration,
								sourceRevision: command.sourceRevision,
								leaseGeneration: command.leaseGeneration,
								status: "failed",
								error: error instanceof Error ? error.message : String(error),
							};
							return [{ _tag: "MvuSource", stamp, message: settled } satisfies SourceEnvelope<SessionTreeRuntimeMessage>];
						}
					});
				}
				return Effect.sync(() => {
					if (command._tag === "RenderSessionTree") {
						spec.focusedRoot.apply(viewSessionTree(command.model, viewport(command.model), command.dirtyKeys));
						this.ctx.ui.requestComponentRender(spec.focusedRoot);
					} else if (command._tag === "AbortNavigation") {
						this.ctx.session.abortBranchSummary();
					} else if (command._tag === "NavigationCompleted") {
						if (command.status === "success") {
							this.#closeActiveMvuRoute(() => {
								this.ctx.chatContainer.clear();
								this.ctx.renderInitialMessages({ clearTerminalHistory: true });
								void this.ctx.reloadTodos();
								if (command.editorText && !this.ctx.editor.getText().trim()) this.ctx.editor.setText(command.editorText);
								this.ctx.showStatus("Navigated to selected point");
							});
						} else if (command.status === "aborted") {
							this.ctx.showStatus("Branch summarization cancelled");
						} else if (command.status === "cancelled") {
							this.ctx.showStatus("Navigation cancelled");
						} else if (command.error !== undefined) {
							this.ctx.showError(command.error);
						}
					} else if (command._tag === "LabelCommitted") {
						this.ctx.sessionManager.appendLabelChange(command.id, command.label);
						this.ctx.ui.requestRender();
					} else if (command._tag === "CloseRequested") {
						this.#closeActiveMvuRoute();
					}
					return [];
				});
			},
		};
		this.#mountMvuEditor(mountSpec);
	}

	async showSessionSelector(): Promise<void> {
		const sessions = await SessionManager.list(
			this.ctx.sessionManager.getCwd(),
			this.ctx.sessionManager.getSessionDir(),
		);
		// Current folder has no sessions: preload the global list so the picker
		// can open straight into all-projects scope instead of dead-ending.
		let allSessions: SessionInfo[] | undefined;
		let startInAllScope = false;
		if (sessions.length === 0) {
			allSessions = await SessionManager.listAll();
			startInAllScope = allSessions.length > 0;
		}
		const historyStorage = this.ctx.historyStorage;
		const historyMatcher = historyStorage ? (query: string) => historyStorage.matchingSessionIds(query) : undefined;
		const selector = new SessionSelectorComponent(
			sessions,
			(session: SessionInfo) => {
				this.#closeActiveMvuRoute(() => void this.handleResumeSession(session.path));
			},
			() => this.#closeActiveMvuRoute(),
			() => {
				void this.ctx.shutdown();
			},
			{
				onDelete: async (session: SessionInfo) => {
					if (!(await this.#detachActiveSessionBeforeDeletion(session.path))) return false;
					const storage = new FileSessionStorage();
					try {
						await storage.deleteSessionWithArtifacts(session.path);
						return true;
					} catch (err) {
						throw new Error(`Failed to delete session: ${err instanceof Error ? err.message : String(err)}`, {
							cause: err,
						});
					}
				},
				historyMatcher,
				loadAllSessions: () => SessionManager.listAll(),
				allSessions,
				startInAllScope,
				getTerminalRows: () => this.ctx.ui.terminal.rows,
			},
		);
		selector.setOnRequestRender(() => this.ctx.ui.requestComponentRender(selector.mountSpec.component));
		this.#mountMvuEditor(selector.mountSpec);
	}

	#refreshSessionTerminalTitle(): void {
		const sessionManager = this.ctx.sessionManager as {
			getSessionName?: () => string | undefined;
			getCwd: () => string;
			titleSource?: "auto" | "user" | undefined;
		};
		setSessionTerminalTitle(sessionManager.getSessionName?.(), sessionManager.getCwd());
	}

	async #detachActiveSessionBeforeDeletion(sessionPath: string): Promise<boolean> {
		const currentSessionFile = this.ctx.sessionManager.getSessionFile();
		if (currentSessionFile !== sessionPath) {
			return true;
		}

		const detached = await this.ctx.session.newSession();
		if (!detached) {
			return false;
		}
		this.#refreshSessionTerminalTitle();

		this.ctx.clearTransientSessionUi();
		this.ctx.statusLine.invalidate();
		this.ctx.statusLine.setSessionStartTime(Date.now());
		this.ctx.updateEditorTopBorder();
		this.ctx.updateEditorBorderColor();
		this.ctx.renderInitialMessages({ clearTerminalHistory: true });
		await this.ctx.reloadTodos();
		this.ctx.ui.requestRender(true, { clearScrollback: true });
		return true;
	}

	async handleResumeSession(sessionPath: string): Promise<void> {
		this.ctx.clearTransientSessionUi();

		const previousCwd = this.ctx.sessionManager.getCwd();
		// Switch session via AgentSession (emits hook and tool session events). The
		// SessionManager adopts the resumed session's own cwd when it differs.
		await this.ctx.session.switchSession(sessionPath);
		const newCwd = this.ctx.sessionManager.getCwd();
		const movedProject = normalizePathForComparison(newCwd) !== normalizePathForComparison(previousCwd);
		if (movedProject) {
			// Resumed a session from another project: re-point the process and every
			// cwd-derived cache at it before rendering.
			await this.ctx.applyCwdChange(newCwd);
		}
		this.#refreshSessionTerminalTitle();
		this.ctx.updateEditorBorderColor();

		// Clear and re-render the chat
		this.ctx.chatContainer.clear();
		this.ctx.renderInitialMessages({ clearTerminalHistory: true });
		await this.ctx.reloadTodos();
		this.ctx.showStatus(movedProject ? `Resumed session in ${shortenPath(newCwd)}` : "Resumed session");
	}

	async handleSessionDeleteCommand(): Promise<void> {
		const sessionFile = this.ctx.sessionManager.getSessionFile();
		if (!sessionFile) {
			this.ctx.showError("No session file to delete (in-memory session)");
			return;
		}

		// Check if session file exists (may not exist for brand new sessions)
		const storage = new FileSessionStorage();
		const fileExists = await storage.exists(sessionFile);
		if (!fileExists) {
			this.ctx.showError("Session has not been saved yet");
			return;
		}

		const confirmed = await this.ctx.showHookConfirm(
			"Delete Session",
			"This will permanently delete the current session.\nYou will be returned to the session selector.",
		);

		if (!confirmed) {
			this.ctx.showStatus("Delete cancelled");
			return;
		}

		if (!(await this.#detachActiveSessionBeforeDeletion(sessionFile))) {
			this.ctx.showStatus("Delete cancelled");
			return;
		}

		// Delete the session file and artifacts directory
		await storage.deleteSessionWithArtifacts(sessionFile);

		// Show session selector
		this.ctx.showStatus("Session deleted");
		await this.showSessionSelector();
	}

	async #handleOAuthLogin(providerId: string): Promise<void> {
		this.ctx.showStatus(`Logging in to ${providerId}…`);
		const manualInput = this.ctx.oauthManualInput;
		const useManualInput = PASTE_CODE_LOGIN_PROVIDERS.has(providerId);
		try {
			await this.ctx.session.modelRegistry.authStorage.login(providerId as OAuthProvider, {
				onAuth: (info: { url: string; instructions?: string }) => {
					const block = new TranscriptBlock();
					block.addChild(new Text(theme.fg("dim", info.url), 1, 0));
					const hyperlink = `\x1b]8;;${info.url}\x07Click here to login\x1b]8;;\x07`;
					block.addChild(new Text(theme.fg("accent", hyperlink), 1, 0));
					if (info.instructions) {
						block.addChild(new Spacer(1));
						block.addChild(new Text(theme.fg("warning", info.instructions), 1, 0));
					}
					if (useManualInput) {
						block.addChild(new Spacer(1));
						block.addChild(new Text(theme.fg("dim", MANUAL_LOGIN_TIP), 1, 0));
					}
					this.ctx.present(block);
					this.ctx.openInBrowser(info.url);
				},
				onPrompt: async (prompt: { message: string; placeholder?: string }) => {
					const promptBlock = new TranscriptBlock();
					promptBlock.addChild(new Text(theme.fg("warning", prompt.message), 1, 0));
					if (prompt.placeholder) {
						promptBlock.addChild(new Text(theme.fg("dim", prompt.placeholder), 1, 0));
					}
					this.ctx.present(promptBlock);
					const { promise, resolve } = Promise.withResolvers<string>();
					const codeInput = new Input();
					codeInput.onSubmit = () => {
						const code = codeInput.getValue();
						this.ctx.editorContainer.clear();
						this.ctx.editorContainer.addChild(this.ctx.editor);
						this.ctx.ui.setFocus(this.ctx.editor);
						resolve(code);
					};
					this.ctx.editorContainer.clear();
					this.ctx.editorContainer.addChild(codeInput);
					this.ctx.ui.setFocus(codeInput);
					this.ctx.ui.requestRender();
					return promise;
				},
				onProgress: (message: string) => {
					this.ctx.present(new Text(theme.fg("dim", message), 1, 0));
				},
				onManualCodeInput: useManualInput ? () => manualInput.waitForInput(providerId) : undefined,
			});
			await this.ctx.session.modelRegistry.refresh();
			const block = new TranscriptBlock();
			block.addChild(
				new Text(theme.fg("success", `${theme.status.success} Successfully logged in to ${providerId}`), 1, 0),
			);
			block.addChild(new Text(theme.fg("dim", `Credentials saved to ${getAgentDbPath()}`), 1, 0));
			this.ctx.present(block);
		} catch (error: unknown) {
			this.ctx.showError(`Login failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			if (useManualInput) {
				manualInput.clear(`Manual OAuth input cleared for ${providerId}`);
			}
		}
	}

	async #handleCredentialLogout(providerId: string, account: LogoutAccount): Promise<void> {
		try {
			const authStorage = this.ctx.session.modelRegistry.authStorage;
			const removed = await authStorage.removeCredential(providerId, account.credentialId);
			if (!removed) {
				this.ctx.showError(`Logout skipped: ${account.label} is no longer stored for ${providerId}.`);
				return;
			}

			await this.ctx.session.modelRegistry.refresh();
			const block = new TranscriptBlock();
			block.addChild(
				new Text(
					theme.fg(
						"success",
						`${theme.status.success} Successfully logged out ${account.label} from ${providerId}`,
					),
					1,
					0,
				),
			);
			block.addChild(new Text(theme.fg("dim", `Credential removed from ${getAgentDbPath()}`), 1, 0));
			const remainingSource = authStorage.describeCredentialSource(providerId, this.ctx.session.sessionId);
			if (remainingSource) {
				block.addChild(
					new Text(theme.fg("warning", `${providerId} is still authenticated via ${remainingSource}`), 1, 0),
				);
			}
			this.ctx.present(block);
		} catch (error: unknown) {
			this.ctx.showError(`Logout failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async #showOAuthLogoutAccountSelector(providerId: string): Promise<void> {
		const authStorage = this.ctx.session.modelRegistry.authStorage;
		try {
			await authStorage.reload();
		} catch (error: unknown) {
			this.ctx.showError(
				`Could not load stored credentials: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}
		const provider = getOAuthProviders().find(candidate => candidate.id === providerId);
		const accounts = toLogoutAccounts(providerId, authStorage.listStoredCredentials(providerId), {
			activeIdentity: authStorage.getOAuthAccountIdentity(providerId, this.ctx.session.sessionId),
			activeApiKey: authStorage.getCredentialOrigin(providerId)?.kind === "api_key",
		});
		if (accounts.length === 0) {
			const source = authStorage.describeCredentialSource(providerId, this.ctx.session.sessionId);
			const suffix = source ? ` Current auth comes from ${source}; remove that source to log out.` : "";
			this.ctx.showError(`Logout skipped: no stored credentials for ${providerId}.${suffix}`);
			return;
		}

		const adapter = makeLogoutAccountSelectorAdapter({
			providerName: provider?.name ?? providerId,
			accounts,
		});
		this.#mountLogoutRoute(providerId, provider?.name ?? providerId, adapter);
	}

	async showOAuthSelector(mode: "login" | "logout", providerId?: string): Promise<void> {
		if (providerId) {
			if (mode === "login") {
				await this.#handleOAuthLogin(providerId);
			} else {
				await this.#showOAuthLogoutAccountSelector(providerId);
			}
			return;
		}

		if (mode === "logout") {
			await this.#refreshOAuthProviderAuthState();
			const oauthProviders = getOAuthProviders();
			const loggedInProviders = oauthProviders.filter(provider =>
				this.ctx.session.modelRegistry.authStorage.has(provider.id),
			);
			if (loggedInProviders.length === 0) {
				this.ctx.showStatus("No stored provider credentials to log out. Remove env or config auth at its source.");
				return;
			}
		}

		const adapter = makeOAuthSelectorAdapter({
			mode,
			providers: getOAuthProviders(),
			authStorage: this.ctx.session.modelRegistry.authStorage,
		});
		this.#mountOAuthRoute(mode, adapter);
	}

	async showResetUsageSelector(): Promise<void> {
		const session = this.ctx.session;
		this.ctx.showStatus("Checking saved rate-limit resets…", { dim: true });
		let statuses: Awaited<ReturnType<typeof session.listResetCredits>>;
		try {
			statuses = await session.listResetCredits();
		} catch (error) {
			this.ctx.showError(`Could not load saved resets: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		const accounts = toResetUsageAccounts(statuses);
		if (accounts.length === 0) {
			this.ctx.showStatus("No Codex accounts found. Use /login to add one.");
			return;
		}
		if (!accounts.some(account => account.availableCount > 0)) {
			this.ctx.showStatus(
				accounts.some(account => account.error)
					? "No saved resets available — some accounts couldn't be reached (try /login)."
					: "No saved rate-limit resets available to spend right now.",
			);
			return;
		}
		const mountGeneration = ++this.#resetUsageMountGeneration;
		this.#mountResetRoute(makeResetUsageSelectorAdapter({
			accounts,
			sessionGeneration: String(session.sessionId),
			mountGeneration,
			sourceRevision: mountGeneration,
		}));
	}

	#reportResetOutcome(account: ResetUsageAccount, outcome: ResetCreditRedeemOutcome): void {
		const message = describeRedeemOutcome(outcome, account.label);
		if (outcome.ok) {
			this.ctx.showStatus(message);
			this.ctx.statusLine.invalidate();
			this.ctx.ui.requestRender();
		} else {
			this.ctx.showWarning(message);
		}
	}

	async showDebugSelector(): Promise<void> {
		const { DebugSelectorComponent } = await import("../../debug");
		this.showSelector(done => {
			const selector = new DebugSelectorComponent(this.ctx, done);
			return { component: selector, focus: selector };
		});
	}

	#parseBookmarkArgs(args: readonly string[]): { tag?: string; note?: string } {
		const tagParts: string[] = [];
		let note: string | undefined;
		for (let index = 0; index < args.length; index++) {
			const arg = args[index]!;
			if (arg === "--note") {
				note =
					args
						.slice(index + 1)
						.join(" ")
						.trim() || undefined;
				break;
			}
			if (arg.startsWith("--note=")) {
				note = arg.slice("--note=".length).trim() || undefined;
				continue;
			}
			tagParts.push(arg);
		}
		const tag = tagParts.join(" ").trim();
		return { ...(tag ? { tag } : {}), ...(note ? { note } : {}) };
	}

	async bookmarkCurrent(args: readonly string[]): Promise<void> {
		const target =
			this.#activeHub?.getSelectedBookmarkTarget() ??
			(() => {
				const sessionId = this.ctx.sessionManager.getSessionId();
				const title =
					this.ctx.viewSession.sessionManager.getSessionName() ??
					this.ctx.viewSession.sessionManager.getHeader()?.title ??
					sessionId;
				const agentId = this.ctx.focusedAgentId;
				return agentId
					? ({ kind: "agent", sessionId, agentId, title } satisfies BookmarkTarget)
					: ({ kind: "session", sessionId, title } satisfies BookmarkTarget);
			})();
		const { tag, note } = this.#parseBookmarkArgs(args);
		try {
			const record = await this.#bookmarks.upsert({
				target,
				cwd: this.ctx.sessionManager.getCwd(),
				tag,
				note,
			});
			this.ctx.showStatus(`Bookmarked ${record.target.title}${record.tag ? ` [${record.tag}]` : ""}`);
		} catch (error) {
			this.ctx.showError(`Bookmark failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	showBookmarks(): void {
		void this.#bookmarks.list().then(
			entries => {
				const dismiss = () => this.#closeActiveMvuRoute();
				const jump = (record: BookmarkRecord) => {
					this.#closeActiveMvuRoute(() => {
						if (!this.#activeHub) {
							this.ctx.showAgentHub({
								initialAgentId: record.target.kind === "agent" ? record.target.agentId : undefined,
							});
						}
						if (!this.#activeHub?.selectBookmarkTarget(record.target)) {
							this.ctx.showStatus(`Bookmark target unavailable: ${record.target.title}`);
						}
					});
				};
				const selector = new BookmarksSelectorComponent(entries, jump, dismiss);
				this.#mountMvuOverlay(
					selector.mountSpec,
					{ anchor: "bottom-center", width: "100%", maxHeight: "50%", margin: 0 },
					() => this.ctx.ui.setFocus(this.ctx.editor),
				);
			},
			error =>
				this.ctx.showError(`Could not read bookmarks: ${error instanceof Error ? error.message : String(error)}`),
		);
	}

	showAgentHub(
		observers: SessionObserverRegistry,
		options?: { requireContent?: boolean; initialAgentId?: string; openPreview?: boolean },
	): void {
		const hubKeys = [
			...this.ctx.keybindings.getKeys("app.agents.hub"),
			...this.ctx.keybindings.getKeys("app.session.observe"),
		];
		let hub: AgentHubOverlayComponent | undefined;

		const done = () => {
			const selection = hub?.getSelectedSelection();
			if (selection) this.#lastHubSelection = selection;
			if (this.#activeHub === hub) {
				this.#activeHub = undefined;
			}
			this.#closeActiveMvuRoute();
		};

		const registry = AgentRegistry.global();
		const ctx = this.ctx;
		const transcriptDisplay: TranscriptDisplayContext = {
			get transcriptWrap() {
				return ctx.transcriptWrap;
			},
			get richTranscript() {
				return ctx.richTranscript;
			},
		};
		hub = new AgentHubOverlayComponent({
			observers,
			hubKeys,
			expandKeys: this.ctx.keybindings.getKeys("app.tools.expand"),
			interruptKeys: this.ctx.keybindings.getKeys("app.interrupt"),
			unfocusSession: () => this.ctx.unfocusSession(),
			onDone: done,
			requestRender: () => this.ctx.ui.requestRender(),
			height: () => this.ctx.ui.terminal?.rows ?? process.stdout.rows ?? 40,
			registry,
			turnStatus: (agentId: string) => getAgentHubTurnStatus(registry, agentId),
			transcriptDisplay,
			rollout: createAgentHubRolloutDataSource(),
			ui: this.ctx.ui,
			getTool: name => this.ctx.session.getToolByName(name),
			initialAgentId: options?.initialAgentId ?? this.ctx.focusedAgentId,
			initialSelection: options?.initialAgentId || this.ctx.focusedAgentId ? undefined : this.#lastHubSelection,
			cwd: this.ctx.sessionManager.getCwd(),
			hideThinkingBlock: () => this.ctx.hideThinkingBlock,
			focusAgent: id => this.ctx.focusAgentHubInput(id),
			openErrors: () => {
				done();
				this.ctx.handleErrorsCommand();
			},
			openBookmarks: () => {
				done();
				this.showBookmarks();
			},
			sessionId: this.ctx.sessionManager.getSessionId(),
			attention: this.#attention,
			parentSessionFile: this.ctx.sessionManager.getSessionFile(),
		});
		// requireContent stays inert without live or revivable children; explicit
		// hub/observe keys may still open the empty roster.
		if (options?.requireContent && hub.isEmpty) {
			hub.dispose();
			return;
		}
		if (options?.openPreview && options.initialAgentId) hub.openChat(options.initialAgentId);
		this.#activeHub = hub;
		const spec = createAgentHubMvuMountSpec(hub);
		this.#mountMvuOverlay(
			spec,
			{ anchor: "bottom-center", width: "100%", maxHeight: "100%", margin: 0, fullscreen: true },
			() => this.ctx.ui.setFocus(this.ctx.editor),
		);
	}
}
