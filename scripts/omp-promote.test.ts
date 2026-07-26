import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	PROMOTION_STAGE_ORDER,
	acquirePromotionLock,
	blessedCommitFromVersion,
	composePromotionReport,
	decidePromotion,
	formatRolloutSummary,
	parseBuildRevision,
	parseInstalledVersion,
	parsePromotionOptions,
	promotionBuildEnvironment,
	readInstalledBuildRevision,
	timed,
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

describe("promotion build environment", () => {
	it("lets the fork rust-toolchain pin override an ambient toolchain", () => {
		expect(promotionBuildEnvironment({ HOME: "/tmp/home", RUSTUP_TOOLCHAIN: "stable" })).toEqual({ HOME: "/tmp/home" });
	});
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

	it("reads an installed binary via --version without invoking the candidate-only revision probe", async () => {
		const root = await temporaryRoot();
		const binary = path.join(root, "omp");
		const contents = "installed binary bytes";
		await fs.writeFile(binary, contents);
		const invocations: Array<{ argv: string[]; cwd: string }> = [];
		const revision = await readInstalledBuildRevision(binary, root, async (argv, cwd) => {
			invocations.push({ argv, cwd });
			return "omp/16.0.1+fork.492695a5acfc";
		});
		expect(invocations).toEqual([{ argv: [binary, "--version"], cwd: root }]);
		expect(parseInstalledVersion("omp/16.0.1+fork.492695a5acfc")).toBe("16.0.1+fork.492695a5acfc");
		expect(revision).toEqual({
			buildDigest: createHash("sha256").update(contents).digest("hex"),
			version: "16.0.1+fork.492695a5acfc",
		});
	});

	it("rejects versions without an authoritative fork commit", () => {
		expect(() => blessedCommitFromVersion("16.0.1")).toThrow("no fork commit suffix");
		expect(() => blessedCommitFromVersion("16.0.1+fork.not-a-commit")).toThrow("no fork commit suffix");
	});
});

describe("promotion reporting", () => {
	it("reports a successful bless before relaying rollout stdout", () => {
		expect(composePromotionReport("16.0.1+fork.abc1234", "a".repeat(64), {
			exitCode: 0,
			stdout: "rollout target abc\nrestarted peer\n",
			stderr: "",
		})).toEqual({
			blessedLine: `BLESSED 16.0.1+fork.abc1234 ${"a".repeat(64)}`,
			rolloutStdout: "rollout target abc\nrestarted peer\n",
		});
	});

	it("separates a rollout failure from the successful bless", () => {
		expect(composePromotionReport("16.0.1+fork.abc1234", "b".repeat(64), {
			exitCode: 1,
			stdout: "rollout target def\n",
			stderr: "rollout aborted at peer-2: recovery timeout\n",
		})).toEqual({
			blessedLine: `BLESSED 16.0.1+fork.abc1234 ${"b".repeat(64)}`,
			rolloutStdout: "rollout target def\n",
			incompleteLine: "ROLLOUT incomplete: rollout aborted at peer-2: recovery timeout",
		});
	});
});

describe("rollout options and summary", () => {
	it("parses rollout controls from flags and environment", () => {
		expect(parsePromotionOptions(["--verbose"], {})).toEqual({ force: false, noRollout: false, verbose: true });
		expect(parsePromotionOptions(["--no-rollout"], {})).toEqual({ force: false, noRollout: true, verbose: false });
		expect(parsePromotionOptions(["--force"], {})).toEqual({ force: true, noRollout: false, verbose: false });
		expect(parsePromotionOptions([], { OMP_PROMOTE_ROLLOUT: "0" })).toEqual({ force: false, noRollout: true, verbose: false });
		expect(() => parsePromotionOptions(["--unexpected"], {})).toThrow("unknown option");
	});

	it("summarizes restarted, unresponsive, legacy, and remaining sessions", () => {
		expect(
			formatRolloutSummary(
				[
					"rollout target digest (version)",
					"restarted alpha session=a",
					"skip beta session=b reason=unresponsive",
					"skip legacy session=l reason=legacy binary — restart manually once",
					"failed canary session=c",
					"untouched later session=d",
				].join("\n"),
			),
		).toBe("rollout: 1 restarted, 2 skipped (unresponsive: 1, legacy: 1), 2 remaining");
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

describe("stage timing", () => {
	it("reports elapsed time and returns the result for a successful stage", async () => {
		const lines: string[] = [];
		const result = await timed("test-stage", async () => {
			await new Promise(resolve => setTimeout(resolve, 10));
			return 42;
		}, (line) => lines.push(line));
		expect(result).toBe(42);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/^stage test-stage done \d+\.\d{2}s$/);
	});

	it("reports elapsed time and re-throws for a failed stage", async () => {
		const lines: string[] = [];
		await expect(
			timed("broken", async () => { throw new Error("build broke"); }, (line) => lines.push(line)),
		).rejects.toThrow("build broke");
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/^stage broken failed \d+\.\d{2}s$/);
	});
});

describe("promotion stage order", () => {
	it("runs generation before typecheck and typecheck before native build", () => {
		const gen = PROMOTION_STAGE_ORDER.indexOf("generate");
		const types = PROMOTION_STAGE_ORDER.indexOf("check:types");
		const native = PROMOTION_STAGE_ORDER.indexOf("build:native");
		expect(gen).toBeGreaterThanOrEqual(0);
		expect(gen).toBeLessThan(types);
		expect(types).toBeLessThan(native);
	});

	it("completes native artifact and bundle before candidate install and readiness", () => {
		const native = PROMOTION_STAGE_ORDER.indexOf("build:native");
		const bundle = PROMOTION_STAGE_ORDER.indexOf("bundle");
		const candidateInstall = PROMOTION_STAGE_ORDER.indexOf("candidate-install");
		const readiness = PROMOTION_STAGE_ORDER.indexOf("readiness");
		const bless = PROMOTION_STAGE_ORDER.indexOf("bless");
		expect(native).toBeLessThan(bundle);
		expect(bundle).toBeLessThan(candidateInstall);
		expect(candidateInstall).toBeLessThan(readiness);
		expect(readiness).toBeLessThan(bless);
	});

	it("places bless after readiness and rollout last", () => {
		const readiness = PROMOTION_STAGE_ORDER.indexOf("readiness");
		const bless = PROMOTION_STAGE_ORDER.indexOf("bless");
		const rollout = PROMOTION_STAGE_ORDER.indexOf("rollout");
		expect(bless).toBe(readiness + 1);
		expect(rollout).toBe(bless + 1);
		expect(rollout).toBe(PROMOTION_STAGE_ORDER.length - 1);
	});
});
