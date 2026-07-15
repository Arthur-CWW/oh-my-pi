import * as path from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-utils";
import {
	getIrcExternalPeerDisplayState,
	IrcExternalBus,
	type IrcExternalPeer,
	type IrcPeerPruneResult,
} from "../irc/bus-external";
import { decodeJournalEntries, projectJournalEntries } from "../journal/projection";
import {
	classifyFleetCompatibility,
	createFleetCompatibilityProfile,
	type FleetProtocolRange,
} from "../session/fleet-capability";
import { RolloutJournal, type RolloutPeerSnapshot } from "../session/rollout-journal";
import { CURRENT_SESSION_CONTROL_PROTOCOL, SESSION_CONTROL_DB_PATH } from "../session/session-control";
import { type CustomEntry, decodeSessionWorkstream, type SessionHeader } from "../session/session-entries";
import { type FleetIncident, FleetIncidentStore } from "../task/fleet-incident";
import { sampleFleetResources } from "./fleet-resource-sampler";

const LOCAL_COMPATIBILITY = createFleetCompatibilityProfile(CURRENT_SESSION_CONTROL_PROTOCOL, ["status"]);

export interface FleetStatusOptions {
	readonly workstream?: string;
	readonly all?: boolean;
	readonly nowMs?: number;
	readonly ircDbPath?: string;
	readonly controlDbPath?: string;
}

export interface FleetPruneOptions {
	readonly apply?: boolean;
	readonly retentionMs?: number;
	readonly nowMs?: number;
	readonly ircDbPath?: string;
	readonly isProcessAlive?: (pid: number) => boolean;
}

export interface FleetStatusRow {
	readonly sessionId: string;
	readonly name: string;
	readonly workstream: string;
	readonly freshness: "fresh" | "stale";
	readonly state: string;
	readonly ownerEpoch: string;
	readonly buildDigest: string;
	readonly productVersion: string;
	readonly compatibility: string;
	readonly journalRange: string;
	readonly controlRange: string;
	readonly ircRange: string;
	readonly viewRange: string;
	readonly channel: string;
	readonly pin: string;
	readonly rollout: string;
	readonly rssMb?: number;
	readonly cpuPercent?: number;
	readonly uptime?: string;
}

export interface FleetErrorsOptions {
	readonly since?: string;
	readonly session?: string;
	readonly workstream?: string;
	readonly rollout?: string;
	readonly nowMs?: number;
	readonly sessionsRoot?: string;
	readonly controlDbPath?: string;
}

export interface FleetErrorRow {
	readonly sessionId: string;
	readonly workstream: string;
	readonly cause: string;
	readonly timestamp: number;
	readonly buildDigest: string;
	readonly buildVersion: string;
	readonly rolloutId: string;
	readonly count: number;
	readonly message: string;
	readonly sourceJournalUri: string;
}

export interface FleetErrorsProjection {
	readonly errors: readonly FleetErrorRow[];
	readonly incidents: readonly FleetIncident[];
}

interface FleetPinProjection {
	readonly channel?: string;
	readonly pin?: string;
}

function printable(value: string | undefined): string {
	if (!value) return "-";
	return value.replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
}

function formatWorkstream(workstream: unknown): string {
	const decoded = decodeSessionWorkstream(workstream);
	if (!decoded) return "unknown";
	return decoded.kind === "adhoc" ? "adhoc" : decoded.id;
}

function formatRange(range: FleetProtocolRange | undefined): string {
	return range ? `${range.minMajor}-${range.maxMajor}.${range.maxMinor}` : "unknown/legacy";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.length > 0) return candidate;
	}
	return undefined;
}

async function readPeerJournal(peer: IrcExternalPeer): Promise<{
	header?: SessionHeader;
	pin: FleetPinProjection;
}> {
	if (!peer.sessionFile) return { pin: {} };
	try {
		const projection = projectJournalEntries(decodeJournalEntries(await Bun.file(peer.sessionFile).text()));
		if (!projection) return { pin: {} };
		let pin: FleetPinProjection = {};
		for (const entry of projection.entries) {
			if (entry.type !== "custom" || !isRecord(entry.data)) continue;
			if (entry.customType === "fleet_pin") {
				pin =
					entry.data.action === "unpin"
						? { channel: "blessed" }
						: {
								channel: stringField(entry.data, "channel") ?? pin.channel,
								pin: stringField(entry.data, "digest", "pin"),
							};
			} else if (entry.customType === "fleet_channel") {
				pin = {
					channel: stringField(entry.data, "channel") ?? pin.channel,
					pin: stringField(entry.data, "digest", "pin") ?? pin.pin,
				};
			}
		}
		return { header: projection.header, pin };
	} catch {
		return { pin: {} };
	}
}

