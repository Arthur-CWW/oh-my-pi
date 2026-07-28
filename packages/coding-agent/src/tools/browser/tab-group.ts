import type { SessionWorkstream } from "../../session/session-entries";

export const FALLBACK_BROWSER_TAB_GROUP = "adhoc";

/** Resolve the durable session classification used to group browser resources. */
export function resolveBrowserTabGroup(workstream: SessionWorkstream | undefined): string {
	return workstream?.kind === "workstream" ? workstream.id : FALLBACK_BROWSER_TAB_GROUP;
}

/**
 * Puppeteer and cmux do not expose a portable browser-tab-group API. Encode the
 * real grouping in the tab label instead of pretending either driver grouped it.
 */
export function groupedBrowserTabName(group: string, name: string): string {
	const prefix = `[${group}] `;
	return name.startsWith(prefix) ? name : `${prefix}${name}`;
}

/** Owned Chromium processes are shared only inside one workstream trust boundary. */
export function ownedBrowserContextKey(headless: boolean, group: string): string {
	return `headless:${headless ? "1" : "0"}:workstream:${group}`;
}
