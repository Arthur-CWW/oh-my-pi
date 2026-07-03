import type { AutoDiscardSettings } from "./settings";

export interface CandidateTab {
  id?: number;
  url?: string;
  active?: boolean;
  pinned?: boolean;
  audible?: boolean;
  discarded?: boolean;
}

export interface DiscardPolicyOptions {
  requireIdle: boolean;
}

export interface DiscardDecision {
  shouldDiscard: boolean;
  reason: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesWildcardPattern(url: string, pattern: string): boolean {
  if (pattern.trim().length === 0) {
    return false;
  }

  const expression = `^${pattern.split("*").map(escapeRegExp).join(".*")}$`;
  return new RegExp(expression).test(url);
}

function isHttpOrHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isXOrTwitterUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === "x.com" ||
      hostname.endsWith(".x.com") ||
      hostname === "twitter.com" ||
      hostname.endsWith(".twitter.com")
    );
  } catch {
    return false;
  }
}

export function matchesConfiguredScope(url: string, settings: AutoDiscardSettings): boolean {
  if (!isHttpOrHttpsUrl(url)) {
    return false;
  }

  if (settings.excludePatterns.some((pattern) => matchesWildcardPattern(url, pattern))) {
    return false;
  }

  switch (settings.scope) {
    case "x-only":
      return isXOrTwitterUrl(url);
    case "all-tabs":
      return true;
    case "match-patterns":
      return settings.includePatterns.some((pattern) => matchesWildcardPattern(url, pattern));
  }
}

export function shouldDiscardTab(
  tab: CandidateTab,
  settings: AutoDiscardSettings,
  lastViewedAt: number | undefined,
  now: number,
  options: DiscardPolicyOptions,
): DiscardDecision {
  if (!settings.enabled) {
    return { shouldDiscard: false, reason: "disabled" };
  }

  if (typeof tab.id !== "number") {
    return { shouldDiscard: false, reason: "missing-tab-id" };
  }

  if (tab.active) {
    return { shouldDiscard: false, reason: "active" };
  }

  if (tab.discarded) {
    return { shouldDiscard: false, reason: "already-discarded" };
  }

  if (settings.skipPinned && tab.pinned) {
    return { shouldDiscard: false, reason: "pinned" };
  }

  if (settings.skipAudible && tab.audible) {
    return { shouldDiscard: false, reason: "audible" };
  }

  if (!tab.url || !matchesConfiguredScope(tab.url, settings)) {
    return { shouldDiscard: false, reason: "unmatched" };
  }

  if (!options.requireIdle) {
    return { shouldDiscard: true, reason: "manual-match" };
  }

  if (typeof lastViewedAt !== "number") {
    return { shouldDiscard: false, reason: "untracked" };
  }

  const idleMilliseconds = settings.idleMinutes * 60 * 1000;
  if (now - lastViewedAt < idleMilliseconds) {
    return { shouldDiscard: false, reason: "not-idle" };
  }

  return { shouldDiscard: true, reason: "idle-match" };
}

export function findDiscardCandidates(
  tabs: CandidateTab[],
  settings: AutoDiscardSettings,
  lastViewedAtByTabId: Record<number, number>,
  now: number,
  options: DiscardPolicyOptions,
): number[] {
  const candidates: number[] = [];

  for (const tab of tabs) {
    const decision = shouldDiscardTab(tab, settings, tab.id ? lastViewedAtByTabId[tab.id] : undefined, now, options);
    if (decision.shouldDiscard && typeof tab.id === "number") {
      candidates.push(tab.id);
    }
  }

  return candidates;
}
