import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	IrcExternalBus,
	isIrcExternalPeerFresh,
	isIrcExternalPeerProcessAlive,
	type IrcExternalPeer,
} from "../irc/bus-external";
import { decodeJournalEntries, projectJournalEntries } from "../journal/projection";
import {
	resolveReleaseValidationPaths,
	validateFleetPinSelection,
	type ReleaseRegistryValidationOptions,
} from "../session/release-registry-validation";
import type { FleetPinChannel } from "../session/session-control";

const SHA256 = /^[0-9a-f]{64}$/;

function assertDigest(value: string, label: string): void {
	if (!SHA256.test(value)) throw new Error(`${label} must be a full 64-character lowercase SHA-256 digest`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function workstreamFromValue(value: unknown): string {
	if (isRecord(value) && value.kind === "workstream" && typeof value.id === "string" && value.id.length > 0) return value.id;
	if (isRecord(value) && value.kind === "adhoc") return "adhoc";
	return "unknown";
}

async function peerWorkstream(peer: IrcExternalPeer): Promise<string> {
	const advertised = peer.fleetCapability?.workstream;
	if (advertised) return workstreamFromValue(advertised);
	if (!peer.sessionFile) return "unknown";
	try {
		const projection = projectJournalEntries(decodeJournalEntries(await Bun.file(peer.sessionFile).text()));
		return projection ? workstreamFromValue(projection.header.workstream) : "unknown";
	} catch {
		return "unknown";
	}
}

export interface FleetResolvedPeer {
	readonly peer: IrcExternalPeer;
	readonly workstream: string;
}

export interface FleetSelectorOptions {
	readonly selectors?: readonly string[];
	readonly workstream?: string;
	readonly all?: boolean;
	readonly nowMs?: number;
	readonly ircDbPath?: string;
	readonly isProcessAlive?: (pid: number) => boolean;
	readonly bus?: IrcExternalBus;
}

export function selectorMatches(selector: string, target: FleetResolvedPeer): boolean {
	const value = selector.startsWith("workstream:") ? selector.slice("workstream:".length) : selector;
	return target.peer.sessionId === selector || target.peer.name === selector || target.workstream === value;
}

/** Resolves exact session IDs, peer handles, and durable workstream selectors. */
export async function resolveFleetSelectors(options: FleetSelectorOptions = {}): Promise<readonly FleetResolvedPeer[]> {
	const bus = options.bus ?? new IrcExternalBus(options.ircDbPath, { readonly: true });
	const ownsBus = options.bus === undefined;
	try {
		const allPeers = bus.listPeers({ includeStale: true });
		const targets: FleetResolvedPeer[] = [];
		for (const peer of allPeers) {
			const fresh = isIrcExternalPeerFresh(peer.lastSeen, options.nowMs);
			if (!fresh) {
				const isAlive = (options.isProcessAlive ?? isIrcExternalPeerProcessAlive)(peer.pid);
				const isIdle = peer.state === "idle" || peer.state === "waiting_input";
				if (!isAlive || (!options.all && !isIdle)) continue;
			}
			const workstream = await peerWorkstream(peer);
			if (options.workstream && workstream !== options.workstream && workstream !== `workstream:${options.workstream}`) continue;
			targets.push({ peer, workstream });
		}
		const selectors = (options.selectors ?? []).filter(value => value.trim().length > 0);
		if (selectors.length === 0) return targets;
		const selected: FleetResolvedPeer[] = [];
		for (const selector of selectors) {
			const matches = targets.filter(target => selectorMatches(selector, target));
			if (matches.length === 0) throw new Error(`No fleet target matches selector ${selector}`);
			for (const match of matches) if (!selected.some(item => item.peer.sessionId === match.peer.sessionId)) selected.push(match);
		}
		return selected;
	} finally {
		if (ownsBus) bus.close();
	}
}

export interface FleetReleaseSelection {
	readonly requestedChannel: FleetPinChannel;
	readonly resolvedDigest: string;
	readonly readinessReceipt: { readonly json: string; readonly digest: string };
	readonly version: string;
	readonly releaseStoreDir: string;
	readonly registry: FleetReleaseRegistry;
}

export interface FleetReleaseRegistry {
	readonly stable: string | null;
	readonly previous: string | null;
	readonly candidate: string | null;
	readonly receiptDigest: string | null;
}

export interface ReleaseRegistryOptions extends ReleaseRegistryValidationOptions {
	readonly readinessDir?: string;
	readonly readinessJson?: string;
}

export async function readRegistry(paths: { readonly registryPath: string }): Promise<FleetReleaseRegistry> {
	let value: unknown;
	try {
		value = JSON.parse(await fs.readFile(paths.registryPath, "utf8"));
	} catch (error) {
		throw new Error(`Release registry is unavailable: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(value) || value.schemaVersion !== 1 || !["stable", "previous", "candidate", "receiptDigest", "timestamps"].every(key => Object.hasOwn(value, key))) {
		throw new Error("Release registry has unexpected fields or schema");
	}
	for (const key of ["stable", "previous", "candidate", "receiptDigest"] as const) {
		const digest = value[key];
		if (digest !== null && (typeof digest !== "string" || !SHA256.test(digest))) throw new Error(`Release registry ${key} is invalid`);
	}
	return {
		stable: value.stable as string | null,
		previous: value.previous as string | null,
		candidate: value.candidate as string | null,
		receiptDigest: value.receiptDigest as string | null,
	};
}

export async function readinessForDigest(digest: string, options: ReleaseRegistryOptions): Promise<{ readonly json: string; readonly digest: string; readonly version: string }> {
	if (options.readinessJson !== undefined) {
		const version = parseReadinessVersion(options.readinessJson);
		return { json: options.readinessJson, digest: createHash("sha256").update(options.readinessJson, "utf8").digest("hex"), version };
	}
	const roots = [
		options.readinessDir ?? process.env.OMP_FLEET_READINESS_DIR,
		path.resolve(process.cwd(), "vendor/oh-my-pi/local"),
		path.resolve(process.cwd(), "local"),
	].filter((value): value is string => typeof value === "string" && value.length > 0);
	const filename = `readiness-receipt-${digest}.json`;
	for (const root of roots) {
		try {
			const json = await fs.readFile(path.join(root, filename), "utf8");
			return { json, digest: createHash("sha256").update(json, "utf8").digest("hex"), version: parseReadinessVersion(json) };
		} catch {
			// Continue through the explicit and repository-local readiness roots.
		}
	}
	throw new Error(`Readiness receipt for ${digest} is unavailable`);
}

function parseReadinessVersion(json: string): string {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		throw new Error("Readiness receipt is not valid JSON");
	}
	if (!isRecord(value) || typeof value.version !== "string" || value.version.length === 0) throw new Error("Readiness receipt version is invalid");
	return value.version;
}

export async function resolveFleetRelease(options: {
	readonly requestedChannel: FleetPinChannel;
	readonly explicitDigest?: string;
	readonly validation?: ReleaseRegistryOptions;
}): Promise<FleetReleaseSelection> {
	const validation = options.validation ?? {};
	const paths = resolveReleaseValidationPaths(validation);
	const registry = await readRegistry(paths);
	let digest: string;
	switch (options.requestedChannel) {
		case "digest":
			if (!options.explicitDigest) throw new Error("Digest channel requires --digest");
			digest = options.explicitDigest;
			break;
		case "blessed":
			digest = registry.stable ?? (() => { throw new Error("Release registry has no blessed stable digest"); })();
			break;
		case "canary":
			digest = registry.candidate ?? (() => { throw new Error("Release registry has no candidate digest"); })();
			break;
	}
	assertDigest(digest, "Resolved release digest");
	const readiness = await readinessForDigest(digest, validation);
	const selection = {
		requestedChannel: options.requestedChannel,
		resolvedDigest: digest,
		readinessReceipt: { json: readiness.json, digest: readiness.digest },
	};
	await validateFleetPinSelection(selection, validation);
	return { ...selection, version: readiness.version, releaseStoreDir: paths.releasesDir, registry };
}
