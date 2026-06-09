import { For, Show, createMemo, createSignal } from "solid-js"
import { ugcStudioWorkspace } from "./ugcStudioModel"
import type { WorkspaceView } from "./ugcStudioModel"

type InspectorMode = "creative" | "json"
type StudioWorkspace = typeof ugcStudioWorkspace
type PersonaProfile = StudioWorkspace["personas"][number]
type CreativeCandidate = StudioWorkspace["candidates"][number]
type BranchSnapshot = StudioWorkspace["branchSnapshots"][number]
type ReferenceProfile = StudioWorkspace["referenceProfiles"][number]
type ReferenceProfileRemixPlan = StudioWorkspace["referenceRemixPlans"][number]
type FormatStage = StudioWorkspace["formatStages"][number]
type EditorTrack = StudioWorkspace["finalEditor"]["tracks"][number]
type DeveloperGraphNode = StudioWorkspace["developerGraph"]["nodes"][number]

interface StudioView {
  id: WorkspaceView
  name: string
  shortcut: string
  section: "Workspace" | "Debug"
}

const workspace = ugcStudioWorkspace

const views: StudioView[] = [
  { id: "persona-atlas", name: "Persona Atlas", shortcut: "gp", section: "Workspace" },
  { id: "exploration-board", name: "Exploration Board", shortcut: "ge", section: "Workspace" },
  { id: "batch-review", name: "Batch Review Player", shortcut: "gb", section: "Workspace" },
  { id: "campaign-branch-map", name: "Campaign Branch Map", shortcut: "gm", section: "Workspace" },
  { id: "reference-profile-remix", name: "Reference Profile Remix", shortcut: "gr", section: "Workspace" },
  { id: "final-editor", name: "Final Layer Editor", shortcut: "gf", section: "Workspace" },
  { id: "developer-graph", name: "Developer Graph", shortcut: "gd", section: "Debug" },
]

