#!/usr/bin/env bun

import { Buffer } from "node:buffer";
import { constants as FS_CONSTANTS } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Schema } from "effect";
import {
	IRC_EXTERNAL_STALE_MS,
	IrcExternalBus,
} from "../vendor/oh-my-pi/packages/coding-agent/src/irc/bus-external";

export const PROCESS_PROFILE_SCHEMA_VERSION = 1 as const;
export const MAX_PROFILE_SAMPLES = 1_200;
export const MAX_PROFILE_DURATION_MS = 5 * 60_000;
export const MIN_PROFILE_INTERVAL_MS = 50;
export const MAX_PROFILE_PROCESSES = 4_096;
export const MAX_PROFILE_COMMAND_LENGTH = 512;
export const MAX_PS_SNAPSHOT_BYTES = 32 * 1024 * 1024;
export const MAX_PROFILE_OUTPUT_BYTES = 16 * 1024 * 1024;
export const MAX_PS_STDERR_BYTES = 64 * 1_024;
export const PROFILE_PEER_FUTURE_SKEW_MS = 5_000;
export const PROFILE_PS_START_TOLERANCE_MS = 2_000;
export const PS_SNAPSHOT_COMMAND = Object.freeze([
	"/bin/ps",
	"-axo",
	"pid=,ppid=,pgid=,rss=,pcpu=,etime=,command=",
] as const);

export interface ProfileLimits {
	readonly maxSamples: number;
	readonly maxProcesses: number;
	readonly maxCommandLength: number;
	readonly maxPsSnapshotBytes: number;
	readonly maxOutputBytes: number;
}

export const DEFAULT_PROFILE_LIMITS: ProfileLimits = Object.freeze({
	maxSamples: MAX_PROFILE_SAMPLES,
	maxProcesses: MAX_PROFILE_PROCESSES,
	maxCommandLength: MAX_PROFILE_COMMAND_LENGTH,
	maxPsSnapshotBytes: MAX_PS_SNAPSHOT_BYTES,
	maxOutputBytes: MAX_PROFILE_OUTPUT_BYTES,
});

export interface ProfileCliOptions {
	readonly target: string;
	readonly intervalMs: number;
	readonly durationMs: number;
	readonly width: number | null;
	readonly run: string | null;
	readonly phase: string | null;
	readonly json: boolean;
	readonly outPath: string | null;
}

export interface ProfilePeer {
	readonly sessionId: string;
	readonly agentId?: string;
	readonly name: string;
	readonly cwd: string;
	readonly pid: number;
	readonly lastSeen: string;
	readonly state: "unknown" | "working" | "waiting_input" | "idle" | "paused";
	readonly sessionFile?: string;
	readonly ownerEpoch?: string;
	readonly buildDigest?: string;
	readonly version?: string;
	readonly labels?: {
		readonly workstream?: string;
	};
}

export interface ProcessSnapshotRow {
	readonly pid: number;
	readonly ppid: number;
	readonly pgid: number;
	readonly rssBytes: number;
	readonly cpuPercent: number;
	readonly elapsed: string;
	readonly command: string;
	readonly commandTruncated: boolean;
}

export interface ProcessOwner {
	readonly sessionId: string;
	readonly agentId: string | null;
	readonly name: string;
	readonly pid: number;
	readonly targetRoot: boolean;
}

export interface ProfileTargetMetadata extends ProcessOwner {
	readonly cwd: string;
	readonly state: ProfilePeer["state"];
	readonly lastSeen: string;
	readonly sessionFile: string | null;
	readonly ownerEpoch: string | null;
	readonly buildDigest: string | null;
	readonly version: string | null;
	readonly workstream: string | null;
}

export interface ProfileProcessNode extends ProcessSnapshotRow {
	readonly depth: number;
	readonly owner: ProcessOwner;
}

export interface ProfileOwnerAggregate {
	readonly owner: ProcessOwner;
	readonly processCount: number;
	readonly rssBytes: number;
	readonly cpuPercent: number;
}

export interface ProfileAggregate {
	readonly processCount: number;
	readonly rssBytes: number;
	readonly cpuPercent: number;
	readonly physicalFootprintBytes: null;
	readonly jsc: {
		readonly heapSizeBytes: null;
		readonly heapCapacityBytes: null;
		readonly extraMemoryBytes: null;
	};
	readonly heap: {
		readonly usedBytes: null;
		readonly totalBytes: null;
	};
	readonly externalBytes: null;
	readonly arrayBuffersBytes: null;
	readonly byOwner: readonly ProfileOwnerAggregate[];
}

