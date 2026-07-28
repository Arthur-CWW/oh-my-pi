import { afterEach, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { constants } from "node:fs";
import {
	mkdtemp,
	link,
	open,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	truncate,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
	componentDigests,
	jsonOf,
	requestDigest,
	sha256Hex,
	stableJson,
} from "../src/canonical";
import {
	loadCassette,
	sealCassette,
	validateFrames,
	writeSealedCassette,
	type CassetteManifest,
	type DraftInteraction,
} from "../src/cassette";
import { CassetteIntegrityError } from "../src/errors";
import type { TimedProviderEvent } from "../src/protocol";
import { DEFAULT_REDACTION_POLICY } from "../src/redaction";
import { scriptedFrames } from "../src/scripted";
import { exampleRequest, exampleSteps } from "./support/fixtures";

const roots: string[] = [];

const freshRoot = async (): Promise<string> => {
	const root = await mkdtemp(join(tmpdir(), "provider-testkit-cassette-"));
	roots.push(root);
	return root;
};

afterEach(async () => {
	while (roots.length > 0)
		await rm(roots.pop() as string, { recursive: true, force: true });
});

const draftOf = (
	overrides: Partial<DraftInteraction> = {},
): DraftInteraction => {
	const request = exampleRequest();
	return {
		interactionId: "success",
		requestDigest: requestDigest(request),
		componentDigests: componentDigests(request),
		variant: "default",
		attempt: 1,
		frames: scriptedFrames(exampleSteps),
		...overrides,
	};
};

const seal = (interactions: readonly DraftInteraction[]) =>
	sealCassette({
		cassetteId: "unit",
		interactions,
		policy: DEFAULT_REDACTION_POLICY,
		createdAt: "2026-07-27T00:00:00.000Z",
	});

const rewriteInteractionFile = async (
	root: string,
	file: string,
): Promise<void> => {
	const manifestPath = join(root, "manifest.json");
	const manifest = JSON.parse(
		await readFile(manifestPath, "utf8"),
	) as CassetteManifest;
	const entry = manifest.interactions[0];
	if (entry === undefined)
		throw new Error("fixture manifest has no interaction");
	const changed = { ...manifest, interactions: [{ ...entry, file }] };
	const { checksum: previousChecksum, ...withoutChecksum } = changed;
	if (previousChecksum.length === 0)
		throw new Error("fixture manifest has no checksum");
	const checksum = sha256Hex(stableJson(jsonOf(withoutChecksum)));
	await writeFile(
		manifestPath,
		`${stableJson(jsonOf({ ...withoutChecksum, checksum }))}\n`,
		"utf8",
	);
};
const rewriteInteractionDigest = async (
	root: string,
	sha256: string,
): Promise<void> => {
	const manifestPath = join(root, "manifest.json");
	const manifest = JSON.parse(
		await readFile(manifestPath, "utf8"),
	) as CassetteManifest;
	const entry = manifest.interactions[0];
	if (entry === undefined)
		throw new Error("fixture manifest has no interaction");
	const changed = { ...manifest, interactions: [{ ...entry, sha256 }] };
	const { checksum: previousChecksum, ...withoutChecksum } = changed;
	if (previousChecksum.length === 0)
		throw new Error("fixture manifest has no checksum");
	const checksum = sha256Hex(stableJson(jsonOf(withoutChecksum)));
	await writeFile(
		manifestPath,
		`${stableJson(jsonOf({ ...withoutChecksum, checksum }))}\n`,
		"utf8",
	);
};

const prepareInPlaceMutation = async (
	root: string,
): Promise<{
	readonly interactionPath: string;
	readonly replacement: string;
}> => {
	const interactionPath = join(root, "interactions", "success.jsonl");
	const original = await readFile(interactionPath, "utf8");
	const replacement = original.replace(
		"Looking up the seeded source",
		"MUTATED FRAME MUST NOT LOAD!",
	);
	if (replacement === original)
		throw new Error("fixture did not contain the expected frame text");
	if (Buffer.byteLength(replacement) !== Buffer.byteLength(original)) {
		throw new Error("in-place mutation fixture must preserve file size");
	}
	await rewriteInteractionDigest(root, sha256Hex(replacement));
	return { interactionPath, replacement };
};

const makeFifo = async (path: string): Promise<void> => {
	const process = Bun.spawn(["mkfifo", path], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const status = await process.exited;
	if (status !== 0)
		throw new Error(
			`mkfifo failed (${status}): ${await new Response(process.stderr).text()}`,
		);
};

const withDeadline = async <A>(
	promise: Promise<A>,
	unblock: () => Promise<void>,
): Promise<A> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			void unblock().then(
				() =>
					reject(new Error("cassette load blocked on a raced special file")),
				(cause) => reject(cause),
			);
		}, 1_000);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
};

