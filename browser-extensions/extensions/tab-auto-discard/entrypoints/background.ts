import { findDiscardCandidates } from "../utils/policy";
import type { AutoDiscardState, DiscardNowResponse, RuntimeMessage } from "../utils/settings";
import {
  loadLastViewedByTabId,
  loadState,
  saveLastViewedByTabId,
  saveSettings,
  saveState,
} from "../utils/storage";

const AUTO_DISCARD_ALARM = "tab-auto-discard-check";
const CHECK_PERIOD_MINUTES = 1;

type SendResponse = (response: AutoDiscardState | DiscardNowResponse) => void;

async function markTabViewed(tabId: number, timestamp = Date.now()): Promise<void> {
  const lastViewedByTabId = await loadLastViewedByTabId();
  lastViewedByTabId[tabId] = timestamp;
  await saveLastViewedByTabId(lastViewedByTabId);
}

async function pruneMissingTabs(openTabs: chrome.tabs.Tab[]): Promise<Record<number, number>> {
  const openTabIds: Record<number, true> = {};
  const nextLastViewedByTabId = await loadLastViewedByTabId();
  let changed = false;
  const now = Date.now();

  for (const tab of openTabs) {
    if (typeof tab.id !== "number") {
      continue;
    }

    openTabIds[tab.id] = true;
    if (typeof nextLastViewedByTabId[tab.id] !== "number") {
      nextLastViewedByTabId[tab.id] = now;
      changed = true;
    }
  }

  for (const tabId of Object.keys(nextLastViewedByTabId)) {
    if (openTabIds[Number(tabId)] !== true) {
      delete nextLastViewedByTabId[Number(tabId)];
      changed = true;
    }
  }

  if (changed) {
    await saveLastViewedByTabId(nextLastViewedByTabId);
  }

  return nextLastViewedByTabId;
}

async function runDiscardCycle(requireIdle: boolean): Promise<AutoDiscardState> {
  const state = await loadState();
  const now = Date.now();

  if (!state.settings.enabled && requireIdle) {
    const disabledState = { ...state, lastRunAt: now, lastDiscardCount: 0, lastError: null };
    await saveState(disabledState);
    return disabledState;
  }

  try {
    const tabs = await chrome.tabs.query({});
    const lastViewedByTabId = await pruneMissingTabs(tabs);
    const candidates = findDiscardCandidates(tabs, state.settings, lastViewedByTabId, now, { requireIdle });
    let discardedCount = 0;

    for (const tabId of candidates) {
      await chrome.tabs.discard(tabId);
      discardedCount += 1;
    }

    const nextState = {
      ...state,
      lastRunAt: now,
      lastDiscardCount: discardedCount,
      lastError: null,
    };
    await saveState(nextState);
    return nextState;
  } catch (error) {
    const nextState = {
      ...state,
      lastRunAt: now,
      lastDiscardCount: 0,
      lastError: error instanceof Error ? error.message : "Discard cycle failed",
    };
    await saveState(nextState);
    return nextState;
  }
}

async function markActiveTabsViewed(): Promise<void> {
  const activeTabs = await chrome.tabs.query({ active: true });
  const lastViewedByTabId = await loadLastViewedByTabId();
  const now = Date.now();
  let changed = false;

  for (const tab of activeTabs) {
    if (typeof tab.id === "number") {
      lastViewedByTabId[tab.id] = now;
      changed = true;
    }
  }

  if (changed) {
    await saveLastViewedByTabId(lastViewedByTabId);
  }
}

function handleMessage(message: RuntimeMessage, sendResponse: SendResponse): true {
  void (async () => {
    if (message.type === "getState") {
      sendResponse(await loadState());
      return;
    }

    if (message.type === "setSettings") {
      sendResponse(await saveSettings(message.settings));
      return;
    }

    const state = await runDiscardCycle(false);
    sendResponse({ ...state, discardedCount: state.lastDiscardCount });
  })();

  return true;
}

export default defineBackground(() => {
  void chrome.alarms.create(AUTO_DISCARD_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES });
  void markActiveTabsViewed();

  chrome.runtime.onInstalled.addListener(() => {
    void markActiveTabsViewed();
  });

  chrome.runtime.onStartup.addListener(() => {
    void markActiveTabsViewed();
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void markTabViewed(tabId);
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (typeof tab.id === "number") {
      void markTabViewed(tab.id);
    }
  });

  chrome.tabs.onUpdated.addListener((_tabId, _changeInfo, tab) => {
    if (tab.active && typeof tab.id === "number") {
      void markTabViewed(tab.id);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const lastViewedByTabId = await loadLastViewedByTabId();
      delete lastViewedByTabId[tabId];
      await saveLastViewedByTabId(lastViewedByTabId);
    })();
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
      void markActiveTabsViewed();
    }
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_DISCARD_ALARM) {
      void runDiscardCycle(true);
    }
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) =>
    handleMessage(message, sendResponse),
  );
});
