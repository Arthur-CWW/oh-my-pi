import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { sampleFleetResources, type FleetResourceSample } from "../cli/fleet-resource-sampler";
import {
	getIrcExternalPeerDisplayState,
	IrcExternalBus,
	resolveFleetHostId,
	type IrcExternalPeer,
	type IrcExternalPeerDisplayState,
	type IrcExternalPeerState,
} from "../irc/bus-external";
import { decodeJournalEntries, projectJournalEntries } from "../journal/projection";
import { SessionControlBus, type OperatorDirectiveCommand, type SessionControlReceipt } from "./session-control";

type SessionAttention = "active" | "needs-attention" | "idle" | "unavailable";
export type SessionDirectorySortKey = "attention" | "hostId" | "lastSeen" | "name" | "sessionId" | "state" | "workstream";

export interface SessionProcessProfile {
	readonly pid: number;
	readonly rssMb?: number;
	readonly cpuPercent?: number;
	readonly uptime?: string;
}

export interface SessionDirectoryError {
	readonly timestamp: number;
	readonly cause: string;
	readonly message: string;
}

export interface SessionDirectoryReceipt {
	readonly commandId: string;
	readonly state: SessionControlReceipt["state"];
	readonly requestedAt: string;
	readonly acknowledgedAt?: string;
	readonly completedAt?: string;
	readonly resultKind?: string;
	readonly error?: string;
}

export interface SessionDirectoryRow {
	readonly sessionId: string;
	readonly hostId: string;
	readonly peer?: string;
	readonly name: string;
	readonly label?: string;
	readonly workstream: string;
	readonly state: IrcExternalPeerState;
	readonly attention: SessionAttention;
	readonly freshness: "fresh" | "stale";
	readonly lastSeen: string;
	readonly ownerEpoch?: string;
	readonly buildDigest?: string;
	readonly buildVersion?: string;
	readonly model?: string;
	readonly cwd: string;
	readonly workspaceUri: string;
	readonly activeJjChange?: string;
	readonly claims: readonly string[];
	readonly tags: readonly string[];
	readonly summary?: string;
	readonly processProfile: SessionProcessProfile;
	readonly lastError?: SessionDirectoryError;
	readonly lastReceipt?: SessionDirectoryReceipt;
	readonly controlProtocol?: { readonly minMajor: number; readonly maxMajor: number; readonly maxMinor: number };
	readonly viewProtocol?: { readonly minMajor: number; readonly maxMajor: number; readonly maxMinor: number };
}

export interface SessionDirectoryQuery {
	readonly text?: string;
	readonly sessionId?: string;
	readonly hostId?: string;
	readonly peer?: string;
	readonly name?: string;
	readonly label?: string;
	readonly workstream?: string;
	readonly state?: IrcExternalPeerState;
	readonly attention?: SessionAttention;
	readonly model?: string;
	readonly claim?: string;
	readonly tags?: readonly string[];
	readonly freshness?: "fresh" | "stale";
	readonly sort?: SessionDirectorySortKey;
	readonly descending?: boolean;
}

export interface SessionDirectoryOptions extends SessionDirectoryQuery {
	readonly ircDbPath?: string;
	readonly controlDbPath?: string;
	readonly nowMs?: number;
	readonly includeProcessProfile?: boolean;
}

export class SessionDirectoryResolutionError extends Error {
	constructor(
		readonly kind: "not-found" | "ambiguous",
		message: string,
		readonly candidates: readonly SessionDirectoryRow[] = [],
	) {
		super(message);
		this.name = "SessionDirectoryResolutionError";
	}
}

function workstream(peer: IrcExternalPeer): string {
	const explicit = peer.labels?.workstream?.trim();
	if (explicit) return explicit;
	const value = peer.fleetCapability?.workstream;
	if (value?.kind === "workstream") return value.id;
	return value?.kind === "adhoc" ? "adhoc" : "unclassified";
}

function attention(display: IrcExternalPeerDisplayState): SessionAttention {
	if (display === "disconnected" || display === "unknown") return "unavailable";
	if (display === "waiting_input") return "needs-attention";
	if (display === "idle" || display === "paused") return "idle";
	return "active";
}

