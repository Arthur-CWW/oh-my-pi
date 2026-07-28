import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { decodeRunManifest } from "../src/manifest"
import {
	decodeGuestFrameLine,
	decodeQmpFrameLine,
	encodeGuestRequestLine,
	GuestRequestSchema,
	QmpKvmSchema,
	type GuestRequest,
} from "../src/protocol"

const decodeGuestRequestLine = Schema.decodeUnknownSync(Schema.fromJsonString(GuestRequestSchema))
const decodeQmpKvm = Schema.decodeUnknownResult(QmpKvmSchema)

describe("guest wire protocol", () => {
	test("round-trips a typed request through the JSON wire codec", () => {
		const request = {
			id: 17,
			op: "probeFile",
			path: "/shared/result.json",
			includeText: true,
		} satisfies GuestRequest

		expect(decodeGuestRequestLine(encodeGuestRequestLine(request))).toEqual(request)
	})

	test("rejects malformed and shape-invalid guest frames", () => {
		expect(Result.isFailure(decodeGuestFrameLine("not-json"))).toBeTrue()
		expect(
			Result.isFailure(
				decodeGuestFrameLine(
					'{"kind":"event","event":"barrier","name":"ready","occurrence":"first","monotonicNs":1,"detail":{}}',
				),
			),
		).toBeTrue()
	})

	test("decodes QMP acceleration evidence before it enters the runner", () => {
		const frame = decodeQmpFrameLine('{"return":{"present":true,"enabled":false}}')
		expect(Result.isSuccess(frame)).toBeTrue()
		if (Result.isFailure(frame) || !("return" in frame.success)) return

		const kvm = decodeQmpKvm(frame.success.return)
		expect(Result.isSuccess(kvm)).toBeTrue()
		if (Result.isSuccess(kvm)) expect(kvm.success).toEqual({ present: true, enabled: false })
	})
})

describe("manifest boundary", () => {
	test("rejects an incomplete document that claims success", () => {
		expect(() => decodeRunManifest({ manifestVersion: 1, outcome: "passed" })).toThrow()
	})
})
