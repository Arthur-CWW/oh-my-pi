import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	type AvatarPipelineManifest,
	type StageRecord,
	atomicWriteManifest,
	computeVerdict,
	decodeManifest,
	freshManifest,
	freshStage,
	hashFile,
	hasVrmExtension,
	parseGlbJsonChunk,
	readManifest,
	validateResume,
} from "../avatar-pipeline/manifest.ts";
import { generateProofCard } from "../avatar-pipeline/proof-card.ts";
import { probeVrm, runtimeGateResults } from "../avatar-pipeline/vrm-probe.ts";

// ---------------------------------------------------------------------------
// Temp directory management (same pattern as omp-promote.test.ts)
// ---------------------------------------------------------------------------

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-pipeline-test-"));
	roots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

// ---------------------------------------------------------------------------
// Helpers — build fixtures on the real filesystem
// ---------------------------------------------------------------------------

function makeGlbBuffer(gltfJson: Record<string, unknown>): Buffer {
	const jsonStr = JSON.stringify(gltfJson);
	// Pad to 4-byte alignment
	const padded = jsonStr + " ".repeat((4 - (jsonStr.length % 4)) % 4);
	const jsonBuf = Buffer.from(padded, "utf8");
	const header = Buffer.alloc(12);
	header.writeUInt32LE(0x46546C67, 0); // "glTF"
	header.writeUInt32LE(2, 4); // version
	header.writeUInt32LE(12 + 8 + jsonBuf.byteLength, 8); // total length
	const chunkHeader = Buffer.alloc(8);
	chunkHeader.writeUInt32LE(jsonBuf.byteLength, 0);
	chunkHeader.writeUInt32LE(0x4E4F534A, 4); // "JSON"
	return Buffer.concat([header, chunkHeader, jsonBuf]);
}

const REQUIRED_FIXTURE_BONES = [
	"hips",
	"spine",
	"head",
	"leftUpperLeg",
	"leftLowerLeg",
	"leftFoot",
	"rightUpperLeg",
	"rightLowerLeg",
	"rightFoot",
	"leftUpperArm",
	"leftLowerArm",
	"leftHand",
	"rightUpperArm",
	"rightLowerArm",
	"rightHand",
] as const;

function makeHumanoidFixture(missingBone?: string): Buffer {
	const nodes = [
		{ name: "hips", translation: [0, 1, 0], children: [1, 3, 6] },
		{ name: "spine", translation: [0, 0.4, 0], children: [2, 9, 12] },
		{ name: "head", translation: [0, 0.5, 0] },
		{ name: "leftUpperLeg", translation: [0.15, -0.3, 0], children: [4] },
		{ name: "leftLowerLeg", translation: [0, -0.4, 0], children: [5] },
		{ name: "leftFoot", translation: [0, -0.4, 0.1] },
		{ name: "rightUpperLeg", translation: [-0.15, -0.3, 0], children: [7] },
		{ name: "rightLowerLeg", translation: [0, -0.4, 0], children: [8] },
		{ name: "rightFoot", translation: [0, -0.4, 0.1] },
		{ name: "leftUpperArm", translation: [0.25, 0.3, 0], children: [10] },
		{ name: "leftLowerArm", translation: [0.35, 0, 0], children: [11] },
		{ name: "leftHand", translation: [0.3, 0, 0] },
		{ name: "rightUpperArm", translation: [-0.25, 0.3, 0], children: [13] },
		{ name: "rightLowerArm", translation: [-0.35, 0, 0], children: [14] },
		{ name: "rightHand", translation: [-0.3, 0, 0] },
	];
	const humanBones: Record<string, { node: number }> = {};
	for (const [node, name] of REQUIRED_FIXTURE_BONES.entries()) {
		if (name !== missingBone) humanBones[name] = { node };
	}
	return makeGlbBuffer({
		asset: { version: "2.0" },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes,
		extensionsUsed: ["VRMC_vrm"],
		extensions: {
			VRMC_vrm: {
				specVersion: "1.0",
				meta: {
					name: "test humanoid",
					version: "1",
					authors: ["avatar-pipeline.test.ts"],
					copyrightInformation: "test fixture",
					contactInformation: "",
					references: [],
					thirdPartyLicenses: "",
					licenseUrl: "https://vrm.dev/licenses/1.0/",
					avatarPermission: "onlyAuthor",
					commercialUsage: "personalNonProfit",
					creditNotation: "required",
					allowRedistribution: false,
					modification: "prohibited",
					otherLicenseUrl: "",
				},
				humanoid: { humanBones },
			},
		},
	});
}

function validProvenance() {
	return {
		baseModel: { slug: "test-base", source: "https://example.com/base", license: "test-license", licenseNotes: "/dev/null" },
		donor: { slug: "test-donor", source: "https://example.com/donor", license: "test-donor-license" },
		identityCorpus: null,
	};
}

