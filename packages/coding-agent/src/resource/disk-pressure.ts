import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { Schema } from "effect";

export const GIB = 1024 ** 3;
const DARWIN_APFS_FILESYSTEM_TYPE = 0x1a;

export type DiskPressureState = "normal" | "warning" | "blocking" | "emergency" | "unavailable";
export type DiskOperationKind = "heavy" | "readOnly" | "status" | "cleanup" | "offload" | "alreadyRunning";

export interface DiskPressureThreshold {
	readonly bytes: number;
	readonly percent: number;
}

export interface DiskPressureThresholds {
	readonly warning: DiskPressureThreshold;
	readonly blocking: DiskPressureThreshold;
	readonly emergency: DiskPressureThreshold;
	readonly hysteresis: DiskPressureThreshold;
}

export const DEFAULT_DISK_PRESSURE_THRESHOLDS: DiskPressureThresholds = {
	warning: { bytes: 50 * GIB, percent: 10 },
	blocking: { bytes: 20 * GIB, percent: 5 },
	emergency: { bytes: 10 * GIB, percent: 2 },
	hysteresis: { bytes: 2 * GIB, percent: 1 },
};

const StatfsBoundarySchema = Schema.Struct({
	type: Schema.Number,
	bsize: Schema.Number,
	blocks: Schema.Number,
	bfree: Schema.Number,
	bavail: Schema.Number,
});

const DiskPressureReceiptSchema = Schema.Struct({
	version: Schema.Literal(1),
	state: Schema.Literals(["normal", "warning", "blocking", "emergency", "unavailable"]),
	notifiedState: Schema.NullOr(Schema.Literals(["normal", "warning", "blocking", "emergency", "unavailable"])),
	observedAt: Schema.String,
	freeBytes: Schema.NullOr(Schema.Number),
	totalBytes: Schema.NullOr(Schema.Number),
	freePercent: Schema.NullOr(Schema.Number),
});

export interface StatfsBoundary {
	readonly type: number;
	readonly bsize: number;
	readonly blocks: number;
	readonly bfree: number;
	readonly bavail: number;
}

export interface DiskPressureReceipt {
	readonly version: 1;
	readonly state: DiskPressureState;
	readonly notifiedState: DiskPressureState | null;
	readonly observedAt: string;
	readonly freeBytes: number | null;
	readonly totalBytes: number | null;
	readonly freePercent: number | null;
}

export interface DiskPressureProjection {
	readonly state: DiskPressureState;
	readonly measuredState: DiskPressureState;
	readonly observedAt: string;
	readonly targetPath: string;
	readonly filesystem: "apfs" | "other" | null;
	readonly filesystemType: number | null;
	readonly freeBytes: number | null;
	readonly totalBytes: number | null;
	readonly freePercent: number | null;
	readonly thresholds: DiskPressureThresholds;
	readonly previousState: DiskPressureState | null;
	readonly wouldNotify: boolean;
	readonly notificationDelivered: boolean;
	readonly reason: string | null;
}

export interface DiskAdmissionDecision {
	readonly admitted: boolean;
	readonly operation: DiskOperationKind;
	readonly projection: DiskPressureProjection;
	readonly reason: string | null;
}

export type StatfsProbe = (targetPath: string) => Promise<unknown>;
export type DiskPressureNotifier = (projection: DiskPressureProjection) => Promise<void>;

export interface ProbeDiskPressureOptions {
	readonly targetPath?: string;
	readonly thresholds?: DiskPressureThresholds;
	readonly stateFile?: string | null;
	readonly statfs?: StatfsProbe;
	readonly notifier?: DiskPressureNotifier;
	readonly notify?: boolean;
	readonly dryRun?: boolean;
	readonly now?: () => Date;
}

const severity: Readonly<Record<DiskPressureState, number>> = {
	normal: 0,
	warning: 1,
	blocking: 2,
	emergency: 3,
	unavailable: 4,
};

