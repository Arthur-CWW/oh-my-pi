import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "bun:test";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import {
	appendChildLifecycleRecord,
	appendChildRestartRecord,
	CHILD_LIFECYCLE_CUSTOM_TYPE,
	CHILD_RESTART_CUSTOM_TYPE,
	classifyChildResumeEvidence,
	decodeChildRestartEntry,
	latestChildLifecycleRecord,
	latestChildRestartRecord,
	transitionChildLifecycleRecord,
	type ChildResumeClassification,
	type ChildResumeEvidence,
	type ChildLifecycleRecord,
	type ChildLifecycleState,
	type ChildRestartRecord,
} from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";
import * as fc from "fast-check";

const WORKER_ENV = "OMP_LIFECYCLE_MODEL_WORKER";
const RECEIPT_ENV = "OMP_LIFECYCLE_MODEL_RECEIPT";
const MODEL_ROOT_ENV = "OMP_LIFECYCLE_MODEL_ROOT";
const NEGATIVE_CONTROL_ENV = "OMP_LIFECYCLE_MODEL_NEGATIVE_CONTROL";
const FIXED_SEED = 0x5eed2026;
const DEFAULT_RUNS_PER_SEED = 24;
const MAX_COMMANDS = 18;
const SOURCE_DIGEST_ALGORITHM = "sha256-framed-v1";
const PRECEDENCE_JOURNALS = ["missing", "corrupt", "completed", "failed", "interrupted"] as const;
const PRECEDENCE_PARENT_FAILURES = [
	undefined,
	"timeout",
	"subprocess-abort",
	"host-resource",
	"lost-transcript",
	"unclassified",
] as const;
const INITIAL_UPDATED_AT = "2020-01-01T00:00:00.000Z";
const REQUIRED_COMMAND_PREFIX = [
	"transition(waiting-provider)",
	"transition(parked)",
	"revive-journal-transition(idle)",
	"resume-precedence-matrix",
] as const;

interface LifecycleModel {
	state: ChildLifecycleState;
	failureClass: ModelFailureClass | undefined;
	resumeDisposition: ModelResumeDisposition | undefined;
	lifecycleCorrupt: boolean;
	restart: ChildRestartRecord | undefined;
	restartCorrupt: boolean;
	entryCount: number;
}

interface CommandCounters {
	cases: number;
	commandExecutions: number;
	reopens: number;
	restarts: number;
	outOfOrderRestarts: number;
	revives: number;
	resumeEvidence: number;
	corruptTransitionAttempts: number;
	malformedLifecycle: number;
	malformedRestart: number;
	terminalNoops: number;
	negativeControlApplications: number;
	precedenceMatrixCases: number;
	precedenceMatrixAssertions: number;
	precedenceJournals: Record<PrecedenceJournal, number>;
	failureClasses: Record<ModelFailureClass | "none", number>;
	resumeOutcomes: Record<ModelResumeOutcome, number>;
	transitions: Record<ChildLifecycleState, number>;
}

interface RealLifecycle {
	manager: SessionManager;
	readonly root: string;
	readonly sessionFile: string;
	readonly sessionDir: string;
	readonly agentId: string;
	readonly parentSessionFile: string;
	restartClockMs: number;
	readonly negativeControl: NegativeControl | undefined;
	negativeControlApplied: boolean;
	readonly counters: CommandCounters;
}

interface PrecedenceJournalFixture {
	manager: SessionManager;
	readonly root: string;
	readonly sessionFile: string;
	readonly sessionDir: string;
}

interface SeedRunReceipt {
	seed: number;
	path: string | null;
	cases: number;
	skips: number;
	shrinks: number;
	commandsExecuted: number;
	reopens: number;
	restarts: number;
	outOfOrderRestarts: number;
	revives: number;
	resumeEvidence: number;
	corruptTransitionAttempts: number;
	malformedLifecycle: number;
	malformedRestart: number;
	terminalNoops: number;
	negativeControlApplications: number;
	precedenceMatrixCases: number;
	precedenceMatrixAssertions: number;
	precedenceJournals: Record<PrecedenceJournal, number>;
	failureClasses: Record<ModelFailureClass | "none", number>;
	resumeOutcomes: Record<ModelResumeOutcome, number>;
	transitions: Record<ChildLifecycleState, number>;
	minimizedTrace: string[] | null;
}

type ModelFailureClass = "wall_timeout" | "subprocess_abort" | "transient_host_resource" | "lost_transcript" | "fatal";
type ModelResumeDisposition = "resumable" | "unrecoverable";
type ModelResumeOutcome = ModelFailureClass | "completed" | "isolated" | "live_owner" | "unusable_journal";
type ParentFailureClass = "timeout" | "subprocess-abort" | "host-resource" | "lost-transcript" | "unclassified";
type NegativeControl = "terminal-predicate" | "restart-max-timestamp" | "journal-usability-precedence";
type PrecedenceJournal = (typeof PRECEDENCE_JOURNALS)[number];

interface SourceInputReceipt {
	path: string;
	bytes: number;
	sha256: string;
}

interface SourceReceipt {
	algorithm: typeof SOURCE_DIGEST_ALGORITHM;
	digest: string;
	inputs: SourceInputReceipt[];
	commitBinding: "excluded-self-reference";
}

interface ExpectedResume {
	outcome: ModelResumeOutcome;
	disposition: ModelResumeDisposition;
}

interface ResumeProbe {
	liveOwner: boolean;
	isolated: boolean;
	parentFailureClass: ParentFailureClass | undefined;
}

type MalformedLifecycleKind = "primitive" | "version" | "state" | "timestamp";
type MalformedRestartKind = "primitive" | "version" | "status" | "attempt";
function isModelTerminalState(state: ChildLifecycleState): boolean {
	switch (state) {
		case "completed":
		case "failed":
		case "interrupted":
			return true;
		case "running":
		case "waiting-provider":
		case "idle":
		case "parked":
			return false;
	}
}

function parentFailureOutcome(parentFailureClass: ParentFailureClass | undefined): ModelFailureClass | undefined {
	switch (parentFailureClass) {
		case "timeout":
			return "wall_timeout";
		case "subprocess-abort":
			return "subprocess_abort";
		case "host-resource":
			return "transient_host_resource";
		case "lost-transcript":
			return "lost_transcript";
		case "unclassified":
		case undefined:
			return undefined;
	}
}

