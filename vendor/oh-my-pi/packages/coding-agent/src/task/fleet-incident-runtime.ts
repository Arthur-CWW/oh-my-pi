import { logger } from "@oh-my-pi/pi-utils";
import { IrcBus } from "../irc/bus";
import { IrcExternalBus, resolveIrcExternalPeerName } from "../irc/bus-external";
import { type AgentRef, AgentRegistry, MAIN_AGENT_ID } from "../registry/agent-registry";
import { appendErrorInboxEvent } from "../session/error-inbox-ledger";
import { createFleetCapability } from "../session/fleet-capability";
import { CURRENT_SESSION_CONTROL_PROTOCOL } from "../session/session-control";
import type { SessionEntry } from "../session/session-entries";
import type { SessionManager } from "../session/session-manager";
import { type FleetIncident, FleetIncidentCoordinator, FleetIncidentStore } from "./fleet-incident";

const INCIDENT_SOURCE = "fleet";
const INCIDENT_CATEGORY = "fleet-incident";
const INCIDENT_PROBE_URL = "https://api.openai.com";
const SALVAGE_CUSTOM_TYPE = "fleet_incident_salvage";

export interface FleetIncidentFailureObservation {
	readonly evidenceKey: string;
	readonly agent: string;
	readonly job: string;
	readonly failureClass: string;
	readonly occurredAt: number;
	readonly journalUri: string;
	readonly message: string;
}

export interface FleetSalvageAgent {
	readonly id: string;
	readonly kind: "main" | "sub";
	readonly parentId?: string;
	readonly status: "running" | "idle" | "parked" | "aborted";
}

export interface FleetSalvageDependencies {
	readonly resolveAgent: (agentId: string) => FleetSalvageAgent | undefined;
	readonly journalShowsUserCancellation: (agentId: string) => boolean | Promise<boolean>;
	readonly journalAttempt: (incident: FleetIncident, agentId: string) => boolean | Promise<boolean>;
	readonly sendResume: (incident: FleetIncident, agentId: string) => void | Promise<void>;
}

export function isFleetSalvageCandidate(agent: FleetSalvageAgent | undefined): boolean {
	return (
		agent?.kind === "sub" &&
		agent.parentId === MAIN_AGENT_ID &&
		(agent.status === "idle" || agent.status === "parked")
	);
}

/** Journal-first salvage guard shared by production and focused policy tests. */
export async function salvageFleetIncidentAgent(
	incident: FleetIncident,
	agentId: string,
	dependencies: FleetSalvageDependencies,
): Promise<boolean> {
	const agent = dependencies.resolveAgent(agentId);
	if (!isFleetSalvageCandidate(agent)) return false;
	if (await dependencies.journalShowsUserCancellation(agentId)) return false;
	if (!(await dependencies.journalAttempt(incident, agentId))) return false;
	await dependencies.sendResume(incident, agentId);
	return true;
}

function incidentEventId(incidentId: string): string {
	return `fleet-incident:${incidentId}`;
}

function incidentMessage(incident: FleetIncident, status: "open" | "closed"): string {
	const agents = new Set(incident.evidence.map(evidence => evidence.agent)).size;
	if (status === "open") {
		return `Fleet infrastructure incident ${incident.id} is open: ${incident.evidence.length} network failures across ${agents} agents. Connectivity recovery is being probed; matching failed children will resume automatically when it clears.`;
	}
	return `Fleet infrastructure incident ${incident.id} cleared. Matching failed children were queued for automatic resume.`;
}

function appendIncidentInbox(incident: FleetIncident, status: "open" | "closed"): void {
	const mainSession = AgentRegistry.global().get(MAIN_AGENT_ID)?.session;
	const manager = mainSession?.sessionManager;
	if (!manager) return;
	const closed = status === "closed";
	appendErrorInboxEvent(manager, {
		id: incidentEventId(incident.id),
		firstTimestamp: incident.openedAt,
		lastTimestamp: closed ? (incident.closedAt ?? Date.now()) : incident.openedAt,
		message: incidentMessage(incident, status),
		count: 1,
		source: INCIDENT_SOURCE,
		category: INCIDENT_CATEGORY,
		errorClass: incident.failureClass,
		session: manager.getSessionId(),
		status,
		code: closed ? "fleet_incident_closed" : "fleet_incident_open",
		unread: !closed,
		resolved: closed,
	});
}

