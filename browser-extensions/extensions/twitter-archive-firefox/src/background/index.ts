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

type CaptureResponse =
  | {
      ok: true;
      pageUrl: string;
      pageTitle: string;
      pageKind: string;
      visibleTweets: VisibleTweetRecord[];
    }
  | {
      ok: false;
      pageUrl: string;
      pageTitle: string;
      pageKind: string;
      error: string;
    };

type ActionName = "sync-visible" | "ping-health";

type ActionResult = {
  action: ActionName;
  ok: boolean;
  recordedAt: string;
  status?: number;
  body?: string;
  tweetCount?: number;
  pageUrl?: string;
  pageKind?: string;
  error?: string;
};

const INGEST_ENDPOINT = "http://127.0.0.1:3420/api/x-bookmark-sync/ingest";
const HEALTH_ENDPOINT = "http://127.0.0.1:3420/api/health";
const STORAGE_KEY = "twitterArchiveFirefoxLastResult";
const SYNC_MENU_ID = "twitter-archive-firefox-sync-visible";
const HEALTH_MENU_ID = "twitter-archive-firefox-ping-health";
const DEFAULT_TITLE = "Sync visible X/Twitter tweets";
const SUPPORTED_TAB_PATTERN = /^https:\/\/(?:x|twitter)\.com\//;

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
        tags: ["firefox-webextension", capture.pageKind, "visible-tweets"],
        visibleTweets: capture.visibleTweets,
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
        },
      },
    ],
  };
}

async function captureSyncResult(tab: chrome.tabs.Tab | undefined): Promise<ActionResult> {
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

    if (capture.visibleTweets.length === 0) {
      return finalizeResult({
        action: "sync-visible",
        ok: false,
        recordedAt: new Date().toISOString(),
        pageUrl: capture.pageUrl,
        pageKind: capture.pageKind,
        tweetCount: 0,
        error: "No visible tweet cards were found on this page.",
      });
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
    return finalizeResult({
      action: "sync-visible",
      ok: response.ok,
      recordedAt: new Date().toISOString(),
      status: response.status,
      body,
      tweetCount: capture.visibleTweets.length,
      pageUrl: capture.pageUrl,
      pageKind: capture.pageKind,
      error: response.ok ? undefined : `Ingest returned ${response.status}.`,
    });
  } catch (error) {
    return finalizeResult({
      action: "sync-visible",
      ok: false,
      recordedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
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

createContextMenus();
chrome.browserAction.setTitle({ title: DEFAULT_TITLE });