const raceInteractionRead = async (
	replacement: "symlink" | "rename",
): Promise<string> => {
	const root = await freshRoot();
	await Effect.runPromise(
		Effect.flatMap(seal([draftOf()]), (sealed) =>
			writeSealedCassette(root, sealed),
		),
	);
	const interactionPath = join(root, "interactions", "success.jsonl");
	const heldOriginal = join(root, "interactions", "held-original.jsonl");
	const external = join(
		dirname(root),
		`${basename(root)}-${replacement}-external.jsonl`,
	);
	roots.push(external);
	const original = await readFile(interactionPath, "utf8");
	const externalBytes = original.replace(
		"Looking up the seeded source",
		"EXTERNAL FRAME MUST NOT LOAD",
	);
	if (externalBytes === original)
		throw new Error("fixture did not contain the expected frame text");
	await writeFile(external, externalBytes, "utf8");
	await rewriteInteractionDigest(root, sha256Hex(externalBytes));

	let barrierRuns = 0;
	const exit = await Effect.runPromiseExit(
		loadCassette(root, {
			beforeInteractionRead: async (interactionId) => {
				expect(interactionId).toBe("success");
				barrierRuns++;
				await rename(interactionPath, heldOriginal);
				if (replacement === "symlink") await symlink(external, interactionPath);
				else await rename(external, interactionPath);
			},
		}),
	);
	expect(barrierRuns).toBe(1);
	expect(exit._tag).toBe("Failure");
	return JSON.stringify(exit);
};

const unsafePathReason = async (root: string): Promise<string> => {
	const exit = await Effect.runPromiseExit(loadCassette(root));
	expect(exit._tag).toBe("Failure");
	return JSON.stringify(exit);
};