function bounded(value: string | undefined, limit: number): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed.slice(0, limit) : undefined;
}

function stringField(value: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const field = value[key];
		if (typeof field === "string" && field.trim()) return field;
	}
	return undefined;
}

async function lastJournalError(peer: IrcExternalPeer): Promise<SessionDirectoryError | undefined> {
	if (!peer.sessionFile) return undefined;
	try {
		const projection = projectJournalEntries(decodeJournalEntries(await Bun.file(peer.sessionFile).text()));
		if (!projection) return undefined;
		let latest: SessionDirectoryError | undefined;
		for (const entry of projection.entries) {
			if (entry.type !== "custom" || entry.customType !== "ui_error") continue;
			if (typeof entry.data !== "object" || entry.data === null || Array.isArray(entry.data)) continue;
			const data = entry.data as Record<string, unknown>;
			if (data.version !== 2) continue;
			const timestamp = typeof data.lastTimestamp === "number" ? data.lastTimestamp : Date.parse(entry.timestamp);
			if (!Number.isFinite(timestamp) || (latest && latest.timestamp > timestamp)) continue;
			latest = {
				timestamp,
				cause: bounded(stringField(data, "cause", "category", "errorClass"), 120) ?? "unknown",
				message: bounded(stringField(data, "message", "detail"), 1_024) ?? "-",
			};
		}
		return latest;
	} catch {
		return undefined;
	}
}

function receiptSummary(receipt: SessionControlReceipt): SessionDirectoryReceipt {
	const result = typeof receipt.result === "object" && receipt.result !== null ? (receipt.result as Record<string, unknown>) : undefined;
	return {
		commandId: receipt.commandId,
		state: receipt.state,
		requestedAt: receipt.requestedAt,
		...(receipt.acknowledgedAt ? { acknowledgedAt: receipt.acknowledgedAt } : {}),
		...(receipt.completedAt ? { completedAt: receipt.completedAt } : {}),
		...(typeof result?.kind === "string" ? { resultKind: result.kind.slice(0, 120) } : {}),
		...(receipt.error ? { error: receipt.error.slice(0, 1_024) } : {}),
	};
}

function receiptMap(dbPath: string | undefined): Map<string, SessionDirectoryReceipt> {
	const result = new Map<string, SessionDirectoryReceipt>();
	let bus: SessionControlBus | undefined;
	try {
		bus = new SessionControlBus(dbPath, { readonly: true });
		for (const receipt of bus.listReceipts()) result.set(receipt.sessionId, receiptSummary(receipt));
	} catch {
		return result;
	} finally {
		bus?.close();
	}
	return result;
}

function matches(row: SessionDirectoryRow, query: SessionDirectoryQuery): boolean {
	if (query.sessionId !== undefined && row.sessionId !== query.sessionId) return false;
	if (query.hostId !== undefined && row.hostId !== query.hostId) return false;
	if (query.peer !== undefined && row.peer !== query.peer) return false;
	if (query.name !== undefined && row.name !== query.name) return false;
	if (query.label !== undefined && row.label !== query.label) return false;
	if (query.workstream !== undefined && row.workstream !== query.workstream) return false;
	if (query.state !== undefined && row.state !== query.state) return false;
	if (query.attention !== undefined && row.attention !== query.attention) return false;
	if (query.model !== undefined && row.model !== query.model) return false;
	if (query.claim !== undefined && !row.claims.includes(query.claim)) return false;
	if (query.tags?.some(tag => !row.tags.includes(tag))) return false;
	if (query.freshness !== undefined && row.freshness !== query.freshness) return false;
	if (query.text) {
		const needle = query.text.toLocaleLowerCase();
		const values = [row.sessionId, row.hostId, row.peer, row.name, row.label, row.workstream, row.model, row.summary, ...row.claims, ...row.tags];
		if (!values.some(value => value?.toLocaleLowerCase().includes(needle))) return false;
	}
	return true;
}

