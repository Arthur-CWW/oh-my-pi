export {}
type VisibleTweetRecord = {
  tweetId: string;
  statusUrl: string;
  username: string;
  fullText: string;
  mediaUrls: string[];
  replyContext?: string;
  quoteStatusUrl?: string;
  createdAt?: string;
  pageKind: string;
};

type SignalKind =
  | "tab_visible"
  | "tab_hidden"
  | "url_change"
  | "page_load"
  | "tweet_visible"
  | "tweet_dwell"
  | "thread_expand"
  | "control_click"
  | "profile_visit";

type SignalDetails = Record<string, string | number | boolean | null | undefined>;

type InteractionSignal = {
  signalId: string;
  kind: SignalKind;
  observedAt: string;
  durationMs?: number;
  pageUrl: string;
  sourceUrl?: string;
  tabId?: number;
  sessionId: string;
  tweetId?: string;
  profileHandle?: string;
  listId?: string;
  searchQuery?: string;
  confidence?: number;
  details?: SignalDetails;
};

type CaptureResponse =
  | {
      ok: true;
      pageUrl: string;
      pageTitle: string;
      pageKind: string;
      visibleTweets: VisibleTweetRecord[];
      signals: InteractionSignal[];
    }
  | {
      ok: false;
      pageUrl: string;
      pageTitle: string;
      pageKind: string;
      error: string;
      signals: InteractionSignal[];
    };

type ActionName = "sync-visible" | "ping-health";

type ActionResult = {
  action: ActionName;
  ok: boolean;
  recordedAt: string;
  status?: number;
  body?: string;
  tweetCount?: number;
  signalCount?: number;
  pageUrl?: string;
  pageKind?: string;
  error?: string;
};

type CaptureSyncOptions = {
  readonly silent?: boolean;
};

const INGEST_ENDPOINT = "http://127.0.0.1:3420/api/x-bookmark-sync/ingest";
const HEALTH_ENDPOINT = "http://127.0.0.1:3420/api/health";
const STORAGE_KEY = "twitterArchiveFirefoxLastResult";
const SYNC_MENU_ID = "twitter-archive-firefox-sync-visible";
const HEALTH_MENU_ID = "twitter-archive-firefox-ping-health";
const DEFAULT_TITLE = "Sync visible X/Twitter tweets";
const SUPPORTED_TAB_PATTERN = /^https:\/\/(?:x|twitter)\.com\//;
const BACKGROUND_SYNC_INTERVAL_MS = 60_000;
let backgroundSyncRunning = false;


function createContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SYNC_MENU_ID,
      title: "Sync visible tweets",
      contexts: ["browser_action"],
    });

    chrome.contextMenus.create({
      id: HEALTH_MENU_ID,
      title: "Ping localhost health",
      contexts: ["browser_action"],
    });
  });
}

function updateBadge(result: ActionResult): void {
  let text = "";
  let color = "#1d9bf0";
  let title = DEFAULT_TITLE;

  if (result.action === "sync-visible") {
    if (result.ok) {
      const count = result.tweetCount ?? 0;
      text = count > 99 ? "99+" : String(count);
      title = `Synced ${count} visible tweet${count === 1 ? "" : "s"} from ${result.pageKind ?? "page"}.`;
      if (result.status) {
        title += ` Server ${result.status}.`;
      }
    } else {
      color = "#d93025";
      text = result.tweetCount === 0 ? "0" : "ERR";
      title = result.error ?? "Visible-tweet sync failed.";
    }
  } else if (result.ok) {
    text = "OK";
    title = result.status ? `twitter-archive health ${result.status}.` : "twitter-archive health is reachable.";
  } else {
    color = "#d93025";
    text = "ERR";
    title = result.error ?? "twitter-archive health check failed.";
  }

  chrome.browserAction.setBadgeBackgroundColor({ color });
  chrome.browserAction.setBadgeText({ text });
  chrome.browserAction.setTitle({ title });
}

