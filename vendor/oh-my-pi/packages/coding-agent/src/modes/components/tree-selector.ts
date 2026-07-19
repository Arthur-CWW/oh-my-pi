import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { type Component, type Keybinding, truncateToWidth } from "@oh-my-pi/pi-tui";
import { makeComponentId, type ActiveKeymapContext, type ComponentId, type KeyEvent } from "../mvu/schema";
import { makeTreeModel, type TreeCommand, type TreeModel, type TreeMsg, updateTree, viewTree } from "../mvu/tree";
import type { Viewport } from "../mvu/keyed-view";
import type { TreeFilterMode } from "../../config/settings-schema";
import type { SessionTreeNode } from "../../session/session-entries";
import { shortenPath } from "../../tools/render-utils";
import { toPathList } from "../../tools/search";
import { canonicalizeMessage } from "../../utils/thinking-display";
import { theme } from "../theme/theme";

export type FilterMode = TreeFilterMode;

export interface SessionTreeRow {
	readonly id: string;
	readonly node: SessionTreeNode;
	readonly depth: number;
	readonly prefix: string;
	readonly active: boolean;
	readonly searchText: string;
}

interface SessionTreeGutter {
	readonly position: number;
	readonly show: boolean;
}


export interface SessionTreeNavigationSettled {
	readonly _tag: "NavigationSettled";
	readonly targetId: string;
	readonly requestGeneration: number;
	readonly sourceRevision: number;
	readonly leaseGeneration?: number;
	readonly status: "success" | "cancelled" | "aborted" | "failed";
	readonly editorText?: string;
	readonly error?: string;
}

export type SessionTreeMsg = TreeMsg<string, Keybinding> | {
	readonly _tag: "SourceReplaced";
	readonly sourceRevision: number;
	readonly tree: readonly SessionTreeNode[];
	readonly currentLeafId?: string;
} | {
	readonly _tag: "LabelReceipt";
	readonly entryId: string;
	readonly label?: string;
	readonly sourceRevision: number;
} | SessionTreeNavigationSettled | {
	readonly _tag: "CancelNavigation";
};

export interface SessionTreeSummaryDepth {
	readonly _tag: "SummaryChoice";
	readonly targetId: string;
	readonly tree: TreeModel<string>;
}

export interface SessionTreeCustomPromptDepth {
	readonly _tag: "CustomPrompt";
	readonly targetId: string;
	readonly tree: TreeModel<string>;
}

export type SessionTreeDepth = SessionTreeSummaryDepth | SessionTreeCustomPromptDepth;

export type SessionTreeCommand =
	| TreeCommand<Keybinding, string>
	| {
			readonly _tag: "NavigateRequested";
			readonly targetId: string;
			readonly summarize: boolean;
			readonly customInstructions?: string;
			readonly sourceRevision: number;
			readonly requestGeneration: number;
			readonly leaseGeneration: number;
	  }
	| {
			readonly _tag: "AbortNavigation";
			readonly requestGeneration: number;
			readonly sourceRevision: number;
			readonly leaseGeneration: number;
	  }
	| {
			readonly _tag: "NavigationCompleted";
			readonly targetId: string;
			readonly status: SessionTreeNavigationSettled["status"];
			readonly editorText?: string;
			readonly error?: string;
	  }
	| { readonly _tag: "AlreadyAtPoint" };

export interface SessionTreeDepthRow {
	readonly key: string;
	readonly label: string;
	readonly selected: boolean;
}

export interface SessionTreePatch {
	readonly visibleRows: readonly { readonly key: string; readonly row: SessionTreeRow }[];
	readonly selectedKey?: string;
	readonly query?: string;
	readonly mode: "TreeBrowse" | "TreeFilter" | "TreePreview" | "TreeLabelEdit" | "TreeConfirm";
	readonly labelDraft?: string;
	readonly preview: string;
	readonly dirtyKeys: ReadonlySet<string>;
	readonly depth: number;
	readonly depthRows?: readonly SessionTreeDepthRow[];
	readonly depthQuery?: string;
	readonly pendingNavigation?: boolean;
	readonly totalCount: number;
	readonly filteredCount: number;
	readonly filterLabel: string;
}

type SessionTreeActiveModel = TreeModel<string>;
export interface SessionTreeModel {
	readonly tree: TreeModel<string>;
	readonly rowsById: ReadonlyMap<string, SessionTreeRow>;
	readonly labelsById: ReadonlyMap<string, string | undefined>;
	readonly filterMode: FilterMode;
	readonly branchSummaryEnabled: boolean;
	readonly depth: readonly SessionTreeDepth[];
	readonly requestGeneration: number;
	readonly leaseGeneration?: number;
	readonly currentLeafId: string | null;
	readonly pendingNavigation?: {
		readonly targetId: string;
		readonly summarize: boolean;
		readonly customInstructions?: string;
		readonly sourceRevision: number;
		readonly requestGeneration: number;
		readonly leaseGeneration: number;
	};
}