export interface ProcessCapture {
	readonly schemaVersion: typeof PROCESS_PROFILE_SCHEMA_VERSION;
	readonly captureId: string;
	readonly sampledAt: string;
	readonly labels: {
		readonly width: number | null;
		readonly run: string | null;
		readonly phase: string | null;
	};
	readonly target: ProfileTargetMetadata;
	readonly processTree: readonly ProfileProcessNode[];
	readonly aggregate: ProfileAggregate;
}

export interface ProcessProfile {
	readonly schemaVersion: typeof PROCESS_PROFILE_SCHEMA_VERSION;
	readonly captureId: string;
	readonly startedAt: string;
	readonly completedAt: string;
	readonly target: ProfileTargetMetadata;
	readonly labels: ProcessCapture["labels"];
	readonly intervalMs: number;
	readonly durationMs: number;
	readonly captures: readonly ProcessCapture[];
}

export class ProfileCliError extends Error {
	readonly _tag = "ProfileCliError";
	constructor(message: string) {
		super(message);
		this.name = "ProfileCliError";
	}
}

export class ProfileTargetNotFoundError extends Error {
	readonly _tag = "ProfileTargetNotFoundError";
	constructor(readonly target: string) {
		super(`No live OMP peer matches target ${JSON.stringify(target)}`);
		this.name = "ProfileTargetNotFoundError";
	}
}

export class ProfileTargetAmbiguousError extends Error {
	readonly _tag = "ProfileTargetAmbiguousError";
	constructor(
		readonly target: string,
		readonly sessionIds: readonly string[],
	) {
		super(`OMP peer name ${JSON.stringify(target)} is ambiguous: ${sessionIds.join(", ")}`);
		this.name = "ProfileTargetAmbiguousError";
	}
}

export class ProfileTargetNotLiveError extends Error {
	readonly _tag = "ProfileTargetNotLiveError";
	constructor(
		readonly sessionId: string,
		readonly pid: number,
	) {
		super(`OMP target ${sessionId} is not present in the host process snapshot at PID ${pid}`);
		this.name = "ProfileTargetNotLiveError";
	}
}

export class ProfileBoundaryError extends Error {
	readonly _tag = "ProfileBoundaryError";
	constructor(
		readonly boundary: "peer" | "ps",
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "ProfileBoundaryError";
	}
}

export class ProfileLimitError extends Error {
	readonly _tag = "ProfileLimitError";
	constructor(
		readonly limit: "samples" | "processes" | "psSnapshotBytes" | "outputBytes",
		readonly observed: number,
		readonly maximum: number,
	) {
		super(`Profile ${limit} limit exceeded: observed ${observed}, maximum ${maximum}`);
		this.name = "ProfileLimitError";
	}
}

const CliBoundarySchema = Schema.Struct({
	target: Schema.String,
	intervalMs: Schema.Int,
	durationMs: Schema.Int,
	width: Schema.NullOr(Schema.Int),
	run: Schema.NullOr(Schema.String),
	phase: Schema.NullOr(Schema.String),
	json: Schema.Boolean,
	outPath: Schema.NullOr(Schema.String),
});

const OptionalPeerValueBoundary = Schema.optionalKey(Schema.Unknown);
const PeerBoundarySchema = Schema.Struct({
	sessionId: Schema.String,
	agentId: OptionalPeerValueBoundary,
	name: Schema.String,
	cwd: Schema.String,
	pid: Schema.Int,
	lastSeen: Schema.String,
	state: Schema.Literals(["unknown", "working", "waiting_input", "idle", "paused"]),
	sessionFile: OptionalPeerValueBoundary,
	ownerEpoch: OptionalPeerValueBoundary,
	buildDigest: OptionalPeerValueBoundary,
	version: OptionalPeerValueBoundary,
	labels: OptionalPeerValueBoundary,
});

const PeerListBoundarySchema = Schema.Array(PeerBoundarySchema);
const ProcessRowBoundarySchema = Schema.Struct({
	pid: Schema.Int,
	ppid: Schema.Int,
	pgid: Schema.Int,
	rssBytes: Schema.Int,
	cpuPercent: Schema.Number,
	elapsed: Schema.String,
	command: Schema.String,
	commandTruncated: Schema.Boolean,
});

const VALUE_FLAGS: Readonly<Record<string, true>> = {
	"--target": true,
	"--interval-ms": true,
	"--duration-ms": true,
	"--width": true,
	"--run": true,
	"--phase": true,
	"--out": true,
};

function positiveInteger(text: string, flag: string): number {
	if (!/^\d+$/.test(text)) throw new ProfileCliError(`${flag} must be a positive integer`);
	const value = Number(text);
	if (!Number.isSafeInteger(value) || value <= 0) throw new ProfileCliError(`${flag} must be a positive integer`);
	return value;
}