async function broadcastIncident(incident: FleetIncident): Promise<void> {
	const registry = AgentRegistry.global();
	const mainSession = registry.get(MAIN_AGENT_ID)?.session;
	if (!mainSession) return;
	const body = incidentMessage(incident, "open");
	const internal = registry.listVisibleTo(MAIN_AGENT_ID).filter(ref => ref.kind === "sub");
	await Promise.all(
		internal.map(ref => IrcBus.global().send({ from: MAIN_AGENT_ID, to: ref.id, body, origin: "system" })),
	);

	try {
		const manager = mainSession.sessionManager;
		const cwd = manager.getCwd();
		const ownership = manager.getSessionOwnership();
		const sessionId = ownership?.sessionId ?? `${cwd}:${process.pid}`;
		const name = resolveIrcExternalPeerName({
			configuredName: mainSession.settings.get("irc.peerName"),
			cwd,
			sessionId,
		});
		const bus = IrcExternalBus.global();
		bus.registerPeer({
			sessionId,
			name,
			cwd,
			pid: process.pid,
			explicitName: Boolean(mainSession.settings.get("irc.peerName")?.trim()),
			sessionFile: manager.getSessionFile() ?? undefined,
			ownerEpoch: ownership?.ownerEpoch,
			buildDigest: ownership?.buildRevision.digest,
			version: ownership?.buildRevision.version,
			fleetCapability:
				ownership === undefined
					? undefined
					: createFleetCapability({
							buildDigest: ownership.buildRevision.digest,
							productVersion: ownership.buildRevision.version,
							controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
							workstream: manager.getWorkstream(),
						}),
		});
		for (const peer of bus.listPeers({ excludeSessionId: sessionId })) {
			bus.sendMessage({ fromPeer: name, toPeer: peer.name, body, origin: "system", audience: "direct" });
		}
	} catch (error) {
		logger.warn("Fleet incident external IRC broadcast failed", { incidentId: incident.id, error: String(error) });
	}
}

function entriesShowUserCancellation(entries: readonly SessionEntry[]): boolean {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
		return entry.message.stopReason === "aborted";
	}
	return false;
}

interface PersistedJournalLine {
	readonly type?: string;
	readonly message?: {
		readonly role?: string;
		readonly stopReason?: string;
	};
}

async function fileShowsUserCancellation(sessionFile: string): Promise<boolean> {
	try {
		const file = Bun.file(sessionFile);
		const suffix = await file.slice(Math.max(0, file.size - 65_536)).text();
		const lines = suffix.split("\n");
		for (let index = lines.length - 1; index >= 0; index--) {
			const line = lines[index];
			if (!line?.startsWith("{")) continue;
			let entry: PersistedJournalLine;
			try {
				entry = JSON.parse(line) as PersistedJournalLine;
			} catch {
				continue;
			}
			if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
			return entry.message.stopReason === "aborted";
		}
	} catch (error) {
		logger.warn("Could not inspect child journal before incident salvage", { sessionFile, error: String(error) });
		return true;
	}
	return false;
}

async function journalShowsUserCancellation(agentId: string): Promise<boolean> {
	const ref = AgentRegistry.global().get(agentId);
	if (!ref || ref.status === "aborted") return true;
	if (ref.session && entriesShowUserCancellation(ref.session.sessionManager.getEntries())) return true;
	return ref.sessionFile ? fileShowsUserCancellation(ref.sessionFile) : false;
}

function hasSalvageAttempt(manager: SessionManager, id: string): boolean {
	for (const entry of manager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== SALVAGE_CUSTOM_TYPE) continue;
		const data = entry.data;
		if (typeof data === "object" && data !== null && "id" in data && data.id === id) return true;
	}
	return false;
}

