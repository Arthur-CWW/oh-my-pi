import { useCallback, useEffect, useState } from "react"
import type * as React from "react"

import {
  addEnrichmentLabel,
  getEnrichments,
  getKnownWords,
  getQueue,
  runEnrichment,
  type EnrichmentLabel,
  type EnrichmentOutput,
  type EnrichmentRecord,
  type QueueItem,
} from "@/api"
import { cn } from "@/lib/utils"
import { useVimNav } from "@/hooks/useVimNav"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Textarea } from "./ui/textarea"
import { Spinner } from "./ui/spinner"

const verdictStyle: Record<EnrichmentLabel["verdict"], string> = {
  keep: "text-emerald-400",
  cut: "text-rose-400",
  edit: "text-amber-300",
}
function latestRecord(records: EnrichmentRecord[]): EnrichmentRecord | null {
  let latest: EnrichmentRecord | null = null
  for (const record of records) {
    if (!latest || record.createdAt > latest.createdAt || (record.createdAt === latest.createdAt && record.id > latest.id)) latest = record
  }
  return latest
}


export function EnrichView(): React.JSX.Element {
  const [queue, setQueue] = useState<QueueItem[] | null>(null)
  const [knownWords, setKnownWords] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [record, setRecord] = useState<EnrichmentRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calibrationCount, setCalibrationCount] = useState(0)

  const selected = queue?.[selectedIndex] ?? null
  const refreshLabels = useCallback(async (queueItemId: number): Promise<void> => {
    const records = await getEnrichments(queueItemId)
    setRecord(latestRecord(records))
    const all = await getEnrichments()
    setCalibrationCount(Math.min(10, all.reduce((count, item) => count + item.labels.length, 0)))
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([getQueue("all", 100), getKnownWords(), getEnrichments()]).then(
      ([items, words, enrichments]) => {
        if (!alive) return
        const filtered = items.filter((item) => item.status === "new" || item.status === "keep")
        setQueue(filtered)
        setKnownWords(words)
        setCalibrationCount(Math.min(10, enrichments.reduce((count, item) => count + item.labels.length, 0)))
        setSelectedIndex(0)
        setRecord(null)
        setError(null)
      },
      (reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : "Failed to load enrichment playground")
      },
    ).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!selected) {
      setRecord(null)
      return
    }
    let alive = true
    setRecord(null)
    refreshLabels(selected.id).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Failed to load enrichment")
    })
    return () => { alive = false }
  }, [refreshLabels, selected])

  const selectItem = useCallback((index: number) => {
    if (!queue || index < 0 || index >= queue.length) return
    setSelectedIndex(index)
    setError(null)
  }, [queue])

  const vim = useVimNav({
    panels: [{ id: "enrichment-queue", count: queue?.length ?? 0, onActivate: selectItem }],
    overlayOpen: false,
    onCloseOverlay: () => undefined,
  })

  const handleRun = useCallback(() => {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    runEnrichment(selected.id).then(
      ({ enrichment }) => {
        setRecord(enrichment)
        setCalibrationCount((count) => Math.min(10, count + (enrichment.labels.length > 0 ? 1 : 0)))
      },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : "Enrichment request failed"),
    ).finally(() => setBusy(false))
  }, [busy, selected])

  const onLabelSaved = useCallback(async (): Promise<void> => {
    if (!selected) return
    await refreshLabels(selected.id)
  }, [refreshLabels, selected])

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col gap-5 px-5 py-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Queue enrichment</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Friction → substrate</h1>
          <p className="mt-1 text-sm text-muted-foreground">One source sentence at a time. Edit what earns its place.</p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p><span className="font-mono text-foreground">{calibrationCount}/10</span> calibration labels</p>
          <p className="mt-1 font-mono text-[11px]">j/k move · enter select</p>
        </div>
      </header>

      {error && <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}

      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="border-b px-4 py-4">
            <CardTitle className="text-sm">Queue <span className="font-mono text-muted-foreground">{queue?.length ?? "—"}</span></CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 overflow-y-auto p-0" data-vim-panel="enrichment-queue">
            {loading && <p className="px-4 py-5 text-sm text-muted-foreground">Loading queue…</p>}
            {!loading && queue?.length === 0 && <div className="px-4 py-6"><p className="text-sm text-foreground">Nothing waiting.</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Look up a word in Reader and it will appear here.</p></div>}
            {queue?.map((item, index) => (
              <button
                key={item.id}
                type="button"
                data-vim-index={index}
                onClick={() => selectItem(index)}
                onMouseEnter={() => vim.focus("enrichment-queue", index)}
                className={cn("block w-full border-b px-4 py-3 text-left transition-colors", vim.isFocused("enrichment-queue", index) || selectedIndex === index ? "bg-accent/50" : "hover:bg-accent/20")}
              >
                <div className="flex items-baseline gap-2"><span className="text-lg font-medium">{item.word}</span><span className="text-xs text-muted-foreground">{item.pinyin ?? "—"}</span><span className="ml-auto font-mono text-[11px] text-muted-foreground">p{item.priority}</span></div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.gloss ?? "No gloss"}</p>
              </button>
            ))}
          </CardContent>
        </Card>

        <section className="min-w-0">
          {!selected && <Card><CardContent className="px-6 py-10"><p className="text-sm text-muted-foreground">Select a new or kept queue item to inspect its source and run enrichment.</p></CardContent></Card>}
          {selected && <div className="space-y-4">
            <Card>
              <CardHeader className="flex-row items-start justify-between border-b px-5 py-4">
                <div><CardTitle className="text-2xl tracking-tight">{selected.word}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{selected.pinyin ?? "—"} · {selected.gloss ?? "No gloss"}</p></div>
                <Button onClick={handleRun} disabled={busy}>{busy ? <><Spinner className="mr-2" />Running…</> : record?.status === "ok" ? "Run again" : "Run enrichment"}</Button>
              </CardHeader>
              <CardContent className="px-5 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Source sentence</p>
                <p className="mt-2 text-lg leading-relaxed text-foreground">{highlightSource(selected.provenance?.sentence ?? "", selected.word)}</p>
                <p className="mt-2 text-xs text-muted-foreground">{selected.provenance?.docTitle ?? "Unknown document"} · paragraph {selected.provenance?.paragraphIdx ?? "—"}</p>
              </CardContent>
            </Card>

            {busy && <div className="rounded-md border border-border/70 px-4 py-3 text-sm text-muted-foreground">The cheap lane is thinking; this can take up to 90 seconds.</div>}
            {record?.status === "error" && <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3"><p className="text-sm font-medium text-rose-200">Enrichment failed</p><p className="mt-1 whitespace-pre-wrap text-xs text-rose-200/80">{record.error ?? "No error detail returned."}</p></div>}
            {record?.status === "ok" && record.output && <EnrichmentResult output={record.output} knownWords={knownWords} record={record} onLabelSaved={onLabelSaved} />}
            {record && <details className="rounded-md border border-border/60"><summary className="cursor-pointer px-4 py-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Raw JSON</summary><pre className="max-h-96 overflow-auto border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">{JSON.stringify(record.output ?? { error: record.error }, null, 2)}</pre></details>}
          </div>}
        </section>
      </div>
    </main>
  )
}

