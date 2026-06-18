import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Effect } from "effect"

export interface JimengProofReportOptions {
  inputPath: string
  outDir?: string
  title?: string
}

export interface JimengProofArtifactSummary {
  kind: string
  file: string
  relativeFile: string
  urlRedacted: string | null
  bytes: number | null
}

export interface JimengProofRunSummary {
  file: string
  relativeFile: string
  command: string | null
  op: string | null
  submitId: string | null
  historyId: string | null
  status: number | string | null
  traceCount: number
  prompt: string | null
  artifacts: JimengProofArtifactSummary[]
}

export interface JimengProofFunctionPage {
  functionName: string
  slug: string
  htmlFile: string
  runCount: number
}

export interface JimengProofReportResult {
  inputPath: string
  outDir: string
  htmlFile: string
  markdownFile: string
  functionPages: JimengProofFunctionPage[]
  runs: JimengProofRunSummary[]
}

type JsonRecord = Record<string, JsonValue>
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const renderJimengProofReport = Effect.fn("renderJimengProofReport")(function* (
  options: JimengProofReportOptions,
) {
  return yield* Effect.try({
    try: () => renderJimengProofReportSync(options),
    catch: (error) => error instanceof Error ? error : new Error(String(error)),
  })
})

export function renderJimengProofReportSync(options: JimengProofReportOptions): JimengProofReportResult {
  const inputPath = path.resolve(options.inputPath)
  const proofRoot = inferProofRoot(inputPath)
  const outDir = path.resolve(options.outDir ?? path.join(proofRoot, "report"))
  const reportTitle = options.title ?? `Jimeng proof report: ${path.basename(proofRoot)}`
  const runs = collectProofRuns(inputPath, proofRoot)

  mkdirSync(outDir, { recursive: true })
  const markdownFile = path.join(outDir, "index.md")
  const htmlFile = path.join(outDir, "index.html")
  const inputLabel = path.relative(proofRoot, inputPath) || path.basename(proofRoot)
  const functionPages = writeFunctionReports({ title: reportTitle, inputLabel, outDir, runs })
  writeFileSync(markdownFile, renderProofMarkdown({ title: reportTitle, inputLabel, functionPages, runs }), "utf8")
  writeFileSync(htmlFile, renderProofHtml({ title: reportTitle, inputLabel, outDir, functionPages, runs }), "utf8")
  return { inputPath, outDir, htmlFile, markdownFile, functionPages, runs }
}

function inferProofRoot(inputPath: string): string {
  if (statSync(inputPath).isDirectory()) return inputPath
  const parent = path.dirname(inputPath)
  return path.basename(parent) === "normalized" ? path.dirname(parent) : parent
}

function collectProofRuns(inputPath: string, proofRoot: string): JimengProofRunSummary[] {
  const files = statSync(inputPath).isDirectory()
    ? collectJsonFiles(path.join(inputPath, "normalized")).filter((file) => file.endsWith("-result.json"))
    : [inputPath]
  return files.sort().map((file) => summarizeRun(file, proofRoot))
}


function collectJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectJsonFiles(file))
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(file)
  }
  return out
}

function summarizeRun(file: string, root: string): JimengProofRunSummary {
  const json = parseJsonObject(readFileSync(file, "utf8"), file)
  const plan = objectValue(json.plan)
  const submit = objectValue(json.submit)
  const pollTrace = arrayValue(json.pollTrace)
  const artifacts = arrayValue(json.artifacts)
  const pollLast = objectValue(pollTrace.at(-1))
  const submitBody = objectValue(plan?.submit_body)
  const historyGroup = stringValue(objectPath(submit, ["responseBody", "data", "aigc_data", "history_group_key"]))

  return {
    file,
    relativeFile: relativePath(root, file),
    command: stringValue(plan?.command),
    op: stringValue(plan?.op),
    submitId: stringValue(submit?.submitId) ?? stringValue(plan?.submit_id),
    historyId: stringValue(submit?.historyId),
    status: numberOrStringValue(pollLast?.status),
    traceCount: pollTrace.length,
    prompt: extractPrompt(submitBody) ?? promptFromHistoryGroup(historyGroup),
    artifacts: artifacts.map((artifact) => summarizeArtifact(objectValue(artifact), root)).filter(isArtifactSummary),
  }
}

