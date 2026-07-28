import { beforeAll, describe, expect, it } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { TreeSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/tree-selector";
import * as themeModule from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { SessionEntry, SessionTreeNode } from "@oh-my-pi/pi-coding-agent/session/session-entries";

let counter = 0;
function makeNode(role: "user" | "assistant", text: string, parentId: string | null = null): SessionTreeNode {
	const id = `e${counter++}`;
	const message: AgentMessage =
		role === "user"
			? { role: "user", content: text, timestamp: counter }
			: ({
					role: "assistant",
					content: [{ type: "text", text }],
					timestamp: counter,
					stopReason: "stop",
				} as AgentMessage);
	const entry: SessionEntry = {
		type: "message",
		id,
		parentId,
		timestamp: new Date().toISOString(),
		message,
	};
	return { entry, children: [] };
}

function chain(parent: SessionTreeNode, ...specs: Array<["user" | "assistant", string]>): SessionTreeNode {
	let cur = parent;
	for (const [role, text] of specs) {
		const n = makeNode(role, text, cur.entry.id);
		cur.children.push(n);
		cur = n;
	}
	return cur;
}

function renderStripped(tree: SessionTreeNode[], leafId: string, width = 120): string[] {
	const selector = new TreeSelectorComponent(
		tree,
		leafId,
		60,
		() => {},
		() => {},
	);
	return selector.render(width).map(line => Bun.stripANSI(line));
}

// Issue #2325 tree shape: a parent that branches into several sub-sessions
// where the LAST sibling (`└─`) carries a chain of flattened message rows
// that itself branches again deeper down.
describe("issue #2325: connectors terminate at `└─` and chain columns stay stable", () => {
	beforeAll(async () => {
		await themeModule.initTheme(false, undefined, undefined, "dark", "light");
	});

	it("renders no vertical in the `└─` corner column and keeps chain rows on one anchor column", () => {
		counter = 0;
		const root = makeNode("user", "proceed with implementation");
		const asst = chain(root, ["assistant", "resp"]);
		const b1 = makeNode("user", "first review head", asst.entry.id);
		const b2 = makeNode("user", "plain review head", asst.entry.id);
		const b3 = makeNode("user", "second review head", asst.entry.id);
		asst.children.push(b1, b2, b3);
		const leaf = chain(b1, ["assistant", "b1 reply"], ["user", "active leaf"]);

		// Chain under the LAST sibling b3, with a branch point partway down.
		const fixIt = chain(b3, ["assistant", "fix-asst"], ["user", "fix it all"]);
		const revAsst = chain(fixIt, ["assistant", "rev-asst"]);
		const t1 = makeNode("user", "review the fixes", revAsst.entry.id);
		const t2 = makeNode("user", "other thread", revAsst.entry.id);
		revAsst.children.push(t1, t2);
		chain(t1, ["user", "all findings done"], ["user", "still have findings"]);

		const rendered = renderStripped([root], leaf.entry.id);
		const findRow = (needle: string): string => {
			const row = rendered.find(line => line.includes(needle));
			if (!row) throw new Error(`row containing ${JSON.stringify(needle)} not rendered`);
			return row;
		};

		// Hierarchy reads from indentation — no tree/branch glyphs anywhere.
		expect(rendered.every(line => !/[│├└]/.test(line))).toBe(true);
		const indentOf = (line: string): number => line.match(/^ */)![0].length;

		// The chain under the last-sibling branch stays aligned on one column,
		// indented deeper than the branch head.
		const b3Indent = indentOf(findRow("user: second review head"));
		const chainIndents = ["assistant: fix-asst", "user: fix it all", "assistant: rev-asst"].map(needle =>
			indentOf(findRow(needle)),
		);
		for (const indent of chainIndents) {
			expect(indent).toBeGreaterThan(b3Indent);
			expect(indent).toBe(chainIndents[0]);
		}

		// The deeper branch point renders aligned siblings, and their linear
		// continuations stay indented under that branch — no drift to outer columns.
		const t1Indent = indentOf(findRow("user: review the fixes"));
		const t2Indent = indentOf(findRow("user: other thread"));
		expect(t1Indent).toBe(t2Indent);
		expect(t1Indent).toBeGreaterThanOrEqual(chainIndents[0]!);
		for (const needle of ["user: all findings done", "user: still have findings"]) {
			expect(indentOf(findRow(needle))).toBeGreaterThanOrEqual(t1Indent);
		}
	});
});
