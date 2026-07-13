import type { AgentRef } from "../../registry/agent-registry";

export interface AgentRosterRollup {
	descendants: number;
	running: number;
}

export interface AgentRosterRow {
	ref: AgentRef;
	depth: number;
	guide: string;
	hasChildren: boolean;
	parentId?: string;
	collapsed?: AgentRosterRollup;
}

interface AgentRosterTopology {
	refs: AgentRef[];
	parentById: Map<string, string | undefined>;
	childrenByParent: Map<string | undefined, AgentRef[]>;
}

function buildTopology(refs: readonly AgentRef[]): AgentRosterTopology {
	const orderedRefs: AgentRef[] = [];
	const byId = new Map<string, AgentRef>();
	for (const ref of refs) {
		if (byId.has(ref.id)) continue;
		byId.set(ref.id, ref);
		orderedRefs.push(ref);
	}

	const cycleIds = new Set<string>();
	for (const ref of orderedRefs) {
		const seen = new Map<string, number>();
		let currentId: string | undefined = ref.id;
		while (currentId !== undefined) {
			if (cycleIds.has(currentId)) break;
			const previousIndex = seen.get(currentId);
			if (previousIndex !== undefined) {
				let mark = false;
				for (const seenId of seen.keys()) {
					if (seenId === currentId) mark = true;
					if (mark) cycleIds.add(seenId);
				}
				break;
			}
			seen.set(currentId, seen.size);
			const parentId: string | undefined = byId.get(currentId)?.parentId;
			currentId = parentId !== undefined && byId.has(parentId) ? parentId : undefined;
		}
	}

	const parentById = new Map<string, string | undefined>();
	const childrenByParent = new Map<string | undefined, AgentRef[]>();
	for (const ref of orderedRefs) {
		const parentId = ref.parentId !== undefined && byId.has(ref.parentId) && !cycleIds.has(ref.id) ? ref.parentId : undefined;
		parentById.set(ref.id, parentId);
		const children = childrenByParent.get(parentId);
		if (children) children.push(ref);
		else childrenByParent.set(parentId, [ref]);
	}
	return { refs: orderedRefs, parentById, childrenByParent };
}

function includedIds(topology: AgentRosterTopology, matchedIds: ReadonlySet<string> | undefined): Set<string> | undefined {
	if (matchedIds === undefined) return undefined;
	const included = new Set<string>();
	for (const id of matchedIds) {
		if (!topology.parentById.has(id)) continue;
		let currentId: string | undefined = id;
		while (currentId !== undefined && !included.has(currentId)) {
			included.add(currentId);
			currentId = topology.parentById.get(currentId);
		}
	}
	return included;
}

