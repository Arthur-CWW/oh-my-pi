import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as net from "node:net";
import * as path from "node:path";
import {
	listSessionsWithDiagnostics,
	resolveResumableSessionWithDiagnostics,
} from "@oh-my-pi/pi-coding-agent/session/session-listing";
import { computeDefaultSessionDir } from "@oh-my-pi/pi-coding-agent/session/session-paths";
import { FileSessionStorage } from "@oh-my-pi/pi-coding-agent/session/session-storage";
import { getConfigRootDir, setAgentDir } from "@oh-my-pi/pi-utils";

describe("session listing skipped diagnostics", () => {
	let testAgentDir: string;
	let sessionDir: string;
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	const fallbackAgentDir = path.join(getConfigRootDir(), "agent");

	beforeEach(() => {
		testAgentDir = path.join(import.meta.dir, `.tmp-listing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		setAgentDir(testAgentDir);
		sessionDir = path.join(testAgentDir, "manual-sessions");
		fs.mkdirSync(sessionDir, { recursive: true });
	});

	afterEach(async () => {
		if (originalAgentDir) {
			setAgentDir(originalAgentDir);
		} else {
			setAgentDir(fallbackAgentDir);
			delete process.env.PI_CODING_AGENT_DIR;
		}
		if (testAgentDir) await fsp.rm(testAgentDir, { recursive: true, force: true });
	});

	it("bounds live-owner inspection for a silent framed endpoint", async () => {
		const socketPath = path.join(testAgentDir, "silent.sock");
		const server = net.createServer(() => {});
		const listening = Promise.withResolvers<void>();
		server.once("error", listening.reject);
		server.listen(socketPath, listening.resolve);
		await listening.promise;

		const sessionFile = path.join(sessionDir, "silent-owner.jsonl");
		const sessionId = "silent-owner";
		await fsp.writeFile(
			sessionFile,
			`${JSON.stringify({
				type: "session",
				id: sessionId,
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: sessionDir,
			})}\n`,
		);
		const ownershipRoot = path.join(testAgentDir, "agent-mux");
		const canonicalSessionFile = await fsp.realpath(sessionFile);
		const claim = path.join(
			ownershipRoot,
			"owners-v1",
			createHash("sha256").update(`${canonicalSessionFile}\0${sessionId}`).digest("hex"),
			"claim",
		);
		const ownerEpoch = randomUUID();
		const runnerInstanceId = randomUUID();
		const buildRevision = { digest: "a".repeat(64), version: "silent-owner-test" };
		await fsp.mkdir(claim, { recursive: true });
		await fsp.writeFile(
			path.join(claim, "lease.json"),
			JSON.stringify({
				version: 1,
				sessionFile: canonicalSessionFile,
				sessionId,
				ownerKind: "omp",
				ownerEpoch,
				muxName: null,
				socketPath,
				daemonProcess: null,
				controllerProcess: { bootId: "not-current", pid: process.pid, startFingerprint: "not-current" },
				phase: "running",
				acquiredAtUnixMs: Date.now(),
				heartbeatSeq: 0,
				heartbeatAtUnixMs: Date.now(),
			}),
		);
		await fsp.writeFile(
			path.join(claim, `identity-v1-${ownerEpoch}.json`),
			JSON.stringify({
				version: 1,
				ownerEpoch,
				buildRevision,
				runnerInstanceId,
				pid: process.pid,
				cwd: process.cwd(),
				startedAt: "2026-01-01T00:00:00.000Z",
				muxHint: null,
			}),
		);

		const originalAgentMuxDir = process.env.AGENT_MUX_DIR;
		process.env.AGENT_MUX_DIR = ownershipRoot;
		try {
			const startedAt = performance.now();
			const result = await listSessionsWithDiagnostics(sessionDir, new FileSessionStorage());
			expect(performance.now() - startedAt).toBeLessThan(1_500);
			expect(result.sessions).toHaveLength(1);
			expect(result.sessions[0]?.owner).toBeUndefined();
		} finally {
			if (originalAgentMuxDir === undefined) delete process.env.AGENT_MUX_DIR;
			else process.env.AGENT_MUX_DIR = originalAgentMuxDir;
			const closed = Promise.withResolvers<void>();
			server.close(error => (error ? closed.reject(error) : closed.resolve()));
			await closed.promise;
		}
	});
	it("returns the valid session and reports one skipped corrupt jsonl", async () => {
		const validFile = path.join(sessionDir, "valid.jsonl");
		fs.writeFileSync(
			validFile,
			`${JSON.stringify({ type: "session", id: "valid-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: sessionDir })}\n`,
		);

		const corruptFile = path.join(sessionDir, "corrupt.jsonl");
		fs.writeFileSync(corruptFile, `${JSON.stringify({ type: "not-a-session", id: "corrupt-session" })}\n`);

		const result = await listSessionsWithDiagnostics(sessionDir, new FileSessionStorage());

		expect(result.sessions).toHaveLength(1);
		expect(result.sessions[0].id).toBe("valid-session");
		expect(result.sessions[0].path).toBe(validFile);
		expect(result.skippedFiles).toHaveLength(1);
		expect(result.skippedFiles[0]).toEqual({ path: corruptFile, reason: "missing_header" });
	});

	it("dedupes a skipped local file that is also found by the global scan", async () => {
		const storage = new FileSessionStorage();
		const cwd = path.join(testAgentDir, "project");
		fs.mkdirSync(cwd, { recursive: true });
		const localSessionDir = computeDefaultSessionDir(cwd, storage);
		const corruptFile = path.join(localSessionDir, "corrupt.jsonl");
		fs.writeFileSync(corruptFile, `${JSON.stringify({ type: "not-a-session", id: "corrupt-session" })}\n`);

		const result = await resolveResumableSessionWithDiagnostics("missing-session", cwd, undefined, storage);

		expect(result.match).toBeUndefined();
		expect(result.skippedFiles.filter(file => file.path === corruptFile)).toHaveLength(1);
		expect(result.skippedFiles).toEqual([{ path: corruptFile, reason: "missing_header" }]);
	});
});
