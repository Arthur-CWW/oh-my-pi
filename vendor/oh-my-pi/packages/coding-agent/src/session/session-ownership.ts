import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

export interface ProcessIdentity {
	readonly bootId: string;
	readonly pid: number;
	readonly startFingerprint: string;
}

export interface SessionLeaseV1 {
	readonly version: 1;
	readonly sessionFile: string;
	readonly sessionId: string;
	readonly ownerKind: "agent-mux" | "omp";
	readonly ownerEpoch: string;
	readonly muxName: string | null;
	readonly socketPath: string;
	readonly daemonProcess: ProcessIdentity | null;
	readonly controllerProcess: ProcessIdentity;
	readonly phase: "acquiring" | "running" | "releasing";
	readonly acquiredAtUnixMs: number;
	readonly heartbeatSeq: number;
	readonly heartbeatAtUnixMs: number;
}

export interface CmuxOwnerView {
	readonly version: 1;
	readonly ownerEpoch: string;
	readonly cmux: {
		readonly workspaceId: string;
		readonly surfaceId: string;
		readonly socketPath: string;
	};
}

export type SessionOwnershipLookup =
	| { readonly status: "none" }
	| { readonly status: "live"; readonly lease: SessionLeaseV1 }
	| { readonly status: "stale"; readonly lease: SessionLeaseV1 }
	| {
			readonly status: "suspect";
			readonly reason: "external_owner_unverifiable" | "owner_record_corrupt";
			readonly lease?: SessionLeaseV1;
	  };

export class ExternalSessionOwner extends Error {
	constructor(readonly lease: SessionLeaseV1) {
		super(`Session is controlled by external owner${lease.muxName ? ` ${lease.muxName}` : ""}`);
		this.name = "ExternalSessionOwner";
	}
}

export class ExternalSessionOwnerUnverifiable extends Error {
	constructor(readonly reason: "external_owner_unverifiable" | "owner_record_corrupt") {
		super(`Session ownership cannot be safely verified: ${reason}`);
		this.name = "ExternalSessionOwnerUnverifiable";
	}
}

export interface SessionOwnershipHandle {
	readonly sessionFile: string;
	readonly sessionId: string;
	readonly ownerEpoch: string;
	readonly ownerKind: "agent-mux" | "omp";
	isCurrent(): Promise<boolean>;
	/** Synchronous fence for append-only hot paths after a heartbeat discovers loss. */
	isFenced?(): boolean;
	release(): Promise<void>;
}

export interface SessionOwnershipOptions {
	readonly root?: string;
	readonly suppliedEpoch?: string;
	readonly suppliedSocket?: string;
}

