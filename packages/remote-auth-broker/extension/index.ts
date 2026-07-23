import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"
import { RemoteAuthClient } from "./client.ts"
import type { RemoteAuthResponseEnvelope } from "./client.ts"
import type { PublicError } from "./protocol.ts"
import type { SessionOwnershipSource } from "./runtime.ts"
import {
  publicErrorFrom,
  REMOTE_AUTH_RUNTIME_ACTIVE,
  RemoteAuthRuntime,
} from "./runtime.ts"

export type RemoteAuthToolDetails =
  | { readonly ok: true; readonly response: RemoteAuthResponseEnvelope }
  | { readonly ok: false; readonly errorCode: PublicError }

function sessionOwnershipSource(value: unknown): SessionOwnershipSource | undefined {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined

  let getSessionOwnershipView: unknown
  try {
    getSessionOwnershipView = Reflect.get(value, "getSessionOwnershipView")
  } catch {
    return undefined
  }
  if (typeof getSessionOwnershipView !== "function") return undefined

  return {
    getSessionOwnershipView: () => Reflect.apply(getSessionOwnershipView, value, []),
  }
}

export default function registerRemoteAuth(pi: ExtensionAPI): void {
  const runtime = new RemoteAuthRuntime({
    active: REMOTE_AUTH_RUNTIME_ACTIVE,
    client: new RemoteAuthClient(),
  })
  registerRemoteAuthTool(pi, runtime)
}

export function registerRemoteAuthTool(pi: ExtensionAPI, runtime: RemoteAuthRuntime): void {
  const Type = pi.typebox.Type
  const text = Type.String({ minLength: 1, maxLength: 256, pattern: "^[^\\u0000-\\u001f\\u007f-\\u009f]+$" })
  const digest = Type.String({ pattern: "^[0-9a-f]{64}$" })
  const requestId = Type.String({ minLength: 22, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" })
  const nonce = Type.String({ minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]+$" })
  const grantId = Type.String({ minLength: 31, maxLength: 73, pattern: "^grant-v1:[A-Za-z0-9_-]+$" })
  const credentialId = Type.String({ minLength: 22, maxLength: 86, pattern: "^[A-Za-z0-9_-]+$" })
  const timeMs = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  const uint32 = Type.Integer({ minimum: 0, maximum: 0xffff_ffff })
  const origin = Type.String({
    maxLength: 253,
    pattern: "^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::[1-9][0-9]{0,4})?$",
  })
  const browserBinding = {
    hostIdentity: text,
    graphicalSessionId: text,
    chromeService: text,
    chromeExecutableDigest: digest,
    chromePid: uint32,
    profileIdentity: text,
    browserTargetId: text,
    windowId: text,
    extensionId: text,
    extensionVersion: text,
    extensionSource: Type.Literal("official-chrome-web-store"),
    manifestDigest: digest,
    uiTarget: text,
  }
  const target = Type.Union([
    Type.Object({
      kind: Type.Literal("gdm"),
      sshHostKeyDigest: digest,
      machineId: text,
      bootId: text,
      username: text,
      uid: uint32,
      pamService: Type.Literal("gdm-password"),
      seat: text,
      tty: text,
      rhost: Type.Union([Type.Literal("empty"), Type.Literal("local")]),
      greeterGeneration: timeMs,
      jetkvmDeviceId: text,
      controllerGeneration: timeMs,
    }, { additionalProperties: false }),
    Type.Object({
      kind: Type.Literal("bitwarden"),
      ...browserBinding,
    }, { additionalProperties: false }),
    Type.Object({
      kind: Type.Literal("website"),
      ...browserBinding,
      originSet: Type.Array(origin, { minItems: 1, maxItems: 16 }),
      activeTabId: text,
      frameId: text,
      formActionOrigin: origin,
      foregroundWindowId: text,
      credentialPairingId: text,
    }, { additionalProperties: false }),
    Type.Object({
      kind: Type.Literal("sudo"),
      sshHostKeyDigest: digest,
      machineId: text,
      bootId: text,
      username: text,
      uid: uint32,
      sudoPolicyDigest: digest,
      actionId: text,
      executable: Type.String({
        maxLength: 512,
        pattern: "^/(?:[^/\\u0000-\\u001f\\u007f]+/)*[^/\\u0000-\\u001f\\u007f]+$",
      }),
      argvDigest: digest,
    }, { additionalProperties: false }),
  ])
  const parameters = Type.Union([
    Type.Object({ action: Type.Literal("status") }, { additionalProperties: false }),
    Type.Object({
      action: Type.Literal("request"),
      requestId,
      nonce,
      createdAt: timeMs,
      expiresAt: timeMs,
      authorizationModeRequested: Type.Union([Type.Literal("delegated"), Type.Literal("biometric-one-shot")]),
      domain: Type.Union([Type.Literal("desktop-browser"), Type.Literal("sudo")]),
      operation: Type.Union([
        Type.Literal("gdm-login"),
        Type.Literal("bitwarden-unlock"),
        Type.Literal("website-autofill"),
        Type.Literal("sudo"),
      ]),
      target,
      purpose: text,
      grantId: Type.Union([grantId, Type.Null()]),
    }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("request-state"), requestId }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("cancel"), requestId }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("grant-list") }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("grant-revoke"), grantId }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("grant-expire"), grantId }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("credential-forget"), credentialId }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("emergency-disable"), reason: text }, { additionalProperties: false }),
    Type.Object({ action: Type.Literal("re-enable") }, { additionalProperties: false }),
  ])

  pi.registerTool<typeof parameters, RemoteAuthToolDetails>({
    name: "remote_auth",
    label: "Remote Authentication",
    description: "Credential-free, closed remote-authentication broker operations. The canonical runtime is DESIGN/INACTIVE; no operation can release authority until separately reviewed activation and a fresh session.",
    approval: "exec",
    parameters,
    async execute(_toolCallId, params, signal, _onUpdate, context) {
      try {
        const ownershipSource = sessionOwnershipSource(context.sessionManager)
        if (!ownershipSource) return failure("owner-stale")
        const response = await runtime.execute(params, ownershipSource, signal)
        if (response.type === "error") return failure(response.error)
        const details = { ok: true, response } as const satisfies RemoteAuthToolDetails
        return {
          content: [{ type: "text" as const, text: JSON.stringify(details) }],
          details,
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error
        return failure(publicErrorFrom(error))
      }
    },
  })
}

function failure(errorCode: PublicError) {
  const details = { ok: false, errorCode } as const satisfies RemoteAuthToolDetails
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
    isError: true,
  }
}
