#!/usr/bin/env bun

import { Schema } from "effect";

import {
	closeSync,
	existsSync,
	linkSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ForwardErrorTag =
	| "ForwardConfigInvalid"
	| "HostUnreachable"
	| "BackendAbsent"
	| "PortCollision"
	| "BrowserOpenFailed"
	| "LeaseHeldByAnotherOwner"
	| "StaleSupervisor"
	| "SupervisorIdentityUnavailable"
	| "StaticArtifactRejected";

export interface ForwardErrorDetail {
	readonly _tag: ForwardErrorTag;
	readonly message: string;
	readonly [field: string]: unknown;
}

function errorDetail(problem: { readonly _tag: ForwardErrorTag; readonly message: string }): ForwardErrorDetail {
	return { ...problem, _tag: problem._tag, message: problem.message };
}

export class ForwardConfigInvalid extends Schema.TaggedErrorClass<ForwardConfigInvalid>()("ForwardConfigInvalid", {
	field: Schema.String,
	message: Schema.String,
}) {
	constructor(field: string, message: string) {
		super({ field, message });
	}

	detail(): ForwardErrorDetail {
		return errorDetail(this);
	}
}

export class HostUnreachable extends Schema.TaggedErrorClass<HostUnreachable>()("HostUnreachable", {
	host: Schema.String,
	user: Schema.String,
	exitCode: Schema.Number,
	message: Schema.String,
}) {
	constructor(host: string, user: string, exitCode: number, message: string) {
		super({ host, user, exitCode, message });
	}

	detail(): ForwardErrorDetail {
		return errorDetail(this);
	}
}

export class BackendAbsent extends Schema.TaggedErrorClass<BackendAbsent>()("BackendAbsent", {
	target: Schema.String,
	kind: Schema.Literals(["direct", "portless", "static"]),
	message: Schema.String,
}) {
	constructor(target: string, kind: ForwardTargetKind, message: string) {
		super({ target, kind, message });
	}

	detail(): ForwardErrorDetail {
		return errorDetail(this);
	}
}

export class PortCollision extends Schema.TaggedErrorClass<PortCollision>()("PortCollision", {
	alias: Schema.String,
	localPort: Schema.Number,
	message: Schema.String,
}) {
	constructor(alias: string, localPort: number, message: string) {
		super({ alias, localPort, message });
	}

	detail(): ForwardErrorDetail {
		return errorDetail(this);
	}
}

export class BrowserOpenFailed extends Schema.TaggedErrorClass<BrowserOpenFailed>()("BrowserOpenFailed", {
	target: Schema.String,
	url: Schema.String,
	message: Schema.String,
}) {
	constructor(target: string, url: string, message: string) {
		super({ target, url, message });
	}

	detail(): ForwardErrorDetail {
		return errorDetail(this);
	}
}

export class LeaseHeldByAnotherOwner extends Schema.TaggedErrorClass<LeaseHeldByAnotherOwner>()(
	"LeaseHeldByAnotherOwner",
	{
		alias: Schema.String,
		forwardId: Schema.String,
		holderForwardId: Schema.String,
		holderPid: Schema.Number,
		message: Schema.String,
	},
) {
	constructor(alias: string, forwardId: string, holderForwardId: string, holderPid: number, message: string) {
		super({ alias, forwardId, holderForwardId, holderPid, message });
	}

	detail(): ForwardErrorDetail {
		return errorDetail(this);
	}
}

export class StaleSupervisor extends Schema.TaggedErrorClass<StaleSupervisor>()("StaleSupervisor", {
	forwardId: Schema.String,
	pid: Schema.Number,
	message: Schema.String,
}) {
	constructor(forwardId: string, pid: number, message: string) {
		super({ forwardId, pid, message });
	}

	detail(): ForwardErrorDetail {
		return errorDetail(this);
	}
}

export class SupervisorIdentityUnavailable extends Schema.TaggedErrorClass<SupervisorIdentityUnavailable>()(
	"SupervisorIdentityUnavailable",
	{
		forwardId: Schema.String,
		pid: Schema.Number,
		reason: Schema.String,
		message: Schema.String,
	},
) {
	constructor(forwardId: string, pid: number, reason: string, message: string) {
		super({ forwardId, pid, reason, message });
	}

	detail(): ForwardErrorDetail {
		return errorDetail(this);
	}
}

export class StaticArtifactRejected extends Schema.TaggedErrorClass<StaticArtifactRejected>()(
	"StaticArtifactRejected",
	{
		artifact: Schema.String,
		reason: Schema.String,
		message: Schema.String,
	},
) {
	constructor(artifact: string, reason: string, message: string) {
		super({ artifact, reason, message });
	}

	detail(): ForwardErrorDetail {
		return errorDetail(this);
	}
}

function isForwardError(problem: unknown): problem is
	| ForwardConfigInvalid
	| HostUnreachable
	| BackendAbsent
	| PortCollision
	| BrowserOpenFailed
	| LeaseHeldByAnotherOwner
	| StaleSupervisor
	| SupervisorIdentityUnavailable
	| StaticArtifactRejected {
	return (
		problem instanceof ForwardConfigInvalid ||
		problem instanceof HostUnreachable ||
		problem instanceof BackendAbsent ||
		problem instanceof PortCollision ||
		problem instanceof BrowserOpenFailed ||
		problem instanceof LeaseHeldByAnotherOwner ||
		problem instanceof StaleSupervisor ||
		problem instanceof SupervisorIdentityUnavailable ||
		problem instanceof StaticArtifactRejected
	);
}

export function describeError(problem: unknown): ForwardErrorDetail {
	if (isForwardError(problem)) return problem.detail();
	const message = problem instanceof Error ? problem.message : String(problem);
	return new ForwardConfigInvalid("<runtime>", message).detail();
}

export type ForwardTargetKind = "direct" | "portless" | "static";

export interface ForwardTargetConfig {
	name: string;
	kind: ForwardTargetKind;
	alias: string;
	localPort: number;
	path: string;
	artifactDigest: string | null;
}

export interface ForwardConfig {
	version: 1;
	id: string;
	workspace: string;
	stream: string;
	host: string;
	user: string;
	remoteNu: string;
	remoteRunner: string;
	remoteManifest: string;
	ssh: string;
	sshOptions: string[];
	node: string;
	portless: string;
	cmux: string;
	cmuxWorkspace: string;
	stateDir: string;
	refreshMs: number;
	maxBackoffMs: number;
	targets: ForwardTargetConfig[];
}

export interface ResolvedForwardTarget extends ForwardTargetConfig {
	remotePort: number;
	url: string;
}

export interface TargetDegradation {
	readonly target: ForwardTargetConfig;
	readonly error: ForwardErrorDetail;
}

export interface TargetResolution {
	readonly available: ResolvedForwardTarget[];
	readonly degradations: TargetDegradation[];
}

/** `dead` means a state file claims liveness that no live supervisor backs. */
export type ForwardPhase = "starting" | "healthy" | "degraded" | "dead" | "stopped";

export interface BrowserResult {
	name: string;
	url: string;
	workspace: string;
	status: "opened" | "error";
	error?: string;
}

export interface ProcessIdentity {
	readonly bootId: string;
	readonly pid: number;
	readonly startFingerprint: string;
}

export interface SupervisorOwnerRecord {
	readonly version: 1;
	readonly token: string;
	readonly pid: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function decodeSupervisorOwnerRecord(value: unknown): SupervisorOwnerRecord | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).length !== 3 ||
		record.version !== 1 ||
		typeof record.token !== "string" ||
		!UUID_PATTERN.test(record.token) ||
		!Number.isSafeInteger(record.pid) ||
		(record.pid as number) <= 0
	) {
		return null;
	}
	return Object.freeze({ version: 1, token: record.token, pid: record.pid as number });
}

export function sameSupervisorOwnerRecord(left: SupervisorOwnerRecord, right: SupervisorOwnerRecord): boolean {
	return left.version === right.version && left.token === right.token && left.pid === right.pid;
}

export interface ForwardState {
	version: 1;
	id: string;
	pid: number;
	supervisorIdentity: ProcessIdentity | null;
	ownerToken: string | null;
	running: boolean;
	phase: ForwardPhase;
	attempt: number;
	configDigest: string;
	updatedAt: string;
	lastError: ForwardErrorDetail | null;
	targets: ResolvedForwardTarget[];
	degradations: TargetDegradation[];
	/**
	 * Identity of the tunnel child this supervisor owns. Published before the readiness wait and
	 * cleared only once the process is provably gone, so neither a stop nor a crash can leave an
	 * unreapable ssh child holding the review ports.
	 */
	tunnel: TunnelChildRecord | null;
	browser?: BrowserResult[];
}

export interface TargetResolver {
	resolveTargets(config: ForwardConfig): Promise<TargetResolution>;
}

/** PID-reuse-safe identity of one spawned tunnel child, plus the resources it holds. */
export interface TunnelChildRecord {
	version: 1;
	pid: number;
	bootId: string;
	startFingerprint: string;
	controlSocket: string;
	localPorts: number[];
}

/** One forwarded target whose loopback port does not answer, with the cause to publish for it. */
export interface UnreachableTarget {
	readonly target: ResolvedForwardTarget;
	readonly error: BackendAbsent;
}

/**
 * Per-target reachability of one forwarded set. A dead backend degrades only its own target: the
 * child keeps every forward bound, so the reachable ones stay open and a backend that comes back is
 * republished without restarting the tunnel.
 */
export interface TunnelReachability {
	readonly live: ResolvedForwardTarget[];
	readonly dead: UnreachableTarget[];
}

/** `transport: false` means the child or its control master is gone; no backend was probed. */
export interface TunnelProbe extends TunnelReachability {
	readonly transport: boolean;
}

export interface TunnelHandle {
	pid: number;
	probe(): Promise<TunnelProbe>;
	stop(): Promise<void>;
}

/** A ready tunnel plus the reachability sample readiness was decided on. */
export interface ReadyTunnel extends TunnelReachability {
	readonly handle: TunnelHandle;
}

/**
 * A tunnel child that exists but has not proven ready. Spawning and waiting are separate so the
 * owner can persist `record` before it blocks: from the instant the process exists, some later
 * incarnation can find and reap it.
 */
export interface PendingTunnel {
	readonly record: TunnelChildRecord;
	/** Resolves once the master answers, whether or not any backend does; rejects only on transport failure. */
	ready(): Promise<ReadyTunnel>;
	/** Idempotent. Returns only once the child is gone and its loopback ports are free. */
	abort(): Promise<void>;
}

export interface TunnelTransport {
	/** Return as soon as the child exists, before it is ready, so the caller can own it. */
	spawn(config: ForwardConfig, targets: ResolvedForwardTarget[]): Promise<PendingTunnel>;
	cleanupStale(config: ForwardConfig): Promise<void>;
	/** Reap a recorded child this process may not have spawned. Fenced against PID reuse. */
	reap(config: ForwardConfig, record: TunnelChildRecord): Promise<void>;
}

export interface RoutePublisher {
	publish(config: ForwardConfig, targets: ResolvedForwardTarget[]): Promise<void>;
	reconcileHealthy(config: ForwardConfig, targets: ResolvedForwardTarget[]): Promise<void>;
	unpublish(config: ForwardConfig, targets: ResolvedForwardTarget[]): Promise<void>;
	cleanupStale(config: ForwardConfig): Promise<void>;
}

export interface SupervisorDependencies {
	resolver: TargetResolver;
	transport: TunnelTransport;
	routes: RoutePublisher;
}

export interface AliasLease {
	version: 1;
	forwardId: string;
	pid: number;
	alias: string;
	localPort: number;
	configPath: string;
}
const FORWARD_ERROR_TAGS: readonly ForwardErrorTag[] = [
	"ForwardConfigInvalid",
	"HostUnreachable",
	"BackendAbsent",
	"PortCollision",
	"BrowserOpenFailed",
	"LeaseHeldByAnotherOwner",
	"StaleSupervisor",
	"SupervisorIdentityUnavailable",
	"StaticArtifactRejected",
];

interface PortlessRoute {
	alias: string;
	port: number;
	kind: "alias" | "process";
}

const SAFE_ID = /^[a-z][a-z0-9-]*$/;
const SAFE_ABSOLUTE_PATH = /^\/[A-Za-z0-9._/-]+$/;
const SAFE_WORKSPACE = /^workspace:[1-9][0-9]*$/;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const PORTLESS_ROUTE =
	/^\s*https:\/\/([a-z][a-z0-9-]*)\.localhost\s+->\s+(?:localhost|127\.0\.0\.1):([0-9]+)\s+\((alias|pid\s+[0-9]+)\)\s*$/;
const TARGET_KINDS: readonly ForwardTargetKind[] = ["direct", "portless", "static"];
const SSH_UNREACHABLE_EXIT = 255;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function invalid(field: string, message: string): never {
	throw new ForwardConfigInvalid(field, message);
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(field, `${field} must be a record`);
}

function assertSafeId(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || !SAFE_ID.test(value)) invalid(field, `Invalid ${field}: ${String(value)}`);
}

function assertAbsolutePath(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || !SAFE_ABSOLUTE_PATH.test(value) || value.includes("..")) {
		invalid(field, `Invalid ${field}: ${String(value)}`);
	}
}

