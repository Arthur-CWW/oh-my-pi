import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type * as React from "react"

import { type Card, type CardStatus, type EvidenceHit, getCards, getNotes, getProgress, getProofs, setCardStatus } from "./api"
import { AskPanel } from "./components/AskPanel"
import { CardsPanel } from "./components/CardsPanel"
import { Header } from "./components/Header"
import { KeymapOverlay } from "./components/KeymapOverlay"
import { NotesPanel } from "./components/NotesPanel"
import { ProgressFeed } from "./components/ProgressFeed"
import { ProofsPanel } from "./components/ProofsPanel"
import { ProofViewer } from "./components/ProofViewer"
import { usePolled } from "./hooks/usePolled"
import { useVimNav } from "./hooks/useVimNav"

export default function App(): React.JSX.Element {
  // Ask evidence is lifted so the vim registry can address the latest hits.
  const [askHits, setAskHits] = useState<EvidenceHit[]>([])

  // Cards carry optimistic mutation, so App owns them rather than usePolled.
  const [cards, setCards] = useState<Card[] | null>(null)
  const [cardsError, setCardsError] = useState<string | null>(null)
  const [cardActionError, setCardActionError] = useState<string | null>(null)
  const cardsRef = useRef<Card[] | null>(null)
  cardsRef.current = cards

  useEffect(() => {
    let alive = true
    getCards(80).then(
      (loaded) => {
        if (alive) setCards(loaded)
      },
      (cause: unknown) => {
        if (alive) setCardsError(cause instanceof Error ? cause.message : "Failed to load cards")
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const setCard = useCallback((id: number, status: CardStatus) => {
    const snapshot = cardsRef.current
    setCardActionError(null)
    setCards(snapshot ? snapshot.map((c) => (c.id === id ? { ...c, status } : c)) : snapshot)
    setCardStatus(id, status).then(
      (updated) => setCards((prev) => (prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev)),
      () => {
        setCards(snapshot)
        setCardActionError("Couldn't update card — try again.")
      },
    )
  }, [])

  const candidates = useMemo(() => cards?.filter((c) => c.status === "candidate") ?? [], [cards])
  const resolved = useMemo(() => cards?.filter((c) => c.status !== "candidate") ?? [], [cards])

  const progress = usePolled(() => getProgress(60), 3_000)
  const proofs = usePolled(getProofs, 30_000)
  const notes = usePolled(() => getNotes(40), 30_000)

  const progressList = useMemo(() => [...(progress.data ?? [])].sort((a, b) => b.id - a.id), [progress.data])
  const proofList = useMemo(() => [...(proofs.data ?? [])].sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime)), [proofs.data])
  const noteList = notes.data ?? []

  const [activeProof, setActiveProof] = useState<string | null>(null)

  const openUrl = useCallback((url: string | null | undefined) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer")
  }, [])

  const nav = useVimNav({
    panels: [
      { id: "ask", count: askHits.length, onActivate: (i) => openUrl(askHits[i]?.url) },
      { id: "progress", count: progressList.length, onActivate: (i) => openUrl(progressList[i]?.refs.find((r) => /^https?:\/\//.test(r))) },
      {
        id: "cards",
        count: candidates.length,
        onActivate: (i) => {
          const card = candidates[i]
          if (card) requestAnimationFrame(() => (document.querySelector(`[data-card-approve="${card.id}"]`) as HTMLElement | null)?.focus())
        },
        onApprove: (i) => candidates[i] && setCard(candidates[i].id, "approved"),
        onReject: (i) => candidates[i] && setCard(candidates[i].id, "rejected"),
      },
      { id: "proofs", count: proofList.length, onActivate: (i) => proofList[i] && setActiveProof(proofList[i].name) },
      { id: "notes", count: noteList.length, onActivate: (i) => openUrl(noteList[i]?.sources.find((s) => s.url)?.url) },
    ],
    overlayOpen: activeProof !== null,
    onCloseOverlay: () => setActiveProof(null),
  })

  const columnClass = "contents min-[1200px]:flex min-[1200px]:flex-col min-[1200px]:gap-5"

  return (
    <div className="min-h-svh bg-background text-foreground">
      <Header onShowKeys={() => nav.setHelpOpen(true)} />

      <main className="mx-auto w-full max-w-3xl px-4 py-5 min-[1200px]:max-w-6xl">
        <div className="flex flex-col gap-5 min-[1200px]:grid min-[1200px]:grid-cols-[minmax(0,1fr)_380px] min-[1200px]:items-start min-[1200px]:gap-5">
          <div className={columnClass}>
            <AskPanel active={nav.isActivePanel("ask")} isFocused={(i) => nav.isFocused("ask", i)} onFocus={(i) => nav.focus("ask", i)} onEvidence={setAskHits} />
            <ProgressFeed
              entries={progressList}
              loading={progress.loading}
              error={progress.error}
              active={nav.isActivePanel("progress")}
              isFocused={(i) => nav.isFocused("progress", i)}
              onFocus={(i) => nav.focus("progress", i)}
            />
            <CardsPanel
              candidates={candidates}
              resolved={resolved}
              loading={cards === null && cardsError === null}
              error={cardsError}
              actionError={cardActionError}
              active={nav.isActivePanel("cards")}
              isFocused={(i) => nav.isFocused("cards", i)}
              onFocus={(i) => nav.focus("cards", i)}
              onSet={setCard}
            />
          </div>
          <div className={columnClass}>
            <ProofsPanel
              proofs={proofList}
              loading={proofs.loading}
              error={proofs.error}
              active={nav.isActivePanel("proofs")}
              isFocused={(i) => nav.isFocused("proofs", i)}
              onFocus={(i) => nav.focus("proofs", i)}
              onOpen={setActiveProof}
            />
            <NotesPanel
              notes={noteList}
              loading={notes.loading}
              error={notes.error}
              active={nav.isActivePanel("notes")}
              isFocused={(i) => nav.isFocused("notes", i)}
              onFocus={(i) => nav.focus("notes", i)}
            />
          </div>
        </div>
      </main>

      {activeProof !== null ? <ProofViewer key={activeProof} name={activeProof} onClose={() => setActiveProof(null)} /> : null}
      {nav.helpOpen ? <KeymapOverlay onClose={() => nav.setHelpOpen(false)} /> : null}
    </div>
  )
}
