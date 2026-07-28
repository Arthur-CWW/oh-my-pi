import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	assertFleetSessionAcquirable,
	checkpointFleetSession,
	correctFleetSession,
	createFleetOwnerProof,
	decodeFleetJournal,
	exportFleetSession,
	importFleetSession,
	inspectFleetSession,
	migrateFleetSession,
	verifyFleetReceipt,
	type FleetHost,
	type FleetMutationContext,
	type FleetSessionFiles,
} from "../../src/fleet/migration-core";
import { runFleetMajordomoCli } from "../../src/cli/fleet-migration";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{
	source: FleetHost;
	destination: FleetHost;
	files: FleetSessionFiles;
	context: FleetMutationContext;
	journalBytes: Uint8Array;
}> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-fleet-migration-"));
	roots.push(root);
	const source: FleetHost = {
		hostId: "host-A",
		root: path.join(root, "host-A"),
		signingKey: "host-A-secret",
		workspaceRoot: path.join(root, "host-A", "agents"),
	};
	const destination: FleetHost = {
		hostId: "host-B",
		root: path.join(root, "host-B"),
		signingKey: "host-B-secret",
		workspaceRoot: path.join(root, "host-B", "agents"),
	};
	const sessionId = "019f9bf1-0000-7000-8000-000000000001";
	const journalFile = path.join(source.root, "sessions", `${sessionId}.jsonl`);
	const queueFile = path.join(source.root, "queues", `${sessionId}.jsonl`);
	const ownerFile = path.join(source.root, "owners", `${sessionId}.json`);
	const childStateFile = path.join(source.root, "children", `${sessionId}.json`);
	const files: FleetSessionFiles = { sessionId, journalFile, queueFiles: [queueFile], ownerFile, childStateFile };
	await fs.mkdir(path.dirname(journalFile), { recursive: true });
	await fs.mkdir(path.dirname(queueFile), { recursive: true });
	await fs.mkdir(path.dirname(childStateFile), { recursive: true });
	await fs.mkdir(path.join(source.workspaceRoot!, "primer"), { recursive: true });
	await fs.writeFile(
		journalFile,
		'{"type":"session","version":1,"id":"old-header"}\n{"id":"record-1","type":"message","text":"secret"}\n',
	);
	await fs.writeFile(queueFile, '{"id":"queue-1","state":"closed"}\n');
	await fs.writeFile(
		childStateFile,
		JSON.stringify({
			children: [
				{
					childId: "child-1",
					status: "running",
					journalUri: `journal://${sessionId}/child-1`,
					resumable: true,
					continuationHandle: "history://child-1",
				},
			],
			todos: [{ id: "todo-1", text: "finish migration" }],
			deferredChanges: [{ path: "src/pending.ts", state: "modified" }],
		}),
	);
	await fs.mkdir(path.dirname(ownerFile), { recursive: true });
	await fs.writeFile(
		ownerFile,
		JSON.stringify({
			schemaVersion: 1,
			sessionId,
			hostId: source.hostId,
			ownerEpoch: "epoch-A",
			state: "active",
			build: { version: "16.0.1", digest: "a".repeat(64) },
			config: { model: "gpt-5.6" },
			process: { pid: 4242, alive: true },
			profile: { rssBytes: 1024, cpuPercent: 1.5 },
		}),
	);
	const journalBytes = await fs.readFile(journalFile);
	const context: FleetMutationContext = {
		idempotencyKey: "migration-key-0001",
		ownerProof: createFleetOwnerProof(source, sessionId, "epoch-A", "nonce-0001"),
		capabilities: ["checkpoint", "correct", "export", "import", "migrate"],
		timeoutMs: 10_000,
	};
	return { source, destination, files, context, journalBytes };
}

function migrationOptions(source: FleetHost, interruptAfterPhase?: "transfer") {
	return {
		cwd: path.join(source.workspaceRoot!, "primer"),
		healthProof: async (_destinationDir: string, destinationEpoch: string) => ({
			ok: true,
			destinationEpoch,
			continuationHandles: ["history://child-1"],
		}),
		interruptAfterPhase,
	};
}

