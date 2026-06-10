import type { JsonValue } from "../renderer/ugcStudioModel"
import type { UgcLocalState } from "./local-state"

export type DerivedGraphFamily =
  | "brief"
  | "persona"
  | "reference"
  | "branch"
  | "candidate"
  | "provider-job"
  | "export"
  | "research"
  | "template"

export interface DerivedGraphNode {
  readonly id: string
  readonly entityId: string
  readonly family: DerivedGraphFamily
  readonly title: string
  readonly subtitle: string
  readonly status: string
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly artifactPaths: readonly string[]
  readonly rawJson: JsonValue
}

export interface DerivedGraphEdge {
  readonly id: string
  readonly fromId: string
  readonly toId: string
  readonly label: string
}

export interface DerivedDeveloperGraph {
  readonly nodes: readonly DerivedGraphNode[]
  readonly edges: readonly DerivedGraphEdge[]
}

export function deriveUgcDeveloperGraph(state: UgcLocalState): DerivedDeveloperGraph {
  const nodes: DerivedGraphNode[] = []
  const edges: DerivedGraphEdge[] = []
  const entityToNode = new Map<string, string>()

  function addNode(node: DerivedGraphNode) {
    nodes.push(node)
    entityToNode.set(node.entityId, node.id)
  }

  function addEdge(fromId: string | undefined, toId: string | undefined, label: string) {
    if (!fromId || !toId || fromId === toId) return
    const id = `${fromId}->${toId}:${label}`
    if (edges.some((edge) => edge.id === id)) return
    edges.push({ id, fromId, toId, label })
  }

  const brief = state.workspace.productBrief
  const briefNodeId = `brief:${brief.id}`
  addNode({
    id: briefNodeId,
    entityId: brief.id,
    family: "brief",
    title: brief.productName,
    subtitle: `${brief.category} / ${brief.offer}`,
    status: "ready",
    inputs: brief.constraints,
    outputs: brief.desiredOutcomes,
    artifactPaths: [],
    rawJson: toNodeJson(brief),
  })

  for (const persona of state.workspace.personas) {
    const nodeId = `persona:${persona.id}`
    addNode({
      id: nodeId,
      entityId: persona.id,
      family: "persona",
      title: persona.displayName,
      subtitle: persona.profileBible.niche,
      status: persona.status,
      inputs: persona.sampleClipIds,
      outputs: state.workspace.candidates.filter((candidate) => candidate.personaId === persona.id).map((candidate) => candidate.id),
      artifactPaths: persona.appearance.imageReferenceIds,
      rawJson: toNodeJson(persona),
    })
    addEdge(briefNodeId, nodeId, "persona lane")
  }

  for (const archive of state.referenceArchives) {
    const nodeId = `reference:${archive.id}`
    addNode({
      id: nodeId,
      entityId: archive.referenceProfileId,
      family: "reference",
      title: archive.title,
      subtitle: archive.sourcePolicy,
      status: archive.archiveStatus,
      inputs: archive.sampleClipIds,
      outputs: archive.candidateFormatOutputs.map((output) => output.id),
      artifactPaths: [],
      rawJson: toNodeJson(archive),
    })
  }

  for (const branch of state.workspace.branchSnapshots) {
    const nodeId = `branch:${branch.id}`
    addNode({
      id: nodeId,
      entityId: branch.id,
      family: "branch",
      title: branch.title,
      subtitle: branch.focus,
      status: branch.status,
      inputs: [branch.parentId, ...branch.selectedPersonaIds].filter(isString),
      outputs: [...branch.childIds, ...branch.selectedCandidateIds],
      artifactPaths: [],
      rawJson: toNodeJson(branch),
    })
  }

  for (const candidate of state.workspace.candidates) {
    const nodeId = `candidate:${candidate.id}`
    addNode({
      id: nodeId,
      entityId: candidate.id,
      family: "candidate",
      title: candidate.title,
      subtitle: `${candidate.kind} / ${candidate.durationSeconds}s`,
      status: candidate.status,
      inputs: [candidate.personaId, candidate.referenceProfileId, candidate.batchId].filter(isString),
      outputs: state.exportManifests.filter((manifest) => manifest.selectedCandidateId === candidate.id).map((manifest) => manifest.id),
      artifactPaths: [candidate.preview.posterUrl, candidate.preview.videoUrl].filter(isString),
      rawJson: toNodeJson(candidate),
    })
  }

  for (const job of state.providerJobs) {
    const nodeId = `provider-job:${job.id}`
    addNode({
      id: nodeId,
      entityId: job.id,
      family: "provider-job",
      title: `${job.provider} / ${job.operation}`,
      subtitle: `${job.mode} / cap $${job.spendCapUsd.toFixed(2)}`,
      status: job.status,
      inputs: job.targetIds,
      outputs: job.artifactPaths,
      artifactPaths: job.artifactPaths,
      rawJson: toNodeJson(job),
    })
  }

  for (const manifest of state.exportManifests) {
    const nodeId = `export:${manifest.id}`
    addNode({
      id: nodeId,
      entityId: manifest.id,
      family: "export",
      title: manifest.label,
      subtitle: `${manifest.presetId} / ${manifest.status}`,
      status: manifest.status,
      inputs: [manifest.selectedCandidateId],
      outputs: manifest.outputPath ? [manifest.outputPath] : [],
      artifactPaths: manifest.outputPath ? [manifest.outputPath] : [],
      rawJson: toNodeJson(manifest),
    })
  }

  for (const target of state.researchTargets) {
    const nodeId = `research:${target.id}`
    addNode({
      id: nodeId,
      entityId: target.id,
      family: "research",
      title: target.niche,
      subtitle: `${target.platform} / ${target.sourcePolicy}`,
      status: target.status,
      inputs: [target.query],
      outputs: target.templateJobIds,
      artifactPaths: [],
      rawJson: toNodeJson(target),
    })
  }

  for (const job of state.templateMiningJobs) {
    const nodeId = `template:${job.id}`
    addNode({
      id: nodeId,
      entityId: job.id,
      family: "template",
      title: job.templateSpec.title,
      subtitle: job.templateSpec.category,
      status: job.status,
      inputs: [job.researchTargetId, ...job.templateSpec.swapSlots],
      outputs: job.candidateIds,
      artifactPaths: [],
      rawJson: toNodeJson(job),
    })
  }

  for (const branch of state.workspace.branchSnapshots) {
    addEdge(entityToNode.get(branch.parentId ?? ""), entityToNode.get(branch.id), "fork")
    for (const personaId of branch.selectedPersonaIds) addEdge(entityToNode.get(personaId), entityToNode.get(branch.id), "selected persona")
    for (const candidateId of branch.selectedCandidateIds) addEdge(entityToNode.get(branch.id), entityToNode.get(candidateId), "selected candidate")
  }
  for (const candidate of state.workspace.candidates) {
    addEdge(entityToNode.get(candidate.personaId ?? ""), entityToNode.get(candidate.id), "generated")
    addEdge(entityToNode.get(candidate.referenceProfileId ?? ""), entityToNode.get(candidate.id), "reference")
  }
  for (const job of state.providerJobs) {
    for (const targetId of job.targetIds) addEdge(entityToNode.get(targetId), entityToNode.get(job.id), "provider target")
  }
  for (const manifest of state.exportManifests) {
    addEdge(entityToNode.get(manifest.selectedCandidateId), entityToNode.get(manifest.id), "exported")
  }
  for (const target of state.researchTargets) {
    for (const jobId of target.templateJobIds) addEdge(entityToNode.get(target.id), entityToNode.get(jobId), "mines template")
  }
  for (const job of state.templateMiningJobs) {
    for (const candidateId of job.candidateIds) addEdge(entityToNode.get(job.id), entityToNode.get(candidateId), "template output")
  }

  return { nodes, edges }
}

function toNodeJson(value: object): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function isString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0
}
