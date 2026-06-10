import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { UgcJsonStore } from "./ugc-json-store"
import { routeUgc } from "./ugc-routes"
import type { UgcLocalState } from "../ugc/local-state"

describe("routeUgc", () => {
  test("serves workspace state and accepts local-first mutations", async () => {
    const store = createStore()
    const initialResponse = await routeUgc(new Request("http://127.0.0.1/api/ugc/workspace"), store)
    expect(initialResponse?.status).toBe(200)
    const initial = await readState(initialResponse)
    const personaId = initial.workspace.personas[0]?.id ?? ""
    const candidateId = initial.workspace.candidates[0]?.id ?? ""

    const personaResponse = await routeUgc(jsonRequest(`/api/ugc/personas/${personaId}`, {
      status: "selected",
      voice: { energy: 51, speakingStyle: "quiet confidence" },
    }), store)
    const personaState = await readState(personaResponse)
    expect(personaState.workspace.personas.find((persona) => persona.id === personaId)?.status).toBe("selected")
    expect(personaState.workspace.personas.find((persona) => persona.id === personaId)?.voice.energy).toBe(51)

    const statusResponse = await routeUgc(jsonRequest(`/api/ugc/candidates/${candidateId}/status`, { status: "rejected" }), store)
    const statusState = await readState(statusResponse)
    expect(statusState.workspace.candidates.find((candidate) => candidate.id === candidateId)?.status).toBe("rejected")

    const noteResponse = await routeUgc(jsonRequest("/api/ugc/notes", {
      attachedTo: { kind: "candidate", id: candidateId },
      verdict: "reject",
      body: "Dead end for this batch.",
    }), store)
    const noteState = await readState(noteResponse)
    expect(noteState.workspace.reviewNotes[0]?.verdict).toBe("reject")
  })

  test("returns null for routes owned by other daemon handlers", async () => {
    const store = createStore()
    await expect(routeUgc(new Request("http://127.0.0.1/api/ugc/kie/capabilities"), store)).resolves.toBeNull()
    await expect(routeUgc(new Request("http://127.0.0.1/api/health"), store)).resolves.toBeNull()
  })
})

function createStore(): UgcJsonStore {
  const cwd = mkdtempSync(resolve(tmpdir(), "ugc-routes-"))
  return new UgcJsonStore({
    cwd,
    root: "ugc-workspaces",
    now: () => "2026-06-10T00:00:00.000Z",
  })
}

function jsonRequest(path: string, body: object): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function readState(response: Response | null): Promise<UgcLocalState> {
  if (!response) throw new Error("missing response")
  return await response.json() as UgcLocalState
}
