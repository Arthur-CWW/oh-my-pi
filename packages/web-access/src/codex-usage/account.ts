import { asObject } from "./domain"
import { CODEX_AUTH_FILE, readJsonObject } from "./files"

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1]
  if (!payload) return null

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.trim()
  return email.includes("@") ? email : null
}

function toAccountLabel(email: string): string | null {
  const localPart = email.split("@", 1)[0]?.trim() ?? ""
  const source = (localPart || email).replace(/[^a-zA-Z0-9]/g, "")
  if (!source) return null
  return source.slice(0, 3).toLowerCase() || null
}

export function extractAccountLabelFromCodexAuth(value: unknown): string | null {
  const auth = asObject(value)
  const directEmail = normalizeEmail(auth?.email)
  if (directEmail) return toAccountLabel(directEmail)

  const tokens = asObject(auth?.tokens)
  const payload = typeof tokens?.id_token === "string" ? decodeJwtPayload(tokens.id_token) : null
  const email = normalizeEmail(payload?.email)
  return email ? toAccountLabel(email) : null
}

export async function getAccountLabel(): Promise<string | null> {
  return extractAccountLabelFromCodexAuth(await readJsonObject(CODEX_AUTH_FILE))
}
