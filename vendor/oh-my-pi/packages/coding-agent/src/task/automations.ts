import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AuthStorage } from "@oh-my-pi/pi-ai";
import { getAgentDir, getSessionsDir, isEnoent } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import { Schema } from "effect";
import { ModelRegistry } from "../config/model-registry";
import { resolveModelOverrideWithAuthFallback } from "../config/model-resolver";
import { getKnownRoleIds, MODEL_ROLE_IDS } from "../config/model-roles";
import { Settings } from "../config/settings";
import type { MCPManager } from "../mcp/manager";
import { createAgentSession, discoverAuthStorage } from "../sdk";
import type { AgentSession } from "../session/agent-session";
import { SessionManager } from "../session/session-manager";
import { DEFAULT_MAX_BYTES, TailBuffer } from "../session/streaming-output";
import { extractLastAssistantText } from "./executor";

export const AUTOMATIONS_FILENAME = "automations.yml";
export const AUTOMATION_LEDGER_FILENAME = "ledger.jsonl";
export const AUTOMATION_SUMMARY_MAX_CHARS = 200;
export const AUTOMATION_COMMAND_OUTPUT_MAX_BYTES = DEFAULT_MAX_BYTES;
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
	command: Schema.optional(Schema.Array(Schema.String)),
	cwd: Schema.String,
	enabled: Schema.optional(Schema.Boolean),
});

const AutomationRegistrySchema = Schema.Union([
	Schema.Array(AutomationEntrySchema),
	Schema.Struct({ automations: Schema.Array(AutomationEntrySchema) }),
]);

const AutomationLedgerBaseSchema = {
	runAt: Schema.Number,
	durationMs: Schema.Number,
	status: Schema.Literals(["succeeded", "failed"]),
	sessionFile: Schema.String,
	outputSummary: Schema.String,
};

const AgentAutomationLedgerEntrySchema = Schema.Struct(AutomationLedgerBaseSchema);
const CommandAutomationLedgerEntrySchema = Schema.Struct({
	...AutomationLedgerBaseSchema,
	command: Schema.Array(Schema.String),
	exitCode: Schema.NullOr(Schema.Number),
	stdout: Schema.String,
	stderr: Schema.String,
	stdoutTruncated: Schema.Boolean,
	stderrTruncated: Schema.Boolean,
});
const AutomationLedgerEntrySchema = Schema.Union([
	AgentAutomationLedgerEntrySchema,
	CommandAutomationLedgerEntrySchema,
]);

export type AutomationSchedule =
	| { readonly kind: "interval"; readonly intervalMs: number }
	| { readonly kind: "daily"; readonly hour: number; readonly minute: number };

interface AutomationEntryBase {
	readonly name: string;
	readonly schedule: string;
	readonly cwd: string;
	readonly enabled: boolean;
}

export interface PromptAutomationEntry extends AutomationEntryBase {
	readonly lane: string;
	readonly model?: string;
	readonly prompt: string;
	readonly packet?: never;
	readonly command?: never;
}

export interface PacketAutomationEntry extends AutomationEntryBase {
	readonly lane: string;
	readonly model?: string;
	readonly prompt?: never;
	readonly packet: string;
	readonly command?: never;
}

export interface CommandAutomationEntry extends AutomationEntryBase {
	readonly lane?: never;
	readonly model?: never;
	readonly prompt?: never;
	readonly packet?: never;
	readonly command: readonly string[];
}

export type AutomationEntry = PromptAutomationEntry | PacketAutomationEntry | CommandAutomationEntry;
type AgentAutomationEntry = PromptAutomationEntry | PacketAutomationEntry;

interface AutomationLedgerEntryBase {
	readonly runAt: number;
	readonly durationMs: number;
	readonly status: "succeeded" | "failed";
	readonly sessionFile: string;
	readonly outputSummary: string;
}

export interface AgentAutomationLedgerEntry extends AutomationLedgerEntryBase {
	readonly command?: never;
	readonly exitCode?: never;
	readonly stdout?: never;
	readonly stderr?: never;
	readonly stdoutTruncated?: never;
	readonly stderrTruncated?: never;
}

export interface CommandAutomationLedgerEntry extends AutomationLedgerEntryBase {
	readonly command: readonly string[];
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly stdoutTruncated: boolean;
	readonly stderrTruncated: boolean;
}

export type AutomationLedgerEntry = AgentAutomationLedgerEntry | CommandAutomationLedgerEntry;

export type AutomationRunResult = AutomationLedgerEntry & {
	readonly name: string;
};

export class AutomationRunError extends Error {
	readonly result: AutomationRunResult;

	constructor(result: AutomationRunResult, cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = "AutomationRunError";
		this.result = result;
	}
}

export interface AutomationRunOptions {
	readonly agentDir?: string;
	readonly runtimeAgentDir?: string;
	readonly sessionsDir?: string;
	readonly nowMs?: () => number;
	readonly createSession?: typeof createAgentSession;
	readonly discoverAuth?: typeof discoverAuthStorage;
	readonly signal?: AbortSignal;
}


