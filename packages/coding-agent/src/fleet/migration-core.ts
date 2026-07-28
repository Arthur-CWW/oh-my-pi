import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createTerminalSessionController, type TerminalSessionController } from "../modes/terminal-session-controller";
import {
	type TerminalSessionWireClientHello,
	UnixSocketTerminalSessionTransport,
} from "../runner/wire/client";

export const FLEET_MIGRATION_SCHEMA_VERSION = 1 as const;
export const FLEET_RECEIPT_SCHEMA_VERSION = 1 as const;
export const FLEET_MIGRATION_API_SCHEMA = {
	$id: "https://oh-my-pi.dev/schemas/fleet-migration-v1.json",
	type: "object",
	required: ["host", "files"],
	properties: {
		host: { type: "object", required: ["hostId", "root", "signingKey"] },
		destination: { type: "object", required: ["hostId", "root", "signingKey"] },
		files: { type: "object", required: ["sessionId", "journalFile"] },
		context: {
			type: "object",
			required: ["idempotencyKey", "ownerProof", "capabilities"],
			properties: {
				idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
				ownerProof: {
					type: "object",
					required: ["sessionId", "hostId", "ownerEpoch", "nonce", "digest"],
				},
				capabilities: {
					type: "array",
					items: { enum: ["checkpoint", "correct", "export", "import", "migrate"] },
				},
				timeoutMs: { type: "integer", minimum: 1, maximum: 300_000 },
			},
		},
	},
} as const;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_INSPECT_BYTES = 256 * 1024;
const MAX_INSPECT_RECORDS = 256;

export type FleetMutationCapability = "checkpoint" | "correct" | "export" | "import" | "migrate";
export type FleetMigrationPhase =
	| "prepare"
	| "quiesce-source"
	| "fence-epoch"
	| "transfer"
	| "destination-owner"
	| "health-proof"
	| "commit"
	| "rolled-back";

export interface FleetHost {
	readonly hostId: string;
	readonly root: string;
	readonly signingKey: string;
	readonly workspaceRoot?: string;
}

export interface FleetSessionFiles {
	readonly sessionId: string;
	readonly journalFile: string;
	readonly queueFiles?: readonly string[];
	readonly ownerFile?: string;
	readonly controlFile?: string;
	readonly correctionsFile?: string;
	readonly childStateFile?: string;
	readonly socketPath?: string;
}

export interface FleetOwnerProof {
	readonly sessionId: string;
	readonly hostId: string;
	readonly ownerEpoch: string;
	readonly nonce: string;
	readonly digest: string;
}

export interface FleetMutationContext {
	readonly idempotencyKey: string;
	readonly ownerProof: FleetOwnerProof;
	readonly capabilities: readonly FleetMutationCapability[];
	readonly timeoutMs?: number;
}

export interface FleetReceipt<T = unknown> {
	readonly schemaVersion: typeof FLEET_RECEIPT_SCHEMA_VERSION;
	readonly receiptId: string;
	readonly operation: FleetMutationCapability;
	readonly idempotencyKey: string;
	readonly sessionId: string;
	readonly hostId: string;
	readonly ownerEpoch: string;
	readonly recordedAt: string;
	readonly payload: T;
	readonly digest: string;
	readonly signature: string;
}

export interface FleetBoundary {
	readonly uri: string;
	readonly bytes: number;
	readonly sha256: string;
}

export interface FleetCheckpoint {
	readonly schemaVersion: typeof FLEET_MIGRATION_SCHEMA_VERSION;
	readonly checkpointId: string;
	readonly sessionId: string;
	readonly ownerEpoch: string;
	readonly createdAt: string;
	readonly journal: FleetBoundary;
	readonly queues: readonly FleetBoundary[];
	readonly digest: string;
}

export type FleetCorrectionAction = "replace" | "redact";
export interface FleetCorrection {
	readonly schemaVersion: typeof FLEET_MIGRATION_SCHEMA_VERSION;
	readonly correctionId: string;
	readonly idempotencyKey: string;
	readonly recordId: string;
	readonly action: FleetCorrectionAction;
	readonly replacement?: unknown;
	readonly reason: string;
	readonly ownerEpoch: string;
	readonly recordedAt: string;
}

export interface FleetWorkspaceUriMap {
	readonly sourceRoot: string;
	readonly workspaceUri: string;
}

export type FleetChildStatus = "running" | "idle" | "parked" | "failed";
export interface FleetChildContinuation {
	readonly childId: string;
	readonly status: FleetChildStatus;
	readonly journalUri: string;
	readonly resumable: boolean;
	readonly continuationHandle: string;
}

export interface FleetContinuationState {
	readonly children: readonly FleetChildContinuation[];
	readonly todos: readonly unknown[];
	readonly deferredChanges: readonly unknown[];
}

