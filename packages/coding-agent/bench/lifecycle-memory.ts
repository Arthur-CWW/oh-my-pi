import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { AgentLifecycleManager } from "../src/registry/agent-lifecycle";
import { AgentRegistry } from "../src/registry/agent-registry";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import { HostResourceAdmission } from "../src/resource/host-resource-admission";
import { readProcessIdentity } from "../src/resource/process-identity";

const CHILD_COUNTS = [1, 100, 300] as const;
const PHASES = ["baseline", "live-idle", "parked-settled", "revived", "reparked"] as const;
const MAX_PARKED_DESCRIPTOR_SLOPE = 0.1;
const IDLE_TTL_MS = 60_000;
const SYNTHETIC_TRANSCRIPT_BYTES = 256 * 1024;

export type LifecycleMemoryPhase = (typeof PHASES)[number];

export interface LifecycleResourceCounts {
	liveSessions: number;
	subscriptions: number;
	timers: number;
}

export interface LifecycleMemorySample {
	childCount: number;
	phase: LifecycleMemoryPhase;
	baselineDescriptors: number;
	descriptors: number;
	heapUsedBytes: number;
	pssBytes: number | null;
	resources: LifecycleResourceCounts;
	rssBytes: number;
}

export interface LifecycleMetricSlope {
	baseline: number;
	perChild: number;
}

export interface LifecycleBenchmarkSummary {
	descriptorDelta: Record<LifecycleMemoryPhase, LifecycleMetricSlope>;
	heapUsedBytes: Record<LifecycleMemoryPhase, LifecycleMetricSlope>;
	pssBytes: Partial<Record<LifecycleMemoryPhase, LifecycleMetricSlope>>;
	rssBytes: Record<LifecycleMemoryPhase, LifecycleMetricSlope>;
}

interface WorkerResult {
	samples: LifecycleMemorySample[];
}

interface BenchmarkOutput {
	benchmark: "cold-park-lifecycle-memory";
	childCounts: readonly number[];
	runtime: { arch: string; bun: string; revision: string; os: string; osRelease: string };
	samples: LifecycleMemorySample[];
	summary: LifecycleBenchmarkSummary;
	fanoutAdmission: FanoutAdmissionSummary;
}

export interface FanoutAdmissionSummary {
	cap: number;
	completed: number;
	peakLiveSessions: number;
	spawns: number;
}
interface ChildHarness {
	id: string;
}

export function parsePssKilobytes(smapsRollup: string): number | null {
	const match = /^Pss:\s+(\d+) kB$/m.exec(smapsRollup);
	return match ? Number(match[1]) : null;
}

function regression(values: readonly { x: number; y: number }[]): LifecycleMetricSlope | null {
	if (values.length === 0) return null;
	let sumX = 0;
	let sumY = 0;
	for (const value of values) {
		sumX += value.x;
		sumY += value.y;
	}
	const meanX = sumX / values.length;
	const meanY = sumY / values.length;
	let covariance = 0;
	let variance = 0;
	for (const value of values) {
		const deltaX = value.x - meanX;
		covariance += deltaX * (value.y - meanY);
		variance += deltaX * deltaX;
	}
	const perChild = variance === 0 ? 0 : covariance / variance;
	return { baseline: meanY - meanX * perChild, perChild };
}

function slope(samples: readonly LifecycleMemorySample[], metric: "heapUsedBytes" | "rssBytes" | "pssBytes"): LifecycleMetricSlope | null {
	return regression(
		samples
			.filter(sample => metric !== "pssBytes" || sample.pssBytes !== null)
			.map(sample => ({ x: sample.childCount, y: sample[metric] as number })),
	);
}

function descriptorSlope(samples: readonly LifecycleMemorySample[]): LifecycleMetricSlope | null {
	return regression(samples.map(sample => ({ x: sample.childCount, y: sample.descriptors - sample.baselineDescriptors })));
}

export function summarizeSamples(samples: readonly LifecycleMemorySample[]): LifecycleBenchmarkSummary {
	const descriptorDelta = {} as Record<LifecycleMemoryPhase, LifecycleMetricSlope>;
	const heapUsedBytes = {} as Record<LifecycleMemoryPhase, LifecycleMetricSlope>;
	const rssBytes = {} as Record<LifecycleMemoryPhase, LifecycleMetricSlope>;
	const pssBytes: Partial<Record<LifecycleMemoryPhase, LifecycleMetricSlope>> = {};
	for (const phase of PHASES) {
		const phaseSamples = samples.filter(sample => sample.phase === phase).sort((a, b) => a.childCount - b.childCount);
		const descriptors = descriptorSlope(phaseSamples);
		const heapUsed = slope(phaseSamples, "heapUsedBytes");
		const rss = slope(phaseSamples, "rssBytes");
		if (!descriptors || !heapUsed || !rss) throw new Error(`Missing benchmark samples for ${phase}`);
		descriptorDelta[phase] = descriptors;
		heapUsedBytes[phase] = heapUsed;
		rssBytes[phase] = rss;
		const pss = slope(phaseSamples, "pssBytes");
		if (pss) pssBytes[phase] = pss;
	}
	return { descriptorDelta, heapUsedBytes, rssBytes, pssBytes };
}

