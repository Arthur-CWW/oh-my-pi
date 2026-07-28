import { Effect, Schema } from "effect";
import { Buffer } from "node:buffer";
import { constants, type BigIntStats } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	readdir,
	realpath,
	stat,
	writeFile,
	type FileHandle,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
	CANONICALIZER_VERSION,
	jsonOf,
	sha256Hex,
	stableJson,
} from "./canonical";
import {
	CassetteIntegrityError,
	ComponentDigests,
	RedactionViolationError,
} from "./errors";
import {
	CASSETTE_SCHEMA_VERSION,
	EVENT_SCHEMA_VERSION,
	REQUEST_SCHEMA_VERSION,
	TERMINAL_EVENT_TYPES,
	TimedProviderEvent,
	type JsonValue,
} from "./protocol";
import {
	applyRedaction,
	findRedactionResidue,
	resolveRedactionPolicy,
	type RedactionPolicy,
} from "./redaction";

const MANIFEST_FILE = "manifest.json";
const INTERACTIONS_DIR = "interactions";
const INTERACTION_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const safeInteractionFile = (interactionId: string): string | undefined =>
	INTERACTION_ID.test(interactionId)
		? `${INTERACTIONS_DIR}/${interactionId}.jsonl`
		: undefined;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const NON_BLOCKING = constants.O_NONBLOCK ?? 0;
// A manifest is metadata, while one interaction may hold a long streamed response.
// These limits admit fixtures far larger than the authored examples while bounding
// both the private snapshot and the UTF-8/JSON allocations derived from it.
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_INTERACTION_BYTES = 16 * 1024 * 1024;
const UNTRUSTED_CASSETTE_ID = "unloaded-cassette";

export const CassetteIndexEntry = Schema.Struct({
	interactionId: Schema.String,
	requestDigest: Schema.String,
	componentDigests: ComponentDigests,
	variant: Schema.String,
	attempt: Schema.Int,
	frameCount: Schema.Int,
	file: Schema.String,
	sha256: Schema.String,
});
export type CassetteIndexEntry = Schema.Schema.Type<typeof CassetteIndexEntry>;

export const CassetteManifest = Schema.Struct({
	cassetteSchemaVersion: Schema.Int,
	requestSchemaVersion: Schema.Int,
	eventSchemaVersion: Schema.Int,
	canonicalizerVersion: Schema.Int,
	cassetteId: Schema.String,
	createdAt: Schema.String,
	redaction: Schema.Struct({
		policyVersion: Schema.String,
		rulesDeclared: Schema.Array(Schema.String),
		forbiddenDeclared: Schema.Array(Schema.String),
	}),
	privacyReceipt: Schema.Struct({
		scannedStrings: Schema.Int,
		redactionsApplied: Schema.Int,
		residueFindings: Schema.Int,
	}),
	interactions: Schema.Array(CassetteIndexEntry),
	checksum: Schema.String,
});
export type CassetteManifest = Schema.Schema.Type<typeof CassetteManifest>;

const decodeManifest = Schema.decodeUnknownSync(CassetteManifest);
const decodeFrame = Schema.decodeUnknownSync(TimedProviderEvent);

export interface DraftInteraction {
	readonly interactionId: string;
	readonly requestDigest: string;
	readonly componentDigests: ComponentDigests;
	readonly variant: string;
	readonly attempt: number;
	readonly frames: readonly TimedProviderEvent[];
}

export interface CassetteInteraction extends DraftInteraction {}

export interface Cassette {
	readonly cassetteId: string;
	readonly manifest: CassetteManifest;
	readonly interactions: readonly CassetteInteraction[];
	/** `${requestDigest}|${variant}|${attempt}` */
	readonly byExactKey: ReadonlyMap<string, CassetteInteraction>;
	/** `${requestDigest}|${variant}` */
	readonly byDigestVariant: ReadonlyMap<string, readonly CassetteInteraction[]>;
	/** `${routeDigest}|${variant}` — diagnostics only; never used to serve events. */
	readonly byRouteVariant: ReadonlyMap<string, readonly CassetteInteraction[]>;
}

