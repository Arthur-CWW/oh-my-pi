import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, getSessionsDir, isEnoent } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import { Schema } from "effect";
import { ModelRegistry } from "../config/model-registry";
import { resolveModelOverrideWithAuthFallback } from "../config/model-resolver";
import { Settings } from "../config/settings";
import { createAgentSession, discoverAuthStorage } from "../sdk";
import type { AgentSession } from "../session/agent-session";
import { SessionManager } from "../session/session-manager";
import { extractLastAssistantText } from "./executor";

export const AUTOMATIONS_FILENAME = "automations.yml";
export const AUTOMATION_LEDGER_FILENAME = "ledger.jsonl";
export const AUTOMATION_SUMMARY_MAX_CHARS = 200;
export const DEFAULT_AUTOMATION_LANE = "smol";
export const DAEMON_CHECK_INTERVAL_MS = 60_000;
export const DAEMON_MAX_JITTER_MS = 15_000;

const AutomationEntrySchema = Schema.Struct({
	name: Schema.String,
	schedule: Schema.String,
	lane: Schema.optional(Schema.String),
	model: Schema.optional(Schema.String),
	prompt: Schema.optional(Schema.String),
	packet: Schema.optional(Schema.String),
	cwd: Schema.String,
	enabled: Schema.optional(Schema.Boolean),
});

const AutomationRegistrySchema = Schema.Union([
	Schema.Array(AutomationEntrySchema),
	Schema.Struct({ automations: Schema.Array(AutomationEntrySchema) }),
]);

const AutomationLedgerEntrySchema = Schema.Struct({
	runAt: Schema.Number,
	durationMs: Schema.Number,
	status: Schema.Literals(["succeeded", "failed"]),
	sessionFile: Schema.String,
	outputSummary: Schema.String,
});

export type AutomationSchedule =
	| { readonly kind: "interval"; readonly intervalMs: number }
	| { readonly kind: "daily"; readonly hour: number; readonly minute: number };

export interface AutomationEntry {
	readonly name: string;
	readonly schedule: string;
	readonly lane: string;
	readonly model?: string;
	readonly prompt?: string;
	readonly packet?: string;
	readonly cwd: string;
	readonly enabled: boolean;
}

export interface AutomationLedgerEntry {
	readonly runAt: number;
	readonly durationMs: number;
	readonly status: "succeeded" | "failed";
	readonly sessionFile: string;
	readonly outputSummary: string;
}

export interface AutomationRunResult extends AutomationLedgerEntry {
	readonly name: string;
}

export interface AutomationRunOptions {
	readonly agentDir?: string;
	readonly runtimeAgentDir?: string;
	readonly sessionsDir?: string;
	readonly nowMs?: () => number;
	readonly createSession?: typeof createAgentSession;
}

export interface AutomationDaemonOptions extends AutomationRunOptions {
	readonly signal?: AbortSignal;
	readonly sleep?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
	readonly random?: () => number;
	readonly checkIntervalMs?: number;
	readonly maxJitterMs?: number;
	readonly maxCycles?: number;
	readonly onRun?: (entry: AutomationEntry) => void | Promise<void>;
	readonly run?: (entry: AutomationEntry) => Promise<AutomationRunResult>;
}

function cleanRequired(value: string, field: string, name?: string): string {
	const cleaned = value.trim();
	if (cleaned.length === 0) throw new Error(`${name ? `Automation ${name}: ` : ""}${field} must not be empty`);
	return cleaned;
}