export interface FleetExportManifest {
	readonly schemaVersion: typeof FLEET_MIGRATION_SCHEMA_VERSION;
	readonly bundleId: string;
	readonly sessionId: string;
	readonly sourceHost: string;
	readonly checkpoint: FleetCheckpoint;
	readonly workspace: FleetWorkspaceUriMap;
	readonly files: readonly FleetBoundary[];
	readonly closedState: FleetContinuationState & { readonly queues: readonly FleetBoundary[] };
	readonly createdAt: string;
	readonly digest: string;
}

export interface FleetImportResult {
	readonly schemaVersion: typeof FLEET_MIGRATION_SCHEMA_VERSION;
	readonly sessionId: string;
	readonly destinationHost: string;
	readonly stagingDir: string;
	readonly dryRun: boolean;
	readonly ownerCreated: false;
	readonly workspacePath: string;
	readonly manifestDigest: string;
}

export interface FleetMigrationState {
	readonly schemaVersion: typeof FLEET_MIGRATION_SCHEMA_VERSION;
	readonly migrationId: string;
	readonly idempotencyKey: string;
	readonly sessionId: string;
	readonly sourceHost: string;
	readonly destinationHost: string;
	readonly sourceEpoch: string;
	readonly fenceEpoch: string;
	readonly destinationEpoch?: string;
	readonly phase: FleetMigrationPhase;
	readonly bundleDir?: string;
	readonly destinationDir?: string;
	readonly receipt?: FleetReceipt<FleetMigrationReceiptPayload>;
	readonly error?: string;
}

export interface FleetMigrationReceiptPayload {
	readonly migrationId: string;
	readonly sourceHost: string;
	readonly destinationHost: string;
	readonly sourceEpoch: string;
	readonly fenceEpoch: string;
	readonly destinationEpoch: string;
	readonly checkpointDigest: string;
	readonly healthProof: unknown;
	readonly state: "committed";
}

export interface FleetInspectResult {
	readonly schemaVersion: typeof FLEET_MIGRATION_SCHEMA_VERSION;
	readonly sessionId: string;
	readonly hostId: string;
	readonly state: string;
	readonly config: unknown;
	readonly build: unknown;
	readonly owner: unknown;
	readonly process: unknown;
	readonly profile: unknown;
	readonly checkpoint?: FleetCheckpoint;
	readonly corrections: readonly FleetCorrection[];
	readonly bounds: { readonly maxBytes: number; readonly maxRecords: number; readonly truncated: boolean };
}

function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function fail(code: string, message: string): never {
	throw new Error(`${code}: ${message}`);
}

function decodeContinuationState(value: unknown, sessionId: string): FleetContinuationState {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		fail("continuation-state-required", "child/todo/deferred state must be an object");
	const input = value as Record<string, unknown>;
	if (!Array.isArray(input.children) || !Array.isArray(input.todos) || !Array.isArray(input.deferredChanges))
		fail("continuation-state-required", "children, todos, and deferredChanges arrays are required");
	const seen = new Set<string>();
	const children = input.children.map((value, index): FleetChildContinuation => {
		if (typeof value !== "object" || value === null || Array.isArray(value))
			fail("invalid-child-continuation", `children[${index}]`);
		const child = value as Record<string, unknown>;
		if (
			typeof child.childId !== "string" ||
			!child.childId ||
			(child.status !== "running" &&
				child.status !== "idle" &&
				child.status !== "parked" &&
				child.status !== "failed") ||
			typeof child.journalUri !== "string" ||
			child.journalUri !== `journal://${sessionId}/${child.childId}` ||
			typeof child.resumable !== "boolean" ||
			typeof child.continuationHandle !== "string" ||
			!child.continuationHandle
		)
			fail("invalid-child-continuation", `children[${index}]`);
		if (seen.has(child.childId)) fail("duplicate-child-continuation", child.childId);
		seen.add(child.childId);
		return {
			childId: child.childId,
			status: child.status,
			journalUri: child.journalUri,
			resumable: child.resumable,
			continuationHandle: child.continuationHandle,
		};
	});
	return { children, todos: input.todos, deferredChanges: input.deferredChanges };
}

function validateHealthProof(value: unknown, continuationState: FleetContinuationState): void {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		fail("destination-health-failed", "proof must be an object");
	const proof = value as Record<string, unknown>;
	if (proof.ok !== true || !Array.isArray(proof.continuationHandles))
		fail("destination-health-failed", "proof must confirm ok and continuationHandles");
	const handles = new Set(proof.continuationHandles.filter((handle): handle is string => typeof handle === "string"));
	const missing = continuationState.children
		.map(child => child.continuationHandle)
		.filter(handle => !handles.has(handle));
	if (missing.length > 0) fail("destination-health-failed", `missing continuation handles: ${missing.join(",")}`);
}