describe("fleet migration core", () => {
	it("inspects bounded state and checkpoints immutable journal and queue boundaries", async () => {
		const { source, files, context } = await fixture();
		const checkpoint = await checkpointFleetSession(source, files, {
			...context,
			idempotencyKey: "checkpoint-key-0001",
		});
		const replay = await checkpointFleetSession(source, files, { ...context, idempotencyKey: "checkpoint-key-0001" });
		const inspected = await inspectFleetSession(source, files);
		expect(replay.digest).toBe(checkpoint.digest);
		expect(checkpoint.payload.journal.uri).toBe(`journal://${files.sessionId}`);
		expect(checkpoint.payload.queues).toHaveLength(1);
		expect(verifyFleetReceipt(source, checkpoint)).toBe(true);
		expect(verifyFleetReceipt(source, { ...checkpoint, digest: "0".repeat(64) })).toBe(false);
		expect(inspected.sessionId).toBe(files.sessionId);
		expect(inspected).toMatchObject({
			config: { model: "gpt-5.6" },
			build: { version: "16.0.1" },
			process: { pid: 4242, alive: true },
			profile: { rssBytes: 1024, cpuPercent: 1.5 },
		});
		expect(inspected.bounds.maxRecords).toBe(256);
	});

	it("projects append-only correction overlays without rewriting historical bytes and decodes old journals", async () => {
		const { source, files, context, journalBytes } = await fixture();
		await correctFleetSession(
			source,
			files,
			{ ...context, idempotencyKey: "correction-key-0001" },
			{ recordId: "record-1", action: "redact", reason: "operator privacy correction" },
		);
		expect(Buffer.compare(await fs.readFile(files.journalFile), journalBytes)).toBe(0);
		const projected = await decodeFleetJournal(source, files);
		expect(projected[0]).toEqual({ type: "session", version: 1, id: "old-header" });
		expect(projected[1]).toMatchObject({ id: "record-1", type: "redacted" });
	});

	it("exports a digest manifest and dry-run imports a typed workspace overlay without an owner", async () => {
		const { source, destination, files, context } = await fixture();
		const exported = await exportFleetSession(
			source,
			files,
			{ ...context, idempotencyKey: "export-key-0001" },
			path.join(source.workspaceRoot!, "primer"),
		);
		const bundle = path.join(
			source.root,
			"bundles",
			files.sessionId,
			Bun.SHA256.hash("export-key-0001", "hex").slice(0, 24),
		);
		const imported = await importFleetSession(
			bundle,
			destination,
			{
				...context,
				idempotencyKey: "import-key-0001",
				ownerProof: createFleetOwnerProof(destination, files.sessionId, "staging-epoch"),
			},
			{ dryRun: true },
		);
		expect(exported.payload.workspace.workspaceUri).toBe("workspace://agents/primer");
		expect(imported.payload.workspacePath).toBe(path.join(destination.workspaceRoot!, "primer"));
		expect(imported.payload.ownerCreated).toBe(false);
		expect(
			Buffer.compare(
				await fs.readFile(path.join(imported.payload.stagingDir, "data", "0")),
				await fs.readFile(files.journalFile),
			),
		).toBe(0);
		expect(exported.payload.closedState.children[0]).toMatchObject({
			status: "running",
			continuationHandle: "history://child-1",
		});
		const importRequest = path.join(source.root, "import-request.json");
		await fs.writeFile(
			importRequest,
			JSON.stringify({
				sourceBundleDir: bundle,
				destination,
				context: {
					...context,
					idempotencyKey: "import-cli-key-0001",
					ownerProof: createFleetOwnerProof(destination, files.sessionId, "staging-cli-epoch"),
				},
			}),
		);
		await expect(runFleetMajordomoCli("import", files.sessionId, importRequest)).rejects.toThrow(
			"import requires --dry-run",
		);
		const cliImport = JSON.parse(
			await runFleetMajordomoCli("import", files.sessionId, importRequest, { dryRun: true }),
		);
		expect(cliImport.result.payload).toMatchObject({ dryRun: true, ownerCreated: false });
		const cliImportReplay = JSON.parse(
			await runFleetMajordomoCli("import", files.sessionId, importRequest, { dryRun: true }),
		);
		expect(cliImportReplay.result.digest).toBe(cliImport.result.digest);
		await expect(fs.stat(path.join(destination.root, "owners", `${files.sessionId}.json`))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("resumes an interrupted immutable transfer with the same idempotency key", async () => {
		const { source, destination, files, context } = await fixture();
		await expect(
			migrateFleetSession(source, destination, files, context, migrationOptions(source, "transfer")),
		).rejects.toThrow("simulated-interruption: transfer");
		const completed = await migrateFleetSession(source, destination, files, context, migrationOptions(source));
		expect(completed.payload.state).toBe("committed");
		const destinationOwner = JSON.parse(
			await fs.readFile(path.join(destination.root, "owners", `${files.sessionId}.json`), "utf8"),
		);
		expect(destinationOwner.continuations[0]).toMatchObject({
			journalUri: `journal://${files.sessionId}/child-1`,
			continuationHandle: "history://child-1",
		});
		expect(destinationOwner.todos).toEqual([{ id: "todo-1", text: "finish migration" }]);
		expect(destinationOwner.deferredChanges).toEqual([{ path: "src/pending.ts", state: "modified" }]);
		const replay = await migrateFleetSession(source, destination, files, context, migrationOptions(source));
		expect(replay.digest).toBe(completed.digest);
	});

	it("allows only one concurrent migration and rejects stale owner proofs", async () => {
		const { source, destination, files, context } = await fixture();
		const competing = { ...context, idempotencyKey: "migration-key-0002" };
		const enteredHealthProof = Promise.withResolvers<void>();
		const releaseHealthProof = Promise.withResolvers<void>();
		const winner = migrateFleetSession(source, destination, files, context, {
			...migrationOptions(source),
			healthProof: async () => {
				enteredHealthProof.resolve();
				await releaseHealthProof.promise;
				return { ok: true, continuationHandles: ["history://child-1"] };
			},
		});
		await enteredHealthProof.promise;
		const loser = migrateFleetSession(source, destination, files, competing, migrationOptions(source));
		releaseHealthProof.resolve();
		const results = await Promise.allSettled([winner, loser]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter(result => result.status === "rejected")).toHaveLength(1);

		const fresh = await fixture();
		const stale = {
			...fresh.context,
			idempotencyKey: "stale-proof-key",
			ownerProof: createFleetOwnerProof(fresh.source, fresh.files.sessionId, "epoch-stale"),
		};
		await expect(checkpointFleetSession(fresh.source, fresh.files, stale)).rejects.toThrow("stale-owner-proof");
	});

	it("rolls the source open on failed destination proof but never after commit", async () => {
		const failed = await fixture();
		await expect(
			migrateFleetSession(failed.source, failed.destination, failed.files, failed.context, {
				cwd: path.join(failed.source.workspaceRoot!, "primer"),
				healthProof: async () => ({ ok: true, continuationHandles: [] }),
			}),
		).rejects.toThrow("missing continuation handles");
		const reopened = JSON.parse(await fs.readFile(failed.files.ownerFile!, "utf8"));
		expect(reopened.state).toBe("active");
		await assertFleetSessionAcquirable(failed.source, failed.files);

		const committed = await fixture();
		await migrateFleetSession(
			committed.source,
			committed.destination,
			committed.files,
			committed.context,
			migrationOptions(committed.source),
		);
		await expect(assertFleetSessionAcquirable(committed.source, committed.files)).rejects.toThrow("source-fenced");
	});

	it("emits a stable JSON envelope from the thin CLI projection", async () => {
		const { source, files } = await fixture();
		const requestFile = path.join(source.root, "inspect-request.json");
		await fs.writeFile(requestFile, JSON.stringify({ host: source, files }));
		const output = JSON.parse(await runFleetMajordomoCli("inspect", files.sessionId, requestFile));
		expect(Object.keys(output)).toEqual(["schemaVersion", "action", "selector", "result"]);
		expect(output).toMatchObject({
			schemaVersion: 1,
			action: "inspect",
			selector: files.sessionId,
			result: { schemaVersion: 1, sessionId: files.sessionId, hostId: "host-A" },
		});
		const cli = Bun.spawn({
			cmd: [
				process.execPath,
				path.resolve(import.meta.dir, "../../src/cli.ts"),
				"fleet",
				"inspect",
				files.sessionId,
				"--request",
				requestFile,
			],
			cwd: path.resolve(import.meta.dir, "../.."),
			env: {
				...process.env,
				HOME: path.join(source.root, "home"),
				OMP_IRC_DB: path.join(source.root, "irc.db"),
				OMP_SESSION_CONTROL_DB: path.join(source.root, "control.db"),
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(cli.stdout).text(),
			new Response(cli.stderr).text(),
			cli.exited,
		]);
		expect(exitCode, stderr).toBe(0);
		expect(JSON.parse(stdout)).toEqual(output);
	});
});
