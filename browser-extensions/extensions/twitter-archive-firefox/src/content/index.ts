export {}
type FollowingAccountRecord = {
  username: string;
  displayName?: string;
  profileUrl?: string;
  avatarUrl?: string;
  sourceHandle?: string;
  pageKind?: string;
};

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
  hasReadMore?: boolean;
  isLongPostCandidate?: boolean;
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
      followingAccounts?: FollowingAccountRecord[];
      followingSourceHandle?: string;
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

type StatusLink = {
  href: string;
  tweetId: string;
  username: string;
};

const BLOCKED_PATH_PREFIXES = [
  "/messages",
  "/i/messages",
  "/notifications",
  "/i/notifications",
  "/i/topics",
  "/settings",
  "/compose",
];
const NON_PROFILE_PATHS: Record<string, true> = {
  compose: true,
  explore: true,
  home: true,
  i: true,
  jobs: true,
  login: true,
  logout: true,
  messages: true,
  notifications: true,
  privacy: true,
  search: true,
  settings: true,
  tos: true,
}

const MAX_SIGNAL_BUFFER = 2000;
const SESSION_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const SIGNALS: InteractionSignal[] = [];
const OBSERVED_TWEETS = new Map<string, { visibleSince?: number; profileHandle?: string }>();
let OBSERVED_ARTICLES = new WeakSet<HTMLElement>();
const FOLLOWING_ACCOUNTS_BY_SOURCE = new Map<string, Map<string, FollowingAccountRecord>>();
const URL_POLL_INTERVAL_MS = 10_000;
const MUTATION_SCAN_DEBOUNCE_MS = 500;
const TWEET_VISIBILITY_THRESHOLDS = [0, 0.5, 1];

function hashString(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hash = (hash << 5) - hash + code;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 10);
}

function generateSignalId(signal: Omit<InteractionSignal, "signalId">): string {
  const observedMs = Date.parse(signal.observedAt);
  const coarseBucket = Number.isFinite(observedMs) ? Math.floor(observedMs / 30_000) : signal.observedAt;
  const exactBucket = signal.observedAt;
  const bucket = signal.kind === "tweet_visible" || signal.kind === "tweet_dwell" ? coarseBucket : exactBucket;
  const payload = JSON.stringify({
    kind: signal.kind,
    bucket,
    pageUrl: signal.pageUrl,
    sourceUrl: signal.sourceUrl,
    tabId: signal.tabId,
    sessionId: signal.sessionId,
    tweetId: signal.tweetId,
    profileHandle: signal.profileHandle,
    listId: signal.listId,
    searchQuery: signal.searchQuery,
    details: signal.details,
  });
  return `sig-${hashString(payload)}`;
}

function pushSignal(signal: Omit<InteractionSignal, "signalId">): InteractionSignal {
  const fullSignal: InteractionSignal = {
    ...signal,
    signalId: generateSignalId(signal),
  };
  if (SIGNALS.length >= MAX_SIGNAL_BUFFER) {
    SIGNALS.shift();
  }
  SIGNALS.push(fullSignal);
  return fullSignal;
}

function pageProfileHandle(): string | undefined {
  const match = location.pathname.match(/^\/+([A-Za-z0-9_]+)\/?$/);
  return match?.[1];
}

function pageFollowingHandle(): string | undefined {
  const match = location.pathname.match(/^\/+([A-Za-z0-9_]+)\/following\/?/);
  return match?.[1];
}

function pageSearchQuery(): string | undefined {
  return new URLSearchParams(location.search).get("q") ?? undefined;
}

function pageStatusContext(): { tweetId?: string; profileHandle?: string } {
  const match = location.pathname.match(/^\/+([A-Za-z0-9_]+)\/status\/(\d+)/);
  if (!match) {
    return {};
  }
  return { profileHandle: match[1], tweetId: match[2] };
}

let lastRecordedUrl = location.href;
let urlPollInterval: number | undefined;
let tweetMutationObserver: MutationObserver | undefined;
let tweetScanTimeout: number | undefined;
let followingMutationObserver: MutationObserver | undefined;
let followingScanTimeout: number | undefined;