function assertPort(value: unknown, field: string, minimum = 1): asserts value is number {
	if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > 65_535) {
		invalid(field, `Invalid ${field}: ${String(value)}`);
	}
}

export function validateForwardConfig(value: unknown): ForwardConfig {
	assertRecord(value, "config");
	if (value.version !== 1) invalid("version", "Unsupported forward config version");
	for (const key of ["id", "workspace", "stream", "host"] as const) assertSafeId(value[key], key);
	if (typeof value.user !== "string" || !/^[a-z][a-z0-9_-]*$/.test(value.user)) invalid("user", "Invalid user");
	for (const key of ["remoteNu", "remoteRunner", "remoteManifest", "ssh", "node", "portless", "cmux", "stateDir"] as const) {
		assertAbsolutePath(value[key], key);
	}
	if (!Array.isArray(value.sshOptions) || value.sshOptions.some((item) => typeof item !== "string" || item.includes("\n"))) {
		invalid("sshOptions", "sshOptions must be a string list");
	}
	if (typeof value.cmuxWorkspace !== "string" || !SAFE_WORKSPACE.test(value.cmuxWorkspace)) {
		invalid("cmuxWorkspace", "Invalid cmuxWorkspace");
	}
	if (!Number.isInteger(value.refreshMs) || Number(value.refreshMs) < 250 || Number(value.refreshMs) > 60_000) {
		invalid("refreshMs", "Invalid refreshMs");
	}
	if (
		!Number.isInteger(value.maxBackoffMs) ||
		Number(value.maxBackoffMs) < Number(value.refreshMs) ||
		Number(value.maxBackoffMs) > 300_000
	) {
		invalid("maxBackoffMs", "Invalid maxBackoffMs");
	}
	if (!Array.isArray(value.targets) || value.targets.length === 0) invalid("targets", "Forward config requires targets");
	const aliases = new Set<string>();
	const ports = new Set<number>();
	const targets = value.targets.map((item, index): ForwardTargetConfig => {
		const field = `targets[${index}]`;
		assertRecord(item, field);
		assertSafeId(item.name, `${field}.name`);
		assertSafeId(item.alias, `${field}.alias`);
		assertPort(item.localPort, `${field}.localPort`, 1024);
		if (typeof item.kind !== "string" || !TARGET_KINDS.includes(item.kind as ForwardTargetKind)) {
			invalid(`${field}.kind`, `Invalid ${field}.kind: ${String(item.kind)}`);
		}
		if (typeof item.path !== "string" || !item.path.startsWith("/") || item.path.includes("\n")) {
			invalid(`${field}.path`, `Invalid ${field}.path`);
		}
		const artifactDigest = item.artifactDigest;
		if (
			(item.kind === "static" && (typeof artifactDigest !== "string" || !SHA256_PATTERN.test(artifactDigest))) ||
			(item.kind !== "static" && artifactDigest !== null)
		) {
			invalid(`${field}.artifactDigest`, `Invalid ${field}.artifactDigest`);
		}
		if (aliases.has(item.alias)) invalid(`${field}.alias`, `Duplicate local alias: ${item.alias}`);
		if (ports.has(item.localPort)) invalid(`${field}.localPort`, `Duplicate local port: ${item.localPort}`);
		aliases.add(item.alias);
		ports.add(item.localPort);
		return {
			name: item.name,
			kind: item.kind as ForwardTargetKind,
			alias: item.alias,
			localPort: item.localPort,
			path: item.path,
			artifactDigest: artifactDigest as string | null,
		};
	});
	return {
		version: 1,
		id: value.id as string,
		workspace: value.workspace as string,
		stream: value.stream as string,
		host: value.host as string,
		user: value.user as string,
		remoteNu: value.remoteNu as string,
		remoteRunner: value.remoteRunner as string,
		remoteManifest: value.remoteManifest as string,
		ssh: value.ssh as string,
		sshOptions: [...(value.sshOptions as string[])],
		node: value.node as string,
		portless: value.portless as string,
		cmux: value.cmux as string,
		cmuxWorkspace: value.cmuxWorkspace as string,
		stateDir: value.stateDir as string,
		refreshMs: value.refreshMs as number,
		maxBackoffMs: value.maxBackoffMs as number,
		targets,
	};
}

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function atomicWriteJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, path);
}

function statePath(config: ForwardConfig): string {
	return `${config.stateDir}/state.json`;
}

function browserPath(config: ForwardConfig): string {
	return `${config.stateDir}/browser.json`;
}

function activeConfigPath(config: ForwardConfig): string {
	return `${config.stateDir}/active-config.json`;
}

function pidPath(config: ForwardConfig): string {
	return `${config.stateDir}/supervisor.pid`;
}

function lockPath(config: ForwardConfig): string {
	return `${config.stateDir}/supervisor.lock`;
}

function socketPath(config: ForwardConfig): string {
	return `${config.stateDir}/ssh.sock`;
}

function configDigest(config: ForwardConfig): string {
	return Bun.hash(JSON.stringify(config)).toString(16);
}

type ProcessExistence =
	| { readonly state: "alive" }
	| { readonly state: "dead"; readonly reason: string }
	| { readonly state: "unverifiable"; readonly reason: string };

type ProcessIdentityProbe =
	| { readonly state: "live"; readonly identity: ProcessIdentity }
	| { readonly state: "dead"; readonly reason: string }
	| { readonly state: "unverifiable"; readonly reason: string };

type KnownIdentityInspection =
	| { readonly state: "current" }
	| { readonly state: "gone"; readonly reason: string }
	| { readonly state: "unverifiable"; readonly reason: string };

export type SupervisorSignal = "SIGHUP" | "SIGTERM" | "SIGKILL" | "SIGUSR1";

export interface IdentitySignalSeam {
	readonly beforeRevalidation?: () => void | Promise<void>;
	readonly readCurrent?: (pid: number) => ProcessIdentity | null;
}

function systemErrorCode(problem: unknown): string | null {
	return problem instanceof Error && "code" in problem && typeof problem.code === "string" ? problem.code : null;
}

function probePidExistence(pid: number): ProcessExistence {
	if (!Number.isSafeInteger(pid) || pid <= 0) return { state: "dead", reason: `Invalid process id: ${pid}` };
	try {
		process.kill(pid, 0);
		return { state: "alive" };
	} catch (problem) {
		return systemErrorCode(problem) === "ESRCH"
			? { state: "dead", reason: `Process ${pid} does not exist` }
			: { state: "unverifiable", reason: `Could not probe process ${pid}: ${systemErrorCode(problem) ?? "unknown error"}` };
	}
}

function isPidAlive(pid: number): boolean {
	return probePidExistence(pid).state !== "dead";
}

function boundedCommandOutput(command: readonly string[]): string {
	try {
		const result = Bun.spawnSync({
			cmd: [...command],
			stdout: "pipe",
			stderr: "ignore",
			maxBuffer: 4_096,
			env: { ...process.env, LC_ALL: "C" },
		});
		return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim().replace(/\s+/g, " ") : "";
	} catch {
		return "";
	}
}

let cachedBootId = "";

function readBootId(): string {
	if (cachedBootId) return cachedBootId;
	const bootId =
		process.platform === "linux"
			? readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
			: process.platform === "darwin"
				? boundedCommandOutput(["sysctl", "-n", "kern.boottime"])
				: "";
	if (bootId) cachedBootId = bootId;
	return bootId;
}

function probeProcessIdentity(pid: number): ProcessIdentityProbe {
	const existence = probePidExistence(pid);
	if (existence.state !== "alive") return existence;
	let bootId: string;
	try {
		bootId = readBootId();
	} catch (problem) {
		return {
			state: "unverifiable",
			reason: `Could not read the boot identity for process ${pid}: ${problem instanceof Error ? problem.message : String(problem)}`,
		};
	}
	if (!bootId) return { state: "unverifiable", reason: `No boot identity is available for process ${pid}` };
	const startFingerprint = boundedCommandOutput(["ps", "-o", "lstart=", "-p", String(pid)]);
	if (!startFingerprint) {
		const after = probePidExistence(pid);
		return after.state === "dead"
			? after
			: { state: "unverifiable", reason: `Could not read the start fingerprint for process ${pid}` };
	}
	return { state: "live", identity: { bootId, pid, startFingerprint } };
}

/** Read a PID-reuse-safe identity for one live process. */
export function readProcessIdentity(pid: number): ProcessIdentity | null {
	const probe = probeProcessIdentity(pid);
	return probe.state === "live" ? probe.identity : null;
}

function sameProcessIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean {
	return left.pid === right.pid && left.bootId === right.bootId && left.startFingerprint === right.startFingerprint;
}

function inspectKnownIdentity(identity: ProcessIdentity): KnownIdentityInspection {
	const probe = probeProcessIdentity(identity.pid);
	if (probe.state === "dead") return { state: "gone", reason: probe.reason };
	if (probe.state === "unverifiable") return probe;
	return sameProcessIdentity(probe.identity, identity)
		? { state: "current" }
		: { state: "gone", reason: `Process ${identity.pid} no longer has the recorded identity` };
}


/**
 * Bun exposes kill(2), but not Linux pidfd_open/pidfd_send_signal. Keep the full-tuple read adjacent
 * to kill(2), accept no separate PID argument, and make the unavoidable read-to-syscall boundary explicit.
 */
export async function signalProcessIdentity(
	forwardId: string,
	identity: ProcessIdentity,
	signal: SupervisorSignal,
	seam: IdentitySignalSeam = {},
): Promise<void> {
	await seam.beforeRevalidation?.();
	const inspection = seam.readCurrent
		? (() => {
				const current = seam.readCurrent(identity.pid);
				return current !== null && sameProcessIdentity(current, identity)
					? ({ state: "current" } as const)
					: ({ state: "gone", reason: `Process ${identity.pid} no longer has the recorded identity` } as const);
			})()
		: inspectKnownIdentity(identity);
	if (inspection.state === "unverifiable") {
		throw new SupervisorIdentityUnavailable(
			forwardId,
			identity.pid,
			inspection.reason,
			`Refusing ${signal}: supervisor identity could not be revalidated`,
		);
	}
	if (inspection.state === "gone") {
		throw new StaleSupervisor(forwardId, identity.pid, `Refusing ${signal}: ${inspection.reason}`);
	}
	try {
		process.kill(identity.pid, signal);
	} catch (problem) {
		if (systemErrorCode(problem) === "ESRCH") {
			throw new StaleSupervisor(forwardId, identity.pid, `Supervisor exited at the ${signal} signal seam`);
		}
		throw new SupervisorIdentityUnavailable(
			forwardId,
			identity.pid,
			systemErrorCode(problem) ?? (problem instanceof Error ? problem.message : String(problem)),
			`Could not signal the identity-validated supervisor with ${signal}`,
		);
	}
}

function decodeProcessIdentity(value: unknown): ProcessIdentity | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	return typeof record.bootId === "string" &&
		record.bootId.length > 0 &&
		Number.isSafeInteger(record.pid) &&
		Number(record.pid) > 0 &&
		typeof record.startFingerprint === "string" &&
		record.startFingerprint.length > 0
		? { bootId: record.bootId, pid: Number(record.pid), startFingerprint: record.startFingerprint }
		: null;
}

/** Decode a tunnel child record written by a previous — possibly crashed — supervisor incarnation. */
export function decodeTunnelChildRecord(value: unknown): TunnelChildRecord | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const identity = decodeProcessIdentity(record);
	if (
		identity === null ||
		record.version !== 1 ||
		typeof record.controlSocket !== "string" ||
		!record.controlSocket.startsWith("/") ||
		record.controlSocket.includes("\n") ||
		!Array.isArray(record.localPorts) ||
		record.localPorts.some((port) => !Number.isInteger(port) || Number(port) < 1 || Number(port) > 65_535)
	) {
		return null;
	}
	return {
		version: 1,
		pid: identity.pid,
		bootId: identity.bootId,
		startFingerprint: identity.startFingerprint,
		controlSocket: record.controlSocket,
		localPorts: [...(record.localPorts as number[])],
	};
}

export interface CappedStreamResult {
	readonly text: string;
	readonly truncated: boolean;
	readonly keptBytes: number;
	readonly totalBytes: number;
}

// Kept local because this standalone script cannot import packages/utils on remote sparse checkouts.
export async function readCapped(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
	signal?: AbortSignal,
): Promise<CappedStreamResult> {
	const cap = Math.max(0, maxBytes);
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let keptBytes = 0;
	let totalBytes = 0;
	let text = "";
	const cancel = (): void => {
		void reader.cancel("bounded command stream drain expired").catch(() => {});
	};
	signal?.addEventListener("abort", cancel, { once: true });
	if (signal?.aborted) cancel();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			totalBytes += value.byteLength;
			const remaining = cap - keptBytes;
			if (remaining <= 0) continue;
			const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
			keptBytes += slice.byteLength;
			text += decoder.decode(slice, { stream: true });
		}
		return { text: text + decoder.decode(), truncated: totalBytes > keptBytes, keptBytes, totalBytes };
	} finally {
		signal?.removeEventListener("abort", cancel);
		reader.releaseLock();
	}
}

function withCappedStreamNotice(result: CappedStreamResult, label: string): string {
	return result.truncated
		? `${result.text}\n[${label} truncated: kept ${result.keptBytes} of ${result.totalBytes} bytes]`
		: result.text;
}