export interface AutomationDaemonOptions extends AutomationRunOptions {
	readonly sleep?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
	readonly random?: () => number;
	readonly checkIntervalMs?: number;
	readonly maxJitterMs?: number;
	readonly maxCycles?: number;
	readonly onRun?: (entry: AutomationEntry) => void | Promise<void>;
	readonly run?: (entry: AutomationEntry) => Promise<AutomationRunResult>;
	readonly onError?: (entry: AutomationEntry, error: unknown) => void | Promise<void>;
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
	const payloadCount =
		Number(decoded.prompt !== undefined) +
		Number(decoded.packet !== undefined) +
		Number(decoded.command !== undefined);
	if (payloadCount !== 1) {
		throw new Error(`Automation ${name}: exactly one of prompt or packet or command is required`);
	}
	const schedule = decoded.schedule.trim();
	parseAutomationSchedule(schedule);
	const base = {
		name,
		schedule,
		cwd: path.resolve(cleanRequired(decoded.cwd, "cwd", name)),
		enabled: decoded.enabled ?? true,
	};
	if (decoded.command !== undefined) {
		if (decoded.command.length === 0) throw new Error(`Automation ${name}: command must not be empty`);
		if (decoded.lane !== undefined || decoded.model !== undefined) {
			throw new Error(`Automation ${name}: lane and model are only valid for prompt or packet automations`);
		}
		const command = decoded.command.map((argument, index) => {
			if (argument.trim().length === 0) {
				throw new Error(`Automation ${name}: command[${index}] must not be empty`);
			}
			return argument;
		});
		return { ...base, command };
	}
	const lane = decoded.lane?.trim() || DEFAULT_AUTOMATION_LANE;
	const model = decoded.model?.trim() || undefined;
	if (decoded.prompt !== undefined) {
		return { ...base, lane, model, prompt: cleanRequired(decoded.prompt, "prompt", name) };
	}
	if (decoded.packet === undefined) throw new Error(`Automation ${name}: packet is required`);
	return { ...base, lane, model, packet: cleanRequired(decoded.packet, "packet", name) };
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
	if ("command" in decoded) {
		if (decoded.command.length === 0 || decoded.command.some(argument => argument.trim().length === 0)) {
			throw new Error("Automation ledger command must contain nonempty arguments");
		}
		if (
			decoded.exitCode !== null &&
			(!Number.isSafeInteger(decoded.exitCode) || decoded.exitCode < 0)
		) {
			throw new Error("Automation ledger exitCode must be a non-negative safe integer or null");
		}
		const expectedStatus = decoded.exitCode === 0 ? "succeeded" : "failed";
		if (decoded.status !== expectedStatus) {
			throw new Error(`Automation ledger command exitCode requires ${expectedStatus} status`);
		}
		if (
			Buffer.byteLength(decoded.stdout, "utf8") > AUTOMATION_COMMAND_OUTPUT_MAX_BYTES ||
			Buffer.byteLength(decoded.stderr, "utf8") > AUTOMATION_COMMAND_OUTPUT_MAX_BYTES
		) {
			throw new Error(
				`Automation ledger command output exceeds ${AUTOMATION_COMMAND_OUTPUT_MAX_BYTES} bytes per stream`,
			);
		}
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

interface BoundedCommandOutput {
	readonly text: string;
	readonly truncated: boolean;
}

interface CommandExecutionResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly stdoutTruncated: boolean;
	readonly stderrTruncated: boolean;
}

async function captureCommandOutput(stream: ReadableStream<Uint8Array>): Promise<BoundedCommandOutput> {
	const tail = new TailBuffer(AUTOMATION_COMMAND_OUTPUT_MAX_BYTES);
	const decoder = new TextDecoder();
	const reader = stream.getReader();
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = decoder.decode(value, { stream: true });
			totalBytes += Buffer.byteLength(chunk, "utf8");
			tail.append(chunk);
		}
		const finalChunk = decoder.decode();
		totalBytes += Buffer.byteLength(finalChunk, "utf8");
		tail.append(finalChunk);
	} finally {
		reader.releaseLock();
	}
	const text = tail.text();
	return { text, truncated: totalBytes > tail.bytes() };
}

async function executeAutomationCommand(
	entry: CommandAutomationEntry,
	signal?: AbortSignal,
): Promise<CommandExecutionResult> {
	const process = Bun.spawn({
		cmd: Array.from(entry.command),
		cwd: entry.cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		windowsHide: true,
		signal,
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		captureCommandOutput(process.stdout),
		captureCommandOutput(process.stderr),
		process.exited,
	]);
	return {
		exitCode,
		stdout: stdout.text,
		stderr: stderr.text,
		stdoutTruncated: stdout.truncated,
		stderrTruncated: stderr.truncated,
	};
}