function recordUrlChange(reason: string): void {
  const currentUrl = location.href;
  if (currentUrl === lastRecordedUrl) {
    return;
  }
  const previousUrl = lastRecordedUrl;
  lastRecordedUrl = currentUrl;
  pushSignal({
    kind: "url_change",
    observedAt: new Date().toISOString(),
    pageUrl: currentUrl,
    sourceUrl: previousUrl,
    sessionId: SESSION_ID,
    details: { reason },
  });
  syncFollowingCaptureTracking();

  if (pageKind() === "profile" || pageKind() === "following") {
    pushSignal({
      kind: "profile_visit",
      observedAt: new Date().toISOString(),
      pageUrl: currentUrl,
      sourceUrl: previousUrl,
      sessionId: SESSION_ID,
      profileHandle: pageProfileHandle() ?? pageFollowingHandle(),
    });
  }
}

function clearUrlPollInterval(): void {
  if (urlPollInterval === undefined) {
    return;
  }
  window.clearInterval(urlPollInterval);
  urlPollInterval = undefined;
}

function syncUrlPollInterval(): void {
  if (document.hidden) {
    clearUrlPollInterval();
    return;
  }
  if (urlPollInterval !== undefined) {
    return;
  }
  urlPollInterval = window.setInterval(() => recordUrlChange("poll"), URL_POLL_INTERVAL_MS);
}

function startUrlChangeTracking(): void {
  const originalPushState = history.pushState.bind(history);
  history.pushState = (...args: Parameters<History["pushState"]>) => {
    originalPushState(...args);
    recordUrlChange("pushState");
  };

  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    originalReplaceState(...args);
    recordUrlChange("replaceState");
  };

  window.addEventListener("popstate", () => recordUrlChange("popstate"));
  window.addEventListener("hashchange", () => recordUrlChange("hashchange"));
  syncUrlPollInterval();
  document.addEventListener("visibilitychange", syncUrlPollInterval);
}

function currentPageContextSignal(): Pick<
  InteractionSignal,
  "profileHandle" | "tweetId" | "searchQuery"
> {
  const kind = pageKind();
  if (kind === "profile" || kind === "following") {
    return { profileHandle: pageProfileHandle() ?? pageFollowingHandle() };
  }
  if (kind === "search") {
    return { searchQuery: pageSearchQuery() };
  }
  if (kind === "status") {
    return pageStatusContext();
  }
  return {};
}

function startTabVisibilityTracking(): void {
  document.addEventListener("visibilitychange", () => {
    pushSignal({
      kind: document.hidden ? "tab_hidden" : "tab_visible",
      observedAt: new Date().toISOString(),
      pageUrl: location.href,
      sessionId: SESSION_ID,
      ...currentPageContextSignal(),
    });
    if (document.hidden) {
      flushActiveDwellSignals();
    }
  });
}

const TWEET_VISIBILITY_OBSERVER = new IntersectionObserver(
  (entries) => {
    const now = Date.now();
    for (const entry of entries) {
      const article = entry.target as HTMLElement;
      const primaryStatus = collectStatusLinks(article)[0];
      if (!primaryStatus) {
        continue;
      }

      if (entry.isIntersecting) {
        if (!OBSERVED_TWEETS.has(primaryStatus.tweetId)) {
          OBSERVED_TWEETS.set(primaryStatus.tweetId, {
            visibleSince: now,
            profileHandle: primaryStatus.username,
          });
          pushSignal({
            kind: "tweet_visible",
            observedAt: new Date(now).toISOString(),
            pageUrl: location.href,
            sessionId: SESSION_ID,
            tweetId: primaryStatus.tweetId,
            profileHandle: primaryStatus.username,
            confidence: Math.round(entry.intersectionRatio * 100) / 100,
            details: { intersectionRatio: entry.intersectionRatio },
          });
        }
      } else {
        const state = OBSERVED_TWEETS.get(primaryStatus.tweetId);
        if (state?.visibleSince) {
          const durationMs = now - state.visibleSince;
          if (durationMs >= 500) {
            pushSignal({
              kind: "tweet_dwell",
              observedAt: new Date(now).toISOString(),
              durationMs,
              pageUrl: location.href,
              sessionId: SESSION_ID,
              tweetId: primaryStatus.tweetId,
              profileHandle: primaryStatus.username,
              details: { intersectionRatio: entry.intersectionRatio },
            });
          }
        }
        OBSERVED_TWEETS.delete(primaryStatus.tweetId);
      }
    }
  },
  { threshold: TWEET_VISIBILITY_THRESHOLDS },
);

function observeTweetArticle(article: HTMLElement): void {
  if (OBSERVED_ARTICLES.has(article)) {
    return;
  }
  OBSERVED_ARTICLES.add(article);
  TWEET_VISIBILITY_OBSERVER.observe(article);
}

