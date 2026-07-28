import { describe, expect, it } from "bun:test";
import {
	type ClientHelloFrame,
	decodeClientHelloFrame,
	decodeEventFrame,
	decodeRequestFrame,
	decodeResponseFrame,
	decodeResyncRequiredFrame,
	decodeServerHelloFrame,
	decodeSnapshotChunkFrame,
	decodeWireFrameJson,
	type EventFrame,
	encodeLengthPrefixedWireFrame,
	encodeWireFrameJson,
	type HelloNegotiationExpectation,
	IncrementalWireFrameDecoder,
	negotiateClientHello,
	type SnapshotChunkFrame,
	WireDecodeError,
	WireEventSequenceTracker,
	WireFrameOversizeError,
	WireHelloRejectedError,
	WireResyncRequiredError,
	WireSnapshotReassembler,
} from "../../../src/runner/wire";

const authority = {
	uid: 501,
	canonicalSessionPath: "/tmp/session.jsonl",
	namespaceDigest: "namespace-digest",
} as const;
const build = { version: "16.0.1", digest: "build-digest" } as const;
const clientHello: ClientHelloFrame = {
	kind: "clientHello",
	correlationId: "hello-1",
	protocol: { minMajor: 1, maxMajor: 1, maxMinor: 3 },
	sessionId: "session-1",
	ownerEpoch: "epoch-1",
	runnerInstanceId: "runner-1",
	build,
	authority,
	requestedCapability: "controller",
	features: ["snapshot-pages", "event-resync"],
};
const expectation: HelloNegotiationExpectation = {
	protocol: { minMajor: 1, maxMajor: 1, maxMinor: 2 },
	sessionId: clientHello.sessionId,
	ownerEpoch: clientHello.ownerEpoch,
	runnerInstanceId: clientHello.runnerInstanceId,
	build,
	authority,
	grantedCapability: "controller",
	features: ["event-resync", "server-only"],
};

const frames = [
	clientHello,
	{
		kind: "serverHello",
		correlationId: "hello-1",
		selectedProtocol: { major: 1, minor: 2 },
		sessionId: "session-1",
		ownerEpoch: "epoch-1",
		runnerInstanceId: "runner-1",
		build,
		authority,
		grantedCapability: "controller",
		features: ["event-resync"],
	},
	{
		kind: "request",
		correlationId: "command-1",
		requestId: "request-1",
		operation: "submitInput",
		payload: { text: "hello", deliveryClass: "followUp" },
	},
	{
		kind: "response",
		correlationId: "command-1",
		requestId: "request-1",
		ok: true,
		result: { revision: 4 },
	},
	{
		kind: "response",
		correlationId: "command-2",
		requestId: "request-2",
		ok: false,
		error: {
			tag: "WireResyncRequiredError",
			message: "event gap",
			details: { reason: "event-sequence-gap", expectedSequence: 8, observedSequence: 10 },
		},
	},
	{
		kind: "event",
		correlationId: "stream-1",
		eventId: "event-8",
		sequence: 8,
		eventType: "inputPrepared",
		payload: { inputId: "input-1" },
	},
	{
		kind: "snapshotChunk",
		correlationId: "snapshot-request-1",
		snapshotId: "snapshot-1",
		chunkIndex: 0,
		chunkTotal: 1,
		baselineSeq: 7,
		page: { entries: ["a", "b"] },
	},
	{
		kind: "resyncRequired",
		correlationId: "stream-1",
		expectedSequence: 8,
		observedSequence: 10,
	},
] as const;

describe("wire frame schemas", () => {
	it("round-trips every frame kind through strict JSON codecs", () => {
		for (const frame of frames) {
			const encoded = encodeWireFrameJson(frame);
			expect(decodeWireFrameJson(encoded)).toEqual(frame);
		}
	});

	it("provides a strict decoder for every frame kind", () => {
		expect(decodeClientHelloFrame(frames[0])).toEqual(frames[0]);
		expect(decodeServerHelloFrame(frames[1])).toEqual(frames[1]);
		expect(decodeRequestFrame(frames[2])).toEqual(frames[2]);
		expect(decodeResponseFrame(frames[3])).toEqual(frames[3]);
		expect(decodeResponseFrame(frames[4])).toEqual(frames[4]);
		expect(decodeEventFrame(frames[5])).toEqual(frames[5]);
		expect(decodeSnapshotChunkFrame(frames[6])).toEqual(frames[6]);
		expect(decodeResyncRequiredFrame(frames[7])).toEqual(frames[7]);
		expect(() => decodeEventFrame({ ...frames[5], unexpected: "secret" })).toThrow(WireDecodeError);
	});

	it("reports only the offending kind and byte length on decode failure", () => {
		const bytes = new TextEncoder().encode('{"kind":"event","payload":"do-not-echo"}');
		try {
			decodeWireFrameJson(bytes);
			throw new Error("expected decode failure");
		} catch (error) {
			expect(error).toBeInstanceOf(WireDecodeError);
			const decodeError = error as WireDecodeError;
			expect(decodeError.frameKind).toBe("event");
			expect(decodeError.byteLength).toBe(bytes.byteLength);
			expect(JSON.stringify(decodeError)).not.toContain("do-not-echo");
		}
	});
});