function openReadonlyRolloutJournal(dbPath: string | undefined): RolloutJournal | undefined {
	try {
		return new RolloutJournal(dbPath ?? SESSION_CONTROL_DB_PATH, { readonly: true });
	} catch {
		return undefined;
	}
}

function recoveredSnapshotMatchesPeer(peer: IrcExternalPeer, snapshot: RolloutPeerSnapshot): boolean {
	if (snapshot.phase !== "recovered") return true;
	if (!peer.sessionFile || !snapshot.sessionFile) return false;
	const digest = peer.fleetCapability?.buildDigest ?? peer.buildDigest;
	return (
		snapshot.sessionId === peer.sessionId &&
		path.resolve(snapshot.sessionFile) === path.resolve(peer.sessionFile) &&
		snapshot.targetDigest === digest
	);
}

export async function collectFleetStatus(options: FleetStatusOptions = {}): Promise<readonly FleetStatusRow[]> {
	const nowMs = options.nowMs ?? Date.now();
	let bus: IrcExternalBus | undefined;
	try {
		bus = new IrcExternalBus(options.ircDbPath, { readonly: true });
	} catch {
		return [];
	}
	const rolloutJournal = openReadonlyRolloutJournal(options.controlDbPath);
	try {
		const peers = bus.listPeers({ includeStale: true });
		const entries: Array<{ readonly pid: number; readonly row: FleetStatusRow }> = [];
		for (const peer of peers) {
			const journal = await readPeerJournal(peer);
			const workstream = formatWorkstream(peer.fleetCapability?.workstream ?? journal.header?.workstream);
			if (options.workstream && workstream !== options.workstream) continue;
			const displayState = getIrcExternalPeerDisplayState(peer, nowMs);
			if (!options.all && displayState === "disconnected") continue;
			const capability = peer.fleetCapability;
			const compatibility = classifyFleetCompatibility(peer, LOCAL_COMPATIBILITY);
			let rollout: RolloutPeerSnapshot | undefined;
			try {
				rollout = rolloutJournal?.latestForPeer({ sessionId: peer.sessionId, sessionFile: peer.sessionFile });
				if (rollout && !recoveredSnapshotMatchesPeer(peer, rollout)) rollout = undefined;
			} catch {
				rollout = undefined;
			}
			entries.push({
				pid: peer.pid,
				row: {
					sessionId: peer.sessionId,
					name: peer.name,
					workstream,
					freshness: displayState === "disconnected" ? "stale" : "fresh",
					state: peer.state,
					ownerEpoch: peer.ownerEpoch ?? "unknown",
					buildDigest: capability?.buildDigest ?? peer.buildDigest ?? "unknown/legacy",
					productVersion: capability?.productVersion ?? peer.version ?? "unknown/legacy",
					compatibility: compatibility.kind,
					journalRange: capability
						? `r:${formatRange(capability.journalSchema.read)},w:${formatRange(capability.journalSchema.write)}`
						: "unknown/legacy",
					controlRange: formatRange(capability?.controlProtocol),
					ircRange: capability ? String(capability.ircEnvelope.major) : "unknown/legacy",
					viewRange: formatRange(capability?.viewProtocol),
					channel: journal.pin.channel ?? "-",
					pin: journal.pin.pin ?? "-",
					rollout: rollout ? `${rollout.rolloutId}:${rollout.phase}` : "-",
				},
			});
		}
		const resources = await sampleFleetResources(entries.map(entry => entry.pid));
		return entries.map(({ pid, row }) => {
			const resource = resources.get(pid);
			return resource === undefined
				? row
				: {
						...row,
						rssMb: resource.rssMb,
						cpuPercent: resource.cpuPercent,
						uptime: resource.uptime,
					};
		});
	} finally {
		rolloutJournal?.close();
		bus.close();
	}
}