function observeExistingTweetArticles(): void {
  if (document.hidden) {
    return;
  }
  for (const article of document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')) {
    observeTweetArticle(article);
  }
}

function scheduleTweetArticleScan(): void {
  if (document.hidden || tweetScanTimeout !== undefined) {
    return;
  }
  tweetScanTimeout = window.setTimeout(() => {
    tweetScanTimeout = undefined;
    observeExistingTweetArticles();
  }, MUTATION_SCAN_DEBOUNCE_MS);
}

function clearTweetArticleScan(): void {
  if (tweetScanTimeout === undefined) {
    return;
  }
  window.clearTimeout(tweetScanTimeout);
  tweetScanTimeout = undefined;
}

function stopTweetVisibilityTracking(): void {
  clearTweetArticleScan();
  tweetMutationObserver?.disconnect();
  tweetMutationObserver = undefined;
  TWEET_VISIBILITY_OBSERVER.disconnect();
  OBSERVED_ARTICLES = new WeakSet<HTMLElement>();
  flushActiveDwellSignals();
  OBSERVED_TWEETS.clear();
}

function startVisibleTweetVisibilityTracking(): void {
  if (document.hidden || tweetMutationObserver !== undefined) {
    return;
  }
  observeExistingTweetArticles();
  tweetMutationObserver = new MutationObserver(scheduleTweetArticleScan);

  if (document.body) {
    tweetMutationObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (!document.hidden) {
          tweetMutationObserver?.observe(document.body, { childList: true, subtree: true });
        }
      },
      { once: true },
    );
  }
}

function syncTweetVisibilityTracking(): void {
  if (document.hidden) {
    stopTweetVisibilityTracking();
    return;
  }
  startVisibleTweetVisibilityTracking();
}

function startTweetVisibilityTracking(): void {
  syncTweetVisibilityTracking();
  document.addEventListener("visibilitychange", syncTweetVisibilityTracking);
}

const CONTROL_TEST_IDS = new Set([
  "like",
  "unlike",
  "bookmark",
  "removeBookmark",
  "reply",
  "retweet",
  "share",
  "caretdown",
  "caret",
]);

function startControlClickTracking(): void {
  document.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const target = event.target;

      const controlElement = target.closest<HTMLElement>("[data-testid]");
      const testId = controlElement?.getAttribute("data-testid") ?? undefined;

      const article = target.closest<HTMLElement>("article");
      const statusLink = article ? collectStatusLinks(article)[0] : undefined;

      const expandedThread = testId === "tweet" && statusLink !== undefined;
      const isKnownControl = testId ? CONTROL_TEST_IDS.has(testId) : false;

      if (!isKnownControl && !expandedThread) {
        return;
      }

      const kind: SignalKind = expandedThread ? "thread_expand" : "control_click";
      const confidence = expandedThread ? 0.8 : 1;

      pushSignal({
        kind,
        observedAt: new Date().toISOString(),
        pageUrl: location.href,
        sessionId: SESSION_ID,
        tweetId: statusLink?.tweetId,
        profileHandle: statusLink?.username,
        confidence,
        details: {
          testId,
          tagName: target.tagName.toLowerCase(),
          ...(statusLink ? { statusUrl: statusLink.href } : {}),
        },
      });
    },
    { capture: true, passive: true },
  );
}

function startSignalCapture(): void {
  startUrlChangeTracking();
  startTabVisibilityTracking();
  startTweetVisibilityTracking();
  syncFollowingCaptureTracking();
  startControlClickTracking();
  pushSignal({
    kind: "page_load",
    observedAt: new Date().toISOString(),
    pageUrl: location.href,
    sessionId: SESSION_ID,
    ...currentPageContextSignal(),
  });

  if (pageKind() === "profile" || pageKind() === "following") {
    pushSignal({
      kind: "profile_visit",
      observedAt: new Date().toISOString(),
      pageUrl: location.href,
      sessionId: SESSION_ID,
      profileHandle: pageProfileHandle() ?? pageFollowingHandle(),
    });
  }

  window.addEventListener("beforeunload", () => {
    clearUrlPollInterval();
    stopTweetVisibilityTracking();
    stopFollowingCaptureTracking();
  });
}