function validateIdempotencyKey(key: string): void {
	if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) fail("invalid-idempotency-key", "expected 8-200 safe characters");
}

function timeoutMs(context: FleetMutationContext): number {
	const value = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	if (!Number.isSafeInteger(value) || value < 1 || value > 300_000)
		fail("invalid-timeout", "timeout must be 1..300000ms");
	return value;
}

async function bounded<T>(milliseconds: number, work: Promise<T>): Promise<T> {
	const timer = Promise.withResolvers<T>();
	const handle = setTimeout(
		() => timer.reject(new Error(`operation-timeout: exceeded ${milliseconds}ms`)),
		milliseconds,
	);
	try {
		return await Promise.race([work, timer.promise]);
	} finally {
		clearTimeout(handle);
	}
}

async function readJson(file: string): Promise<unknown> {
	try {
		return JSON.parse(await fs.readFile(file, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const temporary = `${file}.${randomUUID()}.tmp`;
	await fs.writeFile(temporary, `${stable(value)}\n`, { mode: 0o600 });
	await fs.rename(temporary, file);
}

async function appendJsonl(file: string, value: unknown): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.appendFile(file, `${stable(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

function ownerDigest(host: FleetHost, sessionId: string, ownerEpoch: string, nonce: string): string {
	return createHmac("sha256", host.signingKey)
		.update(`${sessionId}\0${host.hostId}\0${ownerEpoch}\0${nonce}`)
		.digest("hex");
}

export function createFleetOwnerProof(
	host: FleetHost,
	sessionId: string,
	ownerEpoch: string,
	nonce: string = randomUUID(),
): FleetOwnerProof {
	return {
		sessionId,
		hostId: host.hostId,
		ownerEpoch,
		nonce,
		digest: ownerDigest(host, sessionId, ownerEpoch, nonce),
	};
}

async function verifyMutation(
	host: FleetHost,
	files: FleetSessionFiles,
	context: FleetMutationContext,
	capability: FleetMutationCapability,
	allowFenced = false,
): Promise<void> {
	validateIdempotencyKey(context.idempotencyKey);
	timeoutMs(context);
	if (!context.capabilities.includes(capability)) fail("capability-refused", `missing ${capability}`);
	const proof = context.ownerProof;
	if (proof.sessionId !== files.sessionId || proof.hostId !== host.hostId)
		fail("owner-proof-refused", "session or host mismatch");
	if (proof.digest !== ownerDigest(host, proof.sessionId, proof.ownerEpoch, proof.nonce))
		fail("owner-proof-refused", "invalid digest");
	const owner = (files.ownerFile ? await readJson(files.ownerFile) : undefined) as
		| { ownerEpoch?: unknown; state?: unknown }
		| undefined;
	if (!owner || owner.ownerEpoch !== proof.ownerEpoch || (owner.state === "fenced" && !allowFenced))
		fail("stale-owner-proof", "owner epoch is not current");
}

function receipt<T>(
	host: FleetHost,
	operation: FleetMutationCapability,
	context: FleetMutationContext,
	sessionId: string,
	payload: T,
): FleetReceipt<T> {
	const body = {
		schemaVersion: FLEET_RECEIPT_SCHEMA_VERSION,
		receiptId: randomUUID(),
		operation,
		idempotencyKey: context.idempotencyKey,
		sessionId,
		hostId: host.hostId,
		ownerEpoch: context.ownerProof.ownerEpoch,
		recordedAt: new Date().toISOString(),
		payload,
	};
	const digest = sha256(stable(body));
	return { ...body, digest, signature: createHmac("sha256", host.signingKey).update(digest).digest("hex") };
}

export function verifyFleetReceipt(host: FleetHost, value: FleetReceipt): boolean {
	const { digest, signature, ...body } = value;
	const expectedDigest = sha256(stable(body));
	const expectedSignature = createHmac("sha256", host.signingKey).update(expectedDigest).digest("hex");
	if (!/^[a-f0-9]{64}$/.test(digest) || !/^[a-f0-9]{64}$/.test(signature) || digest !== expectedDigest) return false;
	return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expectedSignature, "hex"));
}

async function boundary(file: string, uri: string): Promise<FleetBoundary> {
	const bytes = (await fs.stat(file)).size;
	const data = await fs.readFile(file);
	return { uri, bytes, sha256: sha256(data) };
}

function correctionsPath(host: FleetHost, files: FleetSessionFiles): string {
	return files.correctionsFile ?? path.join(host.root, "corrections", `${files.sessionId}.jsonl`);
}

function controlPath(host: FleetHost, files: FleetSessionFiles): string {
	return files.controlFile ?? path.join(host.root, "control", `${files.sessionId}.json`);
}

function receiptsPath(host: FleetHost, files: FleetSessionFiles): string {
	return path.join(host.root, "receipts", `${files.sessionId}.jsonl`);
}

async function readJsonl<T>(file: string, maximum = MAX_INSPECT_RECORDS): Promise<{ values: T[]; truncated: boolean }> {
	try {
		const text = await fs.readFile(file, "utf8");
		const lines = text.split("\n").filter(Boolean);
		return { values: lines.slice(-maximum).map(line => JSON.parse(line) as T), truncated: lines.length > maximum };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { values: [], truncated: false };
		throw error;
	}
}

export async function inspectFleetSession(host: FleetHost, files: FleetSessionFiles): Promise<FleetInspectResult> {
	return bounded(
		DEFAULT_TIMEOUT_MS,
		(async () => {
			const [control, owner, corrections] = await Promise.all([
				readJson(controlPath(host, files)),
				files.ownerFile ? readJson(files.ownerFile) : Promise.resolve(undefined),
				readJsonl<FleetCorrection>(correctionsPath(host, files)),
			]);
			const state = (control as { phase?: string } | undefined)?.phase ?? (owner ? "owned" : "unowned");
			const build = (owner as { build?: unknown } | undefined)?.build;
			const processState = (owner as { process?: unknown } | undefined)?.process;
			const profile = (owner as { profile?: unknown } | undefined)?.profile;
			const config = (owner as { config?: unknown } | undefined)?.config;
			const checkpoint = (control as { checkpoint?: FleetCheckpoint } | undefined)?.checkpoint;
			const serialized = stable({ control, owner, corrections: corrections.values });
			return {
				schemaVersion: FLEET_MIGRATION_SCHEMA_VERSION,
				sessionId: files.sessionId,
				hostId: host.hostId,
				state,
				config,
				build,
				owner,
				process: processState,
				profile,
				checkpoint,
				corrections: corrections.values,
				bounds: {
					maxBytes: MAX_INSPECT_BYTES,
					maxRecords: MAX_INSPECT_RECORDS,
					truncated: corrections.truncated || serialized.length > MAX_INSPECT_BYTES,
				},
			};
		})(),
	);
}

async function checkpointFleetSessionInternal(
	host: FleetHost,
	files: FleetSessionFiles,
	context: FleetMutationContext,
	allowFenced: boolean,
): Promise<FleetReceipt<FleetCheckpoint>> {
	return bounded(
		timeoutMs(context),
		(async () => {
			await verifyMutation(host, files, context, "checkpoint", allowFenced);
			const prior = await findReceipt<FleetCheckpoint>(host, files, "checkpoint", context.idempotencyKey);
			if (prior) return prior;
			const journal = await boundary(files.journalFile, `journal://${files.sessionId}`);
			const queues = await Promise.all(
				(files.queueFiles ?? []).map((file, index) => boundary(file, `queue://${files.sessionId}/${index}`)),
			);
			const base = {
				schemaVersion: FLEET_MIGRATION_SCHEMA_VERSION,
				checkpointId: randomUUID(),
				sessionId: files.sessionId,
				ownerEpoch: context.ownerProof.ownerEpoch,
				createdAt: new Date().toISOString(),
				journal,
				queues,
			} as const;
			const checkpoint: FleetCheckpoint = { ...base, digest: sha256(stable(base)) };
			const result = receipt(host, "checkpoint", context, files.sessionId, checkpoint);
			await appendJsonl(receiptsPath(host, files), result);
			return result;
		})(),
	);
}

