/** @jsxImportSource react */
import * as React from "react"
import { ExternalLink, Film, Play, RefreshCw } from "lucide-react"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Select } from "../components/ui/select"
import { Textarea } from "../components/ui/textarea"
import {
  InspectorActionResult,
  InspectorPanel,
  PanelCard,
  PanelHeader,
  StatusBadge,
  WorkbenchCanvas,
  WorkbenchContent,
} from "../design-system/workbench"

export interface HyperFramesViewProps {
  readonly bootstrapRoot: string
  readonly sampleId: string
  readonly daemonBaseUrl: string
}

type RenderState = "idle" | "running" | "done" | "errored"

interface RenderAccepted {
  readonly ok: true
  readonly jobId?: string
  readonly job?: string
  readonly command: string
  readonly outputDir: string
  readonly manifestPath: string
  readonly stdout?: string
}

interface RenderSuccess extends RenderAccepted {
  readonly stdout: string
  readonly stderr?: string
  readonly exitCode?: number
  readonly status?: string
}

interface RenderRequestBody {
  readonly bootstrapRoot: string
  readonly sampleId: string
  readonly designSystem: string
  readonly template: string
  readonly render: true
}

const designSystemOptions = [
  { value: "default", label: "default" },
  { value: "warm-editorial", label: "warm-editorial" },
  { value: "atelier-zero", label: "atelier-zero" },
  { value: "xiaohongshu", label: "xiaohongshu" },
  { value: "linear-app", label: "linear-app" },
] as const

const templateOptions = [
  { value: "hyperframes-tiktok-karaoke-talking-head", label: "hyperframes-tiktok-karaoke-talking-head" },
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isRenderAccepted(value: unknown): value is RenderAccepted {
  if (!isRecord(value) || value.ok !== true) return false
  return (
    typeof value.command === "string" &&
    typeof value.outputDir === "string" &&
    typeof value.manifestPath === "string" &&
    (value.jobId === undefined || typeof value.jobId === "string") &&
    (value.job === undefined || typeof value.job === "string") &&
    (value.stdout === undefined || typeof value.stdout === "string")
  )
}

function errorFromPayload(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim()) return payload.error
  return fallback
}

