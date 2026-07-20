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

describe("issue #2298: chain rows under last-sibling branches keep their gutter", () => {
	beforeAll(async () => {
		await themeModule.initTheme(false, undefined, undefined, "dark", "light");
	});

	// The bug rendered the conversation chain under a `└─` branch with bare
	// spaces, breaking the visual flow back to the parent message. The fix
	// anchors chain descendants (rows without their own connector) with a `│`
	// one level right of the suppressed gutter — directly below the branch
	// head's content — never in the `└─` corner column itself (#2325).
	it("draws the inherited `│` for chain descendants of a last-sibling branch", () => {
		const root = makeNode("user", "original");
		const rootAsst = makeNode("assistant", "resp", root.entry.id);
		root.children.push(rootAsst);

		// rootAsst branches; branch2 is active (renders first), branch1 is last.
		const branch1 = makeNode("user", "branch1 head", rootAsst.entry.id);
		const branch2 = makeNode("user", "branch2 head", rootAsst.entry.id);
		rootAsst.children.push(branch1, branch2);

		// Chain descendants under branch1 (the LAST sibling) — these are the
		// rows that used to lose the gutter.
		const chain1 = makeNode("assistant", "chain-asst-1", branch1.entry.id);
		branch1.children.push(chain1);
		const chain2 = makeNode("user", "chain-user-2", chain1.entry.id);
		chain1.children.push(chain2);

		const fixIt = makeNode("user", "fix it all", branch2.entry.id);
		branch2.children.push(fixIt);

		const rendered = renderStripped([root], fixIt.entry.id);

		const findRow = (needle: string): string => {
			const row = rendered.find(line => line.includes(needle));
			if (!row) throw new Error(`row containing ${JSON.stringify(needle)} not rendered`);
			return row;
		};

		// Hierarchy reads from indentation — no tree/branch glyphs anywhere.
		expect(rendered.every(line => !/[│├└]/.test(line))).toBe(true);
		const indentOf = (line: string): number => line.match(/^ */)![0].length;
		// Chain descendants of the last-sibling branch stay indented under the
		// branch head and aligned with each other (no leftward drift to root).
		const branch1Indent = indentOf(findRow("user: branch1 head"));
		const chain1Indent = indentOf(findRow("assistant: chain-asst-1"));
		const chain2Indent = indentOf(findRow("user: chain-user-2"));
		expect(chain1Indent).toBeGreaterThanOrEqual(branch1Indent);
		expect(chain2Indent).toBe(chain1Indent);
	});

	// Branched grandchildren and their continuations must stay on the standard
	// tree convention so a `│` never floats below an unrelated `└─`. Only the
	// nearest connector gutter is extended for chain rows.
	it("does not extend the gutter through branched descendants of a last-sibling parent", () => {
		const root = makeNode("user", "original");
		const rootAsst = makeNode("assistant", "resp", root.entry.id);
		root.children.push(rootAsst);

		const branch1 = makeNode("user", "branch1 head", rootAsst.entry.id);
		const branch2 = makeNode("user", "branch2 head", rootAsst.entry.id);
		rootAsst.children.push(branch1, branch2);

		// branch1 itself branches into c, d (both have their own connectors),
		// and each grandchild continues linearly.
		const c = makeNode("user", "grandchild c", branch1.entry.id);
		const d = makeNode("user", "grandchild d", branch1.entry.id);
		branch1.children.push(c, d);
		const cContinuation = makeNode("assistant", "c continuation", c.entry.id);
		c.children.push(cContinuation);
		const dContinuation = makeNode("assistant", "d continuation", d.entry.id);
		d.children.push(dContinuation);

		const fixIt = makeNode("user", "fix it all", branch2.entry.id);
		branch2.children.push(fixIt);

		const rendered = renderStripped([root], fixIt.entry.id);

		// Hierarchy reads from indentation — no tree/branch glyphs anywhere.
		expect(rendered.every(line => !/[│├└]/.test(line))).toBe(true);
		const indentOf = (line: string): number => line.match(/^ */)![0].length;
		const rowFor = (needle: string): string => {
			const row = rendered.find(line => line.includes(needle));
			if (!row) throw new Error(`row containing ${JSON.stringify(needle)} not rendered`);
			return row;
		};
		// Branched grandchildren render as aligned siblings; their linear
		// continuations stay indented under their own parent, never drifting left.
		const cIndent = indentOf(rowFor("grandchild c"));
		const dIndent = indentOf(rowFor("grandchild d"));
		expect(cIndent).toBe(dIndent);
		expect(indentOf(rowFor("c continuation"))).toBeGreaterThanOrEqual(cIndent);
		expect(indentOf(rowFor("d continuation"))).toBeGreaterThanOrEqual(dIndent);
	});
});
