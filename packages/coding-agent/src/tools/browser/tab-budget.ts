import { ToolError } from "../tool-errors";

export const DEFAULT_MAX_TABS_PER_SESSION = 4;
export const DEFAULT_MAX_GLOBAL_TABS = 12;

export type BrowserTabBudgetScope = "session" | "global";

export interface BrowserTabBudgetRecord {
	name: string;
	sessionId: string;
	createdAt: number;
	lastUsedAt: number;
	idle: boolean;
}

export interface BrowserTabBudgetConsumer {
	sessionId: string;
	count: number;
}

/** Typed refusal raised when tab admission cannot stay within its configured cap. */
export class BrowserTabBudgetError extends ToolError {
	readonly code = "BROWSER_TAB_RESOURCE_CAP_REACHED" as const;

	constructor(
		readonly scope: BrowserTabBudgetScope,
		readonly limit: number,
		readonly sessionId: string,
		readonly consumers: readonly BrowserTabBudgetConsumer[],
	) {
		const consumerText = consumers.length
			? consumers.map(consumer => `- session ${JSON.stringify(consumer.sessionId)}: ${consumer.count} tab(s)`).join("\n")
			: "- no active tab details available";
		const scopeLabel = scope === "session" ? `session ${JSON.stringify(sessionId)}` : "machine";
		super(
			`Cannot open browser tab: ${scopeLabel} tab cap (${limit}) is reached. Top tab consumers:\n${consumerText}\n` +
				"Close an idle tab and retry.",
			{
				code: "BROWSER_TAB_RESOURCE_CAP_REACHED",
				scope,
				limit,
				sessionId,
				consumers,
			},
		);
		this.name = "BrowserTabBudgetError";
	}
}

export function normalizeTabBudgetCap(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function summarizeTabConsumers(records: readonly BrowserTabBudgetRecord[]): BrowserTabBudgetConsumer[] {
	const counts = new Map<string, number>();
	for (const record of records) counts.set(record.sessionId, (counts.get(record.sessionId) ?? 0) + 1);
	return [...counts]
		.map(([sessionId, count]) => ({ sessionId, count }))
		.sort((left, right) => right.count - left.count || left.sessionId.localeCompare(right.sessionId));
}

export function oldestIdleTab(
	records: readonly BrowserTabBudgetRecord[],
	sessionId?: string,
): BrowserTabBudgetRecord | undefined {
	return records
		.filter(record => record.idle && (sessionId === undefined || record.sessionId === sessionId))
		.sort((left, right) => left.lastUsedAt - right.lastUsedAt || left.createdAt - right.createdAt || left.name.localeCompare(right.name))[0];
}

export interface EnforceTabBudgetOptions {
	sessionId: string;
	maxTabsPerSession: number;
	maxGlobalTabs: number;
	records: () => readonly BrowserTabBudgetRecord[];
	reclaim: (record: BrowserTabBudgetRecord) => Promise<void>;
}

/**
 * Admit one new tab, reclaiming the oldest idle tab in the requesting session
 * when its cap is full. Global exhaustion is a typed refusal with attribution.
 */
export async function enforceTabBudget(options: EnforceTabBudgetOptions): Promise<void> {
	const maxTabsPerSession = normalizeTabBudgetCap(options.maxTabsPerSession, DEFAULT_MAX_TABS_PER_SESSION);
	const maxGlobalTabs = normalizeTabBudgetCap(options.maxGlobalTabs, DEFAULT_MAX_GLOBAL_TABS);
	for (;;) {
		const records = [...options.records()];
		const sessionRecords = records.filter(record => record.sessionId === options.sessionId);
		if (sessionRecords.length < maxTabsPerSession && records.length < maxGlobalTabs) return;

		if (sessionRecords.length >= maxTabsPerSession) {
			const candidate = oldestIdleTab(sessionRecords);
			if (!candidate) {
				throw new BrowserTabBudgetError("session", maxTabsPerSession, options.sessionId, summarizeTabConsumers(records));
			}
			await options.reclaim(candidate);
			continue;
		}

		if (records.length >= maxGlobalTabs) {
			throw new BrowserTabBudgetError("global", maxGlobalTabs, options.sessionId, summarizeTabConsumers(records));
		}
	}
}