export function HyperFramesView({ bootstrapRoot, sampleId, daemonBaseUrl }: HyperFramesViewProps) {
  const [designSystem, setDesignSystem] = React.useState<(typeof designSystemOptions)[number]["value"]>("default")
  const [template, setTemplate] = React.useState<(typeof templateOptions)[number]["value"]>("hyperframes-tiktok-karaoke-talking-head")
  const [state, setState] = React.useState<RenderState>("idle")
  const [result, setResult] = React.useState<RenderSuccess | null>(null)
  const [accepted, setAccepted] = React.useState<RenderAccepted | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [lastRequest, setLastRequest] = React.useState<RenderRequestBody | null>(null)

  React.useEffect(() => {
    setState("idle")
    setResult(null)
    setAccepted(null)
    setError(null)
    setLastRequest(null)
  }, [bootstrapRoot, sampleId, daemonBaseUrl])

  const baseUrl = daemonBaseUrl.replace(/\/+$/, "")
  const previewPath = `renders/${sampleId}-hyperframes/recreate.mp4`
  const defaultManifestPath = `renders/${sampleId}-hyperframes/manifest.json`
  const previewArtifactPath = previewPath.startsWith("/") || previewPath.startsWith("data/") ? previewPath : `${bootstrapRoot.replace(/\/+$/, "")}/${previewPath.replace(/^\/+/, "")}`
  const manifestPath = result?.manifestPath || accepted?.manifestPath || defaultManifestPath
  const outputDir = result?.outputDir || accepted?.outputDir
  const manifestArtifactPath = manifestPath.startsWith("/") || manifestPath.startsWith("data/") ? manifestPath : `${bootstrapRoot.replace(/\/+$/, "")}/${manifestPath.replace(/^\/+/, "")}`
  const previewUrl = `${baseUrl}/api/file?path=${encodeURIComponent(previewArtifactPath)}`
  const manifestUrl = `${baseUrl}/api/file?path=${encodeURIComponent(manifestArtifactPath)}`
  const commandText = result?.command || accepted?.command || (lastRequest ? `POST ${baseUrl}/api/ugc/hyperframes/render\n${JSON.stringify(lastRequest, null, 2)}` : "No render command has been submitted yet.")
  const resultText = result ? JSON.stringify(result, null, 2) : error ? error : accepted ? JSON.stringify(accepted, null, 2) : "Submit a render to see daemon output and artifact paths."

  async function submitRender(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body: RenderRequestBody = {
      bootstrapRoot,
      sampleId,
      designSystem,
      template,
      render: true,
    }
    setLastRequest(body)
    setState("running")
    setError(null)
    setResult(null)
    setAccepted(null)

    try {
      const response = await fetch(`${baseUrl}/api/ugc/hyperframes/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const text = await response.text()
      let payload: unknown = null
      if (text.trim()) {
        try {
          payload = JSON.parse(text)
        } catch {
          payload = text
        }
      }

      if (!response.ok) {
        setState("errored")
        setError(errorFromPayload(payload, `HTTP ${response.status}`))
        return
      }

      if (!isRenderAccepted(payload)) {
        setState("errored")
        setError("Renderer returned an unexpected response shape.")
        return
      }

      setAccepted(payload)
      const jobId = payload.jobId || payload.job

      if (typeof payload.stdout === "string" && !jobId) {
        setResult({ ...payload, stdout: payload.stdout })
        setState("done")
        return
      }

      if (!jobId) {
        setState("errored")
        setError("Renderer accepted the request without stdout or a job id.")
        return
      }

      for (let attempt = 0; attempt < 120; attempt += 1) {
        const jobResponse = await fetch(`${baseUrl}/api/ugc/hyperframes/jobs/${encodeURIComponent(jobId)}`)
        const jobText = await jobResponse.text()
        let jobPayload: unknown = null
        if (jobText.trim()) {
          try {
            jobPayload = JSON.parse(jobText)
          } catch {
            jobPayload = jobText
          }
        }

        if (!jobResponse.ok) {
          setState("errored")
          setError(errorFromPayload(jobPayload, `Job ${jobId} returned HTTP ${jobResponse.status}`))
          return
        }

        if (!isRecord(jobPayload)) {
          setState("errored")
          setError("Renderer job returned an unexpected response shape.")
          return
        }

        const jobStatus = typeof jobPayload.status === "string" ? jobPayload.status : ""
        const exitCode = typeof jobPayload.exitCode === "number" ? jobPayload.exitCode : undefined
        const stdout = typeof jobPayload.stdout === "string" ? jobPayload.stdout : ""
        const stderr = typeof jobPayload.stderr === "string" ? jobPayload.stderr : undefined
        const command = typeof jobPayload.command === "string" ? jobPayload.command : payload.command
        const outputDir = typeof jobPayload.outputDir === "string" ? jobPayload.outputDir : payload.outputDir
        const manifest = typeof jobPayload.manifestPath === "string" ? jobPayload.manifestPath : payload.manifestPath

        if (jobStatus === "failed" || jobStatus === "errored" || jobStatus === "error" || jobStatus === "cancelled" || jobStatus === "timed_out" || (exitCode !== undefined && exitCode !== 0)) {
          setState("errored")
          setError(errorFromPayload(jobPayload, stderr || `Renderer job ${jobId} failed.`))
          return
        }

        if (jobStatus === "done" || jobStatus === "completed" || jobStatus === "complete" || jobStatus === "succeeded" || jobStatus === "success" || jobStatus === "finished") {
          setResult({ ok: true, jobId, command, outputDir, manifestPath: manifest, stdout, stderr, exitCode, status: jobStatus })
          setState("done")
          return
        }

        const sleeper = Promise.withResolvers<void>()
        window.setTimeout(sleeper.resolve, 1000)
        await sleeper.promise
      }

      setState("errored")
      setError(`Renderer job ${jobId} did not finish before the polling timeout.`)
    } catch (caught) {
      setState("errored")
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <WorkbenchContent className="h-full grid-cols-[minmax(0,1fr)_minmax(320px,380px)] bg-background">
      <WorkbenchCanvas className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-r-0">
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border/80 bg-white px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Film size={15} className="text-zinc-700" />
              <h1 className="truncate text-sm font-semibold leading-5 text-foreground">HyperFrames artifact workspace</h1>
              <Badge variant="outline">local renderer</Badge>
            </div>
            <p className="truncate text-[11px] leading-4 text-muted-foreground">{previewPath}</p>
          </div>
          <StatusBadge tone={state === "done" ? "success" : state === "errored" ? "danger" : state === "running" ? "active" : "neutral"}>
            {state === "running" ? "rendering" : state}
          </StatusBadge>
        </header>

        <div className="grid min-h-0 gap-3 overflow-auto p-3">
          <PanelCard className="grid min-h-[360px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden" density="compact">
            <PanelHeader
              title="Current MP4 preview"
              actions={
                <Button asChild size="xs" variant="workbench">
                  <a href={previewUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} /> Open MP4
                  </a>
                </Button>
              }
            />
            <div className="flex min-h-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-950 p-3">
              <video key={previewUrl} className="max-h-[68vh] max-w-full rounded-md bg-black shadow-[0_1px_3px_rgba(0,0,0,0.18)]" controls preload="metadata" src={previewUrl}>
                <a href={previewUrl}>Open the HyperFrames MP4 artifact.</a>
              </video>
            </div>
          </PanelCard>

          <PanelCard density="compact">
            <PanelHeader title="Artifact links" />
            <div className="grid gap-2 text-[11px] leading-4">
              <ArtifactLink label="MP4" path={previewPath} href={previewUrl} />
              <ArtifactLink label="Manifest" path={manifestPath} href={manifestUrl} />
              {outputDir ? <ArtifactPath label="Output directory" path={outputDir} /> : null}
            </div>
          </PanelCard>
        </div>
      </WorkbenchCanvas>

      <InspectorPanel className="grid content-start gap-3">
        <PanelCard density="compact">
          <PanelHeader eyebrow="HyperFrames" title="Render controls" />
          <form className="grid gap-3" onSubmit={submitRender}>
            <Field label="Bootstrap root">
              <Input readOnly value={bootstrapRoot} className="font-mono text-[11px]" />
            </Field>
            <Field label="Sample ID">
              <Input readOnly value={sampleId} className="font-mono text-[11px]" />
            </Field>
            <Field label="Design system">
              <Select value={designSystem} onChange={(event) => setDesignSystem(event.currentTarget.value as typeof designSystem)} disabled={state === "running"}>
                {designSystemOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Template">
              <Select value={template} onChange={(event) => setTemplate(event.currentTarget.value as typeof template)} disabled={state === "running"}>
                {templateOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </Field>
            <Button type="submit" size="sm" disabled={state === "running"}>
              {state === "running" ? <RefreshCw size={14} className="animate-spin" /> : result ? <RefreshCw size={14} /> : <Play size={14} />}
              {state === "running" ? "Rendering…" : result ? "Rerender" : "Render"}
            </Button>
          </form>
        </PanelCard>

        <PanelCard density="compact">
          <PanelHeader title="Command and result" />
          <div className="grid gap-2">
            <InspectorActionResult
              state={state}
              summary={result ? result.outputDir : accepted ? accepted.outputDir : error || undefined}
              detail={result ? result.manifestPath : accepted ? accepted.manifestPath : state === "running" ? "Waiting for daemon response." : undefined}
            />
            <Field label="Command">
              <Textarea readOnly value={commandText} className="min-h-28 font-mono text-[11px]" />
            </Field>
            <Field label={result ? "Response" : error ? "Error" : "Output"}>
              <Textarea readOnly value={resultText} className="min-h-32 font-mono text-[11px]" />
            </Field>
          </div>
        </PanelCard>
      </InspectorPanel>
    </WorkbenchContent>
  )
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[11px] font-medium leading-4 text-zinc-700">
      <span>{props.label}</span>
      {props.children}
    </label>
  )
}

function ArtifactLink(props: { readonly label: string; readonly path: string; readonly href: string }) {
  return (
    <a className="group grid grid-cols-[74px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-zinc-700 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary" href={props.href} target="_blank" rel="noreferrer">
      <span className="font-medium text-foreground">{props.label}</span>
      <span className="truncate font-mono text-[10px] text-muted-foreground group-hover:text-primary/80">{props.path}</span>
      <ExternalLink size={12} />
    </a>
  )
}

function ArtifactPath(props: { readonly label: string; readonly path: string }) {
  return (
    <div className="grid grid-cols-[94px_minmax(0,1fr)] items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-zinc-700">
      <span className="font-medium text-foreground">{props.label}</span>
      <span className="truncate font-mono text-[10px] text-muted-foreground">{props.path}</span>
    </div>
  )
}
