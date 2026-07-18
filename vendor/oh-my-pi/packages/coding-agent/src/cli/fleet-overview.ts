import * as path from "node:path";
import {
	getIrcExternalPeerDisplayState,
	IrcExternalBus,
	IRC_EXTERNAL_STALE_MS,
	isIrcExternalPeerFresh,
	isIrcExternalPeerProcessAlive,
	type IrcExternalPeer,
	type IrcExternalPeerDisplayState,
	type IrcExternalPeerLabels,
} from "../irc/bus-external";
import { decodeSessionWorkstream } from "../session/session-entries";

export interface FleetOverviewOptions {
	readonly workstream?: string;
	readonly all?: boolean;
	readonly nowMs?: number;
	readonly ircDbPath?: string;
	readonly isProcessAlive?: (pid: number) => boolean;
}

export interface FleetClaimConflict {
	readonly with: string;
	readonly path: string;
}

export interface FleetOverviewRow {
	readonly sessionId: string;
	readonly name: string;
	readonly displayState: IrcExternalPeerDisplayState;
	readonly model: string;
	readonly workstream: string;
	readonly objective: string;
	readonly activity: string;
	readonly todoHead: string;
	readonly label: string;
	readonly summary: string;
	readonly spawnName: string;
	readonly claims: readonly string[];
	readonly claimConflicts: readonly FleetClaimConflict[];
	readonly lastSeen: string;
	readonly cwd: string;
	readonly pid: number;
	readonly sessionJournal: string;
	readonly version: string;
}

function resolveWorkstream(peer: IrcExternalPeer): string {
	// Labels workstream (from goal), then fleet capability workstream, then empty
	if (peer.labels?.workstream) return peer.labels.workstream;
	const capWs = peer.fleetCapability?.workstream;
	if (capWs) {
		const decoded = decodeSessionWorkstream(capWs);
		if (decoded?.kind === "workstream") return decoded.id;
		if (decoded?.kind === "adhoc") return "adhoc";
	}
	return "";
}
function labelStr(labels: IrcExternalPeerLabels | undefined, key: keyof IrcExternalPeerLabels): string {
	const value = labels?.[key];
	return typeof value === "string" ? value : "";
}

function claimConflictPath(left: string, right: string): string | undefined {
	const normalizedLeft = left.replace(/\/+$/, "");
	const normalizedRight = right.replace(/\/+$/, "");
	if (normalizedLeft === normalizedRight) return normalizedLeft || undefined;
	if (!normalizedLeft || !normalizedRight) return undefined;
	if (!normalizedLeft.includes("/") && !normalizedRight.includes("/")) return undefined;
	if (normalizedRight.startsWith(`${normalizedLeft}/`)) return normalizedLeft;
	if (normalizedLeft.startsWith(`${normalizedRight}/`)) return normalizedRight;
	return undefined;
}

export function collectFleetOverview(options: FleetOverviewOptions = {}): readonly FleetOverviewRow[] {
	const nowMs = options.nowMs ?? Date.now();
	const isProcessAlive = options.isProcessAlive ?? isIrcExternalPeerProcessAlive;
	let bus: IrcExternalBus | undefined;
	try {
		bus = new IrcExternalBus(options.ircDbPath, { readonly: true });
	} catch {
		return [];
	}
	try {
		const peers = bus.listPeers({ includeStale: true });
		const rows: FleetOverviewRow[] = [];
		for (const peer of peers) {
			const displayState = getIrcExternalPeerDisplayState(peer, nowMs);
			const staleLiveIdle =
				displayState === "disconnected" &&
				(peer.state === "idle" || peer.state === "waiting_input" || peer.state === "paused") &&
				isProcessAlive(peer.pid);
			// Default: include fresh and stale-alive; --all includes everything
			if (!options.all && displayState === "disconnected" && !staleLiveIdle) continue;
			// Dead pid and disconnected → skip unless --all
			if (!options.all && displayState === "disconnected" && !isProcessAlive(peer.pid)) continue;
			const workstream = resolveWorkstream(peer);
			if (options.workstream && workstream !== options.workstream) continue;
			rows.push({
				sessionId: peer.sessionId,
				name: peer.name,
				// Preserve the recorded state for stale-live rows — rewriting
				// waiting_input to idle would tell operators a session needs
				// nothing when it is blocked on input (fleet status preserves it).
				displayState: staleLiveIdle ? peer.state : displayState,
				model: labelStr(peer.labels, "model"),
				workstream,
				objective: labelStr(peer.labels, "objective"),
				activity: labelStr(peer.labels, "activity"),
				todoHead: labelStr(peer.labels, "todoHead"),
				label: labelStr(peer.labels, "label"),
				summary: labelStr(peer.labels, "summary"),
				spawnName: labelStr(peer.labels, "spawnName"),
				claims: peer.labels?.claims ?? [],
				claimConflicts: [],
				lastSeen: peer.lastSeen,
				cwd: peer.cwd,
				pid: peer.pid,
				sessionJournal: peer.sessionFile ?? "",
				version: peer.fleetCapability?.productVersion ?? peer.version ?? "",
			});
		}

		const freshSessionIds = new Set(
			rows.filter(row => isIrcExternalPeerFresh(row.lastSeen, nowMs)).map(row => row.sessionId),
		);
		const conflicts = new Map<string, FleetClaimConflict[]>();
		const addConflict = (sessionId: string, conflict: FleetClaimConflict): void => {
			const existing = conflicts.get(sessionId) ?? [];
			if (!existing.some(candidate => candidate.with === conflict.with && candidate.path === conflict.path))
				existing.push(conflict);
			conflicts.set(sessionId, existing);
		};
		for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
			const left = rows[leftIndex];
			if (!freshSessionIds.has(left.sessionId)) continue;
			for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
				const right = rows[rightIndex];
				if (!freshSessionIds.has(right.sessionId)) continue;
				const paths = new Set<string>();
				for (const leftClaim of left.claims) {
					for (const rightClaim of right.claims) {
						const path = claimConflictPath(leftClaim, rightClaim);
						if (path !== undefined) paths.add(path);
					}
				}
				for (const path of paths) {
					addConflict(left.sessionId, { with: right.sessionId, path });
					addConflict(right.sessionId, { with: left.sessionId, path });
				}
			}
		}

		const decoratedRows = rows.map(row => ({
			...row,
			claimConflicts: (conflicts.get(row.sessionId) ?? []).sort(
				(left, right) => left.with.localeCompare(right.with) || left.path.localeCompare(right.path),
			),
		}));
		// Group by workstream then cwd
		decoratedRows.sort(
			(a, b) => a.workstream.localeCompare(b.workstream) || a.cwd.localeCompare(b.cwd) || a.name.localeCompare(b.name),
		);
		return decoratedRows;
	} finally {
		bus.close();
	}
}

