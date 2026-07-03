import { DEFAULT_STATE, sanitizeSettings, type AutoDiscardSettings, type AutoDiscardState } from "./settings";

const STATE_STORAGE_KEY = "tabAutoDiscardState";
const LAST_VIEWED_STORAGE_KEY = "tabAutoDiscardLastViewed";

interface StoredStateValue {
  settings?: AutoDiscardSettings;
  lastRunAt?: number | null;
  lastDiscardCount?: number;
  lastError?: string | null;
}

interface StateStorageRecord {
  tabAutoDiscardState?: StoredStateValue;
}

interface LastViewedStorageRecord {
  tabAutoDiscardLastViewed?: Record<string, number>;
}

export async function loadState(): Promise<AutoDiscardState> {
  const stored = (await chrome.storage.local.get(STATE_STORAGE_KEY)) as StateStorageRecord;
  const value = stored.tabAutoDiscardState;

  if (!value?.settings) {
    return DEFAULT_STATE;
  }

  return {
    settings: sanitizeSettings(value.settings),
    lastRunAt: typeof value.lastRunAt === "number" ? value.lastRunAt : null,
    lastDiscardCount: typeof value.lastDiscardCount === "number" ? value.lastDiscardCount : 0,
    lastError: typeof value.lastError === "string" ? value.lastError : null,
  };
}

export async function saveState(state: AutoDiscardState): Promise<void> {
  await chrome.storage.local.set({
    [STATE_STORAGE_KEY]: {
      settings: sanitizeSettings(state.settings),
      lastRunAt: state.lastRunAt,
      lastDiscardCount: state.lastDiscardCount,
      lastError: state.lastError,
    },
  });
}

export async function saveSettings(settings: AutoDiscardSettings): Promise<AutoDiscardState> {
  const current = await loadState();
  const next = { ...current, settings: sanitizeSettings(settings), lastError: null };
  await saveState(next);
  return next;
}

export async function loadLastViewedByTabId(): Promise<Record<number, number>> {
  const stored = (await chrome.storage.local.get(LAST_VIEWED_STORAGE_KEY)) as LastViewedStorageRecord;
  const lastViewed: Record<number, number> = {};

  for (const [tabId, timestamp] of Object.entries(stored.tabAutoDiscardLastViewed ?? {})) {
    const numericTabId = Number(tabId);
    if (Number.isInteger(numericTabId) && typeof timestamp === "number") {
      lastViewed[numericTabId] = timestamp;
    }
  }

  return lastViewed;
}

export async function saveLastViewedByTabId(lastViewedByTabId: Record<number, number>): Promise<void> {
  await chrome.storage.local.set({ [LAST_VIEWED_STORAGE_KEY]: lastViewedByTabId });
}
