import { CURRENT_SESSION_VERSION, decodeSessionWorkstream, type SessionWorkstream } from "./session-entries";

export const FLEET_CAPABILITY_ENVELOPE_MAJOR = 1 as const;
export const IRC_FLEET_ENVELOPE_MAJOR = 1 as const;
export const VIEW_PROTOCOL_MAJOR = 1 as const;

export interface FleetProtocolRange {
	readonly minMajor: number;
	readonly maxMajor: number;
	readonly maxMinor: number;
}

export interface FleetJournalSchemaRange {
	readonly read: FleetProtocolRange;
	readonly write: FleetProtocolRange;
}

export const FLEET_ROLLOUT_FEATURES = ["status", "prepare-rollout", "rollout-checkpoint"] as const;
export type FleetRolloutFeature = (typeof FLEET_ROLLOUT_FEATURES)[number];

export const POLICY_APPLY_FEATURES = ["policy-apply-v1"] as const;
export type FleetPolicyApplyFeature = (typeof POLICY_APPLY_FEATURES)[number];
export interface FleetCapability {
	readonly envelopeMajor: typeof FLEET_CAPABILITY_ENVELOPE_MAJOR;
	readonly buildDigest: string;
	readonly productVersion: string;
	readonly journalSchema: FleetJournalSchemaRange;
	readonly controlProtocol: FleetProtocolRange;
	readonly ircEnvelope: { readonly major: number };
	readonly viewProtocol: FleetProtocolRange;
	readonly rolloutFeatures: readonly FleetRolloutFeature[];
	readonly policyJournalSchema?: FleetJournalSchemaRange;
	readonly policyApplyFeatures?: readonly FleetPolicyApplyFeature[];
	readonly workstream?: SessionWorkstream;
}

export interface FleetCompatibilityProfile {
	readonly journalSchema: FleetJournalSchemaRange;
	readonly controlProtocol: FleetProtocolRange;
	readonly ircEnvelope: { readonly major: number };
	readonly viewProtocol: FleetProtocolRange;
	readonly rolloutFeatures: readonly FleetRolloutFeature[];
	readonly policyJournalSchema: FleetJournalSchemaRange;
	readonly policyApplyFeatures: readonly FleetPolicyApplyFeature[];
}

export type FleetCompatibilityResult =
	| { readonly kind: "compatible"; readonly reasons: readonly [] }
	| { readonly kind: "LegacyIncompatible" | "newer-blocked"; readonly reasons: readonly string[] };

const RELEASE_DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/i;
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function classifyFleetBuildProvenance(peer: {
	readonly buildDigest?: string;
	readonly version?: string;
	readonly fleetCapability?: unknown;
}): { readonly valid: true } | { readonly valid: false; readonly reason: string } {
	const capability = decodeFleetCapability(peer.fleetCapability);
	if (!capability) return { valid: false, reason: "peer did not advertise a recognized fleet capability" };
	if (
		!peer.buildDigest ||
		!RELEASE_DIGEST.test(peer.buildDigest) ||
		/^sha256:0{64}$/i.test(peer.buildDigest) ||
		/^0{64}$/.test(peer.buildDigest)
	) {
		return { valid: false, reason: "peer build digest is not a nonzero release SHA-256" };
	}
	if (!peer.version || !RELEASE_VERSION.test(peer.version)) {
		return { valid: false, reason: "peer product version is not a release version" };
	}
	if (capability.buildDigest !== peer.buildDigest || capability.productVersion !== peer.version) {
		return { valid: false, reason: "peer build provenance does not match its fleet capability" };
	}
	return { valid: true };
}

const CURRENT_JOURNAL_SCHEMA: FleetJournalSchemaRange = {
	read: { minMajor: 1, maxMajor: CURRENT_SESSION_VERSION, maxMinor: 0 },
	write: { minMajor: CURRENT_SESSION_VERSION, maxMajor: CURRENT_SESSION_VERSION, maxMinor: 0 },
};
const CURRENT_POLICY_JOURNAL_SCHEMA: FleetJournalSchemaRange = {
	read: { minMajor: 1, maxMajor: 1, maxMinor: 0 },
	write: { minMajor: 1, maxMajor: 1, maxMinor: 0 },
};
const CURRENT_VIEW_PROTOCOL: FleetProtocolRange = {
	minMajor: VIEW_PROTOCOL_MAJOR,
	maxMajor: VIEW_PROTOCOL_MAJOR,
	maxMinor: 0,
};
const KNOWN_FEATURES: Record<FleetRolloutFeature, true> = {
	status: true,
	"prepare-rollout": true,
	"rollout-checkpoint": true,
};

export function createFleetCompatibilityProfile(
	controlProtocol: FleetProtocolRange,
	rolloutFeatures: readonly FleetRolloutFeature[] = FLEET_ROLLOUT_FEATURES,
	policyApplyFeatures: readonly FleetPolicyApplyFeature[] = POLICY_APPLY_FEATURES,
): FleetCompatibilityProfile {
	return {
		journalSchema: CURRENT_JOURNAL_SCHEMA,
		policyJournalSchema: CURRENT_POLICY_JOURNAL_SCHEMA,
		controlProtocol,
		ircEnvelope: { major: IRC_FLEET_ENVELOPE_MAJOR },
		viewProtocol: CURRENT_VIEW_PROTOCOL,
		rolloutFeatures,
		policyApplyFeatures,
	};
}