function printable(value: string): string {
	if (!value) return "-";
	return value.replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
}

function shortenPath(cwd: string): string {
	const home = process.env.HOME ?? "";
	if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, max - 3)}...`;
}

function relativeAge(iso: string, nowMs: number): string {
	const delta = nowMs - Date.parse(iso);
	if (!Number.isFinite(delta) || delta < 0) return iso;
	if (delta < 60_000) return `${Math.floor(delta / 1000)}s`;
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
	return `${Math.floor(delta / 86_400_000)}d`;
}

export function formatFleetOverview(rows: readonly FleetOverviewRow[], nowMs = Date.now()): string {
	const header = ["NAME", "STATE", "MODEL", "WORKSTREAM", "OBJECTIVE / ACTIVITY", "AGE"].join("\t");
	const lines = [header];
	let lastWorkstream: string | undefined;
	for (const row of rows) {
		if (row.workstream !== lastWorkstream) {
			lastWorkstream = row.workstream;
		}
		const objectiveOrActivity = row.objective || row.activity || row.todoHead;
		lines.push(
			[
				printable(row.name),
				printable(
					row.claimConflicts.length > 0 ? `${row.displayState} [CONFLICT]` : row.displayState,
				),
				printable(truncate(row.model, 40)),
				printable(row.workstream),
				printable(truncate(objectiveOrActivity, 80)),
				relativeAge(row.lastSeen, nowMs),
			].join("\t"),
		);
	}
	return `${lines.join("\n")}\n`;
}

export interface FleetOverviewJsonRow {
	readonly session_id: string;
	readonly name: string;
	readonly state: IrcExternalPeerDisplayState;
	readonly model: string;
	readonly workstream: string;
	readonly objective: string;
	readonly activity: string;
	readonly todo_head: string;
	readonly label: string;
	readonly summary: string;
	readonly spawn_name: string;
	readonly claims: readonly string[];
	readonly claimConflicts: readonly FleetClaimConflict[];
	readonly last_seen: string;
	readonly cwd: string;
	readonly pid: number;
	readonly session_journal: string;
	readonly version: string;
}

export function formatFleetOverviewJson(rows: readonly FleetOverviewRow[]): string {
	const jsonRows: FleetOverviewJsonRow[] = rows.map(row => ({
		session_id: row.sessionId,
		name: row.name,
		state: row.displayState,
		model: row.model,
		workstream: row.workstream,
		objective: row.objective,
		activity: row.activity,
		todo_head: row.todoHead,
		label: row.label,
		claims: row.claims,
		claimConflicts: row.claimConflicts,
		summary: row.summary,
		spawn_name: row.spawnName,
		last_seen: row.lastSeen,
		cwd: row.cwd,
		pid: row.pid,
		session_journal: row.sessionJournal,
		version: row.version,
	}));
	return JSON.stringify(jsonRows, null, 2) + "\n";
}
