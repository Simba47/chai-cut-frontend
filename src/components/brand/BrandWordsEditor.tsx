'use client'

import { useEffect, useMemo, useState } from 'react'
import { Section, Switch } from '@/components/editor/BrandKit'
import {
  brandCaptionWords, brandHashtags, cleanBrandWords, LINE_MAX, MAX_HASHTAGS, MAX_HEARD, MAX_HIDDEN, MAX_LINES, MAX_SPELLINGS, TONES, WORD_MAX,
  wordKey, type BrandWords,
} from '@/lib/brandWords'

/**
 * A kit's words (brand kit Phase 5, lib/brandWords.ts), the Words step of its workshop: names spelled the
 * brand's way, words it hides, its tone, its lines and hashtags. Each change is saved as it's made
 * (made safe the way the server keeps it).
 */
export function KitWords({ w, onChange }: { w: BrandWords; onChange: (w: BrandWords) => void }) {
  const set = (patch: Partial<BrandWords>) => onChange(cleanBrandWords({ ...w, ...patch }))
  const tone = TONES.find(t => t.id === w.tone) ?? null
  // (lines to start from: the tone's, else the first tone's — those not added yet)
  const ideas = (tone ?? TONES[0]).lines.filter(l => !w.lines.some(x => x.toLowerCase() === l.toLowerCase()))
  return (
    <>
      <Section title="Names, spelled your way">
        <Hint>Your brand, products and people. Captions and post text always spell them like this — even when they&rsquo;re heard split (&ldquo;short cut&rdquo;), in other capitals, or a letter off.</Hint>
        {w.spell.map((s, i) => (
          <div key={wordKey(s.text)} className="flex items-start gap-2">
            <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
              <Field label="Spelled" value={s.text} max={WORD_MAX} placeholder="ShortCut"
                onCommit={text => set({ spell: text.trim() ? w.spell.map((x, j) => (j === i ? { ...x, text } : x)) : w.spell.filter((_, j) => j !== i) })} />
              <Field label="Also heard as" value={s.heard.join(', ')} max={WORD_MAX * MAX_HEARD} placeholder="short cut, shortkut"
                onCommit={v => set({ spell: w.spell.map((x, j) => (j === i ? { ...x, heard: v.split(',').map(h => h.trim()).filter(Boolean) } : x)) })} />
            </div>
            <Remove label={`Remove ${s.text}`} onClick={() => set({ spell: w.spell.filter((_, j) => j !== i) })} />
          </div>
        ))}
        {w.spell.length < MAX_SPELLINGS
          ? <AddRow placeholder={w.spell.length ? 'Add another name' : 'Add a name — e.g. your brand'} max={WORD_MAX}
              onAdd={text => set({ spell: [...w.spell, { text, heard: [] }] })} taken={t => w.spell.some(s => wordKey(s.text) === wordKey(t))} />
          : <Hint>That&rsquo;s {MAX_SPELLINGS} names, the most a kit holds.</Hint>}
      </Section>

      <Section title="Words to hide">
        <Hint>Never shown as they are in captions or post text: they show like d***. Add each form you use (damn, damned).</Hint>
        <Chips items={w.hide} label="Hidden words" onRemove={x => set({ hide: w.hide.filter(h => h !== x) })} />
        {w.hide.length < MAX_HIDDEN && (
          <AddRow placeholder="Add a word or phrase" max={WORD_MAX} onAdd={h => set({ hide: [...w.hide, h] })} taken={t => w.hide.some(h => wordKey(h) === wordKey(t))} />
        )}
      </Section>

      <Section title="Tone">
        <Hint>How the post text written for your clips sounds, and the lines below start from it.</Hint>
        <div role="radiogroup" aria-label="Your brand’s tone" className="flex flex-wrap gap-1.5">
          {[{ id: null, name: 'None' }, ...TONES].map(t => (
            <button key={t.id ?? 'none'} type="button" role="radio" aria-checked={w.tone === t.id} onClick={() => set({ tone: t.id })}
              className="bw-chip" data-on={w.tone === t.id || undefined}>{t.name}</button>
          ))}
        </div>
      </Section>

      <Section title="Your lines">
        <Hint>Your calls to action. They&rsquo;re one tap away in the editor&rsquo;s Text tool; the main one is what &ldquo;+ Call to action&rdquo; adds.</Hint>
        {w.lines.map((l, i) => (
          <div key={l} className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Field label={i === 0 ? 'Main line' : `Line ${i + 1}`} hideLabel value={l} max={LINE_MAX} placeholder="Follow for more"
                onCommit={v => set({ lines: v.trim() ? w.lines.map((x, j) => (j === i ? v : x)) : w.lines.filter((_, j) => j !== i) })} />
            </div>
            <span className="shrink-0 w-[72px] flex justify-center">
              {i === 0
                ? <span className="bw-main">Main</span>
                : <button type="button" className="bw-link" onClick={() => set({ lines: [l, ...w.lines.filter((_, j) => j !== i)] })}>Make main</button>}
            </span>
            <Remove label={`Remove “${l}”`} onClick={() => set({ lines: w.lines.filter((_, j) => j !== i) })} />
          </div>
        ))}
        {w.lines.length < MAX_LINES && (
          <>
            <AddRow placeholder={w.lines.length ? 'Add another line' : 'Add a line — e.g. Follow for more'} max={LINE_MAX}
              onAdd={l => set({ lines: [...w.lines, l] })} taken={t => w.lines.some(l => l.toLowerCase() === t.toLowerCase())} />
            {ideas.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{tone ? `${tone.name} lines to start from` : 'Lines to start from'}</span>
                <div className="flex flex-wrap gap-1.5">
                  {ideas.slice(0, MAX_LINES - w.lines.length).map(l => (
                    <button key={l} type="button" className="bw-chip" onClick={() => set({ lines: [...w.lines, l] })}>+ {l}</button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        <label className="cap-row cursor-pointer select-none">
          <span className="flex flex-col min-w-0">
            <span className="cap-label">End post captions with it</span>
            <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
              {w.lines[0] ? `Post text written for your clips ends with “${w.lines[0]}”` : 'Add a line first'}
            </span>
          </span>
          <Switch on={w.end_posts && !!w.lines[0]} label="End post captions with your main line" onChange={end_posts => set({ end_posts })} />
        </label>
      </Section>

      <Section title="Hashtags">
        <Hint>On every post written for your clips, before the ones picked for the clip.</Hint>
        <Chips items={w.hashtags.map(h => `#${h}`)} label="Your hashtags" onRemove={x => set({ hashtags: w.hashtags.filter(h => `#${h}` !== x) })} />
        {w.hashtags.length < MAX_HASHTAGS && (
          <AddRow placeholder="#yourbrand" max={WORD_MAX + 1} onAdd={h => set({ hashtags: [...w.hashtags, h] })}
            taken={t => w.hashtags.some(h => h.toLowerCase() === t.replace(/^#+/, '').replace(/\s+/g, '').toLowerCase())} />
        )}
      </Section>
    </>
  )
}

/** Try the words out: a sentence as captions show it, and how a post ends (the workshop's preview, Words step) */
export function WordsPreview({ w }: { w: BrandWords }) {
  const sample = useMemo(() => {
    const name = w.spell[0], heard = name?.heard[0] ?? name?.text.toLowerCase().replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    return [heard ? `we made this in ${heard.toLowerCase()}` : 'type what someone says', w.hide[0] ? `${w.hide[0]} it's good` : ''].filter(Boolean).join(', ')
  }, [w.spell, w.hide])
  const [said, setSaid] = useState(sample)
  const [touched, setTouched] = useState(false)
  useEffect(() => { if (!touched) setSaid(sample) }, [sample, touched])
  const shown = useMemo(() => {
    let t = 0
    const rows = said.split(/\s+/).filter(Boolean).map(word => { const r = { word, start_ms: t, end_ms: t + 300 }; t += 320; return r })
    return brandCaptionWords(rows, w).map(r => r.word).join(' ')
  }, [said, w])
  const tags = brandHashtags([], w)
  return (
    <div className="flex flex-col gap-3 w-[212px]">
      <span className="cap-heading">Try it</span>
      <label className="flex flex-col gap-1">
        <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>What&rsquo;s said</span>
        <textarea value={said} onChange={e => { setTouched(true); setSaid(e.target.value) }} rows={3} maxLength={200} aria-label="What’s said"
          className="px-2.5 py-2 rounded-lg text-xs text-[var(--ed-text)] outline-none resize-none"
          style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Captions show</span>
        <p className="px-2.5 py-2 rounded-lg text-[13px] font-bold leading-snug text-center break-words" style={{ background: '#0a0a0a', color: '#fff' }}>{shown || ' '}</p>
      </div>
      {(tags.length > 0 || (w.end_posts && w.lines[0])) && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Every post ends</span>
          <p className="px-2.5 py-2 rounded-lg text-[11.5px] leading-relaxed break-words whitespace-pre-line" style={{ background: 'rgb(var(--ed-fg) / 0.05)', color: 'rgb(var(--ed-fg) / 0.8)' }}>
            {[w.end_posts ? w.lines[0] : '', tags.map(h => `#${h}`).join(' ')].filter(Boolean).join('\n')}
          </p>
        </div>
      )}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] -mt-1 leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{children}</p>
}

const inputStyle = { background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }

/** A text field typed freely and saved when left (or on Enter) */
function Field({ label, hideLabel = false, value, max, placeholder, onCommit }: {
  label: string; hideLabel?: boolean; value: string; max: number; placeholder: string; onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <label className="flex flex-col gap-1 min-w-0">
      {!hideLabel && <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{label}</span>}
      <input value={draft} maxLength={max} placeholder={placeholder} aria-label={label}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onCommit(draft) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur() } }}
        className="h-9 px-3 rounded-lg text-sm text-[var(--ed-text)] outline-none min-w-0" style={inputStyle} />
    </label>
  )
}

/** A field and Add button for one more item; says so when it's there already */
function AddRow({ placeholder, max, onAdd, taken }: { placeholder: string; max: number; onAdd: (v: string) => void; taken: (v: string) => boolean }) {
  const [v, setV] = useState('')
  const value = v.replace(/\s+/g, ' ').trim()
  const dup = !!value && taken(value)
  const add = () => { if (!value || dup) return; onAdd(value); setV('') }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input value={v} maxLength={max} placeholder={placeholder} aria-label={placeholder}
          onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          className="flex-1 min-w-0 h-9 px-3 rounded-lg text-sm text-[var(--ed-text)] outline-none" style={inputStyle} />
        <button type="button" onClick={add} disabled={!value || dup} className="bw-add">Add</button>
      </div>
      {dup && <span role="status" className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>It&rsquo;s there already.</span>}
    </div>
  )
}

function Chips({ items, label, onRemove }: { items: string[]; label: string; onRemove: (item: string) => void }) {
  if (!items.length) return null
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5 m-0 p-0 list-none">
      {items.map(x => (
        <li key={x} className="bw-tag">
          <span className="truncate">{x}</span>
          <button type="button" aria-label={`Remove ${x}`} onClick={() => onRemove(x)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Remove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className="shrink-0 w-8 h-9 flex items-center justify-center rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)] self-end" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  )
}