const STDOUT_CAP_BYTES = 8 * 1024 * 1024;
const STDERR_CAP_BYTES = 64 * 1024;

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

const COMMAND_TIMEOUT_MS = 15_000;
const STREAM_DRAIN_TIMEOUT_MS = 500;

async function settleCapped(
	result: Promise<CappedStreamResult>,
	controller: AbortController,
): Promise<CappedStreamResult> {
	const timeout = Symbol("stream-timeout");
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<typeof timeout>((resolveDeadline) => {
		timer = setTimeout(() => resolveDeadline(timeout), STREAM_DRAIN_TIMEOUT_MS);
	});
	const settled = await Promise.race([result, deadline]);
	if (timer !== undefined) clearTimeout(timer);
	if (settled !== timeout) return settled;
	controller.abort();
	return await result;
}

async function run(command: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
	let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	} catch (problem) {
		return { exitCode: 127, stdout: "", stderr: problem instanceof Error ? problem.message : String(problem), timedOut: false };
	}
	const stdoutController = new AbortController();
	const stderrController = new AbortController();
	const stdoutRead = readCapped(child.stdout, STDOUT_CAP_BYTES, stdoutController.signal);
	const stderrRead = readCapped(child.stderr, STDERR_CAP_BYTES, stderrController.signal);
	const timeout = Symbol("command-timeout");
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<typeof timeout>((resolveDeadline) => {
		timer = setTimeout(() => resolveDeadline(timeout), timeoutMs);
	});
	const completion = await Promise.race([child.exited, deadline]);
	if (timer !== undefined) clearTimeout(timer);
	const timedOut = completion === timeout;
	if (timedOut && child.exitCode === null) {
		child.kill("SIGTERM");
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const killDeadline = new Promise<false>((resolveDeadline) => {
			killTimer = setTimeout(() => resolveDeadline(false), 250);
		});
		const stopped = await Promise.race([child.exited.then(() => true), killDeadline]);
		if (killTimer !== undefined) clearTimeout(killTimer);
		if (!stopped && child.exitCode === null) child.kill("SIGKILL");
	}
	const exitCode = await child.exited;
	const [stdout, stderr] = await Promise.all([
		settleCapped(stdoutRead, stdoutController),
		settleCapped(stderrRead, stderrController),
	]);
	return {
		exitCode,
		stdout: withCappedStreamNotice(stdout, "stdout"),
		stderr: withCappedStreamNotice(stderr, "stderr"),
		timedOut,
	};
}

/**
 * The spawned process must *be* the master, not a launcher for one. A user `ControlPersist` setting
 * makes `ssh -M -N` fork the master into the background and exit 0, which strands a detached process
 * holding the review ports under a PID the supervisor never recorded. Pin it off for this child.
 */
export function buildSshForwardArguments(config: ForwardConfig, targets: ResolvedForwardTarget[]): string[] {
	const forwards = targets.flatMap((target) => ["-L", `127.0.0.1:${target.localPort}:127.0.0.1:${target.remotePort}`]);
	return [
		...config.sshOptions,
		"-M",
		"-S",
		socketPath(config),
		"-o",
		"ControlPersist=no",
		"-o",
		"ExitOnForwardFailure=yes",
		"-N",
		...forwards,
		`${config.user}@${config.host}`,
	];
}

export function buildCmuxBrowserCommands(config: ForwardConfig, targets: ResolvedForwardTarget[]): string[][] {
	return targets.map((target) => [
		config.cmux,
		"browser",
		"open",
		target.url,
		"--workspace",
		config.cmuxWorkspace,
		"--focus",
		"false",
	]);
}

export function parsePortlessRoutes(output: string): Map<string, PortlessRoute> {
	const routes = new Map<string, PortlessRoute>();
	for (const line of output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").split("\n")) {
		const match = PORTLESS_ROUTE.exec(line);
		if (!match) continue;
		routes.set(match[1], { alias: match[1], port: Number(match[2]), kind: match[3] === "alias" ? "alias" : "process" });
	}
	return routes;
}

/**
 * The remote runner reports one record per catalog review target. Portless routes, direct ports,
 * and bounded static artifact servers all collapse to `remotePort` here, so every kind is
 * forwarded, published, and opened by exactly one downstream code path.
 */
export class SshTargetResolver implements TargetResolver {
	readonly timeoutMs: number;

	constructor(timeoutMs = COMMAND_TIMEOUT_MS) {
		this.timeoutMs = timeoutMs;
	}

	async resolveTargets(config: ForwardConfig): Promise<TargetResolution> {
		const result = await run(
			[
				config.ssh,
				...config.sshOptions,
				`${config.user}@${config.host}`,
				config.remoteNu,
				"--no-config-file",
				config.remoteRunner,
				"_review",
				config.stream,
				"--workspace",
				config.workspace,
				"--catalog",
				config.remoteManifest,
			],
			this.timeoutMs,
		);
		if (result.timedOut || result.exitCode === SSH_UNREACHABLE_EXIT) {
			throw new HostUnreachable(
				config.host,
				config.user,
				result.exitCode,
				result.timedOut
					? `SSH target resolution timed out after ${this.timeoutMs}ms`
					: `SSH could not reach ${config.user}@${config.host}: ${result.stderr.trim() || "no transport detail"}`,
			);
		}
		if (result.exitCode !== 0) {
			throw new BackendAbsent(
				config.stream,
				"portless",
				`Remote review resolution failed (${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
			);
		}
		let decoded: unknown;
		try {
			decoded = JSON.parse(result.stdout);
		} catch {
			throw new BackendAbsent(config.stream, "portless", "Remote review target response was not JSON");
		}
		if (!Array.isArray(decoded)) {
			throw new BackendAbsent(config.stream, "portless", "Remote review target response was not a target list");
		}
		const available: ResolvedForwardTarget[] = [];
		const degradations: TargetDegradation[] = [];
		for (const expected of config.targets) {
			const matches = decoded.filter(
				(candidate) =>
					candidate !== null &&
					typeof candidate === "object" &&
					!Array.isArray(candidate) &&
					(candidate as Record<string, unknown>).name === expected.name,
			);
			if (matches.length !== 1) {
				degradations.push({
					target: expected,
					error: new BackendAbsent(expected.name, expected.kind, `Expected exactly one remote target: ${expected.name}`).detail(),
				});
				continue;
			}
			const candidate = matches[0] as Record<string, unknown>;
			const metadataMatches =
				candidate.name === expected.name &&
				candidate.kind === expected.kind &&
				candidate.alias === expected.alias &&
				candidate.path === expected.path &&
				candidate.artifactDigest === expected.artifactDigest;
			if (!metadataMatches || (candidate.status !== "healthy" && candidate.status !== "degraded")) {
				degradations.push({
					target: expected,
					error: new BackendAbsent(
						expected.name,
						expected.kind,
						`Remote target metadata mismatch for ${expected.name}`,
					).detail(),
				});
				continue;
			}
			if (candidate.status === "degraded") {
				const remoteError = candidate.error;
				const detail =
					remoteError !== null &&
					typeof remoteError === "object" &&
					!Array.isArray(remoteError) &&
					typeof (remoteError as Record<string, unknown>)._tag === "string" &&
					FORWARD_ERROR_TAGS.includes((remoteError as Record<string, unknown>)._tag as ForwardErrorTag) &&
					typeof (remoteError as Record<string, unknown>).message === "string"
						? ({ ...(remoteError as ForwardErrorDetail) } as ForwardErrorDetail)
						: new BackendAbsent(expected.name, expected.kind, `Remote target is degraded: ${expected.name}`).detail();
				degradations.push({ target: expected, error: detail });
				continue;
			}
			const remotePort = candidate.remotePort;
			if (!Number.isInteger(remotePort) || Number(remotePort) < 1 || Number(remotePort) > 65_535) {
				degradations.push({
					target: expected,
					error: new BackendAbsent(
						expected.name,
						expected.kind,
						`Remote backend port is absent for ${expected.name}: ${String(remotePort)}`,
					).detail(),
				});
				continue;
			}
			available.push({
				...expected,
				remotePort: remotePort as number,
				url: `https://${expected.alias}.localhost${expected.path}`,
			});
		}
		return { available, degradations };
	}
}

export async function assertLoopbackPortFree(alias: string, port: number): Promise<void> {
	let listener: { stop(closeActiveConnections?: boolean): void } | null = null;
	try {
		listener = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } });
	} catch (problem) {
		const message = problem instanceof Error ? problem.message : String(problem);
		throw new PortCollision(alias, port, `Local review port is occupied: ${port}: ${message}`);
	} finally {
		listener?.stop(true);
	}
}

async function probeLoopbackPort(port: number, timeoutMs = 500): Promise<boolean> {
	return await new Promise<boolean>((resolveProbe) => {
		let settled = false;
		let connection: { end(): void } | null = null;
		let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
		const finish = (healthy: boolean): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (stabilityTimer) clearTimeout(stabilityTimer);
			connection?.end();
			resolveProbe(healthy);
		};
		const timer = setTimeout(() => finish(false), timeoutMs);
		timer.unref();
		void Bun.connect({
			hostname: "127.0.0.1",
			port,
			socket: {
				open(socket) {
					connection = socket;
					// SSH accepts locally before its remote connect completes. Surviving this window proves
					// the forwarded channel did not immediately close on a remote ECONNREFUSED.
					stabilityTimer = setTimeout(() => finish(true), 150);
					stabilityTimer.unref();
				},
				data() {
					finish(true);
				},
				error() {
					finish(false);
				},
				close() {
					finish(false);
				},
				connectError() {
					finish(false);
				},
			},
		}).catch(() => finish(false));
	});
}

/**
 * Probe every forwarded backend independently. One dead backend must never speak for the set, so
 * this reports which targets answer and why the others do not instead of failing the whole tunnel.
 */
async function probeBackends(targets: ResolvedForwardTarget[]): Promise<TunnelReachability> {
	const answered = await Promise.all(targets.map((target) => probeLoopbackPort(target.localPort)));
	const live: ResolvedForwardTarget[] = [];
	const dead: UnreachableTarget[] = [];
	for (let index = 0; index < targets.length; index += 1) {
		const target = targets[index];
		if (answered[index]) live.push(target);
		else {
			dead.push({
				target,
				error: new BackendAbsent(
					target.name,
					target.kind,
					`Forwarded backend is not accepting TCP connections: ${target.name} (${target.localPort})`,
				),
			});
		}
	}
	return { live, dead };
}

/** Bounds for the readiness wait and for proving a reaped child actually released its ports. */
export interface TunnelBounds {
	readyAttempts: number;
	readyIntervalMs: number;
	killGraceMs: number;
	reapAttempts: number;
	reapIntervalMs: number;
}

export const DEFAULT_TUNNEL_BOUNDS: TunnelBounds = {
	readyAttempts: 60,
	readyIntervalMs: 100,
	killGraceMs: 500,
	reapAttempts: 40,
	reapIntervalMs: 50,
};

interface TerminableChild {
	readonly pid: number;
	readonly exitCode: number | null;
	readonly exited: Promise<number>;
	kill(signal: "SIGTERM" | "SIGKILL"): void;
}

/** SIGTERM, then SIGKILL once the grace window expires. Returns only after the child is reaped. */
async function terminateChild(child: TerminableChild, graceMs: number): Promise<void> {
	if (child.exitCode === null) child.kill("SIGTERM");
	const stopped = await Promise.race([child.exited.then(() => true), Bun.sleep(graceMs).then(() => false)]);
	if (!stopped && child.exitCode === null) child.kill("SIGKILL");
	await child.exited;
}

export class SshTunnelTransport implements TunnelTransport {
	readonly bounds: TunnelBounds;

	constructor(bounds: TunnelBounds = DEFAULT_TUNNEL_BOUNDS) {
		this.bounds = bounds;
	}

	private async closeMaster(config: ForwardConfig, socket: string): Promise<void> {
		const destination = `${config.user}@${config.host}`;
		const check = await run([config.ssh, ...config.sshOptions, "-S", socket, "-O", "check", destination]);
		if (check.timedOut) {
			throw new HostUnreachable(config.host, config.user, check.exitCode, "SSH control-master check timed out");
		}
		if (check.exitCode === 0) {
			const closed = await run([config.ssh, ...config.sshOptions, "-S", socket, "-O", "exit", destination]);
			if (closed.timedOut) {
				throw new HostUnreachable(config.host, config.user, closed.exitCode, "SSH control-master exit timed out");
			}
		}
		rmSync(socket, { force: true });
	}

	async cleanupStale(config: ForwardConfig): Promise<void> {
		// No state directory means no control master was ever bound here, so there is nothing to sweep.
		if (!existsSync(config.stateDir)) return;
		const socket = socketPath(config);
		if (await Bun.file(socket).exists()) await this.closeMaster(config, socket);
		// Masters orphaned by an earlier crash keep the loopback ports bound; sweep them too.
		const orphans = new Bun.Glob("ssh.sock*").scanSync({ cwd: config.stateDir, onlyFiles: false });
		for (const entry of orphans) {
			const orphan = join(config.stateDir, entry);
			if (orphan === socket) continue;
			await this.closeMaster(config, orphan);
		}
	}

	/** Only a socket inside this forward's state directory is removable; anything else is left alone. */
	private ownedSocket(config: ForwardConfig, record: TunnelChildRecord): string | null {
		return record.controlSocket === socketPath(config) || record.controlSocket.startsWith(`${config.stateDir}/`)
			? record.controlSocket
			: null;
	}