export function UgcStudio() {
  const fallbackPersona = firstPersona(workspace)
  const fallbackCandidate = firstCandidate(workspace)
  const fallbackSnapshot = firstSnapshot(workspace)
  const fallbackReference = firstReference(workspace)
  const fallbackPlan = firstRemixPlan(workspace)

  const [activeView, setActiveView] = createSignal<WorkspaceView>(workspace.activeView)
  const [inspectorMode, setInspectorMode] = createSignal<InspectorMode>("creative")
  const [selectedPersonaId, setSelectedPersonaId] = createSignal(fallbackPersona.id)
  const [selectedCandidateId, setSelectedCandidateId] = createSignal(workspace.finalEditor.selectedCandidateId)
  const [selectedSnapshotId, setSelectedSnapshotId] = createSignal(fallbackSnapshot.id)
  const [selectedReferenceId, setSelectedReferenceId] = createSignal(fallbackReference.id)
  const [command, setCommand] = createSignal(workspace.agent.currentInstruction)

  const activeViewMeta = createMemo(() => views.find((view) => view.id === activeView()) ?? views[0])
  const selectedPersona = createMemo(() => workspace.personas.find((persona) => persona.id === selectedPersonaId()) ?? fallbackPersona)
  const selectedCandidate = createMemo(() => workspace.candidates.find((candidate) => candidate.id === selectedCandidateId()) ?? fallbackCandidate)
  const selectedSnapshot = createMemo(() => workspace.branchSnapshots.find((snapshot) => snapshot.id === selectedSnapshotId()) ?? fallbackSnapshot)
  const selectedReference = createMemo(() => workspace.referenceProfiles.find((profile) => profile.id === selectedReferenceId()) ?? fallbackReference)
  const selectedRemixPlan = createMemo(() => (
    workspace.referenceRemixPlans.find((plan) => plan.referenceProfileId === selectedReferenceId()) ?? fallbackPlan
  ))
  const inspectorJson = createMemo(() => ({
    schemaVersion: workspace.schemaVersion,
    activeView: activeView(),
    workspaceId: workspace.id,
    selectedPersona: selectedPersona(),
    selectedCandidate: selectedCandidate(),
    selectedSnapshot: selectedSnapshot(),
    selectedReferenceProfile: selectedReference(),
    selectedRemixPlan: selectedRemixPlan(),
    command: command(),
  }))

  return (
    <main class="ugc2-shell">
      <Sidebar activeView={activeView()} onViewChange={setActiveView} workspace={workspace} />

      <section class="ugc2-main">
        <Topbar activeView={activeViewMeta()} workspace={workspace} />

        <div class="ugc2-workbench">
          <section class="ugc2-content">
            <ViewToolbar activeView={activeViewMeta()} workspace={workspace} />
            <section class="ugc2-view-stage" aria-label={activeViewMeta().name}>
              <Show when={activeView() === "persona-atlas"}>
                <PersonaAtlas
                  personas={workspace.personas}
                  selectedId={selectedPersonaId()}
                  onSelect={setSelectedPersonaId}
                />
              </Show>
              <Show when={activeView() === "exploration-board"}>
                <ExplorationBoard
                  stages={workspace.formatStages}
                  candidates={workspace.candidates}
                  selectedCandidateId={selectedCandidateId()}
                  onSelectCandidate={setSelectedCandidateId}
                />
              </Show>
              <Show when={activeView() === "batch-review"}>
                <BatchReview
                  workspace={workspace}
                  selectedCandidateId={selectedCandidateId()}
                  onSelectCandidate={setSelectedCandidateId}
                />
              </Show>
              <Show when={activeView() === "campaign-branch-map"}>
                <CampaignMap
                  snapshots={workspace.branchSnapshots}
                  selectedSnapshotId={selectedSnapshotId()}
                  onSelectSnapshot={setSelectedSnapshotId}
                />
              </Show>
              <Show when={activeView() === "reference-profile-remix"}>
                <ReferenceRemix
                  workspace={workspace}
                  selectedReferenceId={selectedReferenceId()}
                  onSelectReference={setSelectedReferenceId}
                />
              </Show>
              <Show when={activeView() === "final-editor"}>
                <FinalLayerEditor workspace={workspace} selectedCandidate={selectedCandidate()} />
              </Show>
              <Show when={activeView() === "developer-graph"}>
                <DeveloperGraph workspace={workspace} />
              </Show>
            </section>
          </section>

          <Inspector
            mode={inspectorMode()}
            onModeChange={setInspectorMode}
            activeView={activeViewMeta()}
            workspace={workspace}
            persona={selectedPersona()}
            candidate={selectedCandidate()}
            snapshot={selectedSnapshot()}
            reference={selectedReference()}
            remixPlan={selectedRemixPlan()}
            json={inspectorJson()}
          />
        </div>

        <CommandBar value={command()} onInput={setCommand} workspace={workspace} />
      </section>
    </main>
  )
}

function Sidebar(props: {
  activeView: WorkspaceView
  onViewChange: (view: WorkspaceView) => void
  workspace: StudioWorkspace
}) {
  const workspaceViews = views.filter((view) => view.section === "Workspace")
  const debugViews = views.filter((view) => view.section === "Debug")

  return (
    <aside class="ugc2-sidebar" aria-label="UGC Studio navigation">
      <div class="ugc2-window-controls" aria-hidden="true">
        <span class="ugc2-dot red" />
        <span class="ugc2-dot yellow" />
        <span class="ugc2-dot green" />
      </div>

      <button type="button" class="ugc2-new-command">New command</button>
      <input class="ugc2-search" placeholder="Search personas, hooks, branches" />

      <section class="ugc2-side-section">
        <header>
          <span>Workspace</span>
          <button type="button" aria-label="Add workspace view">+</button>
        </header>
        <nav class="ugc2-view-list">
          <For each={workspaceViews}>{(view) => (
            <button
              type="button"
              classList={{ active: props.activeView === view.id }}
              onClick={() => props.onViewChange(view.id)}
            >
              <span>{view.name}</span>
              <kbd>{view.shortcut}</kbd>
            </button>
          )}</For>
        </nav>
      </section>

      <section class="ugc2-side-section">
        <header>
          <span>Campaigns</span>
          <button type="button" aria-label="Add campaign">+</button>
        </header>
        <div class="ugc2-tree">
          <button type="button" class="active">{props.workspace.title}</button>
          <button type="button">Protein Bar Ads</button>
          <button type="button">Faceless SaaS</button>
          <button type="button">Archived Tests</button>
        </div>
      </section>

      <section class="ugc2-side-section">
        <header>
          <span>Libraries</span>
          <button type="button" aria-label="Add library">+</button>
        </header>
        <div class="ugc2-tree">
          <button type="button">Profiles</button>
          <button type="button">Formats</button>
          <button type="button">Hooks</button>
          <button type="button">Captions</button>
          <button type="button">Voices</button>
          <button type="button">Products</button>
        </div>
      </section>

      <section class="ugc2-side-section ugc2-debug-section">
        <header>
          <span>Developer</span>
        </header>
        <nav class="ugc2-view-list">
          <For each={debugViews}>{(view) => (
            <button
              type="button"
              classList={{ active: props.activeView === view.id }}
              onClick={() => props.onViewChange(view.id)}
            >
              <span>{view.name}</span>
              <kbd>{view.shortcut}</kbd>
            </button>
          )}</For>
        </nav>
      </section>

      <footer class="ugc2-user">
        <span>A</span>
        <strong>Arthur</strong>
        <em>Pro</em>
      </footer>
    </aside>
  )
}