function labelValue(text: string, flag: string, maximumLength: number): string {
	const value = text.trim();
	if (value.length === 0 || value.length > maximumLength) {
		throw new ProfileCliError(`${flag} must contain 1-${maximumLength} characters`);
	}
	return value;
}

export function plannedSampleCount(durationMs: number, intervalMs: number): number {
	return Math.max(1, Math.ceil(durationMs / intervalMs));
}

export function parseProfileCli(argv: readonly string[], limits: ProfileLimits = DEFAULT_PROFILE_LIMITS): ProfileCliOptions {
	const values = new Map<string, string>();
	let json = false;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === "--json") {
			if (json) throw new ProfileCliError("--json may be specified only once");
			json = true;
			continue;
		}
		if (flag === undefined || !Object.hasOwn(VALUE_FLAGS, flag)) throw new ProfileCliError(`Unknown argument ${JSON.stringify(flag)}`);
		if (values.has(flag)) throw new ProfileCliError(`${flag} may be specified only once`);
		const value = argv[index + 1];
		if (value === undefined || value.startsWith("--")) throw new ProfileCliError(`${flag} requires a value`);
		values.set(flag, value);
		index += 1;
	}

	const targetText = values.get("--target");
	if (targetText === undefined) throw new ProfileCliError("--target is required");
	const target = labelValue(targetText, "--target", 256);
	const intervalMs = positiveInteger(values.get("--interval-ms") ?? "250", "--interval-ms");
	const durationMs = positiveInteger(values.get("--duration-ms") ?? "1000", "--duration-ms");
	const widthText = values.get("--width");
	const width = widthText === undefined ? null : positiveInteger(widthText, "--width");
	const runText = values.get("--run");
	const phaseText = values.get("--phase");
	const outText = values.get("--out");
	const decoded = Schema.decodeUnknownSync(CliBoundarySchema)({
		target,
		intervalMs,
		durationMs,
		width,
		run: runText === undefined ? null : labelValue(runText, "--run", 128),
		phase: phaseText === undefined ? null : labelValue(phaseText, "--phase", 64),
		json,
		outPath: outText === undefined ? null : labelValue(outText, "--out", 4_096),
	});

	if (decoded.intervalMs < MIN_PROFILE_INTERVAL_MS) {
		throw new ProfileCliError(`--interval-ms must be at least ${MIN_PROFILE_INTERVAL_MS}`);
	}
	if (decoded.durationMs > MAX_PROFILE_DURATION_MS) {
		throw new ProfileCliError(`--duration-ms must be at most ${MAX_PROFILE_DURATION_MS}`);
	}
	if (decoded.width !== null && decoded.width > 256) throw new ProfileCliError("--width must be at most 256");
	const samples = plannedSampleCount(decoded.durationMs, decoded.intervalMs);
	if (samples > limits.maxSamples) throw new ProfileLimitError("samples", samples, limits.maxSamples);
	return decoded;
}

function decodeOptionalPeerString(sessionId: string, field: string, value: unknown): string | undefined {
	if (value == null) return undefined;
	if (typeof value !== "string") throw new Error(`peer ${sessionId} ${field} must be a string, null, or undefined`);
	return value;
}