	private async signalUntilGone(config: ForwardConfig, identity: ProcessIdentity): Promise<void> {
		for (const signal of ["SIGTERM", "SIGKILL"] as const) {
			try {
				await signalProcessIdentity(config.id, identity, signal);
			} catch (problem) {
				// A stale identity at the signal seam is proof the recorded child is already gone.
				if (problem instanceof StaleSupervisor) return;
				throw problem;
			}
			for (let attempt = 0; attempt < this.bounds.reapAttempts; attempt += 1) {
				const inspection = inspectKnownIdentity(identity);
				if (inspection.state === "gone") return;
				if (inspection.state === "unverifiable") {
					throw new SupervisorIdentityUnavailable(
						config.id,
						identity.pid,
						inspection.reason,
						"Tunnel child identity became unverifiable while waiting for it to exit",
					);
				}
				await Bun.sleep(this.bounds.reapIntervalMs);
			}
		}
		throw new SupervisorIdentityUnavailable(
			config.id,
			identity.pid,
			"Tunnel child remained live after SIGKILL",
			"Refusing to report review ports released while the child may still hold them",
		);
	}

	private async assertPortsReleased(config: ForwardConfig, record: TunnelChildRecord): Promise<void> {
		for (const port of record.localPorts) {
			const alias = config.targets.find((target) => target.localPort === port)?.alias ?? config.id;
			let failure: unknown = null;
			for (let attempt = 0; attempt < this.bounds.reapAttempts; attempt += 1) {
				try {
					await assertLoopbackPortFree(alias, port);
					failure = null;
					break;
				} catch (problem) {
					failure = problem;
					await Bun.sleep(this.bounds.reapIntervalMs);
				}
			}
			if (failure !== null) throw failure;
		}
	}

	async reap(config: ForwardConfig, record: TunnelChildRecord): Promise<void> {
		const identity: ProcessIdentity = {
			bootId: record.bootId,
			pid: record.pid,
			startFingerprint: record.startFingerprint,
		};
		const inspection = inspectKnownIdentity(identity);
		if (inspection.state === "unverifiable") {
			throw new SupervisorIdentityUnavailable(
				config.id,
				record.pid,
				inspection.reason,
				"Refusing to signal a tunnel child whose recorded identity could not be revalidated",
			);
		}
		if (inspection.state === "current") await this.signalUntilGone(config, identity);
		const socket = this.ownedSocket(config, record);
		if (socket !== null && existsSync(socket)) await this.closeMaster(config, socket);
		await this.assertPortsReleased(config, record);
	}

	async spawn(config: ForwardConfig, targets: ResolvedForwardTarget[]): Promise<PendingTunnel> {
		await this.cleanupStale(config);
		for (const target of targets) await assertLoopbackPortFree(target.alias, target.localPort);
		const child = Bun.spawn([config.ssh, ...buildSshForwardArguments(config, targets)], {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "pipe",
		});
		const stderrController = new AbortController();
		const stderrPromise = readCapped(child.stderr, STDERR_CAP_BYTES, stderrController.signal);
		const socket = socketPath(config);
		const drain = async (): Promise<CappedStreamResult> => await settleCapped(stderrPromise, stderrController);
		const identity = readProcessIdentity(child.pid);
		if (identity === null) {
			// A child no successor could fingerprint is a child no successor could reap, so it must not
			// outlive this call: end it here rather than publish an unownable tunnel.
			await terminateChild(child, this.bounds.killGraceMs);
			const stderr = await drain();
			rmSync(socket, { force: true });
			throw new HostUnreachable(
				config.host,
				config.user,
				child.exitCode ?? SSH_UNREACHABLE_EXIT,
				`SSH tunnel could not be fingerprinted for durable ownership: ${withCappedStreamNotice(stderr, "stderr").trim() || "no transport detail"}`,
			);
		}
		const record: TunnelChildRecord = {
			version: 1,
			pid: child.pid,
			bootId: identity.bootId,
			startFingerprint: identity.startFingerprint,
			controlSocket: socket,
			localPorts: targets.map((target) => target.localPort),
		};
		return {
			record,
			ready: async (): Promise<ReadyTunnel> => await this.awaitReady(config, targets, child, drain),
			abort: async (): Promise<void> => {
				await terminateChild(child, this.bounds.killGraceMs);
				await drain();
				await this.reap(config, record);
			},
		};
	}

	/**
	 * Readiness is a transport question, not a backend one: the child is ready once its control
	 * master answers, and the reachability sample taken at that moment decides which targets the
	 * caller may publish. A set with nothing live is still returned — the caller owns the child and
	 * decides whether to keep or release it.
	 */
	private async awaitReady(
		config: ForwardConfig,
		targets: ResolvedForwardTarget[],
		child: TerminableChild,
		drain: () => Promise<CappedStreamResult>,
	): Promise<ReadyTunnel> {
		const destination = `${config.user}@${config.host}`;
		const socket = socketPath(config);
		const bounds = this.bounds;
		let sample: TunnelReachability | null = null;
		for (let attempt = 0; attempt < bounds.readyAttempts; attempt += 1) {
			if (child.exitCode !== null) break;
			const check = await run([config.ssh, ...config.sshOptions, "-S", socket, "-O", "check", destination]);
			if (check.timedOut) {
				await terminateChild(child, bounds.killGraceMs);
				await drain();
				throw new HostUnreachable(config.host, config.user, check.exitCode, "SSH tunnel health check timed out");
			}
			if (check.exitCode === 0) {
				sample = await probeBackends(targets);
				if (sample.live.length > 0) break;
			}
			await Bun.sleep(bounds.readyIntervalMs);
		}
		if (sample === null || child.exitCode !== null) {
			await terminateChild(child, bounds.killGraceMs);
			const stderr = await drain();
			throw new HostUnreachable(
				config.host,
				config.user,
				child.exitCode ?? SSH_UNREACHABLE_EXIT,
				`SSH tunnel did not become healthy: ${withCappedStreamNotice(stderr, "stderr").trim() || "no transport detail"}`,
			);
		}
		return {
			handle: {
				pid: child.pid,
				async probe(): Promise<TunnelProbe> {
					if (child.exitCode !== null) return { transport: false, live: [], dead: [] };
					const check = await run([config.ssh, ...config.sshOptions, "-S", socket, "-O", "check", destination]);
					if (check.timedOut) {
						throw new HostUnreachable(config.host, config.user, check.exitCode, "SSH tunnel health check timed out");
					}
					if (check.exitCode !== 0) return { transport: false, live: [], dead: [] };
					return { transport: true, ...(await probeBackends(targets)) };
				},
				async stop(): Promise<void> {
					const closed = await run([config.ssh, ...config.sshOptions, "-S", socket, "-O", "exit", destination]);
					await terminateChild(child, bounds.killGraceMs);
					await drain();
					rmSync(socket, { force: true });
					if (closed.timedOut) {
						throw new HostUnreachable(config.host, config.user, closed.exitCode, "SSH tunnel shutdown timed out");
					}
				},
			},
			live: sample.live,
			dead: sample.dead,
		};
	}
}

export class AliasLeaseStore {
	readonly directory: string;

	constructor(directory: string) {
		this.directory = directory;
	}

	leasePath(alias: string): string {
		assertSafeId(alias, "alias");
		return `${this.directory}/${alias}.json`;
	}

	read(alias: string): AliasLease | null {
		const path = this.leasePath(alias);
		try {
			const raw = readJson(path);
			assertRecord(raw, "lease");
			if (
				raw.version !== 1 ||
				typeof raw.forwardId !== "string" ||
				typeof raw.pid !== "number" ||
				raw.alias !== alias ||
				typeof raw.localPort !== "number" ||
				typeof raw.configPath !== "string"
			) {
				invalid("lease", `Invalid alias lease: ${alias}`);
			}
			return raw as unknown as AliasLease;
		} catch (problem) {
			if (problem instanceof Error && "code" in problem && problem.code === "ENOENT") return null;
			throw problem;
		}
	}

	acquire(lease: AliasLease): void {
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const path = this.leasePath(lease.alias);
		let descriptor: number;
		try {
			descriptor = openSync(path, "wx", 0o600);
		} catch (problem) {
			if (!(problem instanceof Error) || !("code" in problem) || problem.code !== "EEXIST") throw problem;
			const current = this.read(lease.alias);
			if (current === null) {
				rmSync(path, { force: true });
				descriptor = openSync(path, "wx", 0o600);
			} else if (current.forwardId !== lease.forwardId || isPidAlive(current.pid)) {
				throw new LeaseHeldByAnotherOwner(
					lease.alias,
					lease.forwardId,
					current.forwardId,
					current.pid,
					`Alias ${lease.alias} is leased by ${current.forwardId} (pid ${current.pid})`,
				);
			} else {
				rmSync(path, { force: true });
				descriptor = openSync(path, "wx", 0o600);
			}
		}
		try {
			writeFileSync(descriptor, `${JSON.stringify(lease, null, 2)}\n`);
		} finally {
			closeSync(descriptor);
		}
	}

	release(alias: string, forwardId: string, pid: number): void {
		const current = this.read(alias);
		if (current?.forwardId === forwardId && current.pid === pid) rmSync(this.leasePath(alias), { force: true });
	}
}

export class PortlessRoutePublisher implements RoutePublisher {
	readonly leases: AliasLeaseStore;
	readonly configPath: string;
	readonly timeoutMs: number;

	constructor(config: ForwardConfig, configPath: string, timeoutMs = COMMAND_TIMEOUT_MS) {
		this.leases = new AliasLeaseStore(`${dirname(config.stateDir)}/aliases`);
		this.configPath = configPath;
		this.timeoutMs = timeoutMs;
	}

	private expectedLease(config: ForwardConfig, target: ResolvedForwardTarget): AliasLease {
		return {
			version: 1,
			forwardId: config.id,
			pid: process.pid,
			alias: target.alias,
			localPort: target.localPort,
			configPath: this.configPath,
		};
	}

	private exactLease(left: AliasLease | null, right: AliasLease): boolean {
		return (
			left !== null &&
			left.version === right.version &&
			left.forwardId === right.forwardId &&
			left.pid === right.pid &&
			left.alias === right.alias &&
			left.localPort === right.localPort &&
			left.configPath === right.configPath
		);
	}

	private async command(config: ForwardConfig, target: Pick<ResolvedForwardTarget, "alias" | "localPort">, args: string[]): Promise<CommandResult> {
		const result = await run([config.node, config.portless, ...args], this.timeoutMs);
		if (result.timedOut) {
			throw new PortCollision(target.alias, target.localPort, `Portless command timed out after ${this.timeoutMs}ms`);
		}
		return result;
	}

	private async routes(config: ForwardConfig): Promise<Map<string, PortlessRoute>> {
		const target = { alias: config.targets[0]?.alias ?? config.id, localPort: config.targets[0]?.localPort ?? 0 };
		const result = await this.command(config, target, ["list"]);
		if (result.exitCode !== 0) {
			throw new PortCollision(target.alias, target.localPort, `Could not list local Portless routes (${result.exitCode}): ${result.stderr.trim()}`);
		}
		return parsePortlessRoutes(result.stdout);
	}

	async cleanupStale(config: ForwardConfig): Promise<void> {
		const routes = await this.routes(config);
		for (const target of config.targets) {
			const lease = this.leases.read(target.alias);
			if (!lease || lease.forwardId !== config.id || isPidAlive(lease.pid)) continue;
			const route = routes.get(target.alias);
			if (route && (route.kind !== "alias" || route.port !== lease.localPort)) {
				throw new PortCollision(target.alias, lease.localPort, `Stale local route changed ownership: ${target.alias}`);
			}
			if (route) {
				const removal = await this.command(config, target as ResolvedForwardTarget, ["alias", "--remove", target.alias]);
				if (removal.exitCode !== 0) {
					throw new PortCollision(target.alias, lease.localPort, `Could not remove stale local route: ${target.alias}`);
				}
			}
			rmSync(this.leases.leasePath(target.alias), { force: true });
		}
	}

	async publish(config: ForwardConfig, targets: ResolvedForwardTarget[]): Promise<void> {
		await this.cleanupStale(config);
		const routes = await this.routes(config);
		for (const target of targets) {
			if (routes.has(target.alias)) {
				throw new PortCollision(target.alias, target.localPort, `Local route collision: ${target.alias}`);
			}
		}
		const acquired: ResolvedForwardTarget[] = [];
		try {
			for (const target of targets) {
				this.leases.acquire(this.expectedLease(config, target));
				acquired.push(target);
			}
			for (const target of targets) {
				const published = await this.command(config, target, ["alias", target.alias, String(target.localPort)]);
				if (published.exitCode !== 0) {
					throw new PortCollision(
						target.alias,
						target.localPort,
						`Could not publish local route ${target.alias}: ${published.stderr.trim()}`,
					);
				}
			}
		} catch (problem) {
			await this.unpublish(config, acquired);
			throw problem;
		}
	}