type SessionTreeContentBlock = {
	readonly type: string;
	readonly text?: string;
};

function extractContent(content: string | readonly SessionTreeContentBlock[] | undefined): string {
	if (typeof content === "string") return content;
	if (content === undefined) return "";
	let result = "";
	for (const block of content) {
		if (block.type === "text" && block.text !== undefined) result += block.text;
	}
	return result;
}

function searchText(node: SessionTreeNode): string {
	const entry = node.entry;
	const parts = [node.label ?? ""];
	switch (entry.type) {
		case "message": {
			const message = entry.message;
			parts.push(message.role);
			if ("content" in message) parts.push(extractContent(message.content));
			if (message.role === "bashExecution" && "command" in message) parts.push(String(message.command));
			break;
		}
		case "custom_message":
			parts.push(entry.customType, extractContent(entry.content));
			break;
		case "compaction": parts.push("compaction"); break;
		case "branch_summary": parts.push("branch summary", entry.summary); break;
		case "model_change": parts.push("model", entry.model); break;
		case "thinking_level_change": parts.push("thinking", entry.thinkingLevel ?? ThinkingLevel.Off); break;
		case "custom": parts.push("custom", entry.customType); break;
		case "label": parts.push("label", entry.label ?? ""); break;
	}
	return parts.join(" ");
}

function displayText(node: SessionTreeNode): string {
	const entry = node.entry;
	const normalize = (value: string) => value.replace(/[\n\t]/g, " ").trim();
	switch (entry.type) {
		case "message": {
			const message = entry.message;
			const content = "content" in message ? normalize(extractContent(message.content)) : "";
			if (message.role === "user") return `${theme.fg("accent", "user: ")}${content}`;
			if (message.role === "developer") return `${theme.fg("warning", "developer: ")}${content}`;
			if (message.role === "assistant") return `${theme.fg("success", "assistant: ")}${content || theme.fg("muted", "(no content)")}`;
			if (message.role === "toolResult") return theme.fg("muted", `[${message.toolName}]`);
			if (message.role === "bashExecution" && "command" in message) return theme.fg("dim", `[bash]: ${normalize(String(message.command))}`);
			return theme.fg("dim", `[${message.role}]`);
		}
		case "custom_message": return `${theme.fg("customMessageLabel", `[${entry.customType}]: `)}${normalize(extractContent(entry.content))}`;
		case "compaction": return theme.fg("borderAccent", `[compaction: ${Math.round(entry.tokensBefore / 1000)}k tokens]`);
		case "branch_summary": return `${theme.fg("warning", "[branch summary]: ")}${normalize(entry.summary)}`;
		case "model_change": return theme.fg("dim", `[model: ${entry.model}]`);
		case "thinking_level_change": return theme.fg("dim", `[thinking: ${entry.thinkingLevel ?? ThinkingLevel.Off}]`);
		case "custom": return theme.fg("dim", `[custom: ${entry.customType}]`);
		case "label": return theme.fg("dim", `[label: ${entry.label ?? "(cleared)"}]`);
		default: return "";
	}
}

function activeIds(roots: readonly SessionTreeNode[], currentLeafId: string | null | undefined): ReadonlySet<string> {
	const parentById = new Map<string, string | undefined>();
	const visit = (nodes: readonly SessionTreeNode[], parentId?: string) => {
		for (const node of nodes) {
			parentById.set(node.entry.id, parentId);
			visit(node.children, node.entry.id);
		}
	};
	visit(roots);
	const active = new Set<string>();
	let id = currentLeafId;
	while (id !== undefined && id !== null) {
		active.add(id);
		id = parentById.get(id);
	}
	return active;
}