export function decodeProfilePeers(value: unknown): readonly ProfilePeer[] {
	try {
		const peers = Schema.decodeUnknownSync(PeerListBoundarySchema)(value);
		return peers.map(peer => {
			if (peer.sessionId.length === 0 || peer.name.length === 0 || peer.cwd.length === 0 || peer.pid <= 0) {
				throw new Error("peer identifiers, cwd, and PID must be non-empty and positive");
			}
			if (!Number.isFinite(Date.parse(peer.lastSeen))) throw new Error(`peer ${peer.sessionId} has an invalid lastSeen timestamp`);
			const agentId = decodeOptionalPeerString(peer.sessionId, "agentId", peer.agentId);
			const sessionFile = decodeOptionalPeerString(peer.sessionId, "sessionFile", peer.sessionFile);
			const ownerEpoch = decodeOptionalPeerString(peer.sessionId, "ownerEpoch", peer.ownerEpoch);
			const buildDigest = decodeOptionalPeerString(peer.sessionId, "buildDigest", peer.buildDigest);
			const version = decodeOptionalPeerString(peer.sessionId, "version", peer.version);
			let workstream: string | undefined;
			if (peer.labels != null) {
				if (typeof peer.labels !== "object" || Array.isArray(peer.labels)) {
					throw new Error(`peer ${peer.sessionId} labels must be an object, null, or undefined`);
				}
				workstream = decodeOptionalPeerString(
					peer.sessionId,
					"labels.workstream",
					(peer.labels as Record<string, unknown>).workstream,
				);
			}
			return {
				sessionId: peer.sessionId,
				...(agentId === undefined ? {} : { agentId }),
				name: peer.name,
				cwd: peer.cwd,
				pid: peer.pid,
				lastSeen: peer.lastSeen,
				state: peer.state,
				...(sessionFile === undefined ? {} : { sessionFile }),
				...(ownerEpoch === undefined ? {} : { ownerEpoch }),
				...(buildDigest === undefined ? {} : { buildDigest }),
				...(version === undefined ? {} : { version }),
				...(workstream === undefined ? {} : { labels: { workstream } }),
			};
		});
	} catch (error) {
		if (error instanceof ProfileBoundaryError) throw error;
		throw new ProfileBoundaryError("peer", `External peer data failed schema validation: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
}

export function readCanonicalProfilePeers(dbPath?: string): readonly ProfilePeer[] {
	let bus: IrcExternalBus | undefined;
	try {
		bus = new IrcExternalBus(dbPath, { readonly: true });
		return decodeProfilePeers(bus.listPeers({ includeStale: true }));
	} catch (error) {
		if (error instanceof ProfileBoundaryError) throw error;
		throw new ProfileBoundaryError(
			"peer",
			`Canonical external peer store could not be read: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	} finally {
		bus?.close();
	}
}

export function resolveProfileTarget(target: string, peers: readonly ProfilePeer[]): ProfilePeer {
	const sessionMatch = peers.find(peer => peer.sessionId === target);
	if (sessionMatch) return sessionMatch;
	const nameMatches = peers.filter(peer => peer.name === target);
	if (nameMatches.length === 0) throw new ProfileTargetNotFoundError(target);
	if (nameMatches.length > 1) {
		throw new ProfileTargetAmbiguousError(
			target,
			nameMatches.map(peer => peer.sessionId).sort(),
		);
	}
	return nameMatches[0]!;
}

function utf8Bytes(text: string): number {
	return Buffer.byteLength(text);
}

function truncateCommand(command: string, maximumLength: number): { readonly command: string; readonly truncated: boolean } {
	if (command.length <= maximumLength) return { command, truncated: false };
	return { command: `${command.slice(0, Math.max(0, maximumLength - 1))}…`, truncated: true };
}

export function parsePsSnapshot(output: unknown, limits: ProfileLimits = DEFAULT_PROFILE_LIMITS): readonly ProcessSnapshotRow[] {
	let text: string;
	try {
		text = Schema.decodeUnknownSync(Schema.String)(output);
	} catch (error) {
		throw new ProfileBoundaryError("ps", "ps output was not a string", { cause: error });
	}
	const snapshotBytes = utf8Bytes(text);
	if (snapshotBytes > limits.maxPsSnapshotBytes) {
		throw new ProfileLimitError("psSnapshotBytes", snapshotBytes, limits.maxPsSnapshotBytes);
	}

	const rows: ProcessSnapshotRow[] = [];
	const seenPids = new Set<number>();
	for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
		if (line.trim().length === 0) continue;
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([0-9]+(?:\.[0-9]+)?)\s+(\S+)\s+(.+?)\s*$/.exec(line);
		if (!match) throw new ProfileBoundaryError("ps", `Malformed ps row at line ${lineIndex + 1}`);
		const [, pidText, ppidText, pgidText, rssKbText, cpuText, elapsed, rawCommand] = match;
		const pid = Number(pidText);
		const ppid = Number(ppidText);
		const pgid = Number(pgidText);
		const rssKb = Number(rssKbText);
		const cpuPercent = Number(cpuText);
		if (
			!Number.isSafeInteger(pid) ||
			pid <= 0 ||
			!Number.isSafeInteger(ppid) ||
			ppid < 0 ||
			!Number.isSafeInteger(pgid) ||
			pgid < 0 ||
			!Number.isSafeInteger(rssKb) ||
			rssKb < 0 ||
			!Number.isFinite(cpuPercent) ||
			cpuPercent < 0 ||
			elapsed === undefined ||
			parsePsElapsedSeconds(elapsed) === null ||
			rawCommand === undefined
		) {
			throw new ProfileBoundaryError("ps", `Invalid ps values at line ${lineIndex + 1}`);
		}
		if (seenPids.has(pid)) throw new ProfileBoundaryError("ps", `Duplicate PID ${pid} in ps snapshot`);
		seenPids.add(pid);
		const boundedCommand = truncateCommand(rawCommand, limits.maxCommandLength);
		try {
			rows.push(
				Schema.decodeUnknownSync(ProcessRowBoundarySchema)({
					pid,
					ppid,
					pgid,
					rssBytes: rssKb * 1_024,
					cpuPercent,
					elapsed,
					command: boundedCommand.command,
					commandTruncated: boundedCommand.truncated,
				}),
			);
		} catch (error) {
			throw new ProfileBoundaryError("ps", `ps row ${lineIndex + 1} failed schema validation`, { cause: error });
		}
	}
	return rows;
}