	async reconcileHealthy(config: ForwardConfig, targets: ResolvedForwardTarget[]): Promise<void> {
		const routes = await this.routes(config);
		for (const target of targets) {
			const expected = this.expectedLease(config, target);
			const lease = this.leases.read(target.alias);
			if (!this.exactLease(lease, expected)) {
				throw new LeaseHeldByAnotherOwner(
					target.alias,
					config.id,
					lease?.forwardId ?? "<none>",
					lease?.pid ?? 0,
					`Alias lease ownership changed while reconciling ${target.alias}`,
				);
			}
			const route = routes.get(target.alias);
			if (route && (route.kind !== "alias" || route.port !== target.localPort)) {
				throw new PortCollision(target.alias, target.localPort, `Local route ownership changed: ${target.alias}`);
			}
			if (!route) {
				const published = await this.command(config, target, ["alias", target.alias, String(target.localPort)]);
				if (published.exitCode !== 0) {
					throw new PortCollision(target.alias, target.localPort, `Could not restore local route: ${target.alias}`);
				}
			}
		}
	}

	async unpublish(config: ForwardConfig, targets: ResolvedForwardTarget[]): Promise<void> {
		const routes = await this.routes(config);
		let failure: PortCollision | LeaseHeldByAnotherOwner | null = null;
		for (const target of targets) {
			const expected = this.expectedLease(config, target);
			const lease = this.leases.read(target.alias);
			const route = routes.get(target.alias);
			if (lease === null && route === undefined) continue;
			if (!this.exactLease(lease, expected)) {
				failure ??= new LeaseHeldByAnotherOwner(
					target.alias,
					config.id,
					lease?.forwardId ?? "<none>",
					lease?.pid ?? 0,
					`Alias lease ownership changed while releasing ${target.alias}`,
				);
				continue;
			}
			if (route && (route.kind !== "alias" || route.port !== target.localPort)) {
				failure ??= new PortCollision(target.alias, target.localPort, `Local route ownership changed: ${target.alias}`);
				continue;
			}
			if (route) {
				const removal = await this.command(config, target, ["alias", "--remove", target.alias]);
				if (removal.exitCode !== 0) {
					failure ??= new PortCollision(target.alias, target.localPort, `Could not remove local route: ${target.alias}`);
					continue;
				}
			}
			this.leases.release(target.alias, config.id, process.pid);
		}
		if (failure) throw failure;
	}
}

function sameBackends(left: ResolvedForwardTarget[], right: ResolvedForwardTarget[]): boolean {
	return (
		left.length === right.length &&
		left.every((target, index) => target.name === right[index]?.name && target.remotePort === right[index]?.remotePort)
	);
}

export class ForwardSupervisor {
	readonly config: ForwardConfig;
	readonly dependencies: SupervisorDependencies;
	readonly supervisorIdentity: ProcessIdentity;
	readonly ownerToken: string;
	private tunnel: TunnelHandle | null = null;
	private pending: PendingTunnel | null = null;
	/** Durable identity of the child behind `pending` or `tunnel`; outlives both until it is reaped. */
	private childRecord: TunnelChildRecord | null = null;
	/** Published — and therefore openable — targets: the reachable subset of `forwarded`. */
	private targets: ResolvedForwardTarget[] = [];
	/** Every target the current child forwards, reachable or not; a dead one stays bound for recovery. */
	private forwarded: ResolvedForwardTarget[] = [];
	private pendingCleanup = new Map<string, ResolvedForwardTarget>();
	private degradations: TargetDegradation[] = [];
	private attempt = 0;
	private lastError: ForwardErrorDetail | null = null;

	constructor(config: ForwardConfig, dependencies: SupervisorDependencies, startupOwner?: SupervisorOwnerRecord | string) {
		this.config = config;
		this.dependencies = dependencies;
		const ownerToken =
			typeof startupOwner === "string"
				? startupOwner
				: startupOwner === undefined
					? crypto.randomUUID()
					: decodeSupervisorOwnerRecord(startupOwner)?.token;
		if (ownerToken === undefined || !UUID_PATTERN.test(ownerToken)) {
			throw new SupervisorIdentityUnavailable(
				config.id,
				process.pid,
				"Supervisor startup owner record or token is invalid",
				"Refusing to publish state without a valid ownership incarnation token",
			);
		}
		this.ownerToken = ownerToken;
		const identity = readProcessIdentity(process.pid);
		if (identity === null) {
			throw new SupervisorIdentityUnavailable(
				config.id,
				process.pid,
				"Could not fingerprint the forward supervisor process",
				"Refusing to publish a supervisor identity that cannot be verified",
			);
		}
		this.supervisorIdentity = identity;
	}

	private snapshot(phase: ForwardPhase, running = true): ForwardState {
		return {
			version: 1,
			id: this.config.id,
			pid: process.pid,
			supervisorIdentity: running ? this.supervisorIdentity : null,
			ownerToken: running ? this.ownerToken : null,
			running,
			phase,
			attempt: this.attempt,
			configDigest: configDigest(this.config),
			updatedAt: new Date().toISOString(),
			lastError: this.lastError,
			targets: this.targets,
			degradations: this.degradations,
			tunnel: this.childRecord,
		};
	}

	private persist(phase: ForwardPhase, running = true): ForwardState {
		const state = this.snapshot(phase, running);
		atomicWriteJson(statePath(this.config), state);
		return state;
	}

	recordStarting(): ForwardState {
		return this.persist("starting");
	}

	private async retryPendingCleanup(): Promise<void> {
		if (this.pendingCleanup.size === 0) return;
		const pending = [...this.pendingCleanup.values()];
		await this.dependencies.routes.unpublish(this.config, pending);
		for (const target of pending) this.pendingCleanup.delete(target.alias);
	}

	/** True while this supervisor still holds a tunnel child, a published route, or an unreaped record. */
	private owns(): boolean {
		return this.tunnel !== null || this.pending !== null || this.childRecord !== null || this.targets.length > 0;
	}

	/** Reap a record left over from an abort that could not prove the child gone on an earlier pass. */
	private async retryOrphanedChild(): Promise<void> {
		if (this.childRecord === null || this.pending !== null || this.tunnel !== null) return;
		await this.dependencies.transport.reap(this.config, this.childRecord);
		this.childRecord = null;
	}

	/**
	 * Release whichever tunnel child this supervisor owns. The identity record stays published until
	 * the process is provably gone, so a later reconcile — or a successor after this process is
	 * killed mid-flight — can still reap whatever is holding the review ports.
	 */
	private async releaseChild(): Promise<void> {
		const pending = this.pending;
		const tunnel = this.tunnel;
		this.pending = null;
		this.tunnel = null;
		let failure: unknown;
		try {
			if (pending !== null) await pending.abort();
			else if (tunnel !== null) await tunnel.stop();
			else if (this.childRecord !== null) await this.dependencies.transport.reap(this.config, this.childRecord);
			this.childRecord = null;
			return;
		} catch (problem) {
			failure = problem;
		}
		if (this.childRecord !== null) {
			try {
				await this.dependencies.transport.reap(this.config, this.childRecord);
				this.childRecord = null;
			} catch {
				// Subordinate to the cause below; the identity record stays published for a successor.
			}
		}
		throw failure;
	}

	private async deactivate(): Promise<void> {
		for (const target of this.targets) this.pendingCleanup.set(target.alias, target);
		this.targets = [];
		this.forwarded = [];
		let failure: unknown = null;
		try {
			await this.retryPendingCleanup();
		} catch (problem) {
			failure = problem;
		}
		try {
			await this.releaseChild();
		} catch (problem) {
			failure ??= problem;
		}
		if (failure !== null) throw failure;
	}

	/**
	 * Move the published set to exactly the reachable targets. A target that just died releases its
	 * own alias and route, and one that just came back is published on its own — neither transition
	 * touches the targets that did not move, and neither restarts the tunnel child.
	 */
	private async retainLiveRoutes(live: ResolvedForwardTarget[]): Promise<void> {
		const reachable = new Set(live.map((target) => target.alias));
		const stale = this.targets.filter((target) => !reachable.has(target.alias));
		if (stale.length > 0) {
			for (const target of stale) this.pendingCleanup.set(target.alias, target);
			this.targets = this.targets.filter((target) => reachable.has(target.alias));
			await this.retryPendingCleanup();
		}
		const published = new Set(this.targets.map((target) => target.alias));
		const held = live.filter((target) => published.has(target.alias));
		const restored = live.filter((target) => !published.has(target.alias));
		if (held.length > 0) await this.dependencies.routes.reconcileHealthy(this.config, held);
		if (restored.length > 0) await this.dependencies.routes.publish(this.config, restored);
		this.targets = live;
	}

	/** Resolver degradations and unreachable forwarded backends are the same kind of partial failure. */
	private applyHealth(resolution: TargetResolution, dead: readonly UnreachableTarget[]): ForwardPhase {
		this.degradations =
			dead.length === 0
				? resolution.degradations
				: [
						...resolution.degradations,
						...dead.map((entry) => ({ target: entry.target, error: entry.error.detail() })),
					];
		if (this.degradations.length === 0) {
			this.attempt = 0;
			this.lastError = null;
			return "healthy";
		}
		this.attempt += 1;
		this.lastError = this.degradations[0].error;
		return "degraded";
	}

	async reconcileOnce(): Promise<ForwardState> {
		try {
			await this.retryOrphanedChild();
			await this.retryPendingCleanup();
			const resolution = await this.dependencies.resolver.resolveTargets(this.config);
			const resolved = resolution.available;
			if (resolved.length === 0) {
				if (this.owns()) await this.deactivate();
				const phase = this.applyHealth(
					resolution.degradations.length > 0
						? resolution
						: {
								available: [],
								degradations: [
									{
										target: this.config.targets[0],
										error: new BackendAbsent(this.config.stream, "portless", "No remote review targets are available").detail(),
									},
								],
							},
					[],
				);
				return this.persist(phase);
			}
			// Reachability is per target: keep the child while anything answers and publish only that.
			const probe = this.tunnel === null ? null : await this.tunnel.probe();
			if (probe !== null && probe.transport && probe.live.length > 0 && sameBackends(this.forwarded, resolved)) {
				await this.retainLiveRoutes(probe.live);
				return this.persist(this.applyHealth(resolution, probe.dead));
			}
			if (this.owns()) await this.deactivate();
			await this.dependencies.routes.cleanupStale(this.config);
			await this.dependencies.transport.cleanupStale(this.config);
			// Own the child before waiting on it: the record is durable from the instant it exists, so a
			// stop, an abort, or a successor after a crash can always find and reap it.
			const pending = await this.dependencies.transport.spawn(this.config, resolved);
			this.pending = pending;
			this.childRecord = pending.record;
			this.persist("starting");
			let started: ReadyTunnel;
			try {
				started = await pending.ready();
				this.pending = null;
				this.tunnel = started.handle;
				this.forwarded = resolved;
			} catch (problem) {
				this.pending = null;
				try {
					await pending.abort();
					this.childRecord = null;
				} catch {
					// Keep the record published; the next reconcile and any successor still reap it.
				}
				throw problem;
			}
			// Nothing answers: there is no route to publish and no reason to hold the ports, so the
			// child is reaped here and every dead backend is reported as its own degradation.
			if (started.live.length === 0) {
				await this.deactivate();
				return this.persist(this.applyHealth(resolution, started.dead));
			}
			try {
				await this.dependencies.routes.publish(this.config, started.live);
			} catch (problem) {
				try {
					await this.releaseChild();
				} catch {
					// The publish failure is the reportable cause; the child record remains retryable.
				}
				throw problem;
			}
			this.targets = started.live;
			return this.persist(this.applyHealth(resolution, started.dead));
		} catch (problem) {
			this.degradations = [];
			this.lastError = describeError(problem);
			try {
				await this.deactivate();
			} catch {
				// The reconcile failure is the reportable cause; pending cleanup remains retryable.
			}
			this.attempt += 1;
			return this.persist("degraded");
		}
	}

	async stop(): Promise<ForwardState> {
		try {
			await this.deactivate();
			this.lastError = null;
		} catch (problem) {
			this.lastError = describeError(problem);
		}
		return this.persist("stopped", false);
	}

	async run(shouldStop: () => boolean, shouldRefresh: () => boolean): Promise<void> {
		while (!shouldStop()) {
			const state = await this.reconcileOnce();
			if (shouldStop()) break;
			const exponential = Math.min(this.config.maxBackoffMs, this.config.refreshMs * 2 ** Math.min(state.attempt, 8));
			const jitter = state.phase === "healthy" ? 0 : Math.floor(Math.random() * Math.max(1, Math.floor(exponential / 4)));
			let remaining = state.phase === "healthy" ? this.config.refreshMs : exponential + jitter;
			while (remaining > 0 && !shouldStop() && !shouldRefresh()) {
				const slice = Math.min(remaining, 200);
				await Bun.sleep(slice);
				remaining -= slice;
			}
		}
		await this.stop();
	}
}

// ---------------------------------------------------------------------------
// Bounded loopback static server (runs on the review host, not on the laptop)
// ---------------------------------------------------------------------------

export interface StaticServerBounds {
	maxBytes: number;
	idleMs: number;
	lifetimeMs: number;
	maxInFlight: number;
}

export const DEFAULT_STATIC_BOUNDS: StaticServerBounds = {
	maxBytes: 8 * 1024 * 1024,
	idleMs: 900_000,
	lifetimeMs: 21_600_000,
	maxInFlight: 16,
};

