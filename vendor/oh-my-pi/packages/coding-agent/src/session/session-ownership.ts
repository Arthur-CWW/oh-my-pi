import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { BuildRevision, RunnerInstanceIdentity } from "../runner/protocol";

export interface ProcessIdentity {
	readonly bootId: string;
	readonly pid: number;
	readonly startFingerprint: string;
}

export interface SessionOwnerIdentity {
	readonly buildRevision: BuildRevision;
	readonly runnerInstanceId: string;
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
	readonly buildRevision?: BuildRevision;
	readonly runnerInstanceId?: string;
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
	readonly buildRevision: BuildRevision;
	readonly runnerInstanceIdentity: RunnerInstanceIdentity;
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

export interface SessionOwnershipAcquisitionOptions extends SessionOwnershipOptions {
	readonly buildRevision: BuildRevision;
	readonly runnerInstanceIdentity: RunnerInstanceIdentity;
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
		Object.keys(value).length === 3 &&
		Object.keys(value).every(key => ["bootId", "pid", "startFingerprint"].includes(key)) &&
		typeof value.bootId === "string" &&
		typeof value.pid === "number" &&
		Number.isInteger(value.pid) &&
		typeof value.startFingerprint === "string"
	);
}

function isBuildRevision(value: unknown): value is BuildRevision {
	return (
		isRecord(value) &&
		Object.keys(value).length === 2 &&
		Object.keys(value).every(key => ["digest", "version"].includes(key)) &&
		typeof value.digest === "string" &&
		/^[0-9a-f]{64}$/.test(value.digest) &&
		typeof value.version === "string" &&
		value.version.length > 0 &&
		value.version === value.version.trim()
	);
}

function sameBuildRevision(left: BuildRevision, right: BuildRevision): boolean {
	return left.digest === right.digest && left.version === right.version;
}

function leaseMatchesEpoch(lease: SessionLeaseV1, ownerEpoch: string): boolean {
	return lease.ownerEpoch === ownerEpoch;
}

function isUuid(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
	);
}