export function parsePsElapsedSeconds(elapsed: string): number | null {
	const match = /^(?:(\d+)-)?(?:(\d{1,3}):)?(\d{1,2}):(\d{2})$/.exec(elapsed);
	if (!match) return null;
	const days = Number(match[1] ?? "0");
	const hours = Number(match[2] ?? "0");
	const minutes = Number(match[3]);
	const seconds = Number(match[4]);
	if (
		!Number.isSafeInteger(days) ||
		!Number.isSafeInteger(hours) ||
		!Number.isSafeInteger(minutes) ||
		!Number.isSafeInteger(seconds) ||
		days < 0 ||
		hours < 0 ||
		hours > 23 ||
		minutes < 0 ||
		minutes > 59 ||
		seconds < 0 ||
		seconds > 59
	) {
		return null;
	}
	const totalSeconds = ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
	return Number.isSafeInteger(totalSeconds) && Number.isSafeInteger(totalSeconds * 1_000) ? totalSeconds : null;
}

export function hasOmpCommandEvidence(command: string): boolean {
	const executable = /^\s*(\S+)/.exec(command)?.[1];
	if (executable !== undefined && path.basename(executable) === "omp") return true;
	return /(?:^|\s)\S*\/(?:coding-agent|pi-coding-agent)\/(?:src\/cli\.ts|dist\/cli\.js)(?=\s|$)/.test(command);
}

export function isProfilePeerIdentityValid(peer: ProfilePeer, row: ProcessSnapshotRow, sampledAt: string): boolean {
	if (peer.pid !== row.pid || !hasOmpCommandEvidence(row.command)) return false;
	const sampledAtMs = Date.parse(sampledAt);
	const lastSeenMs = Date.parse(peer.lastSeen);
	if (!Number.isFinite(sampledAtMs) || !Number.isFinite(lastSeenMs)) return false;
	const ageMs = sampledAtMs - lastSeenMs;
	if (ageMs > IRC_EXTERNAL_STALE_MS || ageMs < -PROFILE_PEER_FUTURE_SKEW_MS) return false;
	const elapsedSeconds = parsePsElapsedSeconds(row.elapsed);
	if (elapsedSeconds === null) return false;
	const processStartedAtMs = sampledAtMs - elapsedSeconds * 1_000;
	return processStartedAtMs <= lastSeenMs + PROFILE_PS_START_TOLERANCE_MS;
}

function ownerFromPeer(peer: ProfilePeer, target: ProfilePeer): ProcessOwner {
	return {
		sessionId: peer.sessionId,
		agentId: peer.agentId ?? null,
		name: peer.name,
		pid: peer.pid,
		targetRoot: peer.sessionId === target.sessionId,
	};
}

function metadataFromPeer(peer: ProfilePeer): ProfileTargetMetadata {
	return {
		...ownerFromPeer(peer, peer),
		cwd: peer.cwd,
		state: peer.state,
		lastSeen: peer.lastSeen,
		sessionFile: peer.sessionFile ?? null,
		ownerEpoch: peer.ownerEpoch ?? null,
		buildDigest: peer.buildDigest ?? null,
		version: peer.version ?? null,
		workstream: peer.labels?.workstream ?? null,
	};
}

export interface BuildCaptureOptions {
	readonly captureId: string;
	readonly sampledAt: string;
	readonly target: ProfilePeer;
	readonly peers: readonly ProfilePeer[];
	readonly rows: readonly ProcessSnapshotRow[];
	readonly labels?: ProcessCapture["labels"];
	readonly limits?: ProfileLimits;
}

function descendantRows(
	targetPid: number,
	rows: readonly ProcessSnapshotRow[],
	maxProcesses: number,
): readonly { readonly row: ProcessSnapshotRow; readonly depth: number }[] {
	const byPid = new Map(rows.map(row => [row.pid, row]));
	const targetRow = byPid.get(targetPid);
	if (targetRow === undefined) throw new ProfileTargetNotLiveError("unknown", targetPid);
	if (maxProcesses < 1) throw new ProfileLimitError("processes", 1, maxProcesses);
	const children = new Map<number, ProcessSnapshotRow[]>();
	for (const row of rows) {
		const siblings = children.get(row.ppid);
		if (siblings) siblings.push(row);
		else children.set(row.ppid, [row]);
	}
	for (const siblings of children.values()) siblings.sort((left, right) => left.pid - right.pid);
	const result: { row: ProcessSnapshotRow; depth: number }[] = [];
	const discovered = new Set<number>([targetPid]);
	const queue: { row: ProcessSnapshotRow; depth: number }[] = [{ row: targetRow, depth: 0 }];
	for (let index = 0; index < queue.length; index += 1) {
		const current = queue[index]!;
		result.push(current);
		for (const child of children.get(current.row.pid) ?? []) {
			if (discovered.has(child.pid)) continue;
			const observed = discovered.size + 1;
			if (observed > maxProcesses) throw new ProfileLimitError("processes", observed, maxProcesses);
			discovered.add(child.pid);
			queue.push({ row: child, depth: current.depth + 1 });
		}
	}
	return result;
}

