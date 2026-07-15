import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import {
	classifyFleetCompatibility,
	createFleetCapability,
	createFleetCompatibilityProfile,
	selectFleetRolloutFeature,
} from "@oh-my-pi/pi-coding-agent/session/fleet-capability";
import {
	CURRENT_SESSION_CONTROL_PROTOCOL,
	selectSessionControlCommandKind,
} from "@oh-my-pi/pi-coding-agent/session/session-control";

const cleanupRoots: string[] = [];

async function tempDbPath(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-fleet-capability-"));
	cleanupRoots.push(root);
	return path.join(root, "irc.sqlite");
}

afterEach(async () => {
	for (const root of cleanupRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

const local = createFleetCompatibilityProfile(CURRENT_SESSION_CONTROL_PROTOCOL);
const capability = createFleetCapability({
	buildDigest: "sha256:fresh-build",
	productVersion: "9.1.0",
	controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
	workstream: { kind: "workstream", id: "fleet-rollout" },
});

describe("fleet capability advertisement and compatibility", () => {
	it("round-trips a fresh compatible heartbeat row", async () => {
		const bus = new IrcExternalBus(await tempDbPath());
		try {
			bus.registerPeer({
				sessionId: "session-fresh",
				name: "FreshPeer",
				cwd: "/workspace",
				buildDigest: capability.buildDigest,
				version: capability.productVersion,
				fleetCapability: capability,
			});
			const peer = bus.listPeers().find(candidate => candidate.sessionId === "session-fresh");
			expect(peer?.fleetCapability).toEqual(capability);
			expect(classifyFleetCompatibility(peer ?? {}, local)).toEqual({ kind: "compatible", reasons: [] });
		} finally {
			bus.close();
		}
	});

	it("classifies a strict v1 legacy peer without capability fields as LegacyIncompatible", () => {
		expect(classifyFleetCompatibility({}, local)).toEqual({
			kind: "LegacyIncompatible",
			reasons: ["peer did not advertise a recognized fleet capability"],
		});
	});

	it("blocks a newer control-protocol major with a reason", () => {
		const newerMajor = CURRENT_SESSION_CONTROL_PROTOCOL.maxMajor + 1;
		const newer = {
			...capability,
			controlProtocol: { minMajor: newerMajor, maxMajor: newerMajor, maxMinor: 0 },
		};
		const result = classifyFleetCompatibility({ fleetCapability: newer }, local);
		expect(result.kind).toBe("newer-blocked");
		expect(result.reasons.some(reason => reason.includes(`control protocol major range ${newerMajor}-${newerMajor}`))).toBe(true);
	});

	it("never selects unknown or unadvertised commands and rollout features", () => {
		expect(selectSessionControlCommandKind("future-command", CURRENT_SESSION_CONTROL_PROTOCOL, capability.controlProtocol)).toBeUndefined();
		expect(selectSessionControlCommandKind("status", CURRENT_SESSION_CONTROL_PROTOCOL, { minMajor: 2, maxMajor: 2, maxMinor: 0 })).toBeUndefined();
		expect(selectFleetRolloutFeature("future-rollout", local, { fleetCapability: capability })).toBeUndefined();
		expect(selectFleetRolloutFeature("prepare-rollout", local, { fleetCapability: capability })).toBeUndefined();
		expect(selectFleetRolloutFeature("status", local, { fleetCapability: capability })).toBe("status");
	});
});
