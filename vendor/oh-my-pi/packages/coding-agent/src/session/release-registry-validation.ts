import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveReleaseStoragePaths } from "./release-storage-paths";
import type { FleetPinChannel, FleetPinSelection } from "./session-control";

const SHA256 = /^[a-f0-9]{64}$/;
const REGISTRY_KEYS = ["schemaVersion", "stable", "previous", "candidate", "receiptDigest", "timestamps"] as const;
const TIMESTAMP_KEYS = ["candidate", "blessed", "rollback"] as const;
const RECEIPT_KEYS = [
	"schemaVersion",
	"buildDigest",
	"version",
	"runnerInstanceId",
	"fixtureSessionId",
	"ownerEpoch",
	"startedAt",
	"stoppedAt",
	"initialSnapshotRevision",
	"finalSnapshotRevision",
	"commandId",
	"proof",
] as const;
const PROOF_KEYS = [
	"mutationAppliedExactlyOnce",
	"leaseReleased",
	"leaseReacquired",
	"jsonlPersisted",
	"queuePersisted",
] as const;
const MAX_METADATA_BYTES = 1024 * 1024;

interface ReleaseRegistry {
	readonly schemaVersion: 1;
	readonly stable: string | null;
	readonly previous: string | null;
	readonly candidate: string | null;
	readonly receiptDigest: string | null;
	readonly timestamps: {
		readonly candidate: string | null;
		readonly blessed: string | null;
		readonly rollback: string | null;
	};
}

interface ReadinessReceipt {
	readonly startedAt: string;
}

export interface ReleaseRegistryValidationOptions {
	readonly registryPath?: string;
	readonly releasesDir?: string;
}

export interface ResolvedReleaseValidationPaths {
	readonly registryPath: string;
	readonly releasesDir: string;
}

export interface InstalledRelease {
	readonly digest: string;
	readonly executable: string;
}

export interface ValidatedFleetPin {
	readonly channel: FleetPinChannel;
	readonly digest: string;
	readonly source: "explicit-digest" | "registry-stable" | "registry-candidate";
	readonly receiptDigest: string;
}

export interface ValidatedFleetUnpin {
	readonly channel: "blessed";
	readonly digest: string;
	readonly source: "registry-stable";
}

function configuredPath(value: string | undefined, fallback: string, label: string): string {
	const selected = value ?? fallback;
	if (selected.trim().length === 0) throw new Error(`${label} must not be empty`);
	return path.resolve(selected);
}

export function resolveReleaseValidationPaths(
	options: ReleaseRegistryValidationOptions = {},
): ResolvedReleaseValidationPaths {
	const shared = resolveReleaseStoragePaths();
	return {
		registryPath: configuredPath(options.registryPath, shared.registryPath, "Release registry path"),
		releasesDir: configuredPath(options.releasesDir, shared.releasesDir, "Immutable releases directory"),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function assertDigest(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} is not a lowercase SHA-256 digest`);
}

function assertNullableDigest(value: unknown, label: string): asserts value is string | null {
	if (value !== null) assertDigest(value, label);
}

function parseIsoTimestamp(value: unknown, label: string): number {
	if (typeof value !== "string") throw new Error(`${label} is not an ISO timestamp`);
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
		throw new Error(`${label} is not an ISO timestamp`);
	}
	return parsed;
}

async function readRegularFile(filePath: string, label: string): Promise<Buffer> {
	let handle: fs.FileHandle | undefined;
	try {
		handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
		const stat = await handle.stat();
		if (!stat.isFile()) throw new Error(`${label} is not a regular file`);
		if (stat.size > MAX_METADATA_BYTES) throw new Error(`${label} exceeds ${MAX_METADATA_BYTES} bytes`);
		return await handle.readFile();
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(label)) throw error;
		throw new Error(`${label} is unavailable or unsafe: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		await handle?.close();
	}
}

function parseRegistry(raw: Buffer): ReleaseRegistry {
	let value: unknown;
	try {
		value = JSON.parse(raw.toString("utf8"));
	} catch {
		throw new Error("Release registry is not valid JSON");
	}
	if (!isRecord(value) || !hasExactKeys(value, REGISTRY_KEYS) || value.schemaVersion !== 1) {
		throw new Error("Release registry has unexpected fields or schema");
	}
	assertNullableDigest(value.stable, "Release registry stable");
	assertNullableDigest(value.previous, "Release registry previous");
	assertNullableDigest(value.candidate, "Release registry candidate");
	assertNullableDigest(value.receiptDigest, "Release registry receiptDigest");
	const timestamps = value.timestamps;
	if (!isRecord(timestamps) || !hasExactKeys(timestamps, TIMESTAMP_KEYS)) {
		throw new Error("Release registry timestamps have unexpected fields");
	}
	for (const key of TIMESTAMP_KEYS) {
		const timestamp = timestamps[key];
		if (timestamp !== null) parseIsoTimestamp(timestamp, `Release registry ${key} timestamp`);
	}
	return value as unknown as ReleaseRegistry;
}

async function readRegistry(paths: ResolvedReleaseValidationPaths): Promise<ReleaseRegistry> {
	return parseRegistry(await readRegularFile(paths.registryPath, "Release registry"));
}

