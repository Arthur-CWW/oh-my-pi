import { afterEach, describe, expect, it } from "bun:test";
import {
	_resetCodexOAuthCredentialSlotsForTest,
	advanceCodexOAuthCredentialSlot,
	getFreshCodexOAuthCredential,
	getFreshCodexOAuthCredentialSlot,
	hasFreshCodexOAuthCredential,
	isCodexRefreshManual,
} from "@oh-my-pi/pi-coding-agent/config/codex-refresh-policy";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { AuthStorage, AuthStorageData } from "@oh-my-pi/pi-coding-agent/session/auth-storage";

function authStorageWith(data: AuthStorageData): Pick<AuthStorage, "getAll"> {
	return { getAll: () => data };
}

function requireValue<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`Expected ${label}`);
	return value;
}

describe("Codex refresh policy", () => {
	afterEach(() => {
		_resetCodexOAuthCredentialSlotsForTest();
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
		expect(getFreshCodexOAuthCredential(empty, "session-empty", now)).toBeUndefined();

		const freshCredential = {
			type: "oauth" as const,
			access: "fresh-access-token",
			refresh: "fresh-refresh-token",
			expires: now + 120_000,
			accountId: "acct-fresh",
		};
		const fresh = authStorageWith({ "openai-codex": freshCredential });
		expect(hasFreshCodexOAuthCredential(fresh)).toBe(true);
		expect(getFreshCodexOAuthCredential(fresh, "session-fresh", now)).toBe(freshCredential);

		const expired = authStorageWith({
			"openai-codex": {
				type: "oauth",
				access: "expired-access-token",
				refresh: "expired-refresh-token",
				expires: now - 1,
			},
		});
		expect(hasFreshCodexOAuthCredential(expired)).toBe(false);
		expect(getFreshCodexOAuthCredential(expired, "session-expired", now)).toBeUndefined();
	});

	it("selects fresh Codex OAuth slots per key and advances independently", () => {
		const now = Date.now();
		const firstCredential = {
			type: "oauth" as const,
			access: "first-access-token",
			refresh: "first-refresh-token",
			expires: now + 120_000,
			accountId: "acct-first",
		};
		const secondCredential = {
			type: "oauth" as const,
			access: "second-access-token",
			refresh: "second-refresh-token",
			expires: now + 120_000,
			accountId: "acct-second",
		};
		const thirdCredential = {
			type: "oauth" as const,
			access: "third-access-token",
			refresh: "third-refresh-token",
			expires: now + 120_000,
			accountId: "acct-third",
		};
		const storage = authStorageWith({ "openai-codex": [firstCredential, secondCredential, thirdCredential] });
		const primaryKey = "session-primary";
		const siblingKey = "session-sibling";

		const primaryInitial = requireValue(getFreshCodexOAuthCredential(storage, primaryKey, now), "primary initial");
		const siblingInitial = requireValue(getFreshCodexOAuthCredential(storage, siblingKey, now), "sibling initial");
		const primaryInitialSlot = requireValue(
			getFreshCodexOAuthCredentialSlot(storage, primaryKey, now),
			"primary initial slot",
		);
		expect(primaryInitialSlot.credential).toBe(primaryInitial);
		expect(primaryInitialSlot.accountId).toBe(primaryInitial.accountId);
		expect(primaryInitialSlot.id).toBe(String(primaryInitialSlot.index));
		expect(getFreshCodexOAuthCredential(storage, primaryKey, now)).toBe(primaryInitial);
		expect(getFreshCodexOAuthCredential(storage, siblingKey, now)).toBe(siblingInitial);

		advanceCodexOAuthCredentialSlot(primaryKey);
		const primarySecond = requireValue(getFreshCodexOAuthCredential(storage, primaryKey, now), "primary second");
		const primarySecondSlot = requireValue(
			getFreshCodexOAuthCredentialSlot(storage, primaryKey, now),
			"primary second slot",
		);
		expect(primarySecondSlot.credential).toBe(primarySecond);
		expect(primarySecondSlot.accountId).toBe(primarySecond.accountId);
		expect(primarySecondSlot.id).toBe(String(primarySecondSlot.index));
		expect(primarySecondSlot.index).not.toBe(primaryInitialSlot.index);
		expect(primarySecond).not.toBe(primaryInitial);
		expect(getFreshCodexOAuthCredential(storage, siblingKey, now)).toBe(siblingInitial);

		advanceCodexOAuthCredentialSlot(primaryKey);
		const primaryThird = requireValue(getFreshCodexOAuthCredential(storage, primaryKey, now), "primary third");
		expect(primaryThird).not.toBe(primarySecond);

		advanceCodexOAuthCredentialSlot(primaryKey);
		expect(getFreshCodexOAuthCredential(storage, primaryKey, now)).toBe(primaryInitial);
	});

	it("skips expired slots while advancing fresh Codex OAuth selection", () => {
		const now = Date.now();
		const firstCredential = {
			type: "oauth" as const,
			access: "fresh-first-token",
			refresh: "fresh-first-refresh",
			expires: now + 120_000,
			accountId: "acct-first",
		};
		const expiredCredential = {
			type: "oauth" as const,
			access: "expired-middle-token",
			refresh: "expired-middle-refresh",
			expires: now - 1,
			accountId: "acct-expired",
		};
		const thirdCredential = {
			type: "oauth" as const,
			access: "fresh-third-token",
			refresh: "fresh-third-refresh",
			expires: now + 120_000,
			accountId: "acct-third",
		};
		const storage = authStorageWith({ "openai-codex": [firstCredential, expiredCredential, thirdCredential] });
		const key = "session-expired-skip";

		const initialSlot = requireValue(getFreshCodexOAuthCredentialSlot(storage, key, now), "initial slot");
		expect([0, 2]).toContain(initialSlot.index);

		advanceCodexOAuthCredentialSlot(key);
		const nextSlot = requireValue(getFreshCodexOAuthCredentialSlot(storage, key, now), "next slot");
		expect([0, 2]).toContain(nextSlot.index);
		expect(nextSlot.index).not.toBe(initialSlot.index);

		advanceCodexOAuthCredentialSlot(key);
		expect(requireValue(getFreshCodexOAuthCredentialSlot(storage, key, now), "wrapped slot").index).toBe(initialSlot.index);
	});
});
