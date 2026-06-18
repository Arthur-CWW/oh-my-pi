import type { CaptureTarget } from "./capture-types";

/**
 * Validates if a URL is allowed under the safety policy.
 * Blocks: private/DM/settings/bookmarks/likes/notifications.
 */
export function checkUrlPolicy(urlStr: string): { allowed: boolean; reason?: string } {
  try {
    // Standardize URL parsing
    const url = new URL(urlStr, "https://x.com");
    const pathname = url.pathname.toLowerCase();

    // 1. Direct Messages (DMs)
    if (pathname === "/messages" || pathname.startsWith("/messages/")) {
      return { allowed: false, reason: "Direct Messages (DMs) are blocked for safety." };
    }

    // 2. Settings
    if (pathname === "/settings" || pathname.startsWith("/settings/")) {
      return { allowed: false, reason: "Settings pages are blocked for safety." };
    }

    // 3. Bookmarks
    if (
      pathname === "/bookmarks" ||
      pathname.startsWith("/bookmarks/") ||
      pathname === "/i/bookmarks" ||
      pathname.startsWith("/i/bookmarks/")
    ) {
      return { allowed: false, reason: "Bookmarks are blocked for safety." };
    }

    // 4. Notifications
    if (
      pathname === "/notifications" ||
      pathname.startsWith("/notifications/") ||
      pathname === "/i/notifications" ||
      pathname.startsWith("/i/notifications/")
    ) {
      return { allowed: false, reason: "Notifications are blocked for safety." };
    }

    // 5. Likes (e.g. /username/likes or /i/likes or /likes)
    if (
      pathname === "/likes" ||
      pathname.startsWith("/likes/") ||
      pathname.endsWith("/likes") ||
      pathname.endsWith("/likes/")
    ) {
      return { allowed: false, reason: "Likes are blocked for safety." };
    }

    return { allowed: true };
  } catch (error) {
    return { allowed: false, reason: `Invalid target URL: ${urlStr}` };
  }
}

/**
 * Validates a CaptureTarget against the safety policy.
 */
export function checkCaptureTargetPolicy(target: CaptureTarget): { allowed: boolean; reason?: string } {
  // Reject unsafe target types explicitly
  const unsafeTypes = ["direct-messages", "settings", "bookmarks", "likes", "notifications"];
  if (unsafeTypes.includes(target.type)) {
    return { allowed: false, reason: `Target type '${target.type}' is unsafe and blocked.` };
  }

  // Reject protected/private accounts
  if (target.protected === true) {
    return { allowed: false, reason: "Protected/private user accounts are blocked for safety." };
  }

  // If the target value looks like a URL/path, check it against the URL policy
  if (
    target.value.startsWith("http://") ||
    target.value.startsWith("https://") ||
    target.value.startsWith("/")
  ) {
    return checkUrlPolicy(target.value);
  }

  return { allowed: true };
}
