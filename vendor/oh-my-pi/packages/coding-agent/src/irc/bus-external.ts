import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	classifyFleetBuildProvenance,
	decodeFleetCapability,
	type FleetCapability,
} from "../session/fleet-capability";
import type { IrcDeliveryRecord, IrcMessageOrigin } from "./bus";

export type IrcExternalPeerState = "unknown" | "working" | "waiting_input" | "idle" | "paused";
export type IrcExternalPeerDisplayState = IrcExternalPeerState | "disconnected";
export type IrcExternalMessageOrigin = IrcMessageOrigin;

/** Structured self-description published by a session at registration and heartbeat. */
export interface IrcExternalPeerLabels {
	/** Active goal objective, truncated ~120ch; empty when no goal. */
	objective?: string;
	/** Goal workstream slug. */
	workstream?: string;
	/** Short mechanical label of the current turn: latest user-ask first line or active tool intent _i. */
	activity?: string;
	/** Current in-progress todo content, if a todo list exists. */
	todoHead?: string;
	/** Optional user/session-set display name. */
	label?: string;
	/** Resolved model selector (provider/modelId). */
	model?: string;
	/** Observer-written prose summary, limited to 280 characters at write time. */
	summary?: string;
	/** Workspace-relative path prefixes or stream slugs currently owned by this session. */
	claims?: string[];
	/** Original ambient name captured on the first rename. */
	spawnName?: string;
}

export type IrcExternalPeerLabelPatch = {
	[K in keyof IrcExternalPeerLabels]?: IrcExternalPeerLabels[K] | null;
};

export interface IrcExternalPeer {
	sessionId: string;
	/** Stable in-process agent id used to address subprocess workers across the bus. */
	agentId?: string;
	name: string;
	cwd: string;
	pid: number;
	lastSeen: string;
	state: IrcExternalPeerState;
	stateTs: string | null;
	/** True when the operator supplied irc.peerName; ambient automation must preserve it. */
	explicitName?: boolean;
	sessionFile?: string;
	ownerEpoch?: string;
	buildDigest?: string;
	version?: string;
	fleetCapability?: FleetCapability;
	labels?: IrcExternalPeerLabels;
}

export interface IrcExternalMessage {
	id: number;
	ts: string;
	fromPeer: string;
	toPeer: string;
	body: string;
	origin: IrcExternalMessageOrigin;
}

interface PeerRow {
	session_id: string;
	agent_id: string | null;
	name: string;
	cwd: string;
	pid: number;
	last_seen: string;
	state: string;
	state_ts: string | null;
	explicit_name: number;
	session_file: string | null;
	owner_epoch: string | null;
	build_digest: string | null;
	version: string | null;
	fleet_capability_json: string | null;
	label_json: string | null;
}

interface MessageRow {
	id: number;
	ts: string;
	from_peer: string;
	to_peer: string;
	body: string;
	origin: string;
	delivered: number;
}

interface TableInfoRow {
	name: string;
}

export interface IrcExternalRegistration {
	sessionId: string;
	/** Stable in-process agent id used for cross-process IRC addressing. */
	agentId?: string;
	name: string;
	cwd: string;
	pid?: number;
	explicitName?: boolean;
	sessionFile?: string;
	ownerEpoch?: string;
	buildDigest?: string;
	version?: string;
	fleetCapability?: FleetCapability;
	labels?: IrcExternalPeerLabels;
}

export interface IrcExternalBusOptions {
	readonly readonly?: boolean;
}
export const IRC_EXTERNAL_STALE_MS = 10 * 60 * 1000;
/** Idle sessions touch their durable heartbeat before the ten-minute stale window. */
export const IRC_EXTERNAL_IDLE_HEARTBEAT_MS = 4 * 60 * 1000;

export interface IrcPeerPruneCandidate {
	readonly peer: IrcExternalPeer;
	readonly reason: "stale-dead-test-or-temp";
}

export interface IrcPeerPruneResult {
	readonly candidates: readonly IrcPeerPruneCandidate[];
	readonly deleted: number;
}

