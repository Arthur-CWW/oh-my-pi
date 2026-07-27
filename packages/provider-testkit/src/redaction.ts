import type { JsonValue } from "./protocol"

export interface RedactionRule {
  readonly name: string
  /** Must be global; `applyRedaction` relies on `replaceAll` semantics. */
  readonly pattern: RegExp
  readonly replacement: string
}

export interface ForbiddenPattern {
  readonly name: string
  readonly pattern: RegExp
}

/**
 * A policy is two independent halves:
 *  - `rules` transform sensitive values on the way *into* a sealed cassette;
 *  - `forbidden` is the post-transform invariant the sealed bytes must satisfy.
 *
 * They are deliberately not derived from each other. A policy whose rules fail
 * to cover something its own invariant forbids is a policy bug, and sealing
 * fails closed instead of shipping the secret.
 */
export interface RedactionPolicy {
  readonly version: string
  readonly rules: readonly RedactionRule[]
  readonly forbidden: readonly ForbiddenPattern[]
}

const OPENAI_KEY = /sk-[A-Za-z0-9_-]{16,}/g
const BEARER = /Bearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/g
const AWS_ACCESS_KEY = /(?:AKIA|ASIA)[0-9A-Z]{16}/g
const GITHUB_TOKEN = /gh[pousr]_[A-Za-z0-9]{20,}/g
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
const ABSOLUTE_HOME_PATH = /\/(?:home|Users)\/[A-Za-z0-9._-]+/g

const forbiddenAll: readonly ForbiddenPattern[] = [
  { name: "openaiKey", pattern: OPENAI_KEY },
  { name: "bearerToken", pattern: BEARER },
  { name: "awsAccessKey", pattern: AWS_ACCESS_KEY },
  { name: "githubToken", pattern: GITHUB_TOKEN },
  { name: "privateKeyBlock", pattern: PRIVATE_KEY_BLOCK },
  { name: "jwt", pattern: JWT },
  { name: "absoluteHomePath", pattern: ABSOLUTE_HOME_PATH },
]

const defaultPolicy: RedactionPolicy = {
  version: "default/v1",
  rules: [
    { name: "openaiKey", pattern: OPENAI_KEY, replacement: "sk-REDACTED" },
    { name: "bearerToken", pattern: BEARER, replacement: "Bearer REDACTED" },
    { name: "awsAccessKey", pattern: AWS_ACCESS_KEY, replacement: "AKIAREDACTED000000000" },
    { name: "githubToken", pattern: GITHUB_TOKEN, replacement: "ghp_REDACTED" },
    { name: "privateKeyBlock", pattern: PRIVATE_KEY_BLOCK, replacement: "-----BEGIN REDACTED KEY-----" },
    { name: "jwt", pattern: JWT, replacement: "REDACTED.JWT.TOKEN" },
    { name: "absoluteHomePath", pattern: ABSOLUTE_HOME_PATH, replacement: "/REDACTED-HOME" },
  ],
  forbidden: forbiddenAll,
}

/**
 * Deliberately incomplete: it redacts API keys only while forbidding the full
 * sensitive set. Products use it to prove that an under-specified policy is
 * rejected at seal time rather than silently shipping a token.
 */
const apiKeysOnlyPolicy: RedactionPolicy = {
  version: "api-keys-only/v1",
  rules: [{ name: "openaiKey", pattern: OPENAI_KEY, replacement: "sk-REDACTED" }],
  forbidden: forbiddenAll,
}

export const REDACTION_POLICIES: Record<string, RedactionPolicy> = {
  [defaultPolicy.version]: defaultPolicy,
  [apiKeysOnlyPolicy.version]: apiKeysOnlyPolicy,
}

export const DEFAULT_REDACTION_POLICY = defaultPolicy

export const resolveRedactionPolicy = (version: string): RedactionPolicy | undefined => REDACTION_POLICIES[version]

export interface RedactionOutcome<A> {
  readonly value: A
  readonly redactionsApplied: number
  readonly scannedStrings: number
}

const applyRulesToString = (
  policy: RedactionPolicy,
  input: string,
  counter: { applied: number },
): string => {
  let out = input
  for (const rule of policy.rules) {
    rule.pattern.lastIndex = 0
    if (!rule.pattern.test(out)) continue
    rule.pattern.lastIndex = 0
    const matches = out.match(rule.pattern)
    counter.applied += matches === null ? 0 : matches.length
    out = out.replace(rule.pattern, rule.replacement)
  }
  return out
}

const mapStrings = (value: JsonValue, map: (text: string) => string, counter: { scanned: number }): JsonValue => {
  if (typeof value === "string") {
    counter.scanned++
    return map(value)
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    const out: JsonValue[] = new Array(value.length)
    for (let i = 0; i < value.length; i++) out[i] = mapStrings(value[i] as JsonValue, map, counter)
    return out
  }
  const source = value as { readonly [key: string]: JsonValue }
  const out: Record<string, JsonValue> = {}
  for (const key of Object.keys(source)) out[key] = mapStrings(source[key] as JsonValue, map, counter)
  return out
}

export const applyRedaction = (policy: RedactionPolicy, value: JsonValue): RedactionOutcome<JsonValue> => {
  const applied = { applied: 0 }
  const scanned = { scanned: 0 }
  const out = mapStrings(value, text => applyRulesToString(policy, text, applied), scanned)
  return { value: out, redactionsApplied: applied.applied, scannedStrings: scanned.scanned }
}

export interface ResidueFinding {
  readonly rule: string
  readonly pointer: string
  readonly occurrences: number
}

const escapePointerToken = (token: string): string => token.replace(/~/g, "~0").replace(/\//g, "~1")

const scanValue = (
  policy: RedactionPolicy,
  value: JsonValue,
  pointer: string,
  findings: ResidueFinding[],
): void => {
  if (typeof value === "string") {
    for (const forbidden of policy.forbidden) {
      forbidden.pattern.lastIndex = 0
      const matches = value.match(forbidden.pattern)
      if (matches !== null && matches.length > 0) {
        findings.push({ rule: forbidden.name, pointer, occurrences: matches.length })
      }
    }
    return
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) scanValue(policy, value[i] as JsonValue, `${pointer}/${i}`, findings)
    return
  }
  const source = value as { readonly [key: string]: JsonValue }
  for (const key of Object.keys(source)) {
    scanValue(policy, source[key] as JsonValue, `${pointer}/${escapePointerToken(key)}`, findings)
  }
}

/** Findings carry rule name, JSON pointer and count — never the offending value. */
export const findRedactionResidue = (policy: RedactionPolicy, value: JsonValue, pointer = ""): readonly ResidueFinding[] => {
  const findings: ResidueFinding[] = []
  scanValue(policy, value, pointer, findings)
  return findings
}