function expectedResume(model: Readonly<LifecycleModel>, probe: Readonly<ResumeProbe>): ExpectedResume {
	if (probe.liveOwner) return { outcome: "live_owner", disposition: "unrecoverable" };
	if (probe.isolated) return { outcome: "isolated", disposition: "unrecoverable" };
	if (model.lifecycleCorrupt) return { outcome: "unusable_journal", disposition: "unrecoverable" };
	if (model.state === "completed") return { outcome: "completed", disposition: "unrecoverable" };
	if (model.resumeDisposition === "unrecoverable" || model.failureClass === "fatal") {
		return { outcome: "fatal", disposition: "unrecoverable" };
	}
	const failureClass = model.failureClass ?? parentFailureOutcome(probe.parentFailureClass);
	if (failureClass) return { outcome: failureClass, disposition: "resumable" };
	switch (model.state) {
		case "failed":
			return { outcome: "fatal", disposition: "unrecoverable" };
		case "running":
			return { outcome: "lost_transcript", disposition: "resumable" };
		case "waiting-provider":
		case "idle":
		case "parked":
		case "interrupted":
			return { outcome: "subprocess_abort", disposition: "resumable" };
	}
}

function expectedPrecedenceResume(journal: PrecedenceJournal, probe: Readonly<ResumeProbe>): ExpectedResume {
	if (probe.liveOwner) return { outcome: "live_owner", disposition: "unrecoverable" };
	if (probe.isolated) return { outcome: "isolated", disposition: "unrecoverable" };
	switch (journal) {
		case "missing":
			return { outcome: "lost_transcript", disposition: "unrecoverable" };
		case "corrupt":
			return { outcome: "unusable_journal", disposition: "unrecoverable" };
		case "completed":
			return { outcome: "completed", disposition: "unrecoverable" };
		case "failed": {
			const failureClass = parentFailureOutcome(probe.parentFailureClass);
			return failureClass
				? { outcome: failureClass, disposition: "resumable" }
				: { outcome: "fatal", disposition: "unrecoverable" };
		}
		case "interrupted": {
			const failureClass = parentFailureOutcome(probe.parentFailureClass);
			return {
				outcome: failureClass ?? "subprocess_abort",
				disposition: "resumable",
			};
		}
	}
}

function observedResume(real: RealLifecycle, evidence: ChildResumeEvidence): ChildResumeClassification {
	if (real.negativeControl === "journal-usability-precedence" && evidence.journal !== "usable") {
		if (!real.negativeControlApplied) {
			real.negativeControlApplied = true;
			real.counters.negativeControlApplications++;
		}
		return classifyChildResumeEvidence({ ...evidence, liveOwner: false, isolated: false });
	}
	return classifyChildResumeEvidence(evidence);
}

function expectMonotonicEntryTimestamps(manager: SessionManager): void {
	let previous = Number.NEGATIVE_INFINITY;
	for (const entry of manager.getEntries()) {
		const current = Date.parse(entry.timestamp);
		expect(Number.isFinite(current)).toBe(true);
		expect(current).toBeGreaterThanOrEqual(previous);
		previous = current;
	}
}

function expectLifecycleUpdatedAtMonotonic(manager: SessionManager): void {
	let previous = Number.NEGATIVE_INFINITY;
	for (const entry of manager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== CHILD_LIFECYCLE_CUSTOM_TYPE) continue;
		const data = entry.data;
		if (typeof data !== "object" || data === null || !("updatedAt" in data)) continue;
		const updatedAt = data.updatedAt;
		if (typeof updatedAt !== "string") continue;
		const current = Date.parse(updatedAt);
		if (!Number.isFinite(current)) continue;
		expect(current).toBeGreaterThanOrEqual(previous);
		previous = current;
	}
}

function observedLatestRestart(real: RealLifecycle): ChildRestartRecord | undefined | null {
	const entries = real.manager.getEntries();
	if (real.negativeControl !== "restart-max-timestamp") return latestChildRestartRecord(entries);
	let appendLatest: ChildRestartRecord | undefined;
	let timestampLatest: ChildRestartRecord | undefined;
	for (const entry of entries) {
		const decoded = decodeChildRestartEntry(entry);
		if (decoded.kind === "invalid") return null;
		if (decoded.kind !== "valid") continue;
		appendLatest = decoded.record;
		if (!timestampLatest || Date.parse(decoded.record.updatedAt) >= Date.parse(timestampLatest.updatedAt)) {
			timestampLatest = decoded.record;
		}
	}
	if (
		appendLatest &&
		timestampLatest &&
		appendLatest.updatedAt !== timestampLatest.updatedAt &&
		!real.negativeControlApplied
	) {
		real.negativeControlApplied = true;
		real.counters.negativeControlApplications++;
	}
	return timestampLatest;
}

function expectModel(
	model: Readonly<LifecycleModel>,
	real: RealLifecycle,
	probe: Readonly<ResumeProbe> = { liveOwner: false, isolated: false, parentFailureClass: undefined },
): void {
	const entries = real.manager.getEntries();
	expect(entries).toHaveLength(model.entryCount);
	expectMonotonicEntryTimestamps(real.manager);
	expectLifecycleUpdatedAtMonotonic(real.manager);

	const lifecycle = latestChildLifecycleRecord(entries);
	if (model.lifecycleCorrupt) {
		expect(lifecycle).toBeNull();
	} else {
		expect(lifecycle).toBeDefined();
		expect(lifecycle).not.toBeNull();
		if (!lifecycle) throw new Error("Expected a valid lifecycle record");
		expect(lifecycle.state).toBe(model.state);
		expect(lifecycle.failureClass).toBe(model.failureClass);
		expect(lifecycle.resumeDisposition).toBe(model.resumeDisposition);
		expect(lifecycle.agentId).toBe(real.agentId);
		expect(lifecycle.childSessionFile).toBe(real.sessionFile);
		expect(lifecycle.parentSessionFile).toBe(real.parentSessionFile);
		const lastLifecycleEntry = entries.findLast(
			entry => entry.type === "custom" && entry.customType === CHILD_LIFECYCLE_CUSTOM_TYPE,
		);
		expect(lastLifecycleEntry?.type).toBe("custom");
		if (lastLifecycleEntry?.type !== "custom") throw new Error("Expected a lifecycle custom entry");
		expect(lastLifecycleEntry.data).toEqual(lifecycle);
	}

	const restart = observedLatestRestart(real);
	if (model.restartCorrupt) expect(restart).toBeNull();
	else expect(restart).toEqual(model.restart);

	const resume = classifyChildResumeEvidence({
		journal: model.lifecycleCorrupt ? "corrupt" : "usable",
		...(lifecycle && !model.lifecycleCorrupt ? { lifecycle } : {}),
		liveOwner: probe.liveOwner,
		isolated: probe.isolated,
		...(probe.parentFailureClass === undefined ? {} : { parentFailureClass: probe.parentFailureClass }),
	});
	expect({ outcome: resume.outcome, disposition: resume.disposition }).toEqual(expectedResume(model, probe));
}

