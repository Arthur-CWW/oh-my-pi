import { describe, expect, test } from "bun:test";
import {
	FALLBACK_BROWSER_TAB_GROUP,
	groupedBrowserTabName,
	ownedBrowserContextKey,
	resolveBrowserTabGroup,
} from "../../src/tools/browser/tab-group";

describe("browser workstream tab grouping", () => {
	test("tabs in one workstream share naming and owned browser context", () => {
		const firstGroup = resolveBrowserTabGroup({ kind: "workstream", id: "primer" });
		const secondGroup = resolveBrowserTabGroup({ kind: "workstream", id: "primer" });
		const first = groupedBrowserTabName(firstGroup, "research");
		const second = groupedBrowserTabName(secondGroup, "sources");

		expect(first).toBe("[primer] research");
		expect(second).toBe("[primer] sources");
		expect(ownedBrowserContextKey(true, firstGroup)).toBe(ownedBrowserContextKey(true, secondGroup));
	});

	test("different workstreams isolate labels and owned browser contexts", () => {
		const primer = resolveBrowserTabGroup({ kind: "workstream", id: "primer" });
		const harness = resolveBrowserTabGroup({ kind: "workstream", id: "harness" });

		expect(groupedBrowserTabName(primer, "main")).not.toBe(groupedBrowserTabName(harness, "main"));
		expect(ownedBrowserContextKey(true, primer)).not.toBe(ownedBrowserContextKey(true, harness));
	});

	test("unclassified sessions fall back to the adhoc group", () => {
		const group = resolveBrowserTabGroup(undefined);

		expect(group).toBe(FALLBACK_BROWSER_TAB_GROUP);
		expect(groupedBrowserTabName(group, "main")).toBe("[adhoc] main");
		expect(ownedBrowserContextKey(false, group)).toBe("headless:0:workstream:adhoc");
	});
});
