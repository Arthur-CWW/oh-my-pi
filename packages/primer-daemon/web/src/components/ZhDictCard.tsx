import { useEffect, useState } from "react"
import type * as React from "react"
import {
  generateZhDictGloss,
  getZhDict,
  type ZhDictGloss,
  type ZhDictResult,
} from "@/api"

export interface ZhDictCardProps {
  word: string
  onQueue?: () => void
  onPriority?: () => void
  showPinyin?: boolean
}

export function ZhDictCard({ word, onQueue, onPriority, showPinyin = true }: ZhDictCardProps): React.JSX.Element {
  const [result, setResult] = useState<ZhDictResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void getZhDict(word)
      .then((next) => {
        if (!cancelled) setResult(next)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "词典暂时不可用")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [word])

  const generate = async (): Promise<void> => {
    setGenerating(true)
    setError(null)
    try {
      const gloss = await generateZhDictGloss(word)
      setResult((current) => (current === null ? current : { ...current, gloss }))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "释义生成失败")
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <div className="w-72 rounded-lg border border-border/70 bg-popover p-3 text-sm text-muted-foreground">查词中…</div>
  if (error !== null && result === null) {
    return <div className="w-72 rounded-lg border border-border/70 bg-popover p-3 text-sm text-destructive">{error}</div>
  }
  if (result === null) return <div className="w-72 rounded-lg border border-border/70 bg-popover p-3 text-sm text-muted-foreground">没有找到这个词。</div>

  return (
    <div className="w-80 rounded-lg border border-border/70 bg-popover p-3 shadow-xl">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-medium">{result.word}</span>
        {showPinyin && result.pinyin !== null && <span className="text-sm text-muted-foreground">{result.pinyin}</span>}
      </div>

      {result.gloss === null ? (
        <button type="button" className="mt-3 rounded border border-border px-2 py-1 text-xs hover:bg-accent" onClick={() => void generate()} disabled={generating}>
          {generating ? "生成中…" : "生成释义"}
        </button>
      ) : (
        <GlossView gloss={result.gloss} />
      )}
      {error !== null && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {result.sentences.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-medium text-muted-foreground">例句</h3>
          <div className="mt-1.5 space-y-1.5">
            {result.sentences.map((sentence) => (
              <div key={`${sentence.source}:${sentence.text}`} className="text-sm leading-relaxed">
                <div>{highlight(sentence.text, result.word)}</div>
                <div className="text-[10px] text-muted-foreground/60">{sentence.source} · {sentence.easeRank}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {result.decomposition.length > 0 && (
        <section className="mt-3 border-t border-border/50 pt-2">
          <h3 className="text-xs font-medium text-muted-foreground">字形拆解</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {result.decomposition.map((entry) => <span key={entry.char} className="rounded bg-muted px-1.5 py-0.5 text-xs">{entry.char} <span className="text-muted-foreground">{entry.components.join(" · ")}</span></span>)}
          </div>
        </section>
      )}

      {(onQueue !== undefined || onPriority !== undefined) && (
        <div className="mt-3 flex gap-2 border-t border-border/50 pt-2">
          {onQueue !== undefined && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onQueue}>加入队列</button>}
          {onPriority !== undefined && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onPriority}>提高优先级</button>}
        </div>
      )}

      <details className="mt-3 border-t border-border/50 pt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">··· en</summary>
        <div className="mt-1 space-y-1">
          {result.en.flatMap((entry) => entry.definitions).map((definition, index) => <div key={`${index}:${definition}`}>{definition}</div>)}
        </div>
      </details>
    </div>
  )
}

function GlossView({ gloss }: { gloss: ZhDictGloss }): React.JSX.Element {
  return (
    <section className="mt-3">
      <p className="text-sm leading-relaxed">{gloss.simpleDef}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {gloss.synonyms.map((synonym) => <span key={`${synonym.relation}:${synonym.word}`} className="rounded-full bg-muted px-2 py-0.5 text-xs">{synonym.relation}：{synonym.word} · {synonym.note}</span>)}
      </div>
      {gloss.registerNote !== null && <p className="mt-1 text-xs text-muted-foreground">{gloss.registerNote}</p>}
    </section>
  )
}

function highlight(text: string, word: string): React.ReactNode {
  const pieces = text.split(word)
  return pieces.flatMap((piece, index) => index === pieces.length - 1 ? [piece] : [piece, <strong key={`${piece}:${index}`} className="font-semibold text-primary">{word}</strong>])
}