const STATIC_CONTENT_TYPES: Record<string, string> = {
	html: "text/html; charset=utf-8",
	css: "text/css; charset=utf-8",
	js: "text/javascript; charset=utf-8",
	json: "application/json; charset=utf-8",
	txt: "text/plain; charset=utf-8",
	md: "text/plain; charset=utf-8",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	ico: "image/x-icon",
};

export interface StaticArtifact {
	root: string;
	file: string;
}

/**
 * The artifact must be a real file under the workspace root, reachable without traversal or a
 * symlink escape, and of a renderable type. Everything else is refused before a socket is bound.
 */
export function resolveStaticArtifact(workspaceRoot: string, artifact: string): StaticArtifact {
	if (!SAFE_RELATIVE_PATH.test(artifact) || artifact.split("/").some((part) => part === "." || part === "..")) {
		throw new StaticArtifactRejected(artifact, "unsafe-path", `Unsafe static review artifact: ${artifact}`);
	}
	const extension = (artifact.split(".").pop() ?? "").toLowerCase();
	if (!Object.hasOwn(STATIC_CONTENT_TYPES, extension)) {
		throw new StaticArtifactRejected(artifact, "unsupported-type", `Unsupported static review artifact type: ${artifact}`);
	}
	let rootReal: string;
	try {
		rootReal = realpathSync(workspaceRoot);
	} catch {
		throw new StaticArtifactRejected(artifact, "root-missing", `Static review root is missing: ${workspaceRoot}`);
	}
	let fileReal: string;
	try {
		fileReal = realpathSync(join(rootReal, artifact));
	} catch {
		throw new StaticArtifactRejected(artifact, "missing", `Static review artifact is missing: ${artifact}`);
	}
	if (fileReal !== join(rootReal, artifact) && !fileReal.startsWith(`${rootReal}/`)) {
		throw new StaticArtifactRejected(artifact, "escapes-root", `Static review artifact escapes its root: ${artifact}`);
	}
	if (!statSync(fileReal).isFile()) {
		throw new StaticArtifactRejected(artifact, "not-a-file", `Static review artifact is not a file: ${artifact}`);
	}
	return { root: dirname(fileReal), file: fileReal };
}

export interface StaticServerHandle {
	port: number;
	stop(): Promise<void>;
}

export function contentTypeFor(path: string): string | null {
	const extension = path.split(".").pop()?.toLowerCase() ?? "";
	return Object.hasOwn(STATIC_CONTENT_TYPES, extension) ? STATIC_CONTENT_TYPES[extension] : null;
}

/**
 * Serves one artifact plus its sibling assets on an ephemeral loopback port. The port is never
 * fixed, which is what forces every consumer to resolve the current backend rather than assume one.
 */
export function startStaticServer(
	artifact: StaticArtifact,
	bounds: StaticServerBounds,
	onExpire: (reason: "idle" | "lifetime") => void,
	daemonToken?: string,
): StaticServerHandle {
	let inFlight = 0;
	let lastRequest = Date.now();
	const startedAt = Date.now();
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		idleTimeout: 30,
		async fetch(request): Promise<Response> {
			lastRequest = Date.now();
			if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
			if (inFlight >= bounds.maxInFlight) return new Response("busy", { status: 503 });
			inFlight += 1;
			try {
				const requested = new URL(request.url).pathname;
				const target = requested === "/" ? artifact.file : safeJoin(artifact.root, requested);
				if (target === null) return new Response("not found", { status: 404 });
				const type = contentTypeFor(target);
				if (type === null) return new Response("not found", { status: 404 });
				const file = Bun.file(target);
				if (!(await file.exists())) return new Response("not found", { status: 404 });
				if (file.size > bounds.maxBytes) return new Response("payload too large", { status: 413 });
				const headers = {
					"content-type": type,
					"cache-control": "no-store",
					"content-length": String(file.size),
					...(daemonToken ? { "x-forward-daemon-token": daemonToken } : {}),
				};
				if (request.method === "HEAD") return new Response(null, { headers });
				return new Response(await file.arrayBuffer(), { headers });
			} finally {
				inFlight -= 1;
			}
		},
	});
	const timer = setInterval(() => {
		const now = Date.now();
		if (now - startedAt >= bounds.lifetimeMs) onExpire("lifetime");
		else if (now - lastRequest >= bounds.idleMs) onExpire("idle");
	}, 1_000);
	timer.unref?.();
	return {
		port: server.port!,
		async stop(): Promise<void> {
			clearInterval(timer);
			await server.stop(true);
		},
	};
}

function safeJoin(root: string, requested: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(requested);
	} catch {
		return null;
	}
	if (decoded.includes("\0")) return null;
	const segments = decoded.split("/").filter((part) => part.length > 0);
	if (segments.some((part) => part === "." || part === ".." || !SAFE_RELATIVE_PATH.test(part))) return null;
	if (segments.length === 0) return null;
	const candidate = join(root, ...segments);
	let real: string;
	try {
		real = realpathSync(candidate);
	} catch {
		return null;
	}
	return real.startsWith(`${root}/`) ? real : null;
}

export interface StaticDaemonRecord {
	version: 1;
	name: string;
	token: string;
	pid: number;
	processIdentity: ProcessIdentity;
	port: number;
	artifact: string;
	artifactDigest: string;
	root: string;
	startedAt: string;
}

function staticRecordPath(stateDir: string, name: string): string {
	assertSafeId(name, "static target name");
	return `${stateDir}/static-${name}.json`;
}

function readStaticRecord(stateDir: string, name: string): StaticDaemonRecord | null {
	try {
		const raw = readJson(staticRecordPath(stateDir, name));
		assertRecord(raw, "static record");
		const processIdentity = decodeProcessIdentity(raw.processIdentity);
		if (
			raw.version !== 1 ||
			raw.name !== name ||
			typeof raw.token !== "string" ||
			!UUID_PATTERN.test(raw.token) ||
			!Number.isInteger(raw.pid) ||
			processIdentity === null ||
			processIdentity.pid !== raw.pid ||
			!Number.isInteger(raw.port) ||
			typeof raw.artifact !== "string" ||
			typeof raw.artifactDigest !== "string" ||
			!SHA256_PATTERN.test(raw.artifactDigest) ||
			typeof raw.root !== "string"
		) {
			return null;
		}
		return { ...(raw as unknown as StaticDaemonRecord), processIdentity };
	} catch {
		return null;
	}
}

async function staticRecordAnswers(record: StaticDaemonRecord): Promise<boolean> {
	if (inspectKnownIdentity(record.processIdentity).state !== "current") return false;
	try {
		const response = await fetch(`http://127.0.0.1:${record.port}/`, {
			method: "HEAD",
			signal: AbortSignal.timeout(2_000),
		});
		return response.ok && response.headers.get("x-forward-daemon-token") === record.token;
	} catch {
		return false;
	}
}

interface StaticEnsureLock {
	readonly version: 1;
	readonly token: string;
	readonly owner: ProcessIdentity;
}

function staticLockPath(stateDir: string, name: string): string {
	return `${staticRecordPath(stateDir, name)}.lock`;
}

function readStaticLock(stateDir: string, name: string): StaticEnsureLock | null {
	try {
		const raw = readJson(staticLockPath(stateDir, name));
		assertRecord(raw, "static ensure lock");
		const owner = decodeProcessIdentity(raw.owner);
		if (raw.version !== 1 || typeof raw.token !== "string" || !UUID_PATTERN.test(raw.token) || owner === null) return null;
		return { version: 1, token: raw.token, owner };
	} catch {
		return null;
	}
}

function sameStaticLock(left: StaticEnsureLock | null, right: StaticEnsureLock): boolean {
	return left !== null && left.version === right.version && left.token === right.token && sameProcessIdentity(left.owner, right.owner);
}

async function acquireStaticLock(stateDir: string, name: string): Promise<StaticEnsureLock> {
	mkdirSync(stateDir, { recursive: true, mode: 0o700 });
	const owner = readProcessIdentity(process.pid);
	if (owner === null) {
		throw new SupervisorIdentityUnavailable(name, process.pid, "Could not fingerprint static ensure owner", "Refusing an identity-less static lock");
	}
	const lock: StaticEnsureLock = { version: 1, token: crypto.randomUUID(), owner };
	const path = staticLockPath(stateDir, name);
	const candidatePath = `${path}.${lock.token}.candidate`;
	const descriptor = openSync(candidatePath, "wx", 0o600);
	try {
		writeFileSync(descriptor, `${JSON.stringify(lock)}\n`);
	} finally {
		closeSync(descriptor);
	}
	try {
		for (let attempt = 0; attempt < 600; attempt += 1) {
			try {
				linkSync(candidatePath, path);
				return lock;
			} catch (problem) {
				if (systemErrorCode(problem) !== "EEXIST") throw problem;
				const observed = readStaticLock(stateDir, name);
				if (observed === null) {
					throw new SupervisorIdentityUnavailable(name, 0, "Static ensure lock is unreadable", "Refusing to delete an unverifiable lock");
				}
				const inspection = inspectKnownIdentity(observed.owner);
				if (inspection.state === "unverifiable") {
					throw new SupervisorIdentityUnavailable(name, observed.owner.pid, inspection.reason, "Static ensure lock owner is unverifiable");
				}
				if (inspection.state === "gone") {
					const reinspected = readStaticLock(stateDir, name);
					if (sameStaticLock(reinspected, observed)) rmSync(path, { force: true });
				}
				await Bun.sleep(25);
			}
		}
		throw new BackendAbsent(name, "static", `Timed out acquiring static ensure lock for ${name}`);
	} finally {
		rmSync(candidatePath, { force: true });
	}
}

function releaseStaticLock(stateDir: string, name: string, lock: StaticEnsureLock): void {
	const current = readStaticLock(stateDir, name);
	if (sameStaticLock(current, lock)) rmSync(staticLockPath(stateDir, name), { force: true });
}

function staticArtifactDigest(artifact: StaticArtifact): string {
	return new Bun.CryptoHasher("sha256").update(readFileSync(artifact.file)).digest("hex");
}

/** Idempotent ensure: reuse a live daemon, otherwise spawn one and report its fresh port. */
export async function ensureStaticDaemon(
	workspaceRoot: string,
	stateDir: string,
	name: string,
	artifact: string,
	artifactDigest: string,
	bounds: StaticServerBounds,
): Promise<StaticDaemonRecord> {
	if (!SHA256_PATTERN.test(artifactDigest)) {
		throw new StaticArtifactRejected(artifact, "digest-invalid", `Invalid declared sha256 for static artifact: ${artifact}`);
	}
	const lock = await acquireStaticLock(stateDir, name);
	try {
		const resolvedArtifact = resolveStaticArtifact(workspaceRoot, artifact);
		const actualDigest = staticArtifactDigest(resolvedArtifact);
		if (actualDigest !== artifactDigest) {
			throw new StaticArtifactRejected(artifact, "digest-mismatch", `Static artifact sha256 does not match its declaration: ${artifact}`);
		}
		const recordPath = staticRecordPath(stateDir, name);
		const recordExists = existsSync(recordPath);
		const existing = readStaticRecord(stateDir, name);
		if (recordExists && existing === null) {
			throw new SupervisorIdentityUnavailable(
				name,
				0,
				"Static daemon record is unreadable or has no process identity/token",
				"Refusing to replace an unverifiable static daemon record",
			);
		}
		if (existing) {
			let identityState = inspectKnownIdentity(existing.processIdentity);
			if (identityState.state === "unverifiable") {
				throw new SupervisorIdentityUnavailable(
					name,
					existing.processIdentity.pid,
					identityState.reason,
					"Refusing to replace an unverifiable static daemon owner",
				);
			}
			if (
				identityState.state === "current" &&
				existing.artifact === artifact &&
				existing.artifactDigest === artifactDigest &&
				(await staticRecordAnswers(existing))
			) {
				return existing;
			}
			if (identityState.state === "current") {
				try {
					await signalProcessIdentity(name, existing.processIdentity, "SIGTERM");
				} catch (problem) {
					if (!(problem instanceof StaleSupervisor)) throw problem;
				}
				for (let attempt = 0; attempt < 50; attempt += 1) {
					identityState = inspectKnownIdentity(existing.processIdentity);
					if (identityState.state === "gone") break;
					if (identityState.state === "unverifiable") {
						throw new SupervisorIdentityUnavailable(
							name,
							existing.processIdentity.pid,
							identityState.reason,
							"Static daemon identity became unverifiable while stopping",
						);
					}
					await Bun.sleep(100);
				}
				if (identityState.state === "current") {
					throw new SupervisorIdentityUnavailable(
						name,
						existing.processIdentity.pid,
						"Identity-validated static daemon did not exit after SIGTERM",
						"Refusing to replace a static daemon that may still be live",
					);
				}
			}
		}
		rmSync(recordPath, { force: true });
		const daemonToken = crypto.randomUUID();
		const logDescriptor = openSync(`${stateDir}/static-${name}.log`, "a", 0o600);
		const child = Bun.spawn(
			[
				process.execPath,
				resolve(import.meta.path),
				"serve-static",
				"--root",
				workspaceRoot,
				"--artifact",
				artifact,
				"--artifact-digest",
				artifactDigest,
				"--state",
				stateDir,
				"--name",
				name,
				"--token",
				daemonToken,
				"--max-bytes",
				String(bounds.maxBytes),
				"--idle-ms",
				String(bounds.idleMs),
				"--lifetime-ms",
				String(bounds.lifetimeMs),
			],
			{ stdin: "ignore", stdout: logDescriptor, stderr: logDescriptor, detached: true },
		);
		child.unref();
		closeSync(logDescriptor);
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const record = readStaticRecord(stateDir, name);
			if (record && record.pid === child.pid && record.token === daemonToken && (await staticRecordAnswers(record))) return record;
			if (child.exitCode !== null) {
				throw new BackendAbsent(name, "static", `Static review server exited before publishing a port (${child.exitCode})`);
			}
			await Bun.sleep(100);
		}
		child.kill("SIGTERM");
		throw new BackendAbsent(name, "static", `Static review server did not publish a port for ${name}`);
	} finally {
		releaseStaticLock(stateDir, name, lock);
	}
}

