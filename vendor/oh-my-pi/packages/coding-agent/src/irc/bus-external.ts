import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";


export type IrcExternalPeerState = "unknown" | "working" | "waiting_input" | "idle";
export type IrcExternalPeerDisplayState = IrcExternalPeerState | "disconnected";

export interface IrcExternalPeer {
	sessionId: string;
	name: string;
	cwd: string;
	pid: number;
	lastSeen: string;
	state: IrcExternalPeerState;
	stateTs: string | null;
}

export interface IrcExternalMessage {
	id: number;
	ts: string;
	fromPeer: string;
	toPeer: string;
	body: string;
}

interface PeerRow {
	session_id: string;
	name: string;
	cwd: string;
	pid: number;
	last_seen: string;
	state: string;
	state_ts: string | null;
}

interface MessageRow {
	id: number;
	ts: string;
	from_peer: string;
	to_peer: string;
	body: string;
}

interface TableInfoRow {
	name: string;
}

export interface IrcExternalRegistration {
	sessionId: string;
	name: string;
	cwd: string;
	pid?: number;
}

export const IRC_EXTERNAL_STALE_MS = 10 * 60 * 1000;

const DEFAULT_DB_PATH = path.join(os.homedir(), ".omp", "agent", "irc-bus.sqlite");

function nowIso(): string {
	return new Date().toISOString();
}

function parseTime(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

export function isIrcExternalPeerFresh(lastSeen: string, nowMs = Date.now(), staleMs = IRC_EXTERNAL_STALE_MS): boolean {
	return nowMs - parseTime(lastSeen) <= staleMs;
}

function normalizePeerState(value: string): IrcExternalPeerState {
	return value === "working" || value === "waiting_input" || value === "idle" ? value : "unknown";
}

export function getIrcExternalPeerDisplayState(
	peer: Pick<IrcExternalPeer, "lastSeen" | "state">,
	nowMs = Date.now(),
	staleMs = IRC_EXTERNAL_STALE_MS,
): IrcExternalPeerDisplayState {
	return isIrcExternalPeerFresh(peer.lastSeen, nowMs, staleMs) ? peer.state : "disconnected";
}

function sanitizePeerComponent(value: string): string {
	const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
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
		name: row.name,
		cwd: row.cwd,
		pid: row.pid,
		lastSeen: row.last_seen,
		state: normalizePeerState(row.state),
		stateTs: row.state_ts,
	};
}

function toMessage(row: MessageRow): IrcExternalMessage {
	return {
		id: row.id,
		ts: row.ts,
		fromPeer: row.from_peer,
		toPeer: row.to_peer,
		body: row.body,
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

	#ensurePeerStateColumns(): void {
		const columns = new Set(this.#db.query<TableInfoRow, []>("PRAGMA table_info(peers)").all().map(column => column.name));
		if (!columns.has("state")) {
			this.#db.run("ALTER TABLE peers ADD COLUMN state TEXT NOT NULL DEFAULT 'unknown'");
		}
		if (!columns.has("state_ts")) {
			this.#db.run("ALTER TABLE peers ADD COLUMN state_ts TEXT");
		}
	}

	#getPeerBySessionId(sessionId: string): IrcExternalPeer | undefined {
		const row = this.#db
			.query<PeerRow, { $sessionId: string }>(
				"SELECT session_id, name, cwd, pid, last_seen, state, state_ts FROM peers WHERE session_id = $sessionId",
			)
			.get({ $sessionId: sessionId });
		return row ? toPeer(row) : undefined;
	}

	constructor(readonly dbPath: string = DEFAULT_DB_PATH) {
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		this.#db = new Database(dbPath);
		this.#db.run("PRAGMA busy_timeout = 3000");
		this.#db.run("PRAGMA journal_mode = WAL");
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS peers (
				session_id TEXT PRIMARY KEY,
				name TEXT,
				cwd TEXT,
				pid INTEGER,
				last_seen TEXT,
				state TEXT NOT NULL DEFAULT 'unknown',
				state_ts TEXT
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
		this.#db.run("CREATE INDEX IF NOT EXISTS idx_irc_messages_to_delivered ON messages(to_peer, delivered, id)");
		this.#db.run("CREATE INDEX IF NOT EXISTS idx_irc_peers_name ON peers(name)");
	}

	close(): void {
		this.#db.close();
	}

	registerPeer(peer: IrcExternalRegistration): IrcExternalPeer {
		const pid = peer.pid ?? process.pid;
		const lastSeen = nowIso();
		this.#db
			.query(
				`INSERT INTO peers (session_id, name, cwd, pid, last_seen)
				 VALUES ($sessionId, $name, $cwd, $pid, $lastSeen)
				 ON CONFLICT(session_id) DO UPDATE SET
					name = excluded.name,
					cwd = excluded.cwd,
					pid = excluded.pid,
					last_seen = excluded.last_seen`,
			)
			.run({
				$sessionId: peer.sessionId,
				$name: peer.name,
				$cwd: peer.cwd,
				$pid: pid,
				$lastSeen: lastSeen,
			});
		return this.#getPeerBySessionId(peer.sessionId) ?? { sessionId: peer.sessionId, name: peer.name, cwd: peer.cwd, pid, lastSeen, state: "unknown", stateTs: null };
	}

	heartbeat(sessionId: string): void {
		this.#db.query("UPDATE peers SET last_seen = $lastSeen WHERE session_id = $sessionId").run({
			$sessionId: sessionId,
			$lastSeen: nowIso(),
		});
	}

	updatePeerState(sessionId: string, state: Exclude<IrcExternalPeerState, "unknown">): void {
		const ts = nowIso();
		this.#db
			.query(
				`INSERT INTO peers (session_id, name, cwd, pid, last_seen, state, state_ts)
				 VALUES ($sessionId, $sessionId, '', $pid, $ts, $state, $ts)
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
			.query<PeerRow, []>("SELECT session_id, name, cwd, pid, last_seen, state, state_ts FROM peers ORDER BY last_seen DESC")
			.all()
			.filter(
				row =>
					row.session_id !== options.excludeSessionId &&
					(options.includeStale || isIrcExternalPeerFresh(row.last_seen, nowMs, staleMs)),
			)
			.map(toPeer);
	}

	findPeerByName(name: string, options: { excludeSessionId?: string } = {}): IrcExternalPeer | undefined {
		const rows = this.#db
			.query<PeerRow, { $name: string }>(
				"SELECT session_id, name, cwd, pid, last_seen, state, state_ts FROM peers WHERE name = $name ORDER BY last_seen DESC",
			)
			.all({ $name: name });
		const row = rows.find(candidate => candidate.session_id !== options.excludeSessionId && isIrcExternalPeerFresh(candidate.last_seen));
		return row ? toPeer(row) : undefined;
	}

	sendMessage(args: { fromPeer: string; toPeer: string; body: string }): number {
		const result = this.#db
			.query("INSERT INTO messages (ts, from_peer, to_peer, body) VALUES ($ts, $fromPeer, $toPeer, $body)")
			.run({
				$ts: nowIso(),
				$fromPeer: args.fromPeer,
				$toPeer: args.toPeer,
				$body: args.body,
			});
		return Number(result.lastInsertRowid);
	}

	pollMessages(toPeer: string): IrcExternalMessage[] {
		return this.#db
			.query<MessageRow, { $toPeer: string }>(
				"SELECT id, ts, from_peer, to_peer, body FROM messages WHERE to_peer = $toPeer AND delivered = 0 ORDER BY id",
			)
			.all({ $toPeer: toPeer })
			.map(toMessage);
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