async function reopenJournal(real: RealLifecycle): Promise<void> {
	await real.manager.close();
	real.manager = await SessionManager.open(real.sessionFile, real.sessionDir, undefined, {
		initialCwd: real.root,
		suppressBreadcrumb: true,
	});
	real.counters.reopens++;
}

async function checkpoint(
	model: Readonly<LifecycleModel>,
	real: RealLifecycle,
	probe: Readonly<ResumeProbe> = { liveOwner: false, isolated: false, parentFailureClass: undefined },
): Promise<void> {
	expectModel(model, real, probe);
	await reopenJournal(real);
	expectModel(model, real, probe);
}

async function createPrecedenceJournal(
	real: RealLifecycle,
	journal: PrecedenceJournal,
): Promise<PrecedenceJournalFixture> {
	const root = await fs.mkdtemp(path.join(real.root, `precedence-${journal}-`));
	const sessionDir = path.join(root, "sessions");
	await fs.mkdir(sessionDir, { recursive: true });
	const manager = SessionManager.create(root, sessionDir);
	const sessionFile = manager.getSessionFile();
	if (!sessionFile) throw new Error("Expected a persistent precedence journal");
	if (journal === "corrupt") {
		manager.appendCustomEntry(CHILD_LIFECYCLE_CUSTOM_TYPE, { version: 2, state: "corrupt" });
	} else if (journal !== "missing") {
		appendChildLifecycleRecord(manager, {
			version: 1,
			agentId: real.agentId,
			childSessionFile: sessionFile,
			parentSessionFile: real.parentSessionFile,
			state: journal,
			updatedAt: INITIAL_UPDATED_AT,
		});
	}
	await manager.ensureOnDisk();
	return { manager, root, sessionFile, sessionDir };
}

function precedenceEvidence(fixture: PrecedenceJournalFixture, probe: Readonly<ResumeProbe>): ChildResumeEvidence {
	const lifecycle = latestChildLifecycleRecord(fixture.manager.getEntries());
	const journal = lifecycle === undefined ? "missing" : lifecycle === null ? "corrupt" : "usable";
	return {
		journal,
		...(lifecycle ? { lifecycle } : {}),
		liveOwner: probe.liveOwner,
		isolated: probe.isolated,
		...(probe.parentFailureClass === undefined ? {} : { parentFailureClass: probe.parentFailureClass }),
	};
}

function assertPrecedenceProbe(
	real: RealLifecycle,
	fixture: PrecedenceJournalFixture,
	journal: PrecedenceJournal,
	probe: Readonly<ResumeProbe>,
): void {
	const evidence = precedenceEvidence(fixture, probe);
	expect(evidence.journal).toBe(journal === "missing" || journal === "corrupt" ? journal : "usable");
	const observed = observedResume(real, evidence);
	expect({ outcome: observed.outcome, disposition: observed.disposition }).toEqual(
		expectedPrecedenceResume(journal, probe),
	);
	real.counters.precedenceMatrixAssertions++;
}

async function runPrecedenceJournal(real: RealLifecycle, journal: PrecedenceJournal): Promise<void> {
	const fixture = await createPrecedenceJournal(real, journal);
	try {
		for (const liveOwner of [false, true]) {
			for (const isolated of [false, true]) {
				for (const parentFailureClass of PRECEDENCE_PARENT_FAILURES) {
					const probe = { liveOwner, isolated, parentFailureClass };
					real.counters.precedenceMatrixCases++;
					real.counters.precedenceJournals[journal]++;
					const expected = expectedPrecedenceResume(journal, probe);
					real.counters.resumeOutcomes[expected.outcome]++;
					assertPrecedenceProbe(real, fixture, journal, probe);
				}
			}
		}
		await fixture.manager.close();
		fixture.manager = await SessionManager.open(fixture.sessionFile, fixture.sessionDir, undefined, {
			initialCwd: fixture.root,
			suppressBreadcrumb: true,
		});
		real.counters.reopens++;
		for (const liveOwner of [false, true]) {
			for (const isolated of [false, true]) {
				for (const parentFailureClass of PRECEDENCE_PARENT_FAILURES) {
					assertPrecedenceProbe(real, fixture, journal, { liveOwner, isolated, parentFailureClass });
				}
			}
		}
	} finally {
		await fixture.manager.close();
	}
}

class ResumePrecedenceMatrixCommand implements fc.AsyncCommand<LifecycleModel, RealLifecycle> {
	check(): boolean {
		return true;
	}

	async run(_model: LifecycleModel, real: RealLifecycle): Promise<void> {
		real.counters.commandExecutions++;
		for (const journal of PRECEDENCE_JOURNALS) await runPrecedenceJournal(real, journal);
	}

	toString(): string {
		return "resume-precedence-matrix";
	}
}

function applyTransition(real: RealLifecycle, state: ChildLifecycleState): void {
	transitionChildLifecycleRecord(real.manager, state);
}

