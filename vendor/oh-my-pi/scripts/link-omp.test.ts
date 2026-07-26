import { afterAll, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const script = path.join(import.meta.dir, "link-omp.sh");
const roots: string[] = [];
const decoder = new TextDecoder();

function root(): string {
	const value = fs.mkdtempSync(path.join(os.tmpdir(), "omp-registry-test-"));
	roots.push(value);
	return value;
}
function sha(file: string): string {
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function testScript(base: string): string {
	const testRepo = path.join(base, "test-repo");
	const localScript = path.join(testRepo, "scripts", "link-omp.sh");
	if (fs.existsSync(localScript)) return localScript;
	fs.mkdirSync(path.dirname(localScript), { recursive: true });
	fs.copyFileSync(script, localScript);
	fs.copyFileSync(
		path.join(import.meta.dir, "link-omp-registry.py"),
		path.join(testRepo, "scripts", "link-omp-registry.py"),
	);
	const driver = path.join(
		testRepo,
		"packages",
		"coding-agent",
		"scripts",
		"runner-canary-readiness.ts",
	);
	fs.mkdirSync(path.dirname(driver), { recursive: true });
	fs.writeFileSync(
		driver,
		`import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const args = new Map<string, string>();
for (let index = 2; index < Bun.argv.length; index += 2) args.set(Bun.argv[index], Bun.argv[index + 1]);
const candidate = args.get("--candidate")!;
const output = args.get("--output")!;
const buildResult = Bun.spawnSync([candidate, "--runner-build-revision"], { stdout: "pipe" });
if (buildResult.exitCode !== 0 || Bun.spawnSync([candidate, "--independent-readiness"]).exitCode !== 0) process.exit(1);
const build = JSON.parse(new TextDecoder().decode(buildResult.stdout));
const digest = createHash("sha256").update(readFileSync(candidate)).digest("hex");
const now = new Date().toISOString();
const receipt = { schemaVersion: 1, buildDigest: digest, version: build.version, runnerInstanceId: randomUUID(), fixtureSessionId: "independent-fixture", ownerEpoch: randomUUID(), startedAt: now, stoppedAt: now, initialSnapshotRevision: 1, finalSnapshotRevision: 2, commandId: randomUUID(), proof: { mutationAppliedExactlyOnce: true, leaseReleased: true, leaseReacquired: true, jsonlPersisted: true, queuePersisted: true } };
writeFileSync(output, JSON.stringify(receipt) + "\\n");
`,
	);
	fs.chmodSync(driver, 0o755);
	return localScript;
}
function scopedEnv(machineBase: string, workspaceBase = machineBase): Record<string, string> {
	const dataHome = path.join(machineBase, "xdg-data");
	return {
		...process.env,
		HOME: path.join(machineBase, "home"),
		XDG_DATA_HOME: dataHome,
		OMP_RELEASE_REGISTRY_PATH: path.join(dataHome, "omp", "release-registry.json"),
		OMP_RELEASES_DIR: path.join(dataHome, "omp", "releases"),
		OMP_LINK_GLOBAL_BIN: path.join(machineBase, "bin"),
		OMP_LINK_REPO_ROOT: path.join(workspaceBase, "test-repo"),
		OMP_LINK_READINESS_FIXTURE_ROOT: machineBase,
	};
}
function runWorkspace(machineBase: string, workspaceBase: string, args: string[]) {
	const bin = path.join(machineBase, "bin");
	fs.mkdirSync(bin, { recursive: true });
	return Bun.spawnSync(["bash", testScript(workspaceBase), ...args], {
		cwd: workspaceBase,
		env: scopedEnv(machineBase, workspaceBase),
		stdout: "pipe",
		stderr: "pipe",
	});
}
function run(base: string, args: string[]) {
	return runWorkspace(base, base, args);
}
function fixture(base: string, name: string, version: string): string {
	const file = path.join(base, name);
	fs.writeFileSync(
		file,
		`#!/bin/sh
set -eu
case "\${1:-}" in
--runner-build-revision) d=$(shasum -a 256 "$0" | awk '{print $1}'); printf '{"buildDigest":"%s","version":"${version}"}\\n' "$d" ;;
--independent-readiness) [ '${version}' != broken ] ;;
acquire) state=$2; who=$3; if ! mkdir "$state.lock" 2>/dev/null; then exit 73; fi; n=0; [ ! -f "$state.epoch" ] || n=$(cat "$state.epoch"); n=$((n+1)); printf '%s\\n' "$n" > "$state.epoch"; printf '%s:%s\\n' "$who" "$n" > "$state.lock/owner"; printf '%s\\n' "$who:$n" ;;
release) state=$2; token=$3; [ "$(cat "$state.lock/owner")" = "$token" ] || exit 74; rm -rf "$state.lock" ;;
write) state=$2; token=$3; [ -f "$state.lock/owner" ] && [ "$(cat "$state.lock/owner")" = "$token" ] || exit 75; printf '%s\\n' "$token" >> "$state.writes" ;;
*) printf '${version}\\n' ;;
esac
`,
	);
	fs.chmodSync(file, 0o755);
	return file;
}
function receipt(file: string, overrides: Record<string, unknown> = {}): string {
	const now = new Date().toISOString();
	const buildDigest = sha(file);
	const value = {
		schemaVersion: 1,
		buildDigest,
		version: decoder
			.decode(Bun.spawnSync([file, "--runner-build-revision"], { stdout: "pipe" }).stdout)
			.match(/"version":"([^"]+)/)?.[1],
		runnerInstanceId: randomUUID(),
		fixtureSessionId: "fixture",
		ownerEpoch: randomUUID(),
		startedAt: now,
		stoppedAt: now,
		initialSnapshotRevision: 1,
		finalSnapshotRevision: 2,
		commandId: randomUUID(),
		proof: {
			mutationAppliedExactlyOnce: true,
			leaseReleased: true,
			leaseReacquired: true,
			jsonlPersisted: true,
			queuePersisted: true,
		},
		...overrides,
	};
	const output = `${file}.receipt-${randomUUID()}.json`;
	fs.writeFileSync(output, `${JSON.stringify(value)}\n`);
	return output;
}
function registry(base: string): {
	stable: string | null;
	previous: string | null;
	candidate: string | null;
	receiptDigest: string | null;
	timestamps: Record<string, string | null>;
} {
	return JSON.parse(fs.readFileSync(path.join(base, "bin", ".omp-release-registry.json"), "utf8"));
}
function candidateDigest(base: string, file: string): string {
	const result = run(base, ["candidate", file]);
	expect(result.exitCode).toBe(0);
	return sha(file);
}
function bless(base: string, digest: string, proof: string) {
	return run(base, ["bless", digest, proof]);
}
function invoke(file: string, args: string[]) {
	return Bun.spawnSync([file, ...args], { stdout: "pipe", stderr: "pipe" });
}