export function isIrcExternalPeerProcessAlive(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function isTempPeer(peer: IrcExternalPeer): boolean {
	const resolved = path.resolve(peer.cwd);
	const tempRoot = path.resolve(os.tmpdir());
	return resolved === tempRoot || resolved.startsWith(`${tempRoot}${path.sep}`) || resolved.startsWith("/var/folders/");
}

function hasTestOrTempProvenance(peer: IrcExternalPeer): boolean {
	if (isTempPeer(peer)) return true;
	if (peer.buildDigest === undefined && peer.version === undefined && peer.fleetCapability === undefined) return false;
	return !classifyFleetBuildProvenance(peer).valid;
}

const DEFAULT_DB_PATH = path.join(os.homedir(), ".omp", "agent", "irc-bus.sqlite");

function nowIso(): string {
	return new Date().toISOString();
}

function parseTime(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePeerState(value: string): IrcExternalPeerState {
	return value === "working" || value === "waiting_input" || value === "idle" || value === "paused" ? value : "unknown";
}

function decodeFleetCapabilityJson(value: string | null): FleetCapability | undefined {
	if (value === null) return undefined;
	try {
		return decodeFleetCapability(JSON.parse(value));
	} catch {
		return undefined;
	}
}

export function isIrcExternalPeerFresh(lastSeen: string, nowMs = Date.now(), staleMs = IRC_EXTERNAL_STALE_MS): boolean {
	return nowMs - parseTime(lastSeen) <= staleMs;
}

const MAX_SUMMARY_LENGTH = 280;
const MAX_CLAIMS = 16;
const MAX_CLAIM_LENGTH = 120;
const PEER_LABEL_KEYS: readonly (keyof IrcExternalPeerLabels)[] = [
	"objective",
	"workstream",
	"activity",
	"todoHead",
	"label",
	"model",
	"summary",
	"claims",
	"spawnName",
];

function parseLabelObject(value: string | null): Record<string, unknown> {
	if (value === null) return {};
	try {
		const parsed: unknown = JSON.parse(value);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		return parsed as Record<string, unknown>;
	} catch {
		return {};
	}
}

function normalizeClaims(claims: readonly string[]): string[] {
	return claims
		.slice(0, MAX_CLAIMS)
		.map(claim => claim.replace(/\/+$/, "").slice(0, MAX_CLAIM_LENGTH))
		.filter(claim => claim.length > 0);
}

function normalizePeerLabels(labels: IrcExternalPeerLabels | undefined): IrcExternalPeerLabels | undefined {
	if (labels === undefined) return undefined;
	let normalized = labels;
	if (labels.summary !== undefined && labels.summary.length > MAX_SUMMARY_LENGTH) {
		normalized = { ...normalized, summary: labels.summary.slice(0, MAX_SUMMARY_LENGTH) };
	}
	if (labels.claims !== undefined) {
		normalized = { ...normalized, claims: normalizeClaims(labels.claims) };
	}
	return normalized;
}

function decodeLabelJson(value: string | null): IrcExternalPeerLabels | undefined {
	if (value === null) return undefined;
	try {
		const parsed = JSON.parse(value);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
		const labels: IrcExternalPeerLabels = {};
		if (typeof parsed.objective === "string") labels.objective = parsed.objective;
		if (typeof parsed.workstream === "string") labels.workstream = parsed.workstream;
		if (typeof parsed.activity === "string") labels.activity = parsed.activity;
		if (typeof parsed.todoHead === "string") labels.todoHead = parsed.todoHead;
		if (typeof parsed.label === "string") labels.label = parsed.label;
		if (typeof parsed.model === "string") labels.model = parsed.model;
		if (typeof parsed.summary === "string") labels.summary = parsed.summary;
		if (Array.isArray(parsed.claims)) {
			const claims = parsed.claims.filter((claim: unknown): claim is string => typeof claim === "string");
			labels.claims = normalizeClaims(claims);
		}
		if (typeof parsed.spawnName === "string") labels.spawnName = parsed.spawnName;
		return Object.keys(labels).length > 0 ? labels : undefined;
	} catch {
		return undefined;
	}
}


export function getIrcExternalPeerDisplayState(
	peer: Pick<IrcExternalPeer, "lastSeen" | "state">,
	nowMs = Date.now(),
	staleMs = IRC_EXTERNAL_STALE_MS,
): IrcExternalPeerDisplayState {
	return isIrcExternalPeerFresh(peer.lastSeen, nowMs, staleMs) ? peer.state : "disconnected";
}

function sanitizePeerComponent(value: string): string {
	const normalized = value
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || "omp";
}

function stableSuffix(seed: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < seed.length; index++) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(36).padStart(6, "0").slice(-6);
}

export function resolveIrcExternalPeerName(args: {
	configuredName?: string | null;
	cwd: string;
	sessionId: string;
}): string {
	const configured = args.configuredName?.trim();
	if (configured) return configured;
	const base = sanitizePeerComponent(path.basename(path.resolve(args.cwd)) || "omp");
	return `${base}-${stableSuffix(args.sessionId)}`;
}

function toPeer(row: PeerRow): IrcExternalPeer {
	return {
		sessionId: row.session_id,
		agentId: row.agent_id ?? undefined,
		name: row.name,
		cwd: row.cwd,
		pid: row.pid,
		lastSeen: row.last_seen,
		state: normalizePeerState(row.state),
		stateTs: row.state_ts,
		explicitName: row.explicit_name === 1,
		sessionFile: row.session_file ?? undefined,
		ownerEpoch: row.owner_epoch ?? undefined,
		buildDigest: row.build_digest ?? undefined,
		version: row.version ?? undefined,
		fleetCapability: decodeFleetCapabilityJson(row.fleet_capability_json),
		labels: decodeLabelJson(row.label_json),
	};
}
function toUnregisteredPeer(peer: IrcExternalRegistration, pid: number): IrcExternalPeer {
	return {
		sessionId: peer.sessionId,
		agentId: peer.agentId,
		name: peer.name,
		cwd: peer.cwd,
		pid,
		lastSeen: nowIso(),
		state: "unknown",
		stateTs: null,
		explicitName: Boolean(peer.explicitName),
		sessionFile: peer.sessionFile,
		ownerEpoch: peer.ownerEpoch,
		buildDigest: peer.buildDigest,
		version: peer.version,
		fleetCapability: peer.fleetCapability,
		labels: normalizePeerLabels(peer.labels),
	};
}


function toMessage(row: MessageRow): IrcExternalMessage {
	return {
		id: row.id,
		ts: row.ts,
		fromPeer: row.from_peer,
		toPeer: row.to_peer,
		body: row.body,
		origin: row.origin === "user" || row.origin === "system" ? row.origin : "agent",
	};
}

export class IrcExternalBus {
	static #global: IrcExternalBus | undefined;

	static global(): IrcExternalBus {
		if (!IrcExternalBus.#global) {
			IrcExternalBus.#global = new IrcExternalBus();
		}
		return IrcExternalBus.#global;
	}

	static resetGlobalForTests(): void {
		IrcExternalBus.#global?.close();
		IrcExternalBus.#global = undefined;
	}

	readonly #db: Database;
	/** Registration is evaluated once per bus so print-mode fences cannot leak after construction. */
	readonly #registrationEnabled: boolean;

	#agentIdSelect = "agent_id";
	#agentIdWhere = "agent_id = $name";
	#fleetCapabilitySelect = "fleet_capability_json";
	#labelSelect = "label_json";

	#ensurePeerStateColumns(): void {
		const columns = new Set(
			this.#db
				.query<TableInfoRow, []>("PRAGMA table_info(peers)")
				.all()
				.map(column => column.name),
		);
		if (!columns.has("state")) {
			this.#db.run("ALTER TABLE peers ADD COLUMN state TEXT NOT NULL DEFAULT 'unknown'");
		}
		if (!columns.has("state_ts")) {
			this.#db.run("ALTER TABLE peers ADD COLUMN state_ts TEXT");
		}
		if (!columns.has("explicit_name")) {
			this.#db.run("ALTER TABLE peers ADD COLUMN explicit_name INTEGER NOT NULL DEFAULT 0");
		}
		if (!columns.has("session_file")) {
			this.#db.run("ALTER TABLE peers ADD COLUMN session_file TEXT");
		}
		if (!columns.has("owner_epoch")) {
			this.#db.run("ALTER TABLE peers ADD COLUMN owner_epoch TEXT");
		}
		if (!columns.has("build_digest")) {
			this.#db.run("ALTER TABLE peers ADD COLUMN build_digest TEXT");
		}
		if (!columns.has("version")) {
			this.#db.run("ALTER TABLE peers ADD COLUMN version TEXT");
		}
		if (!columns.has("fleet_capability_json")) {
			this.#db.run("ALTER TABLE peers ADD COLUMN fleet_capability_json TEXT");
		}
		if (!columns.has("label_json")) {
			this.#db.run("ALTER TABLE peers ADD COLUMN label_json TEXT");
		}
		if (!columns.has("agent_id")) {
			this.#db.run("ALTER TABLE peers ADD COLUMN agent_id TEXT");
		}
	}
	#ensureMessageOriginColumn(): void {
		const columns = new Set(
			this.#db
				.query<TableInfoRow, []>("PRAGMA table_info(messages)")
				.all()
				.map(column => column.name),
		);
		if (!columns.has("origin")) {
			this.#db.run("ALTER TABLE messages ADD COLUMN origin TEXT NOT NULL DEFAULT 'agent'");
		}
	}

	#getPeerBySessionId(sessionId: string): IrcExternalPeer | undefined {
		const row = this.#db
			.query<PeerRow, { $sessionId: string }>(
				`SELECT session_id, agent_id, name, cwd, pid, last_seen, state, state_ts, explicit_name, session_file, owner_epoch, build_digest, version, ${this.#fleetCapabilitySelect}, ${this.#labelSelect} FROM peers WHERE session_id = $sessionId`,
			)
			.get({ $sessionId: sessionId });
		return row ? toPeer(row) : undefined;
	}

	constructor(readonly dbPath: string = DEFAULT_DB_PATH, options: IrcExternalBusOptions = {}) {
		this.#registrationEnabled = process.env.OMP_FLEET_REGISTER !== "0";
		if (!options.readonly) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		this.#db = options.readonly ? new Database(dbPath, { readonly: true }) : new Database(dbPath);
		this.#db.run("PRAGMA busy_timeout = 3000");
		if (options.readonly) {
			const columns = this.#db.query<TableInfoRow, []>("PRAGMA table_info(peers)").all();
			if (!columns.some(column => column.name === "agent_id")) {
				this.#agentIdSelect = "NULL AS agent_id";
				this.#agentIdWhere = "0";
			}
			if (!columns.some(column => column.name === "fleet_capability_json")) {
				this.#fleetCapabilitySelect = "NULL AS fleet_capability_json";
			}
			if (!columns.some(column => column.name === "label_json")) {
				this.#labelSelect = "NULL AS label_json";
			}
			return;
		}
		this.#db.run("PRAGMA journal_mode = WAL");
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS peers (
				session_id TEXT PRIMARY KEY,
				agent_id TEXT,
				name TEXT,
				cwd TEXT,
				pid INTEGER,
				last_seen TEXT,
				state TEXT NOT NULL DEFAULT 'unknown',
				state_ts TEXT,
				explicit_name INTEGER NOT NULL DEFAULT 0,
				session_file TEXT,
				owner_epoch TEXT,
				build_digest TEXT,
				version TEXT,
				fleet_capability_json TEXT,
				label_json TEXT
			)
		`);
		this.#ensurePeerStateColumns();
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS messages (
				id INTEGER PRIMARY KEY,
				ts TEXT,
				from_peer TEXT,
				to_peer TEXT,
				body TEXT,
				delivered INTEGER DEFAULT 0
			)
		`);
		this.#ensureMessageOriginColumn();
		this.#db.run("CREATE INDEX IF NOT EXISTS idx_irc_messages_to_delivered ON messages(to_peer, delivered, id)");
		this.#db.run("CREATE INDEX IF NOT EXISTS idx_irc_peers_name ON peers(name)");
	}

	close(): void {
		this.#db.close();
	}

	registerPeer(peer: IrcExternalRegistration): IrcExternalPeer {
		const pid = peer.pid ?? process.pid;
		if (!this.#registrationEnabled) return toUnregisteredPeer(peer, pid);
		const lastSeen = nowIso();
		const labels = normalizePeerLabels(peer.labels);
		this.#db
			.query(
				`INSERT INTO peers (session_id, agent_id, name, cwd, pid, last_seen, explicit_name, session_file, owner_epoch, build_digest, version, fleet_capability_json, label_json)
				 VALUES ($sessionId, $agentId, $name, $cwd, $pid, $lastSeen, $explicitName, $sessionFile, $ownerEpoch, $buildDigest, $version, $fleetCapabilityJson, $labelJson)
				 ON CONFLICT(session_id) DO UPDATE SET
					agent_id = excluded.agent_id,
					name = CASE WHEN peers.explicit_name = 1 THEN peers.name ELSE excluded.name END,
					cwd = excluded.cwd,
					pid = excluded.pid,
					last_seen = excluded.last_seen,
					explicit_name = MAX(peers.explicit_name, excluded.explicit_name),
					session_file = COALESCE(excluded.session_file, peers.session_file),
					owner_epoch = excluded.owner_epoch,
					build_digest = excluded.build_digest,
					version = excluded.version,
					fleet_capability_json = excluded.fleet_capability_json,
					label_json = excluded.label_json`,
			)
			.run({
				$sessionId: peer.sessionId,
				$agentId: peer.agentId ?? null,
				$name: peer.name,
				$cwd: peer.cwd,
				$pid: pid,
				$lastSeen: lastSeen,
				$explicitName: peer.explicitName ? 1 : 0,
				$sessionFile: peer.sessionFile ?? null,
				$ownerEpoch: peer.ownerEpoch ?? null,
				$buildDigest: peer.buildDigest ?? null,
				$version: peer.version ?? null,
				$fleetCapabilityJson: peer.fleetCapability === undefined ? null : JSON.stringify(peer.fleetCapability),
				$labelJson: labels === undefined ? null : JSON.stringify(labels),
			});
		return (
			this.#getPeerBySessionId(peer.sessionId) ?? {
				sessionId: peer.sessionId,
				agentId: peer.agentId,
				name: peer.name,
				cwd: peer.cwd,
				pid,
				lastSeen,
				state: "unknown",
				stateTs: null,
				explicitName: Boolean(peer.explicitName),
				sessionFile: peer.sessionFile,
				ownerEpoch: peer.ownerEpoch,
				buildDigest: peer.buildDigest,
				version: peer.version,
				fleetCapability: peer.fleetCapability,
				labels,
			}
		);
	}
	unregisterPeer(sessionId: string, pid = process.pid): boolean {
		if (!this.#registrationEnabled) return false;
		const result = this.#db
			.query("DELETE FROM peers WHERE session_id = $sessionId AND pid = $pid")
			.run({ $sessionId: sessionId, $pid: pid });
		return result.changes > 0;
	}

	handoffPeer(predecessorSessionId: string, successor: IrcExternalRegistration): IrcExternalPeer {
		if (!this.#registrationEnabled) return toUnregisteredPeer(successor, successor.pid ?? process.pid);
		const registered = this.registerPeer(successor);
		if (predecessorSessionId === registered.sessionId) return registered;
		this.#db
			.query("DELETE FROM peers WHERE session_id = $sessionId AND pid = $pid")
			.run({ $sessionId: predecessorSessionId, $pid: registered.pid });
		return registered;
	}
	/**
	 * Merge label fields without creating a peer row. Null values remove their
	 * keys; omitted fields remain untouched.
	 */
	mergePeerLabels(sessionId: string, patch: IrcExternalPeerLabelPatch): boolean {
		const row = this.#db
			.query<{ label_json: string | null }, { $sessionId: string }>(
				"SELECT label_json FROM peers WHERE session_id = $sessionId",
			)
			.get({ $sessionId: sessionId });
		if (!row) return false;

		const labels = parseLabelObject(row.label_json);
		for (const key of PEER_LABEL_KEYS) {
			if (!(key in patch)) continue;
			const value = patch[key];
			if (value === null) {
				delete labels[key];
			} else if (value !== undefined) {
				if (key === "summary") labels[key] = (value as string).slice(0, MAX_SUMMARY_LENGTH);
				else if (key === "claims") labels[key] = normalizeClaims(value as readonly string[]);
				else labels[key] = value;
			}
		}
		const labelJson = Object.keys(labels).length > 0 ? JSON.stringify(labels) : null;
		const result = this.#db
			.query("UPDATE peers SET label_json = $labelJson WHERE session_id = $sessionId")
			.run({ $sessionId: sessionId, $labelJson: labelJson });
		return result.changes > 0;
	}

	heartbeat(sessionId: string, labels?: IrcExternalPeerLabels): void {
		if (!this.#registrationEnabled) return;
		// Session heartbeats provide the complete self-owned label set (including
		// empty values for cleared fields); merging preserves observer-owned fields
		// such as summary when they are absent from the heartbeat payload.
		if (labels !== undefined) this.mergePeerLabels(sessionId, labels);
		this.#db.query("UPDATE peers SET last_seen = $lastSeen WHERE session_id = $sessionId").run({
			$sessionId: sessionId,
			$lastSeen: nowIso(),
		});
	}

	/** Rename a peer through the shared metadata path. Explicit operator names are immutable. */
	updatePeerName(sessionId: string, name: string): boolean {
		const normalized = name.trim();
		if (!normalized) return false;
		const peer = this.#getPeerBySessionId(sessionId);
		if (!peer || peer.explicitName || peer.name === normalized) return false;
		const originalName = peer.name;
		const result = this.#db
			.query("UPDATE peers SET name = $name WHERE session_id = $sessionId AND explicit_name = 0 AND name <> $name")
			.run({ $sessionId: sessionId, $name: normalized });
		if (result.changes === 0) return false;
		if (peer.labels?.spawnName === undefined) this.mergePeerLabels(sessionId, { spawnName: originalName });
		return true;
	}

	updatePeerState(sessionId: string, state: Exclude<IrcExternalPeerState, "unknown">): void {
		if (!this.#registrationEnabled) return;
		const ts = nowIso();
		this.#db
			.query(
				`INSERT INTO peers (session_id, name, cwd, pid, last_seen, state, state_ts, explicit_name)
				 VALUES ($sessionId, $sessionId, '', $pid, $ts, $state, $ts, 0)
				 ON CONFLICT(session_id) DO UPDATE SET
					state = excluded.state,
					state_ts = excluded.state_ts,
					last_seen = excluded.last_seen`,
			)
			.run({
				$sessionId: sessionId,
				$pid: process.pid,
				$state: state,
				$ts: ts,
			});
	}

	listPeers(options: { excludeSessionId?: string; staleMs?: number; includeStale?: boolean } = {}): IrcExternalPeer[] {
		const nowMs = Date.now();
		const staleMs = options.staleMs ?? IRC_EXTERNAL_STALE_MS;
		return this.#db
			.query<PeerRow, []>(
				`SELECT session_id, ${this.#agentIdSelect}, name, cwd, pid, last_seen, state, state_ts, explicit_name, session_file, owner_epoch, build_digest, version, ${this.#fleetCapabilitySelect}, ${this.#labelSelect} FROM peers ORDER BY last_seen DESC`,
			)
			.all()
			.filter(
				row =>
					row.session_id !== options.excludeSessionId &&
					(options.includeStale || isIrcExternalPeerFresh(row.last_seen, nowMs, staleMs)),
			)
			.map(toPeer);
	}

	prunePeers(options: {
		readonly retentionMs: number;
		readonly nowMs?: number;
		readonly apply?: boolean;
		readonly isProcessAlive?: (pid: number) => boolean;
	}): IrcPeerPruneResult {
		if (!Number.isSafeInteger(options.retentionMs) || options.retentionMs < 1)
			throw new Error("Peer prune retention must be a positive integer");
		const nowMs = options.nowMs ?? Date.now();
		const ownerAlive = options.isProcessAlive ?? isIrcExternalPeerProcessAlive;
		const candidates = this.listPeers({ includeStale: true })
			.filter(peer => nowMs - parseTime(peer.lastSeen) > options.retentionMs)
			.filter(peer => !ownerAlive(peer.pid))
			.filter(hasTestOrTempProvenance)
			.map(peer => ({ peer, reason: "stale-dead-test-or-temp" as const }));
		if (!options.apply) return { candidates, deleted: 0 };
		let deleted = 0;
		for (const candidate of candidates) {
			if (ownerAlive(candidate.peer.pid)) continue;
			const result = this.#db
				.query(
					"DELETE FROM peers WHERE session_id = $sessionId AND pid = $pid AND last_seen = $lastSeen",
				)
				.run({
					$sessionId: candidate.peer.sessionId,
					$pid: candidate.peer.pid,
					$lastSeen: candidate.peer.lastSeen,
				});
			deleted += result.changes;
		}
		return { candidates, deleted };
	}

	findPeerByName(name: string, options: { excludeSessionId?: string } = {}): IrcExternalPeer | undefined {
		const rows = this.#db
			.query<PeerRow, { $name: string }>(
				`SELECT session_id, ${this.#agentIdSelect}, name, cwd, pid, last_seen, state, state_ts, explicit_name, session_file, owner_epoch, build_digest, version, ${this.#fleetCapabilitySelect}, ${this.#labelSelect} FROM peers WHERE name = $name OR ${this.#agentIdWhere} ORDER BY last_seen DESC`,
			)
			.all({ $name: name });
		const row = rows.find(
			candidate => candidate.session_id !== options.excludeSessionId && isIrcExternalPeerFresh(candidate.last_seen),
		);
		return row ? toPeer(row) : undefined;
	}

	sendMessage(args: { fromPeer: string; toPeer: string; body: string; origin?: IrcExternalMessageOrigin }): number {
		const result = this.#db
			.query(
				"INSERT INTO messages (ts, from_peer, to_peer, body, origin) VALUES ($ts, $fromPeer, $toPeer, $body, $origin)",
			)
			.run({
				$ts: nowIso(),
				$fromPeer: args.fromPeer,
				$toPeer: args.toPeer,
				$body: args.body,
				$origin: args.origin ?? "agent",
			});
		return Number(result.lastInsertRowid);
	}

	pollMessages(toPeer: string): IrcExternalMessage[] {
		return this.#db
			.query<MessageRow, { $toPeer: string }>(
				"SELECT id, ts, from_peer, to_peer, body, origin FROM messages WHERE to_peer = $toPeer AND delivered = 0 ORDER BY id",
			)
			.all({ $toPeer: toPeer })
			.map(toMessage);
	}

	recentDeliveries(options: { limit?: number; peerId?: string } = {}): IrcDeliveryRecord[] {
		const limit = Math.max(0, Math.min(options.limit ?? 50, 200));
		if (limit === 0) return [];
		const rows = options.peerId
			? this.#db
					.query<MessageRow, { $peerId: string; $limit: number }>(
						"SELECT id, ts, from_peer, to_peer, body, origin, delivered FROM messages WHERE from_peer = $peerId OR to_peer = $peerId ORDER BY id DESC LIMIT $limit",
					)
					.all({ $peerId: options.peerId, $limit: limit })
			: this.#db
					.query<MessageRow, { $limit: number }>(
						"SELECT id, ts, from_peer, to_peer, body, origin, delivered FROM messages ORDER BY id DESC LIMIT $limit",
					)
					.all({ $limit: limit });
		return rows.map(row => ({
			id: `external:${row.id}`,
			senderId: row.from_peer,
			recipientId: row.to_peer,
			origin: row.origin === "user" || row.origin === "system" ? row.origin : "agent",
			preview: "[message body hidden]",
			state: row.delivered === 1 ? "delivered" : "queued",
			queuedAt: parseTime(row.ts),
			...(row.delivered === 1 ? { delivery: "injected" as const } : {}),
		}));
	}

	markDelivered(id: number): void {
		this.#db.query("UPDATE messages SET delivered = 1 WHERE id = $id").run({ $id: id });
	}

	drainMessages(toPeer: string, options: { peek?: boolean } = {}): IrcExternalMessage[] {
		const messages = this.pollMessages(toPeer);
		if (!options.peek) {
			for (const message of messages) this.markDelivered(message.id);
		}
		return messages;
	}

	unreadCount(toPeer: string): number {
		const row = this.#db
			.query<{ count: number }, { $toPeer: string }>(
				"SELECT COUNT(*) AS count FROM messages WHERE to_peer = $toPeer AND delivered = 0",
			)
			.get({ $toPeer: toPeer });
		return row?.count ?? 0;
	}
}
