'use client'

import { useState } from 'react'
import { useFaceAt } from '@/modules/clips/thumbs'

// ── Subjects: mark the people, and the view follows them through the clip ─────
// Mark the subject: the person in the view. Mark the shot: a group subject — the format on screen and
// its views (say Split: two people on top, one below) go wherever the clip shows that camera shot
// again, over following whoever is talking. Marking only adds them to the list; once everyone and
// every group is marked, Mark in the whole clip looks for all of them through the whole clip
// together, and then lays the clip out once: the groups' formats, and everywhere else the view on
// whoever is talking. Undo takes it back.

export interface SubjectItem {
  id: string
  label: string
  color: string
  status: 'new' | 'queued' | 'running' | 'done' | 'failed'
  error: string | null
  progress: number
  /** How much of the clip they are seen in (0–1), once tracked */
  seen: number | null
  /** Tracked before the clip's start or end moved: the new part isn't covered */
  stale: boolean
  /** Their face for the picture on the card: a moment of the video (its own time, ms) and the face's box there */
  face: { ms: number; box: { x: number; y: number; w: number; h: number } } | null
  /** A group subject (a marked shot): its format, and how many times the clip shows the shot (once found) */
  group?: { layout: string; places: number } | null
}

interface Props {
  subjects: SubjectItem[]
  loading: boolean
  error: string | null
  marking: boolean
  onToggleMarking: () => void
  /** Mark the shot on screen, with its format and views, as a group subject */
  onMarkShot: () => void
  /** Everyone and every group is marked: look for them through the whole clip, then lay it out */
  onMarkInClip: () => void
  onRemove: (id: string) => void
  onRename: (id: string, label: string) => void
  /** The video the faces are cut from (for the pictures on the cards) */
  videoUrl: string | null
  showOnVideo: boolean
  onShowOnVideo: (on: boolean) => void
  /** What the last framing did ("The view switches between A and B…") or why it couldn't */
  notice: string | null
}

const muted = 'rgb(var(--ed-fg) / 0.5)'
const LAYOUT_NAMES: Record<string, string> = { vertical: 'Vertical', split: 'Split', trio: 'Trio', spotlight: 'Spotlight', centered: 'Centered', horizontal: 'Horizontal' }

