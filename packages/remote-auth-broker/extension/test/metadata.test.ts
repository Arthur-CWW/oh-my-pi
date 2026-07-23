import { describe, expect, test } from "bun:test"
import { serializePublicStatus, serializeReceipt } from "../metadata.ts"
import {
  PROTOCOL_VERSION,
  ProtocolValidationError,
  decodeExecutionRequest,
  decodePublicStatus,
  decodeReceipt,
  type PublicError,
} from "../protocol.ts"
import { protocolFixture, requestVector } from "./vector-fixture.ts"

function expectProtocolError(action: () => unknown, code: PublicError): void {
  try {
    action()
    throw new Error("Expected metadata validation to fail")
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolValidationError)
    if (!(error instanceof ProtocolValidationError)) return
    expect(error.code).toBe(code)
    expect(error.message.length).toBeLessThanOrEqual(128)
  }
}

function successfulGdmReceipt(): unknown {
  const request = decodeExecutionRequest(requestVector("gdm-delegated").request)
  return {
    protocolVersion: PROTOCOL_VERSION,
    receiptId: protocolFixture.gdmCryptoVector.issueId,
    requestId: request.requestId,
    grantId: request.grantId,
    domain: "desktop-browser",
    operation: "gdm-login",
    authorizationModeUsed: "delegated",
    targetFingerprint: "7777777777777777777777777777777777777777777777777777777777777777",
    state: "succeeded",
    errorCode: null,
    events: {
      requestedAt: 1_700_000_000_000,
      authorizedAt: 1_700_000_000_001,
      executingAt: 1_700_000_000_002,
      terminalAt: 1_700_000_000_003,
    },
    policyDigest: "6666666666666666666666666666666666666666666666666666666666666666",
    brokerBuildDigest: "8888888888888888888888888888888888888888888888888888888888888888",
    brokerCodeDigest: "9999999999999999999999999999999999999999999999999999999999999999",
    targetReleaseDisposition: "not-applicable",
    browserTargetGeneration: null,
  }
}

function inactiveStatus(): unknown {
  const inactiveEndpoint = { ready: false, errorCode: "inactive" }
  return {
    protocolVersion: PROTOCOL_VERSION,
    canonicalStatus: "DESIGN/INACTIVE",
    policyDigest: null,
    installedBuildDigest: null,
    runningBuildDigest: null,
    codeIdentity: null,
    pid: null,
    socketPosture: "absent",
    jetkvmControllerGeneration: null,
    gdm: inactiveEndpoint,
    browser: inactiveEndpoint,
    sudo: inactiveEndpoint,
    errors: ["inactive"],
  }
}

describe("metadata-only receipt output", () => {
  test("serializes only the closed receipt schema", () => {
    const receipt = decodeReceipt(successfulGdmReceipt())
    const serialized = serializeReceipt(receipt)
    const serializedInput: unknown = JSON.parse(serialized)
    expect(decodeReceipt(serializedInput)).toEqual(receipt)
    expect(serialized).not.toContain("password")
    expect(serialized).not.toContain("sentinel")
    expect(serialized).not.toContain("ciphertext")
  })

  test("rejects secret-bearing or debug fields rather than stripping them", () => {
    const receipt = decodeReceipt(successfulGdmReceipt())
    expectProtocolError(
      () => decodeReceipt({ ...receipt, password: "credential-canary" }),
      "excess-field",
    )
  })

  test("requires terminal errors and operation-specific release metadata", () => {
    const receipt = decodeReceipt(successfulGdmReceipt())
    expectProtocolError(
      () => decodeReceipt({ ...receipt, state: "failed", errorCode: null }),
      "noncanonical-value",
    )
    expectProtocolError(
      () => decodeReceipt({ ...receipt, targetReleaseDisposition: "quarantined" }),
      "noncanonical-value",
    )
  })
})

describe("metadata-only public status output", () => {
  test("serializes an exact DESIGN/INACTIVE status", () => {
    const status = decodePublicStatus(inactiveStatus())
    const serialized = serializePublicStatus(status)
    const serializedInput: unknown = JSON.parse(serialized)
    expect(decodePublicStatus(serializedInput)).toEqual(status)
    expect(serialized).not.toContain("credential")
  })

  test("rejects excess fields, duplicate errors, and incoherent endpoints", () => {
    const status = decodePublicStatus(inactiveStatus())
    expectProtocolError(
      () => decodePublicStatus({ ...status, diagnostic: "raw broker output" }),
      "excess-field",
    )
    expectProtocolError(
      () => decodePublicStatus({ ...status, errors: ["inactive", "inactive"] }),
      "noncanonical-value",
    )
    expectProtocolError(
      () => decodePublicStatus({ ...status, gdm: { ready: false, errorCode: null } }),
      "noncanonical-value",
    )
  })
})
