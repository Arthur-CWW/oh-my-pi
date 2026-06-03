import { execFile } from "node:child_process"
import { createDecipheriv, pbkdf2Sync } from "node:crypto"
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir, platform, tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import type { CookieMap, CookieReadResult } from "./schemas"
import { toErrorMessage } from "./schemas"

const COOKIES_DB = join(homedir(), "Library/Application Support/Google/Chrome/Default/Cookies")
const DEFAULT_CDP = "http://localhost:9222"

const COOKIE_NAMES = new Set([
  "__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC", "__Secure-1PAPISID",
  "NID", "AEC", "SOCS", "__Secure-BUCKET", "__Secure-ENID",
  "SID", "HSID", "SSID", "APISID", "SAPISID",
  "__Secure-3PSID", "__Secure-3PSIDTS", "__Secure-3PAPISID", "SIDCC",
])

async function readKeychainPassword(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "security", ["find-generic-password", "-w", "-a", "Chrome", "-s", "Chrome Safe Storage"],
      { timeout: 5000 },
      (err, stdout) => resolve(err ? null : stdout.trim() || null),
    )
  })
}

function decrypt(enc: Uint8Array, key: Buffer, strip: boolean): string | null {
  const buf = Buffer.from(enc)
  if (buf.length < 3) return null
  if (!/^v\d\d$/.test(buf.subarray(0, 3).toString("utf8"))) return null
  const ct = buf.subarray(3)
  if (!ct.length) return ""

  try {
    const iv = Buffer.alloc(16, 0x20)
    const dec = createDecipheriv("aes-128-cbc", key, iv)
    dec.setAutoPadding(false)
    const pt = Buffer.concat([dec.update(ct), dec.final()])
    const pad = pt[pt.length - 1] ?? 0
    const unpadded = pad > 0 && pad <= 16 ? pt.subarray(0, pt.length - pad) : pt
    const bytes = strip && unpadded.length >= 32 ? unpadded.subarray(32) : unpadded
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    let i = 0
    while (i < decoded.length && decoded.charCodeAt(i) < 0x20) i++
    return decoded.slice(i)
  } catch { return null }
}

function expandHosts(host: string): string[] {
  const parts = host.split(".").filter(Boolean)
  if (parts.length <= 1) return [host]
  const s = new Set([host])
  for (let i = 1; i <= parts.length - 2; i++) {
    const c = parts.slice(i).join(".")
    if (c) s.add(c)
  }
  return [...s]
}

async function queryChromeDb(dbPath: string): Promise<{
  rows: Array<{ name: string; value: string; encrypted: Uint8Array }>
  stripHash: boolean
  warnings: string[]
}> {
  const warnings: string[] = []
  const rows: Array<{ name: string; value: string; encrypted: Uint8Array }> = []
  let stripHash = false

  const hosts = ["gemini.google.com", "accounts.google.com", "www.google.com", "google.com"]
  const clauses = hosts.flatMap((h) =>
    expandHosts(h).flatMap((c) => [
      `host_key = '${c.replaceAll("'", "''")}'`,
      `host_key = '.${c.replaceAll("'", "''")}'`,
    ]),
  ).join(" OR ")

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const require = createRequire(import.meta.url)
  let sql: typeof import("node:sqlite") | null = null
  try { sql = require("node:sqlite") as typeof import("node:sqlite") } catch { /* nop */ }

  try {
    let verRaw: string | null = null
    if (sql) {
      const db = new sql.DatabaseSync(dbPath, { readOnly: true })
      try {
        const r = db.prepare("SELECT value FROM meta WHERE key = 'version'").all() as Array<{ value: number }>
        verRaw = String(r[0]?.value ?? "0")
      } finally { db.close() }
    } else {
      verRaw = await new Promise<string | null>((resolve) => {
        execFile("sqlite3", ["-readonly", "-noheader", dbPath, "SELECT value FROM meta WHERE key = 'version';"],
          { timeout: 5000 }, (err, out) => resolve(err ? null : out.trim()))
      })
    }
    if (verRaw) stripHash = parseInt(verRaw.split("\n")[0]!.trim(), 10) >= 24
  } catch { /* nop */ }

  if (sql) {
    try {
      const db = new sql.DatabaseSync(dbPath, { readOnly: true })
      try {
        const raw = db.prepare(
          `SELECT name, value, hex(encrypted_value) as enc FROM cookies WHERE (${clauses})`,
        ).all() as Array<{ name: string; value: string; enc: string }>
        for (const r of raw) rows.push({
          name: r.name,
          value: r.value ?? "",
          encrypted: r.enc ? Buffer.from(r.enc, "hex") : new Uint8Array(),
        })
      } finally { db.close() }
    } catch (e) {
      warnings.push(`SQLite: ${toErrorMessage(e)}`)
    }
  } else {
    try {
      const out = await new Promise<string | null>((resolve) => {
        execFile("sqlite3", ["-readonly", "-noheader", "-separator", "\t", dbPath,
          `SELECT name, value, hex(encrypted_value) FROM cookies WHERE (${clauses}) ORDER BY expires_utc DESC;`,
        ], { timeout: 5000 }, (err, o) => resolve(err ? null : o.trim()))
      })
      if (out) {
        for (const line of out.split("\n")) {
          if (!line) continue
          const [n = "", v = "", h = ""] = line.split("\t")
          rows.push({ name: n!, value: v!, encrypted: h ? Buffer.from(h, "hex") : new Uint8Array() })
        }
      }
    } catch (e) { warnings.push(`sqlite3 CLI: ${toErrorMessage(e)}`) }
  }

  return { rows, stripHash, warnings }
}