function sourceMaps(
	roots: readonly SessionTreeNode[],
	currentLeafId: string | null | undefined,
	filterMode: FilterMode,
): {
	readonly rootIds: readonly string[];
	readonly childrenById: ReadonlyMap<string, readonly string[]>;
	readonly labels: ReadonlyMap<string, string>;
	readonly rowsById: ReadonlyMap<string, SessionTreeRow>;
	readonly labelsById: ReadonlyMap<string, string | undefined>;
} {
	const labels = new Map<string, string>();
	const labelsById = new Map<string, string | undefined>();
	const rowsById = new Map<string, SessionTreeRow>();
	const orderedChildrenById = new Map<string, readonly string[]>();
	const active = activeIds(roots, currentLeafId);
	const containsActive = new Map<SessionTreeNode, boolean>();
	const allNodes: SessionTreeNode[] = [];
	const traversal = [...roots];
	while (traversal.length > 0) {
		const node = traversal.pop();
		if (node === undefined) break;
		allNodes.push(node);
		for (let index = node.children.length - 1; index >= 0; index -= 1) {
			const child = node.children[index];
			if (child !== undefined) traversal.push(child);
		}
	}
	for (let index = allNodes.length - 1; index >= 0; index -= 1) {
		const node = allNodes[index];
		if (node === undefined) continue;
		let contains = node.entry.id === currentLeafId;
		for (const child of node.children) contains ||= containsActive.get(child) === true;
		containsActive.set(node, contains);
	}

	const treeBranch = theme?.symbol("tree.branch") ?? "├─";
	const treeLast = theme?.symbol("tree.last") ?? "└─";
	const treeVertical = theme?.symbol("tree.vertical") ?? "│";
	const ordered = (nodes: readonly SessionTreeNode[]): readonly SessionTreeNode[] => {
		const prioritized: SessionTreeNode[] = [];
		const rest: SessionTreeNode[] = [];
		for (const node of nodes) (containsActive.get(node) ? prioritized : rest).push(node);
		return [...prioritized, ...rest];
	};
	const multipleRoots = roots.length > 1;
	type StackItem = readonly [
		node: SessionTreeNode,
		indent: number,
		semanticDepth: number,
		justBranched: boolean,
		showConnector: boolean,
		isLast: boolean,
		gutters: readonly SessionTreeGutter[],
		virtualRootChild: boolean,
	];
	const stack: StackItem[] = [];
	const orderedRoots = ordered(roots);
	for (let index = orderedRoots.length - 1; index >= 0; index -= 1) {
		const node = orderedRoots[index];
		if (node !== undefined) {
			stack.push([node, multipleRoots ? 1 : 0, 0, multipleRoots, multipleRoots, index === orderedRoots.length - 1, [], multipleRoots]);
		}
	}

	while (stack.length > 0) {
		const item = stack.pop();
		if (item === undefined) break;
		const [node, indent, semanticDepth, justBranched, showConnector, isLast, gutters, virtualRootChild] = item;
		const displayIndent = multipleRoots ? Math.max(0, indent - 1) : indent;
		const hasConnector = showConnector && !virtualRootChild;
		const connectorPosition = hasConnector ? displayIndent - 1 : -1;
		const nearestGutter = hasConnector ? undefined : gutters.at(-1);
		const chainAnchor = nearestGutter !== undefined && !nearestGutter.show ? nearestGutter.position + 1 : -1;
		const gutterByPosition = new Map(gutters.map(gutter => [gutter.position, gutter.show]));
		let prefix = "";
		for (let level = 0; level < displayIndent; level += 1) {
			const gutter = gutterByPosition.get(level);
			if (gutter !== undefined) prefix += gutter ? `${treeVertical}  ` : "   ";
			else if (level === chainAnchor) prefix += `${treeVertical}  `;
			else if (level === connectorPosition) prefix += `${isLast ? treeLast : treeBranch} `;
			else prefix += "   ";
		}

		const id = node.entry.id;
		const text = searchText(node);
		labels.set(id, text);
		labelsById.set(id, node.label);
		rowsById.set(id, { id, node, depth: semanticDepth, prefix, active: active.has(id), searchText: text });

		const children = ordered(node.children);
		orderedChildrenById.set(id, children.map(child => child.entry.id));
		const multipleChildren = children.length > 1;
		const childIndent = multipleChildren ? indent + 1 : justBranched && indent > 0 ? indent + 1 : indent;
		const currentConnectorPosition = Math.max(0, displayIndent - 1);
		const childGutters = hasConnector
			? [...gutters, { position: currentConnectorPosition, show: !isLast }]
			: gutters;
		for (let index = children.length - 1; index >= 0; index -= 1) {
			const child = children[index];
			if (child !== undefined) {
				stack.push([child, childIndent, semanticDepth + 1, multipleChildren, multipleChildren, index === children.length - 1, childGutters, false]);
			}
		}
	}

	const isVisible = (row: SessionTreeRow): boolean => {
		const entry = row.node.entry;
		if (entry.type === "message" && entry.message.role === "assistant" && entry.id !== currentLeafId) {
			const stopReason = entry.message.stopReason;
			if (extractContent(entry.message.content).trim().length === 0 && (stopReason === undefined || stopReason === "stop" || stopReason === "toolUse")) {
				return false;
			}
		}
		const settingsEntry =
			entry.type === "label" ||
			entry.type === "custom" ||
			entry.type === "model_change" ||
			entry.type === "thinking_level_change";
		switch (filterMode) {
			case "user-only": return entry.type === "message" && entry.message.role === "user";
			case "no-tools": return !settingsEntry && !(entry.type === "message" && entry.message.role === "toolResult");
			case "labeled-only": return row.node.label !== undefined;
			case "all": return true;
			default: return !settingsEntry;
		}
	};
	const visible = new Set<string>();
	for (const [id, row] of rowsById) if (isVisible(row)) visible.add(id);
	const rootIds: string[] = [];
	const childrenById = new Map<string, string[]>();
	const projectionStack: Array<readonly [string, string | undefined]> = [];
	for (let index = orderedRoots.length - 1; index >= 0; index -= 1) {
		const root = orderedRoots[index];
		if (root !== undefined) projectionStack.push([root.entry.id, undefined]);
	}
	while (projectionStack.length > 0) {
		const item = projectionStack.pop();
		if (item === undefined) break;
		const [id, visibleParent] = item;
		const nextParent = visible.has(id) ? id : visibleParent;
		if (visible.has(id)) {
			if (visibleParent === undefined) rootIds.push(id);
			else {
				const siblings = childrenById.get(visibleParent) ?? [];
				siblings.push(id);
				childrenById.set(visibleParent, siblings);
			}
			childrenById.set(id, []);
		}
		const children = orderedChildrenById.get(id) ?? [];
		for (let index = children.length - 1; index >= 0; index -= 1) {
			const child = children[index];
			if (child !== undefined) projectionStack.push([child, nextParent]);
		}
	}
	const visibleLabels = new Map<string, string>();
	for (const id of visible) visibleLabels.set(id, labels.get(id) ?? id);
	return { rootIds, childrenById, labels: visibleLabels, rowsById, labelsById };
}