function attemptTerminalTransition(
	real: RealLifecycle,
	state: "running" | "waiting-provider" | "idle" | "parked",
): void {
	if (real.negativeControl !== "terminal-predicate") {
		transitionChildLifecycleRecord(real.manager, state);
		return;
	}
	const current = latestChildLifecycleRecord(real.manager.getEntries());
	if (!current) throw new Error("Terminal predicate mutant requires a valid lifecycle record");
	appendChildLifecycleRecord(real.manager, { ...current, state, updatedAt: new Date().toISOString() });
	if (!real.negativeControlApplied) {
		real.negativeControlApplied = true;
		real.counters.negativeControlApplications++;
	}
}

class TransitionCommand implements fc.AsyncCommand<LifecycleModel, RealLifecycle> {
	constructor(
		readonly target: ChildLifecycleState,
		readonly label = "transition",
	) {}

	check(model: Readonly<LifecycleModel>): boolean {
		return !model.lifecycleCorrupt && !isModelTerminalState(model.state) && model.state !== this.target;
	}

	async run(model: LifecycleModel, real: RealLifecycle): Promise<void> {
		const before = latestChildLifecycleRecord(real.manager.getEntries());
		applyTransition(real, this.target);
		model.state = this.target;
		model.entryCount++;
		real.counters.commandExecutions++;
		real.counters.transitions[this.target]++;
		const after = latestChildLifecycleRecord(real.manager.getEntries());
		if (before && after) {
			expect(Date.parse(after.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before.updatedAt));
		}
		await checkpoint(model, real);
	}

	toString(): string {
		return `${this.label}(${this.target})`;
	}
}

class ReviveCommand extends TransitionCommand {
	constructor() {
		super("idle", "revive-journal-transition");
	}

	override check(model: Readonly<LifecycleModel>): boolean {
		return !model.lifecycleCorrupt && model.state === "parked";
	}

	override async run(model: LifecycleModel, real: RealLifecycle): Promise<void> {
		await super.run(model, real);
		real.counters.revives++;
	}
}

class TerminalNoopCommand implements fc.AsyncCommand<LifecycleModel, RealLifecycle> {
	constructor(readonly target: "running" | "waiting-provider" | "idle" | "parked") {}

	check(model: Readonly<LifecycleModel>): boolean {
		return !model.lifecycleCorrupt && isModelTerminalState(model.state);
	}

	async run(model: LifecycleModel, real: RealLifecycle): Promise<void> {
		const before = latestChildLifecycleRecord(real.manager.getEntries());
		const entryCount = real.manager.getEntries().length;
		attemptTerminalTransition(real, this.target);
		real.counters.commandExecutions++;
		real.counters.terminalNoops++;
		expect(real.manager.getEntries()).toHaveLength(entryCount);
		expect(latestChildLifecycleRecord(real.manager.getEntries())).toEqual(before);
		await checkpoint(model, real);
	}

	toString(): string {
		return `terminal-noop(${this.target})`;
	}
}
class TerminalImmutabilityCommand implements fc.AsyncCommand<LifecycleModel, RealLifecycle> {
	constructor(
		readonly terminal: "completed" | "failed" | "interrupted",
		readonly target: "running" | "waiting-provider" | "idle" | "parked",
	) {}

	check(model: Readonly<LifecycleModel>): boolean {
		return !model.lifecycleCorrupt && !isModelTerminalState(model.state);
	}

	async run(model: LifecycleModel, real: RealLifecycle): Promise<void> {
		await new TransitionCommand(this.terminal, "terminal-setup").run(model, real);
		await new TerminalNoopCommand(this.target).run(model, real);
	}

	toString(): string {
		return `terminal-immutability(${this.terminal}->${this.target})`;
	}
}

class ResumeEvidenceCommand implements fc.AsyncCommand<LifecycleModel, RealLifecycle> {
	constructor(
		readonly failureClass: ModelFailureClass | undefined,
		readonly resumeDisposition: ModelResumeDisposition | undefined,
		readonly probe: ResumeProbe,
	) {}

	check(model: Readonly<LifecycleModel>): boolean {
		return !model.lifecycleCorrupt && !isModelTerminalState(model.state);
	}

	async run(model: LifecycleModel, real: RealLifecycle): Promise<void> {
		const current = latestChildLifecycleRecord(real.manager.getEntries());
		if (!current) throw new Error("Resume evidence command requires a valid lifecycle record");
		const record: ChildLifecycleRecord = {
			version: 1,
			agentId: current.agentId,
			childSessionFile: current.childSessionFile,
			parentSessionFile: current.parentSessionFile,
			state: model.state,
			updatedAt: new Date().toISOString(),
			...(current.modelId === undefined ? {} : { modelId: current.modelId }),
			...(current.thinkingLevel === undefined ? {} : { thinkingLevel: current.thinkingLevel }),
			...(this.failureClass === undefined ? {} : { failureClass: this.failureClass }),
			...(this.resumeDisposition === undefined ? {} : { resumeDisposition: this.resumeDisposition }),
		};
		appendChildLifecycleRecord(real.manager, record);
		model.failureClass = this.failureClass;
		model.resumeDisposition = this.resumeDisposition;
		model.entryCount++;
		real.counters.commandExecutions++;
		real.counters.resumeEvidence++;
		real.counters.failureClasses[this.failureClass ?? "none"]++;
		const expected = expectedResume(model, this.probe);
		real.counters.resumeOutcomes[expected.outcome]++;
		await checkpoint(model, real, this.probe);
	}

	toString(): string {
		return `resume-evidence(failure=${this.failureClass ?? "none"},disposition=${this.resumeDisposition ?? "none"},owner=${this.probe.liveOwner},isolated=${this.probe.isolated},parent=${this.probe.parentFailureClass ?? "none"})`;
	}
}

function restartRecord(
	real: Readonly<RealLifecycle>,
	state: "running" | "parked",
	status: "pending" | "resuming" | "resumed",
	hasQueueCheckpoint: boolean,
	timestampMs: number,
): ChildRestartRecord {
	return {
		version: 1,
		agentId: real.agentId,
		predecessorOwnerEpoch: "owner-epoch-1",
		state,
		queueCheckpoint: hasQueueCheckpoint ? `queue-${timestampMs}` : null,
		status,
		...(status === "resuming" ? { attemptId: `attempt-${timestampMs}` } : {}),
		updatedAt: new Date(timestampMs).toISOString(),
	};
}