export function buildProcessCapture(options: BuildCaptureOptions): ProcessCapture {
	const limits = options.limits ?? DEFAULT_PROFILE_LIMITS;
	const targetRow = options.rows.find(row => row.pid === options.target.pid);
	if (targetRow === undefined || !isProfilePeerIdentityValid(options.target, targetRow, options.sampledAt)) {
		throw new ProfileTargetNotLiveError(options.target.sessionId, options.target.pid);
	}
	const descendants = descendantRows(options.target.pid, options.rows, limits.maxProcesses);

	const descendantPids = new Set(descendants.map(item => item.row.pid));
	const rowByPid = new Map(descendants.map(item => [item.row.pid, item.row]));
	const peersByPid = new Map<number, ProfilePeer>();
	peersByPid.set(options.target.pid, options.target);
	for (const peer of options.peers) {
		if (!descendantPids.has(peer.pid) || peer.sessionId === options.target.sessionId || peersByPid.has(peer.pid)) continue;
		const row = rowByPid.get(peer.pid);
		if (row === undefined || !isProfilePeerIdentityValid(peer, row, options.sampledAt)) continue;
		peersByPid.set(peer.pid, peer);
	}
	const ownerCache = new Map<number, ProcessOwner>();
	const nearestOwner = (row: ProcessSnapshotRow): ProcessOwner => {
		const cached = ownerCache.get(row.pid);
		if (cached) return cached;
		let cursor: ProcessSnapshotRow | undefined = row;
		while (cursor) {
			const peer = peersByPid.get(cursor.pid);
			if (peer) {
				const owner = ownerFromPeer(peer, options.target);
				ownerCache.set(row.pid, owner);
				return owner;
			}
			cursor = rowByPid.get(cursor.ppid);
		}
		const owner = ownerFromPeer(options.target, options.target);
		ownerCache.set(row.pid, owner);
		return owner;
	};

	const processTree: ProfileProcessNode[] = descendants.map(({ row, depth }) => ({
		...row,
		depth,
		owner: nearestOwner(row),
	}));
	const ownerAggregates = new Map<string, { owner: ProcessOwner; processCount: number; rssBytes: number; cpuPercent: number }>();
	let rssBytes = 0;
	let cpuPercent = 0;
	for (const node of processTree) {
		rssBytes += node.rssBytes;
		cpuPercent += node.cpuPercent;
		const current = ownerAggregates.get(node.owner.sessionId) ?? {
			owner: node.owner,
			processCount: 0,
			rssBytes: 0,
			cpuPercent: 0,
		};
		current.processCount += 1;
		current.rssBytes += node.rssBytes;
		current.cpuPercent += node.cpuPercent;
		ownerAggregates.set(node.owner.sessionId, current);
	}

	return {
		schemaVersion: PROCESS_PROFILE_SCHEMA_VERSION,
		captureId: options.captureId,
		sampledAt: options.sampledAt,
		labels: options.labels ?? { width: null, run: null, phase: null },
		target: metadataFromPeer(options.target),
		processTree,
		aggregate: {
			processCount: processTree.length,
			rssBytes,
			cpuPercent,
			physicalFootprintBytes: null,
			jsc: { heapSizeBytes: null, heapCapacityBytes: null, extraMemoryBytes: null },
			heap: { usedBytes: null, totalBytes: null },
			externalBytes: null,
			arrayBuffersBytes: null,
			byOwner: [...ownerAggregates.values()].sort((left, right) => left.owner.pid - right.owner.pid),
		},
	};
}

export function serializeProcessProfile(profile: ProcessProfile, maximumBytes = MAX_PROFILE_OUTPUT_BYTES): string {
	const json = `${JSON.stringify(profile, null, 2)}\n`;
	const size = utf8Bytes(json);
	if (size > maximumBytes) throw new ProfileLimitError("outputBytes", size, maximumBytes);
	return json;
}

async function assertRegularOutputDestination(destination: string): Promise<void> {
	try {
		const destinationStat = await fs.lstat(destination);
		if (!destinationStat.isFile()) {
			throw new ProfileCliError(`--out destination must be a regular file or missing: ${destination}`);
		}
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
		throw error;
	}
}