describe("length-prefixed framing", () => {
	it("incrementally decodes split headers and payloads plus merged frames", () => {
		const first = encodeLengthPrefixedWireFrame(frames[2], 4096);
		const second = encodeLengthPrefixedWireFrame(frames[5], 4096);
		const merged = new Uint8Array(first.byteLength + second.byteLength);
		merged.set(first);
		merged.set(second, first.byteLength);
		const decoder = new IncrementalWireFrameDecoder(4096);

		expect(decoder.push(merged.subarray(0, 2))).toEqual([]);
		expect(decoder.push(merged.subarray(2, first.byteLength - 1))).toEqual([]);
		expect(decoder.push(merged.subarray(first.byteLength - 1))).toEqual([frames[2], frames[5]]);
	});

	it("rejects oversized encoded and announced frames without truncation", () => {
		expect(() => encodeLengthPrefixedWireFrame(frames[2], 8)).toThrow(WireFrameOversizeError);
		const announced = new Uint8Array([0, 0, 1, 0, 123]);
		const decoder = new IncrementalWireFrameDecoder(64);
		try {
			decoder.push(announced);
			throw new Error("expected oversize failure");
		} catch (error) {
			expect(error).toBeInstanceOf(WireFrameOversizeError);
			expect((error as WireFrameOversizeError).announcedByteLength).toBe(256);
		}
	});
});

describe("hello negotiation", () => {
	it("selects the highest mutually supported version and echoes runner identity", () => {
		expect(negotiateClientHello(clientHello, expectation)).toEqual({
			kind: "serverHello",
			correlationId: clientHello.correlationId,
			selectedProtocol: { major: 1, minor: 2 },
			sessionId: expectation.sessionId,
			ownerEpoch: expectation.ownerEpoch,
			runnerInstanceId: expectation.runnerInstanceId,
			build,
			authority,
			grantedCapability: "controller",
			features: ["event-resync"],
		});
	});

	it("returns a typed refusal for incompatible protocol ranges", () => {
		try {
			negotiateClientHello(clientHello, { ...expectation, protocol: { minMajor: 2, maxMajor: 2, maxMinor: 0 } });
			throw new Error("expected hello rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(WireHelloRejectedError);
			expect((error as WireHelloRejectedError).reason).toBe("protocol-version-mismatch");
		}
	});

	it("returns a typed refusal for runner identity mismatch", () => {
		try {
			negotiateClientHello({ ...clientHello, runnerInstanceId: "stale-runner" }, expectation);
			throw new Error("expected hello rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(WireHelloRejectedError);
			expect((error as WireHelloRejectedError).reason).toBe("runner-instance-mismatch");
		}
	});
});

describe("snapshot and event sequencing", () => {
	it("reassembles ordered pages from one baseline and resumes at baseline plus one", () => {
		const chunks: SnapshotChunkFrame[] = [
			{
				kind: "snapshotChunk",
				correlationId: "snapshot-request-1",
				snapshotId: "snapshot-1",
				chunkIndex: 0,
				chunkTotal: 2,
				baselineSeq: 7,
				page: { entries: ["first"] },
			},
			{
				kind: "snapshotChunk",
				correlationId: "snapshot-request-1",
				snapshotId: "snapshot-1",
				chunkIndex: 1,
				chunkTotal: 2,
				baselineSeq: 7,
				page: { entries: ["second"] },
			},
		];
		const reassembler = new WireSnapshotReassembler();
		expect(reassembler.push(chunks[0])).toBeUndefined();
		const snapshot = reassembler.push(chunks[1]);
		expect(snapshot).toEqual({
			correlationId: "snapshot-request-1",
			snapshotId: "snapshot-1",
			baselineSeq: 7,
			pages: [{ entries: ["first"] }, { entries: ["second"] }],
		});
		const tracker = new WireEventSequenceTracker(snapshot!.baselineSeq);
		tracker.accept(frames[5] as EventFrame);
		expect(tracker.lastSequence).toBe(8);
	});

	it("turns an event gap into a typed resync requirement", () => {
		const tracker = new WireEventSequenceTracker(7);
		try {
			tracker.accept({ ...frames[5], sequence: 10 } as EventFrame);
			throw new Error("expected resync requirement");
		} catch (error) {
			expect(error).toBeInstanceOf(WireResyncRequiredError);
			const resync = error as WireResyncRequiredError;
			expect(resync.reason).toBe("event-sequence-gap");
			expect(resync.expectedSequence).toBe(8);
			expect(resync.observedSequence).toBe(10);
		}
	});
});