class RestartCheckpointCommand implements fc.AsyncCommand<LifecycleModel, RealLifecycle> {
	constructor(
		readonly state: "running" | "parked",
		readonly status: "pending" | "resuming" | "resumed",
		readonly hasQueueCheckpoint: boolean,
	) {}

	check(model: Readonly<LifecycleModel>): boolean {
		return !model.restartCorrupt;
	}

	async run(model: LifecycleModel, real: RealLifecycle): Promise<void> {
		real.restartClockMs++;
		const record = restartRecord(real, this.state, this.status, this.hasQueueCheckpoint, real.restartClockMs);
		appendChildRestartRecord(real.manager, record);
		model.restart = record;
		model.entryCount++;
		real.counters.commandExecutions++;
		real.counters.restarts++;
		await checkpoint(model, real);
	}

	toString(): string {
		return `restart(${this.state},${this.status},queue=${this.hasQueueCheckpoint})`;
	}
}

class OutOfOrderRestartCommand implements fc.AsyncCommand<LifecycleModel, RealLifecycle> {
	constructor(
		readonly firstState: "running" | "parked",
		readonly secondState: "running" | "parked",
		readonly firstStatus: "pending" | "resuming" | "resumed",
		readonly secondStatus: "pending" | "resuming" | "resumed",
	) {}

	check(model: Readonly<LifecycleModel>): boolean {
		return !model.restartCorrupt;
	}

	async run(model: LifecycleModel, real: RealLifecycle): Promise<void> {
		const earlierMs = real.restartClockMs + 1;
		const laterMs = real.restartClockMs + 2;
		real.restartClockMs = laterMs;
		const first = restartRecord(real, this.firstState, this.firstStatus, true, laterMs);
		const second = restartRecord(real, this.secondState, this.secondStatus, false, earlierMs);
		appendChildRestartRecord(real.manager, first);
		appendChildRestartRecord(real.manager, second);
		model.restart = second;
		model.entryCount += 2;
		real.counters.commandExecutions++;
		real.counters.restarts += 2;
		real.counters.outOfOrderRestarts++;
		await checkpoint(model, real);
	}

	toString(): string {
		return `restart-out-of-order(${this.firstState}/${this.firstStatus}@later,${this.secondState}/${this.secondStatus}@earlier)`;
	}
}

function malformedLifecycleData(kind: MalformedLifecycleKind, real: Readonly<RealLifecycle>): object | string {
	const base = {
		version: 1,
		agentId: real.agentId,
		childSessionFile: real.sessionFile,
		parentSessionFile: real.parentSessionFile,
		state: "idle",
		updatedAt: new Date().toISOString(),
	};
	switch (kind) {
		case "primitive":
			return "not-a-record";
		case "version":
			return { ...base, version: 2 };
		case "state":
			return { ...base, state: "unknown" };
		case "timestamp":
			return { ...base, updatedAt: "not-a-date" };
	}
}

class MalformedLifecycleCommand implements fc.AsyncCommand<LifecycleModel, RealLifecycle> {
	constructor(
		readonly kind: MalformedLifecycleKind,
		readonly postCorruptionTarget: ChildLifecycleState,
	) {}

	check(model: Readonly<LifecycleModel>): boolean {
		return !model.lifecycleCorrupt;
	}

	async run(model: LifecycleModel, real: RealLifecycle): Promise<void> {
		real.manager.appendCustomEntry(CHILD_LIFECYCLE_CUSTOM_TYPE, malformedLifecycleData(this.kind, real));
		model.lifecycleCorrupt = true;
		model.entryCount++;
		real.counters.commandExecutions++;
		real.counters.malformedLifecycle++;
		const beforeAttempt = real.manager.getEntries().length;
		expect(latestChildLifecycleRecord(real.manager.getEntries())).toBeNull();
		transitionChildLifecycleRecord(real.manager, this.postCorruptionTarget);
		real.counters.corruptTransitionAttempts++;
		expect(real.manager.getEntries()).toHaveLength(beforeAttempt);
		expect(latestChildLifecycleRecord(real.manager.getEntries())).toBeNull();
		await checkpoint(model, real);
		const reopenedEntryCount = real.manager.getEntries().length;
		transitionChildLifecycleRecord(real.manager, this.postCorruptionTarget);
		real.counters.corruptTransitionAttempts++;
		expect(real.manager.getEntries()).toHaveLength(reopenedEntryCount);
		expect(latestChildLifecycleRecord(real.manager.getEntries())).toBeNull();
		expectModel(model, real);
	}

	toString(): string {
		return `malformed-lifecycle(${this.kind})->blocked-transition(${this.postCorruptionTarget})`;
	}
}

function malformedRestartData(kind: MalformedRestartKind, real: Readonly<RealLifecycle>): object | number {
	const base = {
		version: 1,
		agentId: real.agentId,
		predecessorOwnerEpoch: "owner-epoch-1",
		state: "running",
		queueCheckpoint: null,
		status: "pending",
		updatedAt: INITIAL_UPDATED_AT,
	};
	switch (kind) {
		case "primitive":
			return 7;
		case "version":
			return { ...base, version: 2 };
		case "status":
			return { ...base, status: "unknown" };
		case "attempt":
			return { ...base, status: "resuming" };
	}
}

class MalformedRestartCommand implements fc.AsyncCommand<LifecycleModel, RealLifecycle> {
	constructor(readonly kind: MalformedRestartKind) {}

	check(model: Readonly<LifecycleModel>): boolean {
		return !model.restartCorrupt;
	}

	async run(model: LifecycleModel, real: RealLifecycle): Promise<void> {
		real.manager.appendCustomEntry(CHILD_RESTART_CUSTOM_TYPE, malformedRestartData(this.kind, real));
		model.restartCorrupt = true;
		model.entryCount++;
		real.counters.commandExecutions++;
		real.counters.malformedRestart++;
		await checkpoint(model, real);
	}

	toString(): string {
		return `malformed-restart(${this.kind})`;
	}
}

class ReopenCommand implements fc.AsyncCommand<LifecycleModel, RealLifecycle> {
	check(): boolean {
		return true;
	}