function pageKind(): string {
  const path = location.pathname;
  if (path === "/i/bookmarks") {
    return "bookmarks";
  }
  if (/^\/[A-Za-z0-9_]+\/status\/\d+/.test(path)) {
    return "status";
  }
  if (/^\/[A-Za-z0-9_]+\/following/.test(path)) {
    return "following";
  }
  if (/^\/[A-Za-z0-9_]+$/.test(path)) {
    return "profile";
  }
  if (path === "/search") {
    return "search";
  }
  return "timeline";
}

function isCaptureBlocked(): string | undefined {
  const path = location.pathname;
  if (BLOCKED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return "Capture is disabled on messages, notifications, topics, settings, and compose pages.";
  }

  const bodyText = document.body?.innerText ?? "";
  if (
    bodyText.includes("These posts are protected") ||
    bodyText.includes("You’re unable to view these posts because this account owner limits who can view their posts")
  ) {
    return "Capture is disabled on protected-account pages.";
  }

  return undefined;
}


function tweetArticles(): HTMLElement[] {
  const primary = Array.from(document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]'));
  const candidates = primary.length > 0 ? primary : Array.from(document.querySelectorAll<HTMLElement>("article"));
  return candidates.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
  });
}

function parseStatusLink(rawHref: string): StatusLink | null {
  const url = new URL(rawHref, location.href);
  const match = url.pathname.match(/^\/(?:i\/web\/)?([A-Za-z0-9_]+)\/status\/(\d+)/);
  if (!match) {
    return null;
  }

  const [, username, tweetId] = match;
  return {
    href: `https://x.com/${username}/status/${tweetId}`,
    username,
    tweetId,
  };
}

function collectStatusLinks(root: ParentNode): StatusLink[] {
  const links: StatusLink[] = [];
  const seen = new Set<string>();

  const pushLink = (anchor: HTMLAnchorElement | null) => {
    if (!anchor) {
      return;
    }

    const parsed = parseStatusLink(anchor.href);
    if (!parsed || seen.has(parsed.href)) {
      return;
    }

    seen.add(parsed.href);
    links.push(parsed);
  };

  for (const timeElement of root.querySelectorAll("a[href*='/status/'] time")) {
    pushLink(timeElement.closest("a"));
  }

  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a[href*='/status/']")) {
    pushLink(anchor);
  }

  return links;
}

function collectMediaUrls(root: ParentNode): string[] {
  const urls = new Set<string>();

  for (const image of root.querySelectorAll<HTMLImageElement>("img")) {
    const src = image.currentSrc || image.src || image.getAttribute("src") || "";
    if (src.includes("twimg.com/media") || src.includes("pbs.twimg.com/media")) {
      urls.add(src);
    }
  }

  for (const video of root.querySelectorAll<HTMLVideoElement>("video")) {
    if (video.currentSrc) {
      urls.add(video.currentSrc);
    }
    if (video.poster) {
      urls.add(video.poster);
    }

    for (const source of video.querySelectorAll<HTMLSourceElement>("source")) {
      if (source.src) {
        urls.add(source.src);
      }
    }
  }

  return Array.from(urls);
}

function tweetText(root: HTMLElement): string {
  const tweetTextNode = root.querySelector<HTMLElement>('[data-testid="tweetText"]');
  const preferredText = tweetTextNode?.innerText.trim();
  if (preferredText) {
    return preferredText;
  }

  const langNodes = Array.from(root.querySelectorAll<HTMLElement>("div[lang], span[lang]"))
    .map((node) => node.innerText.trim())
    .filter(Boolean);
  if (langNodes.length > 0) {
    return Array.from(new Set(langNodes)).join("\n");
  }

  return root.innerText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function replyContext(root: ParentNode): string | undefined {
  for (const candidate of root.querySelectorAll<HTMLElement>("span, div")) {
    const text = candidate.innerText.trim();
    if (text.startsWith("Replying to @")) {
      return text;
    }
  }
  return undefined;
}


function extractFollowingAccounts(): FollowingAccountRecord[] {
  const records = new Map<string, FollowingAccountRecord>();
  const baseUrl = "https://x.com";

  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href^='/']")) {
    const usernameMatch = link.pathname.match(/^\/+([A-Za-z0-9_]{1,15})\/?$/);
    if (!usernameMatch) {
      continue;
    }
    const username = usernameMatch[1];
    const usernameKey = username.toLowerCase();
    if (NON_PROFILE_PATHS[usernameKey] || records.has(usernameKey)) {
      continue;
    }

    const cell = link.closest<HTMLElement>("[data-testid='cellInnerDiv']") ?? link.closest<HTMLElement>("div[role='row']") ?? link.parentElement;
    if (!cell) {
      continue;
    }
    if (!cell.innerText.includes(`@${username}`)) {
      continue;
    }


    const avatar = cell.querySelector<HTMLImageElement>("img[src*='/profile_images/']") ??
      cell.querySelector<HTMLImageElement>("img[alt]:not([alt=''])") ??
      Array.from(cell.querySelectorAll<HTMLImageElement>("img")).find((image) => image.width >= 32 || image.height >= 32);

    const displayName = extractDisplayNameFromCell(cell, username);
    const profileUrl = `${baseUrl}/${username}`;
    const avatarUrl = avatar?.currentSrc || avatar?.src || undefined;

    records.set(usernameKey, {
      username,
      displayName,
      profileUrl,
      avatarUrl,
    });
  }

  return Array.from(records.values());
}