function summarizeArtifact(artifact: JsonRecord | null, root: string): JimengProofArtifactSummary | null {
  if (!artifact) return null
  const savedFile = stringValue(artifact.saved_file)
  if (!savedFile) return null
  return {
    kind: stringValue(artifact.kind) ?? inferArtifactKind(savedFile),
    file: savedFile,
    relativeFile: relativePath(root, savedFile),
    urlRedacted: redactSignedUrl(stringValue(artifact.url)),
    bytes: fileSizeOrNull(savedFile),
  }
}

function writeFunctionReports(input: { title: string; inputLabel: string; outDir: string; runs: JimengProofRunSummary[] }): JimengProofFunctionPage[] {
  const groups = groupRunsByFunction(input.runs)
  if (groups.length === 0) return []
  const functionDir = path.join(input.outDir, "functions")
  mkdirSync(functionDir, { recursive: true })
  const usedSlugs = new Set<string>()
  return groups.map(([functionName, runs]) => {
    const slug = uniqueSlug(functionName, usedSlugs)
    const htmlFile = path.join(functionDir, `${slug}.html`)
    writeFileSync(htmlFile, renderFunctionHtml({
      title: `${input.title} — ${functionName}`,
      inputLabel: input.inputLabel,
      functionName,
      indexHref: relativeUrlFrom(functionDir, path.join(input.outDir, "index.html")),
      outDir: functionDir,
      runs,
    }), "utf8")
    return { functionName, slug, htmlFile, runCount: runs.length }
  })
}