afterAll(() => {
	for (const value of roots) fs.rmSync(value, { recursive: true, force: true });
});

describe("two-step immutable OMP registry", () => {
	it("materializes without selecting, blesses only a strict fresh proof, and retains N-1", () => {
		const base = root(),
			a = fixture(base, "a", "A"),
			b = fixture(base, "b", "B");
		const ad = candidateDigest(base, a);
		expect(fs.existsSync(path.join(base, "bin", "omp"))).toBeFalse();
		expect(
			bless(base, ad, receipt(path.join(base, "bin", ".omp-releases", `omp-${ad}`))).exitCode,
		).toBe(0);
		const bd = candidateDigest(base, b);
		expect(registry(base).stable).toBe(ad);
		const releaseB = path.join(base, "bin", ".omp-releases", `omp-${bd}`);
		expect(bless(base, bd, receipt(releaseB)).exitCode).toBe(0);
		expect(registry(base)).toMatchObject({ stable: bd, previous: ad, candidate: null });
		expect(fs.realpathSync(path.join(base, "bin", "omp.previous"))).toBe(
			fs.realpathSync(path.join(base, "bin", ".omp-releases", `omp-${ad}`)),
		);
	});

	it("shares one release path across workspaces and does not duplicate repeated promotion", () => {
		const machine = root(),
			workspaceOne = root(),
			workspaceTwo = root();
		const candidate = fixture(machine, "candidate", "A");
		const digest = sha(candidate);
		expect(runWorkspace(machine, workspaceOne, ["candidate", candidate]).exitCode).toBe(0);
		const release = path.join(machine, "bin", ".omp-releases", `omp-${digest}`);
		expect(runWorkspace(machine, workspaceOne, ["bless", digest, receipt(release)]).exitCode).toBe(
			0,
		);
		expect(runWorkspace(machine, workspaceTwo, ["candidate", candidate]).exitCode).toBe(0);
		expect(runWorkspace(machine, workspaceTwo, ["bless", digest, receipt(release)]).exitCode).toBe(
			0,
		);
		const sharedRoot = path.join(machine, "xdg-data", "omp");
		expect(fs.realpathSync(path.join(workspaceOne, "test-repo", "local"))).toBe(
			path.join(sharedRoot, "workspace-local"),
		);
		expect(fs.realpathSync(path.join(workspaceTwo, "test-repo", "local"))).toBe(
			path.join(sharedRoot, "workspace-local"),
		);
		expect(fs.realpathSync(path.join(machine, "bin", ".omp-releases"))).toBe(
			path.join(sharedRoot, "releases"),
		);
		expect(
			fs
				.readdirSync(path.join(sharedRoot, "releases"))
				.filter((name) => /^omp-[a-f0-9]{64}$/.test(name)),
		).toEqual([`omp-${digest}`]);
		expect(registry(machine)).toMatchObject({ stable: digest, previous: null, candidate: null });
	});

	it("adopts an immutable selected release when initializing the registry", () => {
		const base = root(),
			a = fixture(base, "a", "A"),
			b = fixture(base, "b", "B");
		const ad = candidateDigest(base, a);
		const bin = path.join(base, "bin");
		const releaseA = path.join(bin, ".omp-releases", `omp-${ad}`);
		fs.rmSync(path.join(bin, ".omp-release-registry.json"));
		fs.symlinkSync(releaseA, path.join(bin, "omp"));

		const bd = candidateDigest(base, b);
		expect(registry(base).stable).toBe(ad);
		const releaseB = path.join(bin, ".omp-releases", `omp-${bd}`);
		expect(bless(base, bd, receipt(releaseB)).exitCode).toBe(0);
		expect(registry(base)).toMatchObject({ stable: bd, previous: ad, candidate: null });
		expect(run(base, ["rollback"]).exitCode).toBe(0);
		expect(registry(base)).toMatchObject({ stable: ad, previous: bd, candidate: null });
	});

	it("rejects false, stale, mismatched, tampered, and missing-candidate proofs", () => {
		const cases: Array<(release: string) => string> = [
			(release) =>
				receipt(release, {
					proof: {
						mutationAppliedExactlyOnce: false,
						leaseReleased: true,
						leaseReacquired: true,
						jsonlPersisted: true,
						queuePersisted: true,
					},
				}),
			(release) =>
				receipt(release, {
					startedAt: "2020-01-01T00:00:00.000Z",
					stoppedAt: "2020-01-01T00:00:01.000Z",
				}),
			(release) => receipt(release, { buildDigest: "0".repeat(64) }),
			(release) => receipt(release, { unexpected: true }),
		];
		for (const make of cases) {
			const base = root(),
				file = fixture(base, "candidate", "X"),
				digest = candidateDigest(base, file),
				release = path.join(base, "bin", ".omp-releases", `omp-${digest}`);
			expect(bless(base, digest, make(release)).exitCode).not.toBe(0);
			expect(registry(base).stable).toBeNull();
		}
		const base = root(),
			file = fixture(base, "candidate", "X"),
			proof = receipt(file);
		expect(bless(base, sha(file), proof).exitCode).not.toBe(0);
	});

	it("cannot bless a forged-valid receipt when the independent candidate run fails", () => {
		const base = root();
		const file = fixture(base, "broken", "broken");
		const digest = candidateDigest(base, file),
			release = path.join(base, "bin", ".omp-releases", `omp-${digest}`);
		expect(bless(base, digest, receipt(release)).exitCode).not.toBe(0);
		expect(registry(base).stable).toBeNull();
	});

	it("serializes concurrent bless and refuses rollback without N-1", async () => {
		const base = root(),
			file = fixture(base, "candidate", "A"),
			digest = candidateDigest(base, file),
			release = path.join(base, "bin", ".omp-releases", `omp-${digest}`),
			proof = receipt(release);
		const env = scopedEnv(base);
		const spawnOptions = { env, stdout: "pipe" as const, stderr: "pipe" as const };
		const localScript = testScript(base);
		const children = [
			Bun.spawn(["bash", localScript, "bless", digest, proof], spawnOptions),
			Bun.spawn(["bash", localScript, "bless", digest, proof], spawnOptions),
		];
		const results = await Promise.all(children.map((child) => child.exited));
		expect(results.filter((exitCode) => exitCode === 0)).toHaveLength(1);
		expect(run(base, ["rollback"]).exitCode).not.toBe(0);
	});

	it("recovers bless and rollback crash windows from the selector journal", () => {
		for (const point of ["after-journal", "after-selector", "after-registry"]) {
			const base = root(),
				bin = path.join(base, "bin"),
				a = fixture(base, "a", "A"),
				b = fixture(base, "b", "B");
			const helper = path.join(base, "test-repo", "scripts", "link-omp-registry.py");
			const ad = candidateDigest(base, a),
				releaseA = path.join(bin, ".omp-releases", `omp-${ad}`);
			expect(bless(base, ad, receipt(releaseA)).exitCode).toBe(0);
			const bd = candidateDigest(base, b),
				releaseB = path.join(bin, ".omp-releases", `omp-${bd}`);
			const crashed = Bun.spawnSync(["python3", helper, "bless", bin, bd, receipt(releaseB)], {
				env: { ...scopedEnv(base), OMP_LINK_CRASH_AT: point },
			});
			expect(crashed.exitCode).toBe(97);
			expect(
				Bun.spawnSync(["python3", helper, "recover", bin], { env: scopedEnv(base) }).exitCode,
			).toBe(0);
			const expectedStable = point === "after-journal" ? ad : bd;
			expect(registry(base).stable).toBe(expectedStable);
			expect(path.basename(fs.realpathSync(path.join(bin, "omp")))).toBe(`omp-${expectedStable}`);
			expect(registry(base).previous).toBe(point === "after-journal" ? null : ad);

			if (point === "after-journal") expect(bless(base, bd, receipt(releaseB)).exitCode).toBe(0);
			const beforeRollback = registry(base);
			const rollbackCrash = Bun.spawnSync(["python3", helper, "rollback", bin], {
				env: { ...scopedEnv(base), OMP_LINK_CRASH_AT: point },
			});
			expect(rollbackCrash.exitCode).toBe(97);
			expect(
				Bun.spawnSync(["python3", helper, "recover", bin], { env: scopedEnv(base) }).exitCode,
			).toBe(0);
			const rolledBack = point !== "after-journal";
			expect(registry(base).stable).toBe(
				rolledBack ? beforeRollback.previous : beforeRollback.stable,
			);
			expect(registry(base).previous).toBe(
				rolledBack ? beforeRollback.stable : beforeRollback.previous,
			);
			expect(path.basename(fs.realpathSync(path.join(bin, "omp.previous")))).toBe(
				`omp-${registry(base).previous}`,
			);
		}
	});

	it("proves stop/release before acquire, rollback selection, fencing, and increasing epochs", () => {
		const base = root(),
			state = path.join(base, "owned"),
			a = fixture(base, "a", "A"),
			b = fixture(base, "b", "B");
		const ad = candidateDigest(base, a),
			releaseA = path.join(base, "bin", ".omp-releases", `omp-${ad}`);
		expect(bless(base, ad, receipt(releaseA)).exitCode).toBe(0);
		const stable = path.join(base, "bin", "omp"),
			tokenA = decoder.decode(invoke(stable, ["acquire", state, "stable"]).stdout).trim();
		const bd = candidateDigest(base, b),
			releaseB = path.join(base, "bin", ".omp-releases", `omp-${bd}`);
		expect(invoke(releaseB, ["acquire", state, "candidate"]).exitCode).toBe(73);
		expect(invoke(stable, ["write", state, tokenA]).exitCode).toBe(0);
		expect(invoke(stable, ["release", state, tokenA]).exitCode).toBe(0);
		expect(bless(base, bd, receipt(releaseB)).exitCode).toBe(0);
		const tokenB = decoder.decode(invoke(stable, ["acquire", state, "candidate"]).stdout).trim();
		expect(tokenB).toBe("candidate:2");
		expect(invoke(releaseA, ["write", state, tokenA]).exitCode).toBe(75);
		expect(run(base, ["rollback"]).exitCode).toBe(0);
		expect(registry(base)).toMatchObject({ stable: ad, previous: bd });
		expect(invoke(releaseA, ["acquire", state, "rollback"]).exitCode).toBe(73);
		expect(invoke(releaseB, ["release", state, tokenB]).exitCode).toBe(0);
		const tokenRollback = decoder
			.decode(invoke(stable, ["acquire", state, "rollback"]).stdout)
			.trim();
		expect(tokenRollback).toBe("rollback:3");
		expect(fs.readFileSync(`${state}.writes`, "utf8").trim().split("\n")).toEqual(["stable:1"]);
		if (process.env.OMP_LINK_DEMO === "1")
			console.log(
				JSON.stringify({ registry: registry(base), epochs: [tokenA, tokenB, tokenRollback] }),
			);
	});
});