export function assertParkedResources(counts: LifecycleResourceCounts): void {
	if (counts.liveSessions !== 0 || counts.subscriptions !== 0 || counts.timers !== 0) {
		throw new Error(`Parked children retained resources: ${JSON.stringify(counts)}`);
	}
}

export function assertParkedDescriptorSlope(summary: LifecycleBenchmarkSummary): void {
	for (const phase of ["parked-settled", "reparked"] as const) {
		if (summary.descriptorDelta[phase].perChild > MAX_PARKED_DESCRIPTOR_SLOPE) {
			throw new Error(`Parked descriptor delta grows with child count in ${phase}: ${summary.descriptorDelta[phase].perChild}`);
		}
	}
}

async function pssBytes(): Promise<number | null> {
	if (process.platform !== "linux") return null;
	try {
		const kilobytes = parsePssKilobytes(await fs.readFile("/proc/self/smaps_rollup", "utf8"));
		return kilobytes === null ? null : kilobytes * 1024;
	} catch {
		return null;
	}
}

async function descriptorCount(): Promise<number> {
	if (process.platform === "linux" || process.platform === "darwin") {
		try {
			return (await fs.readdir("/dev/fd")).length;
		} catch {
			return 0;
		}
	}
	return 0;
}

async function capture(
	childCount: number,
	phase: LifecycleMemoryPhase,
	baselineDescriptors: number,
	resources: LifecycleResourceCounts,
): Promise<LifecycleMemorySample> {
	const descriptors = await descriptorCount();
	if (phase === "parked-settled" || phase === "reparked") assertParkedResources(resources);
	if (
		(phase === "live-idle" || phase === "revived") &&
		(resources.liveSessions !== childCount || resources.subscriptions !== childCount || resources.timers !== childCount)
	) {
		throw new Error(`Live children did not retain one session, subscription, and timer each: ${JSON.stringify(resources)}`);
	}
	return {
		childCount,
		phase,
		baselineDescriptors,
		descriptors,
		heapUsedBytes: process.memoryUsage().heapUsed,
		pssBytes: await pssBytes(),
		resources,
		rssBytes: process.memoryUsage.rss(),
	};
}

function createSession(sessionManager: SessionManager, modelRegistry: ModelRegistry, seed: string): AgentSession {
	const transcript = Array.from(
		{ length: Math.ceil(SYNTHETIC_TRANSCRIPT_BYTES / 32) },
		(_, index) => `${seed}:${index.toString(36).padStart(6, "0")}:synthetic-row`,
	).join("\n");
	return new AgentSession({
		agent: new Agent({
			initialState: {
				messages: [{ role: "user", content: transcript, timestamp: Date.now() }],
				systemPrompt: ["Lifecycle memory benchmark"],
				tools: [],
			},
		}),
		modelRegistry,
		sessionManager,
		settings: Settings.isolated(),
	});
}

async function settleAfterPark(): Promise<void> {
	await Bun.sleep(0);
	Bun.gc(true);
	await Bun.sleep(0);
	Bun.gc(true);
}