async function journalSalvageAttempt(incident: FleetIncident, agentId: string): Promise<boolean> {
	const manager = AgentRegistry.global().get(MAIN_AGENT_ID)?.session?.sessionManager;
	if (!manager) return false;
	const id = `${incidentEventId(incident.id)}:salvage:${encodeURIComponent(agentId)}`;
	if (hasSalvageAttempt(manager, id)) return false;
	try {
		manager.appendCustomEntry(SALVAGE_CUSTOM_TYPE, {
			version: 1,
			id,
			incidentId: incident.id,
			failureClass: incident.failureClass,
			agent: agentId,
			attemptedAt: Date.now(),
		});
		await manager.flush();
		return true;
	} catch (error) {
		logger.warn("Could not journal fleet incident salvage attempt", {
			incidentId: incident.id,
			agent: agentId,
			error: String(error),
		});
		return false;
	}
}

async function sendIncidentResume(incident: FleetIncident, agentId: string): Promise<void> {
	const body = `Fleet infrastructure incident ${incident.id} has cleared. Resume the work interrupted by this ${incident.failureClass} incident from your journal.`;
	const receipt = await IrcBus.global().send({ from: MAIN_AGENT_ID, to: agentId, body, origin: "system" });
	if (receipt.outcome === "failed") {
		logger.warn("Fleet incident child salvage delivery failed", {
			incidentId: incident.id,
			agent: agentId,
			error: receipt.error,
		});
	}
}

async function shouldSalvageIncidentChild(_incident: FleetIncident, agentId: string): Promise<boolean> {
	const ref = AgentRegistry.global().get(agentId);
	return isFleetSalvageCandidate(ref) && !(await journalShowsUserCancellation(agentId));
}

async function salvageIncidentChild(incident: FleetIncident, agentId: string): Promise<void> {
	await salvageFleetIncidentAgent(incident, agentId, {
		resolveAgent: id => AgentRegistry.global().get(id),
		journalShowsUserCancellation,
		journalAttempt: journalSalvageAttempt,
		sendResume: sendIncidentResume,
	});
}

async function probeProviderConnectivity(): Promise<boolean> {
	try {
		await fetch(INCIDENT_PROBE_URL, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
		return true;
	} catch {
		return false;
	}
}

let runtimeCoordinator: FleetIncidentCoordinator | undefined;
let runtimeConfigKey: string | undefined;

function getRuntimeCoordinator(): FleetIncidentCoordinator | undefined {
	const mainSession = AgentRegistry.global().get(MAIN_AGENT_ID)?.session;
	if (!mainSession || !mainSession.settings.get("incidents.enabled")) return undefined;
	const windowMs = mainSession.settings.get("incidents.windowMs");
	const threshold = mainSession.settings.get("incidents.threshold");
	const configKey = `${windowMs}:${threshold}`;
	if (runtimeCoordinator && runtimeConfigKey === configKey) return runtimeCoordinator;
	if (runtimeCoordinator) {
		logger.warn("Fleet incident settings changed after detector start; new values apply on the next process start", {
			active: runtimeConfigKey,
			requested: configKey,
		});
		return runtimeCoordinator;
	}
	const store = new FleetIncidentStore(undefined, { windowMs, threshold });
	runtimeCoordinator = new FleetIncidentCoordinator(store, {
		notice: broadcastIncident,
		appendInbox: incident => appendIncidentInbox(incident, "open"),
		closed: incident => appendIncidentInbox(incident, "closed"),
		probe: probeProviderConnectivity,
		salvage: salvageIncidentChild,
		shouldSalvage: shouldSalvageIncidentChild,
	});
	runtimeConfigKey = configKey;
	return runtimeCoordinator;
}

/** Called only after the task failure ErrorInbox event was durably appended. */
export function observeFleetIncidentFailure(observation: FleetIncidentFailureObservation): void {
	if (observation.failureClass !== "network") return;
	getRuntimeCoordinator()?.recordFailure({
		evidenceKey: observation.evidenceKey,
		agent: observation.agent,
		job: observation.job,
		failureClass: "network",
		occurredAt: observation.occurredAt,
		journalUri: observation.journalUri,
		message: observation.message,
	});
}