	async run(model: LifecycleModel, real: RealLifecycle): Promise<void> {
		real.counters.commandExecutions++;
		await checkpoint(model, real);
	}

	toString(): string {
		return "reopen";
	}
}

const terminalImmutabilityArbitrary = fc
	.record({
		terminal: fc.constantFrom<"completed" | "failed" | "interrupted">("completed", "failed", "interrupted"),
		target: fc.constantFrom<"running" | "waiting-provider" | "idle" | "parked">(
			"running",
			"waiting-provider",
			"idle",
			"parked",
		),
	})
	.map(({ terminal, target }) => new TerminalImmutabilityCommand(terminal, target));

const outOfOrderRestartArbitrary = fc
	.record({
		firstState: fc.constantFrom<"running" | "parked">("running", "parked"),
		secondState: fc.constantFrom<"running" | "parked">("running", "parked"),
		firstStatus: fc.constantFrom<"pending" | "resuming" | "resumed">("pending", "resuming", "resumed"),
		secondStatus: fc.constantFrom<"pending" | "resuming" | "resumed">("pending", "resuming", "resumed"),
	})
	.map(
		({ firstState, secondState, firstStatus, secondStatus }) =>
			new OutOfOrderRestartCommand(firstState, secondState, firstStatus, secondStatus),
	);

const resumeEvidenceArbitrary = fc
	.record({
		failureClass: fc.constantFrom<ModelFailureClass | undefined>(
			undefined,
			"wall_timeout",
			"subprocess_abort",
			"transient_host_resource",
			"lost_transcript",
			"fatal",
		),
		resumeDisposition: fc.constantFrom<ModelResumeDisposition | undefined>(undefined, "resumable", "unrecoverable"),
		liveOwner: fc.boolean(),
		isolated: fc.boolean(),
		parentFailureClass: fc.constantFrom<ParentFailureClass | undefined>(
			undefined,
			"timeout",
			"subprocess-abort",
			"host-resource",
			"lost-transcript",
			"unclassified",
		),
	})
	.map(
		({ failureClass, resumeDisposition, liveOwner, isolated, parentFailureClass }) =>
			new ResumeEvidenceCommand(failureClass, resumeDisposition, {
				liveOwner,
				isolated,
				parentFailureClass,
			}),
	);

const allCommandArbitraries: fc.Arbitrary<fc.AsyncCommand<LifecycleModel, RealLifecycle>>[] = [
	fc
		.constantFrom<ChildLifecycleState>(
			"running",
			"waiting-provider",
			"idle",
			"parked",
			"completed",
			"failed",
			"interrupted",
		)
		.map(state => new TransitionCommand(state)),
	fc.constant(new ReviveCommand()),
	fc
		.constantFrom<"running" | "waiting-provider" | "idle" | "parked">("running", "waiting-provider", "idle", "parked")
		.map(state => new TerminalNoopCommand(state)),
	terminalImmutabilityArbitrary,
	resumeEvidenceArbitrary,
	resumeEvidenceArbitrary,
	resumeEvidenceArbitrary,
	fc
		.record({
			state: fc.constantFrom<"running" | "parked">("running", "parked"),
			status: fc.constantFrom<"pending" | "resuming" | "resumed">("pending", "resuming", "resumed"),
			hasQueueCheckpoint: fc.boolean(),
		})
		.map(({ state, status, hasQueueCheckpoint }) => new RestartCheckpointCommand(state, status, hasQueueCheckpoint)),
	outOfOrderRestartArbitrary,
	fc
		.record({
			kind: fc.constantFrom<MalformedLifecycleKind>("primitive", "version", "state", "timestamp"),
			target: fc.constantFrom<ChildLifecycleState>(
				"running",
				"waiting-provider",
				"idle",
				"parked",
				"completed",
				"failed",
				"interrupted",
			),
		})
		.map(({ kind, target }) => new MalformedLifecycleCommand(kind, target)),
	fc
		.constantFrom<MalformedRestartKind>("primitive", "version", "status", "attempt")
		.map(kind => new MalformedRestartCommand(kind)),
	fc.constant(new ReopenCommand()),
];

function commandArbitrariesFor(
	negativeControl: NegativeControl | undefined,
): fc.Arbitrary<fc.AsyncCommand<LifecycleModel, RealLifecycle>>[] {
	switch (negativeControl) {
		case "terminal-predicate":
			return [terminalImmutabilityArbitrary];
		case "restart-max-timestamp":
			return [outOfOrderRestartArbitrary];
		case "journal-usability-precedence":
			return [fc.constant(new ReopenCommand())];
		case undefined:
			return allCommandArbitraries;
	}
}

