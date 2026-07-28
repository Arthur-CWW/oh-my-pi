import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { SESSION_CONTROL_DB_PATH } from "../session/session-control";
import type { SubagentFailureClass } from "./subagent-failure";

export type FleetIncidentStatus = "open" | "closed";

export interface FleetFailureEvent {
	readonly evidenceKey: string;
	readonly agent: string;
	readonly job: string;
	readonly failureClass: SubagentFailureClass;
	readonly occurredAt?: number;
	readonly journalUri?: string;
	readonly message?: string;
}

export interface FleetIncidentEvidence {
	readonly evidenceKey: string;
	readonly incidentId: string;
	readonly agent: string;
	readonly job: string;
	readonly failureClass: "network";
	readonly occurredAt: number;
	readonly journalUri?: string;
	readonly message?: string;
}

export interface FleetIncident {
	readonly id: string;
	readonly failureClass: "network";
	readonly status: FleetIncidentStatus;
	readonly openedAt: number;
	readonly closedAt?: number;
	readonly noticeClaimedAt?: number;
	readonly evidence: readonly FleetIncidentEvidence[];
}

export interface FleetIncidentStoreOptions {
	readonly windowMs?: number;
	readonly threshold?: number;
	readonly now?: () => number;
	readonly createId?: () => string;
	readonly readonly?: boolean;
}

interface IncidentRow {
	incident_id: string;
	failure_class: "network";
	status: FleetIncidentStatus;
	opened_at: number;
	closed_at: number | null;
	notice_claimed_at: number | null;
}

interface EvidenceRow {
	evidence_key: string;
	incident_id: string;
	job: string;
	agent: string;
	failure_class: "network";
	occurred_at: number;
	journal_uri: string | null;
	message: string | null;
}

interface TableColumnRow {
	name: string;
}

const DEFAULT_WINDOW_MS = 120_000;
const DEFAULT_THRESHOLD = 3;