function EnrichmentResult({ output, knownWords, record, onLabelSaved }: { output: EnrichmentOutput; knownWords: string[]; record: EnrichmentRecord; onLabelSaved: () => Promise<void> }): React.JSX.Element {
  return <div className="space-y-4">
    <Card><CardHeader className="px-5 py-4"><div className="flex items-center justify-between gap-2"><CardTitle className="text-base">Sense disambiguation</CardTitle><Badge variant="outline">{output.sense_disambiguation.confidence} · {output.sense_disambiguation.source}</Badge></div></CardHeader><CardContent className="px-5 py-4"><LabelBar field="sense_disambiguation" value={output.sense_disambiguation} record={record} onSaved={onLabelSaved} /><p className="text-lg font-medium">{output.sense_disambiguation.selected_sense}</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{highlightSource(output.provenance.source_sentence, output.sense_disambiguation.evidence_quote)}</p><p className="mt-2 text-sm text-muted-foreground">{output.sense_disambiguation.gloss_in_context}</p>{output.sense_disambiguation.note && <p className="mt-2 text-xs italic text-muted-foreground">{output.sense_disambiguation.note}</p>}</CardContent></Card>
    <Card><CardHeader className="px-5 py-4"><CardTitle className="text-base">Examples <span className="font-mono text-xs text-muted-foreground">{output.examples.length}</span></CardTitle></CardHeader><CardContent className="space-y-4 px-5 py-4">{output.examples.map((example, index) => <div key={`${example.sentence}-${index}`} className="border-b pb-4 last:border-0 last:pb-0"><LabelBar field={`examples[${index}]`} value={example} record={record} onSaved={onLabelSaved} /><p className="text-lg leading-relaxed">{colorSentence(example.sentence, output.item.word, knownWords)}</p><p className="text-sm text-muted-foreground">{example.pinyin}</p><p className="mt-1 text-sm">{example.translation}</p><div className="mt-2 flex gap-3 text-[11px] text-muted-foreground"><span>{Math.round(example.known_token_ratio * 100)}% known</span>{example.unknown_tokens.length > 0 && <span className="text-amber-300">{example.unknown_tokens.join(", ")}</span>}</div></div>)}</CardContent></Card>
    {output.morpheme_note && <Card><CardHeader className="px-5 py-4"><CardTitle className="text-base">Morpheme note</CardTitle></CardHeader><CardContent className="px-5 py-4"><LabelBar field="morpheme_note" value={output.morpheme_note} record={record} onSaved={onLabelSaved} /><p className="text-sm leading-relaxed">{output.morpheme_note.note}</p><p className="mt-2 text-xs text-muted-foreground">Predicted confusion: {output.morpheme_note.predicted_confusion}</p></CardContent></Card>}
    {output.contrast && <Card><CardHeader className="px-5 py-4"><CardTitle className="text-base">Contrast <Badge className="ml-2" variant="secondary">{output.contrast.confusable_with}</Badge></CardTitle></CardHeader><CardContent className="px-5 py-4"><LabelBar field="contrast" value={output.contrast} record={record} onSaved={onLabelSaved} /><p className="text-sm leading-relaxed">{output.contrast.distinction}</p><p className="mt-2 text-xs text-muted-foreground">Trigger: {output.contrast.trigger}</p></CardContent></Card>}
    <Card><CardHeader className="px-5 py-4"><div className="flex items-center justify-between"><CardTitle className="text-base">Review target</CardTitle><Badge variant={output.review_target.durable_candidate ? "default" : "secondary"}>{output.review_target.durable_candidate ? "durable candidate" : "not durable"}</Badge></div></CardHeader><CardContent className="px-5 py-4"><LabelBar field="review_target" value={output.review_target} record={record} onSaved={onLabelSaved} /><p className="text-sm font-medium">{output.review_target.retrieval_target ?? "No retrieval target"}</p><p className="mt-1 text-sm text-muted-foreground">{output.review_target.why}</p></CardContent></Card>
    <div className="flex flex-wrap gap-2 px-1 text-[11px] text-muted-foreground"><span>audit: {output.self_audit.no_empty_filler_fields ? "no filler" : "filler flagged"}</span><span>·</span><span>{output.self_audit.omissions.length} reasoned omissions</span><span>·</span><span>{record.model ?? "model unknown"} · {record.elapsedMs ?? "—"}ms</span></div>
  </div>
}