export const exactKey = (
	requestDigest: string,
	variant: string,
	attempt: number,
): string => `${requestDigest}|${variant}|${attempt}`;

export const digestVariantKey = (
	requestDigest: string,
	variant: string,
): string => `${requestDigest}|${variant}`;

export const routeVariantKey = (routeDigest: string, variant: string): string =>
	`${routeDigest}|${variant}`;

// ---------------------------------------------------------------------------
// Event state machine
// ---------------------------------------------------------------------------

/** Returns a human-readable reason, or `undefined` when the frame sequence is legal. */
export const validateFrames = (
	frames: readonly TimedProviderEvent[],
): string | undefined => {
	if (frames.length === 0) return "interaction has no frames";

	const openCalls: Record<string, string> = {};
	const argumentBuffers: Record<string, string> = {};
	let previousElapsed = -1;
	let terminalIndex = -1;
	let lastInputTokens = -1;
	let lastOutputTokens = -1;

	for (let i = 0; i < frames.length; i++) {
		const frame = frames[i] as TimedProviderEvent;
		if (frame.seq !== i)
			return `frame ${i} has seq ${frame.seq}; sequence must be contiguous from 0`;
		if (frame.elapsedMs < 0) return `frame ${i} has negative elapsedMs`;
		if (frame.elapsedMs < previousElapsed)
			return `frame ${i} elapsedMs decreased from ${previousElapsed}`;
		previousElapsed = frame.elapsedMs;

		const event = frame.event;
		if (i === 0 && event.type !== "response.started")
			return "first frame must be response.started";
		if (i > 0 && event.type === "response.started")
			return `frame ${i} repeats response.started`;
		if (terminalIndex >= 0)
			return `frame ${i} follows terminal frame ${terminalIndex}`;
		if (TERMINAL_EVENT_TYPES[event.type] === true) terminalIndex = i;

		switch (event.type) {
			case "tool.call.started": {
				if (openCalls[event.callId] !== undefined)
					return `frame ${i} reopens tool call ${event.callId}`;
				openCalls[event.callId] = event.name;
				argumentBuffers[event.callId] = "";
				break;
			}
			case "tool.call.arguments.delta": {
				if (openCalls[event.callId] === undefined)
					return `frame ${i} sends arguments for unopened call ${event.callId}`;
				argumentBuffers[event.callId] =
					`${argumentBuffers[event.callId] ?? ""}${event.fragment}`;
				break;
			}
			case "tool.call.completed": {
				const name = openCalls[event.callId];
				if (name === undefined)
					return `frame ${i} completes unopened call ${event.callId}`;
				if (name !== event.name)
					return `frame ${i} completes call ${event.callId} under a different tool name`;
				if ((argumentBuffers[event.callId] ?? "") !== event.argumentsJson) {
					return `frame ${i} argumentsJson does not equal the concatenated fragments for call ${event.callId}`;
				}
				delete openCalls[event.callId];
				break;
			}
			case "usage": {
				if (
					event.usage.inputTokens < lastInputTokens ||
					event.usage.outputTokens < lastOutputTokens
				) {
					return `frame ${i} reports decreasing cumulative usage`;
				}
				lastInputTokens = event.usage.inputTokens;
				lastOutputTokens = event.usage.outputTokens;
				break;
			}
			case "response.completed": {
				if (
					event.usage.inputTokens < lastInputTokens ||
					event.usage.outputTokens < lastOutputTokens
				) {
					return `frame ${i} reports decreasing cumulative usage`;
				}
				break;
			}
			default:
				break;
		}
	}

	if (terminalIndex !== frames.length - 1)
		return "interaction must end with exactly one terminal frame";
	const stillOpen = Object.keys(openCalls);
	if (stillOpen.length > 0) {
		const terminal = frames[terminalIndex]?.event.type;
		// A partial stream may legitimately terminate mid tool-call, but only via a
		// non-success terminal. A completed response must close every tool call.
		if (terminal === "response.completed")
			return `response.completed leaves tool call ${stillOpen[0]} open`;
	}
	return undefined;
};