async function persistLastResult(result: ActionResult): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: result }, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve();
    });
  });
}

async function finalizeResult(result: ActionResult): Promise<ActionResult> {
  updateBadge(result);

  try {
    await persistLastResult(result);
  } catch (error) {
    console.warn("[twitter-archive-firefox] failed to persist last result", error);
  }

  return result;
}

async function finishSyncResult(result: ActionResult, options: CaptureSyncOptions): Promise<ActionResult> {
  return options.silent ? result : finalizeResult(result);
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  return new Promise<chrome.tabs.Tab>((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      const activeTab = tabs[0];
      if (!activeTab) {
        reject(new Error("No active tab was found."));
        return;
      }

      resolve(activeTab);
    });
  });
}

async function requestVisibleTweetCapture(tabId: number): Promise<CaptureResponse> {
  return new Promise<CaptureResponse>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "twitter-archive:capture-visible" }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(response as CaptureResponse);
    });
  });
}

async function acknowledgeSignals(tabId: number, signals: readonly InteractionSignal[]): Promise<void> {
  const signalIds = signals.map((signal) => signal.signalId);
  if (signalIds.length === 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "twitter-archive:ack-signals", signalIds }, () => {
      resolve();
    });
  });
}


function buildSnapshot(tabId: number, capture: Extract<CaptureResponse, { ok: true }>) {
  const capturedAt = new Date().toISOString();

  return {
    source: {
      extension: "twitter-archive-firefox",
      client: "firefox-webextension",
      browser: "firefox",
      lane: "webextension-dom",
    },
    generatedAt: capturedAt,
    incremental: true,
    captures: [
      {
        id: `firefox-webextension-${tabId}-${Date.now()}`,
        capturedAt,
        inspectedTabId: tabId,
        pageUrl: capture.pageUrl,
        request: {
          method: "DOM",
          url: capture.pageUrl,
          headers: {},
        },
        response: {
          status: 200,
          statusText: "DOM_CAPTURE",
          mimeType: "text/html",
          bodySize: 0,
          encoding: "utf-8",
          headers: {},
        },
        timing: {
          startedDateTime: capturedAt,
          time: 0,
        },
        tags: ["firefox-webextension", capture.pageKind, "visible-tweets", "signals"],
        visibleTweets: capture.visibleTweets,
        signals: capture.signals.map((signal) => ({
          ...signal,
          tabId: signal.tabId ?? tabId,
          pageUrl: signal.pageUrl || capture.pageUrl,
        })),
        tweetLike: capture.visibleTweets.map((tweet) => ({
          rest_id: tweet.tweetId,
          id_str: tweet.tweetId,
          full_text: tweet.fullText,
          created_at: tweet.createdAt,
          screen_name: tweet.username,
          url: tweet.statusUrl,
          path: tweet.pageKind,
          reply_context: tweet.replyContext,
          quoted_status_path: tweet.quoteStatusUrl,
          media_urls: tweet.mediaUrls,
        })),
        json: {
          pageUrl: capture.pageUrl,
          pageTitle: capture.pageTitle,
          pageKind: capture.pageKind,
          tweetCount: capture.visibleTweets.length,
          signalCount: capture.signals.length,
        },
      },
    ],
  };
}

