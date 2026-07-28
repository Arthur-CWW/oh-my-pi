import type {
	ProtocolRange,
	ProtocolVersion,
	WireAuthorityProof,
	WireBuildIdentity,
	WireCapability,
	WireFeatures,
} from "./common";
import { WireHelloRejectedError, type WireHelloRejectionReason } from "./errors";
import type { ClientHelloFrame, ServerHelloFrame } from "./frames";

export interface HelloNegotiationExpectation {
	readonly protocol: ProtocolRange;
	readonly sessionId: string;
	readonly ownerEpoch: string;
	readonly runnerInstanceId: string;
	readonly build: WireBuildIdentity;
	readonly authority: WireAuthorityProof;
	readonly grantedCapability: WireCapability;
	readonly features: WireFeatures;
}

function rejectHello(reason: WireHelloRejectionReason, message: string): never {
	throw new WireHelloRejectedError({ reason, message });
}

export function selectProtocolVersion(client: ProtocolRange, server: ProtocolRange): ProtocolVersion {
	if (client.minMajor > client.maxMajor || server.minMajor > server.maxMajor) {
		rejectHello("protocol-range-invalid", "A protocol range has a minimum major above its maximum major");
	}
	const major = Math.min(client.maxMajor, server.maxMajor);
	if (major < Math.max(client.minMajor, server.minMajor)) {
		rejectHello("protocol-version-mismatch", "Client and server protocol ranges do not overlap");
	}

	const minor = Math.min(client.maxMinor, server.maxMinor);
	return { major, minor };
}

export function negotiateClientHello(
	client: ClientHelloFrame,
	expected: HelloNegotiationExpectation,
): ServerHelloFrame {
	if (client.sessionId !== expected.sessionId) {
		rejectHello("session-mismatch", "Client hello session identity does not match the runner");
	}
	if (client.ownerEpoch !== expected.ownerEpoch) {
		rejectHello("owner-epoch-mismatch", "Client hello owner epoch does not match the runner");
	}
	if (client.runnerInstanceId !== expected.runnerInstanceId) {
		rejectHello("runner-instance-mismatch", "Client hello runner instance does not match the runner");
	}
	if (client.build.version !== expected.build.version || client.build.digest !== expected.build.digest) {
		rejectHello("build-mismatch", "Client hello build identity does not match the runner");
	}
	if (
		client.authority.uid !== expected.authority.uid ||
		client.authority.canonicalSessionPath !== expected.authority.canonicalSessionPath ||
		client.authority.namespaceDigest !== expected.authority.namespaceDigest
	) {
		rejectHello("authority-mismatch", "Client hello authority proof does not match the runner");
	}

	const clientFeatures = new Set(client.features);
	const features = [...new Set(expected.features.filter(feature => clientFeatures.has(feature)))];
	return {
		kind: "serverHello",
		correlationId: client.correlationId,
		selectedProtocol: selectProtocolVersion(client.protocol, expected.protocol),
		sessionId: expected.sessionId,
		ownerEpoch: expected.ownerEpoch,
		runnerInstanceId: expected.runnerInstanceId,
		build: expected.build,
		authority: expected.authority,
		grantedCapability: client.requestedCapability === "observer" ? "observer" : expected.grantedCapability,
		features,
	};
}