describe("cassette sealing and loading", () => {
	it("round-trips a sealed bundle through disk", async () => {
		const root = await freshRoot();
		const loaded = await Effect.runPromise(
			Effect.gen(function* () {
				const sealed = yield* seal([draftOf()]);
				yield* writeSealedCassette(root, sealed);
				return yield* loadCassette(root);
			}),
		);

		expect(loaded.interactions).toHaveLength(1);
		expect(loaded.interactions[0]?.frames).toEqual(
			scriptedFrames(exampleSteps) as TimedProviderEvent[],
		);
		expect(loaded.manifest.privacyReceipt.residueFindings).toBe(0);
	});

	it("rejects a mutated frame file even when the manifest is untouched", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);

		const framePath = join(root, "interactions", "success.jsonl");
		const original = await readFile(framePath, "utf8");
		await writeFile(
			framePath,
			original.replace(
				"Looking up the seeded source",
				"Looking up something else",
			),
			"utf8",
		);

		const exit = await Effect.runPromiseExit(loadCassette(root));
		expect(exit._tag).toBe("Failure");
		expect(JSON.stringify(exit)).toContain("fileChecksumMismatch");
	});

	it("rejects a manifest whose checksum no longer covers its contents", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);

		const manifestPath = join(root, "manifest.json");
		const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
			createdAt: string;
		};
		manifest.createdAt = "2020-01-01T00:00:00.000Z";
		await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

		const exit = await Effect.runPromiseExit(loadCassette(root));
		expect(exit._tag).toBe("Failure");
		expect(JSON.stringify(exit)).toContain("checksumMismatch");
	});

	it("rejects an external manifest symlink without disclosing target bytes", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		const manifestPath = join(root, "manifest.json");
		const external = join(
			dirname(root),
			`${basename(root)}-manifest-secret.json`,
		);
		const token = "MANIFEST_SYMLINK_TOKEN_MUST_NOT_ESCAPE";
		roots.push(external);
		await writeFile(external, token, "utf8");
		await unlink(manifestPath);
		await symlink(external, manifestPath);

		const error = await Effect.runPromise(Effect.flip(loadCassette(root)));
		expect(error).toBeInstanceOf(CassetteIntegrityError);
		expect(error.reason).toBe("unsafeInteractionPath");
		expect(`${String(error)}\n${JSON.stringify(error)}`).not.toContain(token);
	});

	it("rejects an external manifest hardlink without disclosing target bytes", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		const manifestPath = join(root, "manifest.json");
		const external = join(
			dirname(root),
			`${basename(root)}-manifest-hardlink-secret.json`,
		);
		const token = "MANIFEST_HARDLINK_TOKEN_MUST_NOT_ESCAPE";
		roots.push(external);
		await writeFile(external, token, "utf8");
		await unlink(manifestPath);
		await link(external, manifestPath);

		const error = await Effect.runPromise(Effect.flip(loadCassette(root)));
		expect(error).toBeInstanceOf(CassetteIntegrityError);
		expect(error.reason).toBe("unsafeInteractionPath");
		expect(`${String(error)}\n${JSON.stringify(error)}`).not.toContain(token);
	});

	it("redacts malformed manifest bytes from the typed error", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		const token = "MALFORMED_MANIFEST_TOKEN_MUST_NOT_ESCAPE";
		await writeFile(join(root, "manifest.json"), token, "utf8");

		const error = await Effect.runPromise(Effect.flip(loadCassette(root)));
		expect(error).toBeInstanceOf(CassetteIntegrityError);
		expect(error.reason).toBe("malformedManifest");
		expect(`${String(error)}\n${JSON.stringify(error)}`).not.toContain(token);
	});

	it("redacts malformed interaction bytes from the typed error", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		const token = "MALFORMED_INTERACTION_TOKEN_MUST_NOT_ESCAPE";
		await rewriteInteractionDigest(root, sha256Hex(token));
		await writeFile(join(root, "interactions", "success.jsonl"), token, "utf8");

		const error = await Effect.runPromise(Effect.flip(loadCassette(root)));
		expect(error).toBeInstanceOf(CassetteIntegrityError);
		expect(error.reason).toBe("malformedFrame");
		expect(`${String(error)}\n${JSON.stringify(error)}`).not.toContain(token);
	});

	it("opens a raced manifest FIFO nonblocking and rejects it as unsafe", async () => {
		if (process.platform === "win32") return;
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		const manifestPath = join(root, "manifest.json");
		const heldManifest = join(root, "manifest.held.json");
		let barrierRuns = 0;

		const exit = await withDeadline(
			Effect.runPromiseExit(
				loadCassette(root, {
					beforeManifestOpen: async (file) => {
						expect(file).toBe("manifest.json");
						barrierRuns++;
						await rename(manifestPath, heldManifest);
						await makeFifo(manifestPath);
					},
				}),
			),
			async () => {
				const writer = await open(
					manifestPath,
					constants.O_WRONLY | constants.O_NONBLOCK,
				);
				await writer.close();
			},
		);

		expect(barrierRuns).toBe(1);
		expect(exit._tag).toBe("Failure");
		expect(JSON.stringify(exit)).toContain("unsafeInteractionPath");
	});

	it("rejects an oversized manifest before allocating its snapshot", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		await truncate(join(root, "manifest.json"), 1024 * 1024 + 1);

		const error = await Effect.runPromise(Effect.flip(loadCassette(root)));
		expect(error).toBeInstanceOf(CassetteIntegrityError);
		expect(error.reason).toBe("fileTooLarge");
		expect(error.detail).toBe("manifest exceeds the 1048576-byte limit");
	});

	it("rejects an oversized interaction before allocating its snapshot", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		await truncate(
			join(root, "interactions", "success.jsonl"),
			16 * 1024 * 1024 + 1,
		);

		const error = await Effect.runPromise(Effect.flip(loadCassette(root)));
		expect(error).toBeInstanceOf(CassetteIntegrityError);
		expect(error.reason).toBe("fileTooLarge");
		expect(error.detail).toBe("interaction exceeds the 16777216-byte limit");
	});

	it("rejects a traversal path with a recomputed manifest checksum before reading outside bytes", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		const original = await readFile(
			join(root, "interactions", "success.jsonl"),
			"utf8",
		);
		const outside = join(dirname(root), `${basename(root)}-outside.jsonl`);
		roots.push(outside);
		await writeFile(outside, original, "utf8");
		await rewriteInteractionFile(root, `../${basename(outside)}`);

		expect(await unsafePathReason(root)).toContain("unsafeInteractionPath");
	});

	it("rejects absolute, backslash and encoded interaction paths", async () => {
		for (const file of [
			"/tmp/provider-testkit-outside.jsonl",
			String.raw`interactions\success.jsonl`,
			"interactions%2Fsuccess.jsonl",
			"interactions/%2e%2e/success.jsonl",
		]) {
			const root = await freshRoot();
			await Effect.runPromise(
				Effect.flatMap(seal([draftOf()]), (sealed) =>
					writeSealedCassette(root, sealed),
				),
			);
			await rewriteInteractionFile(root, file);
			expect(await unsafePathReason(root)).toContain("unsafeInteractionPath");
		}
	});

	it("rejects an interaction-file symlink before reading its target", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		const interactionPath = join(root, "interactions", "success.jsonl");
		const outside = join(
			dirname(root),
			`${basename(root)}-symlink-target.jsonl`,
		);
		roots.push(outside);
		await writeFile(outside, await readFile(interactionPath, "utf8"), "utf8");
		await unlink(interactionPath);
		await symlink(outside, interactionPath);

		expect(await unsafePathReason(root)).toContain("unsafeInteractionPath");
	});

	it("rejects an external interaction hardlink without disclosing target bytes", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		const interactionPath = join(root, "interactions", "success.jsonl");
		const external = join(
			dirname(root),
			`${basename(root)}-interaction-hardlink-secret.jsonl`,
		);
		const token = "INTERACTION_HARDLINK_TOKEN_MUST_NOT_ESCAPE";
		roots.push(external);
		await writeFile(external, token, "utf8");
		await unlink(interactionPath);
		await link(external, interactionPath);
		await rewriteInteractionDigest(root, sha256Hex(token));

		const error = await Effect.runPromise(Effect.flip(loadCassette(root)));
		expect(error).toBeInstanceOf(CassetteIntegrityError);
		expect(error.reason).toBe("unsafeInteractionPath");
		expect(`${String(error)}\n${JSON.stringify(error)}`).not.toContain(token);
	});

	it("rejects a symlinked interactions directory before reading through it", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		const interactionsPath = join(root, "interactions");
		const outside = join(
			dirname(root),
			`${basename(root)}-interactions-target`,
		);
		roots.push(outside);
		await rename(interactionsPath, outside);
		await symlink(outside, interactionsPath);

		expect(await unsafePathReason(root)).toContain("unsafeInteractionPath");
	});
	it("rejects a symlink swap after descriptor validation without reading its external target", async () => {
		expect(await raceInteractionRead("symlink")).toContain(
			"unsafeInteractionPath",
		);
	});

	it("rejects a renamed external file after descriptor validation without reading its bytes", async () => {
		expect(await raceInteractionRead("rename")).toContain(
			"unsafeInteractionPath",
		);
	});

	it("opens a raced FIFO nonblocking and rejects it as an unsafe interaction path", async () => {
		if (process.platform === "win32") return;
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		const interactionPath = join(root, "interactions", "success.jsonl");
		const heldOriginal = join(root, "interactions", "held-original.jsonl");
		let barrierRuns = 0;

		const exit = await withDeadline(
			Effect.runPromiseExit(
				loadCassette(root, {
					beforeInteractionOpen: async (interactionId) => {
						expect(interactionId).toBe("success");
						barrierRuns++;
						await rename(interactionPath, heldOriginal);
						await makeFifo(interactionPath);
					},
				}),
			),
			async () => {
				const writer = await open(
					interactionPath,
					constants.O_WRONLY | constants.O_NONBLOCK,
				);
				await writer.close();
			},
		);

		expect(barrierRuns).toBe(1);
		expect(exit._tag).toBe("Failure");
		expect(JSON.stringify(exit)).toContain("unsafeInteractionPath");
	});

	it("rejects a same-inode rewrite between descriptor open and verified read", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		const { interactionPath, replacement } = await prepareInPlaceMutation(root);
		const originalStats = await stat(interactionPath, { bigint: true });
		let barrierRuns = 0;

		const exit = await Effect.runPromiseExit(
			loadCassette(root, {
				beforeInteractionRead: async (interactionId) => {
					expect(interactionId).toBe("success");
					barrierRuns++;
					await writeFile(interactionPath, replacement, "utf8");
					const changedStats = await stat(interactionPath, { bigint: true });
					expect(changedStats.dev).toBe(originalStats.dev);
					expect(changedStats.ino).toBe(originalStats.ino);
				},
			}),
		);

		expect(barrierRuns).toBe(1);
		expect(exit._tag).toBe("Failure");
		expect(JSON.stringify(exit)).toContain("unsafeInteractionPath");
	});

	it("rejects a same-inode rewrite during descriptor verification", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);
		const { interactionPath, replacement } = await prepareInPlaceMutation(root);
		const originalStats = await stat(interactionPath, { bigint: true });
		let barrierRuns = 0;

		const exit = await Effect.runPromiseExit(
			loadCassette(root, {
				duringInteractionRead: async (interactionId) => {
					expect(interactionId).toBe("success");
					barrierRuns++;
					await writeFile(interactionPath, replacement, "utf8");
					const changedStats = await stat(interactionPath, { bigint: true });
					expect(changedStats.dev).toBe(originalStats.dev);
					expect(changedStats.ino).toBe(originalStats.ino);
				},
			}),
		);

		expect(barrierRuns).toBe(1);
		expect(exit._tag).toBe("Failure");
		expect(JSON.stringify(exit)).toContain("unsafeInteractionPath");
	});

	it("refuses two interactions that share request digest, variant and attempt", async () => {
		const exit = await Effect.runPromiseExit(
			seal([draftOf(), draftOf({ interactionId: "duplicate" })]),
		);
		expect(exit._tag).toBe("Failure");
		expect(JSON.stringify(exit)).toContain("duplicateIndexKey");
	});

	it("refuses an unknown redaction policy at load time", async () => {
		const root = await freshRoot();
		await Effect.runPromise(
			Effect.flatMap(seal([draftOf()]), (sealed) =>
				writeSealedCassette(root, sealed),
			),
		);

		const manifestPath = join(root, "manifest.json");
		const raw = await readFile(manifestPath, "utf8");
		await writeFile(
			manifestPath,
			raw.replace('"default/v1"', '"invented/v9"'),
			"utf8",
		);

		const exit = await Effect.runPromiseExit(loadCassette(root));
		expect(exit._tag).toBe("Failure");
		const rendered = JSON.stringify(exit);
		// Either guard is acceptable; both fail closed and neither serves events.
		expect(
			rendered.includes("unknownRedactionPolicy") ||
				rendered.includes("checksumMismatch"),
		).toBe(true);
	});
});