function Topbar(props: { activeView: StudioView; workspace: StudioWorkspace }) {
  return (
    <header class="ugc2-topbar">
      <div class="ugc2-breadcrumb">
        <strong>UGC Studio</strong>
        <span>/</span>
        <span>{props.workspace.title}</span>
        <span>/</span>
        <em>{props.activeView.name}</em>
      </div>
      <div class="ugc2-top-actions">
        <span class="ugc2-status">Auto-saved {relativeUpdate(props.workspace.updatedAt)}</span>
        <button type="button">Preview</button>
        <button type="button">Share</button>
        <button type="button" class="dark">Export</button>
      </div>
    </header>
  )
}

function ViewToolbar(props: { activeView: StudioView; workspace: StudioWorkspace }) {
  return (
    <header class="ugc2-view-toolbar">
      <div>
        <p>{props.activeView.shortcut} / {props.workspace.productBrief.category} / creative search graph</p>
        <h1>{props.activeView.name}</h1>
      </div>
      <div class="ugc2-toolbar-actions">
        <button type="button">Filter</button>
        <button type="button">Sort</button>
        <button type="button">Group</button>
        <button type="button">More</button>
      </div>
    </header>
  )
}

function PersonaAtlas(props: {
  personas: readonly PersonaProfile[]
  selectedId: string
  onSelect: (personaId: string) => void
}) {
  return (
    <div class="ugc2-atlas-layout">
      <section class="ugc2-persona-grid">
        <For each={props.personas}>{(persona, index) => (
          <button
            type="button"
            classList={{ "ugc2-persona-card": true, selected: props.selectedId === persona.id }}
            onClick={() => props.onSelect(persona.id)}
          >
            <div class="ugc2-portrait" style={{ background: personaGradient(index()) }}>
              <span>{persona.sampleClipIds.length} clips</span>
              <strong>{initials(persona.displayName)}</strong>
            </div>
            <div class="ugc2-card-body">
              <div class="ugc2-card-title">
                <strong>{persona.displayName}</strong>
                <span class={personaStatusClass(persona.status)}>{persona.status}</span>
              </div>
              <p>{persona.genreLane}</p>
              <dl class="ugc2-compact-dl">
                <dt>Voice</dt>
                <dd>{persona.voice.speakingStyle}</dd>
                <dt>Accent</dt>
                <dd>{persona.voice.accent}</dd>
                <dt>Niche</dt>
                <dd>{persona.profileBible.niche}</dd>
              </dl>
              <footer>
                <span>{persona.branchSnapshotIds.length} branches</span>
                <span>{postingMix(persona)}</span>
              </footer>
            </div>
          </button>
        )}</For>
      </section>
      <section class="ugc2-agent-log">
        <h2>Agent critique</h2>
        <For each={props.personas.flatMap((persona) => persona.notes).slice(0, 4)}>{(note) => (
          <p>{note}</p>
        )}</For>
        <button type="button">Generate 12 persona directions</button>
      </section>
    </div>
  )
}