export async function checkpointFleetSession(
	host: FleetHost,
	files: FleetSessionFiles,
	context: FleetMutationContext,
): Promise<FleetReceipt<FleetCheckpoint>> {
	return checkpointFleetSessionInternal(host, files, context, false);
}

async function findReceipt<T>(
	host: FleetHost,
	files: FleetSessionFiles,
	operation: FleetMutationCapability,
	key: string,
): Promise<FleetReceipt<T> | undefined> {
	const { values } = await readJsonl<FleetReceipt<T>>(receiptsPath(host, files), 10_000);
	return values.find(item => item.operation === operation && item.idempotencyKey === key);
}

export async function correctFleetSession(
	host: FleetHost,
	files: FleetSessionFiles,
	context: FleetMutationContext,
	input: {
		readonly recordId: string;
		readonly action: FleetCorrectionAction;
		readonly replacement?: unknown;
		readonly reason: string;
	},
): Promise<FleetReceipt<FleetCorrection>> {
	return bounded(
		timeoutMs(context),
		(async () => {
			await verifyMutation(host, files, context, "correct");
			const prior = await findReceipt<FleetCorrection>(host, files, "correct", context.idempotencyKey);
			if (prior) return prior;
			if (!input.recordId.trim()) fail("invalid-record-id", "record ID is required");
			if (!input.reason.trim()) fail("invalid-reason", "correction reason is required");
			if (input.action === "replace" && input.replacement === undefined)
				fail("invalid-correction", "replacement is required");
			const journal = await readJsonl<Record<string, unknown>>(files.journalFile, Number.MAX_SAFE_INTEGER);
			const recordExists = journal.values.some(
				(record, index) => (typeof record.id === "string" ? record.id : `line:${index + 1}`) === input.recordId,
			);
			if (!recordExists) fail("record-not-found", input.recordId);
			const correction: FleetCorrection = {
				schemaVersion: FLEET_MIGRATION_SCHEMA_VERSION,
				correctionId: randomUUID(),
				idempotencyKey: context.idempotencyKey,
				recordId: input.recordId,
				action: input.action,
				replacement: input.action === "replace" ? input.replacement : undefined,
				reason: input.reason,
				ownerEpoch: context.ownerProof.ownerEpoch,
				recordedAt: new Date().toISOString(),
			};
			await appendJsonl(correctionsPath(host, files), correction);
			const result = receipt(host, "correct", context, files.sessionId, correction);
			await appendJsonl(receiptsPath(host, files), result);
			return result;
		})(),
	);
}

