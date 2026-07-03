import { afterEach, describe, expect, it } from "bun:test";
import {
	getFreshCodexOAuthCredential,
	hasFreshCodexOAuthCredential,
	isCodexRefreshManual,
} from "@oh-my-pi/pi-coding-agent/config/codex-refresh-policy";
import { Settings, resetSettingsForTest } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { AuthStorage, AuthStorageData } from "@oh-my-pi/pi-coding-agent/session/auth-storage";

function authStorageWith(data: AuthStorageData): Pick<AuthStorage, "getAll"> {
	return { getAll: () => data };
}

describe("Codex refresh policy", () => {
	afterEach(() => {
		resetSettingsForTest();
	});

	it("reads the manual/auto setting", async () => {
		await Settings.init({ inMemory: true, overrides: { "auth.codexRefresh": "manual" } });
		expect(isCodexRefreshManual()).toBe(true);

		resetSettingsForTest();
		await Settings.init({ inMemory: true, overrides: { "auth.codexRefresh": "auto" } });
		expect(isCodexRefreshManual()).toBe(false);
	});

	it("allows empty stores and selects only fresh Codex OAuth credentials", () => {
		const now = Date.now();
		const empty = authStorageWith({});
		expect(hasFreshCodexOAuthCredential(empty)).toBe(true);
		expect(getFreshCodexOAuthCredential(empty, now)).toBeUndefined();

		const freshCredential = {
			type: "oauth" as const,
			access: "fresh-access-token",
			refresh: "fresh-refresh-token",
			expires: now + 120_000,
			accountId: "acct-fresh",
		};
		const fresh = authStorageWith({ "openai-codex": freshCredential });
		expect(hasFreshCodexOAuthCredential(fresh)).toBe(true);
		expect(getFreshCodexOAuthCredential(fresh, now)).toBe(freshCredential);

		const expired = authStorageWith({
			"openai-codex": {
				type: "oauth",
				access: "expired-access-token",
				refresh: "expired-refresh-token",
				expires: now - 1,
			},
		});
		expect(hasFreshCodexOAuthCredential(expired)).toBe(false);
		expect(getFreshCodexOAuthCredential(expired, now)).toBeUndefined();
	});
});
