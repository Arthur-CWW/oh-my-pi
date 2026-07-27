#!/usr/bin/env bun
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const BUILD_REVISION_FLAG = "--runner-build-revision";
const WORKER_FLAG = "--runner-canary-readiness-worker";
const RECEIPT_SCHEMA_VERSION = 1;
const SHA256 = /^[a-f0-9]{64}$/;

interface Arguments {
	candidate: string;
	fixtureRoot: string;
	output: string;
}

interface BuildRevision {
	buildDigest: string;
	version: string;
}

interface WorkerReceipt {
	schemaVersion: 1;
	buildDigest: string;
	version: string;
	runnerInstanceId: string;
	fixtureSessionId: string;
	ownerEpoch: string;
	startedAt: string;
	stoppedAt: string;
	initialSnapshotRevision: number;
	finalSnapshotRevision: number;
	commandId: string;
	proof: {
		mutationAppliedExactlyOnce: true;
		leaseReleased: true;
		leaseReacquired: true;
		jsonlPersisted: true;
		queuePersisted: true;
	};
}

function fail(message: string): never {
	throw new Error(message);
}

function parseArguments(argv: string[]): Arguments {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (value === undefined || !["--candidate", "--fixture-root", "--output"].includes(flag)) {
			fail("usage: runner-canary-readiness.ts --candidate <path> --fixture-root <path> --output <path>");
		}
		if (values.has(flag)) fail(`duplicate argument: ${flag}`);
		values.set(flag, value);
	}
	if (values.size !== 3) fail("required arguments: --candidate, --fixture-root, --output");
	return {
		candidate: path.resolve(values.get("--candidate")!),
		fixtureRoot: path.resolve(values.get("--fixture-root")!),
		output: path.resolve(values.get("--output")!),
	};
}

function strictObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be a JSON object`);
	const object = value as Record<string, unknown>;
	const actual = Object.keys(object).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		fail(`${label} has unexpected fields`);
	}
	return object;
}

function parseBuildRevision(stdout: Uint8Array): BuildRevision {
	let decoded: unknown;
	try {
		decoded = JSON.parse(new TextDecoder().decode(stdout).trim());
	} catch {
		fail("candidate returned invalid build revision JSON");
	}
	const object = strictObject(decoded, ["buildDigest", "version"], "build revision");
	if (typeof object.buildDigest !== "string" || !SHA256.test(object.buildDigest)) fail("invalid build digest");
	if (typeof object.version !== "string" || object.version.length === 0) fail("invalid build version");
	return object as unknown as BuildRevision;
}

function validateWorkerReceipt(value: unknown, build: BuildRevision, commandId: string): WorkerReceipt {
	const keys = ["schemaVersion", "buildDigest", "version", "runnerInstanceId", "fixtureSessionId", "ownerEpoch", "startedAt", "stoppedAt", "initialSnapshotRevision", "finalSnapshotRevision", "commandId", "proof"] as const;
	const object = strictObject(value, keys, "worker receipt");
	if (object.schemaVersion !== RECEIPT_SCHEMA_VERSION) fail("unsupported worker receipt schema");
	if (object.buildDigest !== build.buildDigest || object.version !== build.version) fail("worker build identity mismatch");
	if (typeof object.runnerInstanceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(object.runnerInstanceId)) fail("invalid runner instance id");
	if (typeof object.fixtureSessionId !== "string" || object.fixtureSessionId.length === 0) fail("invalid fixture session id");
	if (typeof object.ownerEpoch !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(object.ownerEpoch)) fail("invalid owner epoch");
	if (!Number.isSafeInteger(object.initialSnapshotRevision) || !Number.isSafeInteger(object.finalSnapshotRevision) || (object.finalSnapshotRevision as number) <= (object.initialSnapshotRevision as number)) fail("snapshot revision did not advance");
	if (object.commandId !== commandId) fail("worker command id mismatch");
	if (typeof object.startedAt !== "string" || typeof object.stoppedAt !== "string" || !Number.isFinite(Date.parse(object.startedAt)) || !Number.isFinite(Date.parse(object.stoppedAt)) || new Date(object.startedAt).toISOString() !== object.startedAt || new Date(object.stoppedAt).toISOString() !== object.stoppedAt || Date.parse(object.stoppedAt) < Date.parse(object.startedAt)) fail("invalid runner timestamps");
	const proof = strictObject(object.proof, ["mutationAppliedExactlyOnce", "leaseReleased", "leaseReacquired", "jsonlPersisted", "queuePersisted"], "worker proof");
	for (const [name, proved] of Object.entries(proof)) if (proved !== true) fail(`worker proof failed: ${name}`);
	return object as unknown as WorkerReceipt;
}

function isNativeExecutable(bytes: Uint8Array): boolean {
	if (bytes.length < 4) return false;
	const magic = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
	return (
		magic === 0xcafebabe ||
		magic === 0xcafebabf ||
		magic === 0xfeedface ||
		magic === 0xfeedfacf ||
		magic === 0xcefaedfe ||
		magic === 0xcffaedfe ||
		magic === 0x7f454c46 ||
		(bytes[0] === 0x4d && bytes[1] === 0x5a)
	);
}

async function run(): Promise<void> {
	const args = parseArguments(Bun.argv.slice(2));
	await fs.rm(args.output, { force: true });
	const candidateStat = await fs.stat(args.candidate);
	if (!candidateStat.isFile()) fail("candidate is not a file");
	const candidateBytes = await fs.readFile(args.candidate);
	if (!isNativeExecutable(candidateBytes)) fail("candidate is not a compiled native executable");
	const digest = createHash("sha256").update(candidateBytes).digest("hex");
	if (!path.basename(args.candidate).includes(digest)) fail("candidate path is not content-addressed by its SHA-256");

	const revisionProcess = Bun.spawnSync([args.candidate, BUILD_REVISION_FLAG], { stdout: "pipe", stderr: "pipe" });
	if (revisionProcess.exitCode !== 0) fail(`candidate build revision failed (exit ${revisionProcess.exitCode})`);
	const build = parseBuildRevision(revisionProcess.stdout);
	if (build.buildDigest !== digest) fail("candidate SHA-256 does not match self-reported build revision");

	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-runner-canary-"));
	try {
		const copiedFixture = path.join(root, "fixture");
		await fs.cp(args.fixtureRoot, copiedFixture, { recursive: true, errorOnExist: true, force: false });
		const workerOutput = path.join(root, "worker-receipt.json");
		const commandId = randomUUID();
		const isolated = path.join(root, "isolated");
		const env = {
			...process.env,
			HOME: path.join(isolated, "home"),
			XDG_CONFIG_HOME: path.join(isolated, "config"),
			XDG_CACHE_HOME: path.join(isolated, "cache"),
			XDG_DATA_HOME: path.join(isolated, "data"),
			OMP_SESSION_DIR: path.join(isolated, "sessions"),
			OMP_AGENT_DIR: path.join(isolated, "agent"),
			AGENT_MUX_DIR: path.join(isolated, "agent-mux"),
		};
		await Promise.all(Object.values(env).filter((value): value is string => typeof value === "string" && value.startsWith(isolated)).map(directory => fs.mkdir(directory, { recursive: true })));
		const worker = Bun.spawnSync([args.candidate, WORKER_FLAG, "--fixture-root", copiedFixture, "--output", workerOutput, "--command-id", commandId], { cwd: copiedFixture, env, stdout: "pipe", stderr: "pipe" });
		if (worker.exitCode !== 0) {
			const stderr = new TextDecoder().decode(worker.stderr).trim();
			fail(`candidate readiness worker failed (exit ${worker.exitCode})${stderr ? `: ${stderr}` : ""}`);
		}
		let decoded: unknown;
		try {
			decoded = JSON.parse(await fs.readFile(workerOutput, "utf8"));
		} catch {
			fail("candidate readiness worker did not write valid JSON");
		}
		const receipt = validateWorkerReceipt(decoded, build, commandId);
		await fs.mkdir(path.dirname(args.output), { recursive: true });
		const temporaryOutput = `${args.output}.tmp-${process.pid}-${randomUUID()}`;
		await fs.writeFile(temporaryOutput, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
		await fs.rename(temporaryOutput, args.output);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
}

run().catch(error => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`runner-canary-readiness: ${message}\n`);
	process.exitCode = 1;
});