/** Decodes the closed owners-v1 filesystem boundary without importing agent-mux. */
export function decodeSessionLeaseV1(value: unknown): SessionLeaseV1 | null {
	if (!isRecord(value)) return null;
	const keys = Object.keys(value);
	const allowedKeys = [
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
		"buildRevision",
		"runnerInstanceId",
	];
	if (
		(keys.length !== 13 && keys.length !== 15) ||
		!keys.every(key => allowedKeys.includes(key)) ||
		("buildRevision" in value) !== ("runnerInstanceId" in value) ||
		value.version !== 1 ||
		typeof value.sessionFile !== "string" ||
		value.sessionFile.length === 0 ||
		typeof value.sessionId !== "string" ||
		value.sessionId.length === 0 ||
		(value.ownerKind !== "agent-mux" && value.ownerKind !== "omp") ||
		!isUuid(value.ownerEpoch) ||
		(value.muxName !== null && (typeof value.muxName !== "string" || value.muxName.length === 0)) ||
		typeof value.socketPath !== "string" ||
		value.socketPath.length === 0 ||
		(value.daemonProcess !== null && !isProcessIdentity(value.daemonProcess)) ||
		!isProcessIdentity(value.controllerProcess) ||
		(value.phase !== "acquiring" && value.phase !== "running" && value.phase !== "releasing") ||
		typeof value.acquiredAtUnixMs !== "number" ||
		!Number.isSafeInteger(value.acquiredAtUnixMs) ||
		value.acquiredAtUnixMs < 0 ||
		typeof value.heartbeatSeq !== "number" ||
		!Number.isSafeInteger(value.heartbeatSeq) ||
		value.heartbeatSeq < 0 ||
		typeof value.heartbeatAtUnixMs !== "number" ||
		!Number.isSafeInteger(value.heartbeatAtUnixMs) ||
		value.heartbeatAtUnixMs < 0 ||
		(value.buildRevision !== undefined && !isBuildRevision(value.buildRevision)) ||
		(value.runnerInstanceId !== undefined && !isUuid(value.runnerInstanceId))
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
		...(value.buildRevision === undefined
			? {}
			: { buildRevision: value.buildRevision, runnerInstanceId: value.runnerInstanceId as string }),
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

interface OwnerIdentitySidecarV1 {
	readonly version: 1;
	readonly ownerEpoch: string;
	readonly buildRevision: BuildRevision;
	readonly runnerInstanceId: string;
}

function decodeOwnerIdentitySidecarV1(value: unknown): OwnerIdentitySidecarV1 | undefined {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== 4 ||
		!Object.keys(value).every(key => ["version", "ownerEpoch", "buildRevision", "runnerInstanceId"].includes(key)) ||
		value.version !== 1 ||
		!isUuid(value.ownerEpoch) ||
		!isBuildRevision(value.buildRevision) ||
		!isUuid(value.runnerInstanceId)
	)
		return undefined;
	return value as unknown as OwnerIdentitySidecarV1;
}

function ownerIdentityFile(location: LeaseLocation, ownerEpoch: string): string {
	return path.join(location.claim, `identity-v1-${ownerEpoch}.json`);
}

async function readOwnerIdentity(location: LeaseLocation): Promise<OwnerIdentitySidecarV1 | undefined> {
	try {
		const lease = await readLease(location);
		if (lease === null || lease === "corrupt") return undefined;
		return decodeOwnerIdentitySidecarV1(
			JSON.parse(await fs.readFile(ownerIdentityFile(location, lease.ownerEpoch), "utf8")),
		);
	} catch {
		return undefined;
	}
}

async function writeOwnerIdentity(location: LeaseLocation, identity: OwnerIdentitySidecarV1): Promise<void> {
	const temp = path.join(location.claim, `.identity-${identity.ownerEpoch}.tmp`);
	await fs.writeFile(temp, JSON.stringify(identity));
	const lease = await readLease(location);
	if (lease === null || lease === "corrupt" || !leaseMatchesEpoch(lease, identity.ownerEpoch)) {
		await fs.rm(temp, { force: true });
		throw new ExternalSessionOwnerUnverifiable("external_owner_unverifiable");
	}
	try {
		await fs.rename(temp, ownerIdentityFile(location, identity.ownerEpoch));
	} catch (error) {
		await fs.rm(temp, { force: true }).catch(() => {});
		throw error;
	}
}

function identityMatches(
	identity: OwnerIdentitySidecarV1 | undefined,
	ownerEpoch: string,
	buildRevision: BuildRevision,
	runnerInstanceId: string,
): boolean {
	return (
		identity !== undefined &&
		identity.ownerEpoch === ownerEpoch &&
		sameBuildRevision(identity.buildRevision, buildRevision) &&
		identity.runnerInstanceId === runnerInstanceId
	);
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

interface OwnerProof {
	readonly t: "ownerProof";
	readonly nonce: string;
	readonly ownerEpoch: string;
	readonly buildRevision?: BuildRevision;
	readonly runnerInstanceId?: string;
	readonly sessionMatch: true;
	readonly phase: SessionLeaseV1["phase"];
}

function decodeOwnerProof(value: unknown): OwnerProof | undefined {
	if (
		!isRecord(value) ||
		(Object.keys(value).length !== 5 && Object.keys(value).length !== 7) ||
		!Object.keys(value).every(key =>
			["t", "nonce", "ownerEpoch", "buildRevision", "runnerInstanceId", "sessionMatch", "phase"].includes(key),
		) ||
		("buildRevision" in value) !== ("runnerInstanceId" in value) ||
		value.t !== "ownerProof" ||
		typeof value.nonce !== "string" ||
		!isUuid(value.ownerEpoch) ||
		(value.buildRevision !== undefined && !isBuildRevision(value.buildRevision)) ||
		(value.runnerInstanceId !== undefined && !isUuid(value.runnerInstanceId)) ||
		value.sessionMatch !== true ||
		(value.phase !== "acquiring" && value.phase !== "running" && value.phase !== "releasing")
	)
		return undefined;
	return value as unknown as OwnerProof;
}
async function probeLease(lease: SessionLeaseV1, identity?: OwnerIdentitySidecarV1): Promise<boolean> {
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
			const proof = decodeOwnerProof(JSON.parse(body.slice(0, newline)));
			finish(
				proof !== undefined &&
					proof.nonce === nonce &&
					leaseMatchesEpoch(lease, proof.ownerEpoch) &&
					(identity === undefined ||
						(proof.buildRevision !== undefined &&
							proof.runnerInstanceId !== undefined &&
							sameBuildRevision(identity.buildRevision, proof.buildRevision) &&
							identity.runnerInstanceId === proof.runnerInstanceId)) &&
					proof.phase === lease.phase,
			);
		} catch {
			finish(false);
		}
	});
	socket.once("connect", () =>
		socket.write(
			`${JSON.stringify({
				t: "ownerProbe",
				nonce,
				expectedEpoch: lease.ownerEpoch,
				...(identity === undefined
					? {}
					: {
							expectedBuildRevision: identity.buildRevision,
							expectedRunnerInstanceId: identity.runnerInstanceId,
						}),
				sessionFile: lease.sessionFile,
				sessionId: lease.sessionId,
			})}\n`,
		),
	);
	return result.promise;
}