function LabelBar({ field, value, record, onSaved }: { field: string; value: object; record: EnrichmentRecord; onSaved: () => Promise<void> }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [edited, setEdited] = useState(() => JSON.stringify(value, null, 2))
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const latest = record.labels.find((label) => label.field === field)
  const save = (verdict: EnrichmentLabel["verdict"]): void => {
    setSaving(true)
    setSaveError(null)
    addEnrichmentLabel(record.id, { field, verdict, edited: verdict === "edit" ? edited : undefined, note: note || undefined }).then(
      () => { setEditing(false); setNote(""); void onSaved() },
      (reason: unknown) => setSaveError(reason instanceof Error ? reason.message : "Failed to save label"),
    ).finally(() => setSaving(false))
  }
  return <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-dashed border-border/60 pb-2 text-[11px]">
    <span className="mr-1 font-mono text-muted-foreground">label · {field}</span>
    {(["keep", "cut", "edit"] as const).map((verdict) => <button key={verdict} type="button" disabled={saving} onClick={() => verdict === "edit" ? setEditing((open) => !open) : save(verdict)} className={cn("rounded border px-2 py-1 uppercase tracking-wider transition-colors hover:bg-accent", latest?.verdict === verdict && verdictStyle[verdict])}>{verdict}</button>)}
    {latest && <span className={cn("ml-auto", verdictStyle[latest.verdict])}>saved {latest.verdict}</span>}
    {saveError && <span className="basis-full text-rose-300">{saveError}</span>}
    {editing && <div className="basis-full space-y-2 pt-2"><Textarea value={edited} onChange={(event) => setEdited(event.target.value)} rows={3} /><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note" rows={2} /><Button size="xs" onClick={() => save("edit")} disabled={saving}>{saving ? "Saving…" : "Save edit"}</Button></div>}
  </div>
}

function highlightSource(sentence: string, quote: string): React.JSX.Element | string {
  if (!quote) return sentence
  const index = sentence.indexOf(quote)
  if (index < 0) return sentence
  return <>{sentence.slice(0, index)}<mark className="rounded bg-primary/20 px-0.5 text-foreground">{quote}</mark>{sentence.slice(index + quote.length)}</>
}

type Coverage = "known" | "target" | "unknown" | "normal"

function colorSentence(sentence: string, target: string, knownWords: string[]): React.JSX.Element {
  const tokens: Array<{ text: string; coverage: Coverage }> = []
  const sortedKnown = [...knownWords].sort((left, right) => right.length - left.length)
  let index = 0
  while (index < sentence.length) {
    if (target && sentence.startsWith(target, index)) {
      tokens.push({ text: target, coverage: "target" })
      index += target.length
      continue
    }
    const known = sortedKnown.find((word) => word.length > 0 && sentence.startsWith(word, index))
    if (known) {
      tokens.push({ text: known, coverage: "known" })
      index += known.length
      continue
    }
    const char = sentence[index] ?? ""
    tokens.push({ text: char, coverage: /[\u3400-\u9fff]/u.test(char) ? "unknown" : "normal" })
    index += char.length
  }
  return <>{tokens.map((token, tokenIndex) => <span key={`${token.text}-${tokenIndex}`} className={token.coverage === "target" ? "rounded bg-primary/25 px-0.5 text-primary" : token.coverage === "unknown" ? "rounded bg-amber-500/15 px-0.5 text-amber-200" : token.coverage === "known" ? "text-foreground" : "text-foreground"}>{token.text}</span>)}</>
}