export function formatFleetStatus(rows: readonly FleetStatusRow[]): string {
	const header = [
		"SESSION",
		"NAME",
		"WORKSTREAM",
		"FRESHNESS",
		"STATE",
		"OWNER_EPOCH",
		"BUILD",
		"VERSION",
		"COMPATIBILITY",
		"JOURNAL",
		"CONTROL",
		"IRC",
		"VIEW",
		"CHANNEL",
		"PIN",
		"ROLLOUT",
		"RSS_MB",
		"CPU%",
		"UPTIME",
	].join("\t");
	return `${header}\n${rows
		.map(row =>
			[
				row.sessionId,
				row.name,
				row.workstream,
				row.freshness,
				row.state,
				row.ownerEpoch,
				row.buildDigest,
				row.productVersion,
				row.compatibility,
				row.journalRange,
				row.controlRange,
				row.ircRange,
				row.viewRange,
				row.channel,
				row.pin,
				row.rollout,
				typeof row.rssMb === "number" && Number.isFinite(row.rssMb) ? row.rssMb.toFixed(1) : "-",
				typeof row.cpuPercent === "number" && Number.isFinite(row.cpuPercent) ? row.cpuPercent.toFixed(1) : "-",
				row.uptime,
			]
				.map(printable)
				.join("\t"),
		)
		.join("\n")}\n`;
}

export function pruneFleetPeers(options: FleetPruneOptions = {}): IrcPeerPruneResult {
	let bus: IrcExternalBus;
	try {
		bus = new IrcExternalBus(options.ircDbPath, { readonly: !options.apply });
	} catch {
		return { candidates: [], deleted: 0 };
	}
	try {
		return bus.prunePeers({
			retentionMs: options.retentionMs ?? 7 * 24 * 60 * 60 * 1000,
			nowMs: options.nowMs,
			apply: options.apply,
			isProcessAlive: options.isProcessAlive,
		});
	} finally {
		bus.close();
	}
}

export function formatFleetPrune(result: IrcPeerPruneResult, applied: boolean): string {
	const lines = ["SESSION\tNAME\tPID\tLAST_SEEN\tREASON"];
	for (const { peer, reason } of result.candidates) {
		lines.push([peer.sessionId, peer.name, String(peer.pid), peer.lastSeen, reason].map(printable).join("\t"));
	}
	lines.push(`${applied ? "APPLIED" : "DRY_RUN"}\tcandidates=${result.candidates.length}\tdeleted=${result.deleted}`);
	return `${lines.join("\n")}\n`;
}

export function parseSince(value: string | undefined, nowMs = Date.now()): number | undefined {
	if (!value) return undefined;
	const duration = /^(\d+)(s|m|h|d|w)$/.exec(value);
	if (duration) {
		const scale =
			duration[2] === "s"
				? 1_000
				: duration[2] === "m"
					? 60_000
					: duration[2] === "h"
						? 3_600_000
						: duration[2] === "d"
							? 86_400_000
							: 604_800_000;
		return nowMs - Number(duration[1]) * scale;
	}
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) throw new Error(`Invalid --since value: ${value}`);
	return timestamp;
}

function decodeErrorRow(
	entry: CustomEntry,
	header: SessionHeader,
	sourceJournalUri: string,
): FleetErrorRow | undefined {
	if (entry.customType !== "ui_error" || !isRecord(entry.data) || entry.data.version !== 2) return undefined;
	const firstTimestamp =
		typeof entry.data.firstTimestamp === "number" ? entry.data.firstTimestamp : Date.parse(entry.timestamp);
	const lastTimestamp = typeof entry.data.lastTimestamp === "number" ? entry.data.lastTimestamp : firstTimestamp;
	if (!Number.isFinite(lastTimestamp)) return undefined;
	const count = typeof entry.data.count === "number" && entry.data.count > 0 ? Math.trunc(entry.data.count) : 1;
	return {
		sessionId: header.id,
		workstream: formatWorkstream(header.workstream),
		cause: stringField(entry.data, "cause", "category", "errorClass") ?? "unknown",
		timestamp: lastTimestamp,
		buildVersion: stringField(entry.data, "buildVersion", "version") ?? "unknown/legacy",
		buildDigest: stringField(entry.data, "buildDigest", "runnerBuildDigest") ?? "unknown/legacy",
		rolloutId: stringField(entry.data, "fleetRolloutId", "rolloutId") ?? "-",
		count,
		message: stringField(entry.data, "message", "detail") ?? "-",
		sourceJournalUri,
	};
}
function latestErrorEntries(entries: readonly CustomEntry[]): readonly CustomEntry[] {
	const latestByEventId = new Map<string, CustomEntry>();
	for (const entry of entries) {
		if (entry.customType === "ui_error_clear" && isRecord(entry.data) && entry.data.version === 1) {
			latestByEventId.clear();
			continue;
		}
		if (entry.customType !== "ui_error" || !isRecord(entry.data) || entry.data.version !== 2) continue;
		const eventId = stringField(entry.data, "id");
		if (eventId) latestByEventId.set(eventId, entry);
	}
	return [...latestByEventId.values()];
}