export function createFleetCapability(args: {
	readonly buildDigest: string;
	readonly productVersion: string;
	readonly controlProtocol: FleetProtocolRange;
	readonly rolloutFeatures?: readonly FleetRolloutFeature[];
	readonly policyApplyFeatures?: readonly FleetPolicyApplyFeature[];
	readonly workstream?: SessionWorkstream;
}): FleetCapability {
	return {
		envelopeMajor: FLEET_CAPABILITY_ENVELOPE_MAJOR,
		buildDigest: args.buildDigest,
		productVersion: args.productVersion,
		...createFleetCompatibilityProfile(args.controlProtocol, args.rolloutFeatures, args.policyApplyFeatures),
		...(args.workstream === undefined ? {} : { workstream: args.workstream }),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeProtocolRange(value: unknown): FleetProtocolRange | undefined {
	if (!isRecord(value)) return undefined;
	const { minMajor, maxMajor, maxMinor } = value;
	if (
		typeof minMajor !== "number" ||
		!Number.isSafeInteger(minMajor) ||
		minMajor < 1 ||
		typeof maxMajor !== "number" ||
		!Number.isSafeInteger(maxMajor) ||
		maxMajor < minMajor ||
		typeof maxMinor !== "number" ||
		!Number.isSafeInteger(maxMinor) ||
		maxMinor < 0
	) {
		return undefined;
	}
	return { minMajor, maxMajor, maxMinor };
}

export function decodeFleetCapability(value: unknown): FleetCapability | undefined {
	if (!isRecord(value) || value.envelopeMajor !== FLEET_CAPABILITY_ENVELOPE_MAJOR) return undefined;
	if (typeof value.buildDigest !== "string" || value.buildDigest.length === 0) return undefined;
	if (typeof value.productVersion !== "string" || value.productVersion.length === 0) return undefined;
	if (!isRecord(value.journalSchema)) return undefined;
	const read = decodeProtocolRange(value.journalSchema.read);
	const write = decodeProtocolRange(value.journalSchema.write);
	const controlProtocol = decodeProtocolRange(value.controlProtocol);
	const viewProtocol = decodeProtocolRange(value.viewProtocol);
	if (!read || !write || !controlProtocol || !viewProtocol) return undefined;
	if (
		!isRecord(value.ircEnvelope) ||
		!Number.isSafeInteger(value.ircEnvelope.major) ||
		(value.ircEnvelope.major as number) < 1
	) {
		return undefined;
	}
	if (!Array.isArray(value.rolloutFeatures) || value.rolloutFeatures.some(feature => typeof feature !== "string")) {
		return undefined;
	}
	const policyJournalSchema =
		value.policyJournalSchema === undefined
			? undefined
			: isRecord(value.policyJournalSchema)
				? (() => {
						const policyRead = decodeProtocolRange(value.policyJournalSchema.read);
						const policyWrite = decodeProtocolRange(value.policyJournalSchema.write);
						return policyRead && policyWrite ? { read: policyRead, write: policyWrite } : undefined;
					})()
				: undefined;
	if (value.policyJournalSchema !== undefined && !policyJournalSchema) return undefined;
	const policyApplyFeatures =
		value.policyApplyFeatures === undefined
			? undefined
			: Array.isArray(value.policyApplyFeatures) &&
					value.policyApplyFeatures.every(feature => typeof feature === "string")
				? value.policyApplyFeatures.filter(
						(feature): feature is FleetPolicyApplyFeature =>
							typeof feature === "string" && POLICY_APPLY_FEATURES.includes(feature as FleetPolicyApplyFeature),
					)
				: undefined;
	if (value.policyApplyFeatures !== undefined && !policyApplyFeatures) return undefined;
	const workstream = value.workstream === undefined ? undefined : decodeSessionWorkstream(value.workstream);
	if (value.workstream !== undefined && workstream === undefined) return undefined;
	const rolloutFeatures = value.rolloutFeatures.filter(
		(feature): feature is FleetRolloutFeature => typeof feature === "string" && feature in KNOWN_FEATURES,
	);
	return {
		envelopeMajor: FLEET_CAPABILITY_ENVELOPE_MAJOR,
		buildDigest: value.buildDigest,
		productVersion: value.productVersion,
		journalSchema: { read, write },
		controlProtocol,
		ircEnvelope: { major: value.ircEnvelope.major as number },
		viewProtocol,
		rolloutFeatures,
		...(policyJournalSchema === undefined ? {} : { policyJournalSchema }),
		...(policyApplyFeatures === undefined ? {} : { policyApplyFeatures }),
		...(workstream === undefined ? {} : { workstream }),
	};
}

function rangesIntersect(left: FleetProtocolRange, right: FleetProtocolRange): boolean {
	return Math.max(left.minMajor, right.minMajor) <= Math.min(left.maxMajor, right.maxMajor);
}

function incompatibilityKind(
	peer: FleetProtocolRange,
	local: FleetProtocolRange,
): "LegacyIncompatible" | "newer-blocked" {
	return peer.minMajor > local.maxMajor ? "newer-blocked" : "LegacyIncompatible";
}

export function classifyFleetCompatibility(
	peer: { readonly fleetCapability?: unknown },
	local: FleetCompatibilityProfile,
): FleetCompatibilityResult {
	const advertised = peer.fleetCapability;
	if (
		isRecord(advertised) &&
		typeof advertised.envelopeMajor === "number" &&
		Number.isSafeInteger(advertised.envelopeMajor) &&
		advertised.envelopeMajor > FLEET_CAPABILITY_ENVELOPE_MAJOR
	) {
		return {
			kind: "newer-blocked",
			reasons: [
				`fleet capability envelope major ${advertised.envelopeMajor} is newer than local ${FLEET_CAPABILITY_ENVELOPE_MAJOR}`,
			],
		};
	}
	const capability = decodeFleetCapability(advertised);
	if (!capability)
		return { kind: "LegacyIncompatible", reasons: ["peer did not advertise a recognized fleet capability"] };
	const legacyReasons: string[] = [];
	const newerReasons: string[] = [];
	const checkRange = (name: string, peerRange: FleetProtocolRange, localRange: FleetProtocolRange): void => {
		if (rangesIntersect(peerRange, localRange)) return;
		const reason = `${name} major range ${peerRange.minMajor}-${peerRange.maxMajor} does not intersect local ${localRange.minMajor}-${localRange.maxMajor}`;
		(incompatibilityKind(peerRange, localRange) === "newer-blocked" ? newerReasons : legacyReasons).push(reason);
	};
	checkRange("journal write/read", capability.journalSchema.write, local.journalSchema.read);
	checkRange("journal read/write", capability.journalSchema.read, local.journalSchema.write);
	checkRange("control protocol", capability.controlProtocol, local.controlProtocol);
	checkRange("view protocol", capability.viewProtocol, local.viewProtocol);
	if (capability.policyJournalSchema) {
		checkRange("policy journal write/read", capability.policyJournalSchema.write, local.policyJournalSchema.read);
		checkRange("policy journal read/write", capability.policyJournalSchema.read, local.policyJournalSchema.write);
	}
	if (capability.ircEnvelope.major !== local.ircEnvelope.major) {
		const reason = `IRC envelope major ${capability.ircEnvelope.major} does not match local ${local.ircEnvelope.major}`;
		(capability.ircEnvelope.major > local.ircEnvelope.major ? newerReasons : legacyReasons).push(reason);
	}
	if (newerReasons.length > 0) return { kind: "newer-blocked", reasons: [...newerReasons, ...legacyReasons] };
	if (legacyReasons.length > 0) return { kind: "LegacyIncompatible", reasons: legacyReasons };
	return { kind: "compatible", reasons: [] };
}

export function intersectFleetRolloutFeatures(
	controller: Pick<FleetCompatibilityProfile, "rolloutFeatures">,
	peer: { readonly fleetCapability?: unknown },
): readonly FleetRolloutFeature[] {
	const capability = decodeFleetCapability(peer.fleetCapability);
	if (!capability) return [];
	const peerFeatures = new Set(capability.rolloutFeatures);
	return controller.rolloutFeatures.filter(feature => feature in KNOWN_FEATURES && peerFeatures.has(feature));
}

export function selectFleetRolloutFeature(
	requested: string,
	controller: Pick<FleetCompatibilityProfile, "rolloutFeatures">,
	peer: { readonly fleetCapability?: unknown },
): FleetRolloutFeature | undefined {
	if (!(requested in KNOWN_FEATURES)) return undefined;
	return intersectFleetRolloutFeatures(controller, peer).find(feature => feature === requested);
}
export function intersectPolicyApplyFeatures(
	controller: Pick<FleetCompatibilityProfile, "policyApplyFeatures">,
	peer: { readonly fleetCapability?: unknown },
): readonly FleetPolicyApplyFeature[] {
	const capability = decodeFleetCapability(peer.fleetCapability);
	if (!capability?.policyApplyFeatures) return [];
	const peerFeatures = new Set(capability.policyApplyFeatures);
	return controller.policyApplyFeatures.filter(feature => peerFeatures.has(feature));
}

export function selectPolicyApplyFeature(
	requested: string,
	controller: Pick<FleetCompatibilityProfile, "policyApplyFeatures">,
	peer: { readonly fleetCapability?: unknown },
): FleetPolicyApplyFeature | undefined {
	if (!POLICY_APPLY_FEATURES.includes(requested as FleetPolicyApplyFeature)) return undefined;
	return intersectPolicyApplyFeatures(controller, peer).find(feature => feature === requested);
}
