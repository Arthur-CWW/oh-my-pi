import { describe, expect, it } from "bun:test";
import type { KeyId } from "@oh-my-pi/pi-tui";
import * as Schema from "effect/Schema";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { buildCopyTargets } from "../src/modes/utils/copy-targets";
import {
	createCopySelectorModel,
	updateCopySelector,
} from "../src/modes/components/copy-selector";
import {
	createSessionTreeModel,
	type SessionTreeNavigationSettled,
	sessionTreeActionToMsg,
	updateSessionTree,
} from "../src/modes/components/tree-selector";
import type { SessionEntry, SessionTreeNode } from "../src/session/session-entries";
import { makeTreeModel, updateTree } from "../src/modes/mvu/tree";
import type { KeyEvent } from "../src/modes/mvu/schema";
import {
	createPrimitiveInspectorState,
	drillIntoPrimitive,
	movePrimitiveSelection,
	replacePrimitiveSource,
	type PrimitiveInspectorCategory,
	unwindPrimitiveInspector,
} from "../src/modes/components/primitives-inspector-state";

function assistant(text: string, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function node(id: string, parentId: string | null, label?: string): SessionTreeNode {
	const entry: SessionEntry = {
		type: "message",
		id,
		parentId,
		timestamp: String(id),
		message: { role: "user", content: id, timestamp: 1 },
	};
	return {
		entry,
		children: [],
		label,
	};
}

const categories: readonly PrimitiveInspectorCategory[] = [
	{ id: "tools", label: "Tools", source: "live", available: true, items: [
		{ id: "read", label: "Read", summary: "read files", detail: "schema" },
		{ id: "write", label: "Write", summary: "write files", detail: "schema" },
	] },
	{ id: "session", label: "Session", source: "session", available: true, items: [] },
];

const SessionTreeNavigationSettledSchema: Schema.ConstraintDecoder<SessionTreeNavigationSettled, never> = Schema.toType(
	Schema.Struct({
		_tag: Schema.Literal("NavigationSettled"),
		targetId: Schema.String,
		requestGeneration: Schema.Number,
		sourceRevision: Schema.Number,
		leaseGeneration: Schema.optional(Schema.Number),
		status: Schema.Literals(["success", "cancelled", "aborted", "failed"]),
		editorText: Schema.optional(Schema.String),
		error: Schema.optional(Schema.String),
	}),
);

describe("Slice 5 stable keyed adapters", () => {
	it("toggles expansion and commits the captured typed label draft", () => {
		const collapsed = makeTreeModel(
			["root"],
			new Map([["root", ["child"]], ["child", []]]),
			new Map([["root", "Root"], ["child", "Child"]]),
		);
		const expanded = updateTree(collapsed, { _tag: "ToggleExpanded" }).model;
		expect(expanded.expanded.has("root")).toBe(true);
		expect(expanded.visibleIds).toEqual(["root", "child"]);
		const child = updateTree(expanded, { _tag: "Move", delta: 1 }).model;
		const editing = updateTree(child, { _tag: "BeginLabelEdit", draft: "draft" }).model;
		const appended = updateTree(editing, { _tag: "LabelAppend", text: "!" }).model;
		const deleted = updateTree(appended, { _tag: "LabelDelete" }).model;
		const committed = updateTree(deleted, { _tag: "CommitLabel" });
		expect(committed.commands).toEqual([{ _tag: "LabelCommitted", id: "child", label: "draft" }]);
		expect(committed.model.labelEdit).toBeUndefined();
		const collapsedAgain = updateTree(committed.model, { _tag: "ToggleExpanded", id: "root" }).model;
		expect(collapsedAgain.expanded.has("root")).toBe(false);
		expect(collapsedAgain.visibleIds).toEqual(["root"]);
	});
	it("maps semantic label edit actions to typed tree messages", () => {
		const press = (key: string, text?: string): KeyEvent => ({
			_tag: "Press",
			key: key as KeyId,
			...(text === undefined ? {} : { text }),
		}) as KeyEvent;
		expect(sessionTreeActionToMsg("app.tree.labelAppend", press("x", "x"))).toEqual({
			_tag: "LabelAppend",
			text: "x",
		});
		expect(sessionTreeActionToMsg("app.tree.labelDelete", press("backspace"))).toEqual({ _tag: "LabelDelete" });
		expect(sessionTreeActionToMsg("app.tree.labelCommit", press("enter"))).toEqual({ _tag: "CommitLabel" });
	});

	it("keeps copy identities stable when transcript order changes", () => {
		const source = (messages: readonly AgentMessage[]) => ({ messages, getLastVisibleHandoffText: () => undefined });
		const first = buildCopyTargets(source([assistant("old", 1), assistant("new", 2)]));
		const reordered = buildCopyTargets(source([assistant("new", 2), assistant("old", 1)]));
		expect(reordered.map(target => target.id).sort()).toEqual(first.map(target => target.id).sort());
		const model = createCopySelectorModel(first);
		const moved = updateCopySelector(model, { _tag: "Move", delta: 1 }).model;
		const refreshed = updateCopySelector(moved, { _tag: "TargetsReplaced", sourceRevision: 2, targets: reordered }).model;
		expect(refreshed.tree.selectedId).toBe(moved.tree.selectedId);
	});

	it("returns from Copy preview without losing the stable selection", () => {
		const source = (messages: readonly AgentMessage[]) => ({ messages, getLastVisibleHandoffText: () => undefined });
		const targets = buildCopyTargets(source([assistant("copy me", 1)]));
		const model = createCopySelectorModel(targets);
		const preview = updateCopySelector(model, { _tag: "Activate" }).model;
		expect(preview.tree.mode).toBe("TreePreview");
		const backed = updateCopySelector(preview, { _tag: "Back" });
		expect(backed.model.tree.mode).toBe("TreeBrowse");
		expect(backed.model.tree.selectedId).toBe(model.tree.selectedId);
		expect(backed.commands).toEqual([]);
	});

	it("unwinds session filter, preview, and label edit without mutating projected nodes", () => {
		const root = node("root", null);
		const child = node("child", "root", "before");
		root.children.push(child);
		let model = createSessionTreeModel([root], "root");
		expect(model.rowsById.get("child")?.depth).toBe(1);
		model = updateSessionTree(model, { _tag: "Move", delta: 1 }).model;
		model = updateSessionTree(model, { _tag: "BeginLabelEdit" }).model;
		model = updateSessionTree(model, { _tag: "LabelAppend", text: " after" }).model;
		const committed = updateSessionTree(model, { _tag: "CommitLabel" });
		expect(committed.commands).toEqual([{ _tag: "LabelCommitted", id: "child", label: "before after" }]);
		expect(committed.model.rowsById.get("child")?.node.label).toBe("before");
		const receipt = updateSessionTree(committed.model, { _tag: "LabelReceipt", entryId: "child", label: "after", sourceRevision: 2 });
		expect(receipt.model.rowsById.get("child")?.node.label).toBe("after");
		expect(child.label).toBe("before");
	});
	it("routes tree refreshes separately from keyed tree reducer updates", () => {
		const root = node("root", null);
		const child = node("child", "root");
		root.children.push(child);
		const model = createSessionTreeModel([root], "root");
		const projected = updateSessionTree(model, { _tag: "SourceReplaced", sourceRevision: 2, tree: [root], currentLeafId: "child" });
		expect(projected.model.tree.sourceRevision).toBe(2);
		expect(projected.model.currentLeafId).toBe("child");
		expect(projected.model.tree.selectedId).toBe("child");
		const projectedPosition = projected.model.tree.indexById.get("child");
		if (projectedPosition === undefined) throw new Error("projected child position missing");
		expect(projected.model.tree.selectedPosition).toBe(projectedPosition);

		const reduced = updateSessionTree(projected.model, {
			_tag: "SourceReplaced",
			sourceRevision: 3,
			rootIds: ["root"],
			childrenById: new Map([["root", ["child"]], ["child", []]]),
			labels: new Map([["root", "root"], ["child", "child"]]),
		});
		expect(reduced.model.tree.sourceRevision).toBe(3);
		expect(reduced.model.tree.selectedId).toBe("child");
		const reducedPosition = reduced.model.tree.indexById.get("child");
		if (reducedPosition === undefined) throw new Error("reduced child position missing");
		expect(reduced.model.tree.selectedPosition).toBe(reducedPosition);
	});

	it("keeps the current leaf and nested summary prompt depth typed", () => {
		const root = node("root", null);
		const child = node("child", "root");
		root.children.push(child);
		let model = createSessionTreeModel([root], "root", "default", 7, true);
		model = { ...model, leaseGeneration: 4 };
		expect(model.currentLeafId).toBe("root");

		model = updateSessionTree(model, { _tag: "Move", delta: 1 }).model;
		let opened = updateSessionTree(model, { _tag: "Activate" });
		expect(opened.commands).toEqual([]);
		expect(opened.model.depth).toHaveLength(1);
		expect(opened.model.depth[0]?._tag).toBe("SummaryChoice");

		opened = updateSessionTree(opened.model, { _tag: "Move", delta: 1 });
		opened = updateSessionTree(opened.model, { _tag: "Move", delta: 1 });
		const prompt = updateSessionTree(opened.model, { _tag: "Activate" });
		expect(prompt.model.depth).toHaveLength(2);
		expect(prompt.model.depth[1]?._tag).toBe("CustomPrompt");

		const typed = updateSessionTree(prompt.model, { _tag: "FilterAppend", text: "keep branch" });
		const requested = updateSessionTree(typed.model, { _tag: "Activate" });
		expect(requested.commands).toEqual([{
			_tag: "NavigateRequested",
			targetId: "child",
			summarize: true,
			customInstructions: "keep branch",
			sourceRevision: 7,
			requestGeneration: 1,
			leaseGeneration: 4,
		}]);
		expect(requested.model.depth).toEqual([]);
		expect(requested.model.currentLeafId).toBe("root");
	});

	it("fences settled navigation with a service-free stamped decoder", () => {
		const root = node("root", null);
		const model = createSessionTreeModel([root], "root");
		const leased = { ...model, leaseGeneration: 3 };
		const requested = updateSessionTree(leased, { _tag: "Activate" });
		const decode = Schema.decodeSync(SessionTreeNavigationSettledSchema);
		const stale = decode({
			_tag: "NavigationSettled",
			targetId: "root",
			requestGeneration: 2,
			sourceRevision: 0,
			leaseGeneration: 3,
			status: "success",
		});
		expect(updateSessionTree(requested.model, stale).model).toBe(requested.model);

		const missingLease = decode({
			_tag: "NavigationSettled",
			targetId: "root",
			requestGeneration: 1,
			sourceRevision: 0,
			status: "success",
		});
		expect(updateSessionTree(requested.model, missingLease).model).toBe(requested.model);

		const settled = decode({
			_tag: "NavigationSettled",
			targetId: "root",
			requestGeneration: 1,
			sourceRevision: 0,
			leaseGeneration: 3,
			status: "success",
		});
		expect(updateSessionTree(requested.model, settled).commands).toEqual([{
			_tag: "NavigationCompleted",
			targetId: "root",
			status: "success",
		}]);
	});

	it("selects primitive categories/items by stable keys and clamps removed items", () => {
		let state = createPrimitiveInspectorState(categories);
		state = movePrimitiveSelection(categories, state, 1);
		state = drillIntoPrimitive(categories, state);
		state = movePrimitiveSelection(categories, state, 1);
		expect(state.categoryId).toBe("tools");
		expect(state.itemId).toBe("write");
		state = replacePrimitiveSource(state, [{ ...categories[0]!, items: [categories[0]!.items[0]! ] }, categories[1]!], 2);
		expect(state.itemId).toBeUndefined();
		expect(unwindPrimitiveInspector(state)?.depth).toBe(1);
	});
});
