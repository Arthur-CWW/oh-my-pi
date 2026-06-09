/** @jsxImportSource react */
import * as React from "react"
import {
  ArrowUp,
  BarChart3,
  Bell,
  Bot,
  Braces,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clapperboard,
  Clock,
  Copy,
  Download,
  Eye,
  FastForward,
  FileJson,
  Filter,
  Folder,
  GitBranch,
  GitFork,
  Grid2X2,
  Home,
  Inbox,
  Layers3,
  MessageSquare,
  MoreHorizontal,
  Network,
  Pause,
  Play,
  PlayCircle,
  Plus,
  RefreshCw,
  Rewind,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Table2,
  Target,
  UserCircle,
  Wand2,
  XCircle,
  Zap,
} from "lucide-react"
import { Badge } from "./components/ui/badge"
import { Button } from "./components/ui/button"
import { Tabs, type TabItem } from "./components/ui/tabs"
import { cn } from "./lib/cn"
import { ugcStudioWorkspace } from "./ugcStudioModel"

type ReactView = "atlas" | "explore" | "review" | "campaign" | "editor" | "provider"
type KieOperation = "image-text" | "image-to-image" | "video-text" | "image-to-video" | "reference-to-video" | "avatar" | "omni-video"

interface KieCapability {
  operation: KieOperation
  model: string
  label: string
  family: "image" | "video" | "character"
  estimatedCostUsd: number
  frugal: boolean
  notes: string
}

interface KieRequest {
  operation: KieOperation
  prompt: string
  aspectRatio: string
  durationSec: number
  resolution: string
  quality: "basic" | "standard" | "pro"
  imageUrl?: string
  maxSpendUsd?: number
  live?: boolean
}

interface PersonaCardModel {
  id: string
  name: string
  archetype: string
  niche: string
  voice: string
  accent: string
  status: "Approved" | "In Review" | "Draft" | "Rejected"
  clips: number
  branches: number
  followers: string
  conversions: string
  color: string
}

interface ExplorationItem {
  id: string
  title: string
  subtitle: string
  score: number
  status: "keep" | "review" | "new" | "risk"
  personaId?: string
  candidateId?: string
}

interface ExplorationRow {
  id: string
  step: string
  title: string
  description: string
  items: ExplorationItem[]
}

interface CampaignColumn {
  id: string
  title: string
  subtitle: string
  nodes: CampaignNode[]
}

interface CampaignNode {
  id: string
  title: string
  meta: string
  score: string
  status: "active" | "good" | "risk" | "dead"
  candidateId?: string
}

const workspace = ugcStudioWorkspace
const daemonBaseUrl = "http://127.0.0.1:47522"

const views: Array<{ value: ReactView; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string; size?: number }> }> = [
  { value: "atlas", label: "Persona Atlas", shortLabel: "Atlas", icon: Sparkles },
  { value: "explore", label: "Exploration Board", shortLabel: "Explore", icon: Wand2 },
  { value: "review", label: "Batch Review", shortLabel: "Review", icon: Play },
  { value: "campaign", label: "Campaign Branch Map", shortLabel: "Campaign", icon: GitBranch },
  { value: "editor", label: "Final Layer Editor", shortLabel: "Editor", icon: Layers3 },
  { value: "provider", label: "KIE Proxy", shortLabel: "KIE", icon: Braces },
]

const viewTabs: Array<TabItem<ReactView>> = views.map((view) => ({ value: view.value, label: view.shortLabel }))

const fallbackCapabilities: KieCapability[] = [
  {
    operation: "image-text",
    model: "seedream/5-lite-text-to-image",
    label: "Seedream 5 Lite text-to-image",
    family: "image",
    estimatedCostUsd: 0.02,
    frugal: true,
    notes: "Default dry-run route for persona/reference stills.",
  },
  {
    operation: "video-text",
    model: "bytedance/v1-lite-text-to-video",
    label: "ByteDance V1 Lite text-to-video",
    family: "video",
    estimatedCostUsd: 0.18,
    frugal: true,
    notes: "Short, cheap motion drafts.",
  },
  {
    operation: "image-to-video",
    model: "bytedance/v1-lite-image-to-video",
    label: "ByteDance V1 Lite image-to-video",
    family: "video",
    estimatedCostUsd: 0.2,
    frugal: true,
    notes: "Animate a selected reference still.",
  },
]