// ---------------------------------------------------------------------------
// Seal
// ---------------------------------------------------------------------------

export interface SealedCassette {
	readonly manifest: CassetteManifest;
	/** Relative path -> exact bytes to write. */
	readonly files: ReadonlyMap<string, string>;
}

export interface SealCassetteInput {
	readonly cassetteId: string;
	readonly interactions: readonly DraftInteraction[];
	readonly policy: RedactionPolicy;
	readonly createdAt: string;
}

/**
 * This unkeyed self-hash detects accidental manifest corruption; it does not
 * authenticate a fixture-directory writer. An uncooperative same-UID writer
 * that owns the directory is outside the loader's authentication boundary.
 */
const manifestChecksum = (
	manifest: Omit<CassetteManifest, "checksum">,
): string => sha256Hex(stableJson(jsonOf(manifest)));

/**
 * Curation step. Applies the declared policy, then refuses to produce bytes at
 * all if the policy's own invariant is still violated. Recording never writes a
 * bundle directly; sealing is the reviewed gate.
 */
export const sealCassette = Effect.fn("providerTestkit.sealCassette")(
	function* (input: SealCassetteInput) {
		const seen: Record<string, string> = {};
		const entries: CassetteIndexEntry[] = [];
		const files = new Map<string, string>();
		const findings: Array<{
			rule: string;
			pointer: string;
			occurrences: number;
		}> = [];
		let scannedStrings = 0;
		let redactionsApplied = 0;

		for (const draft of input.interactions) {
			if (!INTERACTION_ID.test(draft.interactionId)) {
				return yield* Effect.fail(
					new CassetteIntegrityError({
						cassetteId: input.cassetteId,
						reason: "malformedManifest",
						detail: `interactionId ${JSON.stringify(draft.interactionId)} is not a safe identifier`,
					}),
				);
			}
			const key = exactKey(draft.requestDigest, draft.variant, draft.attempt);
			const previous = seen[key];
			if (previous !== undefined) {
				return yield* Effect.fail(
					new CassetteIntegrityError({
						cassetteId: input.cassetteId,
						reason: "duplicateIndexKey",
						detail: `interactions ${previous} and ${draft.interactionId} share request digest, variant and attempt`,
					}),
				);
			}
			seen[key] = draft.interactionId;

			const redacted = applyRedaction(
				input.policy,
				jsonOf(draft.frames as readonly TimedProviderEvent[] as object),
			);
			scannedStrings += redacted.scannedStrings;
			redactionsApplied += redacted.redactionsApplied;

			const pointer = `/interactions/${draft.interactionId}/frames`;
			for (const finding of findRedactionResidue(
				input.policy,
				redacted.value,
				pointer,
			))
				findings.push(finding);

			const redactedFrames = (redacted.value as readonly JsonValue[]).map(
				(frame) => decodeFrame(frame),
			);
			const invalid = validateFrames(redactedFrames);
			if (invalid !== undefined) {
				return yield* Effect.fail(
					new CassetteIntegrityError({
						cassetteId: input.cassetteId,
						reason: "invalidEventSequence",
						detail: `${draft.interactionId}: ${invalid}`,
					}),
				);
			}

			const file = `${INTERACTIONS_DIR}/${draft.interactionId}.jsonl`;
			const bytes = `${redactedFrames.map((frame) => stableJson(jsonOf(frame))).join("\n")}\n`;
			files.set(file, bytes);
			entries.push({
				interactionId: draft.interactionId,
				requestDigest: draft.requestDigest,
				componentDigests: draft.componentDigests,
				variant: draft.variant,
				attempt: draft.attempt,
				frameCount: redactedFrames.length,
				file,
				sha256: sha256Hex(bytes),
			});
		}

		if (findings.length > 0) {
			return yield* Effect.fail(
				new RedactionViolationError({
					cassetteId: input.cassetteId,
					policyVersion: input.policy.version,
					findings,
				}),
			);
		}

		const withoutChecksum = {
			cassetteSchemaVersion: CASSETTE_SCHEMA_VERSION,
			requestSchemaVersion: REQUEST_SCHEMA_VERSION,
			eventSchemaVersion: EVENT_SCHEMA_VERSION,
			canonicalizerVersion: CANONICALIZER_VERSION,
			cassetteId: input.cassetteId,
			createdAt: input.createdAt,
			redaction: {
				policyVersion: input.policy.version,
				rulesDeclared: input.policy.rules.map((rule) => rule.name),
				forbiddenDeclared: input.policy.forbidden.map((rule) => rule.name),
			},
			privacyReceipt: { scannedStrings, redactionsApplied, residueFindings: 0 },
			interactions: entries,
		} satisfies Omit<CassetteManifest, "checksum">;

		const manifest: CassetteManifest = {
			...withoutChecksum,
			checksum: manifestChecksum(withoutChecksum),
		};
		files.set(MANIFEST_FILE, `${stableJson(jsonOf(manifest))}\n`);
		return { manifest, files } satisfies SealedCassette;
	},
);