/**
 * `statfs.type` is a filesystem magic number — an opaque bit pattern, not a
 * quantity. Any magic with the high bit set is delivered as a negative signed
 * value, so a non-negativity check rejects the filesystem outright. bcachefs
 * (`0xCA451A4E`) arrives as `-901440946` and previously failed the probe, which
 * made every child spawn on a bcachefs host abort with
 * "Disk pressure probe unavailable". Validate that it is representable, and
 * nothing more.
 */
function assertSafeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value)) {
		throw new Error(`statfs ${name} must be a safe integer`);
	}
}

function assertFiniteNonNegativeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`statfs ${name} must be a non-negative safe integer`);
	}
}

export function decodeStatfsBoundary(input: unknown): StatfsBoundary {
	const decoded = Schema.decodeUnknownSync(StatfsBoundarySchema)(input);
	assertSafeInteger(decoded.type, "type");
	assertFiniteNonNegativeInteger(decoded.bsize, "bsize");
	assertFiniteNonNegativeInteger(decoded.blocks, "blocks");
	assertFiniteNonNegativeInteger(decoded.bfree, "bfree");
	assertFiniteNonNegativeInteger(decoded.bavail, "bavail");
	if (decoded.bsize === 0 || decoded.blocks === 0) throw new Error("statfs volume size must be positive");
	if (decoded.bavail > decoded.blocks || decoded.bfree > decoded.blocks) {
		throw new Error("statfs free blocks exceed volume blocks");
	}
	return decoded;
}

function validateThreshold(name: string, threshold: DiskPressureThreshold): void {
	if (!Number.isSafeInteger(threshold.bytes) || threshold.bytes < 0) {
		throw new Error(`${name} byte threshold must be a non-negative safe integer`);
	}
	if (!Number.isFinite(threshold.percent) || threshold.percent < 0 || threshold.percent > 100) {
		throw new Error(`${name} percent threshold must be between 0 and 100`);
	}
}

export function validateDiskPressureThresholds(thresholds: DiskPressureThresholds): DiskPressureThresholds {
	validateThreshold("warning", thresholds.warning);
	validateThreshold("blocking", thresholds.blocking);
	validateThreshold("emergency", thresholds.emergency);
	validateThreshold("hysteresis", thresholds.hysteresis);
	if (
		thresholds.warning.bytes < thresholds.blocking.bytes ||
		thresholds.blocking.bytes < thresholds.emergency.bytes ||
		thresholds.warning.percent < thresholds.blocking.percent ||
		thresholds.blocking.percent < thresholds.emergency.percent
	) {
		throw new Error("disk pressure thresholds must descend from warning to blocking to emergency");
	}
	return thresholds;
}

function envNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
	const raw = env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
	return value;
}

export function diskPressureThresholdsFromEnv(env: NodeJS.ProcessEnv = process.env): DiskPressureThresholds {
	return validateDiskPressureThresholds({
		warning: {
			bytes: Math.round(envNumber(env, "OMP_DISK_WARNING_GIB", 50) * GIB),
			percent: envNumber(env, "OMP_DISK_WARNING_PERCENT", 10),
		},
		blocking: {
			bytes: Math.round(envNumber(env, "OMP_DISK_BLOCKING_GIB", 20) * GIB),
			percent: envNumber(env, "OMP_DISK_BLOCKING_PERCENT", 5),
		},
		emergency: {
			bytes: Math.round(envNumber(env, "OMP_DISK_EMERGENCY_GIB", 10) * GIB),
			percent: envNumber(env, "OMP_DISK_EMERGENCY_PERCENT", 2),
		},
		hysteresis: {
			bytes: Math.round(envNumber(env, "OMP_DISK_HYSTERESIS_GIB", 2) * GIB),
			percent: envNumber(env, "OMP_DISK_HYSTERESIS_PERCENT", 1),
		},
	});
}

function crossed(valueBytes: number, valuePercent: number, threshold: DiskPressureThreshold): boolean {
	return valueBytes <= threshold.bytes || valuePercent <= threshold.percent;
}