const personaCards: PersonaCardModel[] = [
  {
    id: "persona_lena_park",
    name: "Lena Park",
    archetype: "Skincare Minimalist",
    niche: "Barrier repair, sensitive skin",
    voice: "Calm, clear",
    accent: "American / West Coast",
    status: "Approved",
    clips: 7,
    branches: 4,
    followers: "24k",
    conversions: "3",
    color: "rose",
  },
  {
    id: "persona_maya_thompson",
    name: "Maya Thompson",
    archetype: "Science Nerd",
    niche: "Ingredients, myth-busting",
    voice: "Warm, explanatory",
    accent: "American / Midwest",
    status: "In Review",
    clips: 4,
    branches: 3,
    followers: "18k",
    conversions: "2",
    color: "blue",
  },
  {
    id: "persona_sofia_rivera",
    name: "Sofia Rivera",
    archetype: "Lifestyle",
    niche: "Glow habit stacking",
    voice: "Upbeat, friendly",
    accent: "American / East Coast",
    status: "Approved",
    clips: 3,
    branches: 3,
    followers: "31k",
    conversions: "4",
    color: "green",
  },
  {
    id: "persona_jade_lin",
    name: "Jade Lin",
    archetype: "Relatable",
    niche: "Hormone-friendly routines",
    voice: "Direct, casual",
    accent: "American / West Coast",
    status: "Rejected",
    clips: 2,
    branches: 1,
    followers: "9k",
    conversions: "0",
    color: "slate",
  },
  {
    id: "persona_chloe_bennett",
    name: "Chloe Bennett",
    archetype: "Athletic",
    niche: "Post-workout reset",
    voice: "Soft, aspirational",
    accent: "British / relaxed",
    status: "In Review",
    clips: 5,
    branches: 2,
    followers: "21k",
    conversions: "2",
    color: "amber",
  },
  {
    id: "persona_hana_kim",
    name: "Hana Kim",
    archetype: "Trend Spotter",
    niche: "K-beauty timing",
    voice: "Bright, excited",
    accent: "Korean-accented English",
    status: "Approved",
    clips: 6,
    branches: 3,
    followers: "42k",
    conversions: "5",
    color: "violet",
  },
  {
    id: "persona_ava_rodriguez",
    name: "Ava Rodriguez",
    archetype: "Practical",
    niche: "Simple skin systems",
    voice: "Gentle, empathetic",
    accent: "American / South",
    status: "Draft",
    clips: 1,
    branches: 2,
    followers: "13k",
    conversions: "1",
    color: "cyan",
  },
  {
    id: "persona_tara_singh",
    name: "Tara Singh",
    archetype: "Performance",
    niche: "Gym bag rituals",
    voice: "Energetic, motivating",
    accent: "Australian",
    status: "In Review",
    clips: 4,
    branches: 2,
    followers: "27k",
    conversions: "2",
    color: "pink",
  },
]

const explorationRows: ExplorationRow[] = [
  {
    id: "row_product",
    step: "1",
    title: "Product / offer",
    description: "Skincare constraints",
    items: [
      { id: "offer_daily_spf", title: "Daily SPF", subtitle: "light gel, no cast", score: 8.4, status: "keep" },
      { id: "offer_hydration", title: "Hydration Boost", subtitle: "gel cream test", score: 7.9, status: "review" },
      { id: "offer_acne_rescue", title: "Acne Rescue", subtitle: "calm flare-ups", score: 7.4, status: "new" },
      { id: "offer_barrier", title: "Barrier Repair", subtitle: "redness relief", score: 8.2, status: "keep" },
      { id: "offer_bundle", title: "Bundle Offer", subtitle: "AM / PM pair", score: 7.3, status: "review" },
    ],
  },
  {
    id: "row_persona",
    step: "2",
    title: "Persona",
    description: "Pick the creator",
    items: [
      { id: "persona_lena", title: "Lena Park", subtitle: "minimalist educator", score: 8.7, status: "keep", personaId: "persona_lena_park" },
      { id: "persona_hana", title: "Hana Kim", subtitle: "K-beauty timing", score: 8.8, status: "keep", personaId: "persona_hana_kim" },
      { id: "persona_maya", title: "Maya T.", subtitle: "science nerd", score: 7.6, status: "review", personaId: "persona_maya_thompson" },
      { id: "persona_tara", title: "Tara Singh", subtitle: "athletic reset", score: 7.5, status: "new", personaId: "persona_tara_singh" },
      { id: "persona_chloe", title: "Chloe B.", subtitle: "soft authority", score: 7.4, status: "review", personaId: "persona_chloe_bennett" },
    ],
  },
  {
    id: "row_format",
    step: "3",
    title: "Format",
    description: "Reusable structure",
    items: [
      { id: "format_grwm", title: "Get Ready With Me", subtitle: "soft proof", score: 8.5, status: "keep" },
      { id: "format_diy", title: "Day in My Life", subtitle: "routine proof", score: 8.1, status: "keep" },
      { id: "format_quick_tip", title: "Quick Tip", subtitle: "15 sec format", score: 8.7, status: "keep" },
      { id: "format_pov", title: "POV / relatable", subtitle: "hook first", score: 7.9, status: "review" },
      { id: "format_test", title: "Test On Skin", subtitle: "split face", score: 7.5, status: "review" },
    ],
  },
  {
    id: "row_hook",
    step: "4",
    title: "Hook",
    description: "Why stop scrolling?",
    items: [
      { id: "hook_didnt_expect", title: "Didn’t expect this", subtitle: "curiosity", score: 8.8, status: "keep", candidateId: "candidate_soft_demo_01" },
      { id: "hook_weird", title: "My dry skin hack", subtitle: "specific", score: 8.4, status: "keep" },
      { id: "hook_pov", title: "POV: sensitive", subtitle: "relatable", score: 7.9, status: "review" },
      { id: "hook_test", title: "Test this once", subtitle: "challenge", score: 7.4, status: "review" },
      { id: "hook_before", title: "Before / after", subtitle: "proof-led", score: 8.1, status: "keep" },
    ],
  },
  {
    id: "row_script",
    step: "5",
    title: "Script",
    description: "Soft proof arc",
    items: [
      { id: "script_problem", title: "Problem → update", subtitle: "short pain", score: 8.1, status: "keep" },
      { id: "script_story", title: "Storytime", subtitle: "mild reveal", score: 7.1, status: "review" },
      { id: "script_tip", title: "Tip + proof", subtitle: "educator", score: 8.2, status: "keep" },
      { id: "script_list", title: "List / steps", subtitle: "3 reasons", score: 7.8, status: "new" },
      { id: "script_comment", title: "Comment Q&A", subtitle: "response", score: 7.6, status: "review" },
    ],
  },
  {
    id: "row_cta",
    step: "6",
    title: "CTA",
    description: "Conversion pressure",
    items: [
      { id: "cta_shop", title: "Shop now", subtitle: "direct", score: 6.8, status: "risk", candidateId: "candidate_cta_risk_free_01" },
      { id: "cta_limited", title: "Limited code", subtitle: "low pressure", score: 7.3, status: "review" },
      { id: "cta_use", title: "Use code", subtitle: "caption CTA", score: 8.0, status: "keep" },
      { id: "cta_link", title: "Link in bio", subtitle: "soft CTA", score: 8.1, status: "keep" },
      { id: "cta_comment", title: "Comment ‘GLOW’", subtitle: "engagement", score: 7.6, status: "review" },
    ],
  },
]