function processIdentity(): ProcessIdentity {
	return (
		processIdentityFor(process.pid) ?? { bootId: "unavailable", pid: process.pid, startFingerprint: "unavailable" }
	);
}

interface OwnerProbe {
	readonly t: "ownerProbe";
	readonly nonce: string;
	readonly expectedEpoch: string;
	readonly expectedBuildRevision: BuildRevision;
	readonly expectedRunnerInstanceId: string;
	readonly sessionFile: string;
	readonly sessionId: string;
}

function decodeOwnerProbe(value: unknown): OwnerProbe | undefined {
	if (!isRecord(value)) return undefined;
	const keys = Object.keys(value);
	if (
		keys.length !== 7 ||
		!keys.every(key =>
			[
				"t",
				"nonce",
				"expectedEpoch",
				"expectedBuildRevision",
				"expectedRunnerInstanceId",
				"sessionFile",
				"sessionId",
			].includes(key),
		) ||
		value.t !== "ownerProbe" ||
		typeof value.nonce !== "string" ||
		value.nonce.length === 0 ||
		!isUuid(value.expectedEpoch) ||
		!isBuildRevision(value.expectedBuildRevision) ||
		typeof value.expectedRunnerInstanceId !== "string" ||
		!isUuid(value.expectedRunnerInstanceId) ||
		typeof value.sessionFile !== "string" ||
		typeof value.sessionId !== "string"
	)
		return undefined;
	return {
		t: "ownerProbe",
		nonce: value.nonce,
		expectedEpoch: value.expectedEpoch,
		expectedBuildRevision: value.expectedBuildRevision,
		expectedRunnerInstanceId: value.expectedRunnerInstanceId,
		sessionFile: value.sessionFile,
		sessionId: value.sessionId,
	};
}

class DirectOwnerProbeServer {
	readonly #location: LeaseLocation;
	readonly #lease: SessionLeaseV1;
	readonly #identity: OwnerIdentitySidecarV1;
	readonly #server: net.Server;
	readonly #sockets = new Set<net.Socket>();
	#live = false;
	#closing: Promise<void> | undefined;

	constructor(location: LeaseLocation, lease: SessionLeaseV1, identity: OwnerIdentitySidecarV1) {
		this.#location = location;
		this.#lease = lease;
		this.#identity = identity;
		this.#server = net.createServer(socket => this.#serve(socket));
		this.#server.on("error", () => void this.close().catch(() => {}));
	}

