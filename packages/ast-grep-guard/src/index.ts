import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@oh-my-pi/pi-coding-agent"
import { Schema } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path"

const AST_GREP_PACKAGE = "@ast-grep/cli@0.42.2"
const MAX_FINDINGS = 8
const MAX_SCAN_BUFFER = 16 * 1024 * 1024
const EDIT_TOOL_NAMES: Record<string, true> = { write: true, edit: true, ast_edit: true }
const STATIC_SLOP_RULE_IDS: Record<string, true> = {
  "no-raw-json-parse-ts": true,
  "no-hand-written-cli-parsing-ts": true,
  "no-react-static-markup-ui-tests": true,
}

const SUPPORTED_CODE_LANGUAGES = [
  { name: "typescript", extensions: [".ts", ".tsx"] },
  { name: "javascript", extensions: [".js", ".jsx"] },
  { name: "python", extensions: [".py"] },
] as const
type SupportedCodeExtension = typeof SUPPORTED_CODE_LANGUAGES[number]["extensions"][number]
const SUPPORTED_CODE_EXTENSIONS: Record<SupportedCodeExtension, true> = {
  ".ts": true,
  ".tsx": true,
  ".js": true,
  ".jsx": true,
  ".py": true,
}

type DecodedRecord = { readonly [key: string]: DecodedValue | undefined }
type DecodedValue = string | number | boolean | null | readonly DecodedValue[] | DecodedRecord
type ToolInputValue = ToolResultEvent extends { readonly input?: infer Value } ? Value : DecodedValue
type ToolDetailsValue = ToolResultEvent extends { readonly details?: infer Value } ? Value : DecodedValue
type DecodedPayload = DecodedValue | ToolInputValue | ToolDetailsValue
type ToolContent = NonNullable<ToolResultEvent["content"]>
type ToolContentChunk = ToolContent[number]

type ToolResultOverride = {
  readonly content: readonly ToolContentChunk[]
}

type AstGrepToolResultHandler = (
  event: ToolResultEvent,
  ctx: ExtensionContext,
) => ToolResultOverride | undefined

type ExtensionWithToolResultEvents = ExtensionAPI & {
  readonly on?: (eventName: "tool_result", handler: AstGrepToolResultHandler) => void
}

export interface AstGrepRuntimeContext {
  readonly reactVersions: readonly string[]
  readonly pythonVersions: readonly string[]
}

export interface AstGrepGuardScanPlan {
  readonly activeCwd: string
  readonly repoRoot: string
  readonly ruleDirs: readonly string[]
  readonly paths: readonly string[]
  readonly runtime: AstGrepRuntimeContext
}

export interface AstGrepFinding {
  readonly ruleId: string
  readonly file: string
  readonly line: number
  readonly message: string
}

interface SpawnError extends Error {
  readonly code?: string
}

interface AstGrepCommandResult {
  readonly stdout: string
  readonly missing: boolean
}

export function registerAstGrepGuard(pi: ExtensionAPI): void {
  const eventApi = toolResultApi(pi)
  if (!eventApi) return

  eventApi.on("tool_result", (event, ctx) => {
    try {
      if (!isSuccessfulEditResult(event)) return undefined
      const activeCwd = resolveActiveCwd(ctx)
      const repoRoot = findRepoRoot(activeCwd) ?? activeCwd
      const candidates = extractChangedPathCandidates(event.input, event.details)
      const paths = filterTouchedCodePaths(candidates, activeCwd, repoRoot)
      const plan = buildAstGrepScanPlan(activeCwd, repoRoot, paths)
      if (!plan) return undefined
      const findings = runAstGrepScans(plan)
      if (findings.length === 0) return undefined
      return { content: appendAdvisory(event.content, formatAstGrepAdvisory(findings, plan)) }
    } catch {
      return undefined
    }
  })
}

export default function astGrepGuardExtension(pi: ExtensionAPI): void {
  registerAstGrepGuard(pi)
}