function withSelectedId(tree: TreeModel<string>, selectedId: string | undefined): TreeModel<string> {
	return {
		...tree,
		selectedId,
		selectedPosition: selectedId === undefined ? -1 : tree.indexById.get(selectedId) ?? -1,
	};
}

const SUMMARY_NONE_ID = "session-tree.summary.none";
const SUMMARY_DEFAULT_ID = "session-tree.summary.default";
const SUMMARY_CUSTOM_ID = "session-tree.summary.custom";
const SUMMARY_PROMPT_ID = "session-tree.summary.prompt";

function summaryDepth(targetId: string): SessionTreeDepth {
	const labels = new Map<string, string>([
		[SUMMARY_NONE_ID, "No summary"],
		[SUMMARY_DEFAULT_ID, "Summarize"],
		[SUMMARY_CUSTOM_ID, "Summarize with custom prompt"],
	]);
	const tree = makeTreeModel(
		[SUMMARY_NONE_ID, SUMMARY_DEFAULT_ID, SUMMARY_CUSTOM_ID],
		new Map([
			[SUMMARY_NONE_ID, []],
			[SUMMARY_DEFAULT_ID, []],
			[SUMMARY_CUSTOM_ID, []],
		]),
		labels,
		0,
		new Set([SUMMARY_NONE_ID, SUMMARY_DEFAULT_ID, SUMMARY_CUSTOM_ID]),
	);
	return { _tag: "SummaryChoice", targetId, tree };
}

function customPromptDepth(targetId: string): SessionTreeDepth {
	let tree = makeTreeModel(
		[SUMMARY_PROMPT_ID],
		new Map([[SUMMARY_PROMPT_ID, []]]),
		new Map([[SUMMARY_PROMPT_ID, "Custom summarization instructions"]]),
		0,
		new Set([SUMMARY_PROMPT_ID]),
	);
	tree = updateTree(tree, { _tag: "BeginFilter" }).model;
	return { _tag: "CustomPrompt", targetId, tree };
}

function activeDepth(model: SessionTreeModel): SessionTreeDepth | undefined {
	return model.depth.at(-1);
}

function activeTree(model: SessionTreeModel): SessionTreeActiveModel {
	return activeDepth(model)?.tree ?? model.tree;
}

function replaceActiveTree(model: SessionTreeModel, tree: SessionTreeActiveModel): SessionTreeModel {
	const depth = activeDepth(model);
	if (depth === undefined) return { ...model, tree };
	return { ...model, depth: [...model.depth.slice(0, -1), { ...depth, tree }] };
}