export function parseAutomationSchedule(value: string): AutomationSchedule {
	const schedule = value.trim();
	const interval = /^(\d+)(m|h)$/.exec(schedule);
	if (interval) {
		const amount = Number(interval[1]);
		if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Invalid automation interval: ${value}`);
		return { kind: "interval", intervalMs: amount * (interval[2] === "h" ? 3_600_000 : 60_000) };
	}
	const daily = /^daily@(\d{2}):(\d{2})$/.exec(schedule);
	if (daily) {
		const hour = Number(daily[1]);
		const minute = Number(daily[2]);
		if (hour <= 23 && minute <= 59) return { kind: "daily", hour, minute };
	}
	throw new Error(
		`Invalid automation schedule ${JSON.stringify(value)}; expected <positive integer>m, <positive integer>h, or daily@HH:MM`,
	);
}

function normalizeAutomationEntry(decoded: Schema.Schema.Type<typeof AutomationEntrySchema>): AutomationEntry {
	const name = cleanRequired(decoded.name, "name");
	const prompt = decoded.prompt?.trim();
	const packet = decoded.packet?.trim();
	if (Boolean(prompt) === Boolean(packet)) {
		throw new Error(`Automation ${name}: exactly one of prompt or packet is required`);
	}
	const lane = decoded.lane?.trim() || DEFAULT_AUTOMATION_LANE;
	const model = decoded.model?.trim() || undefined;
	parseAutomationSchedule(decoded.schedule);
	return {
		name,
		schedule: decoded.schedule.trim(),
		lane,
		model,
		prompt: prompt || undefined,
		packet: packet || undefined,
		cwd: path.resolve(cleanRequired(decoded.cwd, "cwd", name)),
		enabled: decoded.enabled ?? true,
	};
}

export function decodeAutomationRegistry(input: unknown): AutomationEntry[] {
	const decoded = Schema.decodeUnknownSync(AutomationRegistrySchema)(input, { onExcessProperty: "error" });
	const rawEntries = "automations" in decoded ? decoded.automations : decoded;
	const entries = rawEntries.map(normalizeAutomationEntry);
	const names = new Set<string>();
	for (const entry of entries) {
		if (names.has(entry.name)) throw new Error(`Duplicate automation name: ${entry.name}`);
		names.add(entry.name);
	}
	return entries;
}

export function getAutomationRegistryPath(agentDir: string = getAgentDir()): string {
	return path.join(agentDir, AUTOMATIONS_FILENAME);
}

export async function loadAutomationRegistry(agentDir: string = getAgentDir()): Promise<AutomationEntry[]> {
	const registryPath = getAutomationRegistryPath(agentDir);
	let text: string;
	try {
		text = await Bun.file(registryPath).text();
	} catch (error) {
		if (isEnoent(error)) return [];
		throw error;
	}
	if (text.trim().length === 0) return [];
	return decodeAutomationRegistry(YAML.parse(text));
}

export function automationSlug(name: string): string {
	const slug = name
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (slug.length === 0) throw new Error(`Automation name cannot form a safe session id: ${name}`);
	return slug.slice(0, 80);
}

export function getAutomationStateDir(entry: Pick<AutomationEntry, "name">, agentDir: string = getAgentDir()): string {
	return path.join(agentDir, "automations", automationSlug(entry.name));
}

export function getAutomationLedgerPath(
	entry: Pick<AutomationEntry, "name">,
	agentDir: string = getAgentDir(),
): string {
	return path.join(getAutomationStateDir(entry, agentDir), AUTOMATION_LEDGER_FILENAME);
}

export function getAutomationSessionFile(
	entry: Pick<AutomationEntry, "name">,
	sessionsDir: string = getSessionsDir(),
): string {
	const slug = automationSlug(entry.name);
	return path.join(sessionsDir, `automation-${slug}`, `${slug}.jsonl`);
}

function decodeAutomationLedgerEntry(input: unknown): AutomationLedgerEntry {
	const decoded = Schema.decodeUnknownSync(AutomationLedgerEntrySchema)(input, { onExcessProperty: "error" });
	if (!Number.isFinite(decoded.runAt) || !Number.isFinite(decoded.durationMs) || decoded.durationMs < 0) {
		throw new Error("Automation ledger timestamps must be finite and durationMs must be non-negative");
	}
	if (decoded.outputSummary.length > AUTOMATION_SUMMARY_MAX_CHARS) {
		throw new Error(`Automation ledger outputSummary exceeds ${AUTOMATION_SUMMARY_MAX_CHARS} characters`);
	}
	return decoded;
}

export async function appendAutomationLedger(
	entry: Pick<AutomationEntry, "name">,
	record: AutomationLedgerEntry,
	agentDir: string = getAgentDir(),
): Promise<void> {
	const validated = decodeAutomationLedgerEntry(record);
	const ledgerPath = getAutomationLedgerPath(entry, agentDir);
	await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
	await fs.appendFile(ledgerPath, `${JSON.stringify(validated)}\n`, "utf8");
}

export async function readAutomationLedger(
	entry: Pick<AutomationEntry, "name">,
	agentDir: string = getAgentDir(),
): Promise<AutomationLedgerEntry[]> {
	let text: string;
	try {
		text = await Bun.file(getAutomationLedgerPath(entry, agentDir)).text();
	} catch (error) {
		if (isEnoent(error)) return [];
		throw error;
	}
	const records: AutomationLedgerEntry[] = [];
	for (const line of text.split("\n")) {
		if (line.trim().length === 0) continue;
		try {
			records.push(decodeAutomationLedgerEntry(JSON.parse(line)));
		} catch {
			// A torn final append must not hide earlier valid runs.
		}
	}
	return records;
}

export function latestAutomationRun(records: readonly AutomationLedgerEntry[]): AutomationLedgerEntry | undefined {
	let latest: AutomationLedgerEntry | undefined;
	for (const record of records) {
		if (!latest || record.runAt > latest.runAt) latest = record;
	}
	return latest;
}

function dailyBoundary(nowMs: number, schedule: Extract<AutomationSchedule, { kind: "daily" }>): number {
	const now = new Date(nowMs);
	return new Date(now.getFullYear(), now.getMonth(), now.getDate(), schedule.hour, schedule.minute, 0, 0).getTime();
}

export function isAutomationDue(scheduleText: string, nowMs: number, lastRunAt?: number): boolean {
	if (!Number.isFinite(nowMs)) return false;
	const schedule = parseAutomationSchedule(scheduleText);
	if (lastRunAt !== undefined && (!Number.isFinite(lastRunAt) || lastRunAt > nowMs)) return false;
	if (schedule.kind === "interval") return lastRunAt === undefined || nowMs - lastRunAt >= schedule.intervalMs;
	const boundary = dailyBoundary(nowMs, schedule);
	return nowMs >= boundary && (lastRunAt === undefined || lastRunAt < boundary);
}

function capSummary(value: string | undefined): string {
	const normalized = (value ?? "").replace(/\s+/g, " ").trim();
	return normalized.length <= AUTOMATION_SUMMARY_MAX_CHARS
		? normalized
		: normalized.slice(0, AUTOMATION_SUMMARY_MAX_CHARS);
}

async function readAutomationPrompt(entry: AutomationEntry): Promise<string> {
	if (entry.prompt) return entry.prompt;
	const packetPath = path.resolve(entry.cwd, entry.packet!);
	try {
		return await Bun.file(packetPath).text();
	} catch (error) {
		if (isEnoent(error)) throw new Error(`Automation packet not found: ${packetPath}`);
		throw error;
	}
}

export async function runAutomationOnce(
	entry: AutomationEntry,
	options: AutomationRunOptions = {},
): Promise<AutomationRunResult> {
	const now = options.nowMs ?? Date.now;
	const runAt = now();
	const agentDir = options.agentDir ?? getAgentDir();
	const runtimeAgentDir = options.runtimeAgentDir ?? agentDir;
	const sessionFile = getAutomationSessionFile(entry, options.sessionsDir);
	const sessionManager = await SessionManager.open(sessionFile, undefined, undefined, {
		initialCwd: entry.cwd,
		suppressBreadcrumb: true,
	});
	await sessionManager.setSessionName(`automation: ${entry.name}`, "user");
	sessionManager.appendCustomEntry("automation", {
		name: entry.name,
		schedule: entry.schedule,
		lane: entry.lane,
	});
	const createSession = options.createSession ?? createAgentSession;
	let session: AgentSession | undefined;
	let status: AutomationLedgerEntry["status"] = "succeeded";
	let summary = "";
	let finalRecord: AutomationLedgerEntry | undefined;
	try {
		const settings = await Settings.init({ cwd: entry.cwd, agentDir: runtimeAgentDir });
		const authStorage = await discoverAuthStorage(runtimeAgentDir);
		const modelRegistry = new ModelRegistry(authStorage, path.join(runtimeAgentDir, "models.yml"));
		const resolution = await resolveModelOverrideWithAuthFallback(
			[entry.model ?? entry.lane],
			undefined,
			modelRegistry,
			settings,
		);
		if (!resolution.model) {
			throw new Error(`No available model for automation lane ${JSON.stringify(entry.model ?? entry.lane)}`);
		}
		const created = await createSession({
			cwd: entry.cwd,
			agentDir: runtimeAgentDir,
			authStorage,
			modelRegistry,
			settings,
			model: resolution.model,
			thinkingLevel: resolution.thinkingLevel,
			sessionManager,
			hasUI: false,
			agentId: `Automation-${automationSlug(entry.name)}`,
			agentDisplayName: `automation: ${entry.name}`,
		});
		session = created.session;
		await session.prompt(await readAutomationPrompt(entry), {
			attribution: "agent",
			expandPromptTemplates: false,
		});
		summary = capSummary(extractLastAssistantText(session));
	} catch (error) {
		status = "failed";
		summary = capSummary(error instanceof Error ? error.message : String(error));
		throw error;
	} finally {
		if (session) await session.dispose();
		await sessionManager.flush();
		finalRecord = {
			runAt,
			durationMs: Math.max(0, now() - runAt),
			status,
			sessionFile,
			outputSummary: summary,
		};
		await appendAutomationLedger(entry, finalRecord, agentDir);
	}
	return { name: entry.name, ...finalRecord! };
}

async function abortableSleep(durationMs: number, signal?: AbortSignal): Promise<void> {
	if (durationMs <= 0) return;
	if (!signal) {
		await Bun.sleep(durationMs);
		return;
	}
	if (signal.aborted) return;
	const { promise, resolve } = Promise.withResolvers<void>();
	const timer = setTimeout(resolve, durationMs);
	const abort = (): void => resolve();
	signal.addEventListener("abort", abort, { once: true });
	await promise;
	clearTimeout(timer);
	signal.removeEventListener("abort", abort);
}

export async function runAutomationDaemon(options: AutomationDaemonOptions = {}): Promise<void> {
	const now = options.nowMs ?? Date.now;
	const sleep = options.sleep ?? abortableSleep;
	const random = options.random ?? Math.random;
	const checkIntervalMs = options.checkIntervalMs ?? DAEMON_CHECK_INTERVAL_MS;
	const maxJitterMs = options.maxJitterMs ?? DAEMON_MAX_JITTER_MS;
	const agentDir = options.agentDir ?? getAgentDir();
	let cycles = 0;
	while (!options.signal?.aborted && (options.maxCycles === undefined || cycles < options.maxCycles)) {
		cycles += 1;
		const entries = await loadAutomationRegistry(agentDir);
		for (const entry of entries) {
			if (!entry.enabled || options.signal?.aborted) continue;
			const latest = latestAutomationRun(await readAutomationLedger(entry, agentDir));
			if (!isAutomationDue(entry.schedule, now(), latest?.runAt)) continue;
			const jitterMs = Math.floor(Math.max(0, Math.min(1, random())) * maxJitterMs);
			if (jitterMs > 0) await sleep(jitterMs, options.signal);
			if (options.signal?.aborted) break;
			await options.onRun?.(entry);
			try {
				await (options.run ? options.run(entry) : runAutomationOnce(entry, options));
			} catch {
				// The failed run is journaled; continue supervising the remaining jobs.
			}
		}
		if (!options.signal?.aborted && (options.maxCycles === undefined || cycles < options.maxCycles)) {
			await sleep(checkIntervalMs, options.signal);
		}
	}
}
