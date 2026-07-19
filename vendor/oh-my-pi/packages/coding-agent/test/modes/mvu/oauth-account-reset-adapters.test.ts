import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import type { AuthStorage, ResetCreditRedeemOutcome } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import type { LogoutAccount } from "@oh-my-pi/pi-coding-agent/slash-commands/helpers/logout";
import {
	makeOAuthProviderId,
	makeOAuthSelectorAdapter,
	oauthSelectorOutput,
} from "@oh-my-pi/pi-coding-agent/modes/mvu/oauth-selector-adapter";
import {
	logoutAccountSelectorOutput,
	makeLogoutAccountId,
	makeLogoutAccountSelectorAdapter,
} from "@oh-my-pi/pi-coding-agent/modes/mvu/logout-account-adapter";
import {
	makeResetUsageSelectorAdapter,
	makeResetSpendDeduplication,
	makeSpendResetInterpreter,
	resetUsageSelectorOutput,
} from "@oh-my-pi/pi-coding-agent/modes/mvu/reset-usage-adapter";

const confirm = "tui.select.confirm" as "tui.select.confirm";

const redeemOutcome: ResetCreditRedeemOutcome = {
	ok: true,
	code: "reset",
	creditId: "credit-1",
};

const account = (credentialId: number, label: string, active = false): LogoutAccount => ({
	credentialId,
	provider: "openai-codex",
	label,
	detail: `oauth #${credentialId}`,
	type: "oauth",
	active,
});