export async function decodeFleetJournal(host: FleetHost, files: FleetSessionFiles): Promise<readonly unknown[]> {
	const journal = await readJsonl<Record<string, unknown>>(files.journalFile, Number.MAX_SAFE_INTEGER);
	const corrections = await readJsonl<FleetCorrection>(correctionsPath(host, files), Number.MAX_SAFE_INTEGER);
	const byRecord = new Map(corrections.values.map(item => [item.recordId, item]));
	return journal.values.map((record, index) => {
		const recordId = typeof record.id === "string" ? record.id : `line:${index + 1}`;
		const correction = byRecord.get(recordId);
		if (!correction) return record;
		return correction.action === "redact"
			? { id: recordId, type: "redacted", correctionId: correction.correctionId }
			: correction.replacement;
	});
}

function workspaceUri(host: FleetHost, cwd: string): FleetWorkspaceUriMap {
	const sourceRoot = path.resolve(host.workspaceRoot ?? host.root);
	const resolved = path.resolve(cwd);
	const relative = path.relative(sourceRoot, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative))
		fail("workspace-map-refused", `${cwd} is outside ${sourceRoot}`);
	return { sourceRoot, workspaceUri: `workspace://agents/${relative.split(path.sep).join("/")}` };
}

function bundlePath(host: FleetHost, sessionId: string, key: string): string {
	return path.join(host.root, "bundles", sessionId, sha256(key).slice(0, 24));
}

export async function exportFleetSession(
	host: FleetHost,
	files: FleetSessionFiles,
	context: FleetMutationContext,
	cwd: string,
): Promise<FleetReceipt<FleetExportManifest>> {
	return exportFleetSessionInternal(host, files, context, cwd, false);
}

async function exportFleetSessionInternal(
	host: FleetHost,
	files: FleetSessionFiles,
	context: FleetMutationContext,
	cwd: string,
	allowFenced: boolean,
): Promise<FleetReceipt<FleetExportManifest>> {
	return bounded(
		timeoutMs(context),
		(async () => {
			await verifyMutation(host, files, context, "export", allowFenced);
			const prior = await findReceipt<FleetExportManifest>(host, files, "export", context.idempotencyKey);
			if (prior) return prior;
			const checkpointContext = {
				...context,
				idempotencyKey: `${context.idempotencyKey}:checkpoint`,
				capabilities: [...context.capabilities, "checkpoint" as const],
			};
			const checkpoint = (await checkpointFleetSessionInternal(host, files, checkpointContext, allowFenced)).payload;
			const directory = bundlePath(host, files.sessionId, context.idempotencyKey);
			await fs.mkdir(path.join(directory, "data"), { recursive: true });
			if (!files.childStateFile) fail("continuation-state-required", "export requires childStateFile");
			const continuationState = decodeContinuationState(await readJson(files.childStateFile), files.sessionId);
			const sources = [
				files.journalFile,
				...(files.queueFiles ?? []),
				correctionsPath(host, files),
				files.childStateFile,
			];
			const copied: FleetBoundary[] = [];
			for (let index = 0; index < sources.length; index++) {
				const source = sources[index];
				let data: Uint8Array;
				try {
					data = await fs.readFile(source);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					data = new Uint8Array();
				}
				const relative = `data/${index}`;
				await fs.writeFile(path.join(directory, relative), data, { flag: "wx", mode: 0o600 }).catch(async error => {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
					if (sha256(await fs.readFile(path.join(directory, relative))) !== sha256(data))
						fail("resume-digest-mismatch", relative);
				});
				copied.push({
					uri: index === 0 ? `journal://${files.sessionId}` : relative,
					bytes: data.byteLength,
					sha256: sha256(data),
				});
			}
			const base = {
				schemaVersion: FLEET_MIGRATION_SCHEMA_VERSION,
				bundleId: randomUUID(),
				sessionId: files.sessionId,
				sourceHost: host.hostId,
				checkpoint,
				workspace: workspaceUri(host, cwd),
				files: copied,
				closedState: { ...continuationState, queues: checkpoint.queues },
				createdAt: new Date().toISOString(),
			} as const;
			const manifest: FleetExportManifest = { ...base, digest: sha256(stable(base)) };
			await writeJsonAtomic(path.join(directory, "manifest.json"), manifest);
			const result = receipt(host, "export", context, files.sessionId, manifest);
			await appendJsonl(receiptsPath(host, files), result);
			return result;
		})(),
	);
}

