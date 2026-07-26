import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RolloutJournal } from "@oh-my-pi/pi-coding-agent/session/rollout-journal";
import { resolveSessionBinaryRoute } from "@oh-my-pi/pi-coding-agent/session/session-build-routing";
import { SessionControlBus } from "@oh-my-pi/pi-coding-agent/session/session-control";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { FileSessionStorage } from "@oh-my-pi/pi-coding-agent/session/session-storage";

const timestamp = "2026-07-26T00:00:00.000Z";

async function writeExecutable(releasesDir: string, contents: string): Promise<{ digest: string; executable: string }> {
	const digest = createHash("sha256").update(contents).digest("hex");
	const executable = path.join(releasesDir, `omp-${digest}`);
	await fs.mkdir(releasesDir, { recursive: true });
	await fs.writeFile(executable, contents, { mode: 0o755 });
	await fs.chmod(executable, 0o755);
	return { digest, executable };
}

async function writeRegistry(root: string, stable: string): Promise<{ registryPath: string; releasesDir: string }> {
	const registryPath = path.join(root, "bin", ".omp-release-registry.json");
	const releasesDir = path.join(root, "bin", ".omp-releases");
	await fs.mkdir(path.dirname(registryPath), { recursive: true });
	await fs.writeFile(
		registryPath,
		JSON.stringify({
			schemaVersion: 1,
			stable,
			previous: null,
			candidate: null,
			receiptDigest: null,
			timestamps: { candidate: null, blessed: timestamp, rollback: null },
		}),
	);
	return { registryPath, releasesDir };
}

function journal(header: Record<string, unknown>, entries: readonly Record<string, unknown>[] = []): string {
	return `${[header, ...entries].map(entry => JSON.stringify(entry)).join("\n")}\n`;
}

