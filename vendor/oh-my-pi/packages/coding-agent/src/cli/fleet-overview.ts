import * as path from "node:path";
import {
	getIrcExternalPeerDisplayState,
	IrcExternalBus,
	IRC_EXTERNAL_STALE_MS,
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
	return labels?.[key] ?? "";
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
				(peer.state === "idle" || peer.state === "waiting_input") &&
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
				displayState: staleLiveIdle ? "idle" : displayState,
				model: labelStr(peer.labels, "model"),
				workstream,
				objective: labelStr(peer.labels, "objective"),
				activity: labelStr(peer.labels, "activity"),
				todoHead: labelStr(peer.labels, "todoHead"),
				label: labelStr(peer.labels, "label"),
				lastSeen: peer.lastSeen,
				cwd: peer.cwd,
				pid: peer.pid,
				sessionJournal: peer.sessionFile ?? "",
				version: peer.fleetCapability?.productVersion ?? peer.version ?? "",
			});
		}
		// Group by workstream then cwd
		rows.sort((a, b) => a.workstream.localeCompare(b.workstream) || a.cwd.localeCompare(b.cwd) || a.name.localeCompare(b.name));
		return rows;
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
				printable(row.displayState),
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
		last_seen: row.lastSeen,
		cwd: row.cwd,
		pid: row.pid,
		session_journal: row.sessionJournal,
		version: row.version,
	}));
	return JSON.stringify(jsonRows, null, 2) + "\n";
}