function completedManifest(): AvatarPipelineManifest {
	const m = freshManifest("test-asset", validProvenance());
	for (const name of Object.keys(m.stages)) {
		m.stages[name].status = "completed";
		m.stages[name].completedAt = new Date().toISOString();
		m.stages[name].gates = [{ name: "test-gate", status: "passed", threshold: "pass", observed: "pass", detail: "ok" }];
	}
	m.finalVerdict = "accepted";
	return m;
}

// ---------------------------------------------------------------------------
// Schema rejection
// ---------------------------------------------------------------------------

describe("manifest schema decoding", () => {
	it("rejects a manifest with wrong schemaName", () => {
		const bad = { schemaName: "wrong", schemaVersion: 1, assetId: "x", lane: "production", createdAt: "", updatedAt: "", provenance: {}, stages: {}, finalVerdict: "pending", proofCard: null };
		expect(() => decodeManifest(bad)).toThrow(/schemaName/);
	});

	it("rejects a manifest with wrong schemaVersion", () => {
		const bad = { schemaName: "avatar-pipeline-manifest-v1", schemaVersion: 2, assetId: "x", lane: "production", createdAt: "", updatedAt: "", provenance: {}, stages: {}, finalVerdict: "pending", proofCard: null };
		expect(() => decodeManifest(bad)).toThrow(/schemaVersion/);
	});

	it("rejects non-object input", () => {
		expect(() => decodeManifest("not an object")).toThrow(/must be a JSON object/);
		expect(() => decodeManifest(null)).toThrow(/must be a JSON object/);
		expect(() => decodeManifest(42)).toThrow(/must be a JSON object/);
	});

	it("rejects a manifest with invalid finalVerdict", () => {
		const m = freshManifest("test", validProvenance());
		const raw = JSON.parse(JSON.stringify(m));
		raw.finalVerdict = "dunno";
		expect(() => decodeManifest(raw)).toThrow(/finalVerdict/);
	});

	it("rejects a stage with invalid status", () => {
		const m = freshManifest("test", validProvenance());
		const raw = JSON.parse(JSON.stringify(m));
		raw.stages["source-validation"].status = "exploded";
		expect(() => decodeManifest(raw)).toThrow(/status/);
	});

	it("rejects a gate with an invalid status field", () => {
		const m = freshManifest("test", validProvenance());
		m.stages["source-validation"].gates = [
			{ name: "g", status: "yes" as unknown as "passed", threshold: "", observed: "", detail: "" },
		];
		const raw = JSON.parse(JSON.stringify(m));
		expect(() => decodeManifest(raw)).toThrow(/status must be one of passed\|failed\|pending/);
	});

	it("round-trips a valid manifest through encode/decode", async () => {
		const root = await temporaryRoot();
		const m = freshManifest("round-trip", validProvenance());
		const p = path.join(root, "manifest.json");
		await atomicWriteManifest(p, m);
		const decoded = await readManifest(p);
		expect(decoded.schemaName).toBe("avatar-pipeline-manifest-v1");
		expect(decoded.assetId).toBe("round-trip");
		expect(decoded.stages["source-validation"].status).toBe("pending");
	});
});

// ---------------------------------------------------------------------------
// Resume invalidation on changed hashes
// ---------------------------------------------------------------------------