function ExplorationBoard(props: {
  stages: readonly FormatStage[]
  candidates: readonly CreativeCandidate[]
  selectedCandidateId: string
  onSelectCandidate: (candidateId: string) => void
}) {
  return (
    <div class="ugc2-board">
      <For each={props.stages}>{(stage) => (
        <section class="ugc2-stage-row">
          <div class="ugc2-stage-label">
            <strong>{stage.title}</strong>
            <span>{stage.description}</span>
          </div>
          <div class="ugc2-stage-candidates">
            <For each={stage.exampleCarousel}>{(example) => {
              const linkedCandidate = example.linkedCandidateId
                ? props.candidates.find((candidate) => candidate.id === example.linkedCandidateId)
                : null
              return (
                <button
                  type="button"
                  classList={{ selected: linkedCandidate?.id === props.selectedCandidateId }}
                  onClick={() => {
                    if (linkedCandidate) props.onSelectCandidate(linkedCandidate.id)
                  }}
                >
                  <span class="ugc2-mini-video" />
                  <strong>{example.title}</strong>
                  <small>{example.summary}</small>
                  <em>{linkedCandidate ? linkedCandidate.scorecard.overall : example.mediaKind}</em>
                </button>
              )
            }}</For>
            <button type="button" class="ugc2-add-card">Flick through more examples</button>
          </div>
        </section>
      )}</For>
    </div>
  )
}

function BatchReview(props: {
  workspace: StudioWorkspace
  selectedCandidateId: string
  onSelectCandidate: (candidateId: string) => void
}) {
  const selected = createMemo(() => props.workspace.candidates.find((candidate) => candidate.id === props.selectedCandidateId) ?? firstCandidate(props.workspace))
  const selectedPersona = createMemo(() => personaForCandidate(props.workspace, selected()))
  const firstLine = createMemo(() => selected().preview.transcript[0]?.text ?? selected().title)

  return (
    <div class="ugc2-review">
      <aside class="ugc2-review-strip" aria-label="Candidate strip">
        <For each={props.workspace.candidates}>{(candidate) => (
          <button
            type="button"
            classList={{ active: props.selectedCandidateId === candidate.id }}
            onClick={() => props.onSelectCandidate(candidate.id)}
          >
            <span>{formatSeconds(candidate.durationSeconds)}</span>
          </button>
        )}</For>
      </aside>
      <section class="ugc2-player">
        <div class="ugc2-player-frame">
          <span class="ugc2-play-dot">Play</span>
          <p>{firstLine()}</p>
        </div>
        <div class="ugc2-player-controls">
          <button type="button">Prev</button>
          <button type="button">Pause</button>
          <button type="button">Next</button>
          <span>00:07 / {formatSeconds(selected().durationSeconds)}</span>
        </div>
      </section>
      <section class="ugc2-score-panel">
        <h2>{selected().title}</h2>
        <p>{selectedPersona()?.displayName ?? "No persona"} / {selected().kind}</p>
        <ScoreBar label="Hook" value={selected().scorecard.hookStrength} max={100} />
        <ScoreBar label="Persona fit" value={selected().scorecard.personaFit} max={100} />
        <ScoreBar label="Conversion" value={selected().scorecard.conversionPotential} max={100} />
        <ScoreBar label="Novelty" value={selected().scorecard.novelty} max={100} />
        <blockquote>{selected().scorecard.issues[0] ?? "No critique yet."}</blockquote>
      </section>
      <table class="ugc2-review-table">
        <thead>
          <tr>
            <th />
            <th>Candidate</th>
            <th>Persona</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Length</th>
            <th>Scores</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.workspace.candidates}>{(candidate) => {
            const persona = personaForCandidate(props.workspace, candidate)
            return (
              <tr classList={{ active: props.selectedCandidateId === candidate.id }} onClick={() => props.onSelectCandidate(candidate.id)}>
                <td><input type="checkbox" checked={props.selectedCandidateId === candidate.id} readOnly /></td>
                <td>{candidate.title}</td>
                <td>{persona?.displayName ?? "Unassigned"}</td>
                <td>{candidate.kind}</td>
                <td>{candidate.status}</td>
                <td>{formatSeconds(candidate.durationSeconds)}</td>
                <td>{candidate.scorecard.overall} / {candidate.scorecard.personaFit} / {candidate.scorecard.conversionPotential}</td>
              </tr>
            )
          }}</For>
        </tbody>
      </table>
    </div>
  )
}