function compareRows(left: SessionDirectoryRow, right: SessionDirectoryRow, key: SessionDirectorySortKey): number {
	const compared = String(left[key]).localeCompare(String(right[key]));
	return compared || left.hostId.localeCompare(right.hostId) || left.sessionId.localeCompare(right.sessionId);
}

export async function querySessionDirectory(options: SessionDirectoryOptions = {}): Promise<readonly SessionDirectoryRow[]> {
	let bus: IrcExternalBus | undefined;
	try {
		bus = new IrcExternalBus(options.ircDbPath, { readonly: true });
	} catch {
		return [];
	}
	try {
		const peers = bus.listPeers({ includeStale: true });
		const profiles = options.includeProcessProfile === false ? new Map<number, FleetResourceSample>() : await sampleFleetResources(peers.map(peer => peer.pid));
		const receipts = receiptMap(options.controlDbPath);
		const errors = await Promise.all(peers.map(lastJournalError));
		const rows = peers.map((peer, index): SessionDirectoryRow => {
			const display = getIrcExternalPeerDisplayState(peer, options.nowMs);
			const profile = profiles.get(peer.pid);
			return {
				sessionId: peer.sessionId,
				hostId: resolveFleetHostId(peer.hostId),
				...(peer.agentId ? { peer: peer.agentId } : {}),
				name: peer.name,
				...(bounded(peer.labels?.label, 120) ? { label: bounded(peer.labels?.label, 120) } : {}),
				workstream: workstream(peer),
				state: peer.state,
				attention: attention(display),
				freshness: display === "disconnected" ? "stale" : "fresh",
				lastSeen: peer.lastSeen,
				...(peer.ownerEpoch ? { ownerEpoch: peer.ownerEpoch } : {}),
				...(peer.fleetCapability?.buildDigest ?? peer.buildDigest ? { buildDigest: peer.fleetCapability?.buildDigest ?? peer.buildDigest } : {}),
				...(peer.fleetCapability?.productVersion ?? peer.version ? { buildVersion: peer.fleetCapability?.productVersion ?? peer.version } : {}),
				...(bounded(peer.labels?.model, 120) ? { model: bounded(peer.labels?.model, 120) } : {}),
				cwd: peer.cwd,
				workspaceUri: pathToFileURL(peer.cwd).href,
				...(bounded(peer.labels?.activeJjChange, 120) ? { activeJjChange: bounded(peer.labels?.activeJjChange, 120) } : {}),
				claims: peer.labels?.claims ?? [],
				tags: peer.labels?.tags ?? [],
				...(bounded(peer.labels?.summary, 280) ? { summary: bounded(peer.labels?.summary, 280) } : {}),
				processProfile: { pid: peer.pid, ...profile },
				...(errors[index] ? { lastError: errors[index] } : {}),
				...(receipts.get(peer.sessionId) ? { lastReceipt: receipts.get(peer.sessionId) } : {}),
				...(peer.fleetCapability?.controlProtocol ? { controlProtocol: peer.fleetCapability.controlProtocol } : {}),
				...(peer.fleetCapability?.viewProtocol ? { viewProtocol: peer.fleetCapability.viewProtocol } : {}),
			};
		});
		const key = options.sort ?? "name";
		const direction = options.descending ? -1 : 1;
		return rows.filter(row => matches(row, options)).sort((left, right) => direction * compareRows(left, right, key));
	} finally {
		bus.close();
	}
}

export function resolveSessionDirectorySelector(
	rows: readonly SessionDirectoryRow[],
	selector: string,
	options: { readonly hostId?: string } = {},
): SessionDirectoryRow {
	const exactHostRows = options.hostId === undefined ? rows : rows.filter(row => row.hostId === options.hostId);
	const bySession = exactHostRows.filter(row => row.sessionId === selector);
	const candidates = bySession.length > 0 ? bySession : exactHostRows.filter(row => row.peer === selector || row.name === selector || row.label === selector);
	if (candidates.length === 1) return candidates[0]!;
	if (candidates.length === 0) throw new SessionDirectoryResolutionError("not-found", `No exact session directory match for ${selector}`);
	const identities = candidates.map(row => `${row.hostId}/${row.name} (${row.sessionId})`).join(", ");
	throw new SessionDirectoryResolutionError("ambiguous", `Ambiguous session selector ${selector}: ${identities}`, candidates);
}

