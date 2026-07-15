import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-utils";
import { Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { collectFleetStatus, type FleetStatusRow, pruneFleetPeers } from "../cli/fleet-cli";
import { type FleetReleaseRegistry, readRegistry } from "../cli/fleet-target-resolution";
import { resolveVerifiedReleaseExecutable } from "../cli/restart-session";
import {
	type ReleaseRegistryValidationOptions,
	type ResolvedReleaseValidationPaths,
	resolveReleaseValidationPaths,
	validateFleetUnpinBlessed,
} from "../session/release-registry-validation";
import { SessionControlBus } from "../session/session-control";
import { loadEntriesFromFile } from "../session/session-loader";

const DEFAULT_PEER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RECEIPT_STALE_MS = 10 * 60 * 1000;
const DEFAULT_LOCK_STALE_MS = 10 * 60 * 1000;
const MAX_JOURNALS = 256;

export type DoctorSeverity = "error" | "warning" | "info";
export type DoctorFindingKind =
	| "dead-stale-peer"
	| "orphaned-test-temp-row"
	| "legacy-binary-session"
	| "journal-tail"
	| "promote-lock"
	| "release-registry"
	| "session-control-receipt";

export interface DoctorFinding {
	readonly kind: DoctorFindingKind;
	readonly severity: DoctorSeverity;
	readonly evidence: Readonly<Record<string, string | number | boolean | null>>;
	readonly fixCommand: string;
	readonly safeToApply: boolean;
	readonly applied: boolean;
}

export interface DoctorReport {
	readonly schemaVersion: 1;
	readonly mode: "read-only" | "apply";
	readonly generatedAt: string;
	readonly bounded: {
		readonly maxJournals: number;
		readonly scannedJournals: number;
		readonly truncated: boolean;
	};
	readonly findings: readonly DoctorFinding[];
	readonly summary: {
		readonly total: number;
		readonly errors: number;
		readonly warnings: number;
		readonly info: number;
		readonly safeFindings: number;
		readonly applied: number;
	};
	readonly actions: {
		readonly pruneCandidates: number;
		readonly peersPruned: number;
		readonly stalePromoteLockCleared: boolean;
	};
}

export interface DoctorOptions {
	readonly apply?: boolean;
	readonly nowMs?: number;
	readonly ircDbPath?: string;
	readonly controlDbPath?: string;
	readonly sessionsRoot?: string;
	readonly promoteLockPath?: string;
	readonly peerRetentionMs?: number;
	readonly receiptStaleMs?: number;
	readonly lockStaleMs?: number;
	readonly release?: ReleaseRegistryValidationOptions;
	readonly isProcessAlive?: (pid: number) => boolean;
}

interface JournalScan {
	readonly paths: readonly string[];
	readonly truncated: boolean;
}

interface LockSnapshot {
	readonly path: string;
	readonly pid?: number;
	readonly token?: string;
	readonly timestamp?: number;
	readonly stale: boolean;
	readonly holderDead: boolean;
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function parseTimestamp(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function finding(
	kind: DoctorFindingKind,
	severity: DoctorSeverity,
	evidence: Readonly<Record<string, string | number | boolean | null>>,
	fixCommand: string,
	safeToApply: boolean,
	applied = false,
): DoctorFinding {
	return { kind, severity, evidence, fixCommand, safeToApply, applied };
}

async function scanJournals(root: string): Promise<JournalScan> {
	const paths: string[] = [];
	try {
		for await (const name of new Bun.Glob("*/*.jsonl").scan(root)) {
			paths.push(path.join(root, name));
			if (paths.length > MAX_JOURNALS) break;
		}
	} catch {
		return { paths: [], truncated: false };
	}
	paths.sort();
	return { paths: paths.slice(0, MAX_JOURNALS), truncated: paths.length > MAX_JOURNALS };
}

async function journalFindings(root: string): Promise<{ findings: DoctorFinding[]; scan: JournalScan }> {
	const scan = await scanJournals(root);
	const findings: DoctorFinding[] = [];
	for (const journalPath of scan.paths) {
		let content: string;
		try {
			content = await Bun.file(journalPath).text();
		} catch (error) {
			findings.push(
				finding(
					"journal-tail",
					"error",
					{ path: journalPath, reason: error instanceof Error ? error.message : String(error) },
					"omp session list",
					false,
				),
			);
			continue;
		}

		try {
			const entries = await loadEntriesFromFile(journalPath);
			if (!entries.some(entry => entry.type === "session")) {
				findings.push(
					finding(
						"journal-tail",
						"error",
						{ path: journalPath, reason: "session journal has no readable session header" },
						"omp session list",
						false,
					),
				);
				continue;
			}
		} catch (error) {
			findings.push(
				finding(
					"journal-tail",
					"error",
					{ path: journalPath, reason: error instanceof Error ? error.message : String(error) },
					"omp session list",
					false,
				),
			);
			continue;
		}

		if (content.length === 0 || content.endsWith("\n")) continue;
		const tail = content.slice(content.lastIndexOf("\n") + 1).trim();
		if (!tail) continue;
		try {
			JSON.parse(tail);
		} catch {
			findings.push(
				finding(
					"journal-tail",
					"error",
					{ path: journalPath, reason: "unterminated or unreadable final JSONL record" },
					"omp session list",
					false,
				),
			);
		}
	}
	return { findings, scan };
}

async function readLockSnapshot(
	lockPath: string,
	nowMs: number,
	staleMs: number,
	alive: (pid: number) => boolean,
): Promise<LockSnapshot | undefined> {
	let stat: { readonly isDirectory: () => boolean; readonly mtimeMs: number };
	try {
		stat = await fs.stat(lockPath);
	} catch {
		return undefined;
	}
	let raw: string | undefined;
	try {
		raw = await fs.readFile(stat.isDirectory() ? path.join(lockPath, "info") : lockPath, "utf8");
	} catch {
		raw = undefined;
	}
	let value: Record<string, unknown> = {};
	if (raw !== undefined) {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
				value = parsed as Record<string, unknown>;
		} catch {
			// The lock is still diagnosable by mtime, but cannot be safely reclaimed without a PID.
		}
	}
	const pid = typeof value.pid === "number" && Number.isSafeInteger(value.pid) ? value.pid : undefined;
	const timestamp =
		typeof value.timestamp === "number" && Number.isFinite(value.timestamp) ? value.timestamp : stat.mtimeMs;
	const holderDead = pid !== undefined && !alive(pid);
	return {
		path: lockPath,
		...(pid === undefined ? {} : { pid }),
		...(typeof value.token === "string" ? { token: value.token } : {}),
		timestamp,
		stale: holderDead || nowMs - timestamp > staleMs,
		holderDead,
	};
}

async function clearStaleLock(snapshot: LockSnapshot, alive: (pid: number) => boolean): Promise<boolean> {
	if (!snapshot.holderDead || snapshot.pid === undefined) return false;
	const current = await readLockSnapshot(snapshot.path, Date.now(), 0, alive);
	if (!current || current.pid !== snapshot.pid || current.token !== snapshot.token || alive(current.pid)) return false;
	try {
		await fs.rm(snapshot.path, { recursive: true, force: true });
		return true;
	} catch {
		return false;
	}
}

function releaseFinding(
	registry: FleetReleaseRegistry,
	channel: "stable" | "previous" | "candidate",
	digest: string,
	reason: string,
): DoctorFinding {
	return finding(
		"release-registry",
		"error",
		{ channel, digest, reason, stable: registry.stable, previous: registry.previous, candidate: registry.candidate },
		"omp update",
		false,
	);
}

async function releaseFindings(options: DoctorOptions): Promise<DoctorFinding[]> {
	let paths: ResolvedReleaseValidationPaths;
	try {
		paths = resolveReleaseValidationPaths(options.release);
	} catch (error) {
		return [finding("release-registry", "error", { reason: String(error) }, "omp update", false)];
	}
	let registry: FleetReleaseRegistry;
	try {
		registry = await readRegistry({ registryPath: paths.registryPath });
	} catch (error) {
		return [
			finding("release-registry", "error", { path: paths.registryPath, reason: String(error) }, "omp update", false),
		];
	}
	const findings: DoctorFinding[] = [];
	try {
		await validateFleetUnpinBlessed(options.release);
	} catch (error) {
		findings.push(releaseFinding(registry, "stable", registry.stable ?? "null", String(error)));
	}
	for (const channel of ["previous", "candidate"] as const) {
		const digest = registry[channel];
		if (digest === null) continue;
		try {
			await resolveVerifiedReleaseExecutable(paths.releasesDir, digest);
		} catch (error) {
			findings.push(releaseFinding(registry, channel, digest, String(error)));
		}
	}
	return findings;
}

async function receiptFindings(
	controlDbPath: string | undefined,
	nowMs: number,
	staleMs: number,
): Promise<DoctorFinding[]> {
	if (!controlDbPath) return [];
	try {
		await fs.stat(controlDbPath);
	} catch {
		return [];
	}
	let bus: SessionControlBus | undefined;
	try {
		bus = new SessionControlBus(controlDbPath);
		const findings: DoctorFinding[] = [];
		for (const receipt of bus.listReceipts()) {
			if (receipt.state === "applied" || receipt.state === "failed") continue;
			const requestedAt = parseTimestamp(receipt.requestedAt);
			if (requestedAt === undefined || nowMs - requestedAt <= staleMs) continue;
			findings.push(
				finding(
					"session-control-receipt",
					"warning",
					{
						commandId: receipt.commandId,
						sessionId: receipt.sessionId,
						state: receipt.state,
						requestedAt: receipt.requestedAt,
					},
					"omp fleet status --all",
					false,
				),
			);
		}
		return findings;
	} catch (error) {
		return [
			finding(
				"session-control-receipt",
				"error",
				{ path: controlDbPath, reason: String(error) },
				"omp fleet status --all",
				false,
			),
		];
	} finally {
		bus?.close();
	}
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
	const nowMs = options.nowMs ?? Date.now();
	const alive = options.isProcessAlive ?? isProcessAlive;
	const prune = pruneFleetPeers({
		apply: options.apply,
		ircDbPath: options.ircDbPath,
		nowMs,
		retentionMs: options.peerRetentionMs ?? DEFAULT_PEER_RETENTION_MS,
		isProcessAlive: alive,
	});
	const findings: DoctorFinding[] = [];
	for (const [candidateIndex, candidate] of prune.candidates.entries()) {
		const evidence = {
			sessionId: candidate.peer.sessionId,
			name: candidate.peer.name,
			pid: candidate.peer.pid,
			cwd: candidate.peer.cwd,
			lastSeen: candidate.peer.lastSeen,
			reason: candidate.reason,
		};
		const candidateApplied = options.apply === true && candidateIndex < prune.deleted;
		findings.push(finding("dead-stale-peer", "warning", evidence, "omp fleet prune --apply", true, candidateApplied));
		findings.push(
			finding("orphaned-test-temp-row", "warning", evidence, "omp fleet prune --apply", true, candidateApplied),
		);
	}

	const statusRows = await collectFleetStatus({
		ircDbPath: options.ircDbPath,
		controlDbPath: options.controlDbPath,
		all: true,
		nowMs,
	});
	for (const row of statusRows) {
		if (row.compatibility === "compatible") continue;
		findings.push(legacyFinding(row));
	}

	const sessionsRoot = options.sessionsRoot ?? path.join(getAgentDir(), "sessions");
	const journals = await journalFindings(sessionsRoot);
	findings.push(...journals.findings);
	findings.push(
		...(await receiptFindings(options.controlDbPath, nowMs, options.receiptStaleMs ?? DEFAULT_RECEIPT_STALE_MS)),
	);
	findings.push(...(await releaseFindings(options)));

	const registryPaths = (() => {
		try {
			return resolveReleaseValidationPaths(options.release);
		} catch {
			return undefined;
		}
	})();
	const lockPath =
		options.promoteLockPath ??
		process.env.OMP_PROMOTE_LOCK_PATH ??
		(registryPaths
			? path.join(path.dirname(registryPaths.registryPath), "promote.lock")
			: path.join(getAgentDir(), "promote.lock"));
	const lock = await readLockSnapshot(lockPath, nowMs, options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS, alive);
	let stalePromoteLockCleared = false;
	if (lock?.stale) {
		if (options.apply && lock.holderDead) stalePromoteLockCleared = await clearStaleLock(lock, alive);
		findings.push(
			finding(
				"promote-lock",
				lock.holderDead ? "warning" : "info",
				{ path: lock.path, pid: lock.pid ?? null, timestamp: lock.timestamp ?? null, holderDead: lock.holderDead },
				"omp doctor --apply",
				lock.holderDead,
				stalePromoteLockCleared,
			),
		);
	}

	const applied = findings.filter(item => item.applied).length;
	const errors = findings.filter(item => item.severity === "error").length;
	const warnings = findings.filter(item => item.severity === "warning").length;
	const info = findings.filter(item => item.severity === "info").length;
	return {
		schemaVersion: 1,
		mode: options.apply ? "apply" : "read-only",
		generatedAt: new Date(nowMs).toISOString(),
		bounded: {
			maxJournals: MAX_JOURNALS,
			scannedJournals: journals.scan.paths.length,
			truncated: journals.scan.truncated,
		},
		findings,
		summary: {
			total: findings.length,
			errors,
			warnings,
			info,
			safeFindings: findings.filter(item => item.safeToApply).length,
			applied,
		},
		actions: {
			pruneCandidates: prune.candidates.length,
			peersPruned: prune.deleted,
			stalePromoteLockCleared,
		},
	};
}

function legacyFinding(row: FleetStatusRow): DoctorFinding {
	return finding(
		"legacy-binary-session",
		"warning",
		{
			sessionId: row.sessionId,
			name: row.name,
			buildDigest: row.buildDigest,
			productVersion: row.productVersion,
			compatibility: row.compatibility,
		},
		"omp fleet rollout --blessed",
		false,
	);
}

export function formatDoctorReport(report: DoctorReport): string {
	return `${JSON.stringify(report, null, 2)}\n`;
}

export default class Doctor extends Command {
	static description = "Diagnose local session and fleet damage";

	static args = {};

	static flags = {
		apply: Flags.boolean({ description: "Apply only safe peer-prune and dead-lock repairs", default: false }),
	};

	static examples = ["omp doctor", "omp doctor --apply"];

	async run(): Promise<void> {
		const { flags } = await this.parse(Doctor);
		if (flags.apply) {
			const report = await runDoctor({ apply: true });
			process.stdout.write(formatDoctorReport(report));
			return;
		}
		const report = await runDoctor();
		process.stdout.write(formatDoctorReport(report));
	}
}