function classifyAtThresholds(
	freeBytes: number,
	freePercent: number,
	thresholds: DiskPressureThresholds,
	applyHysteresis: boolean,
): DiskPressureState {
	const margin = applyHysteresis ? thresholds.hysteresis : { bytes: 0, percent: 0 };
	const adjusted = (threshold: DiskPressureThreshold): DiskPressureThreshold => ({
		bytes: threshold.bytes + margin.bytes,
		percent: threshold.percent + margin.percent,
	});
	if (crossed(freeBytes, freePercent, adjusted(thresholds.emergency))) return "emergency";
	if (crossed(freeBytes, freePercent, adjusted(thresholds.blocking))) return "blocking";
	if (crossed(freeBytes, freePercent, adjusted(thresholds.warning))) return "warning";
	return "normal";
}

export function classifyDiskPressure(
	freeBytes: number,
	freePercent: number,
	thresholds: DiskPressureThresholds = DEFAULT_DISK_PRESSURE_THRESHOLDS,
	previousState: DiskPressureState | null = null,
): { readonly state: DiskPressureState; readonly measuredState: DiskPressureState } {
	validateDiskPressureThresholds(thresholds);
	if (!Number.isSafeInteger(freeBytes) || freeBytes < 0 || !Number.isFinite(freePercent) || freePercent < 0 || freePercent > 100) {
		return { state: "unavailable", measuredState: "unavailable" };
	}
	const measuredState = classifyAtThresholds(freeBytes, freePercent, thresholds, false);
	if (!previousState || previousState === "normal" || previousState === "unavailable") {
		return { state: measuredState, measuredState };
	}
	if (severity[measuredState] >= severity[previousState]) return { state: measuredState, measuredState };
	return { state: classifyAtThresholds(freeBytes, freePercent, thresholds, true), measuredState };
}

function defaultStateFile(): string {
	return process.env.OMP_DISK_PRESSURE_STATE_FILE?.trim() || path.join(os.homedir(), "Library", "Application Support", "omp", "disk-pressure.json");
}

async function readReceipt(stateFile: string | null): Promise<DiskPressureReceipt | null> {
	if (!stateFile) return null;
	try {
		const parsed: unknown = JSON.parse(await fs.readFile(stateFile, "utf8"));
		return Schema.decodeUnknownSync(DiskPressureReceiptSchema)(parsed, { onExcessProperty: "error" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		return null;
	}
}

async function writeReceiptAtomic(stateFile: string | null, receipt: DiskPressureReceipt): Promise<void> {
	if (!stateFile) return;
	await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
	const temporary = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
	const handle = await fs.open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(receipt)}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await fs.rename(temporary, stateFile);
}

async function nodeStatfs(targetPath: string): Promise<unknown> {
	return fs.statfs(targetPath);
}

function formatGiB(bytes: number | null): string {
	return bytes === null ? "unknown" : `${(bytes / GIB).toFixed(1)} GiB`;
}

export async function macOSDiskPressureNotifier(projection: DiskPressureProjection): Promise<void> {
	if (process.platform !== "darwin") return;
	const recovered = projection.state === "normal";
	const title = recovered ? "Disk space recovered" : `Disk pressure: ${projection.state}`;
	const body = recovered
		? `Heavy development work is admitted again (${formatGiB(projection.freeBytes)}, ${projection.freePercent?.toFixed(1) ?? "unknown"}% free).`
		: `${formatGiB(projection.freeBytes)} free (${projection.freePercent?.toFixed(1) ?? "unknown"}%). New heavy work ${projection.state === "warning" ? "is approaching its guard" : "is blocked"}.`;
	const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
	const child = Bun.spawn(["/usr/bin/osascript", "-e", script], { stdout: "ignore", stderr: "pipe" });
	const exitCode = await child.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(child.stderr).text();
		throw new Error(`disk pressure notification failed (${exitCode}): ${stderr.trim()}`);
	}
}