export const writeSealedCassette = Effect.fn(
	"providerTestkit.writeSealedCassette",
)(function* (directory: string, sealed: SealedCassette) {
	for (const [relative, bytes] of sealed.files) {
		const target = join(directory, relative);
		yield* Effect.tryPromise({
			try: async () => {
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, bytes, "utf8");
			},
			catch: (cause) =>
				new CassetteIntegrityError({
					cassetteId: sealed.manifest.cassetteId,
					reason: "unreadable",
					detail: `could not write ${relative}: ${String(cause)}`,
				}),
		});
	}
	return directory;
});

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

const integrity = (
	cassetteId: string,
	reason: CassetteIntegrityError["reason"],
	detail: string,
): CassetteIntegrityError =>
	new CassetteIntegrityError({ cassetteId, reason, detail });

interface CassetteFilePathSnapshot {
	readonly root: BigIntStats;
	readonly parent: BigIntStats;
	readonly target: BigIntStats;
}

interface OpenedCassetteFile {
	readonly handle: FileHandle;
	readonly target: string;
	readonly root: string;
	readonly expected: string;
	readonly snapshot: Buffer;
	readonly opened: BigIntStats;
	readonly paths: CassetteFilePathSnapshot;
}

interface CassetteFileReadOptions {
	readonly beforeOpen?: (fileId: string) => Promise<void>;
	readonly beforeRead?: (fileId: string) => Promise<void>;
	readonly duringRead?: (fileId: string) => Promise<void>;
}

/** @internal Scheduling seams for deterministic filesystem-race tests. */
export interface CassetteLoadOptions {
	readonly beforeManifestOpen?: (file: string) => Promise<void>;
	readonly beforeInteractionOpen?: (interactionId: string) => Promise<void>;
	readonly beforeInteractionRead?: (interactionId: string) => Promise<void>;
	readonly duringInteractionRead?: (interactionId: string) => Promise<void>;
}

const hasIdentity = (stats: BigIntStats): boolean => stats.ino !== 0n;

// Exact equality fails closed when a platform reports zero for an unavailable link count.
const isSingleLinkRegularFile = (stats: BigIntStats): boolean =>
	stats.isFile() && hasIdentity(stats) && stats.nlink === 1n;

const sameIdentity = (left: BigIntStats, right: BigIntStats): boolean =>
	left.dev === right.dev && left.ino === right.ino;

const unsafeInteractionPath = (cassetteId: string): CassetteIntegrityError =>
	integrity(
		cassetteId,
		"unsafeInteractionPath",
		"cassette file must be a regular file inside the resolved cassette root",
	);