function groupRunsByFunction(runs: JimengProofRunSummary[]): Array<[string, JimengProofRunSummary[]]> {
  const groups = new Map<string, JimengProofRunSummary[]>()
  for (const run of runs) {
    const name = reportFunctionName(run)
    const group = groups.get(name)
    if (group) group.push(run)
    else groups.set(name, [run])
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function reportFunctionName(run: JimengProofRunSummary): string {
  if (run.command && run.op) return `${run.command} / ${run.op}`
  return run.command ?? run.op ?? "unknown"
}

function uniqueSlug(value: string, used: Set<string>): string {
  const base = slugify(value)
  let candidate = base
  let counter = 2
  while (used.has(candidate)) {
    candidate = `${base}-${counter}`
    counter += 1
  }
  used.add(candidate)
  return candidate
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "")
  return slug || "unknown"
}

function renderProofMarkdown(input: { title: string; inputLabel: string; functionPages: JimengProofFunctionPage[]; runs: JimengProofRunSummary[] }): string {
  const lines = [`# ${input.title}`, "", `Input: \`${input.inputLabel}\``, "", "## Functions", ""]
  if (input.functionPages.length === 0) lines.push("No function pages generated.", "")
  for (const page of input.functionPages) {
    lines.push(`- [${page.functionName}](functions/${page.slug}.html): ${page.runCount} run${page.runCount === 1 ? "" : "s"}`)
  }
  lines.push("", "## Runs", "")
  if (input.runs.length === 0) lines.push("No `normalized/*-result.json` files found.", "")
  for (const run of input.runs) {
    lines.push(`### ${run.command ?? "unknown"} ${run.submitId ?? ""}`.trim(), "")
    lines.push(`- Result JSON: \`${run.relativeFile}\``)
    if (run.prompt) lines.push(`- Prompt: ${run.prompt}`)
    if (run.historyId) lines.push(`- History: \`${run.historyId}\``)
    lines.push(`- Status: \`${run.status ?? "unknown"}\``)
    lines.push(`- Poll trace entries: ${run.traceCount}`)
    if (run.artifacts.length > 0) {
      lines.push("- Artifacts:")
      for (const artifact of run.artifacts) {
        lines.push(`  - ${artifact.kind}: \`${artifact.relativeFile}\` (${artifact.bytes ?? "unknown"} bytes)`)
      }
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

function renderProofHtml(input: { title: string; inputLabel: string; outDir: string; functionPages: JimengProofFunctionPage[]; runs: JimengProofRunSummary[] }): string {
  const functionNav = renderFunctionNav(input.functionPages, input.outDir)
  const body = input.runs.length === 0
    ? `<p>No <code>normalized/*-result.json</code> files found.</p>`
    : input.runs.map((run) => renderRunHtml(run, input.outDir)).join("\n")
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:24px;line-height:1.45;background:#f7f7f8;color:#151515}main{max-width:1100px;margin:0 auto}.run{background:white;border:1px solid #ddd;border-radius:12px;padding:18px;margin:18px 0;box-shadow:0 1px 2px #0001}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.kv{background:#f1f1f3;border-radius:8px;padding:8px}.prompt{font-size:1.05rem}.artifact{margin-top:14px}video,img,audio{max-width:100%;border-radius:10px;border:1px solid #ddd;background:#111}code{background:#eee;border-radius:4px;padding:1px 4px;word-break:break-all}pre{white-space:pre-wrap;background:#111;color:#eee;padding:10px;border-radius:8px;overflow:auto}.muted{color:#666}.bad{color:#9a3412}.ok{color:#166534}
</style>
</head>
<body><main>
<h1>${escapeHtml(input.title)}</h1>
<p class="muted">Input: <code>${escapeHtml(input.inputLabel)}</code></p>
${functionNav}
${body}
</main></body>
</html>
`
}

function renderFunctionHtml(input: { title: string; inputLabel: string; functionName: string; indexHref: string; outDir: string; runs: JimengProofRunSummary[] }): string {
  const runs = input.runs.map((run) => renderRunHtml(run, input.outDir)).join("\n")
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:24px;line-height:1.45;background:#f7f7f8;color:#151515}main{max-width:1100px;margin:0 auto}.run{background:white;border:1px solid #ddd;border-radius:12px;padding:18px;margin:18px 0;box-shadow:0 1px 2px #0001}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.kv{background:#f1f1f3;border-radius:8px;padding:8px}.prompt{font-size:1.05rem}.artifact{margin-top:14px}video,img,audio{max-width:100%;border-radius:10px;border:1px solid #ddd;background:#111}code{background:#eee;border-radius:4px;padding:1px 4px;word-break:break-all}pre{white-space:pre-wrap;background:#111;color:#eee;padding:10px;border-radius:8px;overflow:auto}.muted{color:#666}.bad{color:#9a3412}.ok{color:#166534}
</style>
</head>
<body><main>
<p><a href="${escapeAttribute(input.indexHref)}">← Report index</a></p>
<h1>${escapeHtml(input.functionName)}</h1>
<p class="muted">Input: <code>${escapeHtml(input.inputLabel)}</code></p>
${runs}
</main></body>
</html>
`
}

function renderFunctionNav(functionPages: JimengProofFunctionPage[], outDir: string): string {
  if (functionPages.length === 0) return ""
  const links = functionPages.map((page) => {
    const href = relativeUrlFrom(outDir, page.htmlFile)
    return `<li><a href="${escapeAttribute(href)}">${escapeHtml(page.functionName)}</a> <span class="muted">(${page.runCount})</span></li>`
  }).join("")
  return `<section class="run"><h2>Function reports</h2><ul>${links}</ul></section>`
}

function renderRunHtml(run: JimengProofRunSummary, outDir: string): string {
  const artifacts = run.artifacts.length === 0
    ? `<p class="bad">No downloaded artifacts in result JSON.</p>`
    : run.artifacts.map((artifact) => renderArtifactHtml(artifact, outDir)).join("\n")
  return `<section class="run">
<h2>${escapeHtml(run.command ?? "unknown command")}</h2>
<p class="prompt">${escapeHtml(run.prompt ?? "Prompt unavailable")}</p>
<div class="grid">
<div class="kv"><strong>Submit</strong><br><code>${escapeHtml(run.submitId ?? "unknown")}</code></div>
<div class="kv"><strong>History</strong><br><code>${escapeHtml(run.historyId ?? "unknown")}</code></div>
<div class="kv"><strong>Status</strong><br><code>${escapeHtml(String(run.status ?? "unknown"))}</code></div>
<div class="kv"><strong>Polls</strong><br>${run.traceCount}</div>
</div>
<p>Result JSON: <a href="${escapeAttribute(relativeUrlFrom(outDir, run.file))}"><code>${escapeHtml(run.relativeFile)}</code></a></p>
${artifacts}
</section>`
}

function renderArtifactHtml(artifact: JimengProofArtifactSummary, outDir: string): string {
  const href = relativeUrlFrom(outDir, artifact.file)
  const file = escapeAttribute(href)
  const label = `${artifact.kind} · ${artifact.bytes ?? "unknown"} bytes`
  let preview: string
  if (artifact.kind === "video" || artifact.file.endsWith(".mp4")) preview = `<video controls src="${file}"></video>`
  else if (artifact.kind === "image" || /\.(png|jpe?g|webp)$/i.test(artifact.file)) preview = `<img src="${file}" alt="generated artifact">`
  else if (artifact.kind === "audio" || /\.(mp3|wav|m4a)$/i.test(artifact.file)) preview = `<audio controls src="${file}"></audio>`
  else preview = `<a href="${file}">Open artifact</a>`
  return `<div class="artifact"><h3>${escapeHtml(label)}</h3>${preview}<p><a href="${file}"><code>${escapeHtml(artifact.relativeFile)}</code></a></p>${artifact.urlRedacted ? `<p class="muted">Source URL: <code>${escapeHtml(artifact.urlRedacted)}</code></p>` : ""}</div>`
}

function parseJsonObject(text: string, label: string): JsonRecord {
  const parsed = JSON.parse(text) as JsonValue
  const record = objectValue(parsed)
  if (!record) throw new Error(`${label} is not a JSON object`)
  return record
}

function extractPrompt(body: JsonRecord | null): string | null {
  const draftContent = stringValue(body?.draft_content)
  if (draftContent) {
    const parsed = safeJsonObject(draftContent)
    const prompt = firstStringByKey(parsed, "prompt") ?? firstStringByKey(parsed, "text")
    if (prompt) return prompt
  }
  return firstStringByKey(body, "prompt")
}

function firstStringByKey(value: JsonValue | undefined, key: string): string | null {
  if (!value || typeof value !== "object") return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStringByKey(item, key)
      if (found) return found
    }
    return null
  }
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key && typeof entryValue === "string" && entryValue.trim()) return entryValue
    const found = firstStringByKey(entryValue, key)
    if (found) return found
  }
  return null
}