interface LeaseLocation {
	readonly root: string;
	readonly parent: string;
	readonly claim: string;
	readonly leaseFile: string;
	readonly viewFile: string;
	readonly canonicalSessionFile: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProcessIdentity(value: unknown): value is ProcessIdentity {
	return (
		isRecord(value) &&
		typeof value.bootId === "string" &&
		typeof value.pid === "number" &&
		Number.isInteger(value.pid) &&
		typeof value.startFingerprint === "string"
	);
}

/** Decodes the closed owners-v1 filesystem boundary without importing agent-mux. */
export function decodeSessionLeaseV1(value: unknown): SessionLeaseV1 | null {
	if (!isRecord(value)) return null;
	const keys = Object.keys(value);
	if (
		keys.length !== 13 ||
		!keys.every(key =>
			[
				"version",
				"sessionFile",
				"sessionId",
				"ownerKind",
				"ownerEpoch",
				"muxName",
				"socketPath",
				"daemonProcess",
				"controllerProcess",
				"phase",
				"acquiredAtUnixMs",
				"heartbeatSeq",
				"heartbeatAtUnixMs",
			].includes(key),
		) ||
		value.version !== 1 ||
		typeof value.sessionFile !== "string" ||
		typeof value.sessionId !== "string" ||
		(value.ownerKind !== "agent-mux" && value.ownerKind !== "omp") ||
		typeof value.ownerEpoch !== "string" ||
		(value.muxName !== null && typeof value.muxName !== "string") ||
		typeof value.socketPath !== "string" ||
		(value.daemonProcess !== null && !isProcessIdentity(value.daemonProcess)) ||
		!isProcessIdentity(value.controllerProcess) ||
		(value.phase !== "acquiring" && value.phase !== "running" && value.phase !== "releasing") ||
		typeof value.acquiredAtUnixMs !== "number" ||
		typeof value.heartbeatSeq !== "number" ||
		typeof value.heartbeatAtUnixMs !== "number"
	)
		return null;
	return {
		version: 1,
		sessionFile: value.sessionFile,
		sessionId: value.sessionId,
		ownerKind: value.ownerKind,
		ownerEpoch: value.ownerEpoch,
		muxName: value.muxName,
		socketPath: value.socketPath,
		daemonProcess: value.daemonProcess,
		controllerProcess: value.controllerProcess,
		phase: value.phase,
		acquiredAtUnixMs: value.acquiredAtUnixMs,
		heartbeatSeq: value.heartbeatSeq,
		heartbeatAtUnixMs: value.heartbeatAtUnixMs,
	};
}

function isCmuxId(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Decodes the closed non-authoritative cmux owner-view filesystem boundary. */
export function decodeCmuxOwnerView(value: unknown): CmuxOwnerView | undefined {
	if (!isRecord(value)) return undefined;
	const keys = Object.keys(value);
	if (
		keys.length !== 3 ||
		!keys.every(key => ["version", "ownerEpoch", "cmux"].includes(key)) ||
		value.version !== 1 ||
		typeof value.ownerEpoch !== "string" ||
		value.ownerEpoch.length === 0 ||
		!isRecord(value.cmux) ||
		Object.keys(value.cmux).length !== 3 ||
		!Object.keys(value.cmux).every(key => ["workspaceId", "surfaceId", "socketPath"].includes(key)) ||
		!isCmuxId(value.cmux.workspaceId) ||
		!isCmuxId(value.cmux.surfaceId) ||
		typeof value.cmux.socketPath !== "string" ||
		value.cmux.socketPath.length === 0 ||
		!path.isAbsolute(value.cmux.socketPath)
	)
		return undefined;
	return {
		version: 1,
		ownerEpoch: value.ownerEpoch,
		cmux: {
			workspaceId: value.cmux.workspaceId,
			surfaceId: value.cmux.surfaceId,
			socketPath: value.cmux.socketPath,
		},
	};
}

/**
 * Resolves the shared agent-mux namespace used by ownership metadata and
 * durable session state.
 */
export function resolveAgentMuxRoot(explicitRoot?: string): string {
	if (explicitRoot !== undefined) return path.resolve(explicitRoot);
	const environmentRoot = process.env.AGENT_MUX_DIR;
	if (environmentRoot) return path.resolve(environmentRoot);
	return path.join(os.homedir(), ".agent-mux");
}

async function canonicalSessionFile(sessionFile: string): Promise<string> {
	const resolved = path.resolve(sessionFile);
	try {
		const stat = await fs.stat(resolved);
		if (!stat.isFile()) throw new Error(`Session resume target is not a regular file: ${sessionFile}`);
		return await fs.realpath(resolved);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const directory = await fs.realpath(path.dirname(resolved));
		return path.join(directory, path.basename(resolved));
	}
}

async function leaseLocation(sessionFile: string, sessionId: string, root?: string): Promise<LeaseLocation> {
	root = resolveAgentMuxRoot(root);
	const canonical = await canonicalSessionFile(sessionFile);
	const key = createHash("sha256").update(`${canonical}\0${sessionId}`).digest("hex");
	const parent = path.join(root, "owners-v1", key);
	const claim = path.join(parent, "claim");
	return {
		root,
		parent,
		claim,
		leaseFile: path.join(claim, "lease.json"),
		viewFile: path.join(claim, "view.json"),
		canonicalSessionFile: canonical,
	};
}

async function readLease(location: LeaseLocation): Promise<SessionLeaseV1 | null | "corrupt"> {
	try {
		const text = await fs.readFile(location.leaseFile, "utf8");
		try {
			return decodeSessionLeaseV1(JSON.parse(text));
		} catch {
			return "corrupt";
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		try {
			await fs.stat(location.claim);
			return "corrupt";
		} catch (claimError) {
			if ((claimError as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw claimError;
		}
	}
}

async function writeLease(location: LeaseLocation, lease: SessionLeaseV1): Promise<void> {
	const temp = path.join(location.claim, `.lease-${lease.ownerEpoch}.tmp`);
	await fs.writeFile(temp, JSON.stringify(lease));
	await fs.rename(temp, location.leaseFile);
}

function cmuxOwnerViewFromEnvironment(ownerEpoch: string): CmuxOwnerView | undefined {
	const workspaceId = process.env.CMUX_WORKSPACE_ID;
	const surfaceId = process.env.CMUX_SURFACE_ID;
	const socketPath = process.env.CMUX_SOCKET_PATH;
	if (!workspaceId || !surfaceId || !socketPath) return undefined;
	return decodeCmuxOwnerView({ version: 1, ownerEpoch, cmux: { workspaceId, surfaceId, socketPath } });
}

async function writeCmuxOwnerView(location: LeaseLocation, view: CmuxOwnerView): Promise<void> {
	const temp = path.join(location.claim, `.view-${view.ownerEpoch}.tmp`);
	await fs.writeFile(temp, JSON.stringify(view));
	await fs.rename(temp, location.viewFile);
}

async function readCmuxOwnerView(location: LeaseLocation): Promise<CmuxOwnerView | undefined> {
	try {
		return decodeCmuxOwnerView(JSON.parse(await fs.readFile(location.viewFile, "utf8")));
	} catch {
		return undefined;
	}
}
function commandOutput(command: string[]): string {
	const result = Bun.spawnSync({ cmd: command, stdout: "pipe", stderr: "ignore" });
	return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim().replace(/\s+/g, " ") : "";
}

function processIdentityFor(pid: number): ProcessIdentity | null {
	const bootId = commandOutput(["/usr/sbin/sysctl", "-n", "kern.boottime"]);
	const startFingerprint = commandOutput(["/bin/ps", "-o", "lstart=", "-p", String(pid)]);
	return bootId && startFingerprint ? { bootId, pid, startFingerprint } : null;
}

function processMatches(identity: ProcessIdentity): boolean {
	const current = processIdentityFor(identity.pid);
	return (
		current !== null && current.bootId === identity.bootId && current.startFingerprint === identity.startFingerprint
	);
}

async function probeLease(lease: SessionLeaseV1): Promise<boolean> {
	const nonce = randomUUID();
	const result = Promise.withResolvers<boolean>();
	const socket = net.createConnection(lease.socketPath);
	let body = "";
	let settled = false;
	const finish = (value: boolean): void => {
		if (settled) return;
		settled = true;
		socket.destroy();
		result.resolve(value);
	};
	const timeout = setTimeout(() => finish(false), 500);
	socket.once("error", () => {
		clearTimeout(timeout);
		finish(false);
	});
	socket.on("data", chunk => {
		body += chunk.toString();
		const newline = body.indexOf("\n");
		if (newline < 0) return;
		clearTimeout(timeout);
		try {
			const proof: unknown = JSON.parse(body.slice(0, newline));
			finish(
				isRecord(proof) &&
					proof.t === "ownerProof" &&
					proof.nonce === nonce &&
					proof.ownerEpoch === lease.ownerEpoch &&
					proof.sessionMatch === true &&
					proof.phase === lease.phase,
			);
		} catch {
			finish(false);
		}
	});
	socket.once("connect", () =>
		socket.write(
			`${JSON.stringify({ t: "ownerProbe", nonce, expectedEpoch: lease.ownerEpoch, sessionFile: lease.sessionFile, sessionId: lease.sessionId })}\n`,
		),
	);
	return result.promise;
}

function processIdentity(): ProcessIdentity {
	return (
		processIdentityFor(process.pid) ?? { bootId: "unavailable", pid: process.pid, startFingerprint: "unavailable" }
	);
}

class DirectOwnershipHandle implements SessionOwnershipHandle {
	readonly #location: LeaseLocation;
	readonly sessionFile: string;
	readonly sessionId: string;
	readonly ownerEpoch: string;
	readonly ownerKind = "omp" as const;
	#released = false;
	#heartbeat: ReturnType<typeof setInterval> | undefined;

	constructor(location: LeaseLocation, lease: SessionLeaseV1) {
		this.#location = location;
		this.sessionFile = lease.sessionFile;
		this.sessionId = lease.sessionId;
		this.ownerEpoch = lease.ownerEpoch;
		this.#heartbeat = setInterval(() => void this.#beat(), 2_000);
		this.#heartbeat.unref?.();
	}

	async isCurrent(): Promise<boolean> {
		if (this.#released) return false;
		const lease = await readLease(this.#location);
		return lease !== null && lease !== "corrupt" && lease.ownerEpoch === this.ownerEpoch && lease.phase === "running";
	}

	async #beat(): Promise<void> {
		const lease = await readLease(this.#location);
		if (lease === null || lease === "corrupt" || lease.ownerEpoch !== this.ownerEpoch || lease.phase !== "running") {
			this.#released = true;
			clearInterval(this.#heartbeat);
			return;
		}
		await writeLease(this.#location, {
			...lease,
			heartbeatSeq: lease.heartbeatSeq + 1,
			heartbeatAtUnixMs: Date.now(),
		}).catch(() => {
			this.#released = true;
		});
	}

	isFenced(): boolean {
		return this.#released;
	}

	async release(): Promise<void> {
		if (this.#released) return;
		this.#released = true;
		clearInterval(this.#heartbeat);
		const lease = await readLease(this.#location);
		if (lease === null || lease === "corrupt" || lease.ownerEpoch !== this.ownerEpoch) return;
		await writeLease(this.#location, { ...lease, phase: "releasing" });
		const retired = path.join(this.#location.parent, `retired-${this.ownerEpoch}`);
		try {
			await fs.rename(this.#location.claim, retired);
			await fs.rm(retired, { recursive: true, force: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

class MuxOwnershipHandle implements SessionOwnershipHandle {
	readonly ownerKind = "agent-mux" as const;
	readonly #location: LeaseLocation;
	constructor(
		readonly sessionFile: string,
		readonly sessionId: string,
		readonly ownerEpoch: string,
		location: LeaseLocation,
	) {
		this.#location = location;
	}
	async isCurrent(): Promise<boolean> {
		const lease = await readLease(this.#location);
		return lease !== null && lease !== "corrupt" && lease.ownerEpoch === this.ownerEpoch && lease.phase === "running";
	}
	async release(): Promise<void> {}
}

export async function inspectSessionOwnership(
	sessionFile: string,
	sessionId: string,
	options: SessionOwnershipOptions = {},
): Promise<SessionOwnershipLookup> {
	const location = await leaseLocation(sessionFile, sessionId, options.root);
	const lease = await readLease(location);
	if (lease === null) return { status: "none" };
	if (lease === "corrupt") return { status: "suspect", reason: "owner_record_corrupt" };
	if (lease.sessionFile !== location.canonicalSessionFile || lease.sessionId !== sessionId) {
		return { status: "suspect", reason: "owner_record_corrupt", lease };
	}
	if (await probeLease(lease)) return { status: "live", lease };
	if (
		processMatches(lease.controllerProcess) ||
		(lease.daemonProcess !== null && processMatches(lease.daemonProcess))
	) {
		return { status: "suspect", reason: "external_owner_unverifiable", lease };
	}
	return { status: "stale", lease };
}

/**
 * Returns cmux navigation metadata for a currently live owner, when its sidecar
 * still belongs to that owner epoch. This never influences lease ownership.
 */
export async function inspectLiveSessionOwnerView(
	sessionFile: string,
	sessionId: string,
	options: SessionOwnershipOptions = {},
): Promise<CmuxOwnerView | undefined> {
	const ownership = await inspectSessionOwnership(sessionFile, sessionId, options);
	if (ownership.status !== "live") return undefined;
	const view = await readCmuxOwnerView(await leaseLocation(sessionFile, sessionId, options.root));
	return view?.ownerEpoch === ownership.lease.ownerEpoch ? view : undefined;
}

export async function acquireSessionOwnership(
	sessionFile: string,
	sessionId: string,
	options: SessionOwnershipOptions = {},
): Promise<SessionOwnershipHandle> {
	const location = await leaseLocation(sessionFile, sessionId, options.root);
	if (options.suppliedEpoch) {
		const lease = await readLease(location);
		if (
			lease === null ||
			lease === "corrupt" ||
			lease.ownerKind !== "agent-mux" ||
			lease.ownerEpoch !== options.suppliedEpoch ||
			lease.socketPath !== options.suppliedSocket ||
			lease.phase !== "running"
		)
			throw new ExternalSessionOwnerUnverifiable("external_owner_unverifiable");
		return new MuxOwnershipHandle(location.canonicalSessionFile, sessionId, lease.ownerEpoch, location);
	}
	let current = await inspectSessionOwnership(sessionFile, sessionId, options);
	if (current.status === "live") throw new ExternalSessionOwner(current.lease);
	if (current.status === "suspect") throw new ExternalSessionOwnerUnverifiable(current.reason);
	if (current.status === "stale") {
		const retired = path.join(location.parent, `retired-${current.lease.ownerEpoch}`);
		await fs.rename(location.claim, retired).catch(error => {
			throw new ExternalSessionOwnerUnverifiable(
				(error as NodeJS.ErrnoException).code === "ENOENT" ? "external_owner_unverifiable" : "owner_record_corrupt",
			);
		});
	}
	await fs.mkdir(location.parent, { recursive: true });
	try {
		await fs.mkdir(location.claim);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			current = await inspectSessionOwnership(sessionFile, sessionId, options);
			if (current.status === "stale") throw new ExternalSessionOwnerUnverifiable("external_owner_unverifiable");
			if (current.status === "live") throw new ExternalSessionOwner(current.lease);
			throw new ExternalSessionOwnerUnverifiable(
				current.status === "suspect" ? current.reason : "external_owner_unverifiable",
			);
		}
		throw error;
	}
	const epoch = randomUUID();
	const lease: SessionLeaseV1 = {
		version: 1,
		sessionFile: location.canonicalSessionFile,
		sessionId,
		ownerKind: "omp",
		ownerEpoch: epoch,
		muxName: null,
		socketPath: path.join(location.claim, "owner.sock"),
		daemonProcess: null,
		controllerProcess: processIdentity(),
		phase: "acquiring",
		acquiredAtUnixMs: Date.now(),
		heartbeatSeq: 0,
		heartbeatAtUnixMs: Date.now(),
	};
	try {
		await writeLease(location, lease);
		const runningLease = { ...lease, phase: "running" as const, heartbeatSeq: 1, heartbeatAtUnixMs: Date.now() };
		await writeLease(location, runningLease);
		const view = cmuxOwnerViewFromEnvironment(epoch);
		if (view) await writeCmuxOwnerView(location, view).catch(() => {});
		return new DirectOwnershipHandle(location, lease);
	} catch (error) {
		await fs.rm(location.claim, { recursive: true, force: true });
		throw error;
	}
}