function beginNavigation(
	model: SessionTreeModel,
	targetId: string,
	summarize: boolean,
	customInstructions?: string,
): { readonly model: SessionTreeModel; readonly commands: readonly SessionTreeCommand[]; readonly dirtyKeys: ReadonlySet<string> } {
	const requestGeneration = model.requestGeneration + 1;
	const leaseGeneration = model.leaseGeneration ?? 0;
	const pendingNavigation = {
		targetId,
		summarize,
		...(customInstructions === undefined ? {} : { customInstructions }),
		sourceRevision: model.tree.sourceRevision,
		requestGeneration,
		leaseGeneration,
	};
	return {
		model: { ...model, depth: [], requestGeneration, pendingNavigation },
		commands: [{
			_tag: "NavigateRequested",
			targetId,
			summarize,
			...(customInstructions === undefined ? {} : { customInstructions }),
			sourceRevision: model.tree.sourceRevision,
			requestGeneration,
			leaseGeneration,
		}],
		dirtyKeys: new Set(["focus", "navigation"]),
	};
}

function emptyTransition(model: SessionTreeModel): {
	readonly model: SessionTreeModel;
	readonly commands: readonly SessionTreeCommand[];
	readonly dirtyKeys: ReadonlySet<string>;
} {
	return { model, commands: [], dirtyKeys: new Set() };
}

export function createSessionTreeModel(
	roots: readonly SessionTreeNode[],
	currentLeafId: string | null = null,
	filterMode: FilterMode = "default",
	sourceRevision = 0,
	branchSummaryEnabled = false,
): SessionTreeModel {
	const maps = sourceMaps(roots, currentLeafId, filterMode);
	let selectedId = currentLeafId ?? undefined;
	while (selectedId !== undefined && !maps.labels.has(selectedId)) {
		const parentId = maps.rowsById.get(selectedId)?.node.entry.parentId;
		selectedId = parentId ?? undefined;
	}
	const activeLeafId = currentLeafId !== null && maps.rowsById.has(currentLeafId) ? currentLeafId : null;
	const expanded = new Set(maps.childrenById.keys());
	const tree = makeTreeModel(maps.rootIds, maps.childrenById, maps.labels, sourceRevision, expanded);
	selectedId ??= maps.rootIds[0];
	return {
		tree: withSelectedId(tree, selectedId),
		rowsById: maps.rowsById,
		labelsById: maps.labelsById,
		filterMode,
		branchSummaryEnabled,
		depth: [],
		requestGeneration: 0,
		currentLeafId: activeLeafId,
	};
}

