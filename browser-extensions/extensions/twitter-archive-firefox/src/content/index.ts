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

function pageKind(): string {
  const path = location.pathname;
  if (path === "/i/bookmarks") {
    return "bookmarks";
  }
  if (/^\/[A-Za-z0-9_]+\/status\/\d+/.test(path)) {
    return "status";
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
    });
  }

  return Array.from(records.values());
}

function buildCaptureResponse(): CaptureResponse {
  const blockedReason = isCaptureBlocked();
  if (blockedReason) {
    return {
      ok: false,
      pageUrl: location.href,
      pageTitle: document.title,
      pageKind: pageKind(),
      error: blockedReason,
    };
  }

  return {
    ok: true,
    pageUrl: location.href,
    pageTitle: document.title,
    pageKind: pageKind(),
    visibleTweets: extractVisibleTweets(),
  };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }

  const messageType = (message as { type?: unknown }).type;
  if (messageType !== "twitter-archive:capture-visible") {
    return;
  }

  sendResponse(buildCaptureResponse());
});
