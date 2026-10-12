'use client'

import { useState } from 'react'

// ── Subjects: mark the people, and the view follows them through the clip ─────
// One button: Mark the subject. Clicking a person marks them; tracking starts by itself (everyone
// marked is tracked together), and once it's done every section's view switches between them
// through the whole clip — to whoever is talking. Undo takes it back.

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
}

interface Props {
  subjects: SubjectItem[]
  loading: boolean
  error: string | null
  marking: boolean
  onToggleMarking: () => void
  onRemove: (id: string) => void
  onRename: (id: string, label: string) => void
  /** Jump to where the subject was marked */
  onShowMark: (id: string) => void
  showOnVideo: boolean
  onShowOnVideo: (on: boolean) => void
  /** What the last framing did ("The view switches between A and B…") or why it couldn't */
  notice: string | null
}

const muted = 'rgb(var(--ed-fg) / 0.5)'

export function SubjectsPanel(p: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const busy = p.subjects.some(s => s.status === 'queued' || s.status === 'running' || s.status === 'new')
  const tracked = p.subjects.filter(s => s.status === 'done')

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-[12px] leading-relaxed" style={{ color: muted }}>
        Mark the people in your clip. The view then switches between them through the whole clip by itself — to whoever is talking.
      </p>

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
        Pause where their face can be seen, press Mark the subject, then click on them. Do it once for each person.
      </p>

      {p.error && <p role="alert" className="text-xs" style={{ color: '#f87171' }}>{p.error}</p>}

      {/* The people */}
      {p.loading && !p.subjects.length ? (
        <p className="text-xs" style={{ color: muted }}>Loading…</p>
      ) : p.subjects.length === 0 ? (
        <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>No one marked yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {p.subjects.map(s => (
            <div key={s.id} className="group flex flex-col gap-1 rounded-lg px-2.5 py-2"
              style={{ background: 'rgb(var(--ed-fg) / 0.035)', boxShadow: `inset 3px 0 0 ${s.color}, inset 0 0 0 1px rgb(var(--ed-fg) / 0.06)` }}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold" style={{ background: s.color, color: '#111' }}>
                  {s.label.slice(0, 1).toUpperCase()}
                </span>
                {renaming === s.id ? (
                  <input autoFocus value={name} maxLength={24} onChange={e => setName(e.target.value)}
                    onBlur={() => { if (name.trim() && name.trim() !== s.label) p.onRename(s.id, name.trim()); setRenaming(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }}
                    className="flex-1 min-w-0 h-6 px-1.5 rounded text-[12.5px] outline-none text-[var(--ed-text)]"
                    style={{ background: 'rgb(var(--ed-fg) / 0.08)' }} aria-label="Subject name" />
                ) : (
                  <button type="button" onClick={() => { setRenaming(s.id); setName(s.label) }} title="Rename"
                    className="flex-1 min-w-0 truncate text-left text-[12.5px] font-semibold text-[var(--ed-text)]">{s.label}</button>
                )}
                <button type="button" onClick={() => p.onShowMark(s.id)} title="Go to where they were marked"
                  className="shrink-0 h-6 px-1.5 rounded text-[10.5px] transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]" style={{ color: muted }}>
                  Show
                </button>
                <button type="button" onClick={() => p.onRemove(s.id)} aria-label={`Remove ${s.label}`} title="Remove (the view keeps the framing it has now)"
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-[rgba(239,68,68,0.12)] hover:text-[#f87171]" style={{ color: muted }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
              <span className="text-[11px]" style={{ color: s.status === 'failed' ? '#f87171' : muted }}>
                {(s.status === 'new' || s.status === 'queued') && 'Getting ready to follow them…'}
                {s.status === 'running' && `Following them through the clip… ${Math.max(5, s.progress)}%`}
                {s.status === 'failed' && (s.error ?? 'Could not follow them — remove them and mark them again')}
                {s.status === 'done' && (s.seen === null ? 'Ready' : s.seen < 0.02 ? 'Not seen in this clip' : `Seen in ${Math.round(s.seen * 100)}% of the clip`)}
              </span>
              {s.status === 'running' && (
                <span className="h-1 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ed-fg) / 0.08)' }}>
                  <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(5, s.progress)}%`, background: s.color }} />
                </span>
              )}
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