describe("resume validation", () => {
	it("accepts a completed stage whose input and output hashes still match", async () => {
		const root = await temporaryRoot();
		const inputFile = path.join(root, "input.bin");
		const outputFile = path.join(root, "output.bin");
		await fs.writeFile(inputFile, "input-content");
		await fs.writeFile(outputFile, "output-content");

		const stage = freshStage();
		stage.status = "completed";
		stage.inputs = [await hashFile(inputFile)];
		stage.outputs = [await hashFile(outputFile)];

		expect(await validateResume(stage)).toBe(true);
	});

	it("rejects resume when an input file changes", async () => {
		const root = await temporaryRoot();
		const inputFile = path.join(root, "input.bin");
		const outputFile = path.join(root, "output.bin");
		await fs.writeFile(inputFile, "input-content");
		await fs.writeFile(outputFile, "output-content");

		const stage = freshStage();
		stage.status = "completed";
		stage.inputs = [await hashFile(inputFile)];
		stage.outputs = [await hashFile(outputFile)];

		// Mutate the input file
		await fs.writeFile(inputFile, "CHANGED-input-content");
		expect(await validateResume(stage)).toBe(false);
	});

	it("rejects resume when an output file changes", async () => {
		const root = await temporaryRoot();
		const inputFile = path.join(root, "input.bin");
		const outputFile = path.join(root, "output.bin");
		await fs.writeFile(inputFile, "input-content");
		await fs.writeFile(outputFile, "output-content");

		const stage = freshStage();
		stage.status = "completed";
		stage.inputs = [await hashFile(inputFile)];
		stage.outputs = [await hashFile(outputFile)];

		await fs.writeFile(outputFile, "CHANGED-output-content");
		expect(await validateResume(stage)).toBe(false);
	});

	it("rejects resume when an output file is deleted", async () => {
		const root = await temporaryRoot();
		const inputFile = path.join(root, "input.bin");
		const outputFile = path.join(root, "output.bin");
		await fs.writeFile(inputFile, "input-content");
		await fs.writeFile(outputFile, "output-content");

		const stage = freshStage();
		stage.status = "completed";
		stage.inputs = [await hashFile(inputFile)];
		stage.outputs = [await hashFile(outputFile)];

		await fs.rm(outputFile);
		expect(await validateResume(stage)).toBe(false);
	});

	it("rejects resume for non-completed stages", async () => {
		const stage = freshStage();
		stage.status = "failed";
		expect(await validateResume(stage)).toBe(false);

		stage.status = "running";
		expect(await validateResume(stage)).toBe(false);

		stage.status = "pending";
		expect(await validateResume(stage)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Failed-stage durability
// ---------------------------------------------------------------------------

describe("failed stage durability", () => {
	it("persists a failed manifest to disk with error details", async () => {
		const root = await temporaryRoot();
		const m = freshManifest("fail-test", validProvenance());
		m.stages["source-validation"].status = "failed";
		m.stages["source-validation"].error = "Base file has no VRM extension";
		m.stages["source-validation"].completedAt = new Date().toISOString();
		m.finalVerdict = computeVerdict(m);

		const p = path.join(root, "manifest.json");
		await atomicWriteManifest(p, m);

		const raw = JSON.parse(await fs.readFile(p, "utf8"));
		expect(raw.stages["source-validation"].status).toBe("failed");
		expect(raw.stages["source-validation"].error).toBe("Base file has no VRM extension");
		expect(raw.finalVerdict).toBe("rejected");
	});

	it("atomic write does not corrupt manifest on concurrent write", async () => {
		const root = await temporaryRoot();
		const m = freshManifest("atomic-test", validProvenance());
		const p = path.join(root, "manifest.json");

		// Write twice concurrently — both should produce valid files
		await Promise.all([
			atomicWriteManifest(p, { ...m, assetId: "write-a" }),
			atomicWriteManifest(p, { ...m, assetId: "write-b" }),
		]);
		const decoded = await readManifest(p);
		// One of them wins — both are valid schemas
		expect(["write-a", "write-b"]).toContain(decoded.assetId);
	});
});

// ---------------------------------------------------------------------------
// Verdict derivation
// ---------------------------------------------------------------------------

describe("verdict computation", () => {
	it("returns 'accepted' when all stages completed with all gates passed", () => {
		const m = completedManifest();
		expect(computeVerdict(m)).toBe("accepted");
	});

	it("returns 'rejected' when a stage has status=failed", () => {
		const m = completedManifest();
		m.stages["face-rig-transfer"].status = "failed";
		expect(computeVerdict(m)).toBe("rejected");
	});

	it("returns 'rejected' when a completed stage has a failed gate", () => {
		const m = completedManifest();
		m.stages["coverage-gates"].gates = [
			{ name: "expression-coverage", status: "failed", threshold: ">=35", observed: "20", detail: "too few" },
		];
		expect(computeVerdict(m)).toBe("rejected");
	});

	it("returns 'pending' when a stage is still pending", () => {
		const m = completedManifest();
		m.stages["coverage-gates"].status = "pending";
		expect(computeVerdict(m)).toBe("pending");
	});

	it("returns 'pending' with motion-stress gate pending (the real scenario)", () => {
		const m = completedManifest();
		// coverage-gates completed; the motion-stress gate simply has no evidence yet.
		m.stages["coverage-gates"].gates = [
			{ name: "expression-coverage", status: "passed", threshold: ">=35", observed: "52", detail: "ok" },
			{ name: "motion-stress-poses", status: "pending", threshold: "no vertex collapse", observed: "no current evidence", detail: "not yet executed" },
		];
		// Missing evidence blocks acceptance without claiming failure.
		expect(computeVerdict(m)).toBe("pending");
	});

	it("never returns accepted while runtime gates lack evidence", () => {
		const m = completedManifest();
		m.stages["coverage-gates"].gates = [
			{ name: "expression-coverage", status: "passed", threshold: ">=35", observed: "52", detail: "ok" },
			{ name: "humanoid-bones-complete", status: "pending", threshold: "all bones mapped", observed: "no current evidence", detail: "not executed" },
			{ name: "motion-stress-poses", status: "pending", threshold: "no collapse", observed: "no current evidence", detail: "not executed" },
		];
		expect(computeVerdict(m)).toBe("pending");
		expect(computeVerdict(m)).not.toBe("accepted");
	});
});

// ---------------------------------------------------------------------------
// GLB / VRM parsing
// ---------------------------------------------------------------------------

describe("GLB parsing", () => {
	it("parses a valid GLB JSON chunk", () => {
		const gltf = { asset: { version: "2.0" }, extensions: { VRMC_vrm: {} } };
		const buf = makeGlbBuffer(gltf);
		const parsed = parseGlbJsonChunk(buf);
		expect(parsed.asset).toEqual({ version: "2.0" });
	});

	it("rejects a non-GLB file", () => {
		const buf = Buffer.from("not a glb file at all");
		expect(() => parseGlbJsonChunk(buf)).toThrow(/Not a GLB file/);
	});

	it("rejects a truncated GLB", () => {
		const buf = Buffer.alloc(10);
		expect(() => parseGlbJsonChunk(buf)).toThrow(/too small/);
	});

	it("detects VRM 1.0 extension", () => {
		expect(hasVrmExtension({ extensions: { VRMC_vrm: {} } })).toBe(true);
	});

	it("detects VRM 0.x extension", () => {
		expect(hasVrmExtension({ extensions: { VRM: {} } })).toBe(true);
	});

	it("returns false when no VRM extension present", () => {
		expect(hasVrmExtension({ extensions: { KHR_materials: {} } })).toBe(false);
	});

	it("returns false when no extensions at all", () => {
		expect(hasVrmExtension({})).toBe(false);
	});
});

describe("VRM runtime gates", () => {
	it("passes a complete humanoid fixture through bounded stress poses", async () => {
		const root = await temporaryRoot();
		const fixture = path.join(root, "good.vrm");
		await fs.writeFile(fixture, makeHumanoidFixture());

		const result = await probeVrm(fixture);

		expect(result.humanoidBonesComplete.passed).toBe(true);
		expect(result.humanoidBonesComplete.observed).toContain("resolved=15/15");
		expect(result.motionStressPoses.passed).toBe(true);
		expect(result.motionStressPoses.observed).toContain("violations=none");
	});

	it("fails a mutilated fixture with a missing required bone", async () => {
		const root = await temporaryRoot();
		const fixture = path.join(root, "missing-hand.vrm");
		await fs.writeFile(fixture, makeHumanoidFixture("rightHand"));

		const result = await probeVrm(fixture);

		expect(result.humanoidBonesComplete.passed).toBe(false);
		expect(result.humanoidBonesComplete.observed).toContain("missing=rightHand");
		expect(result.motionStressPoses.passed).toBe(false);
	});

	it("turns a probe crash into failed gates rather than pending evidence", async () => {
		const gates = await runtimeGateResults("/unused.vrm", async () => {
			throw new Error("synthetic loader crash");
		});

		expect(gates.map(gate => gate.status)).toEqual(["failed", "failed"]);
		expect(gates.every(gate => gate.observed.includes("synthetic loader crash"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// SHA-256 hashing
// ---------------------------------------------------------------------------

describe("file hashing", () => {
	it("produces correct SHA-256 for a known payload", async () => {
		const root = await temporaryRoot();
		const f = path.join(root, "test.bin");
		const content = "hello, avatar pipeline";
		await fs.writeFile(f, content);
		const result = await hashFile(f);
		const expected = createHash("sha256").update(content).digest("hex");
		expect(result.sha256).toBe(expected);
		expect(result.bytes).toBe(Buffer.byteLength(content));
		expect(result.path).toBe(f);
	});
});

// ---------------------------------------------------------------------------
// Proof card generation
// ---------------------------------------------------------------------------

describe("proof card", () => {
	it("generates a valid proof card from a completed manifest", () => {
		const m = completedManifest();
		m.stages["face-rig-transfer"].gates = [
			{ name: "all-52-channels-present", status: "passed", threshold: "52", observed: "52", detail: "ok" },
		];
		m.stages["coverage-gates"].gates = [
			{ name: "expression-coverage", status: "passed", threshold: ">=35", observed: "52", detail: "ok" },
		];
		const card = generateProofCard(m);
		expect(card.schemaVersion).toBe(1);
		expect(card.assetId).toBe("test-asset");
		expect(card.licenseSummary.redistributionAllowed).toBe(false);
		expect(card.catalogReview.gateSummary.length).toBeGreaterThan(0);
	});

	it("carries provenance and license through to the proof card", () => {
		const m = completedManifest();
		const card = generateProofCard(m);
		expect(card.provenance.baseModel.slug).toBe("test-base");
		expect(card.licenseSummary.base).toBe("test-license");
		expect(card.licenseSummary.donor).toBe("test-donor-license");
	});
});
