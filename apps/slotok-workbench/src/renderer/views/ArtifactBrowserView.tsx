/** @jsxImportSource react */
import * as React from "react"
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileJson,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Layers3,
  Music2,
  PackageOpen,
} from "lucide-react"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Tabs, type TabItem } from "../components/ui/tabs"
import { EmptyState, MetricRow, PanelCard, StatusBadge, ToolbarCluster } from "../design-system/workbench"
import { cn } from "../lib/cn"

type ArtifactMediaType = "json" | "video" | "image" | "audio" | "text"
type ArtifactTypeFilter = "all" | ArtifactMediaType
type ArtifactGroupId = "plans" | "renders" | "frames" | "audio" | "handoff"

export interface ArtifactBrowserViewProps {
  readonly bootstrapRoot: string
  readonly sampleId: string
  readonly daemonBaseUrl: string
}

interface ArtifactDescriptor {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly relativePath: string
  readonly mediaType: ArtifactMediaType
  readonly group: ArtifactGroupId
  readonly primary?: boolean
}

const PAGE_SIZE = 8

const artifactGroupTabs: readonly TabItem<ArtifactGroupId>[] = [
  { value: "plans", label: "Plans", ariaLabel: "Layer plans and JSON manifests" },
  { value: "renders", label: "Renders", ariaLabel: "Rendered video outputs" },
  { value: "frames", label: "Frames", ariaLabel: "Sampled proof frames" },
  { value: "audio", label: "Audio", ariaLabel: "Narration and text to speech artifacts" },
  { value: "handoff", label: "Handoff", ariaLabel: "Slotok handoff and workflow manifests" },
]

const typeFilters: readonly { readonly value: ArtifactTypeFilter; readonly label: string }[] = [
  { value: "all", label: "All" },
  { value: "json", label: "JSON" },
  { value: "video", label: "Video" },
  { value: "image", label: "Images" },
  { value: "audio", label: "Audio" },
  { value: "text", label: "Text" },
]

