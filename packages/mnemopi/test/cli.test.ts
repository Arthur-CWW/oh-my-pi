import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdRecall, cmdRemember, cmdStats, runCli } from "@oh-my-pi/pi-mnemopi/cli";
import { BeamMemory } from "@oh-my-pi/pi-mnemopi/core/beam";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "mnemopi-ts-cli-"));
}

function capture() {
	let stdout = "";
	let stderr = "";
	return {
		context(dataDir: string) {
			return {
				dataDir,
				stdout: { write: (data: string) => (stdout += data) },
				stderr: { write: (data: string) => (stderr += data) },
			};
		},
		get stdout() {
			return stdout;
		},
		get stderr() {
			return stderr;
		},
	};
}

describe("CLI command handlers", () => {
	it("remember stores through BeamMemory and recall prints real results", async () => {
		const root = tempRoot();
		try {
			const io = capture();
			const context = io.context(root);
			expect(await cmdRemember(["Project Alpha prefers terse answers", "cli", "0.7"], context)).toBe(0);
			expect(io.stdout).toContain("Stored:");

			const recallIo = capture();
			expect(await cmdRecall(["Alpha", "5"], recallIo.context(root))).toBe(0);
			expect(recallIo.stdout).toContain("Results for: Alpha");
			expect(recallIo.stdout).toContain("Project Alpha prefers terse answers");
			expect(recallIo.stderr).toBe("");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("stats prints working, episodic, triple, bank, and DB path counts", async () => {
		const root = tempRoot();
		try {
			const dbPath = join(root, "mnemopi.db");
			const memory = new BeamMemory({ dbPath });
			try {
				const id = memory.remember("Working memory item", { source: "test", importance: 0.5 });
				memory.consolidateToEpisodic("Episodic summary", [id], "test", 0.6);
				memory.db
					.prepare("INSERT INTO triples (subject, predicate, object, source) VALUES (?, ?, ?, ?)")
					.run("alice", "likes", "typescript", "test");
			} finally {
				memory.close();
			}

			const io = capture();
			expect(await cmdStats([], io.context(root))).toBe(0);
			expect(io.stdout).toContain("Working memory: 1");
			expect(io.stdout).toContain("Episodic memory: 1");
			expect(io.stdout).toContain("Knowledge triples: 1");
			expect(io.stdout).toContain("Banks: default");
			expect(io.stdout).toContain(dbPath);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports usage, parse, operation, and unknown-command errors without tracebacks", async () => {
		const root = tempRoot();
		try {
			const usageIo = capture();
			expect(await runCli(["remember"], usageIo.context(root))).toBe(2);
			expect(usageIo.stderr).toContain("Usage: mnemopi store <content> [source] [importance]");
			expect(usageIo.stderr).not.toContain("Traceback");

			const parseIo = capture();
			expect(await runCli(["recall", "hello", "not-an-int"], parseIo.context(root))).toBe(2);
			expect(parseIo.stderr).toContain("top_k must be an integer");
			expect(parseIo.stderr).not.toContain("Traceback");

			const missingIo = capture();
			expect(await runCli(["delete", "missing-id"], missingIo.context(root))).toBe(1);
			expect(missingIo.stderr).toContain("Memory not found: missing-id");
			expect(missingIo.stdout).toBe("");

			const unknownIo = capture();
			expect(await runCli(["definitely-not-a-command"], unknownIo.context(root))).toBe(2);
			expect(unknownIo.stderr).toContain("Unknown command: definitely-not-a-command");
			expect(unknownIo.stderr).toContain("Run 'mnemopi --help' for usage.");
			expect(unknownIo.stdout).toBe("");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("awaits the MCP server until stdin closes", async () => {
		const originalStream = Bun.stdin.stream;
		const ready = Promise.withResolvers<void>();
		let controller: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>> | undefined;
		let closed = false;
		const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
			start(streamController) {
				controller = streamController;
				ready.resolve();
			},
		});
		Bun.stdin.stream = () => input;
		try {
			let resolved = false;
			const cliPromise = runCli(["mcp"]).then(code => {
				resolved = true;
				return code;
			});
			await ready.promise;
			await Promise.resolve();
			expect(resolved).toBe(false);
			const activeController = controller;
			if (activeController === undefined) throw new Error("expected stdin stream controller");
			activeController.close();
			closed = true;
			expect(await cliPromise).toBe(0);
			expect(resolved).toBe(true);
		} finally {
			Bun.stdin.stream = originalStream;
			if (!closed) controller?.close();
		}
	});

	it("manages scratchpad and banks in the configured data directory", async () => {
		const root = tempRoot();
		try {
			const writeIo = capture();
			expect(await runCli(["scratchpad", "write", "portable note"], writeIo.context(root))).toBe(0);
			expect(writeIo.stdout).toContain("Scratchpad stored:");

			const readIo = capture();
			expect(await runCli(["scratchpad", "read"], readIo.context(root))).toBe(0);
			expect(readIo.stdout).toContain("portable note");

			const createIo = capture();
			expect(await runCli(["bank", "create", "project_a"], createIo.context(root))).toBe(0);
			expect(createIo.stdout).toContain("Created bank: project_a");

			const listIo = capture();
			expect(await runCli(["bank", "list"], listIo.context(root))).toBe(0);
			expect(listIo.stdout).toContain("default");
			expect(listIo.stdout).toContain("project_a");

			const deleteIo = capture();
			expect(await runCli(["bank", "delete", "project_a"], deleteIo.context(root))).toBe(0);
			expect(deleteIo.stdout).toContain("Deleted bank: project_a");

			const badIo = capture();
			expect(await runCli(["bank", "create", "bad/name"], badIo.context(root))).toBe(2);
			expect(badIo.stderr).toContain("Invalid bank name");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("routes command aliases to the same handlers as their canonical commands", async () => {
		const root = tempRoot();
		try {
			// scratchpad ↔ sp
			const spWrite = capture();
			expect(await runCli(["sp", "write", "aliased note"], spWrite.context(root))).toBe(0);
			expect(spWrite.stdout).toContain("Scratchpad stored:");
			const spRead = capture();
			expect(await runCli(["sp", "read"], spRead.context(root))).toBe(0);
			expect(spRead.stdout).toContain("aliased note");

			// recall ↔ search (usage path avoids loading the embedding model)
			const search = capture();
			expect(await runCli(["search"], search.context(root))).toBe(2);
			expect(search.stderr).toContain("Usage: mnemopi recall <query> [top_k]");

			// update ↔ edit
			const edit = capture();
			expect(await runCli(["edit", "missing-id", "new content"], edit.context(root))).toBe(1);
			expect(edit.stderr).toContain("Memory not found: missing-id");

			// delete ↔ forget
			const forget = capture();
			expect(await runCli(["forget", "missing-id"], forget.context(root))).toBe(1);
			expect(forget.stderr).toContain("Memory not found: missing-id");

			// diagnose ↔ doctor
			const doctor = capture();
			expect(await runCli(["doctor"], doctor.context(root))).toBe(0);
			expect(doctor.stdout).toContain("Mnemopi Diagnostics");

			// sleep ↔ consolidate
			const consolidate = capture();
			expect(await runCli(["consolidate"], consolidate.context(root))).toBe(0);
			expect(consolidate.stdout).toContain("Consolidation complete");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