	async listen(): Promise<void> {
		const listening = Promise.withResolvers<void>();
		const onError = (error: Error): void => listening.reject(error);
		this.#server.once("error", onError);
		this.#server.listen(this.#lease.socketPath, () => {
			this.#server.off("error", onError);
			this.#server.unref();
			listening.resolve();
		});
		await listening.promise;
	}

	activate(): void {
		this.#live = true;
	}

	async close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#live = false;
		this.#closing = (async () => {
			for (const socket of this.#sockets) socket.destroy();
			if (this.#server.listening) {
				await new Promise<void>((resolve, reject) =>
					this.#server.close(error => (error ? reject(error) : resolve())),
				);
			}
			await fs.rm(this.#lease.socketPath, { force: true });
		})();
		return this.#closing;
	}

	#serve(socket: net.Socket): void {
		this.#sockets.add(socket);
		socket.once("close", () => this.#sockets.delete(socket));
		let body = "";
		let handled = false;
		const reject = (): void => {
			handled = true;
			socket.destroy();
		};
		socket.on("data", chunk => {
			if (handled) return;
			body += chunk.toString();
			if (body.length > 16_384) {
				reject();
				return;
			}
			const newline = body.indexOf("\n");
			if (newline < 0) return;
			if (newline !== body.length - 1) {
				reject();
				return;
			}
			handled = true;
			let probe: OwnerProbe | undefined;
			try {
				probe = decodeOwnerProbe(JSON.parse(body.slice(0, newline)));
			} catch {
				socket.destroy();
				return;
			}
			if (
				!probe ||
				!this.#live ||
				probe.expectedEpoch !== this.#identity.ownerEpoch ||
				!sameBuildRevision(probe.expectedBuildRevision, this.#identity.buildRevision) ||
				probe.expectedRunnerInstanceId !== this.#identity.runnerInstanceId ||
				probe.sessionFile !== this.#lease.sessionFile ||
				probe.sessionId !== this.#lease.sessionId
			) {
				socket.destroy();
				return;
			}
			void this.#reply(socket, probe);
		});
		socket.once("end", () => {
			if (!handled) socket.destroy();
		});
		socket.once("error", () => {});
	}

	async #reply(socket: net.Socket, probe: OwnerProbe): Promise<void> {
		const [lease, identity] = await Promise.all([
			readLease(this.#location).catch(() => null),
			readOwnerIdentity(this.#location).catch(() => undefined),
		]);
		if (
			!this.#live ||
			lease === null ||
			lease === "corrupt" ||
			!leaseMatchesEpoch(lease, this.#identity.ownerEpoch) ||
			!identityMatches(
				identity,
				this.#identity.ownerEpoch,
				this.#identity.buildRevision,
				this.#identity.runnerInstanceId,
			) ||
			lease.sessionFile !== this.#lease.sessionFile ||
			lease.sessionId !== this.#lease.sessionId ||
			lease.phase !== "running"
		) {
			socket.destroy();
			return;
		}
		socket.end(
			`${JSON.stringify({
				t: "ownerProof",
				nonce: probe.nonce,
				ownerEpoch: lease.ownerEpoch,
				buildRevision: this.#identity.buildRevision,
				runnerInstanceId: this.#identity.runnerInstanceId,
				sessionMatch: true,
				phase: lease.phase,
			})}\n`,
		);
	}
}

class DirectOwnershipHandle implements SessionOwnershipHandle {
	readonly #location: LeaseLocation;
	readonly #probeServer: DirectOwnerProbeServer;
	readonly sessionFile: string;
	readonly sessionId: string;
	readonly ownerEpoch: string;
	readonly ownerKind = "omp" as const;
	readonly buildRevision: BuildRevision;
	readonly runnerInstanceIdentity: RunnerInstanceIdentity;
	#released = false;
	#heartbeat: ReturnType<typeof setInterval> | undefined;
	#heartbeatTask: Promise<void> | undefined;

	constructor(
		location: LeaseLocation,
		lease: SessionLeaseV1,
		buildRevision: BuildRevision,
		runnerInstanceIdentity: RunnerInstanceIdentity,
		probeServer: DirectOwnerProbeServer,
	) {
		this.#location = location;
		this.#probeServer = probeServer;
		this.sessionFile = lease.sessionFile;
		this.sessionId = lease.sessionId;
		this.ownerEpoch = lease.ownerEpoch;
		this.buildRevision = buildRevision;
		this.runnerInstanceIdentity = runnerInstanceIdentity;
		this.#heartbeat = setInterval(() => {
			if (this.#heartbeatTask) return;
			const task = this.#beat();
			this.#heartbeatTask = task;
			void task.then(
				() => {
					if (this.#heartbeatTask === task) this.#heartbeatTask = undefined;
				},
				() => {
					if (this.#heartbeatTask === task) this.#heartbeatTask = undefined;
				},
			);
		}, 2_000);
		this.#heartbeat.unref?.();
	}

	async isCurrent(): Promise<boolean> {
		if (this.#released) return false;
		const [lease, identity] = await Promise.all([readLease(this.#location), readOwnerIdentity(this.#location)]);
		return (
			lease !== null &&
			lease !== "corrupt" &&
			leaseMatchesEpoch(lease, this.ownerEpoch) &&
			identityMatches(identity, this.ownerEpoch, this.buildRevision, this.runnerInstanceIdentity.runnerInstanceId) &&
			lease.phase === "running"
		);
	}

	async #fence(): Promise<void> {
		if (this.#released) return;
		this.#released = true;
		clearInterval(this.#heartbeat);
		await this.#probeServer.close();
	}

	async #beat(): Promise<void> {
		const [lease, identity] = await Promise.all([
			readLease(this.#location).catch(() => null),
			readOwnerIdentity(this.#location).catch(() => undefined),
		]);
		if (
			this.#released ||
			lease === null ||
			lease === "corrupt" ||
			!leaseMatchesEpoch(lease, this.ownerEpoch) ||
			!identityMatches(identity, this.ownerEpoch, this.buildRevision, this.runnerInstanceIdentity.runnerInstanceId) ||
			lease.phase !== "running"
		) {
			await this.#fence();
			return;
		}
		if (this.#released) return;
		try {
			await writeLease(this.#location, {
				...lease,
				heartbeatSeq: lease.heartbeatSeq + 1,
				heartbeatAtUnixMs: Date.now(),
			});
		} catch {
			await this.#fence();
		}
	}

	isFenced(): boolean {
		return this.#released;
	}

	async release(): Promise<void> {
		if (this.#released) {
			await this.#probeServer.close();
			return;
		}
		this.#released = true;
		clearInterval(this.#heartbeat);
		await this.#heartbeatTask;
		const [lease, identity] = await Promise.all([readLease(this.#location), readOwnerIdentity(this.#location)]);
		if (
			lease === null ||
			lease === "corrupt" ||
			!leaseMatchesEpoch(lease, this.ownerEpoch) ||
			!identityMatches(identity, this.ownerEpoch, this.buildRevision, this.runnerInstanceIdentity.runnerInstanceId)
		) {
			await this.#probeServer.close();
			return;
		}
		try {
			await writeLease(this.#location, { ...lease, phase: "releasing" });
		} finally {
			await this.#probeServer.close();
		}
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
		readonly buildRevision: BuildRevision,
		readonly runnerInstanceIdentity: RunnerInstanceIdentity,
		location: LeaseLocation,
	) {
		this.#location = location;
	}
	async isCurrent(): Promise<boolean> {
		const [lease, identity] = await Promise.all([readLease(this.#location), readOwnerIdentity(this.#location)]);
		return (
			lease !== null &&
			lease !== "corrupt" &&
			leaseMatchesEpoch(lease, this.ownerEpoch) &&
			identityMatches(identity, this.ownerEpoch, this.buildRevision, this.runnerInstanceIdentity.runnerInstanceId) &&
			lease.phase === "running"
		);
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
	if (await probeLease(lease, lease.ownerKind === "omp" ? await readOwnerIdentity(location) : undefined))
		return { status: "live", lease };
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
	options: SessionOwnershipAcquisitionOptions,
): Promise<SessionOwnershipHandle> {
	if (
		!isBuildRevision(options.buildRevision) ||
		!isUuid(options.runnerInstanceIdentity.runnerInstanceId) ||
		!Number.isFinite(Date.parse(options.runnerInstanceIdentity.startedAt)) ||
		new Date(Date.parse(options.runnerInstanceIdentity.startedAt)).toISOString() !==
			options.runnerInstanceIdentity.startedAt
	)
		throw new ExternalSessionOwnerUnverifiable("owner_record_corrupt");
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
		const identity = {
			version: 1 as const,
			ownerEpoch: lease.ownerEpoch,
			buildRevision: options.buildRevision,
			runnerInstanceId: options.runnerInstanceIdentity.runnerInstanceId,
		};
		await writeOwnerIdentity(location, identity);
		const confirmed = await readLease(location);
		if (
			confirmed === null ||
			confirmed === "corrupt" ||
			confirmed.ownerEpoch !== lease.ownerEpoch ||
			confirmed.socketPath !== lease.socketPath ||
			confirmed.phase !== "running"
		)
			throw new ExternalSessionOwnerUnverifiable("external_owner_unverifiable");
		return new MuxOwnershipHandle(
			location.canonicalSessionFile,
			sessionId,
			lease.ownerEpoch,
			options.buildRevision,
			options.runnerInstanceIdentity,
			location,
		);
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
	const identity = {
		version: 1 as const,
		ownerEpoch: epoch,
		buildRevision: options.buildRevision,
		runnerInstanceId: options.runnerInstanceIdentity.runnerInstanceId,
	};
	let probeServer: DirectOwnerProbeServer | undefined;
	try {
		await writeLease(location, lease);
		await writeOwnerIdentity(location, identity);
		probeServer = new DirectOwnerProbeServer(location, lease, identity);
		await probeServer.listen();
		const runningLease = { ...lease, phase: "running" as const, heartbeatSeq: 1, heartbeatAtUnixMs: Date.now() };
		await writeLease(location, runningLease);
		probeServer.activate();
		const view = cmuxOwnerViewFromEnvironment(epoch);
		if (view) await writeCmuxOwnerView(location, view).catch(() => {});
		return new DirectOwnershipHandle(
			location,
			runningLease,
			options.buildRevision,
			options.runnerInstanceIdentity,
			probeServer,
		);
	} catch (error) {
		await probeServer?.close().catch(() => {});
		await fs.rm(location.claim, { recursive: true, force: true });
		throw error;
	}
}