const inspectCassetteFilePath = async (
	directory: string,
	cassetteId: string,
	root: string,
	expected: string,
	target: string,
): Promise<CassetteFilePathSnapshot> => {
	const expectedTarget = resolve(root, expected);
	const expectedParent = dirname(expectedTarget);
	const parentPath = dirname(target);
	const parentIsRoot = expectedParent === root;
	const [
		rootStats,
		parentStats,
		targetStats,
		resolvedRoot,
		resolvedParent,
		resolvedTarget,
	] = await Promise.all([
		stat(directory, { bigint: true }),
		parentIsRoot
			? stat(parentPath, { bigint: true })
			: lstat(parentPath, { bigint: true }),
		lstat(target, { bigint: true }),
		realpath(directory),
		realpath(parentPath),
		realpath(target),
	]);
	if (
		!rootStats.isDirectory() ||
		!parentStats.isDirectory() ||
		!isSingleLinkRegularFile(targetStats) ||
		(!parentIsRoot && parentStats.isSymbolicLink()) ||
		targetStats.isSymbolicLink() ||
		!hasIdentity(rootStats) ||
		!hasIdentity(parentStats) ||
		(parentIsRoot && !sameIdentity(rootStats, parentStats)) ||
		resolvedRoot !== root ||
		resolvedParent !== expectedParent ||
		resolvedTarget !== expectedTarget ||
		!resolvedTarget.startsWith(`${root}${sep}`) ||
		!resolvedTarget.startsWith(`${resolvedParent}${sep}`)
	) {
		throw unsafeInteractionPath(cassetteId);
	}
	return { root: rootStats, parent: parentStats, target: targetStats };
};

const snapshotsMatch = (
	left: CassetteFilePathSnapshot,
	right: CassetteFilePathSnapshot,
): boolean =>
	sameIdentity(left.root, right.root) &&
	sameIdentity(left.parent, right.parent) &&
	sameIdentity(left.target, right.target);

const sameContentMetadata = (left: BigIntStats, right: BigIntStats): boolean =>
	left.size === right.size &&
	left.mtimeNs === right.mtimeNs &&
	left.ctimeNs === right.ctimeNs;

const sameFileSnapshot = (left: BigIntStats, right: BigIntStats): boolean =>
	sameIdentity(left, right) && sameContentMetadata(left, right);

const byteLength = (
	stats: BigIntStats,
	cassetteId: string,
	maxBytes: number,
	tooLargeDetail: string,
): number => {
	if (stats.size > BigInt(maxBytes))
		throw integrity(cassetteId, "fileTooLarge", tooLargeDetail);
	const size = Number(stats.size);
	if (!Number.isSafeInteger(size) || size < 0)
		throw unsafeInteractionPath(cassetteId);
	return size;
};

const snapshotDescriptor = async (
	handle: FileHandle,
	size: number,
): Promise<Buffer> => {
	const snapshot = Buffer.allocUnsafe(size);
	let offset = 0;
	while (offset < size) {
		const { bytesRead } = await handle.read(
			snapshot,
			offset,
			size - offset,
			offset,
		);
		if (bytesRead === 0)
			throw new Error("cassette file ended while snapshotting");
		offset += bytesRead;
	}
	const probe = Buffer.allocUnsafe(1);
	const { bytesRead } = await handle.read(probe, 0, 1, size);
	if (bytesRead !== 0) throw new Error("cassette file grew while snapshotting");
	return snapshot;
};

const descriptorMatchesSnapshot = async (
	handle: FileHandle,
	expected: Buffer,
	fileId: string,
	duringRead: CassetteFileReadOptions["duringRead"],
): Promise<boolean> => {
	const chunk = Buffer.allocUnsafe(
		Math.min(64 * 1024, Math.max(1, expected.length)),
	);
	let offset = 0;
	let barrier = duringRead;
	while (offset < expected.length) {
		const length =
			barrier === undefined
				? Math.min(chunk.length, expected.length - offset)
				: 1;
		const { bytesRead } = await handle.read(chunk, 0, length, offset);
		if (
			bytesRead === 0 ||
			!chunk
				.subarray(0, bytesRead)
				.equals(expected.subarray(offset, offset + bytesRead))
		) {
			return false;
		}
		offset += bytesRead;
		if (barrier !== undefined) {
			const runBarrier = barrier;
			barrier = undefined;
			await runBarrier(fileId);
		}
	}
	const { bytesRead } = await handle.read(chunk, 0, 1, expected.length);
	return bytesRead === 0;
};

