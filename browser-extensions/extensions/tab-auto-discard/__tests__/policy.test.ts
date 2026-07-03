import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { findDiscardCandidates, matchesConfiguredScope, matchesWildcardPattern, shouldDiscardTab } from "../utils/policy";

const NOW = 1_000_000;

const xTab = {
  id: 1,
  url: "https://x.com/someone/status/123",
  active: false,
  pinned: false,
  audible: false,
  discarded: false,
};

describe("matchesWildcardPattern", () => {
  it("matches browser-style wildcard URL patterns", () => {
    expect(matchesWildcardPattern("https://x.com/messages/123", "*://x.com/messages*")).toBe(true);
    expect(matchesWildcardPattern("https://mobile.twitter.com/home", "*://*.twitter.com/*")).toBe(true);
    expect(matchesWildcardPattern("https://example.com/home", "*://x.com/*")).toBe(false);
  });
});

describe("matchesConfiguredScope", () => {
  it("matches X and Twitter by default", () => {
    expect(matchesConfiguredScope("https://x.com/home", DEFAULT_SETTINGS)).toBe(true);
    expect(matchesConfiguredScope("https://twitter.com/home", DEFAULT_SETTINGS)).toBe(true);
    expect(matchesConfiguredScope("https://example.com/home", DEFAULT_SETTINGS)).toBe(false);
  });

  it("honors default X compose and message exclusions", () => {
    expect(matchesConfiguredScope("https://x.com/messages/123", DEFAULT_SETTINGS)).toBe(false);
    expect(matchesConfiguredScope("https://twitter.com/compose/post", DEFAULT_SETTINGS)).toBe(false);
  });

  it("supports all-tab and custom pattern scopes", () => {
    expect(matchesConfiguredScope("https://example.com/home", { ...DEFAULT_SETTINGS, scope: "all-tabs" })).toBe(true);
    expect(
      matchesConfiguredScope("https://notion.so/page", {
        ...DEFAULT_SETTINGS,
        scope: "match-patterns",
        includePatterns: ["*://*.notion.so/*", "*://notion.so/*"],
      }),
    ).toBe(true);
  });
});

describe("shouldDiscardTab", () => {
  it("discards an inactive matching tab after the idle threshold", () => {
    expect(
      shouldDiscardTab(xTab, DEFAULT_SETTINGS, NOW - 16 * 60 * 1000, NOW, { requireIdle: true }).shouldDiscard,
    ).toBe(true);
  });

  it("keeps active, pinned, audible, recently viewed, and already discarded tabs", () => {
    expect(shouldDiscardTab({ ...xTab, active: true }, DEFAULT_SETTINGS, NOW - 20 * 60 * 1000, NOW, { requireIdle: true }).reason).toBe(
      "active",
    );
    expect(shouldDiscardTab({ ...xTab, pinned: true }, DEFAULT_SETTINGS, NOW - 20 * 60 * 1000, NOW, { requireIdle: true }).reason).toBe(
      "pinned",
    );
    expect(shouldDiscardTab({ ...xTab, audible: true }, DEFAULT_SETTINGS, NOW - 20 * 60 * 1000, NOW, { requireIdle: true }).reason).toBe(
      "audible",
    );
    expect(shouldDiscardTab({ ...xTab, discarded: true }, DEFAULT_SETTINGS, NOW - 20 * 60 * 1000, NOW, { requireIdle: true }).reason).toBe(
      "already-discarded",
    );
    expect(shouldDiscardTab(xTab, DEFAULT_SETTINGS, NOW - 5 * 60 * 1000, NOW, { requireIdle: true }).reason).toBe("not-idle");
  });

  it("manual discard mode skips the idle threshold but keeps safety filters", () => {
    expect(shouldDiscardTab(xTab, DEFAULT_SETTINGS, NOW, NOW, { requireIdle: false }).shouldDiscard).toBe(true);
    expect(shouldDiscardTab({ ...xTab, active: true }, DEFAULT_SETTINGS, NOW, NOW, { requireIdle: false }).reason).toBe("active");
  });
});

describe("findDiscardCandidates", () => {
  it("returns only tabs matching policy", () => {
    expect(
      findDiscardCandidates(
        [
          xTab,
          { ...xTab, id: 2, active: true },
          { ...xTab, id: 3, url: "https://example.com" },
          { ...xTab, id: 4, url: "https://twitter.com/home" },
        ],
        DEFAULT_SETTINGS,
        {
          1: NOW - 20 * 60 * 1000,
          2: NOW - 20 * 60 * 1000,
          3: NOW - 20 * 60 * 1000,
          4: NOW - 20 * 60 * 1000,
        },
        NOW,
        { requireIdle: true },
      ),
    ).toEqual([1, 4]);
  });
});