function CampaignMap(props: {
  snapshots: readonly BranchSnapshot[]
  selectedSnapshotId: string
  onSelectSnapshot: (snapshotId: string) => void
}) {
  const selected = createMemo(() => props.snapshots.find((snapshot) => snapshot.id === props.selectedSnapshotId) ?? props.snapshots[0])

  return (
    <div class="ugc2-map">
      <For each={props.snapshots}>{(snapshot) => (
        <button
          type="button"
          classList={{
            "ugc2-snapshot-node": true,
            active: props.selectedSnapshotId === snapshot.id,
            dead: String(snapshot.status) === "dead-end",
          }}
          onClick={() => props.onSelectSnapshot(snapshot.id)}
        >
          <span>{snapshot.createdAt.slice(11, 16)}</span>
          <strong>{snapshot.title}</strong>
          <em>{snapshot.metrics[0]?.value ?? snapshot.status}</em>
          <small>{snapshot.status}</small>
        </button>
      )}</For>
      <Show when={selected()}>
        {(snapshot) => (
          <section class="ugc2-snapshot-preview">
            <div>
              <h2>{snapshot().title}</h2>
              <p>{snapshot().decisionNote}</p>
            </div>
            <div class="ugc2-preview-strip">
              <span />
              <span />
              <span />
            </div>
          </section>
        )}
      </Show>
    </div>
  )
}

function FinalLayerEditor(props: {
  workspace: StudioWorkspace
  selectedCandidate: CreativeCandidate
}) {
  return (
    <div class="ugc2-editor">
      <aside class="ugc2-layer-list">
        <h2>Layers</h2>
        <For each={props.workspace.finalEditor.tracks}>{(track, index) => (
          <button type="button">
            <span style={{ background: trackColor(index()) }} />
            <strong>{track.label}</strong>
            <small>{track.kind} / {track.clips.length} clips</small>
          </button>
        )}</For>
      </aside>
      <section class="ugc2-editor-canvas">
        <div class="ugc2-editor-toolbar">
          <button type="button">Select</button>
          <button type="button">Hand</button>
          <button type="button">Text</button>
          <button type="button">Crop</button>
          <button type="button">Comment</button>
        </div>
        <div class="ugc2-phone-row">
          <For each={props.selectedCandidate.preview.transcript.slice(0, 4)}>{(line, index) => (
            <div classList={{ "ugc2-phone-scene": true, selected: index() === 1 }}>
              <span>9:16 / {formatSeconds(line.endSeconds - line.startSeconds)}</span>
              <p>Scene {index() + 1}</p>
              <strong>{line.text}</strong>
            </div>
          )}</For>
        </div>
        <Timeline tracks={props.workspace.finalEditor.tracks} duration={props.workspace.finalEditor.durationSeconds} />
      </section>
    </div>
  )
}

function DeveloperGraph(props: { workspace: StudioWorkspace }) {
  return (
    <div class="ugc2-graph">
      <aside class="ugc2-template-list">
        <h2>Provider Routes</h2>
        <For each={props.workspace.developerGraph.providerRoutes}>{(route) => (
          <button type="button">
            <strong>{route.label}</strong>
            <span>{route.provider} / {route.model} / ${route.spendCapUsd}</span>
          </button>
        )}</For>
      </aside>
      <section class="ugc2-node-canvas">
        <For each={props.workspace.developerGraph.nodes}>{(node, index) => (
          <GraphNode node={node} index={index()} />
        )}</For>
      </section>
    </div>
  )
}

function GraphNode(props: { node: DeveloperGraphNode; index: number }) {
  return (
    <article
      classList={{
        "ugc2-graph-node": true,
        warning: props.node.status === "blocked",
        queued: String(props.node.status) === "idle",
      }}
      style={{ left: `${graphX(props.node, props.index)}%`, top: `${graphY(props.node, props.index)}%` }}
    >
      <header>
        <strong>{props.index + 1}. {props.node.title}</strong>
        <span>{props.node.status}</span>
      </header>
      <For each={props.node.parameters.slice(0, 3)}>{(parameter) => (
        <p>{parameter.label}: {String(parameter.value)}</p>
      )}</For>
    </article>
  )
}