export function updateSessionTree(
	model: SessionTreeModel,
	message: SessionTreeMsg,
): { readonly model: SessionTreeModel; readonly commands: readonly SessionTreeCommand[]; readonly dirtyKeys: ReadonlySet<string> } {
	if (message._tag === "NavigationSettled") {
		const pending = model.pendingNavigation;
		if (
			pending === undefined ||
			pending.targetId !== message.targetId ||
			pending.requestGeneration !== message.requestGeneration ||
			pending.sourceRevision !== message.sourceRevision ||
			pending.leaseGeneration !== message.leaseGeneration
		) {
			return emptyTransition(model);
		}
		const tree = { ...model.tree, mode: "TreeBrowse" as const, labelEdit: undefined };
		const next = { ...model, tree, depth: [], pendingNavigation: undefined };
		return {
			model: next,
			commands: [{
				_tag: "NavigationCompleted",
				targetId: message.targetId,
				status: message.status,
				...(message.editorText === undefined ? {} : { editorText: message.editorText }),
				...(message.error === undefined ? {} : { error: message.error }),
			}],
			dirtyKeys: new Set(["focus", "navigation"]),
		};
	}
	if (message._tag === "SourceReplaced") {
		if (message.sourceRevision < model.tree.sourceRevision) return emptyTransition(model);
		if ("tree" in message) {
			const next = createSessionTreeModel(
				message.tree,
				message.currentLeafId ?? model.currentLeafId,
				model.filterMode,
				message.sourceRevision,
				model.branchSummaryEnabled,
			);
			const source = updateTree(model.tree, {
				_tag: "SourceReplaced",
				sourceRevision: message.sourceRevision,
				rootIds: next.tree.rootIds,
				childrenById: next.tree.childrenById,
				labels: next.tree.labels,
			});
			const selectedId = message.currentLeafId !== undefined && next.rowsById.has(message.currentLeafId)
				? message.currentLeafId
				: source.model.selectedId !== undefined && next.rowsById.has(source.model.selectedId)
					? source.model.selectedId
					: next.tree.selectedId;
			const dirtyKeys = new Set(source.dirtyKeys);
			if (selectedId !== source.model.selectedId) {
				if (source.model.selectedId !== undefined) dirtyKeys.add(source.model.selectedId);
				if (selectedId !== undefined) dirtyKeys.add(selectedId);
			}
			return {
				model: {
					...next,
					requestGeneration: model.requestGeneration + 1,
					tree: withSelectedId(source.model, selectedId),
				},
				commands: [],
				dirtyKeys,
			};
		}
		const source = updateTree(model.tree, message);
		return {
			model: { ...model, tree: source.model, requestGeneration: model.requestGeneration + 1, pendingNavigation: undefined, depth: [] },
			commands: source.commands,
			dirtyKeys: source.dirtyKeys,
		};
	}
	if (message._tag === "LabelReceipt") {
		if (message.sourceRevision < model.tree.sourceRevision) return emptyTransition(model);
		const labelsById = new Map(model.labelsById);
		labelsById.set(message.entryId, message.label);
		const row = model.rowsById.get(message.entryId);
		const rowsById = new Map(model.rowsById);
		const labels = new Map(model.tree.labels);
		if (row !== undefined) {
			const node = { ...row.node, label: message.label };
			const nextSearchText = searchText(node);
			rowsById.set(message.entryId, { ...row, node, searchText: nextSearchText });
			labels.set(message.entryId, nextSearchText);
		}
		const source = updateTree(model.tree, {
			_tag: "SourceReplaced",
			sourceRevision: message.sourceRevision,
			rootIds: model.tree.rootIds,
			childrenById: model.tree.childrenById,
			labels,
		});
		return {
			model: { ...model, rowsById, labelsById, tree: source.model },
			commands: source.commands,
			dirtyKeys: new Set([...source.dirtyKeys, message.entryId]),
		};
	}
	if (message._tag === "CancelNavigation") {
		const pending = model.pendingNavigation;
		return pending === undefined
			? emptyTransition(model)
			: {
					model,
					commands: [{
						_tag: "AbortNavigation",
						requestGeneration: pending.requestGeneration,
						sourceRevision: pending.sourceRevision,
						leaseGeneration: pending.leaseGeneration,
					}],
					dirtyKeys: new Set(["navigation"]),
				};
	}

	const nested = activeDepth(model);
	if (nested?._tag === "CustomPrompt" && message._tag === "Activate") {
		return beginNavigation(model, nested.targetId, true, nested.tree.filterQuery);
	}
	if (nested !== undefined) {
		const transition = updateTree(nested.tree, message as TreeMsg<string, Keybinding>);
		let next = replaceActiveTree(model, transition.model);
		const treeCommands: SessionTreeCommand[] = [];
		let depthChanged = false;
		for (const command of transition.commands) {
			if (command._tag === "CloseRequested") {
				next = { ...next, depth: next.depth.slice(0, -1) };
				depthChanged = true;
				continue;
			}
			if (command._tag !== "Activate") {
				treeCommands.push(command);
				continue;
			}
			if (nested._tag === "SummaryChoice") {
				switch (command.id) {
					case SUMMARY_NONE_ID: return beginNavigation(model, nested.targetId, false);
					case SUMMARY_DEFAULT_ID: return beginNavigation(model, nested.targetId, true);
					case SUMMARY_CUSTOM_ID:
						return {
							model: { ...model, depth: [...model.depth, customPromptDepth(nested.targetId)] },
							commands: [],
							dirtyKeys: new Set(["focus", "navigation"]),
						};
				}
			} else {
				return beginNavigation(model, nested.targetId, true, nested.tree.filterQuery);
			}
		}
		const dirtyKeys = new Set(transition.dirtyKeys);
		if (depthChanged) {
			dirtyKeys.add("focus");
			dirtyKeys.add("navigation");
		}
		return { model: next, commands: treeCommands, dirtyKeys };
	}

	if (message._tag === "BeginLabelEdit") {
		const id = model.tree.selectedId;
		const transition = updateTree(model.tree, {
			...message,
			draft: id === undefined ? "" : model.labelsById.get(id) ?? "",
		});
		return { model: { ...model, tree: transition.model }, commands: transition.commands, dirtyKeys: transition.dirtyKeys };
	}
	const transition = updateTree(model.tree, message as TreeMsg<string, Keybinding>);
	const activate = transition.commands.find(command => command._tag === "Activate");
	if (activate?._tag === "Activate") {
		return model.branchSummaryEnabled
			? {
					model: { ...model, tree: transition.model, depth: [summaryDepth(activate.id)] },
					commands: [],
					dirtyKeys: new Set([...transition.dirtyKeys, "focus", "navigation"]),
				}
			: beginNavigation(model, activate.id, false);
	}
	return { model: { ...model, tree: transition.model }, commands: transition.commands, dirtyKeys: transition.dirtyKeys };
}

