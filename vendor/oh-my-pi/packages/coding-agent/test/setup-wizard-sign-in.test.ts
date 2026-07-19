import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { AuthStorage, SqliteAuthCredentialStore } from "@oh-my-pi/pi-ai";
import { Key, type Keybinding, type KeyId } from "@oh-my-pi/pi-tui";
import {
	makeSignInAdapter,
	makeSignInModel,
	updateSignIn,
} from "@oh-my-pi/pi-coding-agent/modes/setup-wizard/scenes/sign-in";

import type { MvuEnvelope } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-lease";

const input = <TAction extends Keybinding>(action: TAction, key: KeyId = Key.enter, text?: string): MvuEnvelope => ({
	_tag: "MvuInput",
	action,
	event: text === undefined ? { _tag: "Press", key, repeat: false } : { _tag: "Press", key, text, repeat: false },
});

function authStorage(): AuthStorage {
	return new AuthStorage(new SqliteAuthCredentialStore(new Database(":memory:")));
}

describe("setup sign-in committed model", () => {
	it("reconstructs the OAuth prompt and draft from reducer state", () => {
		const storage = authStorage();
		const adapter = makeSignInAdapter(storage);
		const initial = makeSignInModel(storage, 7);
		const providerId = initial.selector.selectedId;
		if (providerId === undefined) throw new Error("OAuth provider list is empty");
		const running = { ...initial, providerId, requestGeneration: 3 };
		const opened = updateSignIn(running, {
			_tag: "OAuthPromptChanged",
			generation: 7,
			sourceRevision: 0,
			requestGeneration: 3,
			prompt: {
				stage: "prompt",
				url: "https://example.com/oauth",
				instructions: "Sign in in the browser",
				message: "Paste the returned code",
				placeholder: "code",
				draft: "",
			},
		}, adapter);
		const typed = updateSignIn(opened.model, input("setup.input", "a", "a"), adapter);
		expect(typed.model.prompt.draft).toBe("a");
		const deleted = updateSignIn(typed.model, input("app.selector.filterDelete", Key.backspace), adapter);
		expect(deleted.model.prompt.draft).toBe("");
	});

	it("fences stale OAuth settlements after cancellation", () => {
		const storage = authStorage();
		const adapter = makeSignInAdapter(storage);
		const initial = makeSignInModel(storage, 2);
		const providerId = initial.selector.selectedId;
		if (providerId === undefined) throw new Error("OAuth provider list is empty");
		const running = { ...initial, providerId, requestGeneration: 4 };
		const cancelled = updateSignIn(running, input("setup.cancel", "c"), adapter);
		const stale = updateSignIn(cancelled.model, {
			_tag: "OAuthSettled",
			generation: 2,
			sourceRevision: 0,
			requestGeneration: 4,
			providerId,
			cancelled: false,
		}, adapter);
		expect(stale.model).toBe(cancelled.model);
	});
});
