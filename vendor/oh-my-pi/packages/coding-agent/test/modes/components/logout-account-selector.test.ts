import * as Effect from "effect/Effect";
import { beforeAll, describe, expect, it } from "bun:test";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { MVU_KEYMAP_TABLES } from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import {
	logoutAccountSelectorOutput,
	LogoutAccountSelectorComponent,
	makeLogoutAccountId,
	makeLogoutAccountSelectorAdapter,
	type LogoutAccountAction,
	type LogoutAccountId,
	type LogoutAccountSelectorAdapter,
	type LogoutAccountSelectorOutput,
} from "@oh-my-pi/pi-coding-agent/modes/components/logout-account-selector";
import { selectorActionToMsg } from "@oh-my-pi/pi-coding-agent/modes/components/selector-adapter";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import type { SelectorModel, SelectorMsg } from "@oh-my-pi/pi-coding-agent/modes/mvu/selector";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { StoredAuthCredential } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { toLogoutAccounts } from "@oh-my-pi/pi-coding-agent/slash-commands/helpers/logout";

beforeAll(async () => {
	await initTheme();
});

interface LogoutRoute {
	readonly component: LogoutAccountSelectorComponent;
	readonly outputs: LogoutAccountSelectorOutput[];
	readonly model: () => SelectorModel<LogoutAccountId, LogoutAccountAction>;
	readonly dispatch: (sequence: string) => void;
}

function makeLogoutRoute(adapter: LogoutAccountSelectorAdapter): LogoutRoute {
	const component = new LogoutAccountSelectorComponent(adapter.providerName, adapter);
	const input = makeTerminalInputAdapter();
	const registry = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, KeybindingsManager.inMemory()));
	const outputs: LogoutAccountSelectorOutput[] = [];
	let model = adapter.initialModel;

	const commit = (message: SelectorMsg<LogoutAccountId, LogoutAccountAction>): void => {
		const transition = adapter.update(model, message);
		model = transition.model;
		component.apply(model);
		for (const command of transition.commands) {
			const output = logoutAccountSelectorOutput(command, adapter);
			if (output !== undefined) outputs.push(output);
		}
	};

	return {
		component,
		outputs,
		model: () => model,
		dispatch: sequence => {
			const event = input.decode(sequence);
			if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) {
				throw new Error(`Expected a decoded key event for ${JSON.stringify(sequence)}`);
			}
			const action = registry.resolve(
				{
					contexts: ["selector.global", "selector.logout-account"],
					mode: model.mode._tag,
					focus: "list",
					capabilities: adapter.selector.capabilities,
				},
				event.key,
			);
			if (action === undefined) throw new Error(`Unmapped logout key ${JSON.stringify(sequence)}`);

			let message: SelectorMsg<LogoutAccountId, LogoutAccountAction> | undefined;
			if (action === "tui.select.confirm" && model.selectedId !== undefined) {
				const selectedId = model.selectedId;
				const activation = adapter.selector.activate(selectedId, model);
				message = activation._tag === "Command" ? { _tag: "DirectActivate", action: activation.action } : undefined;
			} else {
				message = selectorActionToMsg(action, event, model, adapter.componentId);
			}
			if (message !== undefined) commit(message);
		},
	};
}

function render(component: LogoutAccountSelectorComponent): string {
	return component
		.render(100)
		.map(line => Bun.stripANSI(line))
		.join("\n");
}

describe("LogoutAccountSelectorComponent", () => {
	it("starts on the active stored account and selects that credential", () => {
		const rows: StoredAuthCredential[] = [
			{
				id: 11,
				provider: "anthropic",
				disabledCause: null,
				credential: {
					type: "oauth",
					access: "access-a",
					refresh: "refresh-a",
					expires: Date.now() + 60_000,
					email: "a@example.com",
					accountId: "acct-a",
				},
			},
			{
				id: 12,
				provider: "anthropic",
				disabledCause: null,
				credential: {
					type: "oauth",
					access: "access-b",
					refresh: "refresh-b",
					expires: Date.now() + 60_000,
					email: "b@example.com",
					accountId: "acct-b",
				},
			},
		];
		const accounts = toLogoutAccounts("anthropic", rows, { activeIdentity: { accountId: "acct-b" } });
		const adapter = makeLogoutAccountSelectorAdapter({ providerName: "Anthropic", accounts });
		const route = makeLogoutRoute(adapter);

		expect(adapter.rows.has(makeLogoutAccountId(12))).toBe(true);
		const rendered = render(route.component);
		expect(rendered).toContain("b@example.com (active)");
		expect(rendered.indexOf("b@example.com")).toBeLessThan(rendered.indexOf("a@example.com"));

		route.dispatch("\n");

		const selected = route.outputs[0];
		expect(selected?._tag).toBe("LogoutAccountSelected");
		if (selected?._tag !== "LogoutAccountSelected") return;
		expect(selected.account.credentialId).toBe(12);
	});
});