function formatCommandFailure(
	entry: CommandAutomationEntry,
	result: CommandExecutionResult,
	aborted: boolean,
): string {
	const lines = [
		`Automation ${entry.name} command ${aborted ? "was aborted" : "failed"} with exit code ${result.exitCode}: ${JSON.stringify(entry.command)}`,
	];
	if (result.stderr) {
		lines.push(`stderr${result.stderrTruncated ? " (truncated tail)" : ""}:\n${result.stderr}`);
	}
	if (result.stdout) {
		lines.push(`stdout${result.stdoutTruncated ? " (truncated tail)" : ""}:\n${result.stdout}`);
	}
	return lines.join("\n");
}

async function readAutomationPrompt(entry: AgentAutomationEntry): Promise<string> {
	if (entry.prompt !== undefined) return entry.prompt;
	const packetPath = path.resolve(entry.cwd, entry.packet);
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
	sessionManager.appendCustomEntry(
		"automation",
		entry.command
			? { name: entry.name, schedule: entry.schedule, command: entry.command }
			: { name: entry.name, schedule: entry.schedule, lane: entry.lane, model: entry.model },
	);
	const createSession = options.createSession ?? createAgentSession;
	let session: AgentSession | undefined;
	let mcpManager: MCPManager | undefined;
	let authStorage: AuthStorage | undefined;
	let status: AutomationLedgerEntry["status"] = "succeeded";
	let summary = "";
	let failure: unknown;
	let commandResult: CommandExecutionResult | undefined;
	let finalRecord: AutomationLedgerEntry | undefined;
	try {
		if (entry.command) {
			commandResult = await executeAutomationCommand(entry, options.signal);
			if (commandResult.exitCode !== 0) {
				throw new Error(formatCommandFailure(entry, commandResult, options.signal?.aborted === true));
			}
			summary = capSummary(commandResult.stdout || commandResult.stderr || "Command succeeded");
		} else {
			const settings = await Settings.init({ cwd: entry.cwd, agentDir: runtimeAgentDir });
			authStorage = await (options.discoverAuth ?? discoverAuthStorage)(runtimeAgentDir);
			const modelRegistry = new ModelRegistry(authStorage, path.join(runtimeAgentDir, "models.yml"));
			const requestedSelector = entry.model ?? entry.lane;
			const roleSelector =
				entry.model === undefined && MODEL_ROLE_IDS.includes(requestedSelector as (typeof MODEL_ROLE_IDS)[number])
					? `pi/${requestedSelector}`
					: requestedSelector;
			const resolution = await resolveModelOverrideWithAuthFallback([roleSelector], undefined, modelRegistry, settings);
			if (!resolution.model) {
				const availableRoles: string[] = [];
				for (const role of getKnownRoleIds(settings)) {
					const candidate = await resolveModelOverrideWithAuthFallback(
						[`pi/${role}`],
						undefined,
						modelRegistry,
						settings,
					);
					if (candidate.model) availableRoles.push(role);
				}
				const candidates =
					availableRoles.length > 0
						? ` Available roles: ${availableRoles.join(", ")}.`
						: " No automation roles are available.";
				throw new Error(`No available model for automation lane ${JSON.stringify(requestedSelector)}.${candidates}`);
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
			mcpManager = created.mcpManager;
			await session.prompt(await readAutomationPrompt(entry), {
				attribution: "agent",
				expandPromptTemplates: false,
			});
			summary = capSummary(extractLastAssistantText(session));
		}
	} catch (error) {
		status = "failed";
		summary = capSummary(error instanceof Error ? error.message : String(error));
		failure = error;
	} finally {
		try {
			if (session) await session.dispose();
		} finally {
			try {
				await mcpManager?.disconnectAll();
			} finally {
				authStorage?.close();
			}
		}
		const commonRecord: AutomationLedgerEntryBase = {
			runAt,
			durationMs: Math.max(0, now() - runAt),
			status,
			sessionFile,
			outputSummary: summary,
		};
		finalRecord = entry.command
			? {
					...commonRecord,
					command: entry.command,
					exitCode: commandResult?.exitCode ?? null,
					stdout: commandResult?.stdout ?? "",
					stderr: commandResult?.stderr ?? "",
					stdoutTruncated: commandResult?.stdoutTruncated ?? false,
					stderrTruncated: commandResult?.stderrTruncated ?? false,
				}
			: commonRecord;
		sessionManager.appendCustomEntry("automation-result", finalRecord);
		await sessionManager.flush();
		await appendAutomationLedger(entry, finalRecord, agentDir);
	}
	const result: AutomationRunResult = { name: entry.name, ...finalRecord! };
	if (failure !== undefined) throw new AutomationRunError(result, failure);
	return result;
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
			} catch (error) {
				// The failed run is journaled; report it and continue supervising the remaining jobs.
				await options.onError?.(entry, error);
			}
		}
		if (!options.signal?.aborted && (options.maxCycles === undefined || cycles < options.maxCycles)) {
			await sleep(checkIntervalMs, options.signal);
		}
	}
}