export function extractChangedPathCandidates(inputValue: ToolInputValue, detailsValue: ToolDetailsValue): string[] {
  const paths: string[] = []
  const input = asRecord(inputValue)
  const details = asRecord(detailsValue)

  pushStringField(paths, input, "path")
  pushStringField(paths, input, "file_path")
  pushStringField(paths, input, "filePath")

  pushStringField(paths, details, "path")
  pushStringField(paths, details, "file_path")
  pushStringField(paths, details, "filePath")

  const perFileResults = asArray(details?.perFileResults)
  for (const itemValue of perFileResults) {
    const item = asRecord(itemValue)
    pushPathLikeFields(paths, item)
    const source = extractNestedPath(item?.source)
    if (source) paths.push(source)
    pushNestedPathFields(paths, asRecord(item?.meta))
    pushNestedPathFields(paths, asRecord(item?.source))
  }

  return paths
}

export function filterTouchedCodePaths(candidates: readonly string[], cwd: string, repoRoot: string): string[] {
  const root = resolve(repoRoot)
  const seen = new Set<string>()
  const paths: string[] = []
  for (const candidate of candidates) {
    const resolvedPath = resolveLocalCodePath(candidate, cwd, root)
    if (!resolvedPath || seen.has(resolvedPath)) continue
    seen.add(resolvedPath)
    paths.push(resolvedPath)
  }
  return paths
}

export function buildAstGrepScanPlan(activeCwd: string, repoRoot: string, paths: readonly string[]): AstGrepGuardScanPlan | null {
  if (paths.length === 0) return null
  const ruleDirs = discoverRuleDirs(activeCwd)
  if (ruleDirs.length === 0) return null
  return {
    activeCwd,
    repoRoot,
    ruleDirs,
    paths,
    runtime: discoverRuntimeContext(paths, repoRoot),
  }
}

export function parseAstGrepFindings(stdout: string): AstGrepFinding[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  const parsedAsDocument = parseJsonDocument(trimmed)
  if (parsedAsDocument) return findingsFromJsonDocument(parsedAsDocument)

  const findings: AstGrepFinding[] = []
  for (const line of stdout.split("\n")) {
    const lineTrimmed = line.trim()
    if (!lineTrimmed.startsWith("{")) continue
    const parsed = parseJsonDocument(lineTrimmed)
    if (!parsed) continue
    const finding = findingFromJson(parsed)
    if (finding) findings.push(finding)
  }
  return findings
}

export function isStaticSlopGuardrailRule(ruleId: string): boolean {
  return Object.prototype.hasOwnProperty.call(STATIC_SLOP_RULE_IDS, ruleId)
}

export function formatAstGrepAdvisory(findings: readonly AstGrepFinding[], plan: AstGrepGuardScanPlan): string {
  const displayed = findings.slice(0, MAX_FINDINGS)
  const lines = [`AST-grep advisory (${findings.length} finding${findings.length === 1 ? "" : "s"} on touched files):`]
  for (const finding of displayed) {
    const file = relativeDisplayPath(finding.file, plan)
    const location = finding.line > 0 ? `${file}:${finding.line}` : file
    const label = isStaticSlopGuardrailRule(finding.ruleId) ? " [static slop guardrail]" : ""
    lines.push(`- ${finding.ruleId}${label} ${location} ${oneLine(finding.message)}`)
  }
  if (findings.length > displayed.length) lines.push(`- …and ${findings.length - displayed.length} more.`)
  return lines.join("\n")
}

function toolResultApi(pi: ExtensionAPI): ExtensionWithToolResultEvents | null {
  const candidate = pi as ExtensionWithToolResultEvents
  return typeof candidate.on === "function" ? candidate : null
}

function isSuccessfulEditResult(event: ToolResultEvent): boolean {
  return event.isError !== true && typeof event.toolName === "string" && EDIT_TOOL_NAMES[event.toolName] === true
}

function resolveActiveCwd(ctx: ExtensionContext): string {
  return resolve(typeof ctx.cwd === "string" && ctx.cwd.trim() ? ctx.cwd : process.cwd())
}

