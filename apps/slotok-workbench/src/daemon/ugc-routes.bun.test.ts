import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import { UgcJsonStore } from "./ugc-json-store"
import { routeUgc } from "./ugc-routes"
import { UgcSqliteStore } from "./ugc-sqlite-store"
import type { UgcLocalState } from "../ugc/local-state"


test("returns candidate annotations linked by reviewNoteIds through real workspace store", async () => {
  const cwd = mkdtempSync(resolve(tmpdir(), "ugc-routes-linked-annotations-"))
  const workspaceDir = resolve(cwd, "ugc-workspaces", "workspace_protein_bar_ads")
  const sqliteStore = new UgcSqliteStore({ workspaceDir, sqlitePath: resolve(workspaceDir, "workspace.sqlite") })
  const store = createStore(cwd, sqliteStore)
  const response = await routeUgc(new Request("http://127.0.0.1/api/ugc/candidates/candidate_soft_demo_01/annotations"), store)
  expect(response?.status).toBe(200)
  const payload = await response?.json() as {
    readonly annotations?: readonly {
      readonly id?: string
      readonly attachedTo?: { readonly kind?: string; readonly id?: string }
    }[]
  }
  const linkedRevision = payload.annotations?.find((annotation) => annotation.id === "note_soft_demo_revision")
  expect(linkedRevision?.attachedTo).toEqual({ kind: "batch", id: "batch_hooks_round_02" })
  rmSync(cwd, { force: true, recursive: true })
})
describe("routeUgc SQLite persistence", () => {
  test("persists candidate annotations through real workspace SQLite", async () => {
    const cwd = mkdtempSync(resolve(tmpdir(), "ugc-routes-sqlite-annotations-"))
    const workspaceDir = resolve(cwd, "ugc-workspaces", "workspace_protein_bar_ads")
    const sqlitePath = resolve(workspaceDir, "workspace.sqlite")
    const sqliteStore = new UgcSqliteStore({ workspaceDir, sqlitePath })
    const store = createStore(cwd, sqliteStore)
    const initial = store.read()
    const candidateId = initial.workspace.candidates[0]?.id ?? ""
    if (!candidateId) throw new Error("missing candidate")

    const annotationResponse = await routeUgc(jsonRequest(`/api/ugc/candidates/${candidateId}/annotations`, {
      body: "Watch the opening pause before export.",
      requestedChange: "Trim 0.5s from the hook lead-in.",
    }), store)
    expect(annotationResponse?.status).toBe(201)
    const annotationPayload = await annotationResponse?.json() as {
      readonly annotation?: {
        readonly id?: string
        readonly body?: string
        readonly verdict?: string
        readonly requestedChange?: string | null
      } | null
      readonly state?: UgcLocalState
    }
    const annotationId = annotationPayload.annotation?.id ?? ""
    expect(annotationId).not.toBe("")
    expect(annotationPayload.annotation?.body).toBe("Watch the opening pause before export.")
    expect(annotationPayload.annotation?.verdict).toBe("watch-again")
    expect(annotationPayload.annotation?.requestedChange).toBe("Trim 0.5s from the hook lead-in.")
    expect(annotationPayload.state?.workspace.candidates.find((candidate) => candidate.id === candidateId)?.reviewNoteIds).toContain(annotationId)
    expect(existsSync(sqlitePath)).toBe(true)

    const sqliteNote = sqliteStore.readObject("notes", annotationId) as {
      readonly body?: string
      readonly attachedTo?: { readonly kind?: string; readonly id?: string }
    } | null
    expect(sqliteNote?.body).toBe("Watch the opening pause before export.")
    expect(sqliteNote?.attachedTo).toEqual({ kind: "candidate", id: candidateId })

    rmSync(store.config.statePath, { force: true })
    const reloadedSqliteStore = new UgcSqliteStore({ workspaceDir, sqlitePath })
    const reloadedSqliteNote = reloadedSqliteStore.readObject("notes", annotationId) as {
      readonly body?: string
      readonly attachedTo?: { readonly kind?: string; readonly id?: string }
    } | null
    expect(reloadedSqliteNote?.body).toBe("Watch the opening pause before export.")
    expect(reloadedSqliteNote?.attachedTo).toEqual({ kind: "candidate", id: candidateId })

    const reloadedStore = createStore(cwd, reloadedSqliteStore)
    const listResponse = await routeUgc(new Request(`http://127.0.0.1/api/ugc/candidates/${candidateId}/annotations`), reloadedStore)
    expect(listResponse?.status).toBe(200)
    const listPayload = await listResponse?.json() as {
      readonly annotations?: readonly {
        readonly id?: string
        readonly body?: string
      }[]
    }
    expect(listPayload.annotations?.map((annotation) => annotation.id)).toContain(annotationId)
    expect(listPayload.annotations?.find((annotation) => annotation.id === annotationId)?.body).toBe("Watch the opening pause before export.")

    const noteCountBeforeMissingCandidate = reloadedSqliteStore.readObjects("notes").length
    const missingResponse = await routeUgc(jsonRequest("/api/ugc/candidates/missing_candidate/annotations", {
      body: "This should not persist.",
    }), reloadedStore)
    expect(missingResponse?.status).toBe(404)
    expect(reloadedSqliteStore.readObjects("notes").length).toBe(noteCountBeforeMissingCandidate)
  })
})

function createStore(cwd: string, sqliteSync: UgcSqliteStore): UgcJsonStore {
  return new UgcJsonStore({
    cwd,
    root: "ugc-workspaces",
    now: () => "2026-06-10T00:00:00.000Z",
    sqliteSync,
  })
}

function jsonRequest(path: string, body: object): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
