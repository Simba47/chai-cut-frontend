'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { emojiCss } from '@/modules/editor/emojiFont'

/**
 * Emoji to pick from — the Twemoji drawings the export uses (so what you pick is what downloads).
 * The list (public/emoji/emoji-list.json, Unicode's groups and names, only emoji the font draws)
 * is built with the font by the backend's build_emoji_font.py.
 */

type Group = { g: string; e: [string, string][] }
let listPromise: Promise<Group[]> | null = null
function loadList(): Promise<Group[]> {
  listPromise ??= fetch('/emoji/emoji-list.json').then(r => r.json()).catch(() => { listPromise = null; return [] })
  return listPromise
}

const GROUP_ICON: Record<string, string> = {
  'Smileys & Emotion': '😀', 'People & Body': '👋', 'Animals & Nature': '🐻', 'Food & Drink': '🍔',
  'Travel & Places': '✈️', 'Activities': '⚽', 'Objects': '💡', 'Symbols': '❤️', 'Flags': '🏳️',
}
const RECENT_KEY = 'editor.recentEmoji'
function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[] } catch { return [] }
}
function rememberRecent(e: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...readRecent().filter(x => x !== e)].slice(0, 24))) } catch { /* storage blocked */ }
}

/**
 * The grid: search, a tab per group, recently used first. `keepFocus` stops clicks in it from taking
 * the focus away (a text box being edited stays in edit mode).
 */
export function EmojiGrid({ onPick, height = 260, keepFocus }: { onPick: (emoji: string) => void; height?: number; keepFocus?: boolean }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [tab, setTab] = useState(0)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => { loadList().then(setGroups); setRecent(readRecent()) }, [])
  const font = useMemo(() => emojiCss(), [])

  const q = query.trim().toLowerCase()
  const shown: [string, string][] = q
    ? groups.flatMap(g => g.e).filter(([, name]) => name.toLowerCase().includes(q)).slice(0, 200)
    : groups[tab]?.e ?? []
  const pick = (e: string) => { rememberRecent(e); setRecent(readRecent()); onPick(e) }
  const hold = keepFocus ? (ev: React.MouseEvent) => { if (!(ev.target as HTMLElement).closest('input')) ev.preventDefault() } : undefined

  return (
    <div className="flex flex-col gap-2" onMouseDown={hold}>
      <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search emoji" aria-label="Search emoji"
        className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none text-[var(--ed-text)]"
        style={{ background: 'rgb(var(--ed-fg) / 0.06)', border: '1px solid rgb(var(--ed-fg) / 0.12)' }} />
      {!q && (
        <div role="tablist" aria-label="Emoji groups" className="flex justify-between">
          {groups.map((g, i) => (
            <button key={g.g} type="button" role="tab" aria-selected={tab === i} title={g.g} onClick={() => setTab(i)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-[15px] transition-colors"
              style={{ fontFamily: font, background: tab === i ? 'rgb(var(--ed-fg) / 0.12)' : 'transparent', opacity: tab === i ? 1 : 0.6 }}>
              {GROUP_ICON[g.g] ?? g.e[0]?.[0]}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-y-auto -mr-1 pr-1" style={{ height }}>
        {!q && recent.length > 0 && tab === 0 && (
          <>
            <p className="px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Recently used</p>
            <Cells items={recent.map(e => [e, e] as [string, string])} font={font} onPick={pick} />
            <p className="px-0.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{groups[0]?.g}</p>
          </>
        )}
        {groups.length === 0 ? <p className="text-xs py-6 text-center" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Loading…</p>
          : shown.length === 0 ? <p className="text-xs py-6 text-center" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>No emoji found</p>
          : <Cells items={shown} font={font} onPick={pick} />}
      </div>
      {/* Twemoji is CC-BY 4.0: credited where emoji are picked */}
      <p className="text-[9px]" style={{ color: 'rgb(var(--ed-fg) / 0.35)' }}>
        Emoji: <a href="https://github.com/jdecked/twemoji" target="_blank" rel="noreferrer" className="underline">Twemoji</a>, CC-BY 4.0
      </p>
    </div>
  )
}

function Cells({ items, font, onPick }: { items: [string, string][]; font: string; onPick: (e: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {items.map(([e, name]) => (
        <button key={e} type="button" title={name} aria-label={name} onClick={() => onPick(e)}
          className="aspect-square rounded-md flex items-center justify-center text-[22px] leading-none transition-transform hover:bg-[rgb(var(--ed-fg)/0.1)] active:scale-90"
          style={{ fontFamily: font }}>
          {e}
        </button>
      ))}
    </div>
  )
}

/** A 😊 button opening the grid in a small panel under it; the panel closes on a pick, outside click or Escape */
export function EmojiButton({ onPick, label = 'Add an emoji', keepFocus }: { onPick: (emoji: string) => void; label?: string; keepFocus?: boolean }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const W = 300, H = 380
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - W - 8, r.right - W)),
      top: r.bottom + 6 + H > window.innerHeight ? Math.max(8, r.top - H - 6) : r.bottom + 6,
    })
  }, [open])
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', away); window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <>
      <button ref={btn} type="button" aria-label={label} title={label} aria-expanded={open}
        onMouseDown={keepFocus ? e => e.preventDefault() : undefined} onClick={() => setOpen(o => !o)}
        className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[17px] transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
        style={{ fontFamily: emojiCss(), background: open ? 'rgb(var(--ed-fg) / 0.12)' : 'rgb(var(--ed-fg) / 0.06)' }}>
        😊
      </button>
      {open && pos && createPortal(
        <div ref={panel} role="dialog" aria-label="Emoji" className="fixed z-[200] p-2.5 rounded-xl"
          style={{ left: pos.left, top: pos.top, width: 300, background: 'var(--ed-panel, #161616)', border: '1px solid rgb(var(--ed-fg) / 0.14)', boxShadow: '0 18px 40px -12px rgba(0,0,0,0.7)' }}>
          <EmojiGrid keepFocus={keepFocus} onPick={e => { onPick(e); setOpen(false) }} />
        </div>,
        document.body,
      )}
    </>
  )
}

/** The value with `text` put at the input's cursor (or the end); the cursor moves after it */
export function insertAtCursor(el: HTMLInputElement | HTMLTextAreaElement | null, value: string, text: string): string {
  const start = el?.selectionStart ?? value.length
  const end = el?.selectionEnd ?? value.length
  const next = value.slice(0, start) + text + value.slice(end)
  if (el) requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + text.length, start + text.length) })
  return next
}