export async function probeDiskPressure(options: ProbeDiskPressureOptions = {}): Promise<DiskPressureProjection> {
	const targetPath = path.resolve(options.targetPath ?? process.cwd());
	let thresholds = DEFAULT_DISK_PRESSURE_THRESHOLDS;
	let reason: string | null = null;
	try {
		thresholds = validateDiskPressureThresholds(options.thresholds ?? diskPressureThresholdsFromEnv());
	} catch (error) {
		reason = error instanceof Error ? error.message : String(error);
	}
	const stateFile = options.stateFile === undefined ? defaultStateFile() : options.stateFile;
	const previous = await readReceipt(stateFile);
	const observedAt = (options.now ?? (() => new Date()))().toISOString();
	let freeBytes: number | null = null;
	let totalBytes: number | null = null;
	let freePercent: number | null = null;
	let filesystem: "apfs" | "other" | null = null;
	let filesystemType: number | null = null;
	let measuredState: DiskPressureState = "unavailable";
	let state: DiskPressureState = "unavailable";
	if (reason === null) {
		try {
			const statfs = decodeStatfsBoundary(await (options.statfs ?? nodeStatfs)(targetPath));
			filesystemType = statfs.type;
			filesystem = process.platform === "darwin" && statfs.type === DARWIN_APFS_FILESYSTEM_TYPE ? "apfs" : "other";
			totalBytes = statfs.blocks * statfs.bsize;
			freeBytes = statfs.bavail * statfs.bsize;
			if (!Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(freeBytes)) {
				throw new Error("statfs byte projection exceeds safe integer range");
			}
			freePercent = (statfs.bavail / statfs.blocks) * 100;
			const classification = classifyDiskPressure(freeBytes, freePercent, thresholds, previous?.state ?? null);
			state = classification.state;
			measuredState = classification.measuredState;
		} catch (error) {
			reason = error instanceof Error ? error.message : String(error);
		}
	}
	const shouldNotify =
		options.notify === true &&
		(state === "normal"
			? previous?.notifiedState !== null &&
				previous?.notifiedState !== undefined &&
				previous.notifiedState !== "normal"
			: previous?.notifiedState !== state);
	let notificationDelivered = false;
	const projectionBase: DiskPressureProjection = {
		state,
		measuredState,
		observedAt,
		targetPath,
		filesystem,
		filesystemType,
		freeBytes,
		totalBytes,
		freePercent,
		thresholds,
		previousState: previous?.state ?? null,
		wouldNotify: shouldNotify,
		notificationDelivered: false,
		reason,
	};
	if (shouldNotify && options.dryRun !== true) {
		try {
			await (options.notifier ?? macOSDiskPressureNotifier)(projectionBase);
			notificationDelivered = true;
		} catch (error) {
			reason = error instanceof Error ? error.message : String(error);
		}
	}
	const projection = { ...projectionBase, notificationDelivered, reason };
	if (options.dryRun !== true) {
		await writeReceiptAtomic(stateFile, {
			version: 1,
			state,
			notifiedState: notificationDelivered ? state : (previous?.notifiedState ?? null),
			observedAt,
			freeBytes,
			totalBytes,
			freePercent,
		});
	}
	return projection;
}

const ALWAYS_ADMITTED_OPERATIONS: Readonly<Record<Exclude<DiskOperationKind, "heavy">, true>> = {
	readOnly: true,
	status: true,
	cleanup: true,
	offload: true,
	alreadyRunning: true,
};

export function evaluateDiskAdmission(
	projection: DiskPressureProjection,
	operation: DiskOperationKind,
): DiskAdmissionDecision {
	if (operation !== "heavy" && ALWAYS_ADMITTED_OPERATIONS[operation]) {
		return { admitted: true, operation, projection, reason: null };
	}
	if (projection.state === "blocking" || projection.state === "emergency" || projection.state === "unavailable") {
		return {
			admitted: false,
			operation,
			projection,
			reason:
				projection.state === "unavailable"
					? `Disk pressure probe unavailable: ${projection.reason ?? "malformed statfs output"}`
					: `New heavy work blocked at ${formatGiB(projection.freeBytes)} free (${projection.freePercent?.toFixed(1) ?? "unknown"}%).`,
		};
	}
	return { admitted: true, operation, projection, reason: null };
}

export async function checkDiskAdmission(
	operation: DiskOperationKind,
	options: ProbeDiskPressureOptions = {},
): Promise<DiskAdmissionDecision> {
	return evaluateDiskAdmission(await probeDiskPressure(options), operation);
}