const openCassetteFile = async (
	directory: string,
	cassetteId: string,
	expected: string,
	fileId: string,
	maxBytes: number,
	tooLargeDetail: string,
	options: CassetteFileReadOptions | undefined,
): Promise<OpenedCassetteFile> => {
	const root = await realpath(directory);
	const target = join(directory, expected);
	const beforeOpen = await inspectCassetteFilePath(
		directory,
		cassetteId,
		root,
		expected,
		target,
	);
	await options?.beforeOpen?.(fileId);
	const handle = await open(
		target,
		constants.O_RDONLY | NON_BLOCKING | NO_FOLLOW,
	);
	try {
		const [openedBeforeSnapshot, afterOpen] = await Promise.all([
			handle.stat({ bigint: true }),
			inspectCassetteFilePath(directory, cassetteId, root, expected, target),
		]);
		if (
			!isSingleLinkRegularFile(openedBeforeSnapshot) ||
			!sameFileSnapshot(beforeOpen.target, openedBeforeSnapshot) ||
			!sameFileSnapshot(openedBeforeSnapshot, afterOpen.target) ||
			!snapshotsMatch(beforeOpen, afterOpen)
		) {
			throw unsafeInteractionPath(cassetteId);
		}

		const size = byteLength(
			openedBeforeSnapshot,
			cassetteId,
			maxBytes,
			tooLargeDetail,
		);
		const snapshot = await snapshotDescriptor(handle, size);
		const [opened, paths] = await Promise.all([
			handle.stat({ bigint: true }),
			inspectCassetteFilePath(directory, cassetteId, root, expected, target),
		]);
		if (
			!isSingleLinkRegularFile(opened) ||
			!sameFileSnapshot(openedBeforeSnapshot, opened) ||
			!sameFileSnapshot(opened, paths.target) ||
			!snapshotsMatch(afterOpen, paths)
		) {
			throw unsafeInteractionPath(cassetteId);
		}
		return { handle, target, root, expected, snapshot, opened, paths };
	} catch (cause) {
		await handle.close().catch(() => undefined);
		throw cause;
	}
};

/**
 * The process-private snapshot (and the UTF-8 string derived from it) is the
 * sole input to hashing and parsing. The second descriptor scan detects a torn
 * multi-read snapshot; it cannot prove that the source file never mutated.
 */
const readCassetteFile = async (
	directory: string,
	cassetteId: string,
	expected: string,
	fileId: string,
	maxBytes: number,
	tooLargeDetail: string,
	options: CassetteFileReadOptions | undefined,
): Promise<string> => {
	const opened = await openCassetteFile(
		directory,
		cassetteId,
		expected,
		fileId,
		maxBytes,
		tooLargeDetail,
		options,
	);
	try {
		await options?.beforeRead?.(fileId);
		const [beforeRead, pathsBeforeRead] = await Promise.all([
			opened.handle.stat({ bigint: true }),
			inspectCassetteFilePath(
				directory,
				cassetteId,
				opened.root,
				opened.expected,
				opened.target,
			),
		]);
		if (
			!isSingleLinkRegularFile(beforeRead) ||
			!sameFileSnapshot(opened.opened, beforeRead) ||
			!sameFileSnapshot(beforeRead, pathsBeforeRead.target) ||
			!snapshotsMatch(opened.paths, pathsBeforeRead)
		) {
			throw unsafeInteractionPath(cassetteId);
		}

		const matches = await descriptorMatchesSnapshot(
			opened.handle,
			opened.snapshot,
			fileId,
			options?.duringRead,
		);
		const [afterRead, pathsAfterRead] = await Promise.all([
			opened.handle.stat({ bigint: true }),
			inspectCassetteFilePath(
				directory,
				cassetteId,
				opened.root,
				opened.expected,
				opened.target,
			),
		]);
		if (
			!matches ||
			!isSingleLinkRegularFile(afterRead) ||
			!sameFileSnapshot(beforeRead, afterRead) ||
			!sameFileSnapshot(afterRead, pathsAfterRead.target) ||
			!snapshotsMatch(pathsBeforeRead, pathsAfterRead)
		) {
			throw unsafeInteractionPath(cassetteId);
		}
		return opened.snapshot.toString("utf8");
	} finally {
		await opened.handle.close();
	}
};