export async function writeAtomicProfileOutput(outputPath: string, contents: string): Promise<void> {
	const destination = path.resolve(outputPath);
	const parent = path.dirname(destination);
	await fs.mkdir(parent, { recursive: true });
	await assertRegularOutputDestination(destination);
	const temporary = path.join(parent, `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
	let temporaryFile: Awaited<ReturnType<typeof fs.open>> | undefined;
	let temporaryCreated = false;
	try {
		temporaryFile = await fs.open(
			temporary,
			FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL | FS_CONSTANTS.O_NOFOLLOW,
			0o600,
		);
		temporaryCreated = true;
		await temporaryFile.writeFile(contents, "utf8");
		await temporaryFile.sync();
		await temporaryFile.close();
		temporaryFile = undefined;
		await assertRegularOutputDestination(destination);
		await fs.rename(temporary, destination);
	} catch (error) {
		let cleanupError: unknown;
		if (temporaryFile !== undefined) {
			try {
				await temporaryFile.close();
			} catch (closeError) {
				cleanupError = closeError;
			}
		}
		if (temporaryCreated) {
			try {
				await fs.unlink(temporary);
			} catch (unlinkError) {
				if (!(typeof unlinkError === "object" && unlinkError !== null && "code" in unlinkError && unlinkError.code === "ENOENT")) {
					cleanupError ??= unlinkError;
				}
			}
		}
		if (cleanupError !== undefined) {
			throw new AggregateError([error, cleanupError], `Failed writing and cleaning temporary profile output ${temporary}`);
		}
		throw error;
	}
}

async function readBoundedByteStream(
	stream: ReadableStream<Uint8Array>,
	maximumBytes: number,
	overflowError: (observedBytes: number) => Error,
	onOverflow: () => void,
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			const observedBytes = totalBytes + next.value.byteLength;
			if (observedBytes > maximumBytes) {
				try {
					onOverflow();
				} catch {
					// Overflow cleanup remains best-effort; the bounded read still fails closed.
				}
				try {
					await reader.cancel();
				} catch {
					// The owned ps child is killed on overflow; cancellation may race its stream shutdown.
				}
				throw overflowError(observedBytes);
			}
			totalBytes = observedBytes;
			chunks.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}
	const output = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

export function readBoundedPsSnapshotStream(
	stream: ReadableStream<Uint8Array>,
	maximumBytes: number,
	onOverflow: () => void = () => {},
): Promise<Uint8Array> {
	return readBoundedByteStream(
		stream,
		maximumBytes,
		observedBytes => new ProfileLimitError("psSnapshotBytes", observedBytes, maximumBytes),
		onOverflow,
	);
}

export async function sampleHostProcesses(limits: ProfileLimits): Promise<readonly ProcessSnapshotRow[]> {
	const child = Bun.spawn({
		cmd: [...PS_SNAPSHOT_COMMAND],
		stdout: "pipe",
		stderr: "pipe",
	});
	let killedForOverflow = false;
	const killPsOnOverflow = (): void => {
		if (killedForOverflow) return;
		killedForOverflow = true;
		try {
			child.kill("SIGKILL");
		} catch {
			// The child may have exited between the overflowing read and this bounded cleanup.
		}
	};
	const [stdoutResult, stderrResult, exitResult] = await Promise.allSettled([
		readBoundedPsSnapshotStream(child.stdout, limits.maxPsSnapshotBytes, killPsOnOverflow),
		readBoundedByteStream(
			child.stderr,
			MAX_PS_STDERR_BYTES,
			observedBytes =>
				new ProfileBoundaryError("ps", `/bin/ps stderr exceeded ${MAX_PS_STDERR_BYTES} bytes (observed ${observedBytes})`),
			killPsOnOverflow,
		),
		child.exited,
	]);
	if (stdoutResult.status === "rejected") throw stdoutResult.reason;
	if (stderrResult.status === "rejected") throw stderrResult.reason;
	if (exitResult.status === "rejected") {
		throw new ProfileBoundaryError("ps", "/bin/ps exit status could not be read", { cause: exitResult.reason });
	}
	const stderr = new TextDecoder().decode(stderrResult.value);
	if (exitResult.value !== 0) {
		throw new ProfileBoundaryError("ps", `/bin/ps exited ${exitResult.value}: ${stderr.trim() || "no diagnostics"}`);
	}
	const stdout = new TextDecoder().decode(stdoutResult.value);
	return parsePsSnapshot(stdout, limits);
}

export async function captureProcessProfile(
	options: ProfileCliOptions,
	peers: readonly ProfilePeer[],
	limits: ProfileLimits = DEFAULT_PROFILE_LIMITS,
): Promise<ProcessProfile> {
	let target: ProfilePeer | undefined;
	const captureId = crypto.randomUUID();
	const startedMs = Date.now();
	const startedAt = new Date(startedMs).toISOString();
	const labels = { width: options.width, run: options.run, phase: options.phase } as const;
	const captures: ProcessCapture[] = [];
	const count = plannedSampleCount(options.durationMs, options.intervalMs);
	if (count > limits.maxSamples) throw new ProfileLimitError("samples", count, limits.maxSamples);
	let encodedCaptureBytes = 0;
	for (let index = 0; index < count; index += 1) {
		if (index > 0) {
			const waitMs = startedMs + index * options.intervalMs - Date.now();
			if (waitMs > 0) await Bun.sleep(waitMs);
		}
		const rows = await sampleHostProcesses(limits);
		const sampledAt = new Date().toISOString();
		if (target === undefined) {
			const rowsByPid = new Map(rows.map(row => [row.pid, row]));
			const verifiedPeers = peers.filter(peer => {
				const row = rowsByPid.get(peer.pid);
				return row !== undefined && isProfilePeerIdentityValid(peer, row, sampledAt);
			});
			const requestedSession = peers.find(peer => peer.sessionId === options.target);
			if (requestedSession !== undefined && !verifiedPeers.includes(requestedSession)) {
				throw new ProfileTargetNotLiveError(requestedSession.sessionId, requestedSession.pid);
			}
			target = resolveProfileTarget(options.target, verifiedPeers);
		}
		const capture = buildProcessCapture({
			captureId: `${captureId}:${index + 1}`,
			sampledAt,
			target,
			peers,
			rows,
			labels,
			limits,
		});
		encodedCaptureBytes += utf8Bytes(JSON.stringify(capture));
		if (encodedCaptureBytes > limits.maxOutputBytes) {
			throw new ProfileLimitError("outputBytes", encodedCaptureBytes, limits.maxOutputBytes);
		}
		captures.push(capture);
	}
	if (target === undefined) throw new ProfileTargetNotFoundError(options.target);
	return {
		schemaVersion: PROCESS_PROFILE_SCHEMA_VERSION,
		captureId,
		startedAt,
		completedAt: new Date().toISOString(),
		target: metadataFromPeer(target),
		labels,
		intervalMs: options.intervalMs,
		durationMs: options.durationMs,
		captures,
	};
}

export const PROCESS_PROFILE_USAGE = `Usage: bun scripts/omp-process-profile.ts --target <session-id-or-peer-name> [options]

Read-only options:
  --interval-ms <N>  Sampling interval, minimum ${MIN_PROFILE_INTERVAL_MS} (default: 250)
  --duration-ms <N>  Capture duration, maximum ${MAX_PROFILE_DURATION_MS} (default: 1000)
  --width <N>        Optional wave-width label
  --run <label>      Optional run label
  --phase <label>    Optional phase label
  --json             Write the bounded JSON document to stdout
  --out <path>       Also write the bounded JSON document to a file
  --help              Show this help

The command only opens the canonical IRC peer database read-only and invokes:
  ${PS_SNAPSHOT_COMMAND.join(" ")}`;

function errorRecord(error: unknown): { readonly error: { readonly type: string; readonly message: string } } {
	return {
		error: {
			type: error instanceof Error && "_tag" in error && typeof error._tag === "string" ? error._tag : "Error",
			message: error instanceof Error ? error.message : String(error),
		},
	};
}

export async function main(argv: readonly string[]): Promise<void> {
	if (argv.includes("--help")) {
		await Bun.write(Bun.stdout, `${PROCESS_PROFILE_USAGE}\n`);
		return;
	}
	const jsonRequested = argv.includes("--json");
	let options: ProfileCliOptions | undefined;
	try {
		options = parseProfileCli(argv);
		const peers = readCanonicalProfilePeers();
		const profile = await captureProcessProfile(options, peers);
		const json = serializeProcessProfile(profile);
		if (options.outPath !== null) {
			await writeAtomicProfileOutput(options.outPath, json);
		}
		if (options.json) {
			await Bun.write(Bun.stdout, json);
		} else {
			const latest = profile.captures.at(-1)!;
			await Bun.write(
				Bun.stdout,
				`Captured ${profile.captures.length} sample(s), ${latest.aggregate.processCount} process(es), ${(latest.aggregate.rssBytes / 1_048_576).toFixed(1)} MiB RSS for ${profile.target.sessionId}\n`,
			);
		}
	} catch (error) {
		const rendered = (options?.json ?? jsonRequested)
			? `${JSON.stringify(errorRecord(error))}\n`
			: `${error instanceof Error ? error.message : String(error)}\n`;
		await Bun.write(Bun.stderr, rendered);
		process.exitCode = 1;
	}
}

if (import.meta.main) await main(Bun.argv.slice(2));