async function runStaticDaemon(options: Map<string, string>): Promise<void> {
	const root = options.get("root") ?? invalid("root", "serve-static requires --root");
	const artifact = options.get("artifact") ?? invalid("artifact", "serve-static requires --artifact");
	const artifactDigest = options.get("artifact-digest") ?? invalid("artifact-digest", "serve-static requires --artifact-digest");
	const stateDir = options.get("state") ?? invalid("state", "serve-static requires --state");
	const name = options.get("name") ?? invalid("name", "serve-static requires --name");
	const token = options.get("token") ?? invalid("token", "serve-static requires --token");
	assertSafeId(name, "name");
	assertAbsolutePath(root, "root");
	assertAbsolutePath(stateDir, "state");
	if (!UUID_PATTERN.test(token)) invalid("token", "Invalid static daemon token");
	if (!SHA256_PATTERN.test(artifactDigest)) invalid("artifact-digest", "Invalid static artifact sha256");
	const bounds: StaticServerBounds = {
		maxBytes: numericOption(options, "max-bytes", DEFAULT_STATIC_BOUNDS.maxBytes, 1_024, 512 * 1024 * 1024),
		idleMs: numericOption(options, "idle-ms", DEFAULT_STATIC_BOUNDS.idleMs, 1_000, 86_400_000),
		lifetimeMs: numericOption(options, "lifetime-ms", DEFAULT_STATIC_BOUNDS.lifetimeMs, 1_000, 86_400_000),
		maxInFlight: numericOption(options, "max-in-flight", DEFAULT_STATIC_BOUNDS.maxInFlight, 1, 512),
	};
	const resolved = resolveStaticArtifact(root, artifact);
	if (staticArtifactDigest(resolved) !== artifactDigest) {
		throw new StaticArtifactRejected(artifact, "digest-mismatch", `Static artifact sha256 changed before daemon start: ${artifact}`);
	}
	mkdirSync(stateDir, { recursive: true, mode: 0o700 });
	const recordPath = staticRecordPath(stateDir, name);
	const processIdentity = readProcessIdentity(process.pid);
	if (processIdentity === null) {
		throw new SupervisorIdentityUnavailable(
			name,
			process.pid,
			"Could not fingerprint the static daemon process",
			"Refusing to publish a static daemon without a process identity",
		);
	}
	let handle: StaticServerHandle | null = null;
	let stopping = false;
	const shutdown = async (): Promise<void> => {
		if (stopping) return;
		stopping = true;
		await handle?.stop();
		const current = readStaticRecord(stateDir, name);
		if (current && current.token === token && sameProcessIdentity(current.processIdentity, processIdentity)) {
			rmSync(recordPath, { force: true });
		}
		process.exit(0);
	};
	handle = startStaticServer(
		resolved,
		bounds,
		(reason) => {
			console.log(JSON.stringify({ event: "static-server-expired", name, reason }));
			void shutdown();
		},
		token,
	);
	const record: StaticDaemonRecord = {
		version: 1,
		name,
		token,
		pid: process.pid,
		processIdentity,
		port: handle.port,
		artifact,
		artifactDigest,
		root,
		startedAt: new Date().toISOString(),
	};
	atomicWriteJson(recordPath, record);
	process.on("SIGTERM", () => void shutdown());
	process.on("SIGINT", () => void shutdown());
	console.log(JSON.stringify(record));
	await new Promise<never>(() => {});
}

function numericOption(options: Map<string, string>, key: string, fallback: number, minimum: number, maximum: number): number {
	const raw = options.get(key);
	if (raw === undefined) return fallback;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) invalid(key, `Invalid --${key}: ${raw}`);
	return parsed;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function loadConfig(path: string): ForwardConfig {
	return validateForwardConfig(readJson(path));
}

function readPid(config: ForwardConfig): number | null {
	try {
		const pid = Number(readFileSync(pidPath(config), "utf8").trim());
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

function readState(config: ForwardConfig): ForwardState | null {
	try {
		return readJson(statePath(config)) as ForwardState;
	} catch {
		return null;
	}
}
type SupervisorOwnership =
	| { readonly state: "absent"; readonly pid: 0 }
	| {
			readonly state: "live";
			readonly pid: number;
			readonly owner: SupervisorOwnerRecord;
			readonly identity: ProcessIdentity;
			readonly snapshot: ForwardState;
	  }
	| { readonly state: "dead"; readonly pid: number; readonly owner: SupervisorOwnerRecord; readonly reason: string }
	| { readonly state: "unverifiable"; readonly pid: number; readonly reason: string };

type SupervisorLockRead =
	| { readonly state: "missing" }
	| { readonly state: "valid"; readonly owner: SupervisorOwnerRecord }
	| { readonly state: "unreadable" };

function readSupervisorLock(config: ForwardConfig): SupervisorLockRead {
	try {
		const owner = decodeSupervisorOwnerRecord(readJson(lockPath(config)));
		return owner === null ? { state: "unreadable" } : { state: "valid", owner };
	} catch (problem) {
		return systemErrorCode(problem) === "ENOENT" ? { state: "missing" } : { state: "unreadable" };
	}
}

function stateClaimsSupervisorOwnership(snapshot: ForwardState | null): boolean {
	return (
		snapshot !== null &&
		(snapshot.running || snapshot.supervisorIdentity !== null || typeof snapshot.ownerToken === "string")
	);
}

function inspectSupervisorOwnership(config: ForwardConfig, snapshot = readState(config)): SupervisorOwnership {
	const lock = readSupervisorLock(config);
	if (lock.state === "missing") {
		if (!existsSync(pidPath(config)) && !stateClaimsSupervisorOwnership(snapshot)) return { state: "absent", pid: 0 };
		return {
			state: "unverifiable",
			pid: readPid(config) ?? snapshot?.pid ?? 0,
			reason: "Supervisor ownership artifacts exist without the authoritative lock record",
		};
	}
	if (lock.state === "unreadable") {
		return {
			state: "unverifiable",
			pid: readPid(config) ?? snapshot?.pid ?? 0,
			reason: "Supervisor lock record is unreadable or invalid",
		};
	}
	const { owner } = lock;
	const existence = probePidExistence(owner.pid);
	if (existence.state === "dead") {
		return { state: "dead", pid: owner.pid, owner, reason: existence.reason };
	}
	if (existence.state === "unverifiable") {
		return { state: "unverifiable", pid: owner.pid, reason: existence.reason };
	}
	const identity = decodeProcessIdentity(snapshot?.supervisorIdentity);
	if (
		snapshot === null ||
		snapshot.id !== config.id ||
		snapshot.ownerToken !== owner.token ||
		snapshot.pid !== owner.pid ||
		identity === null ||
		identity.pid !== owner.pid
	) {
		return {
			state: "unverifiable",
			pid: owner.pid,
			reason: "Live lock owner has no state record with the same token, PID, and full process identity",
		};
	}
	const inspection = inspectKnownIdentity(identity);
	if (inspection.state === "current") return { state: "live", pid: owner.pid, owner, identity, snapshot };
	if (inspection.state === "gone") return { state: "dead", pid: owner.pid, owner, reason: inspection.reason };
	return { state: "unverifiable", pid: owner.pid, reason: inspection.reason };
}

function unavailableOwnership(config: ForwardConfig, ownership: Extract<SupervisorOwnership, { state: "unverifiable" }>): never {
	throw new SupervisorIdentityUnavailable(
		config.id,
		ownership.pid,
		ownership.reason,
		"Refusing to alter supervisor ownership without positive dead-owner evidence",
	);
}

function assertSupervisorIdentity(config: ForwardConfig, snapshot = readState(config)): ProcessIdentity {
	const ownership = inspectSupervisorOwnership(config, snapshot);
	if (ownership.state === "live") return ownership.identity;
	if (ownership.state === "unverifiable") unavailableOwnership(config, ownership);
	throw new StaleSupervisor(
		config.id,
		ownership.pid,
		ownership.state === "dead" ? ownership.reason : "No supervisor ownership record exists",
	);
}

function reclaimDeadOwnership(config: ForwardConfig, ownership: Extract<SupervisorOwnership, { state: "dead" }>): void {
	const current = inspectSupervisorOwnership(config);
	if (current.state === "unverifiable") unavailableOwnership(config, current);
	if (current.state === "live") {
		throw new StaleSupervisor(config.id, current.identity.pid, "A live supervisor acquired ownership during stale cleanup");
	}
	if (current.state === "absent") return;
	if (!sameSupervisorOwnerRecord(current.owner, ownership.owner)) {
		throw new SupervisorIdentityUnavailable(
			config.id,
			current.pid,
			"Supervisor owner record changed during stale cleanup",
			"Refusing to delete ownership records after a concurrent owner change",
		);
	}
	rmSync(pidPath(config), { force: true });
	rmSync(lockPath(config), { force: true });
}

export interface SupervisorOwnershipReleaseSeam {
	readonly beforeCompare?: () => void | Promise<void>;
}

export async function releaseSupervisorOwnership(
	config: ForwardConfig,
	owner: SupervisorOwnerRecord,
	seam: SupervisorOwnershipReleaseSeam = {},
): Promise<boolean> {
	await seam.beforeCompare?.();
	const current = readSupervisorLock(config);
	if (current.state !== "valid" || !sameSupervisorOwnerRecord(current.owner, owner)) return false;
	rmSync(pidPath(config), { force: true });
	rmSync(lockPath(config), { force: true });
	return true;
}

function acquireSupervisorLock(config: ForwardConfig): SupervisorOwnerRecord {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const owner = Object.freeze({ version: 1 as const, token: crypto.randomUUID(), pid: process.pid });
		const candidatePath = `${lockPath(config)}.candidate-${owner.token}`;
		try {
			writeFileSync(candidatePath, `${JSON.stringify(owner)}\n`, { flag: "wx", mode: 0o600 });
			try {
				linkSync(candidatePath, lockPath(config));
				return owner;
			} catch (problem) {
				if (systemErrorCode(problem) !== "EEXIST") throw problem;
				const ownership = inspectSupervisorOwnership(config);
				if (ownership.state === "live") {
					throw new StaleSupervisor(
						config.id,
						ownership.identity.pid,
						`Forward supervisor already running: ${ownership.identity.pid}`,
					);
				}
				if (ownership.state === "unverifiable") unavailableOwnership(config, ownership);
				if (ownership.state === "absent") continue;
				reclaimDeadOwnership(config, ownership);
			}
		} finally {
			rmSync(candidatePath, { force: true });
		}
	}
	throw new SupervisorIdentityUnavailable(
		config.id,
		readPid(config) ?? 0,
		"Supervisor lock changed repeatedly during stale cleanup",
		"Refusing to race another supervisor for ownership",
	);
}

function productionDependencies(config: ForwardConfig, configPath: string): SupervisorDependencies {
	return {
		resolver: new SshTargetResolver(),
		transport: new SshTunnelTransport(),
		routes: new PortlessRoutePublisher(config, configPath),
	};
}

async function cleanupStale(config: ForwardConfig, configPath: string): Promise<void> {
	const dependencies = productionDependencies(config, configPath);
	await dependencies.routes.cleanupStale(config);
	await dependencies.transport.cleanupStale(config);
}

/**
 * Reap the tunnel child a previous incarnation recorded. A supervisor killed inside its readiness
 * wait leaves an ssh child that still holds the review ports and whose control master may never have
 * come up, so closing the master is not enough — the recorded identity has to be signalled.
 */
async function reapRecordedTunnelChild(config: ForwardConfig): Promise<void> {
	const record = decodeTunnelChildRecord(readState(config)?.tunnel);
	if (record === null) return;
	await new SshTunnelTransport().reap(config, record);
}

async function runDaemon(config: ForwardConfig, configPath: string): Promise<void> {
	mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
	const owner = acquireSupervisorLock(config);
	writeFileSync(pidPath(config), `${process.pid}\n`, { mode: 0o600 });
	atomicWriteJson(activeConfigPath(config), config);
	// Reap before this incarnation publishes anything: the state file still names the child a killed
	// predecessor left behind, and that child is still holding the review ports.
	await reapRecordedTunnelChild(config);
	let stopping = false;
	let refreshing = false;
	process.on("SIGTERM", () => {
		stopping = true;
	});
	process.on("SIGINT", () => {
		stopping = true;
	});
	process.on("SIGHUP", () => {
		refreshing = true;
	});
	const supervisor = new ForwardSupervisor(config, productionDependencies(config, configPath), owner);
	supervisor.recordStarting();
	try {
		await supervisor.run(
			() => stopping,
			() => {
				if (!refreshing) return false;
				refreshing = false;
				return true;
			},
		);
	} finally {
		await releaseSupervisorOwnership(config, owner);
	}
}

async function waitForIdentityExit(
	config: ForwardConfig,
	identity: ProcessIdentity,
	attempts: number,
): Promise<"gone" | "current"> {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const inspection = inspectKnownIdentity(identity);
		if (inspection.state === "gone") return "gone";
		if (inspection.state === "unverifiable") {
			throw new SupervisorIdentityUnavailable(
				config.id,
				identity.pid,
				inspection.reason,
				"Supervisor identity became unverifiable while waiting for exit",
			);
		}
		await Bun.sleep(100);
	}
	return "current";
}