export function viewSessionTree(model: SessionTreeModel, viewport: Viewport, dirtyKeys: ReadonlySet<string> = new Set()): SessionTreePatch {
	const depth = activeDepth(model);
	const tree = activeTree(model);
	const view = depth === undefined ? viewTree(model.tree, model.rowsById, viewport) : { visibleRows: [], selectedKey: undefined };
	const selected = model.tree.selectedId === undefined ? undefined : model.rowsById.get(model.tree.selectedId);
	const depthRows = depth === undefined
		? undefined
		: depth.tree.visibleIds.map(id => ({
				key: id,
				label: depth.tree.labels.get(id) ?? id,
				selected: id === depth.tree.selectedId,
			}));
	return {
		visibleRows: view.visibleRows,
		selectedKey: view.selectedKey,
		query: tree.mode === "TreeFilter" ? tree.filterQuery : undefined,
		mode: tree.mode,
		labelDraft: tree.mode === "TreeLabelEdit" ? tree.labelEdit?.value : undefined,
		preview: depth === undefined && selected !== undefined ? displayText(selected.node) : "",
		dirtyKeys,
		depth: model.depth.length,
		depthRows,
		depthQuery: depth?._tag === "CustomPrompt" ? depth.tree.filterQuery : undefined,
		pendingNavigation: model.pendingNavigation !== undefined,
		totalCount: model.rowsById.size,
		filteredCount: model.tree.flattenedIds.length,
		filterLabel: model.filterMode === "default"
			? "[default]"
			: model.filterMode === "no-tools"
				? "[no-tools]"
				: model.filterMode === "user-only"
					? "[user]"
					: model.filterMode === "labeled-only"
						? "[labeled]"
						: "[all]",
	};
}

export function sessionTreeActionToMsg(
	action: string,
	event: KeyEvent,
	model?: SessionTreeModel,
): SessionTreeMsg | undefined {
	if (event._tag !== "Press" && event._tag !== "Paste") return undefined;
	const active = model === undefined ? undefined : activeTree(model);
	const text = event._tag === "Paste" ? event.text : event.text ?? String(event.key);
	switch (action) {
		case "app.navigation.up":
		case "tui.select.up": return { _tag: "Move", delta: -1 };
		case "app.navigation.down":
		case "tui.select.down": return { _tag: "Move", delta: 1 };
		case "tui.select.pageUp": return { _tag: "Page", delta: -1 };
		case "tui.select.pageDown": return { _tag: "Page", delta: 1 };
		case "tui.select.first": return { _tag: "Jump", target: "first" };
		case "tui.select.last": return { _tag: "Jump", target: "last" };
		case "app.selector.filter": return { _tag: "BeginFilter" };
		case "app.selector.filterAppend":
			return text.length > 0 ? { _tag: "FilterAppend", text } : undefined;
		case "app.selector.filterDelete": return { _tag: "FilterDelete" };
		case "ui.dismiss": return { _tag: "Back" };
		case "app.interrupt": return { _tag: "CancelNavigation" };
		case "tui.select.confirm": return { _tag: "Activate" };
		case "app.tree.label": return { _tag: "BeginLabelEdit" };
		case "app.tree.labelAppend":
			return text.length > 0 ? { _tag: "LabelAppend", text } : undefined;
		case "app.tree.labelDelete": return { _tag: "LabelDelete" };
		case "app.tree.labelCommit": return { _tag: "CommitLabel" };
		default: return undefined;
	}
}

interface CachedSessionTreeRow {
	readonly row: SessionTreeRow;
	readonly selected: boolean;
	readonly width: number;
	readonly line: string;
}

/** Renderer-only session tree. Labels are patched from receipts; no node is mutated by rendering. */
export class TreeSelectorComponent implements Component {
	#patch: SessionTreePatch | undefined;
	#cached: { readonly width: number; readonly patch: SessionTreePatch; readonly lines: readonly string[] } | undefined;
	#rowCache = new Map<string, CachedSessionTreeRow>();
	apply(patch: SessionTreePatch): void {
		if (this.#patch === patch) return;
		this.#patch = patch;
		const visibleKeys = new Set(patch.visibleRows.map(row => row.key));
		for (const key of this.#rowCache.keys()) {
			if (!visibleKeys.has(key)) this.#rowCache.delete(key);
		}
		this.#cached = undefined;
	}

	invalidate(): void {
		this.#cached = undefined;
		this.#rowCache.clear();
	}

	#isDirty(key: string, dirtyKeys: ReadonlySet<string>): boolean {
		for (const dirtyKey of dirtyKeys) {
			if (Object.is(dirtyKey, key)) return true;
		}
		return false;
	}