export async function inspectSessionDirectory(
	selector: string,
	options: Pick<SessionDirectoryOptions, "hostId" | "ircDbPath" | "controlDbPath" | "nowMs"> = {},
): Promise<SessionDirectoryRow> {
	const rows = await querySessionDirectory({ ...options, includeProcessProfile: true });
	return resolveSessionDirectorySelector(rows, selector, { hostId: options.hostId });
}

function deterministicCommandId(sessionId: string, ownerEpoch: string, idempotencyKey: string): string {
	const hex = createHash("sha256").update(`${sessionId}\0${ownerEpoch}\0${idempotencyKey}`, "utf8").digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function createOperatorDirectiveCommand(input: {
	readonly sessionId: string;
	readonly targetOwnerEpoch: string;
	readonly delegatedThrough: string;
	readonly intent: string;
	readonly idempotencyKey: string;
	readonly requestedAt?: string;
}): OperatorDirectiveCommand {
	return {
		schemaVersion: 2,
		commandId: deterministicCommandId(input.sessionId, input.targetOwnerEpoch, input.idempotencyKey),
		source: {
			kind: "local-cli",
			instanceId: randomUUID(),
			pid: process.pid,
			...(process.getuid ? { uid: process.getuid() } : {}),
		},
		sessionId: input.sessionId,
		targetOwnerEpoch: input.targetOwnerEpoch,
		requestedAt: input.requestedAt ?? new Date().toISOString(),
		intent: {
			kind: "operatorDirective",
			issuedBy: "arthur",
			delegatedThrough: input.delegatedThrough,
			intent: input.intent,
			idempotencyKey: input.idempotencyKey,
		},
	};
}

export async function issueOperatorDirective(input: {
	readonly selector: string;
	readonly hostId?: string;
	readonly delegatedThrough: string;
	readonly intent: string;
	readonly idempotencyKey: string;
	readonly ircDbPath?: string;
	readonly controlDbPath?: string;
	readonly timeoutMs?: number;
}): Promise<SessionControlReceipt> {
	const target = await inspectSessionDirectory(input.selector, input);
	if (target.freshness !== "fresh") throw new Error(`Session ${target.sessionId} on ${target.hostId} has a stale owner projection`);
	if (!target.ownerEpoch) throw new Error(`Session ${target.sessionId} has no owner epoch`);
	const bus = new SessionControlBus(input.controlDbPath);
	try {
		const actualEpoch = bus.getTargetOwnerEpoch(target.sessionId);
		if (actualEpoch !== target.ownerEpoch) {
			throw new Error(`Stale owner for ${target.sessionId}: directory=${target.ownerEpoch}, control=${actualEpoch ?? "unbound"}`);
		}
		const command = createOperatorDirectiveCommand({
			sessionId: target.sessionId,
			targetOwnerEpoch: target.ownerEpoch,
			delegatedThrough: input.delegatedThrough,
			intent: input.intent,
			idempotencyKey: input.idempotencyKey,
		});
		const receipt = bus.request(command);
		if (receipt.state === "applied" || receipt.state === "failed") return receipt;
		return await bus.waitForTerminal(command.commandId, { timeoutMs: input.timeoutMs ?? 30_000 });
	} finally {
		bus.close();
	}
}

export function formatSessionDirectoryJson(value: readonly SessionDirectoryRow[] | SessionDirectoryRow | SessionControlReceipt): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

export function formatSessionDirectory(rows: readonly SessionDirectoryRow[]): string {
	if (rows.length === 0) return "No sessions matched.\n";
	return rows.map(row => `SESSION\thost=${row.hostId}\tsessionId=${row.sessionId}\tname=${row.name}\tworkstream=${row.workstream}\tstate=${row.state}\tattention=${row.attention}\townerEpoch=${row.ownerEpoch ?? "-"}\tmodel=${row.model ?? "-"}`).join("\n") + "\n";
}