const campaignColumns: CampaignColumn[] = [
  {
    id: "concept",
    title: "01 Concept",
    subtitle: "1 snapshot",
    nodes: [
      { id: "node_root", title: "Root Concept", meta: "Hydrating skin", score: "May 9", status: "active" },
    ],
  },
  {
    id: "personas",
    title: "02 Personas",
    subtitle: "3 families",
    nodes: [
      { id: "node_clean_girl", title: "Clean Girl", meta: "Minimalist", score: "+17%", status: "good" },
      { id: "node_energy", title: "Energetic Bestie", meta: "Fun, bubbly", score: "-5%", status: "risk" },
      { id: "node_science", title: "Skincare Nerd", meta: "Informative", score: "new", status: "active" },
    ],
  },
  {
    id: "formats",
    title: "03 Formats",
    subtitle: "6 explorations",
    nodes: [
      { id: "node_talking", title: "Talking Head", meta: "direct", score: "+4%", status: "good" },
      { id: "node_routine", title: "Routine", meta: "GRWM", score: "+6%", status: "good" },
      { id: "node_demo", title: "Product Demo", meta: "macro proof", score: "+9%", status: "good", candidateId: "candidate_soft_demo_01" },
      { id: "node_story", title: "Storytime", meta: "paused", score: "-7%", status: "risk" },
    ],
  },
  {
    id: "hooks",
    title: "04 Hooks",
    subtitle: "12 batches",
    nodes: [
      { id: "node_curiosity", title: "Curiosity Hook", meta: "5 variants", score: "+18%", status: "good" },
      { id: "node_benefit", title: "Benefit Hook", meta: "5 variants", score: "+21%", status: "active" },
      { id: "node_relatable", title: "Relatable Hook", meta: "4 variants", score: "+8%", status: "good" },
      { id: "node_trend", title: "Trend Hook", meta: "3 variants", score: "-22%", status: "dead" },
    ],
  },
  {
    id: "campaign",
    title: "05 Campaign Mix",
    subtitle: "CTA / non-CTA",
    nodes: [
      { id: "node_theory", title: "CTA Theory", meta: "70% CTA", score: "+20%", status: "good" },
      { id: "node_blend", title: "Balanced Mix", meta: "50% CTA", score: "+31%", status: "active" },
      { id: "node_community", title: "Community First", meta: "20% CTA", score: "+12%", status: "good" },
    ],
  },
  {
    id: "checkpoints",
    title: "06 Checkpoints",
    subtitle: "Metrics & decisions",
    nodes: [
      { id: "node_checkpoint_a", title: "Checkpoint A", meta: "May 23", score: "CTR 2.8", status: "good" },
      { id: "node_checkpoint_b", title: "Checkpoint B", meta: "May 28", score: "CTR 3.7", status: "active" },
      { id: "node_checkpoint_c", title: "Checkpoint C", meta: "May 30", score: "CVR 5.7", status: "good" },
    ],
  },
]