function discoverRuleDirs(activeCwd: string): string[] {
  const dirs: string[] = []
  pushDir(dirs, join(homedir(), ".omp/agent/ast-grep/rules"))
  for (const dir of ancestorDirs(activeCwd)) {
    pushDir(dirs, join(dir, ".omp/ast-grep/rules"))
    pushDir(dirs, join(dir, "tools/ast-grep/rules"))
    for (const ruleDir of readSgconfigRuleDirs(join(dir, "sgconfig.yml"))) {
      pushDir(dirs, resolve(dir, ruleDir))
    }
    for (const ruleDir of readSgconfigRuleDirs(join(dir, "sgconfig.yaml"))) {
      pushDir(dirs, resolve(dir, ruleDir))
    }
  }
  return uniqueStrings(dirs)
}

function runAstGrepScans(plan: AstGrepGuardScanPlan): AstGrepFinding[] {
  const findings: AstGrepFinding[] = []
  const env = runtimeEnv(plan.runtime)

  for (const ruleFile of plan.ruleDirs.flatMap(listRuleFiles)) {
    const result = runAstGrepCommand([
      "scan",
      "--rule",
      ruleFile,
      "--json",
      ...plan.paths,
    ], plan.activeCwd, env)

    if (result.missing) return []
    findings.push(...parseAstGrepFindings(result.stdout))
  }

  return uniqueFindings(findings)
}

function runAstGrepCommand(args: readonly string[], cwd: string, env: Record<string, string>): AstGrepCommandResult {
  const processEnv = { ...process.env, ...env }
  const options = {
    cwd,
    encoding: "utf8" as const,
    env: processEnv,
    maxBuffer: MAX_SCAN_BUFFER,
  }

  const direct = spawnSync("ast-grep", args, options)
  if (!isMissingCommand(direct.error)) return { stdout: direct.stdout, missing: false }

  const viaBunx = spawnSync("bunx", ["--bun", AST_GREP_PACKAGE, ...args], options)
  if (!isMissingCommand(viaBunx.error)) return { stdout: viaBunx.stdout, missing: false }

  const viaBun = spawnSync("bun", ["x", "--bun", AST_GREP_PACKAGE, ...args], options)
  if (!isMissingCommand(viaBun.error)) return { stdout: viaBun.stdout, missing: false }

  return { stdout: "", missing: true }
}

function runtimeEnv(runtime: AstGrepRuntimeContext): Record<string, string> {
  const env: Record<string, string> = {}
  if (runtime.reactVersions.length > 0) env.OMP_AST_GREP_REACT_VERSION = runtime.reactVersions.join(",")
  if (runtime.pythonVersions.length > 0) env.OMP_AST_GREP_PYTHON_VERSION = runtime.pythonVersions.join(",")
  return env
}

function discoverRuntimeContext(paths: readonly string[], repoRoot: string): AstGrepRuntimeContext {
  const reactVersions: string[] = []
  const pythonVersions: string[] = []
  for (const path of paths) {
    const dir = dirname(path)
    const reactVersion = findNearestReactVersion(dir, repoRoot)
    if (reactVersion) reactVersions.push(reactVersion)
    const pythonVersion = findNearestPythonVersion(dir, repoRoot)
    if (pythonVersion) pythonVersions.push(pythonVersion)
  }
  return {
    reactVersions: uniqueStrings(reactVersions),
    pythonVersions: uniqueStrings(pythonVersions),
  }
}

function findNearestReactVersion(startDir: string, stopDir: string): string | null {
  for (const dir of ancestorDirs(startDir, stopDir)) {
    const pkg = asRecord(readJsonFile(join(dir, "package.json")))
    if (!pkg) continue
    const version = dependencyVersion(pkg, "dependencies", "react")
      ?? dependencyVersion(pkg, "devDependencies", "react")
      ?? dependencyVersion(pkg, "peerDependencies", "react")
    if (version) return version
  }
  return null
}