function parseReadinessReceipt(json: string, expectedDigest: string): ReadinessReceipt {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		throw new Error("Readiness receipt is not valid JSON");
	}
	if (!isRecord(value) || !hasExactKeys(value, RECEIPT_KEYS) || value.schemaVersion !== 1) {
		throw new Error("Readiness receipt has unexpected fields or schema");
	}
	if (value.buildDigest !== expectedDigest) throw new Error("Readiness receipt build digest does not match the selected release");
	if (typeof value.version !== "string" || value.version.length === 0) throw new Error("Readiness receipt version is invalid");
	for (const key of ["runnerInstanceId", "fixtureSessionId", "ownerEpoch", "commandId"] as const) {
		const field = value[key];
		if (typeof field !== "string" || field.length === 0) throw new Error(`Readiness receipt ${key} is invalid`);
	}
	const initialRevision = value.initialSnapshotRevision;
	const finalRevision = value.finalSnapshotRevision;
	if (
		typeof initialRevision !== "number" ||
		typeof finalRevision !== "number" ||
		!Number.isSafeInteger(initialRevision) ||
		!Number.isSafeInteger(finalRevision)
	) {
		throw new Error("Readiness receipt snapshot revisions are invalid");
	}
	if (finalRevision <= initialRevision) throw new Error("Readiness receipt snapshot revision did not advance");
	const proof = value.proof;
	if (!isRecord(proof) || !hasExactKeys(proof, PROOF_KEYS)) {
		throw new Error("Readiness receipt proof has unexpected fields");
	}
	for (const key of PROOF_KEYS) {
		if (proof[key] !== true) throw new Error(`Readiness receipt proof ${key} is incomplete`);
	}
	const startedAtValue = value.startedAt;
	const stoppedAtValue = value.stoppedAt;
	const startedAt = parseIsoTimestamp(startedAtValue, "Readiness receipt startedAt");
	const stoppedAt = parseIsoTimestamp(stoppedAtValue, "Readiness receipt stoppedAt");
	if (stoppedAt < startedAt) throw new Error("Readiness receipt stopped before it started");
	return { startedAt: startedAtValue as string };
}

async function assertImmutableRelease(releasesDir: string, digest: string): Promise<void> {
	const releasePath = path.join(releasesDir, `omp-${digest}`);
	let handle: fs.FileHandle | undefined;
	try {
		handle = await fs.open(releasePath, constants.O_RDONLY | constants.O_NOFOLLOW);
		const stat = await handle.stat();
		if (!stat.isFile()) throw new Error("release is not a regular file");
		if ((stat.mode & 0o111) === 0) throw new Error("release is not executable");
		const hash = createHash("sha256");
		for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
		if (hash.digest("hex") !== digest) throw new Error("release bytes do not match the requested digest");
	} catch (error) {
		throw new Error(`Immutable release ${digest} is unavailable or unsafe: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		await handle?.close();
	}
}

/** Resolve the globally installed build used for ordinary launches. */
export async function resolveNewestInstalledRelease(
	options: ReleaseRegistryValidationOptions = {},
): Promise<InstalledRelease> {
	const paths = resolveReleaseValidationPaths(options);
	const registry = await readRegistry(paths);
	if (registry.stable === null) throw new Error("Release registry has no installed stable digest");
	await assertImmutableRelease(paths.releasesDir, registry.stable);
	return {
		digest: registry.stable,
		executable: path.join(paths.releasesDir, `omp-${registry.stable}`),
	};
}

export async function validateFleetPinSelection(
	selection: FleetPinSelection,
	options: ReleaseRegistryValidationOptions = {},
): Promise<ValidatedFleetPin> {
	const paths = resolveReleaseValidationPaths(options);
	const digest = selection.resolvedDigest;
	assertDigest(digest, "Resolved release digest");
	assertDigest(selection.readinessReceipt.digest, "Readiness receipt digest");
	if (Buffer.byteLength(selection.readinessReceipt.json, "utf8") > MAX_METADATA_BYTES) {
		throw new Error(`Readiness receipt exceeds ${MAX_METADATA_BYTES} bytes`);
	}
	await assertImmutableRelease(paths.releasesDir, digest);

	const receiptDigest = createHash("sha256").update(selection.readinessReceipt.json, "utf8").digest("hex");
	if (receiptDigest !== selection.readinessReceipt.digest) {
		throw new Error("Readiness receipt bytes do not match the supplied receipt digest");
	}
	const receipt = parseReadinessReceipt(selection.readinessReceipt.json, digest);

	switch (selection.requestedChannel) {
		case "digest":
			return { channel: "digest", digest, source: "explicit-digest", receiptDigest };
		case "blessed": {
			const registry = await readRegistry(paths);
			if (registry.stable !== digest) throw new Error("Resolved blessed digest does not match the release registry stable digest");
			if (registry.receiptDigest === null) {
				throw new Error("Blessed release has no authoritative registry readiness receipt");
			}
			return { channel: "blessed", digest, source: "registry-stable", receiptDigest };
		}
		case "canary": {
			const registry = await readRegistry(paths);
			if (registry.candidate !== digest) throw new Error("Resolved canary digest does not match the release registry candidate digest");
			const candidateAt = registry.timestamps.candidate;
			if (candidateAt === null) throw new Error("Release registry candidate timestamp is unavailable");
			if (Date.parse(receipt.startedAt) < parseIsoTimestamp(candidateAt, "Release registry candidate timestamp")) {
				throw new Error("Canary readiness receipt predates the registered candidate");
			}
			return { channel: "canary", digest, source: "registry-candidate", receiptDigest };
		}
	}
}

export async function validateFleetUnpinBlessed(
	options: ReleaseRegistryValidationOptions = {},
): Promise<ValidatedFleetUnpin> {
	const paths = resolveReleaseValidationPaths(options);
	const registry = await readRegistry(paths);
	if (registry.stable === null) throw new Error("Release registry has no blessed stable digest");
	await assertImmutableRelease(paths.releasesDir, registry.stable);
	return { channel: "blessed", digest: registry.stable, source: "registry-stable" };
}