async function readLegacy(): Promise<{ cookies: CookieMap; warnings: string[] } | null> {
  if (platform() !== "darwin") return null
  if (!existsSync(COOKIES_DB)) return null

  const warnings: string[] = []
  const password = await readKeychainPassword()
  if (!password) {
    warnings.push("Could not read Chrome Safe Storage password from Keychain")
    return { cookies: {}, warnings }
  }

  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1")
  const temp = mkdtempSync(join(tmpdir(), "pi-cookies-"))
  try {
    const tmpDb = join(temp, "Cookies")
    copyFileSync(COOKIES_DB, tmpDb)
    for (const sfx of ["-wal", "-shm"]) {
      const sc = COOKIES_DB + sfx
      if (existsSync(sc)) try { copyFileSync(sc, tmpDb + sfx) } catch { /* nop */ }
    }
    const { rows, stripHash, warnings: w } = await queryChromeDb(tmpDb)
    warnings.push(...w)

    const cookies: CookieMap = {}
    for (const r of rows) {
      if (!COOKIE_NAMES.has(r.name)) continue
      if (cookies[r.name]) continue
      let val: string | null = r.value || null
      if (!val) val = decrypt(r.encrypted, key, stripHash)
      if (val) cookies[r.name] = val
    }
    return { cookies, warnings }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

async function readFromDevTools(browserUrl: string): Promise<{ cookies: CookieMap; warnings: string[] }> {
  try {
    const pp = await import("puppeteer-core")
    const browser = await pp.default.connect({ browserURL: browserUrl, defaultViewport: null })
    try {
      const pages = await browser.pages()
      const page = pages.at(-1) ?? (await browser.newPage())
      const cdp = await page.target().createCDPSession()
      await cdp.send("Network.enable")
      const payload = (await cdp.send("Network.getAllCookies")) as {
        cookies: Array<{ name: string; value: string; domain: string; expires: number }>
      }

      const now = Date.now() / 1000
      const cookies: CookieMap = {}
      const domains = new Set([
        "gemini.google.com", "accounts.google.com", "www.google.com",
        "google.com", ".google.com",
      ])

      for (const c of payload.cookies) {
        if (!COOKIE_NAMES.has(c.name)) continue
        if (cookies[c.name]) continue
        if (!c.value) continue
        if (c.expires > 0 && c.expires <= now) continue
        if (![...domains].some((d) => c.domain === d || c.domain.endsWith("." + d))) continue
        cookies[c.name] = c.value
      }

      return {
        cookies,
        warnings: Object.keys(cookies).length ? [] : ["DevTools reachable but no Google cookies found"],
      }
    } finally {
      await browser.disconnect()
    }
  } catch (err) {
    return { cookies: {}, warnings: [`DevTools failed: ${toErrorMessage(err)}`] }
  }
}

// ─── Effect API ───────────────────────────────────────────────────────

export const readCookies = Effect.fn("readCookies")(function* () {
  const warnings: string[] = []

  const legacy = yield* Effect.tryPromise({
    try: () => readLegacy(),
    catch: (err) => {
      warnings.push(`Legacy: ${toErrorMessage(err)}`)
      return null
    },
  })
  if (legacy) {
    warnings.push(...legacy.warnings)
    if (Object.keys(legacy.cookies).length > 0) {
      return { cookies: legacy.cookies, warnings, source: "legacy" as const }
    }
  }

  const debugUrl = process.env.CHROME_DEBUG_URL ?? DEFAULT_CDP
  const dev = yield* Effect.tryPromise({
    try: () => readFromDevTools(debugUrl),
    catch: (err) => {
      warnings.push(`DevTools: ${toErrorMessage(err)}`)
      return { cookies: {} as CookieMap, warnings: [] as string[] }
    },
  })
  warnings.push(...dev.warnings)
  if (Object.keys(dev.cookies).length > 0) {
    return { cookies: dev.cookies, warnings, source: "devtools" as const }
  }

  warnings.push("No Google auth cookies available.")
  return { cookies: {} as CookieMap, warnings, source: "none" as const }
})
