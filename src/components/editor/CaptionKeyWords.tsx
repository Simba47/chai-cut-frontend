'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import type { CaptionStyle } from '@chai-cut/shared'
import { useCaptionStore } from '@/modules/captions/store'
import { creatorKeys } from '@/modules/captions/creator'
import type { CaptionTemplate } from '@/modules/captions/templates'

/**
 * Key words for the Creator caption styles: the words they make big, coloured or underlined.
 * AI picks them when a Creator style is first chosen (api/clips/[clipId]/emphasis, saved on the
 * caption style); here the line playing on the preview is shown and a tap makes a word a key word
 * or takes it off. A line with none uses its longest word (shown dashed: "auto").
 */
export function CaptionKeyWords({ style, tpl, onChange }: {
  style: Partial<CaptionStyle>
  tpl: CaptionTemplate
  onChange: (updates: Partial<CaptionStyle>) => void
}) {
  const line = useCaptionStore(s => s.liveLine)
  const { clipId } = useParams<{ clipId?: string }>() ?? {}
  const [asking, setAsking] = useState(false)
  const asked = useRef<string | null>(null)
  const emphasis = style.emphasis ?? null

  // None picked yet: ask AI once for this clip
  useEffect(() => {
    if (emphasis || !clipId || asked.current === clipId) return
    asked.current = clipId
    setAsking(true)
    fetch(`/api/clips/${clipId}/emphasis`, { method: 'POST' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { emphasis?: Record<string, boolean> | null } | null) => {
        // (only if nothing was picked meanwhile)
        if (d?.emphasis && !useCaptionStore.getState().captionStyle.emphasis) onChange({ emphasis: d.emphasis })
      })
      .catch(() => {})
      .finally(() => setAsking(false))
  }, [emphasis, clipId, onChange])

  const words = line ?? []
  const texts = words.map(w => w.word)
  const emph = words.map(w => !!emphasis?.[String(w.start_ms)])
  const auto = words.length ? creatorKeys(texts, emph, tpl.look!, !!emphasis && Object.values(emphasis).some(Boolean)) : new Set<number>()

  const toggle = (start: number, on: boolean) => {
    const next = { ...(emphasis ?? {}) }
    if (on) next[String(start)] = true
    else delete next[String(start)]
    onChange({ emphasis: next })
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="cap-heading">Key words</h3>
        {asking && <span className="cap-value">AI is picking…</span>}
      </div>
      {words.length === 0 ? (
        <p className="text-[11.5px] leading-snug" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
          Play the clip or move the playhead to a caption, then tap its words to make them stand out.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {words.map((w, j) => {
              const picked = emph[j]
              const byLine = !picked && auto.has(j)
              return (
                // (two words can start at the same moment — one spoken word written as two: its place keeps them apart)
                <button key={`${w.start_ms}-${j}`} type="button" aria-pressed={picked}
                  title={picked ? 'Key word: tap to take it off' : byLine ? 'Used as this line’s key word: tap to keep it' : 'Tap to make it a key word'}
                  onClick={() => toggle(w.start_ms, !picked)}
                  className="h-7 rounded-full px-2.5 text-[12px] font-semibold transition-colors"
                  style={picked
                    ? { background: '#c8ff00', color: '#0a0a0a' }
                    : byLine
                      ? { color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1px rgba(200,255,0,0.7)', outline: '1px dashed rgba(200,255,0,0.5)', outlineOffset: -4 }
                      : { background: 'rgb(var(--ed-fg) / 0.05)', color: 'rgb(var(--ed-fg) / 0.75)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.08)' }}>
                  {w.word}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] leading-snug" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
            The caption on the preview now. Lime = key word{tpl.look === 'scribble' ? ' (underlined)' : ''}; a dashed one is picked for you.
          </p>
        </>
      )}
    </section>
  )
}