const readManifestFile = (
	directory: string,
	options: CassetteLoadOptions | undefined,
): Promise<string> =>
	readCassetteFile(
		directory,
		UNTRUSTED_CASSETTE_ID,
		MANIFEST_FILE,
		MANIFEST_FILE,
		MAX_MANIFEST_BYTES,
		"manifest exceeds the 1048576-byte limit",
		options?.beforeManifestOpen === undefined
			? undefined
			: { beforeOpen: options.beforeManifestOpen },
	);

const readInteractionFile = (
	directory: string,
	interactionId: string,
	file: string,
	options: CassetteLoadOptions | undefined,
): Promise<string> => {
	const expected = safeInteractionFile(interactionId);
	if (expected === undefined || file !== expected) {
		throw integrity(
			UNTRUSTED_CASSETTE_ID,
			"unsafeInteractionPath",
			"interaction file must exactly match interactions/<safe-id>.jsonl",
		);
	}
	const interactionOptions: CassetteFileReadOptions | undefined =
		options === undefined
			? undefined
			: {
					...(options.beforeInteractionOpen === undefined
						? {}
						: { beforeOpen: options.beforeInteractionOpen }),
					...(options.beforeInteractionRead === undefined
						? {}
						: { beforeRead: options.beforeInteractionRead }),
					...(options.duringInteractionRead === undefined
						? {}
						: { duringRead: options.duringInteractionRead }),
				};
	return readCassetteFile(
		directory,
		UNTRUSTED_CASSETTE_ID,
		expected,
		interactionId,
		MAX_INTERACTION_BYTES,
		"interaction exceeds the 16777216-byte limit",
		interactionOptions,
	);
};

