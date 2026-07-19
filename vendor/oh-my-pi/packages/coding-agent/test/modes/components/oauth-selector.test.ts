import * as Effect from "effect/Effect";
import { beforeAll, describe, expect, it } from "bun:test";
import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { MVU_KEYMAP_TABLES } from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import {
	makeOAuthProviderId,
	makeOAuthSelectorAdapter,
	oauthSelectorOutput,
	OAuthSelectorComponent,
	type OAuthSelectorAdapter,
	type OAuthSelectorModel,
	type OAuthSelectorMsg,
	type OAuthSelectorOutput,
} from "@oh-my-pi/pi-coding-agent/modes/components/oauth-selector";
import { selectorActionToMsg } from "@oh-my-pi/pi-coding-agent/modes/components/selector-adapter";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";

beforeAll(async () => {
	await initTheme();
});

type OAuthAuthStorage = Pick<AuthStorage, "has" | "hasAuth" | "getCredentialOrigin">;

interface OAuthRoute {
	readonly component: OAuthSelectorComponent;
	readonly outputs: OAuthSelectorOutput[];
	readonly model: () => OAuthSelectorModel;
	readonly dispatch: (sequence: string) => void;
	readonly commit: (message: OAuthSelectorMsg) => void;
}

function makeOAuthRoute(mode: "login" | "logout", adapter: OAuthSelectorAdapter): OAuthRoute {
	const component = new OAuthSelectorComponent(mode, adapter);
	const input = makeTerminalInputAdapter();
	const registry = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, KeybindingsManager.inMemory()));
	const outputs: OAuthSelectorOutput[] = [];
	let model = adapter.initialModel;

	const commit = (message: OAuthSelectorMsg): void => {
		const transition = adapter.update(model, message);
		model = transition.model;
		component.apply(model);
		for (const command of transition.commands) {
			const output = oauthSelectorOutput(command, adapter);
			if (output !== undefined) outputs.push(output);
		}
	};

	return {
		component,
		outputs,
		model: () => model,
		commit,
		dispatch: sequence => {
			const event = input.decode(sequence);
			if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) {
				throw new Error(`Expected a decoded key event for ${JSON.stringify(sequence)}`);
			}
			const action = registry.resolve(
				{
					contexts: ["selector.global", "selector.filter", `selector.oauth.${mode}`],
					mode: model.mode._tag,
					focus: "list",
					capabilities: adapter.selector.capabilities,
				},
				event.key,
			);
			if (action === undefined) throw new Error(`Unmapped OAuth key ${JSON.stringify(sequence)}`);

			let message: OAuthSelectorMsg | undefined;
			if (action === "tui.select.confirm" && model.mode._tag !== "Confirm" && model.selectedId !== undefined) {
				const activation = adapter.selector.activate(model.selectedId, model);
				message = activation._tag === "Command" ? { _tag: "DirectActivate", action: activation.action } : undefined;
			} else {
				message = selectorActionToMsg(action, event, model, adapter.componentId);
			}
			if (message !== undefined) commit(message);
		},
	};
}

function selectedProviders(outputs: readonly OAuthSelectorOutput[]): readonly string[] {
	return outputs.flatMap(output => output._tag === "OAuthProviderSelected" ? [output.providerId] : []);
}

function render(component: OAuthSelectorComponent): string {
	return component
		.render(80)
		.map(line => Bun.stripANSI(line))
		.join("\n");
}

describe("OAuthSelectorComponent", () => {
	it("fuzzy-filters overflowing provider lists from typed input", () => {
		const providers = getOAuthProviders();
		expect(providers.length).toBeGreaterThan(10);
		const target =
			providers.find(provider => provider.available && provider.id === "vllm") ??
			providers.find(provider => provider.available) ??
			providers[0];
		expect(target).toBeDefined();
		if (!target) return;

		const authStorage: OAuthAuthStorage = {
			has: () => false,
			hasAuth: () => false,
			getCredentialOrigin: () => undefined,
		};
		const adapter = makeOAuthSelectorAdapter({ mode: "login", providers, authStorage });
		const route = makeOAuthRoute("login", adapter);

		for (const char of target.id) route.dispatch(char);

		expect(render(route.component)).toContain(target.name);
		expect(render(route.component)).toContain(`Search: ${target.id}`);

		route.dispatch("\n");
		expect(selectedProviders(route.outputs)).toEqual([target.id]);
	});

	it("uses route Back to leave filtering before closing the renderer", () => {
		const adapter = makeOAuthSelectorAdapter({
			mode: "login",
			providers: getOAuthProviders(),
			authStorage: { has: () => false, hasAuth: () => false, getCredentialOrigin: () => undefined },
		});
		const route = makeOAuthRoute("login", adapter);

		route.dispatch("/");
		expect(route.model().mode._tag).toBe("Filter");
		route.dispatch("\x1b");
		expect(route.model().mode._tag).toBe("Browse");
		expect(route.outputs).toEqual([]);
		route.dispatch("\x1b");
		expect(route.outputs).toEqual([{ _tag: "OAuthSelectorClosed" }]);
	});

	it("does not offer env-only providers as logout targets", () => {
		const adapter = makeOAuthSelectorAdapter({
			mode: "logout",
			providers: getOAuthProviders(),
			authStorage: {
				has: () => false,
				hasAuth: providerId => providerId === "opencode-go" || providerId === "opencode-zen",
				getCredentialOrigin: () => undefined,
			},
		});
		const route = makeOAuthRoute("logout", adapter);

		expect(adapter.items.has(makeOAuthProviderId("opencode-go"))).toBe(false);
		expect(render(route.component)).toContain("No matching providers");
		route.dispatch("\n");
		expect(route.outputs).toEqual([]);
	});

	it("offers stored providers as logout targets and renders validation state", () => {
		const adapter = makeOAuthSelectorAdapter({
			mode: "logout",
			providers: getOAuthProviders(),
			authStorage: {
				has: providerId => providerId === "opencode-go",
				hasAuth: providerId => providerId === "opencode-go",
				getCredentialOrigin: () => undefined,
			},
		});
		const route = makeOAuthRoute("logout", adapter);
		const providerId = makeOAuthProviderId("opencode-go");

		expect([...adapter.items.keys()]).toEqual([providerId]);
		route.commit({
			_tag: "OAuthValidationStarted",
			providerId,
			sourceRevision: adapter.sourceRevision,
			generation: 1,
		});
		expect(render(route.component)).toContain("checking");
		route.commit({
			_tag: "OAuthValidationSettled",
			providerId,
			sourceRevision: adapter.sourceRevision,
			generation: 1,
			state: "valid",
		});
		expect(render(route.component)).toContain("logged in");
		expect(render(route.component)).toContain("OpenCode Go");

		route.dispatch("\n");
		expect(selectedProviders(route.outputs)).toEqual(["opencode-go"]);
	});
});