export async function importFleetSession(
	sourceBundleDir: string,
	destination: FleetHost,
	context: FleetMutationContext,
	options: { readonly dryRun: true },
): Promise<FleetReceipt<FleetImportResult>> {
	return bounded(
		timeoutMs(context),
		(async () => {
			validateIdempotencyKey(context.idempotencyKey);
			if (!context.capabilities.includes("import")) fail("capability-refused", "missing import");
			if (!options.dryRun) fail("import-refused", "import requires dry-run until migration commits");
			const manifest = (await readJson(path.join(sourceBundleDir, "manifest.json"))) as
				| FleetExportManifest
				| undefined;
			if (!manifest || manifest.schemaVersion !== FLEET_MIGRATION_SCHEMA_VERSION)
				fail("invalid-bundle", "manifest schema");
			const { digest: _digest, ...base } = manifest;
			if (sha256(stable(base)) !== manifest.digest) fail("invalid-bundle", "manifest digest");
			const continuationState = decodeContinuationState(manifest.closedState, manifest.sessionId);
			const proof = context.ownerProof;
			if (
				proof.sessionId !== manifest.sessionId ||
				proof.hostId !== destination.hostId ||
				proof.digest !== ownerDigest(destination, proof.sessionId, proof.ownerEpoch, proof.nonce)
			)
				fail("owner-proof-refused", "invalid destination import proof");
			for (let index = 0; index < manifest.files.length; index++) {
				const file = path.join(sourceBundleDir, `data/${index}`);
				const data = await fs.readFile(file);
				if (data.byteLength !== manifest.files[index].bytes || sha256(data) !== manifest.files[index].sha256)
					fail("invalid-bundle", `data/${index}`);
			}
			if (!manifest.workspace.workspaceUri.startsWith("workspace://agents/"))
				fail("invalid-workspace-uri", manifest.workspace.workspaceUri);
			const suffix = manifest.workspace.workspaceUri.slice("workspace://agents/".length);
			if (suffix.startsWith("/") || suffix.split("/").includes(".."))
				fail("invalid-workspace-uri", manifest.workspace.workspaceUri);
			const receiptFiles: FleetSessionFiles = {
				sessionId: manifest.sessionId,
				journalFile: path.join(sourceBundleDir, "data", "0"),
			};
			const prior = await findReceipt<FleetImportResult>(
				destination,
				receiptFiles,
				"import",
				context.idempotencyKey,
			);
			if (prior) {
				if (prior.payload.manifestDigest !== manifest.digest) fail("idempotency-conflict", context.idempotencyKey);
				return prior;
			}
			const stagingDir = path.join(
				destination.root,
				"staging",
				manifest.sessionId,
				sha256(context.idempotencyKey).slice(0, 24),
			);
			await fs.mkdir(stagingDir, { recursive: true });
			await fs.mkdir(path.join(stagingDir, "data"), { recursive: true });
			for (let index = 0; index < manifest.files.length; index++) {
				const source = path.join(sourceBundleDir, `data/${index}`);
				const target = path.join(stagingDir, `data/${index}`);
				const data = await fs.readFile(source);
				await fs.writeFile(target, data, { flag: "wx", mode: 0o600 }).catch(async error => {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
					if (sha256(await fs.readFile(target)) !== manifest.files[index].sha256)
						fail("resume-digest-mismatch", `data/${index}`);
				});
			}
			await writeJsonAtomic(path.join(stagingDir, "manifest.json"), manifest);
			await writeJsonAtomic(path.join(stagingDir, "validated.json"), {
				manifestDigest: manifest.digest,
				ownerCreated: false,
				continuationHandles: continuationState.children.map(child => child.continuationHandle),
			});
			const payload: FleetImportResult = {
				schemaVersion: FLEET_MIGRATION_SCHEMA_VERSION,
				sessionId: manifest.sessionId,
				destinationHost: destination.hostId,
				stagingDir,
				dryRun: true,
				ownerCreated: false,
				workspacePath: path.join(destination.workspaceRoot ?? destination.root, ...suffix.split("/")),
				manifestDigest: manifest.digest,
			};
			const result = receipt(destination, "import", context, manifest.sessionId, payload);
			await appendJsonl(receiptsPath(destination, receiptFiles), result);
			return result;
		})(),
	);
}