	#renderRow(key: string, row: SessionTreeRow, selected: boolean, width: number, dirtyKeys: ReadonlySet<string>): string {
		const cached = this.#rowCache.get(key);
		if (
			cached !== undefined &&
			!this.#isDirty(key, dirtyKeys) &&
			Object.is(cached.row, row) &&
			cached.selected === selected &&
			cached.width === width
		) {
			return cached.line;
		}
		const active = row.active ? theme.fg("accent", `${theme.md.bullet} `) : "";
		const label = row.node.label ? theme.fg("warning", `[${row.node.label}] `) : "";
		const content = selected ? theme.bold(displayText(row.node)) : displayText(row.node);
		const prefixBudget = Math.max(0, Math.min(24, width - 16));
		const prefix = truncateToWidth(theme.fg("dim", row.prefix), prefixBudget);
		const line = truncateToWidth(`${selected ? theme.fg("accent", "› ") : "  "}${prefix}${active}${label}${content}`, width);
		this.#rowCache.set(key, { row, selected, width, line });
		return line;
	}

	render(width: number): readonly string[] {
		const patch = this.#patch;
		if (patch === undefined) return [];
		if (this.#cached?.width === width && this.#cached.patch === patch) return this.#cached.lines;
		const lines: string[] = [
			theme.bold(patch.depth > 0 ? "  Session Tree · Navigation" : "  Session Tree"),
			patch.depth > 0 && patch.depthQuery === undefined ? theme.fg("muted", "  Choose how to continue") : theme.fg("muted", `  Search: ${patch.depthQuery ?? patch.query ?? ""}`),
		];
		if (patch.pendingNavigation) lines.push(theme.fg("warning", "  Navigation in progress…"));
		if (patch.mode === "TreeLabelEdit") lines.push(theme.fg("warning", `  Label: ${patch.labelDraft ?? ""}`));
		if (patch.visibleRows.length === 0 && patch.depthRows === undefined) {
			if (patch.totalCount === 0) {
				lines.push(theme.fg("muted", "  No entries found"));
				lines.push(theme.fg("muted", `  (0/0)${patch.filterLabel === "[default]" ? "" : ` ${patch.filterLabel}`}`));
			} else if (patch.query !== undefined && patch.query.length > 0) {
				lines.push(theme.fg("muted", `  No entries match search "${patch.query}"`));
				lines.push(theme.fg("muted", "  Press Backspace to clear the search"));
				lines.push(theme.fg("muted", `  (0/${patch.totalCount})${patch.filterLabel === "[default]" ? "" : ` ${patch.filterLabel}`}`));
			} else if (patch.filteredCount === 0) {
				lines.push(theme.fg("muted", `  ${patch.totalCount} entries hidden by the current filter ${patch.filterLabel}`));
				lines.push(theme.fg("muted", "  Press Alt+A to show all, Alt+D for default"));
				lines.push(theme.fg("muted", `  (0/${patch.totalCount})${patch.filterLabel === "[default]" ? "" : ` ${patch.filterLabel}`}`));
			}
		}
		for (const entry of patch.depthRows ?? []) {
			lines.push(truncateToWidth(`${entry.selected ? theme.fg("accent", "› ") : "  "}${entry.label}`, width));
		}
		for (const entry of patch.visibleRows) {
			lines.push(this.#renderRow(entry.key, entry.row, entry.key === patch.selectedKey, width, patch.dirtyKeys));
		}
		if (patch.preview) lines.push(truncateToWidth(`  ${theme.fg("dim", "Preview: ")}${patch.preview}`, width));
		lines.push(theme.fg("muted", patch.depth > 0 ? "  j/k move · Enter select · Esc back" : "  j/k move · / filter · Enter open · Shift+L label · Esc back"));
		this.#cached = { width, patch, lines };
		return lines;
	}
}
export interface SessionTreeRouteSpec {
	readonly componentId: ComponentId;
	readonly focusedRoot: TreeSelectorComponent;
	readonly initialModel: SessionTreeModel;
	readonly context: (model: SessionTreeModel) => ActiveKeymapContext;
	readonly actionToMsg: (action: Keybinding, event: KeyEvent) => SessionTreeMsg | undefined;
}

export function createSessionTreeRoute(
	roots: readonly SessionTreeNode[],
	currentLeafId: string | null = null,
	filterMode: FilterMode = "default",
	sourceRevision = 0,
	branchSummaryEnabled = false,
): SessionTreeRouteSpec {
	const componentId = makeComponentId("session-tree");
	return {
		componentId,
		focusedRoot: new TreeSelectorComponent(),
		initialModel: createSessionTreeModel(roots, currentLeafId, filterMode, sourceRevision, branchSummaryEnabled),
		context: model => {
			const tree = activeTree(model);
			return {
				contexts: ["selector.global", "selector.filter"],
				mode: tree.mode,
				focus: tree.mode === "TreePreview" || tree.mode === "TreeLabelEdit" ? "preview" : "list",
				capabilities: new Set(["selector.filter"]),
			};
		},
		actionToMsg: (action, event) => sessionTreeActionToMsg(String(action), event),
	};
}

export { canonicalizeMessage, shortenPath, toPathList };
