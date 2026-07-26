import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import {
	buildProcessCapture,
	DEFAULT_PROFILE_LIMITS,
	decodeProfilePeers,
	parseProfileCli,
	parsePsSnapshot,
	ProfileBoundaryError,
	ProfileCliError,
	ProfileLimitError,
	ProfileTargetAmbiguousError,
	ProfileTargetNotFoundError,
	ProfileTargetNotLiveError,
	PS_SNAPSHOT_COMMAND,
	resolveProfileTarget,
	sampleHostProcesses,
	serializeProcessProfile,
	writeAtomicProfileOutput,
	type ProcessProfile,
	type ProfilePeer,
} from "../omp-process-profile";

const targetPeer: ProfilePeer = {
	sessionId: "session-root",
	agentId: "Main",
	name: "Coordinator",
	cwd: "/work/root",
	pid: 100,
	lastSeen: "2026-07-26T10:00:00.000Z",
	state: "working",
	sessionFile: "/home/test/.omp/sessions/root.jsonl",
	ownerEpoch: "epoch-root",
	buildDigest: "digest-root",
	version: "17.0.0",
	labels: { workstream: "harness" },
};

const workerPeer: ProfilePeer = {
	sessionId: "session-worker",
	agentId: "Worker",
	name: "NestedWorker",
	cwd: "/work/root",
	pid: 102,
	lastSeen: "2026-07-26T10:00:00.000Z",
	state: "working",
};

const psFixture = `
  100     1   100    100   1.0  00:10 /opt/omp --session session-root
  101   100   100     50   0.5  00:09 /usr/bin/helper --flag value
  102   101   102     75   2.0  00:08 /opt/omp worker
  103   102   102     25   1.0  00:07 /usr/bin/child
  104   101   100     10   0.25 00:06 /usr/bin/sibling
  999     1   999    500   9.0  01:00 /usr/bin/unrelated
`;

describe("OMP process-tree profiling", () => {
	test("attributes every descendant to the nearest peer exactly once", () => {
		const capture = buildProcessCapture({
			captureId: "capture-1",
			sampledAt: "2026-07-26T10:00:01.000Z",
			target: targetPeer,
			peers: [targetPeer, workerPeer],
			rows: parsePsSnapshot(psFixture),
			labels: { width: 2, run: "run-a", phase: "during" },
		});

		expect(capture.processTree.map(process => process.pid).sort((left, right) => left - right)).toEqual([100, 101, 102, 103, 104]);
		expect(new Set(capture.processTree.map(process => process.pid)).size).toBe(capture.processTree.length);
		expect(capture.processTree.find(process => process.pid === 101)?.owner.sessionId).toBe("session-root");
		expect(capture.processTree.find(process => process.pid === 103)?.owner.sessionId).toBe("session-worker");
		expect(capture.processTree.find(process => process.pid === 104)?.owner.sessionId).toBe("session-root");
		expect(capture.aggregate).toMatchObject({
			processCount: 5,
			rssBytes: 260 * 1_024,
			cpuPercent: 4.75,
			physicalFootprintBytes: null,
			externalBytes: null,
			arrayBuffersBytes: null,
			jsc: { heapSizeBytes: null, heapCapacityBytes: null, extraMemoryBytes: null },
			heap: { usedBytes: null, totalBytes: null },
		});
		expect(capture.aggregate.byOwner).toEqual([
		{
			owner: { sessionId: "session-root", agentId: "Main", name: "Coordinator", pid: 100, targetRoot: true },
			processCount: 3,
			rssBytes: 160 * 1_024,
			cpuPercent: 1.75,
		},
		{
			owner: { sessionId: "session-worker", agentId: "Worker", name: "NestedWorker", pid: 102, targetRoot: false },
			processCount: 2,
			rssBytes: 100 * 1_024,
			cpuPercent: 3,
		},
		]);
		expect(capture.aggregate.byOwner.reduce((sum, owner) => sum + owner.rssBytes, 0)).toBe(capture.aggregate.rssBytes);
	});

	test("resolves a stable session before names and returns typed selection failures", () => {
		const duplicateName: ProfilePeer = { ...workerPeer, sessionId: "session-other", pid: 202 };
		expect(resolveProfileTarget("session-root", [targetPeer, workerPeer])).toBe(targetPeer);
		expect(() => resolveProfileTarget("NestedWorker", [targetPeer, workerPeer, duplicateName])).toThrow(ProfileTargetAmbiguousError);
		expect(() => resolveProfileTarget("missing", [targetPeer, workerPeer])).toThrow(ProfileTargetNotFoundError);
	});

	test("enforces sample, process-tree, and serialized output caps", () => {
		const lowSampleLimits = { ...DEFAULT_PROFILE_LIMITS, maxSamples: 19 };
		expect(() =>
			parseProfileCli(["--target", "session-root", "--interval-ms", "50", "--duration-ms", "1000"], lowSampleLimits),
		).toThrow(ProfileLimitError);

		const rows = parsePsSnapshot(psFixture);
		expect(() =>
			buildProcessCapture({
				captureId: "capture-capped",
				sampledAt: "2026-07-26T10:00:01.000Z",
				target: targetPeer,
				peers: [targetPeer, workerPeer],
				rows,
				limits: { ...DEFAULT_PROFILE_LIMITS, maxProcesses: 4 },
			}),
		).toThrow(ProfileLimitError);

		const capture = buildProcessCapture({
			captureId: "capture-output",
			sampledAt: "2026-07-26T10:00:01.000Z",
			target: targetPeer,
			peers: [targetPeer, workerPeer],
			rows,
		});
		const profile: ProcessProfile = {
			schemaVersion: 1,
			captureId: "profile-output",
			startedAt: "2026-07-26T10:00:00.000Z",
			completedAt: "2026-07-26T10:00:01.000Z",
			target: capture.target,
			labels: capture.labels,
			intervalMs: 250,
			durationMs: 1_000,
			captures: [capture],
		};
		expect(() => serializeProcessProfile(profile, 100)).toThrow(ProfileLimitError);
	});

	test("rejects malformed peer and ps boundary data without partial captures", () => {
		expect(() =>
			decodeProfilePeers([
				{
					sessionId: "broken",
					name: "Broken",
					cwd: "/tmp",
					pid: "100",
					lastSeen: "not-a-time",
					state: "working",
				},
			]),
		).toThrow(ProfileBoundaryError);
		expect(() => parsePsSnapshot("100 1 malformed")).toThrow(ProfileBoundaryError);
	});

	test("exposes only a full-host read command and rejects control flags", () => {
		expect(PS_SNAPSHOT_COMMAND).toEqual([
			"/bin/ps",
			"-axo",
			"pid=,ppid=,pgid=,rss=,pcpu=,etime=,command=",
		]);
		expect(() => parseProfileCli(["--target", "session-root", "--apply"])).toThrow(ProfileCliError);
	});
});