function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Child lifecycle model worker requires ${name}`);
	return path.resolve(value);
}

function expectContained(root: string, candidate: string): void {
	const relative = path.relative(root, candidate);
	expect(relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))).toBe(true);
}

function parseNegativeControl(): NegativeControl | undefined {
	const configured = process.env[NEGATIVE_CONTROL_ENV];
	switch (configured) {
		case undefined:
			return undefined;
		case "terminal-predicate":
		case "restart-max-timestamp":
		case "journal-usability-precedence":
			return configured;
		default:
			throw new Error(
				`${NEGATIVE_CONTROL_ENV} must be terminal-predicate, restart-max-timestamp, or journal-usability-precedence; received ${configured}`,
			);
	}
}

function parseSeeds(): number[] {
	const configured = process.env.OMP_LIFECYCLE_MODEL_SEEDS;
	if (configured) {
		const seeds = configured.split(",").map(value => Number.parseInt(value, 10));
		if (seeds.length === 0 || seeds.some(seed => !Number.isInteger(seed))) {
			throw new Error("OMP_LIFECYCLE_MODEL_SEEDS must contain comma-separated integer seeds");
		}
		return seeds;
	}
	const generated = new Int32Array(2);
	crypto.getRandomValues(generated);
	return [FIXED_SEED, ...generated];
}

function runSummary(
	seed: number,
	details: fc.RunDetails<[Iterable<fc.AsyncCommand<LifecycleModel, RealLifecycle>>]>,
	counters: Readonly<CommandCounters>,
): SeedRunReceipt {
	const minimized = details.counterexample?.[0];
	return {
		seed,
		path: details.counterexamplePath,
		cases: details.numRuns,
		skips: details.numSkips,
		shrinks: details.numShrinks,
		commandsExecuted: counters.commandExecutions,
		reopens: counters.reopens,
		restarts: counters.restarts,
		outOfOrderRestarts: counters.outOfOrderRestarts,
		revives: counters.revives,
		resumeEvidence: counters.resumeEvidence,
		corruptTransitionAttempts: counters.corruptTransitionAttempts,
		malformedLifecycle: counters.malformedLifecycle,
		malformedRestart: counters.malformedRestart,
		terminalNoops: counters.terminalNoops,
		negativeControlApplications: counters.negativeControlApplications,
		precedenceMatrixCases: counters.precedenceMatrixCases,
		precedenceMatrixAssertions: counters.precedenceMatrixAssertions,
		precedenceJournals: counters.precedenceJournals,
		failureClasses: counters.failureClasses,
		resumeOutcomes: counters.resumeOutcomes,
		transitions: counters.transitions,
		minimizedTrace: minimized ? [...REQUIRED_COMMAND_PREFIX, String(minimized)] : null,
	};
}

async function createRealLifecycle(
	modelRoot: string,
	counters: CommandCounters,
	negativeControl: NegativeControl | undefined,
): Promise<RealLifecycle> {
	const root = await fs.mkdtemp(path.join(modelRoot, "case-"));
	const sessionDir = path.join(root, "sessions");
	await fs.mkdir(sessionDir, { recursive: true });
	const manager = SessionManager.create(root, sessionDir);
	const sessionFile = manager.getSessionFile();
	if (!sessionFile) throw new Error("Expected a persistent model session file");
	const agentId = "LifecycleModelChild";
	const parentSessionFile = path.join(root, "parent.jsonl");
	const initial: ChildLifecycleRecord = {
		version: 1,
		agentId,
		childSessionFile: sessionFile,
		parentSessionFile,
		state: "running",
		updatedAt: INITIAL_UPDATED_AT,
		modelId: "model-test/provider",
		thinkingLevel: "medium",
	};
	appendChildLifecycleRecord(manager, initial);
	await manager.ensureOnDisk();
	return {
		manager,
		root,
		sessionFile,
		sessionDir,
		agentId,
		parentSessionFile,
		restartClockMs: Date.parse(INITIAL_UPDATED_AT),
		negativeControl,
		negativeControlApplied: false,
		counters,
	};
}

async function disposeRealLifecycle(real: RealLifecycle): Promise<void> {
	await real.manager.close();
	await fs.rm(real.root, { recursive: true, force: true });
}

async function deriveSourceReceipt(): Promise<SourceReceipt> {
	const packageRoot = path.resolve(import.meta.dir, "../..");
	const repositoryRoot = path.resolve(packageRoot, "../..");
	const sources = [
		["packages/coding-agent/test/model/child-lifecycle-model.test.ts", import.meta.path],
		["packages/coding-agent/src/task/child-lifecycle.ts", path.join(packageRoot, "src/task/child-lifecycle.ts")],
		["packages/coding-agent/package.json", path.join(packageRoot, "package.json")],
		["bun.lock", path.join(repositoryRoot, "bun.lock")],
	] as const;
	const aggregate = new Bun.CryptoHasher("sha256");
	const inputs: SourceInputReceipt[] = [];
	for (const [relativePath, sourcePath] of sources) {
		const bytes = new Uint8Array(await Bun.file(sourcePath).arrayBuffer());
		const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
		aggregate.update(`${relativePath}\0${bytes.byteLength}\0`);
		aggregate.update(bytes);
		inputs.push({ path: relativePath, bytes: bytes.byteLength, sha256 });
	}
	return {
		algorithm: SOURCE_DIGEST_ALGORITHM,
		digest: aggregate.digest("hex"),
		inputs,
		commitBinding: "excluded-self-reference",
	};
}

async function writeReceipt(receiptPath: string, receipt: object): Promise<void> {
	await fs.mkdir(path.dirname(receiptPath), { recursive: true });
	await Bun.write(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

async function runModelCell(): Promise<void> {
	const modelRoot = requiredEnvironment(MODEL_ROOT_ENV);
	const configRoot = requiredEnvironment("OMP_CONFIG_ROOT");
	const controlDb = requiredEnvironment("OMP_SESSION_CONTROL_DB");
	const ircDb = requiredEnvironment("OMP_IRC_DB");
	const receiptPath = requiredEnvironment(RECEIPT_ENV);
	for (const candidate of [configRoot, controlDb, ircDb]) expectContained(modelRoot, candidate);
	await fs.mkdir(modelRoot, { recursive: true });
	const ircBus = new IrcExternalBus(ircDb, { registrationEnabled: false });
	ircBus.close();

	const source = await deriveSourceReceipt();
	const environment = {
		arch: process.arch,
		bun: Bun.version,
		configRoot,
		controlDb,
		fastCheck: fc.__version,
		ircDb,
		modelRoot,
		platform: process.platform,
	};
	const environmentDigest = new Bun.CryptoHasher("sha256").update(JSON.stringify(environment)).digest("hex");
	const seeds = parseSeeds();
	const negativeControl = parseNegativeControl();
	const pathReplay = process.env.OMP_LIFECYCLE_MODEL_PATH;
	if (pathReplay && seeds.length !== 1) throw new Error("Path replay requires exactly one configured seed");
	const runs: SeedRunReceipt[] = [];
	const startedAt = new Date().toISOString();
	const baseReceipt = {
		schemaVersion: 3,
		cell: "child-lifecycle-model",
		startedAt,
		environment,
		environmentDigest,
		source,
		fixedSeed: FIXED_SEED,
		seeds,
		runsPerSeed: Number.parseInt(process.env.OMP_LIFECYCLE_MODEL_NUM_RUNS ?? `${DEFAULT_RUNS_PER_SEED}`, 10),
		maxCommands: MAX_COMMANDS,
		negativeControl: negativeControl ?? null,
		commandPrefix: ["append(running)", ...REQUIRED_COMMAND_PREFIX],
		oracle: "independent terminal, resume-precedence, corruption, and append-order state",
		precedenceMatrix: {
			journals: PRECEDENCE_JOURNALS,
			liveOwner: [false, true],
			isolated: [false, true],
			parentFailureClasses: PRECEDENCE_PARENT_FAILURES.map(value => value ?? "none"),
			casesPerProperty: PRECEDENCE_JOURNALS.length * 2 * 2 * PRECEDENCE_PARENT_FAILURES.length,
			checkpoints: ["before-reopen", "after-reopen"],
			assertionsPerProperty: PRECEDENCE_JOURNALS.length * 2 * 2 * PRECEDENCE_PARENT_FAILURES.length * 2,
		},
	};
	await writeReceipt(receiptPath, { ...baseReceipt, status: "running", runs });

	for (const seed of seeds) {
		const counters: CommandCounters = {
			cases: 0,
			commandExecutions: 0,
			reopens: 0,
			restarts: 0,
			outOfOrderRestarts: 0,
			revives: 0,
			resumeEvidence: 0,
			corruptTransitionAttempts: 0,
			malformedLifecycle: 0,
			malformedRestart: 0,
			terminalNoops: 0,
			negativeControlApplications: 0,
			precedenceMatrixCases: 0,
			precedenceMatrixAssertions: 0,
			precedenceJournals: {
				missing: 0,
				corrupt: 0,
				completed: 0,
				failed: 0,
				interrupted: 0,
			},
			failureClasses: {
				none: 0,
				wall_timeout: 0,
				subprocess_abort: 0,
				transient_host_resource: 0,
				lost_transcript: 0,
				fatal: 0,
			},
			resumeOutcomes: {
				wall_timeout: 0,
				subprocess_abort: 0,
				transient_host_resource: 0,
				lost_transcript: 0,
				fatal: 0,
				completed: 0,
				isolated: 0,
				live_owner: 0,
				unusable_journal: 0,
			},
			transitions: {
				running: 0,
				"waiting-provider": 0,
				idle: 0,
				parked: 0,
				completed: 0,
				failed: 0,
				interrupted: 0,
			},
		};
		const commands = fc.commands<LifecycleModel, RealLifecycle, false>(commandArbitrariesFor(negativeControl), {
			maxCommands: MAX_COMMANDS,
			size: "small",
		});
		const property = fc.asyncProperty(commands, async generatedCommands => {
			counters.cases++;
			const model: LifecycleModel = {
				state: "running",
				failureClass: undefined,
				resumeDisposition: undefined,
				lifecycleCorrupt: false,
				restart: undefined,
				restartCorrupt: false,
				entryCount: 1,
			};
			const real = await createRealLifecycle(modelRoot, counters, negativeControl);
			try {
				await new TransitionCommand("waiting-provider").run(model, real);
				await new TransitionCommand("parked").run(model, real);
				await new ReviveCommand().run(model, real);
				await new ResumePrecedenceMatrixCommand().run(model, real);
				await fc.asyncModelRun(() => ({ model, real }), generatedCommands);
			} finally {
				await disposeRealLifecycle(real);
			}
		});
		const details = await fc.check(property, {
			seed,
			numRuns: baseReceipt.runsPerSeed,
			...(pathReplay ? { path: pathReplay } : {}),
			interruptAfterTimeLimit: 45_000,
			markInterruptAsFailure: true,
			verbose: fc.VerbosityLevel.Verbose,
		});
		const summary = runSummary(seed, details, counters);
		runs.push(summary);
		if (details.failed) {
			const failure = {
				seed: details.seed,
				path: details.counterexamplePath,
				minimizedTrace: summary.minimizedTrace,
				error:
					details.errorInstance instanceof Error ? details.errorInstance.message : String(details.errorInstance),
				replay: `${negativeControl ? `${NEGATIVE_CONTROL_ENV}=${negativeControl} ` : ""}OMP_LIFECYCLE_MODEL_SEEDS=${details.seed} OMP_LIFECYCLE_MODEL_PATH=${details.counterexamplePath ?? ""} bun test test/model/child-lifecycle-model.test.ts`,
			};
			await writeReceipt(receiptPath, {
				...baseReceipt,
				status: "failed",
				finishedAt: new Date().toISOString(),
				runs,
				failure,
			});
			throw new Error(
				`Child lifecycle model failed: ${JSON.stringify(failure)}\n${fc.defaultReportMessage(details)}`,
			);
		}
		await writeReceipt(receiptPath, { ...baseReceipt, status: "running", runs });
	}

	await writeReceipt(receiptPath, {
		...baseReceipt,
		status: "passed",
		finishedAt: new Date().toISOString(),
		runs,
	});
}

async function runIsolatedWorker(): Promise<void> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-lifecycle-model-"));
	const receiptPath = path.resolve(process.env[RECEIPT_ENV] ?? path.join(root, "receipt.json"));
	const packageRoot = path.resolve(import.meta.dir, "../..");
	await Promise.all([
		fs.mkdir(path.join(root, "home"), { recursive: true }),
		fs.mkdir(path.join(root, "config"), { recursive: true }),
	]);
	try {
		const child = Bun.spawn([process.execPath, "test", import.meta.path], {
			cwd: packageRoot,
			env: {
				...process.env,
				HOME: path.join(root, "home"),
				OMP_CONFIG_ROOT: path.join(root, "config"),
				OMP_IRC_DB: path.join(root, "irc.sqlite"),
				OMP_SESSION_CONTROL_DB: path.join(root, "session-control.sqlite"),
				[MODEL_ROOT_ENV]: root,
				[RECEIPT_ENV]: receiptPath,
				[WORKER_ENV]: "1",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		if (exitCode !== 0) {
			const receipt = await Bun.file(receiptPath)
				.text()
				.catch(() => "receipt unavailable");
			throw new Error(`Isolated lifecycle model worker exited ${exitCode}\n${stdout}\n${stderr}\n${receipt}`);
		}
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
}

describe("child lifecycle model cell", () => {
	it("agrees with durable journals across generated commands and reopen checkpoints", async () => {
		if (process.env[WORKER_ENV] === "1") await runModelCell();
		else await runIsolatedWorker();
	}, 120_000);
});
