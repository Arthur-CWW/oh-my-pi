import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { type Component, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { getProjectDir } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import { settings } from "../../../config/settings";
import type { AgentSession } from "../../../session/agent-session";
import * as git from "../../../utils/git";
import { sanitizeStatusText } from "../../shared";
import { getThemeEpoch, theme } from "../../theme/theme";
import { BorderMemo, GitBorderCache } from "./border-cache";
import { canReuseCachedPr, createPrCacheContext, isSamePrCacheContext, type PrCacheContext } from "./git-utils";
import { recordBorderRebuild } from "./performance-counters";
import { getPreset } from "./presets";
import { renderSegment, type SegmentContext } from "./segments";
import { getSeparator } from "./separators";
import type {
	CollabStatus,
	EffectiveStatusLineSettings,
	StatusLineSegmentId,
	StatusLineSegmentOptions,
	StatusLineSettings,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Context-usage memo
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cheap structural fingerprint of a message's tokenizable content. It avoids
 * serializing streamed tool arguments on every status refresh.
 */
function messageFingerprint(msg: AgentMessage): number {
	let hash = 2166136261;
	const mix = (value: number): void => {
		hash = Math.imul(hash ^ value, 16777619);
	};
	const measure = (value: unknown, depth: number): void => {
		if (depth > 8 || value === null || value === undefined) return;
		switch (typeof value) {
			case "string":
				mix(value.length);
				return;
			case "number":
				mix(Number.isFinite(value) ? Math.trunc(value) : 0);
				return;
			case "boolean":
				mix(value ? 1 : 0);
				return;
			case "object":
				if (Array.isArray(value)) {
					mix(value.length);
					for (const item of value) measure(item, depth + 1);
					return;
				}
				for (const key in value as Record<string, unknown>) {
					mix(key.length);
					measure((value as Record<string, unknown>)[key], depth + 1);
				}
				return;
			default:
				return;
		}
	};

	const role = (msg as { role?: string }).role ?? "";
	mix(role.length);
	mix((msg as { timestamp?: number }).timestamp ?? 0);
	if (role === "bashExecution") {
		const bash = msg as { command?: unknown; output?: unknown };
		measure(bash.command, 0);
		measure(bash.output, 0);
	} else if (role === "user" || role === "assistant" || role === "toolResult" || role === "hookMessage") {
		measure((msg as { content?: unknown }).content, 0);
	} else if (role === "branchSummary" || role === "compactionSummary") {
		measure((msg as { summary?: unknown }).summary, 0);
	}
	return hash >>> 0;
}

interface ContextUsageMemo {
	messagesRef: readonly AgentMessage[];
	length: number;
	lastFingerprint: number | undefined;
	modelContextWindow: number;
	usedTokens: number | null;
	contextWindow: number;
}

const EMPTY_MESSAGES: readonly AgentMessage[] = [];

function hasContextSegment(segments: readonly StatusLineSegmentId[]): boolean {
	return segments.includes("context_pct") || segments.includes("context_total");
}

// ═══════════════════════════════════════════════════════════════════════════
// StatusLineComponent
// ═══════════════════════════════════════════════════════════════════════════

export class StatusLineComponent implements Component {
	#settings: StatusLineSettings = {};
	#effectiveSettings: EffectiveStatusLineSettings | undefined;
	#onBranchChange: (() => void) | null = null;
	readonly #gitCache = new GitBorderCache(
		() => this.#markStatusDirty(),
		() => this.#onBranchChange?.(),
		() => {
			this.#cachedPrContext = undefined;
		},
	);
	#statusRevision = 0;
	readonly #borderMemo = new BorderMemo();
	#autoCompactEnabled: boolean = true;
	#hookStatuses: Map<string, string> = new Map();
	#subagentCount: number = 0;
	#sessionStartTime: number = Date.now();
	#planModeStatus: { enabled: boolean; paused: boolean } | null = null;
	#loopModeStatus: { enabled: boolean } | null = null;
	#goalModeStatus: { enabled: boolean; paused: boolean } | null = null;
	#collabStatus: CollabStatus | null = null;
	#focusedAgentId: string | undefined;

	// PR lookup caching (invalidated on branch/repo context changes)
	#cachedPr: { number: number; url: string } | null | undefined = undefined;
	#cachedPrContext: PrCacheContext | undefined = undefined;
	#prLookupInFlight = false;
	#defaultBranch?: string;

	// Anthropic usage caching (5-min TTL, OAuth/sub only)
	#cachedUsage: {
		fiveHour?: { percent: number; resetMinutes?: number };
		sevenDay?: { percent: number; resetHours?: number };
	} | null = null;
	#usageFetchedAt = 0;
	#usageInFlight = false;
	// Context-usage memo. The status line redraws on every agent event, so the
	// hot path must not recompute context tokens unless an input changed.
	// `getContextUsage()` anchors on the last assistant's real prompt-token
	// count (matching the provider and the `/context` panel), so a stable
	// message list + model window yields a stable result we can return verbatim.
	#contextUsageCache: ContextUsageMemo | undefined;

	readonly #mainSession: AgentSession;

	constructor(private session: AgentSession) {
		this.#mainSession = session;
		this.#settings = {
			preset: settings.get("statusLine.preset"),
			leftSegments: settings.get("statusLine.leftSegments"),
			rightSegments: settings.get("statusLine.rightSegments"),
			separator: settings.get("statusLine.separator"),
			showHookStatus: settings.get("statusLine.showHookStatus"),
			segmentOptions: settings.getGroup("statusLine").segmentOptions,
			sessionAccent: settings.get("statusLine.sessionAccent"),
			transparent: settings.get("statusLine.transparent"),
		};
	}

	/**
	 * Re-point the status line at another session (focus proxy). Invalidate: model/context/usage all derive
	 * from it. `focusedAgentId` is the focused subagent id while the view is proxied, undefined for main.
	 */
	setSession(session: AgentSession, focusedAgentId?: string): void {
		const sessionChanged = this.session !== session;
		if (!sessionChanged && this.#focusedAgentId === focusedAgentId) return;
		this.session = session;
		this.#focusedAgentId = focusedAgentId;
		if (sessionChanged) this.#invalidateSessionCaches();
		this.#markStatusDirty();
	}

	updateSettings(settings: StatusLineSettings): void {
		this.#settings = settings;
		this.#effectiveSettings = undefined;
		this.#markStatusDirty();
	}

	getEffectiveSettingsForTest(): EffectiveStatusLineSettings {
		return this.#resolveSettings();
	}

	setAutoCompactEnabled(enabled: boolean): void {
		if (this.#autoCompactEnabled === enabled) return;
		this.#autoCompactEnabled = enabled;
		this.#markStatusDirty();
	}

	setSubagentCount(count: number): void {
		if (this.#subagentCount === count) return;
		this.#subagentCount = count;
		this.#markStatusDirty();
	}

	/** Active subagent count as currently displayed (collab state mirroring). */
	get subagentCount(): number {
		return this.#subagentCount;
	}

	setSessionStartTime(time: number): void {
		if (this.#sessionStartTime === time) return;
		this.#sessionStartTime = time;
		this.#markStatusDirty();
	}

	setPlanModeStatus(status: { enabled: boolean; paused: boolean } | undefined): void {
		const next = status ?? null;
		if (this.#planModeStatus?.enabled === next?.enabled && this.#planModeStatus?.paused === next?.paused) return;
		this.#planModeStatus = next;
		this.#markStatusDirty();
	}

	setLoopModeStatus(status: { enabled: boolean } | undefined): void {
		const next = status ?? null;
		if (this.#loopModeStatus?.enabled === next?.enabled) return;
		this.#loopModeStatus = next;
		this.#markStatusDirty();
	}

	setGoalModeStatus(status: { enabled: boolean; paused: boolean } | undefined): void {
		const next = status ?? null;
		if (this.#goalModeStatus?.enabled === next?.enabled && this.#goalModeStatus?.paused === next?.paused) return;
		this.#goalModeStatus = next;
		this.#markStatusDirty();
	}

	setCollabStatus(status: CollabStatus | null): void {
		if (this.#collabStatus === status) return;
		this.#collabStatus = status;
		this.#markStatusDirty();
	}

	setHookStatus(key: string, text: string | undefined): void {
		const previous = this.#hookStatuses.get(key);
		if (text === undefined) {
			if (!this.#hookStatuses.delete(key)) return;
		} else {
			if (previous === text) return;
			this.#hookStatuses.set(key, text);
		}
		this.#markStatusDirty();
	}

	watchBranch(onBranchChange: () => void): void {
		this.#onBranchChange = onBranchChange;
		void this.#gitCache.refreshBranch();
	}

	refreshGitBranch(): Promise<void> {
		return this.#gitCache.refreshBranch();
	}

	dispose(): void {
		this.#gitCache.dispose();
	}

	invalidate(): void {
		this.#markStatusDirty();
	}

	#markStatusDirty(): void {
		this.#statusRevision++;
	}

	#invalidateSessionCaches(): void {
		this.#cachedUsage = null;
		this.#usageFetchedAt = 0;
		this.#usageInFlight = false;
		this.#contextUsageCache = undefined;
	}

	#isDefaultBranch(branch: string): boolean {
		if (this.#defaultBranch === undefined) {
			this.#defaultBranch = "main";
			(async () => {
				const resolved = await git.branch.default(getProjectDir());
				if (resolved && resolved !== this.#defaultBranch) {
					this.#defaultBranch = resolved;
					this.#markStatusDirty();
					this.#onBranchChange?.();
				}
			})();
		}
		return branch === this.#defaultBranch;
	}

	#getGitStatus(): { staged: number; unstaged: number; untracked: number } | null {
		return this.#gitCache.getStatus();
	}

	#lookupPr(): { number: number; url: string } | null {
		const branch = this.#gitCache.getBranch();
		const currentContext = branch ? createPrCacheContext(branch, this.#gitCache.branchRepoId ?? null) : null;

		if (canReuseCachedPr(this.#cachedPr, this.#cachedPrContext, currentContext)) {
			return this.#cachedPr ?? null;
		}

		const stalePr = this.#cachedPr;

		// Don't look up if no branch, detached HEAD, default branch, or already in flight
		if (!branch || branch === "detached" || this.#isDefaultBranch(branch) || this.#prLookupInFlight) {
			return stalePr ?? null;
		}

		this.#prLookupInFlight = true;
		const lookupContext = currentContext;

		// Fire async lookup, keep stale value visible until resolved
		(async () => {
			let prChanged = false;
			// Helper: only write cache if branch/repo context hasn't changed since launch
			const setCachedPr = (value: { number: number; url: string } | null) => {
				const latestBranch = this.#gitCache.getBranch();
				const latestContext = latestBranch
					? createPrCacheContext(latestBranch, this.#gitCache.branchRepoId ?? null)
					: undefined;
				if (lookupContext && isSamePrCacheContext(latestContext, lookupContext)) {
					prChanged =
						this.#cachedPr?.number !== value?.number ||
						this.#cachedPr?.url !== value?.url ||
						!isSamePrCacheContext(this.#cachedPrContext, lookupContext);
					this.#cachedPr = value;
					this.#cachedPrContext = lookupContext;
				}
			};
			try {
				// Requires `gh repo set-default` to be configured; fails gracefully if not
				const result = await $`gh pr view --json number,url`.quiet().nothrow();
				if (result.exitCode !== 0) {
					setCachedPr(null);
					return;
				}
				const pr = JSON.parse(result.stdout.toString()) as { number: number; url: string };
				if (typeof pr.number === "number") {
					setCachedPr({ number: pr.number, url: pr.url });
				} else {
					setCachedPr(null);
				}
			} catch {
				setCachedPr(null);
			} finally {
				this.#prLookupInFlight = false;
				if (prChanged) {
					this.#markStatusDirty();
					this.#onBranchChange?.();
				}
			}
		})();

		return stalePr ?? null;
	}

	/**
	 * Background-refresh the Anthropic OAuth quota report. Guarded by a 5-min
	 * TTL on both success (cache lifetime) and error (backoff). Exposed
	 * (non-private) so unit tests can verify the backoff invariant.
	 */
	refreshUsageInBackground(): void {
		const now = Date.now();
		if (this.#usageInFlight) return;
		if (this.#usageFetchedAt > 0 && now - this.#usageFetchedAt < 5 * 60_000) return;
		const session = this.session;
		const fetcher = (session as { fetchUsageReports?: () => Promise<unknown> }).fetchUsageReports;
		if (typeof fetcher !== "function") return;
		this.#usageInFlight = true;
		void fetcher
			.call(session)
			.then(reports => {
				if (this.session !== session) return;
				this.#cachedUsage = this.#normalizeUsageReports(reports);
				this.#usageFetchedAt = Date.now();
				this.#markStatusDirty();
				this.#onBranchChange?.();
			})
			.catch(() => {
				if (this.session !== session) return;
				// Backoff on error: stamp the fetch time so the 5-min TTL guard
				// also acts as an error budget. Without this, every render
				// kicks off another fetch (gated only by #usageInFlight),
				// which hammers the endpoint during a network outage / 5xx.
				this.#usageFetchedAt = Date.now();
			})
			.finally(() => {
				if (this.session === session) this.#usageInFlight = false;
			});
	}

	#normalizeUsageReports(reports: unknown): {
		fiveHour?: { percent: number; resetMinutes?: number };
		sevenDay?: { percent: number; resetHours?: number };
	} | null {
		if (!Array.isArray(reports)) return null;
		let fiveHour: { percent: number; resetMinutes?: number } | undefined;
		let sevenDay: { percent: number; resetHours?: number } | undefined;
		const now = Date.now();
		for (const report of reports) {
			if (!report || typeof report !== "object") continue;
			const limits = (report as { limits?: unknown }).limits;
			if (!Array.isArray(limits)) continue;
			for (const limit of limits) {
				if (!limit || typeof limit !== "object") continue;
				const l = limit as {
					scope?: { windowId?: string; tier?: string };
					window?: { resetsAt?: number };
					amount?: { usedFraction?: number };
				};
				const fraction = l.amount?.usedFraction;
				if (typeof fraction !== "number") continue;
				const windowId = l.scope?.windowId;
				const tier = l.scope?.tier;
				const resetsAt = l.window?.resetsAt;
				if (windowId === "5h" && !tier && !fiveHour) {
					fiveHour = {
						percent: fraction * 100,
						resetMinutes:
							typeof resetsAt === "number" ? Math.max(0, Math.round((resetsAt - now) / 60_000)) : undefined,
					};
				} else if (windowId === "7d" && !tier && !sevenDay) {
					sevenDay = {
						percent: fraction * 100,
						resetHours:
							typeof resetsAt === "number" ? Math.max(0, Math.round((resetsAt - now) / 3_600_000)) : undefined,
					};
				}
			}
		}
		if (!fiveHour && !sevenDay) return null;
		return { fiveHour, sevenDay };
	}

	/**
	 * Used-tokens / context-window totals for the status-line context% segment,
	 * memoized so the per-event redraw stays O(1) when nothing changed.
	 *
	 * The numerator comes from `session.getContextUsage()`, which anchors on the
	 * last assistant's real prompt-token count — so the bar matches the provider
	 * and the `/context` panel — and reports `null` while that count is unknown
	 * (right after compaction, before the next response). Exposed (non-private)
	 * for unit tests and the collab host's state broadcast.
	 */
	getCachedContextBreakdown(): { usedTokens: number | null; contextWindow: number } {
		const messages = this.session.messages ?? EMPTY_MESSAGES;
		const modelContextWindow = this.session.model?.contextWindow ?? 0;
		const length = messages.length;
		const lastFingerprint = length > 0 ? messageFingerprint(messages[length - 1]!) : undefined;

		const cache = this.#contextUsageCache;
		if (
			cache &&
			cache.messagesRef === messages &&
			cache.length === length &&
			cache.lastFingerprint === lastFingerprint &&
			cache.modelContextWindow === modelContextWindow
		) {
			return { usedTokens: cache.usedTokens, contextWindow: cache.contextWindow };
		}

		const usage = this.session.getContextUsage();
		const usedTokens = usage?.tokens ?? null;
		const contextWindow = usage?.contextWindow ?? modelContextWindow;
		this.#contextUsageCache = {
			messagesRef: messages,
			length,
			lastFingerprint,
			modelContextWindow,
			usedTokens,
			contextWindow,
		};
		return { usedTokens, contextWindow };
	}
	#buildSegmentContext(
		width: number,
		segmentOptions: StatusLineSettings["segmentOptions"],
		includeContext: boolean,
		includeGit: boolean,
		includePr: boolean,
	): SegmentContext {
		const state = this.session.state;

		// Trigger background fetch (5-min TTL); render uses cached value
		this.refreshUsageInBackground();

		// Get usage statistics
		const aggregateUsageStats = this.session.sessionManager?.getUsageStatistics() ?? {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			premiumRequests: 0,
			cost: 0,
		};
		const usageStats = aggregateUsageStats;

		const model = state.model ?? this.session.model;
		let contextWindow = model?.contextWindow ?? 0;
		let contextWindowSource = model?.codex?.contextWindowSource;
		let contextPercent: number | null = 0;
		if (includeContext) {
			const breakdown = this.getCachedContextBreakdown();
			contextWindow = breakdown.contextWindow || contextWindow;
			contextPercent =
				breakdown.usedTokens === null ? null : contextWindow > 0 ? (breakdown.usedTokens / contextWindow) * 100 : 0;
		}

		// Collab guest: context comes from the host's state frames — the local
		// replica does no accounting of its own.
		const collabState = this.#collabStatus?.stateOverride;
		if (collabState?.contextUsage) {
			contextWindow = collabState.contextUsage.contextWindow || contextWindow;
			contextPercent = collabState.contextUsage.percent ?? contextPercent;
			contextWindowSource = undefined;
		}

		return {
			session: this.session,
			mainSession: this.#mainSession,
			focusedAgentId: this.#focusedAgentId,
			width,
			options: segmentOptions ?? {},
			planMode: this.#planModeStatus,
			loopMode: this.#loopModeStatus,
			goalMode: this.#goalModeStatus,
			collab: this.#collabStatus,
			usageStats,
			contextPercent,
			contextWindow,
			contextWindowSource,
			autoCompactEnabled: this.#autoCompactEnabled,
			subagentCount: this.#subagentCount,
			sessionStartTime: this.#sessionStartTime,
			git: {
				branch: includeGit || includePr ? this.#gitCache.getBranch() : null,
				status: includeGit ? this.#getGitStatus() : null,
				pr: includePr ? this.#lookupPr() : null,
			},
			usage: this.#cachedUsage,
		};
	}

	#resolveSettings(): EffectiveStatusLineSettings {
		if (this.#effectiveSettings === undefined) {
			this.#effectiveSettings = this.#computeEffectiveSettings();
		}
		return this.#effectiveSettings;
	}

	#computeEffectiveSettings(): EffectiveStatusLineSettings {
		const preset = this.#settings.preset ?? "default";
		const presetDef = getPreset(preset);
		const useCustomSegments = preset === "custom";
		const mergedSegmentOptions: StatusLineSettings["segmentOptions"] = {};

		for (const [segment, options] of Object.entries(presetDef.segmentOptions ?? {})) {
			mergedSegmentOptions[segment as keyof StatusLineSegmentOptions] = { ...(options as Record<string, unknown>) };
		}

		for (const [segment, options] of Object.entries(this.#settings.segmentOptions ?? {})) {
			const current = mergedSegmentOptions[segment as keyof StatusLineSegmentOptions] ?? {};
			mergedSegmentOptions[segment as keyof StatusLineSegmentOptions] = {
				...(current as Record<string, unknown>),
				...(options as Record<string, unknown>),
			};
		}

		const leftSegments = useCustomSegments
			? (this.#settings.leftSegments ?? presetDef.leftSegments)
			: presetDef.leftSegments;
		const rightSegments = useCustomSegments
			? (this.#settings.rightSegments ?? presetDef.rightSegments)
			: presetDef.rightSegments;

		return {
			...this.#settings,
			leftSegments,
			rightSegments,
			separator: this.#settings.separator ?? presetDef.separator,
			segmentOptions: mergedSegmentOptions,
		};
	}

	#buildStatusLine(width: number): string {
		recordBorderRebuild();
		const effectiveSettings = this.#resolveSettings();
		const includeContext =
			hasContextSegment(effectiveSettings.leftSegments) || hasContextSegment(effectiveSettings.rightSegments);
		const includeGit =
			effectiveSettings.leftSegments.includes("git") || effectiveSettings.rightSegments.includes("git");
		const includePr = effectiveSettings.leftSegments.includes("pr") || effectiveSettings.rightSegments.includes("pr");
		const ctx = this.#buildSegmentContext(
			width,
			effectiveSettings.segmentOptions,
			includeContext,
			includeGit,
			includePr,
		);
		const separatorDef = getSeparator(effectiveSettings.separator ?? "powerline-thin", theme);

		// `transparent` reuses the empty-string sentinel (`\x1b[49m`) so the bar
		// inherits the terminal's default background, matching custom themes that
		// set `statusLineBg: ""`. Powerline end caps need a contrasting fill to
		// bridge the bar into the surrounding terminal; without one they read as
		// stray glyphs, so the cap renderer drops them when the fill is empty.
		// Compact (borderless) presets always use transparent bg.
		const TRANSPARENT_BG_ANSI = "\x1b[49m";
		const themeBgAnsi = theme.getBgAnsi("statusLineBg");
		const forceTransparent = this.#isBorderless();
		const bgAnsi = effectiveSettings.transparent || forceTransparent ? TRANSPARENT_BG_ANSI : themeBgAnsi;
		const transparentBg = bgAnsi === TRANSPARENT_BG_ANSI;
		const fgAnsi = theme.getFgAnsi("text");
		const sepAnsi = theme.getFgAnsi("statusLineSep");

		// Collect visible segment contents
		const leftParts: string[] = [];
		const leftSegIds: StatusLineSegmentId[] = [];
		for (const segId of effectiveSettings.leftSegments) {
			const rendered = renderSegment(segId, ctx);
			if (rendered.visible && rendered.content) {
				leftParts.push(rendered.content);
				leftSegIds.push(segId);
			}
		}

		const rightParts: string[] = [];
		for (const segId of effectiveSettings.rightSegments) {
			const rendered = renderSegment(segId, ctx);
			if (rendered.visible && rendered.content) {
				rightParts.push(rendered.content);
			}
		}

		const runningBackgroundJobs = this.session.getAsyncJobSnapshot()?.running.length ?? 0;
		if (runningBackgroundJobs > 0) {
			rightParts.unshift(theme.fg("statusLineSubagents", `${theme.icon.job} ${runningBackgroundJobs}`));
		}
		const topFillWidth = Math.max(0, width);
		const left = leftParts;
		const right = rightParts;

		const leftSepWidth = visibleWidth(separatorDef.left);
		const rightSepWidth = visibleWidth(separatorDef.right);
		// Transparent mode drops powerline caps (they need a bg fill to bridge),
		// so the width budget excludes them too.
		const leftCapWidth = separatorDef.endCaps && !transparentBg ? visibleWidth(separatorDef.endCaps.right) : 0;
		const rightCapWidth = separatorDef.endCaps && !transparentBg ? visibleWidth(separatorDef.endCaps.left) : 0;

		const groupWidth = (parts: string[], capWidth: number, sepWidth: number): number => {
			if (parts.length === 0) return 0;
			const partsWidth = parts.reduce((sum, part) => sum + visibleWidth(part), 0);
			const sepTotal = Math.max(0, parts.length - 1) * (sepWidth + 2);
			return partsWidth + sepTotal + 2 + capWidth;
		};

		let leftWidth = groupWidth(left, leftCapWidth, leftSepWidth);
		let rightWidth = groupWidth(right, rightCapWidth, rightSepWidth);
		const totalWidth = () => leftWidth + rightWidth + (left.length > 0 && right.length > 0 ? 1 : 0);

		if (topFillWidth > 0) {
			while (totalWidth() > topFillWidth && right.length > 0) {
				right.pop();
				rightWidth = groupWidth(right, rightCapWidth, rightSepWidth);
			}
			// Shrink path before dropping left segments — path is the only elastic segment
			const pathIdx = leftSegIds.indexOf("path");
			if (pathIdx >= 0 && totalWidth() > topFillWidth) {
				const overflow = totalWidth() - topFillWidth;
				const currentPathVW = visibleWidth(left[pathIdx]);
				const minPathVW = 8; // icon + ellipsis + a few chars
				const shrinkable = currentPathVW - minPathVW;
				if (shrinkable > 0) {
					const shrinkBy = Math.min(shrinkable, overflow);
					const currentMaxLen = ctx.options.path?.maxLength ?? 40;
					let newMaxLen = Math.max(4, Math.min(currentMaxLen, currentPathVW) - shrinkBy);
					const pathCtx = (maxLen: number): SegmentContext => ({
						...ctx,
						options: { ...ctx.options, path: { ...ctx.options.path, maxLength: maxLen } },
					});
					let reRendered = renderSegment("path", pathCtx(newMaxLen));
					if (reRendered.visible && reRendered.content) {
						// maxLength governs path text, not icon prefix; iterate to compensate
						for (let i = 0; i < 8; i++) {
							const saved = currentPathVW - visibleWidth(reRendered.content);
							if (saved >= shrinkBy) break;
							const nextMaxLen = Math.max(4, newMaxLen - (shrinkBy - saved));
							if (nextMaxLen >= newMaxLen) break; // no progress or hit floor
							newMaxLen = nextMaxLen;
							const adjusted = renderSegment("path", pathCtx(newMaxLen));
							if (!adjusted.visible || !adjusted.content) break;
							reRendered = adjusted;
						}
						left[pathIdx] = reRendered.content;
						leftWidth = groupWidth(left, leftCapWidth, leftSepWidth);
					}
				}
			}
			while (totalWidth() > topFillWidth && left.length > 0) {
				left.pop();
				leftSegIds.pop();
				leftWidth = groupWidth(left, leftCapWidth, leftSepWidth);
			}
		}

		const renderGroup = (parts: string[], direction: "left" | "right"): string => {
			if (parts.length === 0) return "";
			const sep = direction === "left" ? separatorDef.left : separatorDef.right;
			const cap =
				separatorDef.endCaps && !transparentBg
					? direction === "left"
						? separatorDef.endCaps.right
						: separatorDef.endCaps.left
					: "";
			const capPrefix = separatorDef.endCaps?.useBgAsFg ? bgAnsi.replace("\x1b[48;", "\x1b[38;") : bgAnsi + sepAnsi;
			const capText = cap ? `${capPrefix}${cap}\x1b[0m` : "";

			let content = bgAnsi + fgAnsi;
			content += ` ${parts.join(` ${sepAnsi}${sep}${fgAnsi} `)} `;
			content += "\x1b[0m";

			if (capText) {
				return direction === "right" ? capText + content : content + capText;
			}
			return content;
		};

		const leftGroup = renderGroup(left, "left");
		const rightGroup = renderGroup(right, "right");
		if (!leftGroup && !rightGroup) return "";

		if (topFillWidth === 0 || left.length === 0 || right.length === 0) {
			return leftGroup + (leftGroup && rightGroup ? " " : "") + rightGroup;
		}

		const gapWidth = Math.max(1, topFillWidth - leftWidth - rightWidth);
		return leftGroup + " ".repeat(gapWidth) + rightGroup;
	}

	#liveBorderBucket(): number {
		const effectiveSettings = this.#resolveSettings();
		const showsTokenRate =
			effectiveSettings.leftSegments.includes("token_rate") || effectiveSettings.rightSegments.includes("token_rate");
		return showsTokenRate && this.#mainSession.isStreaming ? Math.floor(Date.now() / 1000) : 0;
	}

	#getCachedStatusLine(width: number): string {
		const liveBucket = this.#liveBorderBucket();
		const themeEpoch = getThemeEpoch();
		const cached = this.#borderMemo.get(width, this.#statusRevision, liveBucket, themeEpoch);
		if (cached !== undefined) return cached;
		const content = this.#buildStatusLine(width);
		this.#borderMemo.set(width, this.#statusRevision, liveBucket, themeEpoch, content);
		return content;
	}

	/** Whether the preset renders as a standalone row above a borderless editor. */
	#isBorderless(): boolean {
		return (this.#settings.preset ?? "default") === "compact";
	}

	/** Whether the active preset uses a standalone (borderless) layout. */
	isBorderless(): boolean {
		return this.#isBorderless();
	}

	getTopBorder(width: number): { content: string; width: number } {
		// In borderless mode, the status row is rendered by render(), not the editor border
		if (this.#isBorderless()) {
			return { content: "", width: 0 };
		}
		let content = this.#getCachedStatusLine(width);
		if (this.#focusedAgentId && content) {
			// Dim the whole bar while focus-proxied. Group/cap terminators emit full
			// `\x1b[0m` resets that would cancel faint mid-bar, so re-open it after each.
			content = `\x1b[2m${content.replaceAll("\x1b[0m", "\x1b[0m\x1b[2m")}\x1b[22m`;
		}
		return {
			content,
			width: visibleWidth(content),
		};
	}

	render(width: number): readonly string[] {
		const lines: string[] = [];

		// In borderless mode, render the full status line as a standalone row
		if (this.#isBorderless()) {
			let statusRow = this.#getCachedStatusLine(width);
			if (statusRow) {
				if (this.#focusedAgentId) {
					statusRow = `\x1b[2m${statusRow.replaceAll("\x1b[0m", "\x1b[0m\x1b[2m")}\x1b[22m`;
				}
				lines.push(truncateToWidth(statusRow, width));
			}
		}

		// Hook statuses (rendered in all modes)
		const showHooks = this.#settings.showHookStatus ?? true;
		if (showHooks && this.#hookStatuses.size > 0) {
			const sortedStatuses = Array.from(this.#hookStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const hookLine = sortedStatuses.join(" ");
			lines.push(truncateToWidth(hookLine, width));
		}

		return lines;
	}
}