describe("OAuth/account/reset MVU adapters", () => {
	it("serves login and setup provider routes from one stable-ID adapter", () => {
		const providers = getOAuthProviders();
		const login = makeOAuthSelectorAdapter({ mode: "login", providers });
		const first = login.initialModel.selectedId;
		expect(first).toBeDefined();
		if (first === undefined) return;
		const command = login.selector.activate(first, login.initialModel);
		expect(command).toEqual({ _tag: "Command", action: confirm, id: first });
		if (command._tag !== "Command") return;
		const stamp = {
			_tag: "Activate" as const,
			action: command.action,
			id: command.id,
			sourceRevision: login.initialModel.sourceRevision,
			requestGeneration: 1,
			nonce: "oauth-login:1",
		};
		expect(oauthSelectorOutput(stamp, login)).toEqual({
			_tag: "OAuthProviderSelected",
			mode: "login",
			providerId: first,
			id: first,
			action: command.action,
			sourceRevision: login.initialModel.sourceRevision,
			requestGeneration: 1,
			nonce: "oauth-login:1",
		});
	});

	it("starts on the active logout account and resolves stable identity across reorder", () => {
		const providers = getOAuthProviders();
		const storedProvider = providers.find(provider => provider.id === "openai-codex") ?? providers[0];
		expect(storedProvider).toBeDefined();
		if (storedProvider === undefined) return;
		const storedProviderId = makeOAuthProviderId(storedProvider.id);
		const authStorage: Pick<AuthStorage, "has" | "hasAuth" | "getCredentialOrigin"> = {
			has: providerId => providerId === storedProvider.id,
			hasAuth: providerId => providerId === storedProvider.id,
			getCredentialOrigin: () => undefined,
		};
		const providerAdapter = makeOAuthSelectorAdapter({ mode: "logout", providers, authStorage });
		expect([...providerAdapter.items.keys()]).toEqual([storedProviderId]);
		const accounts = [account(22, "later"), account(7, "active", true)];
		const activeId = makeLogoutAccountId(7);
		for (const orderedAccounts of [accounts, [...accounts].reverse()]) {
			const accountAdapter = makeLogoutAccountSelectorAdapter({ providerName: storedProvider.name, accounts: orderedAccounts });
			const selected = accountAdapter.initialModel.selectedId;
			expect(selected).toBe(activeId);
			if (selected === undefined) return;
			const activation = accountAdapter.selector.activate(selected, accountAdapter.initialModel);
			expect(activation).toEqual({ _tag: "Command", action: confirm, id: activeId });
			if (activation._tag !== "Command") return;
			const output = logoutAccountSelectorOutput({
				_tag: "Activate",
				action: activation.action,
				id: activation.id,
				sourceRevision: accountAdapter.initialModel.sourceRevision,
				requestGeneration: 1,
				nonce: `logout:${activeId}`,
			}, accountAdapter);
			expect(output?._tag).toBe("LogoutAccountSelected");
			expect(output && output._tag === "LogoutAccountSelected" ? output.account.credentialId : undefined).toBe(7);
			expect(output).toMatchObject({
				id: activation.id,
				action: activation.action,
				sourceRevision: accountAdapter.initialModel.sourceRevision,
				requestGeneration: 1,
				nonce: `logout:${activeId}`,
			});
		}
	});

	it("requires two matching reset confirmations and fences all R9 edges", async () => {
		const adapter = makeResetUsageSelectorAdapter({
			accounts: [
				{ label: "a@example.com", availableCount: 1, target: { credentialId: 1 }, active: true },
				{ label: "b@example.com", availableCount: 1, target: { credentialId: 2 }, active: false },
			],
			sessionGeneration: "session-a",
			mountGeneration: 1,
			sourceRevision: 4,
		});
		const selected = adapter.initialModel.selectedId;
		expect(selected).toBeDefined();
		if (selected === undefined) return;
		const arm = adapter.update(adapter.initialModel, {
			_tag: "Arm",
			action: confirm,
			nonce: adapter.nonce(selected),
		}).model;
		expect(arm.mode._tag).toBe("Confirm");
		if (arm.mode._tag !== "Confirm") return;
		const wrongTarget = adapter.update(arm, {
			_tag: "CommitArmed",
			id: "reset:credential:2" as typeof selected,
			sourceRevision: 4,
			nonce: arm.mode.arm.nonce,
			redeemable: true,
		});
		expect(wrongTarget.commands).toEqual([]);
		const wrongRevision = adapter.update(arm, {
			_tag: "CommitArmed",
			id: selected,
			sourceRevision: 5,
			nonce: arm.mode.arm.nonce,
			redeemable: true,
		});
		expect(wrongRevision.commands).toEqual([]);
		const moved = adapter.update(arm, { _tag: "Move", delta: 1 });
		expect(moved.model.mode._tag).not.toBe("Confirm");
		const filtered = adapter.update(arm, { _tag: "BeginFilter" });
		expect(filtered.model.mode._tag).not.toBe("Confirm");
		const replaced = adapter.update(arm, {
			_tag: "SourceReplaced",
			sourceRevision: 5,
			orderedIds: [selected],
		});
		expect(replaced.model.mode._tag).not.toBe("Confirm");
		const failed = adapter.update(arm, {
			_tag: "ActionFailed",
			action: confirm,
			id: selected,
			sourceRevision: 4,
			requestGeneration: 1,
			nonce: arm.mode.arm.nonce,
			receiptId: "r",
			error: "failed",
		});
		expect(failed.model.mode._tag).toBe("Confirm");
		const escaped = adapter.update(arm, { _tag: "Back" });
		expect(escaped.model.mode._tag).not.toBe("Confirm");
		const spent = adapter.update(arm, {
			_tag: "CommitArmed",
			id: selected,
			sourceRevision: 4,
			nonce: arm.mode.arm.nonce,
			redeemable: true,
		});
		expect(spent.commands).toHaveLength(1);
		const command = spent.commands[0];
		expect(command?._tag).toBe("SpendReset");
		if (!command || command._tag !== "SpendReset") return;
		expect(adapter.update(spent.model, {
			_tag: "CommitArmed",
			id: selected,
			sourceRevision: 4,
			nonce: arm.mode.arm.nonce,
			redeemable: true,
		}).commands).toEqual([]);
		expect(resetUsageSelectorOutput(command, adapter)).toEqual(command);
		let redeemed = 0;
		const interpret = makeSpendResetInterpreter({
			deduplication: makeResetSpendDeduplication(),
			adapter,
			redeem: () => Effect.sync(() => {
				redeemed += 1;
				return redeemOutcome;
			}),
		});
		const firstReceipt = await Effect.runPromise(interpret(command));
		const duplicateReceipt = await Effect.runPromise(interpret(command));
		expect(redeemed).toBe(1);
		const firstOutput = firstReceipt[0];
		const duplicateOutput = duplicateReceipt[0];
		expect(firstOutput?._tag).toBe("ResetSpendReceipt");
		expect(duplicateOutput?._tag).toBe("ResetSpendReceipt");
		if (firstOutput?._tag !== "ResetSpendReceipt" || duplicateOutput?._tag !== "ResetSpendReceipt") return;
		expect(firstOutput.duplicate).toBe(false);
		expect(duplicateOutput.duplicate).toBe(true);
		expect(firstOutput).toMatchObject({
			action: command.action,
			id: command.id,
			sourceRevision: command.sourceRevision,
			requestGeneration: command.requestGeneration,
			nonce: command.nonce,
		});
		expect(duplicateOutput).toMatchObject({
			action: command.action,
			id: command.id,
			sourceRevision: command.sourceRevision,
			requestGeneration: command.requestGeneration,
			nonce: command.nonce,
		});
	});
});