function followingSessionAccounts(sourceHandle: string): Map<string, FollowingAccountRecord> {
  const key = sourceHandle.toLowerCase();
  const existing = FOLLOWING_ACCOUNTS_BY_SOURCE.get(key);
  if (existing) {
    return existing;
  }

  const sessionAccounts = new Map<string, FollowingAccountRecord>();
  FOLLOWING_ACCOUNTS_BY_SOURCE.set(key, sessionAccounts);
  return sessionAccounts;
}

function mergeFollowingAccount(
  sourceHandle: string,
  existing: FollowingAccountRecord | undefined,
  observed: FollowingAccountRecord,
): FollowingAccountRecord {
  return {
    username: observed.username,
    displayName: observed.displayName ?? existing?.displayName,
    profileUrl: observed.profileUrl ?? existing?.profileUrl,
    avatarUrl: observed.avatarUrl ?? existing?.avatarUrl,
    sourceHandle,
    pageKind: "following",
  };
}

function rememberFollowingAccounts(sourceHandle: string, observedAccounts: readonly FollowingAccountRecord[]): void {
  const sessionAccounts = followingSessionAccounts(sourceHandle);
  for (const observed of observedAccounts) {
    if (!observed.username) {
      continue;
    }
    const key = observed.username.toLowerCase();
    sessionAccounts.set(key, mergeFollowingAccount(sourceHandle, sessionAccounts.get(key), observed));
  }
}


function scanCurrentFollowingPage(): void {
  const sourceHandle = pageFollowingHandle();
  if (!sourceHandle) {
    return;
  }

  rememberFollowingAccounts(sourceHandle, extractFollowingAccounts());
}

function followingAccountsForCapture(sourceHandle: string): FollowingAccountRecord[] {
  scanCurrentFollowingPage();
  return Array.from(followingSessionAccounts(sourceHandle).values());
}

function clearFollowingAccountScan(): void {
  if (followingScanTimeout === undefined) {
    return;
  }
  window.clearTimeout(followingScanTimeout);
  followingScanTimeout = undefined;
}

function scheduleFollowingAccountScan(): void {
  if (pageKind() !== "following") {
    stopFollowingCaptureTracking();
    return;
  }
  if (followingScanTimeout !== undefined) {
    return;
  }
  followingScanTimeout = window.setTimeout(() => {
    followingScanTimeout = undefined;
    scanCurrentFollowingPage();
  }, MUTATION_SCAN_DEBOUNCE_MS);
}

function stopFollowingCaptureTracking(): void {
  clearFollowingAccountScan();
  followingMutationObserver?.disconnect();
  followingMutationObserver = undefined;
}

function startFollowingMutationObserver(): void {
  if (pageKind() !== "following" || followingMutationObserver !== undefined) {
    return;
  }

  scanCurrentFollowingPage();
  followingMutationObserver = new MutationObserver(scheduleFollowingAccountScan);

  if (document.body) {
    followingMutationObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (pageKind() === "following") {
          followingMutationObserver?.observe(document.body, { childList: true, subtree: true });
          scanCurrentFollowingPage();
        }
      },
      { once: true },
    );
  }
}

function syncFollowingCaptureTracking(): void {
  if (pageKind() !== "following") {
    stopFollowingCaptureTracking();
    return;
  }
  startFollowingMutationObserver();
}