async function readState(file: string): Promise<FleetMigrationState | undefined> {
	return (await readJson(file)) as FleetMigrationState | undefined;
}

/** Read-only acquisition guard consumed by the real session-ownership claimant. */
export async function assertFleetSessionAcquirable(host: FleetHost, files: FleetSessionFiles): Promise<void> {
	const state = await readState(controlPath(host, files));
	if (
		state &&
		(state.phase === "fence-epoch" ||
			state.phase === "transfer" ||
			state.phase === "destination-owner" ||
			state.phase === "health-proof" ||
			state.phase === "commit")
	)
		fail("source-fenced", `migration ${state.migrationId}`);
}

export async function migrateFleetSession(
	source: FleetHost,
	destination: FleetHost,
	files: FleetSessionFiles,
	context: FleetMutationContext,
	options: {
		readonly cwd: string;
		readonly healthProof: (destinationDir: string, destinationEpoch: string) => Promise<unknown>;
		readonly interruptAfterPhase?: FleetMigrationPhase;
	},
): Promise<FleetReceipt<FleetMigrationReceiptPayload>> {
	return bounded(
		timeoutMs(context),
		(async () => {
			await verifyMutation(source, files, context, "migrate", true);
			const stateFile = controlPath(source, files);
			const lockDir = `${stateFile}.lock`;
			await fs.mkdir(path.dirname(stateFile), { recursive: true });
			try {
				await fs.mkdir(lockDir, { recursive: false });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("migration-in-progress", files.sessionId);
				throw error;
			}
			try {
				let state = await readState(stateFile);
				if (state?.phase === "commit") {
					if (state.idempotencyKey === context.idempotencyKey && state.receipt) return state.receipt;
					fail("already-migrated", state.migrationId);
				}
				if (state?.phase === "rolled-back") state = undefined;
				if (state && state.idempotencyKey !== context.idempotencyKey) fail("migration-conflict", state.migrationId);
				const migrationId = state?.migrationId ?? randomUUID();
				const fenceEpoch = state?.fenceEpoch ?? randomUUID();
				const save = async (
					phase: FleetMigrationPhase,
					patch: Partial<FleetMigrationState> = {},
				): Promise<void> => {
					state = {
						...state,
						schemaVersion: FLEET_MIGRATION_SCHEMA_VERSION,
						migrationId,
						idempotencyKey: context.idempotencyKey,
						sessionId: files.sessionId,
						sourceHost: source.hostId,
						destinationHost: destination.hostId,
						sourceEpoch: context.ownerProof.ownerEpoch,
						fenceEpoch,
						phase,
						...patch,
					};
					await writeJsonAtomic(stateFile, state);
					if (options.interruptAfterPhase === phase) fail("simulated-interruption", phase);
				};
				if (!state) await save("prepare");
				if (state?.phase === "prepare") await save("quiesce-source");
				if (state?.phase === "quiesce-source") {
					if (!files.ownerFile) fail("owner-file-required", files.sessionId);
					await writeJsonAtomic(files.ownerFile, {
						schemaVersion: 1,
						sessionId: files.sessionId,
						hostId: source.hostId,
						ownerEpoch: context.ownerProof.ownerEpoch,
						state: "fenced",
						fenceEpoch,
					});
					await save("fence-epoch");
				}
				let bundleDir = state?.bundleDir;
				if (state?.phase === "fence-epoch" || state?.phase === "transfer") {
					const exportContext = {
						...context,
						idempotencyKey: `${context.idempotencyKey}:export`,
						capabilities: [...context.capabilities, "export" as const, "checkpoint" as const],
					};
					await exportFleetSessionFenced(source, files, exportContext, options.cwd);
					bundleDir = bundlePath(source, files.sessionId, exportContext.idempotencyKey);
					const destinationEpoch = state?.destinationEpoch ?? randomUUID();
					const destinationDir =
						state?.destinationDir ?? path.join(destination.root, "sessions", files.sessionId, destinationEpoch);
					await save("transfer", { bundleDir, destinationEpoch, destinationDir });
					const importContext = {
						...context,
						idempotencyKey: `${context.idempotencyKey}:import`,
						capabilities: [...context.capabilities, "import" as const],
						ownerProof: createFleetOwnerProof(destination, files.sessionId, fenceEpoch),
					};
					const imported = await importFleetSession(bundleDir, destination, importContext, { dryRun: true });
					await fs.mkdir(path.dirname(destinationDir), { recursive: true });
					try {
						await fs.rename(imported.payload.stagingDir, destinationDir);
					} catch (error) {
						const code = (error as NodeJS.ErrnoException).code;
						if (code !== "EEXIST" && code !== "ENOENT") throw error;
						const existing = (await readJson(path.join(destinationDir, "manifest.json"))) as
							| FleetExportManifest
							| undefined;
						if (existing?.digest !== imported.payload.manifestDigest)
							fail("resume-digest-mismatch", destinationDir);
						await fs.rm(imported.payload.stagingDir, { recursive: true, force: true });
					}
					await save("destination-owner", { destinationEpoch, destinationDir, bundleDir });
				}
				if (!state?.destinationEpoch || !bundleDir || !state.destinationDir)
					fail("migration-state-corrupt", "destination epoch, directory, or bundle missing");
				const manifest = (await readJson(path.join(bundleDir, "manifest.json"))) as FleetExportManifest;
				const continuationState = decodeContinuationState(manifest.closedState, files.sessionId);
				const destinationOwner = path.join(destination.root, "owners", `${files.sessionId}.json`);
				if (state.phase === "destination-owner") {
					await writeJsonAtomic(destinationOwner, {
						schemaVersion: 1,
						sessionId: files.sessionId,
						hostId: destination.hostId,
						ownerEpoch: state.destinationEpoch,
						fenceEpoch,
						state: "active",
						journalFile: path.join(state.destinationDir, "data", "0"),
						queueRoot: path.join(destination.root, "queues", state.destinationEpoch),
						socketPath: path.join(
							destination.root,
							"sockets",
							`${files.sessionId}-${state.destinationEpoch}.sock`,
						),
						build: { fresh: true },
						continuations: continuationState.children,
						todos: continuationState.todos,
						deferredChanges: continuationState.deferredChanges,
					});
					await save("health-proof");
				}
				if (state.phase !== "health-proof") fail("migration-state-corrupt", state.phase);
				let proof: unknown;
				try {
					proof = await options.healthProof(state.destinationDir, state.destinationEpoch);
					validateHealthProof(proof, continuationState);
				} catch (error) {
					await fs.rm(destinationOwner, { force: true });
					await fs.rm(state.destinationDir, { recursive: true, force: true });
					await writeJsonAtomic(files.ownerFile!, {
						schemaVersion: 1,
						sessionId: files.sessionId,
						hostId: source.hostId,
						ownerEpoch: context.ownerProof.ownerEpoch,
						state: "active",
						reopenedAfter: migrationId,
					});
					await save("rolled-back", { error: error instanceof Error ? error.message : String(error) });
					throw error;
				}
				const payload: FleetMigrationReceiptPayload = {
					migrationId,
					sourceHost: source.hostId,
					destinationHost: destination.hostId,
					sourceEpoch: context.ownerProof.ownerEpoch,
					fenceEpoch,
					destinationEpoch: state.destinationEpoch,
					checkpointDigest: manifest.checkpoint.digest,
					healthProof: proof,
					state: "committed",
				};
				const finalReceipt = receipt(source, "migrate", context, files.sessionId, payload);
				await save("commit", { receipt: finalReceipt });
				await appendJsonl(receiptsPath(source, files), finalReceipt);
				return finalReceipt;
			} finally {
				await fs.rm(lockDir, { recursive: true, force: true });
			}
		})(),
	);
}