function ReferenceRemix(props: {
  workspace: StudioWorkspace
  selectedReferenceId: string
  onSelectReference: (referenceId: string) => void
}) {
  const selected = createMemo(() => props.workspace.referenceProfiles.find((profile) => profile.id === props.selectedReferenceId) ?? firstReference(props.workspace))
  const selectedPlan = createMemo(() => (
    props.workspace.referenceRemixPlans.find((plan) => plan.referenceProfileId === selected().id) ?? firstRemixPlan(props.workspace)
  ))

  return (
    <div class="ugc2-remix">
      <section class="ugc2-reference-list">
        <For each={props.workspace.referenceProfiles}>{(profile) => (
          <button
            type="button"
            classList={{ active: props.selectedReferenceId === profile.id }}
            onClick={() => props.onSelectReference(profile.id)}
          >
            <strong>{profile.displayName}</strong>
            <span>{profile.platform} / {profile.rightsStatus}</span>
            <em>{profile.styleLane}</em>
          </button>
        )}</For>
      </section>
      <section class="ugc2-remix-main">
        <header>
          <div>
            <p>Reference profile: {selected().handle}</p>
            <h2>{selected().displayName}</h2>
          </div>
          <button type="button">Create clean-room profile bible</button>
        </header>

        <section class="ugc2-reference-summary">
          <dl>
            <dt>Rights</dt>
            <dd>{selected().rightsStatus}</dd>
            <dt>Videos indexed</dt>
            <dd>{selected().sampleClips.length}</dd>
            <dt>Selected samples</dt>
            <dd>{selected().sampleClips.length}</dd>
            <dt>Purpose</dt>
            <dd>extract mechanics, not identity</dd>
          </dl>
          <p>{selected().useCase}</p>
        </section>

        <section class="ugc2-sample-browser" aria-label="Reference sample browser">
          <For each={selected().sampleClips}>{(clip) => (
            <article>
              <div class="ugc2-sample-thumb">
                <span>Play</span>
                <em>{formatSeconds(clip.durationSeconds)}</em>
              </div>
              <strong>{clip.title}</strong>
              <div>
                <For each={clip.extractedFields}>{(field) => <small>{field}</small>}</For>
              </div>
            </article>
          )}</For>
          <button type="button">Flick through more samples</button>
        </section>

        <section class="ugc2-extraction-board">
          <ExtractionTrack label="Gesture beats" value={selected().extractedMechanics.gestureRhythm} />
          <ExtractionTrack label="Cut rhythm" value={selected().extractedMechanics.shotStructure.join(" / ")} />
          <ExtractionTrack label="Pose/keyframe transfer" value={selected().extractedMechanics.poseTiming} />
          <ExtractionTrack label="Caption safe area" value={selected().extractedMechanics.captionTemplate} />
          <ExtractionTrack label="Hook slot" value={selected().extractedMechanics.hookFamilies.join(" / ")} />
          <ExtractionTrack label="CTA slot" value={selected().extractedMechanics.ctaPatterns.join(" / ")} />
        </section>

        <div class="ugc2-remix-boundary">
          <RemixFieldList title="Preserve" fields={selectedPlan().preservedFields} />
          <RemixFieldList title="Swap" fields={selectedPlan().swappedFields} />
          <RemixFieldList title="Blocked" fields={selectedPlan().blockedFields} />
        </div>
      </section>
    </div>
  )
}