describe("session build routing", () => {
	it("resumes an older-format journal on the installed current build without rewriting old records", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-old-writer-resume-"));
		try {
			const releasesDir = path.join(root, "bin", ".omp-releases");
			const current = await writeExecutable(releasesDir, "current-build");
			const release = await writeRegistry(root, current.digest);
			const sessionFile = path.join(root, "older.jsonl");
			const original = journal({ type: "session", id: "older-session", timestamp, cwd: root }, [
				{ type: "message", timestamp, message: { role: "user", content: "from older writer", timestamp: 1 } },
			]);
			await fs.writeFile(sessionFile, original);

			const route = await resolveSessionBinaryRoute({
				sessionId: "older-session",
				sessionFile,
				currentExecutable: current.executable,
				currentDigest: current.digest,
				release,
				controlDbPath: path.join(root, "control.sqlite"),
				now: () => timestamp,
			});
			expect(route.receipt.decision).toBe("newest-installed");
			expect(route.receipt.selectedDigest).toBe(current.digest);

			const manager = await SessionManager.open(sessionFile, undefined, new FileSessionStorage(), {
				suppressBreadcrumb: true,
			});
			expect(manager.getEntries()).toHaveLength(1);
			manager.appendCustomEntry("session_binary_route", route.receipt);
			await manager.flush();
			const persisted = await fs.readFile(sessionFile, "utf8");
			expect(persisted.startsWith(original)).toBeTrue();
			expect(persisted.slice(0, original.length)).toBe(original);
			expect(persisted.slice(original.length)).toContain('"customType":"session_binary_route"');
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("falls back to newest when an explicit pinned artifact is gone and records the ignored rollout projection", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-missing-pin-route-"));
		try {
			const releasesDir = path.join(root, "bin", ".omp-releases");
			const current = await writeExecutable(releasesDir, "newest-build");
			const release = await writeRegistry(root, current.digest);
			const missingDigest = "a".repeat(64);
			const sessionFile = path.join(root, "pinned.jsonl");
			await fs.writeFile(
				sessionFile,
				journal({ type: "session", version: 4, id: "pinned-session", timestamp, cwd: root }, [
					{
						type: "custom",
						id: "pin-entry",
						parentId: null,
						timestamp,
						customType: "fleet_pin",
						data: { version: 2, action: "pin", channel: "digest", digest: missingDigest },
					},
				]),
			);
			const controlDbPath = path.join(root, "control.sqlite");
			const rollout = new RolloutJournal(controlDbPath);
			rollout.beginRun({
				rolloutId: "historic-rollout",
				targetDigest: missingDigest,
				targetVersion: "1.0.0",
				startedAt: timestamp,
			});
			rollout.updatePeer({
				rolloutId: "historic-rollout",
				sessionId: "pinned-session",
				sessionFile,
				name: "pinned",
				phase: "planned",
				updatedAt: timestamp,
			});
			rollout.close();

			const route = await resolveSessionBinaryRoute({
				sessionId: "pinned-session",
				sessionFile,
				currentExecutable: current.executable,
				currentDigest: current.digest,
				release,
				controlDbPath,
				now: () => timestamp,
			});
			expect(route.receipt).toMatchObject({
				decision: "missing-pin-fallback-newest",
				requestedDigest: missingDigest,
				selectedDigest: current.digest,
				observedRollout: {
					rolloutId: "historic-rollout",
					targetDigest: missingDigest,
					usedForRouting: false,
				},
			});
			expect(route.receipt.fallbackReason).toContain("unavailable or unsafe");
			expect(route.executable).toBe(current.executable);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("honors an explicit per-session build pin", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-explicit-pin-route-"));
		try {
			const releasesDir = path.join(root, "bin", ".omp-releases");
			const current = await writeExecutable(releasesDir, "newest-build");
			const pinned = await writeExecutable(releasesDir, "a-b-test-build");
			const release = await writeRegistry(root, current.digest);
			const sessionFile = path.join(root, "explicit.jsonl");
			await fs.writeFile(
				sessionFile,
				journal({ type: "session", version: 4, id: "explicit-session", timestamp, cwd: root }, [
					{
						type: "custom",
						id: "pin-entry",
						parentId: null,
						timestamp,
						customType: "fleet_pin",
						data: { version: 2, action: "pin", channel: "digest", digest: pinned.digest },
					},
				]),
			);
			const route = await resolveSessionBinaryRoute({
				sessionId: "explicit-session",
				sessionFile,
				currentExecutable: current.executable,
				currentDigest: current.digest,
				release,
				controlDbPath: path.join(root, "control.sqlite"),
				now: () => timestamp,
			});
			expect(route.receipt).toMatchObject({
				decision: "explicit-pin",
				requestedDigest: pinned.digest,
				selectedDigest: pinned.digest,
			});
			expect(route.executable).toBe(pinned.executable);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("keeps a live rollout cordon authoritative over the default and session pin", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cordon-route-"));
		try {
			const releasesDir = path.join(root, "bin", ".omp-releases");
			const current = await writeExecutable(releasesDir, "newest-build");
			const pinned = await writeExecutable(releasesDir, "pinned-build");
			const cordoned = await writeExecutable(releasesDir, "cordoned-rollout-build");
			const release = await writeRegistry(root, current.digest);
			const sessionFile = path.join(root, "cordoned.jsonl");
			await fs.writeFile(
				sessionFile,
				journal({ type: "session", version: 4, id: "cordoned-session", timestamp, cwd: root }, [
					{
						type: "custom",
						id: "pin-entry",
						parentId: null,
						timestamp,
						customType: "fleet_pin",
						data: { version: 2, action: "pin", channel: "digest", digest: pinned.digest },
					},
				]),
			);
			const controlDbPath = path.join(root, "control.sqlite");
			const control = new SessionControlBus(controlDbPath);
			control.bindTarget("cordoned-session", "owner-epoch");
			control.cordon("cordoned-session", "owner-epoch", "active-rollout", cordoned.digest, "rollout");
			control.close();

			const route = await resolveSessionBinaryRoute({
				sessionId: "cordoned-session",
				sessionFile,
				currentExecutable: current.executable,
				currentDigest: current.digest,
				release,
				controlDbPath,
				now: () => timestamp,
			});
			expect(route.receipt).toMatchObject({
				decision: "active-cordon",
				selectedDigest: cordoned.digest,
				cordon: { rolloutId: "active-rollout", expectedDigest: cordoned.digest },
			});
			expect(route.executable).toBe(cordoned.executable);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