async function exportFleetSessionFenced(
	host: FleetHost,
	files: FleetSessionFiles,
	context: FleetMutationContext,
	cwd: string,
): Promise<FleetReceipt<FleetExportManifest>> {
	const owner = (await readJson(files.ownerFile!)) as { ownerEpoch?: string; state?: string };
	if (owner.ownerEpoch !== context.ownerProof.ownerEpoch || owner.state !== "fenced")
		fail("fence-lost", files.sessionId);
	return exportFleetSessionInternal(host, files, context, cwd, true);
}

export interface FleetAttachedSession {
	readonly controller: TerminalSessionController;
	readonly sessionId: string;
	readonly ownerEpoch: string;
}

export async function attachFleetSession(
	socketPath: string,
	hello: TerminalSessionWireClientHello,
): Promise<FleetAttachedSession> {
	const transport = new UnixSocketTerminalSessionTransport({
		socketPath,
		hello,
		requestTimeoutMs: 30_000,
		helloTimeoutMs: 5_000,
	});
	try {
		const controller = await createTerminalSessionController(transport);
		return { controller, sessionId: hello.sessionId, ownerEpoch: hello.ownerEpoch };
	} catch (error) {
		await transport.close();
		throw error;
	}
}

export function defaultFleetHost(root: string, hostId = os.hostname()): FleetHost {
	const signingKey = process.env.OMP_FLEET_SIGNING_KEY;
	if (!signingKey) fail("fleet-signing-key-required", "set OMP_FLEET_SIGNING_KEY");
	return { hostId, root, signingKey, workspaceRoot: path.dirname(root) };
}