function requiredText(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${label} is required`);
	return trimmed;
}

function integerTimestamp(value: number, label: string): number {
	if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
	return Math.trunc(value);
}

/** Durable SQLite projection of network-failure evidence and fleet incident state. */
export class FleetIncidentStore {
	readonly #db: Database;
	readonly #windowMs: number;
	readonly #threshold: number;
	readonly #now: () => number;
	readonly #createId: () => string;

	constructor(readonly dbPath: string = SESSION_CONTROL_DB_PATH, options: FleetIncidentStoreOptions = {}) {
		this.#windowMs = Math.max(1, Math.trunc(options.windowMs ?? DEFAULT_WINDOW_MS));
		this.#threshold = Math.max(1, Math.trunc(options.threshold ?? DEFAULT_THRESHOLD));
		this.#now = options.now ?? Date.now;
		this.#createId = options.createId ?? randomUUID;
		if (!options.readonly) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		this.#db = options.readonly ? new Database(dbPath, { readonly: true }) : new Database(dbPath);
		this.#db.run("PRAGMA busy_timeout = 3000");
		if (options.readonly) return;
		this.#db.run("PRAGMA journal_mode = WAL");
		this.#db.run("PRAGMA foreign_keys = ON");
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS fleet_incidents (
				incident_id TEXT PRIMARY KEY,
				failure_class TEXT NOT NULL CHECK(failure_class = 'network'),
				status TEXT NOT NULL CHECK(status IN ('open','closed')),
				opened_at INTEGER NOT NULL,
				closed_at INTEGER,
				notice_claimed_at INTEGER
			)
		`);
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS fleet_incident_evidence (
				evidence_key TEXT PRIMARY KEY,
				incident_id TEXT REFERENCES fleet_incidents(incident_id),
				agent TEXT NOT NULL,
				job TEXT NOT NULL,
				failure_class TEXT NOT NULL CHECK(failure_class = 'network'),
				occurred_at INTEGER NOT NULL,
				journal_uri TEXT,
				message TEXT
			)
		`);
		const evidenceColumns = this.#db.query<TableColumnRow, []>("PRAGMA table_info(fleet_incident_evidence)").all();
		if (!evidenceColumns.some(column => column.name === "job")) {
			this.#db.run("ALTER TABLE fleet_incident_evidence ADD COLUMN job TEXT NOT NULL DEFAULT ''");
		}
		this.#db.run(`
			CREATE TABLE IF NOT EXISTS fleet_incident_salvage_reservations (
				incident_id TEXT NOT NULL REFERENCES fleet_incidents(incident_id) ON DELETE CASCADE,
				agent TEXT NOT NULL,
				reserved_at INTEGER NOT NULL,
				PRIMARY KEY (incident_id, agent)
			)
		`);
		this.#db.run(
			"CREATE UNIQUE INDEX IF NOT EXISTS fleet_incidents_one_open_class ON fleet_incidents(failure_class) WHERE status='open'",
		);
		this.#db.run(
			"CREATE INDEX IF NOT EXISTS fleet_incident_evidence_detection ON fleet_incident_evidence(failure_class, incident_id, occurred_at, agent)",
		);
		this.#db.run(
			"CREATE INDEX IF NOT EXISTS fleet_incident_evidence_incident ON fleet_incident_evidence(incident_id, occurred_at, evidence_key)",
		);
	}

	close(): void {
		this.#db.close();
	}

	/** Records a classified failure synchronously. Non-network classes never enter the projection. */
	recordFailure(event: FleetFailureEvent): FleetIncident | undefined {
		if (event.failureClass !== "network") return undefined;
		const evidenceKey = requiredText(event.evidenceKey, "Evidence key");
		const agent = requiredText(event.agent, "Agent");
		const job = requiredText(event.job, "Job");
		const occurredAt = integerTimestamp(event.occurredAt ?? this.#now(), "Occurrence timestamp");
		const cutoff = occurredAt - this.#windowMs;

		const detectIncident = this.#db.transaction((): string | undefined => {
			const open = this.#db
				.query<{ incident_id: string }, []>(
					"SELECT incident_id FROM fleet_incidents WHERE failure_class='network' AND status='open' LIMIT 1",
				)
				.get();
			this.#db
				.query(
					`INSERT OR IGNORE INTO fleet_incident_evidence
					 (evidence_key, incident_id, agent, job, failure_class, occurred_at, journal_uri, message)
					 VALUES ($evidenceKey, $incidentId, $agent, $job, 'network', $occurredAt, $journalUri, $message)`,
				)
				.run({
					$evidenceKey: evidenceKey,
					$incidentId: open?.incident_id ?? null,
					$agent: agent,
					$job: job,
					$occurredAt: occurredAt,
					$journalUri: event.journalUri ?? null,
					$message: event.message ?? null,
				});
			if (open) return open.incident_id;

			this.#db
				.query(
					`DELETE FROM fleet_incident_evidence
					 WHERE incident_id IS NULL AND occurred_at < $cutoff`,
				)
				.run({ $cutoff: cutoff });
			const distinct = this.#db
				.query<{ count: number }, { $cutoff: number; $occurredAt: number }>(
					`SELECT COUNT(DISTINCT agent) AS count FROM fleet_incident_evidence
					 WHERE failure_class='network' AND incident_id IS NULL
					 AND occurred_at BETWEEN $cutoff AND $occurredAt`,
				)
				.get({ $cutoff: cutoff, $occurredAt: occurredAt });
			if ((distinct?.count ?? 0) < this.#threshold) return undefined;

			const id = this.#createId();
			this.#db
				.query(
					`INSERT INTO fleet_incidents (incident_id, failure_class, status, opened_at)
					 VALUES ($incidentId, 'network', 'open', $openedAt)`,
				)
				.run({ $incidentId: id, $openedAt: occurredAt });
			this.#db
				.query(
					`UPDATE fleet_incident_evidence SET incident_id=$incidentId
					 WHERE failure_class='network' AND incident_id IS NULL
					 AND occurred_at BETWEEN $cutoff AND $occurredAt`,
				)
				.run({ $incidentId: id, $cutoff: cutoff, $occurredAt: occurredAt });
			return id;
		});
		const incidentId = detectIncident.immediate();
		return incidentId ? this.getIncident(incidentId) : undefined;
	}

	getIncident(incidentId: string): FleetIncident | undefined {
		const row = this.#db
			.query<IncidentRow, { $incidentId: string }>(
				`SELECT incident_id, failure_class, status, opened_at, closed_at, notice_claimed_at
				 FROM fleet_incidents WHERE incident_id=$incidentId`,
			)
			.get({ $incidentId: incidentId });
		return row ? this.#decodeIncident(row) : undefined;
	}

	listIncidents(status?: FleetIncidentStatus): readonly FleetIncident[] {
		const rows = status
			? this.#db
					.query<IncidentRow, { $status: FleetIncidentStatus }>(
						`SELECT incident_id, failure_class, status, opened_at, closed_at, notice_claimed_at
						 FROM fleet_incidents WHERE status=$status ORDER BY opened_at DESC, incident_id DESC`,
					)
					.all({ $status: status })
			: this.#db
					.query<IncidentRow, []>(
						`SELECT incident_id, failure_class, status, opened_at, closed_at, notice_claimed_at
						 FROM fleet_incidents ORDER BY opened_at DESC, incident_id DESC`,
					)
					.all();
		return rows.map(row => this.#decodeIncident(row));
	}

	claimOpenNotice(incidentId: string, claimedAt = this.#now()): boolean {
		const result = this.#db
			.query(
				`UPDATE fleet_incidents SET notice_claimed_at=$claimedAt
				 WHERE incident_id=$incidentId AND status='open' AND notice_claimed_at IS NULL`,
			)
			.run({ $incidentId: incidentId, $claimedAt: integerTimestamp(claimedAt, "Claim timestamp") });
		return result.changes === 1;
	}

	closeOpenIncident(incidentId: string, closedAt = this.#now()): boolean {
		const result = this.#db
			.query(
				`UPDATE fleet_incidents SET status='closed', closed_at=$closedAt
				 WHERE incident_id=$incidentId AND status='open'`,
			)
			.run({ $incidentId: incidentId, $closedAt: integerTimestamp(closedAt, "Close timestamp") });
		return result.changes === 1;
	}

	reserveSalvage(incidentId: string, agent: string, reservedAt = this.#now()): boolean {
		const result = this.#db
			.query(
				`INSERT OR IGNORE INTO fleet_incident_salvage_reservations (incident_id, agent, reserved_at)
				 SELECT $incidentId, $agent, $reservedAt
				 WHERE EXISTS (
					SELECT 1 FROM fleet_incident_evidence WHERE incident_id=$incidentId AND agent=$agent
				 )`,
			)
			.run({
				$incidentId: incidentId,
				$agent: requiredText(agent, "Agent"),
				$reservedAt: integerTimestamp(reservedAt, "Reservation timestamp"),
			});
		return result.changes === 1;
	}

	#decodeIncident(row: IncidentRow): FleetIncident {
		const evidenceRows = this.#db
			.query<EvidenceRow, { $incidentId: string }>(
				`SELECT evidence_key, incident_id, agent, job, failure_class, occurred_at, journal_uri, message
				 FROM fleet_incident_evidence WHERE incident_id=$incidentId
				 ORDER BY occurred_at, evidence_key`,
			)
			.all({ $incidentId: row.incident_id });
		return {
			id: row.incident_id,
			failureClass: row.failure_class,
			status: row.status,
			openedAt: row.opened_at,
			closedAt: row.closed_at ?? undefined,
			noticeClaimedAt: row.notice_claimed_at ?? undefined,
			evidence: evidenceRows.map(evidence => ({
				evidenceKey: evidence.evidence_key,
				incidentId: evidence.incident_id,
				agent: evidence.agent,
				job: evidence.job,
				failureClass: evidence.failure_class,
				occurredAt: evidence.occurred_at,
				journalUri: evidence.journal_uri ?? undefined,
				message: evidence.message ?? undefined,
			})),
		};
	}
}

export interface FleetIncidentCoordinatorHooks {
	readonly notice: (incident: FleetIncident) => void | Promise<void>;
	readonly appendInbox: (incident: FleetIncident) => void | Promise<void>;
	readonly probe: (incident: FleetIncident) => boolean | Promise<boolean>;
	readonly salvage: (incident: FleetIncident, agent: string) => void | Promise<void>;
	readonly shouldSalvage?: (incident: FleetIncident, agent: string) => boolean | Promise<boolean>;
	readonly closed?: (incident: FleetIncident) => void | Promise<void>;
	readonly sleep?: (delayMs: number) => Promise<void>;
	readonly random?: () => number;
	readonly now?: () => number;
	readonly initialBackoffMs?: number;
	readonly maxBackoffMs?: number;
}

/** Drives notice claiming, connectivity recovery, and owner-filtered salvage for observed open incidents. */
export class FleetIncidentCoordinator {
	readonly #background = new Map<string, Promise<void>>();
	readonly #errors: Error[] = [];
	readonly #sleep: (delayMs: number) => Promise<void>;
	readonly #random: () => number;
	readonly #now: () => number;
	readonly #initialBackoffMs: number;
	readonly #maxBackoffMs: number;
	#stopping = false;

	constructor(
		readonly store: FleetIncidentStore,
		readonly hooks: FleetIncidentCoordinatorHooks,
	) {
		this.#sleep = hooks.sleep ?? Bun.sleep;
		this.#random = hooks.random ?? Math.random;
		this.#now = hooks.now ?? Date.now;
		this.#initialBackoffMs = Math.max(1, Math.trunc(hooks.initialBackoffMs ?? 1_000));
		this.#maxBackoffMs = Math.max(this.#initialBackoffMs, Math.trunc(hooks.maxBackoffMs ?? 30_000));
	}

	recordFailure(event: FleetFailureEvent): FleetIncident | undefined {
		const incident = this.store.recordFailure(event);
		if (incident?.status === "open") this.#schedule(incident.id);
		return incident;
	}

	async waitForIdle(): Promise<void> {
		while (this.#background.size > 0) await Promise.all(this.#background.values());
		if (this.#errors.length === 0) return;
		const errors = this.#errors.splice(0);
		throw new AggregateError(errors, "Fleet incident workflow failed");
	}

	async close(): Promise<void> {
		this.#stopping = true;
		await this.waitForIdle();
	}

	#schedule(incidentId: string): void {
		if (this.#stopping || this.#background.has(incidentId)) return;
		const workflow = this.#runOpenWorkflow(incidentId)
			.catch((error: Error) => {
				this.#errors.push(error);
			})
			.finally(() => {
				this.#background.delete(incidentId);
			});
		this.#background.set(incidentId, workflow);
	}

	async #runOpenWorkflow(incidentId: string): Promise<void> {
		let incident = this.store.getIncident(incidentId);
		if (!incident) return;
		if (incident.status === "open" && this.store.claimOpenNotice(incidentId, this.#now())) {
			incident = this.store.getIncident(incidentId);
			if (!incident || incident.status !== "open") return;
			await Promise.all([this.hooks.notice(incident), this.hooks.appendInbox(incident)]);
		}

		let closedHere = false;
		let backoffMs = this.#initialBackoffMs;
		while (!this.#stopping) {
			incident = this.store.getIncident(incidentId);
			if (!incident) return;
			if (incident.status === "closed") break;
			if (await this.hooks.probe(incident)) {
				closedHere = this.store.closeOpenIncident(incidentId, this.#now());
				break;
			}
			const random = Math.min(1, Math.max(0, this.#random()));
			const delayMs = Math.max(1, Math.floor(backoffMs * (0.5 + random * 0.5)));
			await this.#sleep(delayMs);
			backoffMs = Math.min(this.#maxBackoffMs, backoffMs * 2);
		}
		if (this.#stopping) return;
		const closed = this.store.getIncident(incidentId);
		if (!closed || closed.status !== "closed") return;
		if (closedHere) await this.hooks.closed?.(closed);
		const agents = new Set(closed.evidence.map(evidence => evidence.agent));
		for (const agent of agents) {
			if (this.hooks.shouldSalvage && !(await this.hooks.shouldSalvage(closed, agent))) continue;
			if (!this.store.reserveSalvage(incidentId, agent, this.#now())) continue;
			await this.hooks.salvage(closed, agent);
		}
	}
}
