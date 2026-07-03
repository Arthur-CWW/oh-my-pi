export type AutoDiscardScope = "x-only" | "all-tabs" | "match-patterns";

export interface AutoDiscardSettings {
  enabled: boolean;
  idleMinutes: number;
  scope: AutoDiscardScope;
  includePatterns: string[];
  excludePatterns: string[];
  skipPinned: boolean;
  skipAudible: boolean;
}

export interface AutoDiscardState {
  settings: AutoDiscardSettings;
  lastRunAt: number | null;
  lastDiscardCount: number;
  lastError: string | null;
}

export type RuntimeMessage =
  | { type: "getState" }
  | { type: "setSettings"; settings: AutoDiscardSettings }
  | { type: "discardNow" };

export interface DiscardNowResponse extends AutoDiscardState {
  discardedCount: number;
}

export const DEFAULT_EXCLUDE_PATTERNS = [
  "*://x.com/messages*",
  "*://x.com/compose/*",
  "*://x.com/i/spaces*",
  "*://twitter.com/messages*",
  "*://twitter.com/compose/*",
  "*://twitter.com/i/spaces*",
] as const;

export const DEFAULT_SETTINGS: AutoDiscardSettings = {
  enabled: true,
  idleMinutes: 15,
  scope: "x-only",
  includePatterns: [],
  excludePatterns: [...DEFAULT_EXCLUDE_PATTERNS],
  skipPinned: true,
  skipAudible: true,
};

export const DEFAULT_STATE: AutoDiscardState = {
  settings: DEFAULT_SETTINGS,
  lastRunAt: null,
  lastDiscardCount: 0,
  lastError: null,
};

function sanitizePatternList(value: string[]): string[] {
  const seen = new Set<string>();
  const patterns: string[] = [];

  for (const rawPattern of value) {
    const pattern = rawPattern.trim();
    if (pattern.length === 0 || seen.has(pattern)) {
      continue;
    }
    seen.add(pattern);
    patterns.push(pattern);
  }

  return patterns;
}

export function sanitizeSettings(value: AutoDiscardSettings): AutoDiscardSettings {
  const idleMinutes = Number.isFinite(value.idleMinutes)
    ? Math.min(24 * 60, Math.max(1, Math.round(value.idleMinutes)))
    : DEFAULT_SETTINGS.idleMinutes;

  const scope: AutoDiscardScope =
    value.scope === "all-tabs" || value.scope === "match-patterns" || value.scope === "x-only"
      ? value.scope
      : DEFAULT_SETTINGS.scope;

  return {
    enabled: value.enabled === true,
    idleMinutes,
    scope,
    includePatterns: sanitizePatternList(value.includePatterns),
    excludePatterns: sanitizePatternList(value.excludePatterns),
    skipPinned: value.skipPinned !== false,
    skipAudible: value.skipAudible !== false,
  };
}
