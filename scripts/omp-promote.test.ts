import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	acquirePromotionLock,
	blessedCommitFromVersion,
	decidePromotion,
	parseBuildRevision,
} from "./omp-promote";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-promote-test-"));
	roots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("promotion decision", () => {
	it("is an idempotent no-op when vendor/oh-my-pi has no changes since the blessed fork commit", () => {
		expect(decidePromotion(false, "not-run")).toEqual({ kind: "noop", message: "no new commits" });
		expect(decidePromotion(false, "red")).toEqual({ kind: "noop", message: "no new commits" });
	});

	it("continues changed commits only until readiness turns red", () => {
		expect(decidePromotion(true, "not-run")).toEqual({ kind: "continue" });
		expect(decidePromotion(true, "green")).toEqual({ kind: "continue" });
		expect(decidePromotion(true, "red")).toEqual({ kind: "refuse", message: "readiness failed; refusing promotion" });
	});
});

describe("blessed build identity", () => {
	it("extracts the committed HEAD suffix and validates build revision JSON", () => {
		const commit = "0123456789ab";
		expect(blessedCommitFromVersion(`16.0.1+fork.${commit}`)).toBe(commit);
		expect(parseBuildRevision(JSON.stringify({ buildDigest: "a".repeat(64), version: `16.0.1+fork.${commit}` }))).toEqual({
			buildDigest: "a".repeat(64),
			version: `16.0.1+fork.${commit}`,
		});
	});

	it("rejects versions without an authoritative fork commit", () => {
		expect(() => blessedCommitFromVersion("16.0.1")).toThrow("no fork commit suffix");
		expect(() => blessedCommitFromVersion("16.0.1+fork.not-a-commit")).toThrow("no fork commit suffix");
	});
});

describe("promotion lock", () => {
	it("excludes a concurrent promoter without disturbing its lock", async () => {
		const lockPath = path.join(await temporaryRoot(), "bin", ".omp-promote.lock");
		const held = await acquirePromotionLock(lockPath);
		await expect(acquirePromotionLock(lockPath)).rejects.toThrow("another OMP promotion holds");
		expect(await fs.stat(lockPath)).toBeDefined();
		await held.release();
		await expect(fs.stat(lockPath)).rejects.toThrow();
	});

	it("atomically quarantines and recovers a stale dead-owner lock", async () => {
		const lockPath = path.join(await temporaryRoot(), "bin", ".omp-promote.lock");
		await fs.mkdir(lockPath, { recursive: true });
		await fs.writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify({
			token: "abandoned",
			pid: 2_147_483_647,
			createdAt: "2020-01-01T00:00:00.000Z",
		})}\n`);
		const recovered = await acquirePromotionLock(lockPath);
		const owner = JSON.parse(await fs.readFile(path.join(lockPath, "owner.json"), "utf8"));
		expect(owner.token).toBe(recovered.token);
		expect(owner.pid).toBe(process.pid);
		await recovered.release();
	});

	it("ages out an ownerless crash window", async () => {
		const lockPath = path.join(await temporaryRoot(), "bin", ".omp-promote.lock");
		await fs.mkdir(lockPath, { recursive: true });
		await fs.utimes(lockPath, new Date(0), new Date(0));
		const recovered = await acquirePromotionLock(lockPath, 0);
		expect(await fs.readFile(path.join(lockPath, "owner.json"), "utf8")).toContain(recovered.token);
		await recovered.release();
	});
});