function Inspector(props: {
  mode: InspectorMode
  onModeChange: (mode: InspectorMode) => void
  activeView: StudioView
  workspace: StudioWorkspace
  persona: PersonaProfile
  candidate: CreativeCandidate
  snapshot: BranchSnapshot
  reference: ReferenceProfile
  remixPlan: ReferenceProfileRemixPlan
  json: object
}) {
  return (
    <aside class="ugc2-inspector" aria-label="Inspector">
      <header>
        <div>
          <p>Inspector</p>
          <h2>{props.activeView.name}</h2>
        </div>
        <nav>
          <button
            type="button"
            classList={{ active: props.mode === "creative" }}
            onClick={() => props.onModeChange("creative")}
          >
            Creative
          </button>
          <button
            type="button"
            classList={{ active: props.mode === "json" }}
            onClick={() => props.onModeChange("json")}
          >
            JSON
          </button>
        </nav>
      </header>

      <Show when={props.mode === "creative"}>
        <section class="ugc2-inspector-card">
          <h3>Product brief</h3>
          <p>{props.workspace.productBrief.productName} / {props.workspace.productBrief.offer}</p>
          <ScoreBar label="CTA posts" value={props.workspace.productBrief.campaignMix.ctaPostsPercent} max={100} />
          <ScoreBar label="Profile posts" value={props.workspace.productBrief.campaignMix.personaBuildingPostsPercent} max={100} />
        </section>
        <section class="ugc2-inspector-card">
          <h3>Selected persona</h3>
          <dl class="ugc2-compact-dl">
            <dt>Name</dt>
            <dd>{props.persona.displayName}</dd>
            <dt>Lane</dt>
            <dd>{props.persona.genreLane}</dd>
            <dt>Energy</dt>
            <dd>{props.persona.voice.energy}%</dd>
            <dt>Cadence</dt>
            <dd>{postingMix(props.persona)}</dd>
          </dl>
        </section>
        <section class="ugc2-inspector-card">
          <h3>Selected candidate</h3>
          <p>{props.candidate.preview.transcript[0]?.text ?? props.candidate.title}</p>
          <ScoreBar label="Overall" value={props.candidate.scorecard.overall} max={100} />
          <ScoreBar label="Persona fit" value={props.candidate.scorecard.personaFit} max={100} />
        </section>
        <section class="ugc2-inspector-card">
          <h3>Branch decision</h3>
          <p>{props.snapshot.decisionNote}</p>
          <button type="button">Fork this snapshot</button>
        </section>
        <section class="ugc2-inspector-card">
          <h3>Reference remix</h3>
          <p>{props.remixPlan.goal}</p>
          <button type="button">Open clean-room rules</button>
        </section>
      </Show>

      <Show when={props.mode === "json"}>
        <section class="ugc2-inspector-card">
          <div class="ugc2-json-header">
            <h3>Continuity JSON</h3>
            <span>Valid</span>
          </div>
          <pre class="ugc2-json">{JSON.stringify(props.json, null, 2)}</pre>
          <button type="button">Copy JSON</button>
        </section>
      </Show>
    </aside>
  )
}

function CommandBar(props: {
  value: string
  onInput: (value: string) => void
  workspace: StudioWorkspace
}) {
  return (
    <section class="ugc2-command-bar" aria-label="Agent command bar">
      <button type="button">+</button>
      <textarea
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        aria-label="Agent instruction"
      />
      <div class="ugc2-command-chips">
        <button type="button">{props.workspace.agent.selectedSetIds.length} selected sets</button>
        <button type="button">Attach product page</button>
        <button type="button">Agent settings</button>
      </div>
      <button type="button" class="run">Run</button>
    </section>
  )
}

function ScoreBar(props: { label: string; value: number; max: number }) {
  const percent = createMemo(() => Math.min(100, Math.max(0, (props.value / props.max) * 100)))

  return (
    <div class="ugc2-score">
      <span>{props.label}</span>
      <div>
        <i style={{ width: `${percent()}%` }} />
      </div>
      <strong>{props.value.toFixed(0)}</strong>
    </div>
  )
}

function Timeline(props: { tracks: readonly EditorTrack[]; duration: number }) {
  return (
    <section class="ugc2-timeline" aria-label="Layer timeline">
      <header>
        <strong>Timeline</strong>
        <span>00:08.12 / {formatSeconds(props.duration)}</span>
      </header>
      <For each={props.tracks}>{(track, index) => (
        <div class="ugc2-track">
          <span>{track.label}</span>
          <div>
            <For each={track.clips}>{(clip) => (
              <i
                style={{
                  left: `${(clip.startSeconds / props.duration) * 100}%`,
                  width: `${(clip.durationSeconds / props.duration) * 100}%`,
                  background: trackColor(index()),
                }}
              />
            )}</For>
          </div>
        </div>
      )}</For>
    </section>
  )
}