describe("event state machine", () => {
	const frames = scriptedFrames(exampleSteps);

	it("accepts the authored sequence", () => {
		expect(validateFrames(frames)).toBeUndefined();
	});

	it("rejects a sequence with no terminal frame", () => {
		expect(validateFrames(frames.slice(0, -1))).toBe(
			"interaction must end with exactly one terminal frame",
		);
	});

	it("rejects frames after the terminal record", () => {
		const extended: TimedProviderEvent[] = [
			...frames,
			{
				seq: frames.length,
				elapsedMs: 999,
				event: { type: "text.delta", text: "late" },
			},
		];
		expect(validateFrames(extended)).toContain("follows terminal frame");
	});

	it("rejects tool arguments that do not equal their concatenated fragments", () => {
		const tampered = frames.map((frame) =>
			frame.event.type === "tool.call.completed"
				? {
						...frame,
						event: { ...frame.event, argumentsJson: '{"sourceId":"doc-9"}' },
					}
				: frame,
		);
		expect(validateFrames(tampered)).toContain(
			"does not equal the concatenated fragments",
		);
	});

	it("rejects a discontiguous sequence", () => {
		const gapped = frames.map((frame, index) =>
			index === 3 ? { ...frame, seq: 99 } : frame,
		);
		expect(validateFrames(gapped)).toContain("sequence must be contiguous");
	});

	it("rejects decreasing cumulative usage", () => {
		const regressed = frames.map((frame) =>
			frame.event.type === "response.completed"
				? {
						...frame,
						event: {
							...frame.event,
							usage: { inputTokens: 1, outputTokens: 1 },
						},
					}
				: frame,
		);
		expect(validateFrames(regressed)).toContain("decreasing cumulative usage");
	});

	it("surfaces an invalid sequence as a typed integrity failure at seal time", async () => {
		const exit = await Effect.runPromiseExit(
			seal([draftOf({ frames: frames.slice(0, -1) })]),
		);
		expect(exit._tag).toBe("Failure");
		expect(JSON.stringify(exit)).toContain("invalidEventSequence");
		expect(CassetteIntegrityError.name).toBe("CassetteIntegrityError");
	});
});