export function ReactUgcStudio() {
  const [activeView, setActiveView] = React.useState<ReactView>("atlas")
  const [selectedCandidateId, setSelectedCandidateId] = React.useState(workspace.finalEditor.selectedCandidateId)
  const [selectedPersonaId, setSelectedPersonaId] = React.useState(personaCards[0]?.id ?? "")
  const [selectedBranchId, setSelectedBranchId] = React.useState(campaignColumns[3]?.nodes[1]?.id ?? "")
  const [capabilities, setCapabilities] = React.useState<KieCapability[]>(fallbackCapabilities)
  const [operation, setOperation] = React.useState<KieOperation>("image-text")
  const [prompt, setPrompt] = React.useState("Make the selected personas less polished and generate 8 warmer hooks")
  const [result, setResult] = React.useState("Dry-run a KIE payload to verify routing without spending credits.")
  const [busy, setBusy] = React.useState(false)
  const selectedCandidate = workspace.candidates.find((candidate) => candidate.id === selectedCandidateId) ?? workspace.candidates[0]
  const selectedPersona = personaCards.find((persona) => persona.id === selectedPersonaId) ?? personaCards[0]
  const selectedCapability = capabilities.find((capability) => capability.operation === operation) ?? capabilities[0]
  const activeViewMeta = views.find((view) => view.value === activeView) ?? views[0]

  React.useEffect(() => {
    let cancelled = false
    fetch(`${daemonBaseUrl}/api/ugc/kie/capabilities`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`daemon ${response.status}`)))
      .then((payload: { capabilities?: KieCapability[] }) => {
        if (!cancelled && payload.capabilities?.length) setCapabilities(payload.capabilities)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const request = React.useMemo<KieRequest>(() => ({
    operation,
    prompt,
    aspectRatio: selectedCapability?.family === "image" ? "1:1" : "9:16",
    durationSec: 5,
    resolution: selectedCapability?.family === "image" ? "1024" : "720p",
    quality: "basic",
    maxSpendUsd: 0.05,
  }), [operation, prompt, selectedCapability])

  async function callKie(path: string, body?: KieRequest) {
    setBusy(true)
    try {
      const response = await fetch(`${daemonBaseUrl}${path}`, body ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      } : undefined)
      const text = await response.text()
      setResult(text)
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="react-ugc-theme rugc-shell">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      <section className="rugc-main">
        <Topbar activeViewMeta={activeViewMeta} />
        <div className="rugc-workbench">
          <section className="rugc-content">
            <ViewToolbar activeView={activeView} onViewChange={setActiveView} />
            <div className="rugc-stage">
              <WorkspaceView
                activeView={activeView}
                selectedCandidateId={selectedCandidateId}
                selectedPersonaId={selectedPersonaId}
                selectedBranchId={selectedBranchId}
                operation={operation}
                capabilities={capabilities}
                selectedCapability={selectedCapability}
                result={result}
                busy={busy}
                request={request}
                onSelectCandidate={setSelectedCandidateId}
                onSelectPersona={setSelectedPersonaId}
                onSelectBranch={setSelectedBranchId}
                onOperationChange={setOperation}
                onCallKie={callKie}
              />
            </div>
            <CommandBar prompt={prompt} onPromptChange={setPrompt} onRun={() => callKie("/api/ugc/kie/plan", request)} busy={busy} />
          </section>
          <Inspector
            activeView={activeView}
            selectedPersona={selectedPersona}
            selectedCandidate={selectedCandidate}
            selectedCapability={selectedCapability}
            result={result}
          />
        </div>
      </section>
    </main>
  )
}

function Sidebar(props: { activeView: ReactView; onViewChange: (view: ReactView) => void }) {
  return (
    <aside className="rugc-sidebar">
      <div className="rugc-window-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="rugc-brand">
        <Clapperboard className="rugc-brand-icon" />
        <button type="button">UGC Studio <ChevronDown size={12} /></button>
      </div>
      <button type="button" className="rugc-new-command"><Plus size={13} /> New Command <span>⌘N</span></button>
      <label className="rugc-search">
        <Search size={13} />
        <input value="" readOnly placeholder="Search personas, hooks..." />
      </label>
      <SidebarSection title="Workspace">
        {views.map((view) => {
          const Icon = view.icon
          return (
            <button
              key={view.value}
              type="button"
              className={cn("rugc-side-link", props.activeView === view.value && "active")}
              onClick={() => props.onViewChange(view.value)}
            >
              <Icon size={14} />
              <span>{view.label}</span>
              <kbd>g{view.value.slice(0, 1)}</kbd>
            </button>
          )
        })}
      </SidebarSection>
      <SidebarSection title="Campaigns">
        {["Summer Skincare", "Protein Bar Ads", "Hydration Boost", "Coffee Brand", "Archived"].map((label, index) => (
          <button key={label} type="button" className={cn("rugc-side-link compact", index === 0 && "active-soft")}>
            <Folder size={13} />
            <span>{label}</span>
          </button>
        ))}
      </SidebarSection>
      <SidebarSection title="Review Queues">
        {[
          ["Needs My Review", "18"],
          ["Starred", "7"],
          ["Approved", "23"],
          ["Rejected", "12"],
        ].map(([label, count]) => (
          <button key={label} type="button" className="rugc-side-link compact">
            {label === "Starred" ? <Star size={13} /> : label === "Approved" ? <CheckCircle2 size={13} /> : label === "Rejected" ? <XCircle size={13} /> : <Inbox size={13} />}
            <span>{label}</span>
            <em>{count}</em>
          </button>
        ))}
      </SidebarSection>
      <div className="rugc-sidebar-footer">
        <span>A</span>
        <strong>Arthur</strong>
        <Badge>Pro</Badge>
      </div>
    </aside>
  )
}

function SidebarSection(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rugc-sidebar-section">
      <h2>{props.title}<Plus size={12} /></h2>
      <div>{props.children}</div>
    </section>
  )
}

function Topbar(props: { activeViewMeta: (typeof views)[number] }) {
  return (
    <header className="rugc-topbar">
      <div className="rugc-breadcrumb">
        <Home size={13} />
        <span>UGC Studio</span>
        <span>/</span>
        <span>Summer Skincare</span>
        <span>/</span>
        <strong>{props.activeViewMeta.label}</strong>
      </div>
      <div className="rugc-top-actions">
        <label className="rugc-top-search">
          <Search size={13} />
          <input value="" readOnly placeholder="Search" />
          <kbd>⌘K</kbd>
        </label>
        <button type="button"><Bell size={14} /></button>
        <button type="button"><Clock size={14} /></button>
        <button type="button" className="rugc-avatar-button">A</button>
        <Button size="sm" variant="outline">Preview</Button>
        <Button size="sm">Export</Button>
      </div>
    </header>
  )
}

function ViewToolbar(props: { activeView: ReactView; onViewChange: (view: ReactView) => void }) {
  return (
    <div className="rugc-view-toolbar">
      <div>
        <p>Summer Skincare / creative search graph</p>
        <h1>{views.find((view) => view.value === props.activeView)?.label}</h1>
      </div>
      <div className="rugc-toolbar-actions">
        <Tabs value={props.activeView} items={viewTabs} onValueChange={props.onViewChange} />
        <button type="button"><Grid2X2 size={13} /> Board</button>
        <button type="button"><Table2 size={13} /> Table</button>
        <button type="button"><Network size={13} /> Graph</button>
        <button type="button"><Filter size={13} /> Filter</button>
        <button type="button"><SlidersHorizontal size={13} /> Sort</button>
      </div>
    </div>
  )
}

function WorkspaceView(props: {
  activeView: ReactView
  selectedCandidateId: string
  selectedPersonaId: string
  selectedBranchId: string
  operation: KieOperation
  capabilities: KieCapability[]
  selectedCapability: KieCapability | undefined
  result: string
  busy: boolean
  request: KieRequest
  onSelectCandidate: (id: string) => void
  onSelectPersona: (id: string) => void
  onSelectBranch: (id: string) => void
  onOperationChange: (operation: KieOperation) => void
  onCallKie: (path: string, body?: KieRequest) => void
}) {
  if (props.activeView === "atlas") {
    return <PersonaAtlas selectedPersonaId={props.selectedPersonaId} onSelectPersona={props.onSelectPersona} />
  }
  if (props.activeView === "explore") {
    return (
      <ExplorationBoard
        selectedCandidateId={props.selectedCandidateId}
        selectedPersonaId={props.selectedPersonaId}
        onSelectCandidate={props.onSelectCandidate}
        onSelectPersona={props.onSelectPersona}
      />
    )
  }
  if (props.activeView === "review") {
    return <BatchReview selectedCandidateId={props.selectedCandidateId} onSelectCandidate={props.onSelectCandidate} />
  }
  if (props.activeView === "campaign") {
    return <CampaignMap selectedBranchId={props.selectedBranchId} onSelectBranch={props.onSelectBranch} onSelectCandidate={props.onSelectCandidate} />
  }
  if (props.activeView === "editor") {
    return <FinalEditor selectedCandidateId={props.selectedCandidateId} />
  }
  return (
    <ProviderView
      operation={props.operation}
      capabilities={props.capabilities}
      selectedCapability={props.selectedCapability}
      result={props.result}
      busy={props.busy}
      request={props.request}
      onOperationChange={props.onOperationChange}
      onCallKie={props.onCallKie}
    />
  )
}

function PersonaAtlas(props: { selectedPersonaId: string; onSelectPersona: (id: string) => void }) {
  return (
    <div className="rugc-atlas">
      <div className="rugc-atlas-grid">
        {personaCards.map((persona) => (
          <button
            key={persona.id}
            type="button"
            className={cn("rugc-persona-card", props.selectedPersonaId === persona.id && "selected")}
            onClick={() => props.onSelectPersona(persona.id)}
          >
            <div className={cn("rugc-persona-portrait", persona.color)}>
              <span>{persona.name.split(" ").map((part) => part[0]).join("")}</span>
              <em>{persona.clips} clips</em>
            </div>
            <div className="rugc-persona-body">
              <header>
                <strong>{persona.name}</strong>
                <StatusPill status={persona.status} />
              </header>
              <p>{persona.archetype}</p>
              <dl>
                <dt>Voice</dt><dd>{persona.voice}</dd>
                <dt>Accent</dt><dd>{persona.accent}</dd>
                <dt>Niche</dt><dd>{persona.niche}</dd>
              </dl>
              <footer>
                <span>{persona.branches} branches</span>
                <span>{persona.followers} followers / {persona.conversions} conversion</span>
              </footer>
            </div>
          </button>
        ))}
      </div>
      <div className="rugc-agent-panel">
        <header>
          <Bot size={15} />
          <strong>Agent critique</strong>
        </header>
        <p>Strong first signal is calm skincare POV. Hook performance above average in tests.</p>
        <p>Consider more personal story moments. Too many CTA-first product angles.</p>
        <button type="button">Generate 12 persona directions</button>
      </div>
    </div>
  )
}

function ExplorationBoard(props: {
  selectedCandidateId: string
  selectedPersonaId: string
  onSelectCandidate: (id: string) => void
  onSelectPersona: (id: string) => void
}) {
  return (
    <div className="rugc-explore">
      {explorationRows.map((row) => (
        <section key={row.id} className="rugc-explore-row">
          <div className="rugc-stage-label">
            <span>{row.step}</span>
            <div>
              <strong>{row.title}</strong>
              <p>{row.description}</p>
            </div>
          </div>
          <div className="rugc-example-strip">
            {row.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "rugc-example-card",
                  item.candidateId === props.selectedCandidateId && "selected",
                  item.personaId === props.selectedPersonaId && "selected",
                )}
                onClick={() => {
                  if (item.candidateId) props.onSelectCandidate(item.candidateId)
                  if (item.personaId) props.onSelectPersona(item.personaId)
                }}
              >
                <MiniThumb status={item.status} label={item.title} />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.subtitle}</span>
                </div>
                <em>{item.score.toFixed(1)}</em>
              </button>
            ))}
            <button type="button" className="rugc-example-card add">
              <Plus size={14} />
              <span>Try more like this</span>
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}