export function SubjectsPanel(p: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const busy = p.subjects.some(s => s.status === 'queued' || s.status === 'running')
  /** Marked but not looked for yet (or the last try failed): Mark in the whole clip takes them */
  const waiting = p.subjects.filter(s => s.status === 'new' || s.status === 'failed').length
  const tracked = p.subjects.filter(s => s.status === 'done')

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* The one button */}
      <button type="button" onClick={p.onToggleMarking} aria-pressed={p.marking}
        className="h-10 flex items-center justify-center gap-2 rounded-lg text-[13px] font-bold transition-[background,box-shadow,opacity]"
        style={p.marking
          ? { background: 'rgba(200,255,0,0.14)', color: 'var(--ed-accent-text)', boxShadow: 'inset 0 0 0 1.5px rgba(200,255,0,0.6)' }
          : { background: '#c8ff00', color: '#000' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
        {p.marking ? 'Click a person on the video… (Esc to stop)' : 'Mark the subject'}
      </button>
      <p className="-mt-1.5 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>
        Put the 9:16 view on a person where their face can be seen, then press Mark the subject. Do it once for each person.
      </p>

      {/* A group subject: this shot keeps the format given here, wherever it comes back */}
      <button type="button" onClick={p.onMarkShot}
        className="h-9 flex items-center justify-center gap-2 rounded-lg text-[12.5px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
        style={{ background: 'rgb(var(--ed-fg) / 0.06)', color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M2.5 20a5.5 5.5 0 0111 0M10.5 20a5.5 5.5 0 0111 0" />
        </svg>
        Mark the shot (group)
      </button>
      <p className="-mt-1.5 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>
        A shot with several people: set its format and views the way you want (say Split, two people on top and one below), then press Mark the shot. Wherever the clip shows this shot again, it gets the same.
      </p>

      {/* Everyone is marked: look for them all through the whole clip */}
      {waiting > 0 && (
        <button type="button" onClick={p.onMarkInClip} disabled={busy}
          className="h-10 flex items-center justify-center gap-2 rounded-lg text-[13px] font-bold transition-opacity disabled:opacity-50"
          style={{ background: '#c8ff00', color: '#000' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          Mark in the whole clip ({waiting})
        </button>
      )}

      {p.error && <p role="alert" className="text-xs" style={{ color: '#f87171' }}>{p.error}</p>}

      {/* The people */}
      {p.loading && !p.subjects.length ? (
        <p className="text-xs" style={{ color: muted }}>Loading…</p>
      ) : p.subjects.length === 0 ? (
        <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>No one marked yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {p.subjects.map(s => (
            <div key={s.id} className="group flex items-center gap-3 rounded-xl px-3 py-3"
              style={{ background: 'rgb(var(--ed-fg) / 0.035)', boxShadow: `inset 3px 0 0 ${s.color}, inset 0 0 0 1px rgb(var(--ed-fg) / 0.06)` }}>
              <Avatar subject={s} videoUrl={p.videoUrl} />
              <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-center gap-2 min-w-0">
                {renaming === s.id ? (
                  <input autoFocus value={name} maxLength={24} onChange={e => setName(e.target.value)}
                    onBlur={() => { if (name.trim() && name.trim() !== s.label) p.onRename(s.id, name.trim()); setRenaming(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }}
                    className="flex-1 min-w-0 h-7 px-1.5 rounded text-[14px] outline-none text-[var(--ed-text)]"
                    style={{ background: 'rgb(var(--ed-fg) / 0.08)' }} aria-label="Subject name" />
                ) : (
                  <button type="button" onClick={() => { setRenaming(s.id); setName(s.label) }} title="Rename"
                    className="flex-1 min-w-0 truncate text-left text-[14px] font-semibold text-[var(--ed-text)]">{s.label}</button>
                )}
                <button type="button" onClick={() => p.onRemove(s.id)} aria-label={`Remove ${s.label}`} title="Remove (the view keeps the framing it has now)"
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-[rgba(239,68,68,0.12)] hover:text-[#f87171]" style={{ color: muted }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
              <span className="text-[11.5px]" style={{ color: s.status === 'failed' ? '#f87171' : muted }}>
                {s.status === 'new' && 'Marked — press Mark in the whole clip when everyone is marked'}
                {s.status === 'queued' && (s.group ? 'Getting ready to find this shot…' : 'Getting ready to follow them…')}
                {s.status === 'running' && `${s.group ? 'Finding this shot in the clip' : 'Following them through the clip'}… ${Math.max(5, s.progress)}%`}
                {s.status === 'failed' && (s.error ?? (s.group ? 'Could not find the shot — remove it and mark it again' : 'Could not follow them — remove them and mark them again'))}
                {s.status === 'done' && (s.group
                  ? `${LAYOUT_NAMES[s.group.layout] ?? s.group.layout} · ${s.group.places === 0 ? 'not found in this clip' : s.group.places === 1 ? 'this shot, once' : `this shot, ${s.group.places} times`}`
                  : s.seen === null ? 'Ready' : s.seen < 0.02 ? 'Not seen in this clip' : `Seen in ${Math.round(s.seen * 100)}% of the clip`)}
              </span>
              {s.status === 'running' && (
                <span className="h-1 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ed-fg) / 0.08)' }}>
                  <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(5, s.progress)}%`, background: s.color }} />
                </span>
              )}
              </div>
            </div>
          ))}
        </div>
      )}
      {busy && <p className="-mt-1 text-[11px]" style={{ color: muted }}>This runs in the background — you can keep editing. The view changes when it's done.</p>}

      {tracked.length > 0 && (
        <label className="flex items-center gap-2 pt-2 text-[11.5px] cursor-pointer select-none" style={{ color: 'var(--ed-text)', borderTop: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
          <input type="checkbox" checked={p.showOnVideo} onChange={e => p.onShowOnVideo(e.target.checked)} className="accent-[#c8ff00]" />
          Show them on the video
        </label>
      )}
      {p.notice && <p role="status" className="text-[11.5px]" style={{ color: 'var(--ed-accent-text)' }}>{p.notice}</p>}
    </div>
  )
}

/** The person's face (cut from the video where they were marked) in their colour's ring; their initial until it's ready */
function Avatar({ subject: s, videoUrl }: { subject: SubjectItem; videoUrl: string | null }) {
  const url = useFaceAt(videoUrl, s.face?.ms ?? null, s.face?.box ?? null)
  return (
    <span className="shrink-0 w-12 h-12 rounded-full overflow-hidden flex items-center justify-center text-[15px] font-bold"
      style={{ background: s.color, color: '#111', boxShadow: `0 0 0 2px ${s.color}, 0 0 0 4px rgb(var(--ed-fg) / 0.06)` }}>
      {url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt={s.label} className="w-full h-full object-cover" />
        : s.label.slice(0, 1).toUpperCase()}
    </span>
  )
}
