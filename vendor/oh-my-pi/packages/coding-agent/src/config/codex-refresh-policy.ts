import type { AuthStorage, OAuthCredential } from "../session/auth-storage";
import { settings } from "./settings";

const CODEX_PROVIDER_ID = "openai-codex";
const OAUTH_REFRESH_SKEW_MS = 60_000;

export const CODEX_REFRESH_GATED_NOTICE = "Codex refresh gated: run omp token openai-codex --force-refresh\n";

export function isCodexRefreshManual(): boolean {
	try {
		return settings.get("auth.codexRefresh") === "manual";
	} catch {
		return false;
	}
}

export function getCodexOAuthCredentials(authStorage: Pick<AuthStorage, "getAll">): OAuthCredential[] {
	const providerEntry = authStorage.getAll()[CODEX_PROVIDER_ID];
	if (!providerEntry) return [];
	const entries = Array.isArray(providerEntry) ? providerEntry : [providerEntry];
	return entries.filter((entry): entry is OAuthCredential => entry.type === "oauth");
}

export function getFreshCodexOAuthCredential(
	authStorage: Pick<AuthStorage, "getAll">,
	now = Date.now(),
): OAuthCredential | undefined {
	return getCodexOAuthCredentials(authStorage).find(credential => {
		return typeof credential.expires === "number" && now + OAUTH_REFRESH_SKEW_MS < credential.expires;
	});
}

export function hasFreshCodexOAuthCredential(authStorage: Pick<AuthStorage, "getAll">): boolean {
	const credentials = getCodexOAuthCredentials(authStorage);
	return credentials.length === 0 || getFreshCodexOAuthCredential(authStorage) !== undefined;
}

export function warnCodexRefreshGated(): void {
	process.stderr.write(CODEX_REFRESH_GATED_NOTICE);
}