function BatchReview(props: { selectedCandidateId: string; onSelectCandidate: (id: string) => void }) {
  const selectedCandidate = workspace.candidates.find((candidate) => candidate.id === props.selectedCandidateId) ?? workspace.candidates[0]
  return (
    <div className="rugc-review">
      <aside className="rugc-review-queue">
        <h3>Candidate 23 of 236</h3>
        <div className="rugc-review-filters">
          {["Needs Review", "Starred", "Approved", "Rejected", "All Candidates"].map((label, index) => (
            <button key={label} type="button" className={index === 0 ? "active" : ""}>
              <span />
              {label}
              <em>{[18, 7, 23, 12, 236][index]}</em>
            </button>
          ))}
        </div>
        <div className="rugc-shortcuts">
          <strong>Keyboard shortcuts</strong>
          <span>Space Play / Pause</span>
          <span>1 Reject</span>
          <span>3 Star</span>
          <span>5 Fork</span>
        </div>
      </aside>
      <section className="rugc-player-wrap">
        <div className="rugc-variant-strip">
          {workspace.candidates.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              className={cn(candidate.id === props.selectedCandidateId && "active")}
              onClick={() => props.onSelectCandidate(candidate.id)}
            >
              <MiniThumb status={candidate.status === "needs-revision" ? "risk" : "keep"} label={`${index + 1}`} />
              <span>0:{String(candidate.durationSeconds).padStart(2, "0")}</span>
            </button>
          ))}
        </div>
        <div className="rugc-player">
          <span className="rugc-player-badge">9:16</span>
          <div className="rugc-player-caption">
            {selectedCandidate?.preview.transcript[0]?.text ?? "No transcript yet"}
          </div>
        </div>
        <div className="rugc-player-controls">
          <Rewind size={14} />
          <Pause size={14} />
          <FastForward size={14} />
          <div><span style={{ width: "36%" }} /></div>
          <em>0:07 / 0:32</em>
          <button type="button">1x</button>
          <button type="button"><Eye size={13} /></button>
        </div>
      </section>
      <aside className="rugc-review-score">
        <Tabs value="overview" items={[{ value: "overview", label: "Overview" }, { value: "transcript", label: "Transcript" }, { value: "json", label: "JSON" }]} onValueChange={() => undefined} />
        <ScoreBar label="Hook Strength" value={selectedCandidate?.scorecard.hookStrength ?? 0} />
        <ScoreBar label="Persona Fit" value={selectedCandidate?.scorecard.personaFit ?? 0} />
        <ScoreBar label="CTA Pressure" value={selectedCandidate?.scorecard.conversionPotential ?? 0} warning />
        <ScoreBar label="Authenticity" value={selectedCandidate?.scorecard.formatFit ?? 0} />
        <ScoreBar label="Predicted Retention" value={selectedCandidate?.scorecard.overall ?? 0} />
        <blockquote>She feels slightly scripted in the middle. CTA could be softer.</blockquote>
      </aside>
      <table className="rugc-review-table">
        <thead>
          <tr>
            <th></th>
            <th>Thumbnail</th>
            <th>Persona</th>
            <th>Format</th>
            <th>Hook</th>
            <th>CTA</th>
            <th>Scores</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {workspace.candidates.map((candidate, index) => (
            <tr key={candidate.id} className={candidate.id === props.selectedCandidateId ? "active" : ""}>
              <td>{index + 21}</td>
              <td><MiniThumb status={candidate.status === "needs-revision" ? "risk" : "keep"} label="" /></td>
              <td>{candidate.personaId?.includes("deadpan") ? "Runner" : "Lily"}</td>
              <td>{candidate.kind}</td>
              <td>{candidate.title}</td>
              <td>{candidate.kind === "cta" ? "Direct" : "Soft"}</td>
              <td>{candidate.scorecard.overall} / {candidate.scorecard.personaFit}</td>
              <td><StatusPill status={candidate.status === "starred" ? "Approved" : candidate.status === "needs-revision" ? "In Review" : "Draft"} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CampaignMap(props: { selectedBranchId: string; onSelectBranch: (id: string) => void; onSelectCandidate: (id: string) => void }) {
  return (
    <div className="rugc-map">
      <div className="rugc-map-canvas">
        {campaignColumns.map((column) => (
          <section key={column.id} className="rugc-map-column">
            <header>
              <strong>{column.title}</strong>
              <span>{column.subtitle}</span>
            </header>
            <div>
              {column.nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className={cn("rugc-map-node", node.status, props.selectedBranchId === node.id && "selected")}
                  onClick={() => {
                    props.onSelectBranch(node.id)
                    if (node.candidateId) props.onSelectCandidate(node.candidateId)
                  }}
                >
                  <MiniThumb status={node.status === "dead" ? "risk" : node.status === "active" ? "new" : "keep"} label="" />
                  <strong>{node.title}</strong>
                  <span>{node.meta}</span>
                  <em>{node.score}</em>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="rugc-snapshot-tray">
        <div>
          <strong>Snapshot 18</strong>
          <p>Benefit Hook, created May 27. Fork selected winners into softer CTA variants.</p>
          <span>+27% vs parent</span>
        </div>
        <div className="rugc-preview-strip">
          {workspace.candidates.slice(0, 3).map((candidate) => (
            <button key={candidate.id} type="button" onClick={() => props.onSelectCandidate(candidate.id)}>
              <MiniThumb status="keep" label="" />
              <PlayCircle size={22} />
              <span>{candidate.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function FinalEditor(props: { selectedCandidateId: string }) {
  const selectedCandidate = workspace.candidates.find((candidate) => candidate.id === props.selectedCandidateId) ?? workspace.candidates[0]
  return (
    <div className="rugc-editor">
      <aside className="rugc-layer-list">
        <h3>Layers</h3>
        {workspace.finalEditor.tracks.map((track) => (
          <button key={track.id} type="button">
            <span className={track.kind} />
            <strong>{track.label}</strong>
            <em>{track.clips.length} clips</em>
          </button>
        ))}
      </aside>
      <section className="rugc-editor-canvas">
        <div className="rugc-editor-toolbar">
          {["Select", "Crop", "Text", "Captions", "Audio", "JSON"].map((label) => <button key={label} type="button">{label}</button>)}
        </div>
        <div className="rugc-phone-row">
          {["Hook", "Product", "Proof", "CTA"].map((label, index) => (
            <article key={label} className={cn(index === 0 && "selected")}>
              <span>9:16</span>
              <strong>{label}</strong>
              <p>{index === 0 ? selectedCandidate?.preview.transcript[0]?.text : "Editable scene layer"}</p>
            </article>
          ))}
        </div>
        <div className="rugc-editor-timeline">
          {workspace.finalEditor.tracks.map((track, index) => (
            <div key={track.id} className="rugc-editor-track">
              <span>{track.label}</span>
              <div><i style={{ left: `${index * 5}%`, width: `${Math.min(82, Math.max(18, track.clips.length * 22))}%` }} /></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function ProviderView(props: {
  operation: KieOperation
  capabilities: KieCapability[]
  selectedCapability: KieCapability | undefined
  result: string
  busy: boolean
  request: KieRequest
  onOperationChange: (operation: KieOperation) => void
  onCallKie: (path: string, body?: KieRequest) => void
}) {
  return (
    <div className="rugc-provider">
      <section>
        <Braces size={32} />
        <h2>KIE proxy is wired through the local daemon</h2>
        <p>The browser builds request JSON locally. Live submission is explicit and capped because credits are limited.</p>
      </section>
      <aside>
        <label>
          <span>Operation</span>
          <select value={props.operation} onChange={(event) => props.onOperationChange(event.target.value as KieOperation)}>
            {props.capabilities.map((capability) => (
              <option key={capability.operation} value={capability.operation}>
                {capability.operation} / {capability.model}
              </option>
            ))}
          </select>
        </label>
        <div className="rugc-provider-note">
          <strong>{props.selectedCapability?.label}</strong>
          <p>{props.selectedCapability?.notes}</p>
        </div>
        <Button onClick={() => props.onCallKie("/api/ugc/kie/plan", props.request)} disabled={props.busy}>Dry-run request JSON</Button>
        <Button
          variant="outline"
          onClick={() => props.onCallKie("/api/ugc/kie/create", { ...props.request, live: true, maxSpendUsd: 0.05 })}
          disabled={props.busy || (props.selectedCapability?.estimatedCostUsd ?? 1) > 0.05}
        >
          Live submit capped at $0.05
        </Button>
        <pre>{props.result}</pre>
      </aside>
    </div>
  )
}

function Inspector(props: {
  activeView: ReactView
  selectedPersona: PersonaCardModel | undefined
  selectedCandidate: (typeof workspace.candidates)[number] | undefined
  selectedCapability: KieCapability | undefined
  result: string
}) {
  if (props.activeView === "provider") {
    return (
      <aside className="rugc-inspector">
        <InspectorHeader title="KIE Provider" />
        <InspectorCard title="Route policy">
          <MetricRow label="Default" value="dry-run" />
          <MetricRow label="Live cap" value="$0.05" />
          <MetricRow label="Model" value={props.selectedCapability?.model ?? "kie"} />
        </InspectorCard>
        <InspectorCard title="Last response">
          <pre className="rugc-json">{props.result}</pre>
        </InspectorCard>
      </aside>
    )
  }

  if (props.activeView === "campaign") {
    return (
      <aside className="rugc-inspector">
        <InspectorHeader title="Snapshot 18" />
        <InspectorCard title="Details">
          <MetricRow label="Stage" value="Benefit Hook" />
          <MetricRow label="Variants" value="5" />
          <MetricRow label="Parent" value="06 GRWM Routine" />
          <MetricRow label="Children" value="2" />
        </InspectorCard>
        <InspectorCard title="Decision">
          <p>Strong performance uplift. Expand into voice-over testimonial and softer CTA angles.</p>
        </InspectorCard>
        <InspectorCard title="Metrics">
          <ScoreBar label="CTR" value={82} />
          <ScoreBar label="CVR" value={64} />
          <ScoreBar label="Hook hold" value={78} />
        </InspectorCard>
        <button type="button" className="rugc-danger">Mark as dead end</button>
      </aside>
    )
  }

  return (
    <aside className="rugc-inspector">
      <InspectorHeader title={props.activeView === "review" ? "Candidate" : "Inspector"} />
      <InspectorCard title="Product brief">
        <p>{workspace.productBrief.productName} / {workspace.productBrief.offer}</p>
        <ScoreBar label="CTA posts" value={workspace.productBrief.campaignMix.ctaPostsPercent} />
        <ScoreBar label="Profile posts" value={workspace.productBrief.campaignMix.personaBuildingPostsPercent} />
      </InspectorCard>
      <InspectorCard title="Selected persona">
        <MetricRow label="Name" value={props.selectedPersona?.name ?? "None"} />
        <MetricRow label="Lane" value={props.selectedPersona?.archetype ?? "None"} />
        <MetricRow label="Voice" value={props.selectedPersona?.voice ?? "None"} />
        <MetricRow label="Niche" value={props.selectedPersona?.niche ?? "None"} />
      </InspectorCard>
      <InspectorCard title="Selected candidate">
        <p>{props.selectedCandidate?.preview.transcript[0]?.text ?? "No candidate selected."}</p>
        <ScoreBar label="Overall" value={props.selectedCandidate?.scorecard.overall ?? 0} />
        <ScoreBar label="Persona fit" value={props.selectedCandidate?.scorecard.personaFit ?? 0} />
        <ScoreBar label="Conversion" value={props.selectedCandidate?.scorecard.conversionPotential ?? 0} warning />
      </InspectorCard>
      <InspectorCard title="Continuity JSON">
        <pre className="rugc-json">{JSON.stringify({
          persona: props.selectedPersona?.id,
          stable: ["voice", "niche", "posting cadence"],
          selectedCandidate: props.selectedCandidate?.id,
        }, null, 2)}</pre>
      </InspectorCard>
    </aside>
  )
}

function InspectorHeader(props: { title: string }) {
  return (
    <header className="rugc-inspector-header">
      <div>
        <p>Inspector</p>
        <h2>{props.title}</h2>
      </div>
      <div>
        <button type="button">Creative</button>
        <button type="button">JSON</button>
      </div>
    </header>
  )
}

function InspectorCard(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rugc-inspector-card">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  )
}

function CommandBar(props: { prompt: string; busy: boolean; onPromptChange: (value: string) => void; onRun: () => void }) {
  return (
    <div className="rugc-command-bar">
      <Sparkles size={16} />
      <textarea value={props.prompt} onChange={(event) => props.onPromptChange(event.target.value)} />
      <div>
        <button type="button"><Plus size={13} /> Add context</button>
        <button type="button"><Target size={13} /> Targets</button>
        <button type="button"><Settings size={13} /> Agent</button>
      </div>
      <button type="button" className="run" onClick={props.onRun} disabled={props.busy}>
        <ArrowUp size={15} />
      </button>
    </div>
  )
}

function MiniThumb(props: { status: ExplorationItem["status"] | "good" | "active" | "dead" | "queued" | "starred" | "needs-revision"; label: string }) {
  return (
    <span className={cn("rugc-mini-thumb", props.status)}>
      {props.label ? <em>{props.label.slice(0, 2)}</em> : null}
    </span>
  )
}

function StatusPill(props: { status: PersonaCardModel["status"] }) {
  return <span className={cn("rugc-status-pill", props.status.toLowerCase().replace(" ", "-"))}>{props.status}</span>
}

function ScoreBar(props: { label: string; value: number; warning?: boolean }) {
  return (
    <div className="rugc-score">
      <span>{props.label}</span>
      <div><i className={props.warning ? "warning" : undefined} style={{ width: `${Math.max(4, Math.min(100, props.value))}%` }} /></div>
      <strong>{props.value}</strong>
    </div>
  )
}

function MetricRow(props: { label: string; value: string }) {
  return (
    <div className="rugc-metric-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}
