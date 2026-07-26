import { randomBytes, randomUUID } from "node:crypto"
import { chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { Schema } from "effect"

import { PeerRouteV1Schema, decodePeerRouteV1, type PeerRouteV1 } from "./relay-schema"

const nodeIdPattern = /^node_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const secretPattern = /^[A-Za-z0-9+/]{43}=$/

const NodeConfigV1ShapeSchema = Schema.Struct({
  v: Schema.Literal(1), nodeId: Schema.String, secret: Schema.String, routes: Schema.Array(PeerRouteV1Schema),
})
export type NodeConfigV1 = Schema.Schema.Type<typeof NodeConfigV1ShapeSchema>
export const NodeConfigV1Schema = Schema.declare<NodeConfigV1>((value): value is NodeConfigV1 => {
  try {
    validateNodeConfig(value)
    Schema.decodeUnknownSync(NodeConfigV1ShapeSchema)(value)
    return true
  } catch {
    return false
  }
})

export interface InitNodeConfigOptions {
  readonly routes?: readonly PeerRouteV1[]
}

export function defaultNodeConfigPath(env: Record<string, string | undefined> = process.env): string {
  return env["AGENT_CONTROL_PLANE_NODE_CONFIG"] ?? join(homedir(), ".agent-control-plane", "node.json")
}

/** Loads a strict private config; insecure files are rejected before parsing. */
export function loadNodeConfig(path: string = defaultNodeConfigPath()): Readonly<NodeConfigV1> {
  requirePrivateFile(path)
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    throw new Error("invalid node config")
  }
  return decodeNodeConfigV1(value)
}

/** Initializes exactly once, preserving an existing node identity and secret. */
export function initNodeConfig(path: string = defaultNodeConfigPath(), options: InitNodeConfigOptions = {}): Readonly<NodeConfigV1> {
  try {
    return loadNodeConfig(path)
  } catch (error) {
    if (!isMissing(path)) throw error
  }
  const routes = (options.routes ?? []).map((route) => decodePeerRouteV1(route))
  const config = decodeNodeConfigV1({ v: 1, nodeId: `node_${randomUUID()}`, secret: randomBytes(32).toString("base64"), routes })
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const temporary = writeTemporaryConfig(directory, config)
  try {
    linkSync(temporary, path)
    fsyncDirectory(directory)
    return config
  } catch (error) {
    if (isMissing(path)) throw error
    return loadNodeConfig(path)
  } finally {
    try { unlinkSync(temporary) } catch { /* temporary may already be unavailable */ }
  }
}

/** Validates then atomically replaces a mode-0600 config without logging its secret. */
export function writeNodeConfig(path: string, value: NodeConfigV1): Readonly<NodeConfigV1> {
  const config = decodeNodeConfigV1(value)
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  try {
    requirePrivateFile(path)
  } catch (error) {
    if (!isMissing(path)) throw error
  }
  const temporary = writeTemporaryConfig(directory, config)
  try {
    chmodSync(temporary, 0o600)
    renameSync(temporary, path)
    fsyncDirectory(directory)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* already renamed or unavailable */ }
    throw error
  }
  return config
}

export function decodeNodeConfigV1(value: unknown): Readonly<NodeConfigV1> {
  validateNodeConfig(value)
  const record = value as { readonly v: 1; readonly nodeId: string; readonly secret: string; readonly routes: readonly unknown[] }
  const routes = Object.freeze(record.routes.map((route) => decodePeerRouteV1(route)))
  return Object.freeze({ ...Schema.decodeUnknownSync(NodeConfigV1ShapeSchema)({ v: record.v, nodeId: record.nodeId, secret: record.secret, routes }), routes })
}

function validateNodeConfig(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid node config")
  const record = value as Record<string, unknown>
  const keys = ["v", "nodeId", "secret", "routes"] as const
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record)) || Object.keys(record).some((key) => !keys.includes(key as typeof keys[number]))) throw new Error("invalid node config fields")
  if (record.v !== 1 || typeof record.nodeId !== "string" || !nodeIdPattern.test(record.nodeId) || typeof record.secret !== "string" || !secretPattern.test(record.secret) || Buffer.from(record.secret, "base64").byteLength !== 32 || !Array.isArray(record.routes) || record.routes.length > 128) throw new Error("invalid node config")
  const routeKeys: Record<string, true> = {}
  for (const input of record.routes) {
    const route = decodePeerRouteV1(input)
    const key = `${route.nodeId}\u0000${route.peerId}`
    if (route.nodeId === record.nodeId || routeKeys[key] === true) throw new Error("invalid node routes")
    routeKeys[key] = true
  }
}

export function redactNodeConfig(config: Pick<NodeConfigV1, "v" | "nodeId" | "routes">): Readonly<{ readonly v: 1; readonly nodeId: string; readonly secret: "[REDACTED]"; readonly routes: readonly PeerRouteV1[] }> {
  return Object.freeze({ v: 1, nodeId: config.nodeId, secret: "[REDACTED]", routes: config.routes })
}
function writeTemporaryConfig(directory: string, config: NodeConfigV1): string {
  const temporary = join(directory, `.${process.pid}.${randomUUID()}.node.json.tmp`)
  try {
    const fd = openSync(temporary, "wx", 0o600)
    try {
      writeFileSync(fd, JSON.stringify(config), "utf8")
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    return temporary
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* temporary may not have been created */ }
    throw error
  }
}

function requirePrivateFile(path: string): void {
  const stat = lstatSync(path)
  const getuid = process.getuid
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || (typeof getuid === "function" && stat.uid !== getuid())) throw new Error("node config must be a private regular file")
}

function isMissing(path: string): boolean {
  try { statSync(path); return false } catch (error) { return error instanceof Error && "code" in error && error.code === "ENOENT" }
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, "r")
  try { fsyncSync(fd) } finally { closeSync(fd) }
}