async function stopDaemon(config: ForwardConfig, configPath: string): Promise<ForwardState> {
	let ownership = inspectSupervisorOwnership(config);
	const stoppedPid = ownership.pid;
	if (ownership.state === "unverifiable") unavailableOwnership(config, ownership);
	if (ownership.state === "live") {
		let exitState: "gone" | "current";
		try {
			await signalProcessIdentity(config.id, ownership.identity, "SIGTERM");
			exitState = await waitForIdentityExit(config, ownership.identity, 80);
		} catch (problem) {
			if (!(problem instanceof StaleSupervisor)) throw problem;
			exitState = "gone";
		}
		if (exitState === "current") {
			try {
				await signalProcessIdentity(config.id, ownership.identity, "SIGKILL");
				exitState = await waitForIdentityExit(config, ownership.identity, 20);
			} catch (problem) {
				if (!(problem instanceof StaleSupervisor)) throw problem;
				exitState = "gone";
			}
		}
		if (exitState === "current") {
			throw new SupervisorIdentityUnavailable(
				config.id,
				ownership.identity.pid,
				"Identity-validated supervisor remained live after SIGKILL",
				"Refusing cleanup while the supervisor may still own forwarding resources",
			);
		}
		ownership = {
			state: "dead",
			pid: ownership.identity.pid,
			owner: ownership.owner,
			reason: "Identity-validated supervisor exited",
		};
	}
	let cleanupConfig = config;
	try {
		const active = validateForwardConfig(readJson(activeConfigPath(config)));
		if (active.id !== config.id || active.stateDir !== config.stateDir) {
			throw new StaleSupervisor(config.id, stoppedPid, "Active forward config ownership mismatch");
		}
		cleanupConfig = active;
	} catch (problem) {
		if (problem instanceof StaleSupervisor) throw problem;
		if (systemErrorCode(problem) !== "ENOENT") throw problem;
	}
	await reapRecordedTunnelChild(cleanupConfig);
	await cleanupStale(cleanupConfig, configPath);
	if (ownership.state === "dead") reclaimDeadOwnership(config, ownership);
	rmSync(browserPath(config), { force: true });
	const state: ForwardState = {
		version: 1,
		id: config.id,
		pid: stoppedPid,
		supervisorIdentity: null,
		ownerToken: null,
		running: false,
		phase: "stopped",
		attempt: 0,
		configDigest: configDigest(config),
		updatedAt: new Date().toISOString(),
		lastError: null,
		targets: [],
		degradations: [],
		tunnel: null,
	};
	atomicWriteJson(statePath(config), state);
	return state;
}

async function startDaemon(config: ForwardConfig, configPath: string): Promise<ForwardState> {
	const existingState = readState(config);
	let ownership = inspectSupervisorOwnership(config, existingState);
	if (ownership.state === "unverifiable") unavailableOwnership(config, ownership);
	if (ownership.state === "dead") {
		reclaimDeadOwnership(config, ownership);
		ownership = { state: "absent", pid: 0 };
	}
	if (ownership.state === "live" && existingState?.configDigest === configDigest(config)) {
		const refreshOwner = ownership.owner;
		const refreshIdentity = ownership.identity;
		try {
			await signalProcessIdentity(config.id, ownership.identity, "SIGHUP");
		} catch (problem) {
			if (!(problem instanceof StaleSupervisor)) throw problem;
			const after = inspectSupervisorOwnership(config);
			if (after.state === "unverifiable") unavailableOwnership(config, after);
			if (after.state === "live") throw problem;
			if (after.state === "dead") reclaimDeadOwnership(config, after);
			ownership = { state: "absent", pid: 0 };
		}
		if (ownership.state === "live") {
			for (let attempt = 0; attempt < 200; attempt += 1) {
				const refreshed = readState(config);
				const refreshedOwnership = inspectSupervisorOwnership(config, refreshed);
				if (refreshedOwnership.state === "unverifiable") unavailableOwnership(config, refreshedOwnership);
				if (refreshedOwnership.state === "absent") {
					throw new StaleSupervisor(config.id, refreshIdentity.pid, "Forward supervisor exited during health refresh");
				}
				if (refreshedOwnership.state === "dead") {
					throw new StaleSupervisor(config.id, refreshedOwnership.pid, refreshedOwnership.reason);
				}
				if (!sameSupervisorOwnerRecord(refreshedOwnership.owner, refreshOwner)) {
					throw new SupervisorIdentityUnavailable(
						config.id,
						refreshedOwnership.pid,
						"Supervisor owner record changed during health refresh",
						"Refusing status from a replacement supervisor incarnation",
					);
				}
				if (
					refreshed !== null &&
					refreshed.updatedAt !== existingState.updatedAt &&
					(refreshed.phase === "healthy" || refreshed.phase === "degraded")
				) {
					return {
						...refreshed,
						pid: refreshedOwnership.identity.pid,
						ownerToken: refreshedOwnership.owner.token,
						running: true,
					};
				}
				await Bun.sleep(100);
			}
			throw new StaleSupervisor(config.id, ownership.identity.pid, "Timed out waiting for forward supervisor health refresh");
		}
	}
	if (ownership.state === "live") await stopDaemon(config, configPath);
	mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
	const logDescriptor = openSync(`${config.stateDir}/supervisor.log`, "a", 0o600);
	const child = Bun.spawn([process.execPath, resolve(import.meta.path), "run", "--config", configPath], {
		cwd: dirname(configPath),
		stdin: "ignore",
		stdout: logDescriptor,
		stderr: logDescriptor,
		detached: true,
	});
	child.unref();
	closeSync(logDescriptor);
	for (let attempt = 0; attempt < 300; attempt += 1) {
		const state = readState(config);
		try {
			const identity = assertSupervisorIdentity(config, state);
			if (
				state &&
				identity.pid === child.pid &&
				(state.phase === "healthy" || state.phase === "degraded")
			) {
				return { ...state, pid: identity.pid, running: true };
			}
		} catch (problem) {
			if (!(problem instanceof StaleSupervisor) && !(problem instanceof SupervisorIdentityUnavailable)) throw problem;
			const recordedPid = readPid(config);
			if (recordedPid !== null && recordedPid !== child.pid) throw problem;
		}
		if (child.exitCode !== null) {
			throw new StaleSupervisor(config.id, child.pid, `Forward supervisor exited before publishing status (${child.exitCode})`);
		}
		await Bun.sleep(100);
	}
	throw new StaleSupervisor(config.id, child.pid, "Timed out waiting for forward supervisor status");
}

async function openReview(config: ForwardConfig): Promise<BrowserResult[]> {
	const current = status(config);
	if ((current.phase !== "healthy" && current.phase !== "degraded") || current.targets.length === 0) {
		throw new BackendAbsent(config.stream, "portless", `Review forward is ${current.phase} with no available targets`);
	}
	const commands = buildCmuxBrowserCommands(config, current.targets);
	const results: BrowserResult[] = [];
	for (let index = 0; index < commands.length; index += 1) {
		const target = current.targets[index];
		const result = await run(commands[index]);
		const failure =
			result.exitCode === 0 && !result.timedOut
				? null
				: new BrowserOpenFailed(
						target.name,
						target.url,
						result.timedOut
							? `cmux browser open timed out after ${COMMAND_TIMEOUT_MS}ms`
							: result.stderr.trim() || result.stdout.trim() || `cmux exited ${result.exitCode}`,
					);
		results.push({
			name: target.name,
			url: target.url,
			workspace: config.cmuxWorkspace,
			status: failure === null ? "opened" : "error",
			...(failure === null ? {} : { error: JSON.stringify(failure.detail()) }),
		});
	}
	atomicWriteJson(browserPath(config), results);
	if (results.some((result) => result.status === "error")) process.exitCode = 1;
	return results;
}

/** Never reports `healthy` for a state file no live supervisor backs. */
function status(config: ForwardConfig): ForwardState {
	const state = readState(config) ?? {
		version: 1,
		id: config.id,
		pid: 0,
		supervisorIdentity: null,
		ownerToken: null,
		running: false,
		phase: "stopped" as ForwardPhase,
		attempt: 0,
		configDigest: configDigest(config),
		updatedAt: new Date().toISOString(),
		lastError: null,
		targets: [],
		degradations: [],
		tunnel: null,
	};
	const ownership = inspectSupervisorOwnership(config, state);
	let browser: BrowserResult[] | undefined;
	try {
		browser = readJson(browserPath(config)) as BrowserResult[];
	} catch {
		browser = undefined;
	}
	if (ownership.state === "live") {
		return {
			...state,
			pid: ownership.identity.pid,
			supervisorIdentity: ownership.identity,
			ownerToken: ownership.owner.token,
			running: true,
			...(browser ? { browser } : {}),
		};
	}
	if (ownership.state === "absent" && state.phase === "stopped") {
		return { ...state, running: false, ...(browser ? { browser } : {}) };
	}
	const problem =
		ownership.state === "dead"
			? new StaleSupervisor(config.id, ownership.pid, ownership.reason)
			: new SupervisorIdentityUnavailable(
					config.id,
					ownership.pid,
					ownership.state === "unverifiable"
						? ownership.reason
						: "Supervisor state exists without PID and lock ownership artifacts",
					"Supervisor ownership cannot be verified",
				);
	return {
		...state,
		pid: ownership.pid || state.pid,
		supervisorIdentity: null,
		ownerToken: ownership.state === "dead" ? ownership.owner.token : null,
		running: false,
		phase: ownership.state === "dead" ? "dead" : "degraded",
		targets: [],
		lastError: problem.detail(),
		...(browser ? { browser } : {}),
	};
}

function parseOptions(argv: string[]): Map<string, string> {
	const options = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 1) {
		const entry = argv[index];
		if (!entry.startsWith("--")) continue;
		const next = argv[index + 1];
		if (next === undefined || next.startsWith("--")) invalid(entry, `Missing value for ${entry}`);
		options.set(entry.slice(2), next);
		index += 1;
	}
	return options;
}

const USAGE = [
	"Usage: remote-forward-supervisor.ts <start|run|status|restart|stop|open> --config <path>",
	"       remote-forward-supervisor.ts <ensure-static|serve-static> --root <dir> --artifact <rel> --state <dir> --name <id>",
].join("\n");

async function main(): Promise<void> {
	const action = process.argv[2];
	const options = parseOptions(process.argv.slice(3));
	if (action === "serve-static") {
		await runStaticDaemon(options);
		return;
	}
	if (action === "ensure-static") {
		const root = options.get("root") ?? invalid("root", USAGE);
		const artifact = options.get("artifact") ?? invalid("artifact", USAGE);
		const artifactDigest = options.get("artifact-digest") ?? invalid("artifact-digest", USAGE);
		const stateDir = options.get("state") ?? invalid("state", USAGE);
		const name = options.get("name") ?? invalid("name", USAGE);
		assertAbsolutePath(root, "root");
		assertAbsolutePath(stateDir, "state");
		const bounds: StaticServerBounds = {
			maxBytes: numericOption(options, "max-bytes", DEFAULT_STATIC_BOUNDS.maxBytes, 1_024, 512 * 1024 * 1024),
			idleMs: numericOption(options, "idle-ms", DEFAULT_STATIC_BOUNDS.idleMs, 1_000, 86_400_000),
			lifetimeMs: numericOption(options, "lifetime-ms", DEFAULT_STATIC_BOUNDS.lifetimeMs, 1_000, 86_400_000),
			maxInFlight: numericOption(options, "max-in-flight", DEFAULT_STATIC_BOUNDS.maxInFlight, 1, 512),
		};
		console.log(JSON.stringify(await ensureStaticDaemon(root, stateDir, name, artifact, artifactDigest, bounds), null, 2));
		return;
	}
	const rawConfig = options.get("config");
	if (rawConfig === undefined) invalid("config", USAGE);
	const configPath = resolve(rawConfig);
	const config = loadConfig(configPath);
	let result: unknown;
	switch (action) {
		case "run":
			await runDaemon(config, configPath);
			return;
		case "start":
			result = await startDaemon(config, configPath);
			break;
		case "restart":
			await stopDaemon(config, configPath);
			result = await startDaemon(config, configPath);
			break;
		case "stop":
			result = await stopDaemon(config, configPath);
			break;
		case "status":
			result = status(config);
			break;
		case "open":
			result = await openReview(config);
			break;
		default:
			invalid("action", USAGE);
	}
	console.log(JSON.stringify(result, null, 2));
	if ((action === "start" || action === "restart") && (result as ForwardState).phase !== "healthy") process.exitCode = 1;
}

if (import.meta.main) {
	try {
		await main();
	} catch (problem) {
		console.error(JSON.stringify(describeError(problem), null, 2));
		process.exit(1);
	}
}