export const loadCassette = Effect.fn("providerTestkit.loadCassette")(
	function* (directory: string, options?: CassetteLoadOptions) {
		const manifestBytes = yield* Effect.tryPromise({
			try: () => readManifestFile(directory, options),
			catch: (cause) =>
				cause instanceof CassetteIntegrityError
					? cause
					: integrity(
							UNTRUSTED_CASSETTE_ID,
							"unreadable",
							"could not read manifest",
						),
		});

		const manifest = yield* Effect.try({
			try: () => decodeManifest(JSON.parse(manifestBytes) as JsonValue),
			catch: () =>
				integrity(
					UNTRUSTED_CASSETTE_ID,
					"malformedManifest",
					"manifest is not valid JSON or does not match the manifest schema",
				),
		});

		const id = manifest.cassetteId;
		if (
			manifest.cassetteSchemaVersion !== CASSETTE_SCHEMA_VERSION ||
			manifest.requestSchemaVersion !== REQUEST_SCHEMA_VERSION ||
			manifest.eventSchemaVersion !== EVENT_SCHEMA_VERSION ||
			manifest.canonicalizerVersion !== CANONICALIZER_VERSION
		) {
			return yield* Effect.fail(
				integrity(
					UNTRUSTED_CASSETTE_ID,
					"unsupportedVersion",
					"manifest declares unsupported schema versions",
				),
			);
		}

		const { checksum, ...rest } = manifest;
		const recomputed = manifestChecksum(rest);
		if (recomputed !== checksum) {
			return yield* Effect.fail(
				integrity(
					UNTRUSTED_CASSETTE_ID,
					"checksumMismatch",
					"manifest checksum does not cover the manifest bytes",
				),
			);
		}

		const policy = resolveRedactionPolicy(manifest.redaction.policyVersion);
		if (policy === undefined) {
			return yield* Effect.fail(
				integrity(
					UNTRUSTED_CASSETTE_ID,
					"unknownRedactionPolicy",
					"manifest declares an unregistered redaction policy",
				),
			);
		}

		const interactions: CassetteInteraction[] = [];
		const byExactKey = new Map<string, CassetteInteraction>();
		const byDigestVariant = new Map<string, CassetteInteraction[]>();
		const byRouteVariant = new Map<string, CassetteInteraction[]>();

		for (const entry of manifest.interactions) {
			const bytes = yield* Effect.tryPromise({
				try: () =>
					readInteractionFile(
						directory,
						entry.interactionId,
						entry.file,
						options,
					),
				catch: (cause) =>
					cause instanceof CassetteIntegrityError
						? cause
						: integrity(
								UNTRUSTED_CASSETTE_ID,
								"unreadable",
								"could not read interaction file",
							),
			});
			if (sha256Hex(bytes) !== entry.sha256) {
				return yield* Effect.fail(
					integrity(
						UNTRUSTED_CASSETTE_ID,
						"fileChecksumMismatch",
						"interaction does not match its manifest digest",
					),
				);
			}

			const frames = yield* Effect.try({
				try: () =>
					bytes
						.split("\n")
						.filter((line) => line.length > 0)
						.map((line) => decodeFrame(JSON.parse(line) as JsonValue)),
				catch: () =>
					integrity(
						UNTRUSTED_CASSETTE_ID,
						"malformedFrame",
						"interaction frame is not valid JSON or does not match the event schema",
					),
			});

			if (frames.length !== entry.frameCount) {
				return yield* Effect.fail(
					integrity(
						UNTRUSTED_CASSETTE_ID,
						"malformedFrame",
						"interaction frame count does not match the manifest",
					),
				);
			}
			const invalid = validateFrames(frames);
			if (invalid !== undefined) {
				return yield* Effect.fail(
					integrity(
						UNTRUSTED_CASSETTE_ID,
						"invalidEventSequence",
						"interaction frame sequence violates the protocol",
					),
				);
			}

			const residue = findRedactionResidue(
				policy,
				jsonOf(frames as readonly TimedProviderEvent[] as object),
				`/interactions/${entry.interactionId}/frames`,
			);
			if (residue.length > 0) {
				return yield* Effect.fail(
					integrity(
						UNTRUSTED_CASSETTE_ID,
						"redactionResidue",
						"interaction violates the declared redaction policy",
					),
				);
			}

			const interaction: CassetteInteraction = {
				interactionId: entry.interactionId,
				requestDigest: entry.requestDigest,
				componentDigests: entry.componentDigests,
				variant: entry.variant,
				attempt: entry.attempt,
				frames,
			};

			const key = exactKey(entry.requestDigest, entry.variant, entry.attempt);
			if (byExactKey.has(key)) {
				return yield* Effect.fail(
					integrity(
						UNTRUSTED_CASSETTE_ID,
						"duplicateIndexKey",
						"manifest contains a duplicate interaction index key",
					),
				);
			}
			byExactKey.set(key, interaction);
			interactions.push(interaction);

			const dv = digestVariantKey(entry.requestDigest, entry.variant);
			const dvList = byDigestVariant.get(dv);
			if (dvList === undefined) byDigestVariant.set(dv, [interaction]);
			else dvList.push(interaction);

			const rv = routeVariantKey(entry.componentDigests.route, entry.variant);
			const rvList = byRouteVariant.get(rv);
			if (rvList === undefined) byRouteVariant.set(rv, [interaction]);
			else rvList.push(interaction);
		}

		return {
			cassetteId: id,
			manifest,
			interactions,
			byExactKey,
			byDigestVariant,
			byRouteVariant,
		} satisfies Cassette;
	},
);

/** Lists interaction files present on disk; used to detect files a mutated manifest dropped. */
export const listInteractionFiles = Effect.fn(
	"providerTestkit.listInteractionFiles",
)(function* (directory: string) {
	return yield* Effect.tryPromise({
		try: () => readdir(join(directory, INTERACTIONS_DIR)),
		catch: () =>
			integrity(
				UNTRUSTED_CASSETTE_ID,
				"unreadable",
				"could not list interaction files",
			),
	});
});