function subtreeRollups(
	topology: AgentRosterTopology,
	visibleChildrenByParent: ReadonlyMap<string | undefined, readonly AgentRef[]>,
): Map<string, AgentRosterRollup> {
	const rollups = new Map<string, AgentRosterRollup>();
	const order: AgentRef[] = [];
	const pending = [...(visibleChildrenByParent.get(undefined) ?? [])];
	while (pending.length > 0) {
		const ref = pending.pop()!;
		order.push(ref);
		for (const child of visibleChildrenByParent.get(ref.id) ?? []) pending.push(child);
	}
	for (let index = order.length - 1; index >= 0; index--) {
		const ref = order[index]!;
		let descendants = 0;
		let running = 0;
		for (const child of visibleChildrenByParent.get(ref.id) ?? []) {
			const childRollup = rollups.get(child.id);
			descendants += 1 + (childRollup?.descendants ?? 0);
			running += (child.status === "running" ? 1 : 0) + (childRollup?.running ?? 0);
		}
		rollups.set(ref.id, { descendants, running });
	}
	return rollups;
}
/** Project an ordered registry snapshot into a visible, navigable roster tree. */
export function projectAgentRoster(
	refs: readonly AgentRef[],
	collapsedIds: ReadonlySet<string>,
	includedAgentIds?: ReadonlySet<string>,
	revealIncludedPaths = false,
): AgentRosterRow[] {
	const topology = buildTopology(refs);
	const included = includedIds(topology, includedAgentIds);
	const visibleChildrenByParent = new Map<string | undefined, AgentRef[]>();
	for (const ref of topology.refs) {
		if (included && !included.has(ref.id)) continue;
		const parentId = topology.parentById.get(ref.id);
		const children = visibleChildrenByParent.get(parentId);
		if (children) children.push(ref);
		else visibleChildrenByParent.set(parentId, [ref]);
	}
	const rollups = revealIncludedPaths ? undefined : subtreeRollups(topology, visibleChildrenByParent);
	const rows: AgentRosterRow[] = [];
	const visit = (ref: AgentRef, depth: number, continuations: readonly boolean[]): void => {
		const parentId = topology.parentById.get(ref.id);
		const siblings = visibleChildrenByParent.get(parentId) ?? [];
		const siblingIndex = siblings.indexOf(ref);
		let guide = "";
		for (let index = 0; index + 1 < continuations.length; index++) guide += continuations[index] ? "│ " : "  ";
		if (depth > 0) guide += siblingIndex + 1 < siblings.length ? "├ • " : "└ • ";
		const children = visibleChildrenByParent.get(ref.id) ?? [];
		const row: AgentRosterRow = {
			ref,
			depth,
			guide,
			hasChildren: children.length > 0,
		};
		if (parentId !== undefined) row.parentId = parentId;
		if (rollups && collapsedIds.has(ref.id)) {
			const collapsed = rollups.get(ref.id);
			if (collapsed && collapsed.descendants > 0) row.collapsed = collapsed;
		}
		rows.push(row);
		if (!revealIncludedPaths && collapsedIds.has(ref.id)) return;
		for (let index = 0; index < children.length; index++) {
			visit(children[index]!, depth + 1, [...continuations, index + 1 < children.length]);
		}
	};
	for (const root of visibleChildrenByParent.get(undefined) ?? []) visit(root, 0, []);
	return rows;
}

/** Return a normalized root-to-agent path, including the requested id. */
export function agentAncestorPath(refs: readonly AgentRef[], id: string): string[] {
	const topology = buildTopology(refs);
	if (!topology.parentById.has(id)) return [];
	const reversed: string[] = [];
	const seen = new Set<string>();
	let currentId: string | undefined = id;
	while (currentId !== undefined && !seen.has(currentId)) {
		seen.add(currentId);
		reversed.push(currentId);
		currentId = topology.parentById.get(currentId);
	}
	reversed.reverse();
	return reversed;
}

/** Return a copy of collapsed ids with every ancestor of id expanded. */
export function expandAgentAncestors(
	refs: readonly AgentRef[],
	collapsedIds: ReadonlySet<string>,
	id: string,
): Set<string> {
	const expanded = new Set(collapsedIds);
	const path = agentAncestorPath(refs, id);
	for (let index = 0; index + 1 < path.length; index++) expanded.delete(path[index]!);
	return expanded;
}

/** Cycle to the next visible sibling at the current row's depth and parent. */
export function cycleVisibleAgentSibling(
	refs: readonly AgentRef[],
	currentId: string,
	direction: -1 | 1,
): AgentRef | undefined {
	const visibleIds = new Set(refs.map(ref => ref.id));
	const current = refs.find(ref => ref.id === currentId);
	if (!current) return undefined;
	const normalizedParent = current.parentId && visibleIds.has(current.parentId) ? current.parentId : undefined;
	const siblings = refs.filter(ref => {
		const parentId = ref.parentId && visibleIds.has(ref.parentId) ? ref.parentId : undefined;
		return parentId === normalizedParent;
	});
	const siblingIndex = siblings.findIndex(ref => ref.id === currentId);
	if (siblingIndex < 0) return undefined;
	return siblings[(siblingIndex + direction + siblings.length) % siblings.length];
}