function promptFromHistoryGroup(value: string | null): string | null {
  if (!value) return null
  const marker = "#generate_"
  const idx = value.indexOf(marker)
  return idx > 0 ? value.slice(0, idx) : value
}

function safeJsonObject(text: string): JsonRecord | null {
  try {
    return objectValue(JSON.parse(text) as JsonValue)
  } catch {
    return null
  }
}

function objectPath(value: JsonRecord | null, keys: string[]): JsonValue | undefined {
  let current: JsonValue | undefined = value ?? undefined
  for (const key of keys) {
    const record = objectValue(current)
    if (!record) return undefined
    current = record[key]
  }
  return current
}

function objectValue(value: JsonValue | undefined): JsonRecord | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function arrayValue(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberOrStringValue(value: JsonValue | undefined): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null
}

function isArtifactSummary(value: JimengProofArtifactSummary | null): value is JimengProofArtifactSummary {
  return value !== null
}

function relativePath(root: string, file: string): string {
  return path.relative(root, path.resolve(file)) || path.basename(file)
}

function relativeUrlFrom(fromDir: string, file: string): string {
  return path.relative(fromDir, path.resolve(file)).split(path.sep).map(encodeURIComponent).join("/")
}

function fileSizeOrNull(file: string): number | null {
  try {
    return statSync(file).size
  } catch {
    return null
  }
}

function inferArtifactKind(file: string): string {
  if (file.endsWith(".mp4")) return "video"
  if (/\.(png|jpe?g|webp)$/i.test(file)) return "image"
  if (/\.(mp3|wav|m4a)$/i.test(file)) return "audio"
  return "file"
}

function redactSignedUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    parsed.search = ""
    return parsed.toString()
  } catch {
    return "[unparseable-url]"
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}