export function ArtifactBrowserView(props: ArtifactBrowserViewProps) {
  const trimmedSampleId = props.sampleId.trim()
  const trimmedBootstrapRoot = props.bootstrapRoot.trim()
  const trimmedDaemonBaseUrl = props.daemonBaseUrl.trim()
  const [activeGroup, setActiveGroup] = React.useState<ArtifactGroupId>("plans")
  const [typeFilter, setTypeFilter] = React.useState<ArtifactTypeFilter>("all")
  const [page, setPage] = React.useState(0)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [previewText, setPreviewText] = React.useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [mediaUnavailable, setMediaUnavailable] = React.useState(false)

  const artifacts = React.useMemo(() => buildArtifactList(trimmedSampleId), [trimmedSampleId])
  const groupArtifacts = React.useMemo(
    () => artifacts.filter((artifact) => artifact.group === activeGroup),
    [activeGroup, artifacts],
  )
  const visibleArtifacts = React.useMemo(
    () => groupArtifacts.filter((artifact) => typeFilter === "all" || artifact.mediaType === typeFilter),
    [groupArtifacts, typeFilter],
  )
  const pageCount = Math.max(1, Math.ceil(visibleArtifacts.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pagedArtifacts = visibleArtifacts.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const selectedArtifact = React.useMemo(
    () => visibleArtifacts.find((artifact) => artifact.id === selectedId) ?? visibleArtifacts[0] ?? null,
    [selectedId, visibleArtifacts],
  )
  const selectedPreviewUrl = selectedArtifact ? fileUrl(trimmedDaemonBaseUrl, trimmedBootstrapRoot, selectedArtifact.relativePath) : ""
  const selectedFullPath = selectedArtifact ? joinBootstrapPath(trimmedBootstrapRoot, selectedArtifact.relativePath) : ""

  React.useEffect(() => {
    setPage(0)
  }, [activeGroup, typeFilter, trimmedSampleId])

  React.useEffect(() => {
    if (!selectedArtifact) {
      setSelectedId(null)
      return
    }
    if (selectedId && visibleArtifacts.some((artifact) => artifact.id === selectedId)) return
    setSelectedId(selectedArtifact.id)
  }, [selectedArtifact, selectedId, visibleArtifacts])

  React.useEffect(() => {
    setMediaUnavailable(false)
    setPreviewText(null)
    setPreviewError(null)

    if (!selectedArtifact || (selectedArtifact.mediaType !== "json" && selectedArtifact.mediaType !== "text") || !trimmedBootstrapRoot || !trimmedDaemonBaseUrl) {
      setPreviewBusy(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setPreviewBusy(true)

    fetch(fileUrl(trimmedDaemonBaseUrl, trimmedBootstrapRoot, selectedArtifact.relativePath), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.text()
      })
      .then((text) => {
        if (!cancelled) setPreviewText(formatPreviewText(text, selectedArtifact.mediaType))
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return
        setPreviewError(error instanceof Error ? error.message : "Preview unavailable")
      })
      .finally(() => {
        if (!cancelled) setPreviewBusy(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selectedArtifact, trimmedBootstrapRoot, trimmedDaemonBaseUrl])

  const typeCounts = React.useMemo(
    () => groupArtifacts.reduce<Record<ArtifactMediaType, number>>(
      (counts, artifact) => {
        counts[artifact.mediaType] += 1
        return counts
      },
      { json: 0, video: 0, image: 0, audio: 0, text: 0 },
    ),
    [groupArtifacts],
  )
  const emptyInput = !trimmedBootstrapRoot || !trimmedSampleId || !trimmedDaemonBaseUrl

  if (emptyInput) {
    return (
      <section className="flex h-full min-h-0 flex-col bg-zinc-50/50 text-zinc-900">
        <EmptyState
          icon={<PackageOpen size={18} />}
          title="Artifact browser unavailable"
          body="Provide bootstrapRoot, sampleId, and daemonBaseUrl to resolve deterministic Slotok artifact paths."
        />
      </section>
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-50/50 text-zinc-900">
      <header className="shrink-0 border-b border-zinc-200 bg-white px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-600">
                <FolderOpen size={14} />
              </div>
              <h2 className="truncate text-sm font-semibold leading-5 text-zinc-900">Artifact browser</h2>
              <StatusBadge tone="active">local files</StatusBadge>
            </div>
            <p className="max-w-[72ch] text-xs leading-5 text-zinc-600">
              Known outputs for <span className="font-mono text-[11px] text-zinc-800">{trimmedSampleId}</span> under <span className="font-mono text-[11px] text-zinc-800">{trimmedBootstrapRoot}</span>.
            </p>
          </div>
          <ToolbarCluster className="max-w-full flex-wrap rounded-lg border-zinc-200 bg-zinc-50/70 shadow-none">
            {typeFilters.map((filter) => {
              const count = filter.value === "all" ? groupArtifacts.length : typeCounts[filter.value]
              const active = typeFilter === filter.value
              return (
                <button
                  key={filter.value}
                  type="button"
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md border border-solid px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
                    active ? "border-primary/20 bg-primary/10 text-primary" : "border-transparent bg-transparent text-zinc-600 hover:bg-white hover:text-zinc-900",
                  )}
                  onClick={() => setTypeFilter(filter.value)}
                >
                  {filter.label}
                  <span className={cn("rounded-full px-1.5 py-0 text-[10px] leading-4", active ? "bg-white/75 text-primary" : "bg-zinc-200/70 text-zinc-600")}>{count}</span>
                </button>
              )
            })}
          </ToolbarCluster>
        </div>
        <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
          <Tabs value={activeGroup} items={artifactGroupTabs} onValueChange={setActiveGroup} size="sm" className="max-w-full overflow-x-auto" />
          <div className="hidden shrink-0 items-center gap-2 text-[11px] text-zinc-500 sm:flex">
            <span>{visibleArtifacts.length} artifacts</span>
            <span className="h-1 w-1 rounded-full bg-zinc-300" />
            <span>Page {safePage + 1} of {pageCount}</span>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(330px,0.43fr)_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-zinc-200 bg-zinc-50/70 p-3 lg:border-b-0 lg:border-r">
          {pagedArtifacts.length === 0 ? (
            <EmptyState
              icon={<Layers3 size={18} />}
              title="No known artifacts in this slice"
              body="Change the type chip or artifact lane. The browser only lists deterministic Slotok paths for this sample."
              className="min-h-[20rem] rounded-lg border border-dashed border-zinc-200 bg-white"
            />
          ) : (
            <div className="grid gap-2">
              {pagedArtifacts.map((artifact) => (
                <ArtifactCard
                  key={artifact.id}
                  artifact={artifact}
                  selected={selectedArtifact?.id === artifact.id}
                  fullPath={joinBootstrapPath(trimmedBootstrapRoot, artifact.relativePath)}
                  onSelect={() => setSelectedId(artifact.id)}
                />
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-200 pt-3">
            <Button variant="workbench" size="xs" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={safePage === 0}>
              <ChevronLeft size={13} />
              Prev
            </Button>
            <span className="text-[11px] font-medium text-zinc-500">
              {visibleArtifacts.length === 0 ? "0" : `${safePage * PAGE_SIZE + 1}-${Math.min(visibleArtifacts.length, (safePage + 1) * PAGE_SIZE)}`} of {visibleArtifacts.length}
            </span>
            <Button variant="workbench" size="xs" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={safePage >= pageCount - 1}>
              Next
              <ChevronRight size={13} />
            </Button>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 overflow-y-auto bg-white p-3">
          {selectedArtifact ? (
            <SelectedPreview
              artifact={selectedArtifact}
              fullPath={selectedFullPath}
              previewUrl={selectedPreviewUrl}
              previewText={previewText}
              previewBusy={previewBusy}
              previewError={previewError}
              mediaUnavailable={mediaUnavailable}
              onMediaUnavailable={() => setMediaUnavailable(true)}
            />
          ) : (
            <EmptyState
              icon={<PackageOpen size={18} />}
              title="Select an artifact"
              body="Choose a known path to inspect the generated media or payload from the Slotok daemon file route."
            />
          )}
        </main>
      </div>
    </section>
  )
}

function ArtifactCard(props: {
  readonly artifact: ArtifactDescriptor
  readonly selected: boolean
  readonly fullPath: string
  readonly onSelect: () => void
}) {
  return (
    <Card variant={props.selected ? "selected" : "flat"} density="compact" className="overflow-hidden bg-white">
      <button
        type="button"
        className="grid w-full gap-2 p-2.5 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
        onClick={props.onSelect}
      >
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-600">
              <ArtifactTypeIcon mediaType={props.artifact.mediaType} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold leading-5 text-zinc-900">{props.artifact.label}</span>
              <span className="line-clamp-2 text-[11px] leading-4 text-zinc-600">{props.artifact.description}</span>
            </span>
          </div>
          {props.artifact.primary ? <Badge variant="info" className="shrink-0">primary</Badge> : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant="outline">{props.artifact.mediaType}</Badge>
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] leading-4 text-zinc-500">{props.fullPath}</span>
        </div>
      </button>
    </Card>
  )
}

function SelectedPreview(props: {
  readonly artifact: ArtifactDescriptor
  readonly fullPath: string
  readonly previewUrl: string
  readonly previewText: string | null
  readonly previewBusy: boolean
  readonly previewError: string | null
  readonly mediaUnavailable: boolean
  readonly onMediaUnavailable: () => void
}) {
  return (
    <div className="grid min-h-full grid-rows-[auto_minmax(0,1fr)] gap-3">
      <PanelCard tone="muted" density="compact" className="rounded-lg">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-600">
                <ArtifactTypeIcon mediaType={props.artifact.mediaType} />
              </span>
              <h3 className="truncate text-sm font-semibold leading-5 text-zinc-900">{props.artifact.label}</h3>
              <Badge variant="outline">{props.artifact.mediaType}</Badge>
            </div>
            <p className="max-w-[72ch] text-xs leading-5 text-zinc-600">{props.artifact.description}</p>
          </div>
          <Button asChild variant="workbench" size="xs">
            <a href={props.previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={13} />
              Open file
            </a>
          </Button>
        </div>
        <div className="mt-3 grid gap-1.5 border-t border-zinc-200 pt-2">
          <MetricRow label="Path" value={<span className="font-mono text-[11px] font-medium">{props.fullPath}</span>} />
          <MetricRow label="Route" value={<span className="font-mono text-[11px] font-medium">/api/file</span>} />
        </div>
      </PanelCard>

      <Card variant="flat" className="min-h-0 overflow-hidden rounded-lg bg-white">
        <CardHeader className="border-b border-zinc-200 p-3">
          <CardTitle className="flex items-center gap-2 text-xs">
            Preview
            {props.previewBusy ? <Badge variant="outline">loading</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="min-h-[26rem] p-0">
          <PreviewBody {...props} />
        </CardContent>
      </Card>
    </div>
  )
}

function PreviewBody(props: {
  readonly artifact: ArtifactDescriptor
  readonly previewUrl: string
  readonly previewText: string | null
  readonly previewBusy: boolean
  readonly previewError: string | null
  readonly mediaUnavailable: boolean
  readonly onMediaUnavailable: () => void
}) {
  if (props.previewError) {
    return <UnavailablePreview message={props.previewError} />
  }

  if (props.mediaUnavailable) {
    return <UnavailablePreview message="The daemon file route did not return previewable media for this path." />
  }

  if (props.artifact.mediaType === "video") {
    return (
      <div className="grid min-h-[26rem] place-items-center bg-zinc-950 p-3">
        <video className="max-h-[68vh] w-full max-w-5xl rounded-md bg-black" src={props.previewUrl} controls preload="metadata" onError={props.onMediaUnavailable} />
      </div>
    )
  }

  if (props.artifact.mediaType === "image") {
    return (
      <div className="grid min-h-[26rem] place-items-center bg-zinc-100 p-3">
        <img className="max-h-[68vh] max-w-full rounded-md border border-zinc-200 bg-white object-contain" src={props.previewUrl} alt={`${props.artifact.label} preview`} onError={props.onMediaUnavailable} />
      </div>
    )
  }

  if (props.artifact.mediaType === "audio") {
    return (
      <div className="grid min-h-[26rem] place-items-center bg-zinc-50 p-6">
        <div className="grid w-full max-w-2xl gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <Music2 size={16} />
            {props.artifact.label}
          </div>
          <audio className="w-full" src={props.previewUrl} controls preload="metadata" onError={props.onMediaUnavailable} />
          <p className="text-xs leading-5 text-zinc-600">Audio preview streams directly from the local Slotok daemon file route.</p>
        </div>
      </div>
    )
  }

  if (props.previewBusy) {
    return (
      <div className="grid min-h-[26rem] place-items-center bg-zinc-50 p-6 text-xs text-zinc-500">
        Loading text preview…
      </div>
    )
  }

  if (!props.previewText) {
    return <UnavailablePreview message="No text preview is available for this artifact yet." />
  }

  return (
    <pre className="min-h-[26rem] overflow-auto bg-zinc-950 p-3 font-mono text-[11px] leading-5 text-zinc-100">
      {props.previewText}
    </pre>
  )
}

function UnavailablePreview(props: { readonly message: string }) {
  return (
    <div className="grid min-h-[26rem] place-items-center bg-zinc-50 p-6">
      <div className="grid max-w-sm gap-2 text-center">
        <div className="mx-auto grid h-9 w-9 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500">
          <AlertCircle size={16} />
        </div>
        <p className="text-sm font-semibold text-zinc-900">Preview unavailable</p>
        <p className="text-xs leading-5 text-zinc-600">{props.message}</p>
      </div>
    </div>
  )
}

function buildArtifactList(sampleId: string): readonly ArtifactDescriptor[] {
  if (!sampleId) return []
  return [
    {
      id: "chapter-manifest",
      label: "Chapter manifest",
      description: "Merged timeline chapter plan used by the renderer lanes.",
      relativePath: "chapter-manifest-merged.json",
      mediaType: "json",
      group: "plans",
      primary: true,
    },
    {
      id: "birthrate-layer-plan",
      label: "Birthrate layer plan",
      description: "Layer-system plan for animated captions, plates, timing, and compositor handoff.",
      relativePath: "birthrate-layer-plan.json",
      mediaType: "json",
      group: "plans",
      primary: true,
    },
    {
      id: "workflow-comparison",
      label: "Workflow comparison",
      description: "Renderer and model lane manifest used to compare generated outputs.",
      relativePath: "workflow-comparison.json",
      mediaType: "json",
      group: "plans",
    },
    {
      id: "remotion-layered-mp4",
      label: "Remotion layered MP4",
      description: "Local Remotion reconstruction output for the selected TikTok sample.",
      relativePath: `renders/${sampleId}-layered/recreate.mp4`,
      mediaType: "video",
      group: "renders",
      primary: true,
    },
    {
      id: "remotion-layered-manifest",
      label: "Remotion layered manifest",
      description: "Render manifest for the Remotion layered output directory.",
      relativePath: `renders/${sampleId}-layered/manifest.json`,
      mediaType: "json",
      group: "renders",
    },
    {
      id: "hyperframes-mp4",
      label: "HyperFrames MP4",
      description: "HyperFrames recreation output produced by the local renderer command.",
      relativePath: `renders/${sampleId}-hyperframes/recreate.mp4`,
      mediaType: "video",
      group: "renders",
      primary: true,
    },
    {
      id: "hyperframes-manifest",
      label: "HyperFrames manifest",
      description: "HyperFrames render manifest and provenance payload.",
      relativePath: `renders/${sampleId}-hyperframes/manifest.json`,
      mediaType: "json",
      group: "renders",
    },
    {
      id: "render-final-mp4",
      label: "Final MP4",
      description: "Primary composite render output from the bootstrap render directory.",
      relativePath: `renders/${sampleId}/final.mp4`,
      mediaType: "video",
      group: "renders",
    },
    {
      id: "source-frame-001",
      label: "Source frame 001",
      description: "Sampled source frame captured for visual and decomposition reference.",
      relativePath: `frames/${sampleId}/frame_001.jpg`,
      mediaType: "image",
      group: "frames",
      primary: true,
    },
    {
      id: "render-frame-001",
      label: "Render frame 001",
      description: "Proof frame emitted beside the primary composite render.",
      relativePath: `renders/${sampleId}/frame-001.png`,
      mediaType: "image",
      group: "frames",
    },
    {
      id: "hyperframes-frame-003",
      label: "HyperFrames frame 003",
      description: "Early proof frame for the HyperFrames renderer lane.",
      relativePath: `renders/${sampleId}-hyperframes/frame-003.png`,
      mediaType: "image",
      group: "frames",
    },
    {
      id: "hyperframes-frame-030",
      label: "HyperFrames frame 030",
      description: "Midstream proof frame for HyperFrames timing and layer inspection.",
      relativePath: `renders/${sampleId}-hyperframes/frame-030.png`,
      mediaType: "image",
      group: "frames",
    },
    {
      id: "narration-mp3",
      label: "Narration MP3",
      description: "MiniMax narration audio generated for the current sample.",
      relativePath: `tts/${sampleId}/audio/narration.mp3`,
      mediaType: "audio",
      group: "audio",
      primary: true,
    },
    {
      id: "tts-manifest",
      label: "TTS manifest",
      description: "Narration timing, provider, and text-to-speech manifest.",
      relativePath: `tts/${sampleId}/tts-manifest.json`,
      mediaType: "json",
      group: "audio",
    },
    {
      id: "tts-request",
      label: "TTS request",
      description: "Provider request payload used to synthesize narration.",
      relativePath: `tts/${sampleId}/tts-request.json`,
      mediaType: "json",
      group: "audio",
    },
    {
      id: "tts-response",
      label: "TTS response",
      description: "Provider response captured beside the narration audio artifact.",
      relativePath: `tts/${sampleId}/audio/narration.response.json`,
      mediaType: "json",
      group: "audio",
    },
    {
      id: "slotok-handoff",
      label: "Slotok handoff",
      description: "Workflow handoff payload for importing the recreation into Slotok state.",
      relativePath: "slotok-handoff.json",
      mediaType: "json",
      group: "handoff",
      primary: true,
    },
    {
      id: "slotok-handoff-v5",
      label: "Slotok handoff v5",
      description: "Versioned handoff payload for the current recreation pipeline.",
      relativePath: "slotok-handoff-v5.json",
      mediaType: "json",
      group: "handoff",
    },
    {
      id: "slotok-handoff-verify",
      label: "Handoff verify",
      description: "Import verification artifact for local workflow handoff checks.",
      relativePath: "slotok-handoff.verify.json",
      mediaType: "json",
      group: "handoff",
    },
    {
      id: "bootstrap-manifest",
      label: "Bootstrap manifest",
      description: "Top-level manifest for deterministic bootstrap artifacts.",
      relativePath: "manifest.json",
      mediaType: "json",
      group: "handoff",
    },
  ]
}

function formatPreviewText(text: string, mediaType: ArtifactMediaType): string {
  if (mediaType !== "json") return text
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2)
  } catch {
    return text
  }
}

function fileUrl(daemonBaseUrl: string, bootstrapRoot: string, relativePath: string): string {
  const base = daemonBaseUrl.replace(/\/+$/, "")
  return `${base}/api/file?path=${encodeURIComponent(joinBootstrapPath(bootstrapRoot, relativePath))}`
}

function joinBootstrapPath(bootstrapRoot: string, relativePath: string): string {
  const root = bootstrapRoot.replace(/\/+$/, "")
  const path = relativePath.replace(/^\/+/, "")
  if (!root) return path
  if (!path) return root
  return `${root}/${path}`
}

function ArtifactTypeIcon(props: { readonly mediaType: ArtifactMediaType; readonly className?: string }) {
  const iconProps = { size: 14, className: props.className, "aria-hidden": true }
  switch (props.mediaType) {
    case "json":
      return <FileJson {...iconProps} />
    case "video":
      return <Film {...iconProps} />
    case "image":
      return <ImageIcon {...iconProps} />
    case "audio":
      return <Music2 {...iconProps} />
    case "text":
      return <FileText {...iconProps} />
  }
}