function dependencyVersion(pkg: DecodedRecord, groupName: string, dependencyName: string): string | null {
  const group = asRecord(pkg[groupName])
  const value = group?.[dependencyName]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function findNearestPythonVersion(startDir: string, stopDir: string): string | null {
  for (const dir of ancestorDirs(startDir, stopDir)) {
    const pythonVersion = readFirstLine(join(dir, ".python-version"))
    if (pythonVersion) return pythonVersion
    const pyprojectVersion = readRequiresPython(join(dir, "pyproject.toml"))
    if (pyprojectVersion) return pyprojectVersion
    const miseVersion = readMisePython(join(dir, "mise.toml")) ?? readMisePython(join(dir, ".mise.toml"))
    if (miseVersion) return miseVersion
  }
  return null
}

function readJsonFile(path: string): DecodedValue | null {
  if (!isFile(path)) return null
  try {
    return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(readFileSync(path, "utf8")) as DecodedValue
  } catch {
    return null
  }
}

function readFirstLine(path: string): string | null {
  if (!isFile(path)) return null
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith("#")) return trimmed
    }
  } catch {
    return null
  }
  return null
}

function readRequiresPython(path: string): string | null {
  if (!isFile(path)) return null
  try {
    const match = readFileSync(path, "utf8").match(/^\s*requires-python\s*=\s*["']([^"']+)["']/m)
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

function readMisePython(path: string): string | null {
  if (!isFile(path)) return null
  try {
    const text = readFileSync(path, "utf8")
    const dotted = text.match(/^\s*tools\.python\s*=\s*(.+)$/m)
    const dottedVersion = parseTomlStringOrArrayValue(dotted?.[1])
    if (dottedVersion) return dottedVersion

    const toolsSection = tomlSection(text, "tools")
    const sectionVersion = parseTomlStringOrArrayValue(toolsSection?.match(/^\s*python\s*=\s*(.+)$/m)?.[1])
    return sectionVersion
  } catch {
    return null
  }
}

function readSgconfigRuleDirs(path: string): string[] {
  if (!isFile(path)) return []
  try {
    const dirs: string[] = []
    let inRuleDirs = false
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const topLevel = line.match(/^([A-Za-z0-9_-]+):/)
      if (topLevel) inRuleDirs = topLevel[1] === "ruleDirs"
      if (!inRuleDirs) continue
      const item = line.match(/^\s*-\s*["']?([^"'\s#]+)["']?/)
      if (item?.[1]) dirs.push(item[1])
    }
    return dirs
  } catch {
    return []
  }
}

function tomlSection(text: string, name: string): string | null {
  const lines: string[] = []
  let inSection = false
  for (const line of text.split("\n")) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (section) {
      if (inSection) break
      inSection = section[1]?.trim() === name
      continue
    }
    if (inSection) lines.push(line)
  }
  return lines.length > 0 ? lines.join("\n") : null
}

function parseTomlStringOrArrayValue(value: string | undefined): string | null {
  if (!value) return null
  const match = value.match(/["']([^"']+)["']/)
  return match?.[1]?.trim() || null
}

function resolveLocalCodePath(candidate: string, cwd: string, repoRoot: string): string | null {
  const trimmed = candidate.trim()
  if (!trimmed || isInternalOrRemotePath(trimmed)) return null
  const absolutePath = normalize(isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed))
  if (!isPathWithin(absolutePath, repoRoot) || hasVendorSegment(absolutePath, repoRoot)) return null
  if (!isSupportedCodeExtension(extname(absolutePath))) return null
  if (!isFile(absolutePath)) return null
  return absolutePath
}

function isSupportedCodeExtension(extension: string): extension is SupportedCodeExtension {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_CODE_EXTENSIONS, extension)
}

function isInternalOrRemotePath(path: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path)
}

function hasVendorSegment(path: string, root: string): boolean {
  const local = isPathWithin(path, root) ? relative(root, path) : path
  return local.split(sep).some((part) => part === "node_modules" || part === "vendor")
}

function extractNestedPath(value: DecodedPayload | undefined): string | null {
  if (typeof value === "string") return value
  const record = asRecord(value)
  if (!record) return null
  return stringField(record, "path") ?? stringField(record, "file") ?? stringField(record, "filePath") ?? stringField(record, "file_path")
}

function pushPathLikeFields(paths: string[], record: DecodedRecord | null): void {
  pushStringField(paths, record, "path")
  pushStringField(paths, record, "file")
  pushStringField(paths, record, "filePath")
  pushStringField(paths, record, "file_path")
}