async function collectJournalPaths(sessionsRoot: string): Promise<readonly string[]> {
	try {
		return await Array.fromAsync(new Bun.Glob("*/*.jsonl").scan(sessionsRoot), name => path.join(sessionsRoot, name));
	} catch {
		return [];
	}
}

function readIncidentsReadonly(dbPath: string | undefined): readonly FleetIncident[] {
	let store: FleetIncidentStore | undefined;
	try {
		store = new FleetIncidentStore(dbPath ?? SESSION_CONTROL_DB_PATH, { readonly: true });
		return store.listIncidents();
	} catch {
		return [];
	} finally {
		store?.close();
	}
}

export async function collectFleetErrors(options: FleetErrorsOptions = {}): Promise<FleetErrorsProjection> {
	const since = parseSince(options.since, options.nowMs);
	const sessionsRoot = options.sessionsRoot ?? path.join(getAgentDir(), "sessions");
	const rows: FleetErrorRow[] = [];
	for (const journalPath of await collectJournalPaths(sessionsRoot)) {
		try {
			const projection = projectJournalEntries(decodeJournalEntries(await Bun.file(journalPath).text()));
			if (!projection) continue;
			const workstream = formatWorkstream(projection.header.workstream);
			if (options.session && projection.header.id !== options.session) continue;
			if (options.workstream && workstream !== options.workstream) continue;
			const sourceJournalUri = Bun.pathToFileURL(journalPath).href;
			const customEntries = projection.entries.filter((entry): entry is CustomEntry => entry.type === "custom");
			for (const entry of latestErrorEntries(customEntries)) {
				const row = decodeErrorRow(entry, projection.header, sourceJournalUri);
				if (!row || (since !== undefined && row.timestamp < since)) continue;
				if (options.rollout && row.rolloutId !== options.rollout) continue;
				rows.push(row);
			}
		} catch {
			// A disappearing or malformed local journal does not hide the rest of the fleet.
		}
	}
	rows.sort(
		(left, right) =>
			left.sessionId.localeCompare(right.sessionId) ||
			left.cause.localeCompare(right.cause) ||
			right.timestamp - left.timestamp,
	);
	const incidents = readIncidentsReadonly(options.controlDbPath).filter(
		incident =>
			since === undefined || incident.openedAt >= since || incident.evidence.some(item => item.occurredAt >= since),
	);
	return { errors: rows, incidents };
}

export function formatFleetErrors(projection: FleetErrorsProjection): string {
	const lines = ["ERRORS", "SESSION\tWORKSTREAM\tCAUSE\tTIME\tBUILD_VERSION\tBUILD_DIGEST\tROLLOUT\tCOUNT\tMESSAGE\tSOURCE_JOURNAL_URI"];
	for (const row of projection.errors) {
		lines.push(
			[
				row.sessionId,
				row.workstream,
				row.cause,
				new Date(row.timestamp).toISOString(),
				row.buildVersion,
				row.buildDigest,
				row.rolloutId,
				String(row.count),
				row.message,
				row.sourceJournalUri,
			]
				.map(printable)
				.join("\t"),
		);
	}
	lines.push("", "INCIDENTS", "INCIDENT\tSTATUS\tCAUSE\tOPENED\tEVIDENCE\tSOURCE_JOURNALS");
	for (const incident of projection.incidents) {
		lines.push(
			[
				incident.id,
				incident.status,
				incident.failureClass,
				new Date(incident.openedAt).toISOString(),
				String(incident.evidence.length),
				incident.evidence
					.map(item => item.journalUri)
					.filter((uri): uri is string => uri !== undefined)
					.join(",") || "-",
			]
				.map(printable)
				.join("\t"),
		);
	}
	return `${lines.join("\n")}\n`;
}