function extractDisplayNameFromCell(cell: HTMLElement, username: string): string | undefined {
  const ownText = Array.from(cell.childNodes)
    .filter((node): node is Text => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent?.trim())
    .filter((text): text is string => Boolean(text) && text.length > 0 && text !== `@${username}` && !text.startsWith("@"));
  if (ownText.length > 0) {
    return ownText[0];
  }

  for (const span of cell.querySelectorAll<HTMLElement>("span")) {
    const text = span.innerText.trim();
    if (text.length > 0 && text !== `@${username}` && !text.startsWith("@") && text.length < 80) {
      return text;
    }
  }

  return undefined;
}

function readMoreAffordanceText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(?:show\s+more|read\s+more|see\s+more)$/.test(normalized);
}

function hasReadMoreAffordance(article: HTMLElement): boolean {
  for (const element of article.querySelectorAll<HTMLElement>("button, a, span, div[role='button']")) {
    const visibleText = element.innerText?.trim() || element.getAttribute("aria-label")?.trim() || "";
    if (readMoreAffordanceText(visibleText)) {
      return true;
    }
  }
  return false;
}

function isLongPostCandidate(article: HTMLElement): boolean {
  return hasReadMoreAffordance(article);
}

function extractVisibleTweets(): VisibleTweetRecord[] {
  const records = new Map<string, VisibleTweetRecord>();
  const currentPageKind = pageKind();

  for (const article of tweetArticles()) {
    const statusLinks = collectStatusLinks(article);
    const primaryStatus = statusLinks[0];
    if (!primaryStatus) {
      continue;
    }

    const fullText = tweetText(article);
    if (!fullText) {
      continue;
    }

    const quoteStatusUrl = statusLinks.find((link) => link.tweetId !== primaryStatus.tweetId)?.href;

    records.set(primaryStatus.tweetId, {
      tweetId: primaryStatus.tweetId,
      statusUrl: primaryStatus.href,
      username: primaryStatus.username,
      fullText,
      mediaUrls: collectMediaUrls(article),
      replyContext: replyContext(article),
      quoteStatusUrl,
      createdAt: article.querySelector<HTMLTimeElement>("time")?.dateTime?.trim() || undefined,
      pageKind: currentPageKind,
      hasReadMore: hasReadMoreAffordance(article),
      isLongPostCandidate: isLongPostCandidate(article),
    });
  }

  return Array.from(records.values());
}

function flushActiveDwellSignals(): void {
  const now = Date.now();
  for (const [tweetId, state] of OBSERVED_TWEETS.entries()) {
    if (!state.visibleSince) {
      continue;
    }
    const durationMs = now - state.visibleSince;
    if (durationMs >= 500) {
      pushSignal({
        kind: "tweet_dwell",
        observedAt: new Date(now).toISOString(),
        durationMs,
        pageUrl: location.href,
        sessionId: SESSION_ID,
        tweetId,
        profileHandle: state.profileHandle,
        details: { flushed: true },
      });
      state.visibleSince = now;
    }
  }
}

function buildCaptureResponse(): CaptureResponse {
  flushActiveDwellSignals();
  const blockedReason = isCaptureBlocked();
  const recentSignals = SIGNALS.slice();
  const currentPageKind = pageKind();
  const followingSourceHandle = currentPageKind === "following" ? pageFollowingHandle() : undefined;
  if (blockedReason) {
    return {
      ok: false,
      pageUrl: location.href,
      pageTitle: document.title,
      pageKind: currentPageKind,
      error: blockedReason,
      signals: recentSignals,
    };
  }

  return {
    ok: true,
    pageUrl: location.href,
    pageTitle: document.title,
    pageKind: currentPageKind,
    visibleTweets: extractVisibleTweets(),
    followingAccounts: followingSourceHandle ? followingAccountsForCapture(followingSourceHandle) : undefined,
    followingSourceHandle,
    signals: recentSignals,
  };
}

function ackSignals(signalIds: readonly string[]): void {
  if (signalIds.length === 0) {
    return;
  }
  const acked = new Set(signalIds);
  for (let index = SIGNALS.length - 1; index >= 0; index -= 1) {
    if (acked.has(SIGNALS[index]?.signalId ?? "")) {
      SIGNALS.splice(index, 1);
    }
  }
}

type RuntimeMessage = {
  type?: string;
  signalIds?: readonly string[];
};


startSignalCapture();

chrome.runtime.onMessage.addListener((message: RuntimeMessage | null, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "twitter-archive:ack-signals") {
    ackSignals(Array.isArray(message.signalIds) ? message.signalIds : []);
    sendResponse({ ok: true });
    return;
  }

  if (message.type !== "twitter-archive:capture-visible") {
    return;
  }

  sendResponse(buildCaptureResponse());
});