function pushNestedPathFields(paths: string[], record: DecodedRecord | null): void {
  if (!record) return
  pushPathLikeFields(paths, record)
  const source = extractNestedPath(record.source)
  if (source) paths.push(source)
}

function pushStringField(paths: string[], record: DecodedRecord | null, key: string): void {
  const value = stringField(record, key)
  if (value) paths.push(value)
}

function stringField(record: DecodedRecord | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function appendAdvisory(content: readonly ToolContentChunk[] | undefined, advisory: string): readonly ToolContentChunk[] {
  const chunks: ToolContentChunk[] = [...(content ?? [])]
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index]
    if (chunk?.type !== "text" || typeof chunk.text !== "string") continue
    const separator = chunk.text.endsWith("\n") ? "\n" : "\n\n"
    chunks[index] = { ...chunk, text: `${chunk.text}${separator}${advisory}` }
    return chunks
  }
  chunks.push({ type: "text", text: advisory } as ToolContentChunk)
  return chunks
}

function findingsFromJsonDocument(value: DecodedPayload): AstGrepFinding[] {
  if (Array.isArray(value)) return value.map(findingFromJson).filter((finding): finding is AstGrepFinding => finding !== null)
  const finding = findingFromJson(value)
  return finding ? [finding] : []
}

function findingFromJson(value: DecodedPayload): AstGrepFinding | null {
  const record = asRecord(value)
  const range = asRecord(record?.range)
  const start = asRecord(range?.start)
  if (
    !record ||
    typeof record.ruleId !== "string" ||
    typeof record.file !== "string" ||
    typeof record.message !== "string" ||
    typeof start?.line !== "number"
  ) {
    return null
  }
  return {
    ruleId: record.ruleId,
    file: record.file,
    line: start.line + 1,
    message: record.message,
  }
}

function parseJsonDocument(text: string): DecodedPayload | null {
  try {
    return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(text) as DecodedPayload
  } catch {
    return null
  }
}

function relativeDisplayPath(file: string, plan: AstGrepGuardScanPlan): string {
  const absolute = isAbsolute(file) ? file : resolve(plan.activeCwd, file)
  if (isPathWithin(absolute, plan.repoRoot)) return normalizeSlashes(relative(plan.repoRoot, absolute))
  if (isPathWithin(absolute, plan.activeCwd)) return normalizeSlashes(relative(plan.activeCwd, absolute))
  return normalizeSlashes(file)
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function findRepoRoot(startDir: string): string | null {
  for (const dir of ancestorDirs(startDir)) {
    if (existsSync(join(dir, ".git"))) return dir
  }
  return null
}

function ancestorDirs(startDir: string, stopDir?: string): string[] {
  const dirs: string[] = []
  const stop = stopDir ? resolve(stopDir) : null
  let current = resolve(startDir)
  while (true) {
    dirs.push(current)
    if (current === stop) return dirs
    const parent = dirname(current)
    if (parent === current) return dirs
    current = parent
  }
}

function pushDir(dirs: string[], path: string): void {
  if (isDirectory(path)) dirs.push(path)
}

function listRuleFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
      .map((entry) => join(dir, entry.name))
      .sort()
  } catch {
    return []
  }
}

function isPathWithin(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isMissingCommand(error: SpawnError | undefined): boolean {
  return error?.code === "ENOENT"
}

function asRecord(value: DecodedPayload | undefined): DecodedRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as DecodedRecord : null
}

function asArray(value: DecodedPayload | undefined): readonly DecodedPayload[] {
  return Array.isArray(value) ? value as readonly DecodedPayload[] : []
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    unique.push(value)
  }
  return unique
}

function uniqueFindings(findings: readonly AstGrepFinding[]): AstGrepFinding[] {
  const seen = new Set<string>()
  const unique: AstGrepFinding[] = []
  for (const finding of findings) {
    const key = JSON.stringify([finding.ruleId, finding.file, finding.line, finding.message])
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(finding)
  }
  return unique
}

function normalizeSlashes(path: string): string {
  return path.replaceAll(sep, "/")
}