async function captureSyncResult(tab: chrome.tabs.Tab | undefined, options: CaptureSyncOptions = {}): Promise<ActionResult> {
  try {
    const activeTab = tab ?? (await getActiveTab());
    if (typeof activeTab.id !== "number") {
      throw new Error("The active tab is missing an id.");
    }
    if (!activeTab.url || !SUPPORTED_TAB_PATTERN.test(activeTab.url)) {
      throw new Error("Open an authenticated x.com or twitter.com tab before syncing visible tweets.");
    }

    const capture = await requestVisibleTweetCapture(activeTab.id);
    if (!capture) {
      throw new Error("The content script did not return a capture payload.");
    }
    if (capture.ok === false) {
      throw new Error(capture.error);
    }

    const hasSignals = capture.signals.length > 0;
    if (capture.visibleTweets.length === 0 && !hasSignals) {
      return finishSyncResult(
        {
          action: "sync-visible",
          ok: false,
          recordedAt: new Date().toISOString(),
          pageUrl: capture.pageUrl,
          pageKind: capture.pageKind,
          tweetCount: 0,
          error: "No visible tweet cards or recent signals were found on this page.",
        },
        options,
      );
    }

    const response = await fetch(INGEST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(buildSnapshot(activeTab.id, capture)),
    });

    const body = (await response.text()).slice(0, 500);
    if (response.ok) {
      await acknowledgeSignals(activeTab.id, capture.signals);
    }

    return finishSyncResult(
      {
        action: "sync-visible",
        ok: response.ok,
        recordedAt: new Date().toISOString(),
        status: response.status,
        body,
        tweetCount: capture.visibleTweets.length,
        signalCount: capture.signals.length,
        pageUrl: capture.pageUrl,
        pageKind: capture.pageKind,
        error: response.ok ? undefined : `Ingest returned ${response.status}.`,
      },
      options,
    );
  } catch (error) {
    return finishSyncResult(
      {
        action: "sync-visible",
        ok: false,
        recordedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
      options,
    );
  }
}

async function supportedTwitterTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise<chrome.tabs.Tab[]>((resolve, reject) => {
    chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] }, (tabs) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      resolve(tabs.filter((tab) => typeof tab.id === "number" && Boolean(tab.url) && SUPPORTED_TAB_PATTERN.test(tab.url ?? "")));
    });
  });
}

async function syncAllSupportedTabs(reason: string): Promise<void> {
  if (backgroundSyncRunning) {
    return;
  }
  backgroundSyncRunning = true;
  try {
    const tabs = await supportedTwitterTabs();
    for (const tab of tabs) {
      await captureSyncResult(tab, { silent: true });
    }
    await persistLastResult({
      action: "sync-visible",
      ok: true,
      recordedAt: new Date().toISOString(),
      body: `background-sync:${reason}:tabs=${tabs.length}`,
    });
  } catch (error) {
    await finalizeResult({
      action: "sync-visible",
      ok: false,
      recordedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    backgroundSyncRunning = false;
  }
}

async function captureHealthResult(): Promise<ActionResult> {
  try {
    const response = await fetch(HEALTH_ENDPOINT, {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    const body = (await response.text()).slice(0, 300);
    return finalizeResult({
      action: "ping-health",
      ok: response.ok,
      recordedAt: new Date().toISOString(),
      status: response.status,
      body,
      error: response.ok ? undefined : `Health endpoint returned ${response.status}.`,
    });
  } catch (error) {
    return finalizeResult({
      action: "ping-health",
      ok: false,
      recordedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
  chrome.browserAction.setTitle({ title: DEFAULT_TITLE });
  chrome.browserAction.setBadgeText({ text: "" });
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
  chrome.browserAction.setTitle({ title: DEFAULT_TITLE });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") {
    return;
  }
  if (typeof tabId !== "number" || !tab.url || !SUPPORTED_TAB_PATTERN.test(tab.url)) {
    return;
  }
  window.setTimeout(() => void captureSyncResult({ ...tab, id: tabId }, { silent: true }), 2_000);
});


chrome.browserAction.onClicked.addListener((tab) => {
  void captureSyncResult(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === SYNC_MENU_ID) {
    void captureSyncResult(tab);
    return;
  }

  if (info.menuItemId === HEALTH_MENU_ID) {
    void captureHealthResult();
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "ping-health") {
    void captureHealthResult();
  }
});

setInterval(() => {
  void syncAllSupportedTabs("interval");
}, BACKGROUND_SYNC_INTERVAL_MS);

void syncAllSupportedTabs("startup");


createContextMenus();
chrome.browserAction.setTitle({ title: DEFAULT_TITLE });
