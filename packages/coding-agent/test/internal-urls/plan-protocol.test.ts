import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { findLatestPlanArtifact } from "@oh-my-pi/pi-coding-agent/plan-mode/plan-artifact";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-protocol-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("PlanProtocolHandler", () => {
	beforeEach(() => InternalUrlRouter.resetForTests());
	afterEach(() => InternalUrlRouter.resetForTests());

	it("reopens the latest approved plan through a journal-backed plan URL", async () => {
		await withTempDir(async tempDir => {
			const sessionDir = path.join(tempDir, "sessions");
			const manager = SessionManager.create(tempDir, sessionDir);
			await manager.ensureOnDisk();
			const first = await manager.appendPlanArtifact("First plan", "# First\n", "local://first-plan.md");
			const second = await manager.appendPlanArtifact("Second plan", "# Second\n\nLong detail", "local://second-plan.md");
			const sessionFile = manager.getSessionFile();
			if (!sessionFile || !second.planUrl || !second.entryId) throw new Error("expected persisted plan session");
			await manager.close();

			const reopened = await SessionManager.open(sessionFile, sessionDir);
			const localProtocolOptions = {
				getArtifactsDir: () => reopened.getArtifactsDir(),
				getSessionId: () => reopened.getSessionId(),
			};
			const router = InternalUrlRouter.instance();
			expect(findLatestPlanArtifact(reopened.getBranch())?.data.localPath).toBe(
				"local://plans/" + second.entryId + ".md",
			);
			const latest = await router.resolve("plan://latest", { localProtocolOptions });
			const exact = await router.resolve(second.planUrl, { localProtocolOptions });

			expect(latest.content).toBe("# Second\n\nLong detail");
			expect(exact.content).toBe(latest.content);
			expect(latest.contentType).toBe("text/markdown");
			expect(latest.immutable).toBe(true);
			expect(first.planUrl).toBeDefined();
			await reopened.close();
		});
	});

	it("ignores malformed journal metadata instead of trusting it", async () => {
		await withTempDir(async tempDir => {
			const artifactsDir = path.join(tempDir, "session");
			await fs.mkdir(path.join(artifactsDir, "local", "plans"), { recursive: true });
			await Bun.write(path.join(artifactsDir, "local", "plans", "valid.md"), "valid plan");
			await Bun.write(
				`${artifactsDir}.jsonl`,
				[
					JSON.stringify({ type: "session", id: "session", timestamp: new Date().toISOString(), cwd: tempDir }),
					JSON.stringify({
						type: "custom",
						id: "bad",
						customType: "plan-artifact",
						data: { version: 1, title: "bad", localPath: "local://../secret.md" },
					}),
					JSON.stringify({
						type: "custom",
						id: "good",
						customType: "plan-artifact",
						data: { version: 1, title: "Valid", localPath: "local://plans/valid.md" },
					}),
				].join("\n"),
			);

			const resource = await InternalUrlRouter.instance().resolve("plan://latest", {
				localProtocolOptions: { getArtifactsDir: () => artifactsDir },
			});
			expect(resource.content).toBe("valid plan");
			expect(resource.notes).toContain("Journal entry: good");
		});
	});
});