async function runWorker(childCount: number): Promise<WorkerResult> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cold-park-bench-"));
	const authStorage = await AuthStorage.create(path.join(directory, "auth.db"));
	const modelRegistry = new ModelRegistry(authStorage, path.join(directory, "models.yml"));
	const registry = new AgentRegistry();
	const lifecycle = new AgentLifecycleManager(registry);
	const baselineDescriptors = await descriptorCount();
	const samples: LifecycleMemorySample[] = [];
	try {
		samples.push(await capture(childCount, "baseline", baselineDescriptors, lifecycle.resourceCountsForTests()));
		const children: ChildHarness[] = [];
		for (let index = 0; index < childCount; index++) {
			const id = `ColdPark${index}`;
			const sessionManager = SessionManager.create(process.cwd(), path.join(directory, "sessions"));
			const sessionFile = sessionManager.getSessionFile();
			if (!sessionFile) throw new Error("Benchmark child session has no journal path");
			const session = createSession(sessionManager, modelRegistry, `${id}:initial`);
			registry.register({ id, displayName: "task", kind: "sub", session, sessionFile, status: "idle" });
			lifecycle.adopt(id, {
				idleTtlMs: IDLE_TTL_MS,
				sessionSubscription: session.subscribe(() => {}),
				revive: async registerSubscription => {
					const revived = createSession(await SessionManager.open(sessionFile), modelRegistry, `${id}:revived`);
					registerSubscription(revived.subscribe(() => {}));
					return revived;
				},
			});
			children.push({ id });
		}
		samples.push(await capture(childCount, "live-idle", baselineDescriptors, lifecycle.resourceCountsForTests()));
		await Promise.all(children.map(child => lifecycle.park(child.id)));
		await settleAfterPark();
		samples.push(await capture(childCount, "parked-settled", baselineDescriptors, lifecycle.resourceCountsForTests()));
		await Promise.all(children.map(child => lifecycle.ensureLive(child.id)));
		samples.push(await capture(childCount, "revived", baselineDescriptors, lifecycle.resourceCountsForTests()));
		await Promise.all(children.map(child => lifecycle.park(child.id)));
		await settleAfterPark();
		samples.push(await capture(childCount, "reparked", baselineDescriptors, lifecycle.resourceCountsForTests()));
	} finally {
		await lifecycle.dispose();
		authStorage.close();
		await fs.rm(directory, { force: true, recursive: true });
	}
	return { samples };
}

export async function runFanoutAdmissionScenario(spawns = 12, cap = 3): Promise<FanoutAdmissionSummary> {
	const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-bench-admission-"));
	const admission = new HostResourceAdmission({
		dbPath: path.join(dbDir, "admission.sqlite"),
		memoryBudgetBytes: Math.ceil((cap * 100) / 0.94),
		queuePollMs: 1,
	});
	const holderProcess = readProcessIdentity(process.pid);
	if (holderProcess === null) throw new Error("Bench process identity unavailable");
	let liveSessions = 0;
	let peakLiveSessions = 0;
	try {
		const completed = await Promise.all(
			Array.from({ length: spawns }, async (_, index) => {
				const lease = await admission.acquire({
					attemptId: `bench-attempt-${index}`,
					kind: "spawn",
					sessionId: "bench-session",
					sessionOwnerEpoch: null,
					parentAgentId: "bench-parent",
					agentId: `bench-child-${index}`,
					jobId: `bench-job-${index}`,
					holderProcess,
					reservationBytes: 100,
				});
				liveSessions++;
				peakLiveSessions = Math.max(peakLiveSessions, liveSessions);
				try {
					await Promise.resolve();
					return index;
				} finally {
					liveSessions--;
					lease.release();
				}
			}),
		);
		if (peakLiveSessions > cap || completed.length !== spawns) {
			throw new Error(
				`Live-child admission failed: peak=${peakLiveSessions}, cap=${cap}, completed=${completed.length}/${spawns}`,
			);
		}
		return { cap, completed: completed.length, peakLiveSessions, spawns };
	} finally {
		admission.close();
		await fs.rm(dbDir, { recursive: true, force: true });
	}
}

async function runParent(): Promise<BenchmarkOutput> {
	const samples: LifecycleMemorySample[] = [];
	for (const childCount of CHILD_COUNTS) {
		const subprocess = Bun.spawn({
			cmd: [process.execPath, import.meta.path, "--worker", String(childCount)],
			stderr: "pipe",
			stdout: "pipe",
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stdout).text(),
			new Response(subprocess.stderr).text(),
		]);
		if (exitCode !== 0) {
			process.stderr.write(stderr);
			throw new Error(`Lifecycle benchmark worker for N=${childCount} exited ${exitCode}`);
		}
		const result = JSON.parse(stdout) as WorkerResult;
		samples.push(...result.samples);
	}
	const summary = summarizeSamples(samples);
	assertParkedDescriptorSlope(summary);
	const fanoutAdmission = await runFanoutAdmissionScenario();
	return {
		benchmark: "cold-park-lifecycle-memory",
		childCounts: CHILD_COUNTS,
		runtime: {
			arch: process.arch,
			bun: Bun.version,
			revision: Bun.revision ?? "unknown",
			os: process.platform,
			osRelease: os.release(),
		},
		samples,
		fanoutAdmission,
		summary,
	};
}

if (import.meta.main) {
	const workerIndex = process.argv.indexOf("--worker");
	if (workerIndex >= 0) {
		const childCount = Number(process.argv[workerIndex + 1]);
		if (!CHILD_COUNTS.includes(childCount as (typeof CHILD_COUNTS)[number])) {
			throw new Error(`Worker child count must be one of: ${CHILD_COUNTS.join(", ")}`);
		}
		process.stdout.write(`${JSON.stringify(await runWorker(childCount))}\n`);
	} else {
		process.stdout.write(`${JSON.stringify(await runParent())}\n`);
	}
}