function ExtractionTrack(props: { label: string; value: string }) {
  return (
    <div class="ugc2-extraction-track">
      <span>{props.label}</span>
      <div><i /></div>
      <p>{props.value}</p>
    </div>
  )
}

function RemixFieldList(props: { title: string; fields: ReferenceProfileRemixPlan["preservedFields"] }) {
  return (
    <section class="ugc2-mechanic-list">
      <h3>{props.title}</h3>
      <For each={props.fields}>{(field) => (
        <article classList={{ "ugc2-remix-field": true, blocked: field.mode === "blocked" }}>
          <strong>{field.label}</strong>
          <p>{field.rationale}</p>
          <span>{field.mode} / {(field.confidence * 100).toFixed(0)}%</span>
        </article>
      )}</For>
    </section>
  )
}

function firstPersona(currentWorkspace: StudioWorkspace): PersonaProfile {
  const persona = currentWorkspace.personas[0]
  if (!persona) throw new Error("UGC Studio fixture has no personas")
  return persona
}

function firstCandidate(currentWorkspace: StudioWorkspace): CreativeCandidate {
  const candidate = currentWorkspace.candidates[0]
  if (!candidate) throw new Error("UGC Studio fixture has no candidates")
  return candidate
}

function firstSnapshot(currentWorkspace: StudioWorkspace): BranchSnapshot {
  const snapshot = currentWorkspace.branchSnapshots[0]
  if (!snapshot) throw new Error("UGC Studio fixture has no branch snapshots")
  return snapshot
}

function firstReference(currentWorkspace: StudioWorkspace): ReferenceProfile {
  const reference = currentWorkspace.referenceProfiles[0]
  if (!reference) throw new Error("UGC Studio fixture has no reference profiles")
  return reference
}

function firstRemixPlan(currentWorkspace: StudioWorkspace): ReferenceProfileRemixPlan {
  const plan = currentWorkspace.referenceRemixPlans[0]
  if (!plan) throw new Error("UGC Studio fixture has no reference remix plans")
  return plan
}

function personaForCandidate(currentWorkspace: StudioWorkspace, candidate: CreativeCandidate): PersonaProfile | null {
  if (!candidate.personaId) return null
  return currentWorkspace.personas.find((persona) => persona.id === candidate.personaId) ?? null
}

function initials(value: string): string {
  return value
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
}

function postingMix(persona: PersonaProfile): string {
  return persona.postingStrategy.weeklyCadence
    .map((item) => `${item.postsPerWeek} ${item.purpose}`)
    .join(" / ")
}

function formatSeconds(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(rounded / 60)
  const rest = String(rounded % 60).padStart(2, "0")
  return `${minutes}:${rest}`
}

function personaGradient(index: number): string {
  const gradients = [
    "linear-gradient(135deg, #f5c9bb, #dbe8cf)",
    "linear-gradient(135deg, #d7e4ff, #f5d9a8)",
    "linear-gradient(135deg, #ffd4e2, #dfe7ff)",
    "linear-gradient(135deg, #e5e1d8, #cfdff1)",
  ]
  return gradients[index % gradients.length] ?? gradients[0]
}

function trackColor(index: number): string {
  const colors = ["#8ab4f8", "#d39d63", "#8d64b8", "#4f8d5d", "#c77b7b", "#70c7d8"]
  return colors[index % colors.length] ?? colors[0]
}

function graphX(node: DeveloperGraphNode, index?: number): number {
  const byIndex = [5, 28, 28, 52, 72, 72]
  if (index !== undefined) return byIndex[index % byIndex.length] ?? 5
  return Math.min(76, Math.max(5, node.position.x / 15))
}

function graphY(node: DeveloperGraphNode, index?: number): number {
  const byIndex = [25, 18, 58, 32, 24, 58]
  if (index !== undefined) return byIndex[index % byIndex.length] ?? 25
  return Math.min(78, Math.max(8, node.position.y / 5))
}

function relativeUpdate(value: string): string {
  return value.includes("2026-06-09") ? "just now" : value
}

function personaStatusClass(status: string): string {
  switch (status) {
    case "selected":
    case "promising":
      return "ugc2-pill good"
    case "draft":
      return "ugc2-pill warning"
    case "paused":
      return "ugc2-pill bad"
    default:
      return "ugc2-pill"
  }
}
