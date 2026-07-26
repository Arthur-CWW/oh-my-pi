import { createHash } from "node:crypto";
import type { AuthStorage, OAuthCredential } from "../session/auth-storage";
import { settings } from "./settings";

const CODEX_PROVIDER_ID = "openai-codex";
const OAUTH_REFRESH_SKEW_MS = 60_000;

const DEFAULT_CODEX_SLOT_KEY = "__default_codex_slot__";
const slotOffsets = new Map<string, number>();
const invalidCredentialSlots = new Set<string>();

export interface FreshCodexOAuthCredentialSlot {
	readonly id: string;
	readonly index: number;
	readonly credential: OAuthCredential;
	readonly accountId?: string;
}

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

function codexSlotKey(key: string | undefined): string {
	return key && key.length > 0 ? key : DEFAULT_CODEX_SLOT_KEY;
}

function hashSlotKey(key: string): number {
	let hash = 2_166_136_261;
	for (let index = 0; index < key.length; index += 1) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return hash >>> 0;
}

function isFreshCodexOAuthCredential(credential: OAuthCredential, now: number): boolean {
	return typeof credential.expires === "number" && now + OAUTH_REFRESH_SKEW_MS < credential.expires;
}

function codexSlotId(credential: OAuthCredential): string {
	return createHash("sha256").update(credential.access).digest("hex");
}

export function getFreshCodexOAuthCredentialSlots(
	authStorage: Pick<AuthStorage, "getAll">,
	now = Date.now(),
): FreshCodexOAuthCredentialSlot[] {
	const credentials = getCodexOAuthCredentials(authStorage);
	const slots: FreshCodexOAuthCredentialSlot[] = [];
	for (let index = 0; index < credentials.length; index += 1) {
		const credential = credentials[index];
		if (!credential || !isFreshCodexOAuthCredential(credential, now)) continue;
		const id = codexSlotId(credential);
		if (invalidCredentialSlots.has(id)) continue;
		slots.push({
			index,
			id,
			credential,
			...(credential.accountId !== undefined ? { accountId: credential.accountId } : {}),
		});
	}
	return slots;
}

export function getFreshCodexOAuthCredentials(
	authStorage: Pick<AuthStorage, "getAll">,
	now = Date.now(),
): OAuthCredential[] {
	return getFreshCodexOAuthCredentialSlots(authStorage, now).map(slot => slot.credential);
}

export function getFreshCodexOAuthCredentialSlot(
	authStorage: Pick<AuthStorage, "getAll">,
	key: string | undefined,
	now = Date.now(),
): FreshCodexOAuthCredentialSlot | undefined {
	const freshSlots = getFreshCodexOAuthCredentialSlots(authStorage, now);
	if (freshSlots.length === 0) return undefined;
	const normalizedKey = codexSlotKey(key);
	const baseIndex = hashSlotKey(normalizedKey) % freshSlots.length;
	const offset = slotOffsets.get(normalizedKey) ?? 0;
	return freshSlots[(baseIndex + offset) % freshSlots.length];
}

export function getFreshCodexOAuthCredential(
	authStorage: Pick<AuthStorage, "getAll">,
	key: string | undefined,
	now = Date.now(),
): OAuthCredential | undefined {
	return getFreshCodexOAuthCredentialSlot(authStorage, key, now)?.credential;
}

export function advanceCodexOAuthCredentialSlot(key: string | undefined): void {
	const normalizedKey = codexSlotKey(key);
	slotOffsets.set(normalizedKey, (slotOffsets.get(normalizedKey) ?? 0) + 1);
}

export function quarantineCodexOAuthCredentialSlot(slot: Pick<FreshCodexOAuthCredentialSlot, "id">): void {
	invalidCredentialSlots.add(slot.id);
}

export function _resetCodexOAuthCredentialSlotsForTest(): void {
	slotOffsets.clear();
	invalidCredentialSlots.clear();
}

export function hasFreshCodexOAuthCredential(authStorage: Pick<AuthStorage, "getAll">): boolean {
	const credentials = getCodexOAuthCredentials(authStorage);
	return credentials.length === 0 || getFreshCodexOAuthCredentials(authStorage).length > 0;
}

export function warnCodexRefreshGated(): void {
	process.stderr.write(CODEX_REFRESH_GATED_NOTICE);
}
