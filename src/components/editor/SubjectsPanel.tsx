'use client'

import { useState } from 'react'
import { useFaceAt, useFrameAt } from '@/modules/clips/thumbs'

// ── Subjects: mark the people, and the view follows them through the clip ─────
// Mark the subject: the person in the view. Mark the shot: a group subject — the format on screen and
// its views (say Split: two people on top, one below) go wherever the clip shows that camera shot
// again, over following whoever is talking. Marking only adds them to the list; once everyone and
// every group is marked, Mark in the whole clip looks for all of them through the whole clip
// together, and then lays the clip out once: the groups' formats, and everywhere else the view on
// whoever is talking. Undo takes it back.
//
// The camera angles: the panel opens with every angle of the clip listed (a shot, and everywhere it
// comes back), so each can be gone through in turn — its people marked by a click on their face, or
// the angle marked as a group — and none is missed. The one at the playhead is open. An angle left
// as it is isn't lost: the view there follows whoever is talking, as everywhere.

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

/** A camera angle of the clip (modules/editor/angles.ts angleRows) */
export interface AngleItem {
  /** How many people it shows; 0: the other shots (no faces, or too short to be an angle) */
  people: number
  /** A moment that shows it (the video's own time, ms): its picture, and the faces there, left to right */
  at: number
  faces: Array<{ box: { x: number; y: number; w: number; h: number }; subject: { label: string; color: string } | null }>
  /** Where the clip shows it (each a stretch of the timeline), and for how long in all */
  shown: unknown[]
  totalMs: number
  /** The group marked on it */
  group: { label: string; layout: string; color: string } | null
  /** Someone in it is marked, or it has a group */
  set: boolean
}

export interface AnglesView {
  /** scanning: the worker is looking for them; unavailable: this worker can't yet (the buttons alone are shown) */
  status: 'loading' | 'scanning' | 'done' | 'failed' | 'unavailable'
  progress: number
  error: string | null
  items: AngleItem[]
  /** The angle at the playhead (its place in items) */
  now: number | null
}

interface Props {
  angles: AnglesView
  /** Go to an angle (the playhead moves to a moment that shows it) */
  onOpenAngle: (index: number) => void
  /** Mark the person whose face this is, in that angle */
  onMarkFace: (index: number, face: number) => void
  /** Mark someone by a click on the video (a face the list doesn't show) */
  onClickMark: () => void
  /** Look for the angles again */
  onScanAngles: () => void
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
/** 75 000 → "1:15" */
const clock = (ms: number) => { const s = Math.max(1, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export function SubjectsPanel(p: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const busy = p.subjects.some(s => s.status === 'queued' || s.status === 'running')
  /** Marked but not looked for yet (or the last try failed): Mark in the whole clip takes them */
  const waiting = p.subjects.filter(s => s.status === 'new' || s.status === 'failed').length
  const tracked = p.subjects.filter(s => s.status === 'done')
  // The angles with people are the ones to go through; with none found the buttons alone do the marking
  const withPeople = p.angles.items.filter(a => a.people > 0)
  const listed = p.angles.status === 'done' && withPeople.length > 0
  const set = withPeople.filter(a => a.set).length

  return (
    <div className="flex flex-col gap-3 p-4">
      {listed ? (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-bold text-[var(--ed-text)]">Camera angles</span>
              <span className="text-[11.5px] tabular-nums" style={{ color: set === withPeople.length ? 'var(--ed-accent-text)' : muted }}>{set} of {withPeople.length} set</span>
            </div>
            <span className="h-1 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ed-fg) / 0.08)' }} aria-hidden="true">
              <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${(set / withPeople.length) * 100}%`, background: '#c8ff00' }} />
            </span>
            <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>
              Go through each angle: click a face to mark that person, or mark the angle as a group. An angle you leave follows whoever is talking.
            </p>
          </div>
          {/* Above the list: what a click in an angle couldn't do is seen without scrolling */}
          {p.error && <p role="alert" className="text-xs" style={{ color: '#f87171' }}>{p.error}</p>}
          <div className="flex flex-col gap-1.5">
            {p.angles.items.map((a, i) => (
              <AngleCard key={i} angle={a} name={a.people > 0 ? `Angle ${withPeople.indexOf(a) + 1}` : 'Other shots'} open={p.angles.now === i}
                videoUrl={p.videoUrl} marking={p.marking}
                onOpen={() => p.onOpenAngle(i)} onMarkFace={k => p.onMarkFace(i, k)} onMarkShot={p.onMarkShot} onClickMark={p.onClickMark} />
            ))}
          </div>
        </>
      ) : (
        <>
      {p.angles.status === 'scanning' && (
        <div className="flex flex-col gap-1.5 rounded-xl px-3 py-2.5" style={{ background: 'rgb(var(--ed-fg) / 0.035)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.06)' }} role="status">
          <span className="text-[12px] font-semibold text-[var(--ed-text)]">Looking for the camera angles… {Math.max(5, p.angles.progress)}%</span>
          <span className="h-1 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ed-fg) / 0.08)' }}>
            <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(5, p.angles.progress)}%`, background: '#c8ff00' }} />
          </span>
          <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>They are listed here when it's done. You can already mark people below.</span>
        </div>
      )}
      {p.angles.status === 'failed' && (
        <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgb(var(--ed-fg) / 0.035)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.06)' }}>
          <span className="text-[11.5px]" style={{ color: muted }}>{p.angles.error ?? 'The camera angles could not be listed.'}</span>
          <button type="button" onClick={p.onScanAngles} className="shrink-0 h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.12)]"
            style={{ background: 'rgb(var(--ed-fg) / 0.07)', color: 'var(--ed-text)' }}>Try again</button>
        </div>
      )}
      {p.angles.status === 'done' && (
        <p className="text-[11.5px]" style={{ color: muted }}>No camera angle with faces was found in this clip. You can still mark people on the video.</p>
      )}
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
        </>
      )}

      {/* Everyone is marked: look for them all through the whole clip */}
      {waiting > 0 && (
        <button type="button" onClick={p.onMarkInClip} disabled={busy}
          className="h-10 flex items-center justify-center gap-2 rounded-lg text-[13px] font-bold transition-opacity disabled:opacity-50"
          style={{ background: '#c8ff00', color: '#000' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          Mark in the whole clip ({waiting})
        </button>
      )}

      {p.error && !listed && <p role="alert" className="text-xs" style={{ color: '#f87171' }}>{p.error}</p>}

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

/**
 * One camera angle: its picture, how many people, how often the clip shows it, and what is set on
 * it. Open (the playhead is on it): the faces in it — a click marks that person — and Mark as group.
 */
function AngleCard({ angle: a, name, open, videoUrl, marking, onOpen, onMarkFace, onMarkShot, onClickMark }: {
  angle: AngleItem; name: string; open: boolean; videoUrl: string | null; marking: boolean
  onOpen: () => void; onMarkFace: (face: number) => void; onMarkShot: () => void; onClickMark: () => void
}) {
  // useFrameAt reads a little after the moment it is given
  const picture = useFrameAt(videoUrl, Math.max(0, a.at - 600))
  const marked = a.faces.flatMap(f => (f.subject ? [f.subject.label] : []))
  const times = a.shown.length === 1 ? 'Shown once' : `Shown ${a.shown.length} times`
  return (
    <div className="rounded-xl overflow-hidden transition-[background,box-shadow]"
      style={{ background: open ? 'rgb(var(--ed-fg) / 0.06)' : 'rgb(var(--ed-fg) / 0.035)', boxShadow: open ? 'inset 0 0 0 1.5px rgba(200,255,0,0.5)' : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.06)' }}>
      <button type="button" onClick={onOpen} aria-expanded={open} className="w-full flex items-center gap-3 p-2.5 text-left">
        <span className="shrink-0 w-[72px] h-[41px] rounded-md overflow-hidden" style={{ background: 'rgb(var(--ed-fg) / 0.08)' }}>
          {picture
            // eslint-disable-next-line @next/next/no-img-element
            && <img src={picture} alt="" className="w-full h-full object-cover" />}
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold text-[var(--ed-text)]">
            {name}{a.people > 0 && <span className="font-normal" style={{ color: muted }}> · {a.people === 1 ? '1 person' : `${a.people} people`}</span>}
          </span>
          <span className="truncate text-[11px] tabular-nums" style={{ color: muted }}>{times} · {clock(a.totalMs)}</span>
          <span className="truncate text-[11px]" style={{ color: a.set ? 'var(--ed-accent-text)' : 'rgb(var(--ed-fg) / 0.4)' }}>
            {a.people === 0 ? 'No faces, or too short — stays as it is'
              : a.group ? `${a.group.label} · ${LAYOUT_NAMES[a.group.layout] ?? a.group.layout}${marked.length ? ` · ${marked.join(', ')}` : ''}`
              : marked.length ? `${marked.join(', ')} marked`
              : 'Not set — follows whoever is talking'}
          </span>
        </span>
        {a.set && (
          <svg className="shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c8ff00" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-label="Set"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        )}
      </button>
      {open && a.people > 0 && (
        <div className="flex flex-col gap-2.5 px-2.5 pb-3">
          <div className="flex flex-wrap gap-3">
            {a.faces.map((f, k) => <AngleFace key={k} videoUrl={videoUrl} at={a.at} face={f} onMark={() => onMarkFace(k)} />)}
          </div>
          <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>
            Click a face to mark that person. Mark each person once — skip anyone you already marked in another angle.{' '}
            <button type="button" onClick={onClickMark} aria-pressed={marking} className="underline underline-offset-2 hover:text-[var(--ed-text)]" style={marking ? { color: 'var(--ed-accent-text)' } : undefined}>
              {marking ? 'Click a person on the video… (Esc to stop)' : 'Someone missing? Click them on the video'}
            </button>
          </p>
          {!a.group && (
            <>
              <button type="button" onClick={onMarkShot}
                className="h-9 flex items-center justify-center gap-2 rounded-lg text-[12.5px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
                style={{ background: 'rgb(var(--ed-fg) / 0.06)', color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M2.5 20a5.5 5.5 0 0111 0M10.5 20a5.5 5.5 0 0111 0" />
                </svg>
                Mark as group
              </button>
              <p className="-mt-1 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>
                To give this angle its own format: pick the format and place its views here (say Split, two people on top and one below), then press Mark as group. It gets the same every time it is shown.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** A face of an angle: marked — in that person's colour, with their name; not yet — a click marks them */
function AngleFace({ videoUrl, at, face: f, onMark }: { videoUrl: string | null; at: number; face: AngleItem['faces'][number]; onMark: () => void }) {
  // A little room around the face
  const b = f.box
  const x = Math.max(0, b.x - b.w * 0.25), y = Math.max(0, b.y - b.h * 0.3)
  const box = { x, y, w: Math.min(1 - x, b.w * 1.5), h: Math.min(1 - y, b.h * 1.5) }
  const url = useFaceAt(videoUrl, at, box)
  const picture = (
    <span className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center text-[15px] font-bold"
      style={f.subject
        ? { background: f.subject.color, color: '#111', boxShadow: `0 0 0 2px ${f.subject.color}` }
        : { background: 'rgb(var(--ed-fg) / 0.08)', color: muted, boxShadow: '0 0 0 1.5px rgb(var(--ed-fg) / 0.25)' }}>
      {url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt="" className="w-full h-full object-cover" />
        : f.subject ? f.subject.label.slice(0, 1).toUpperCase() : '+'}
    </span>
  )
  if (f.subject) {
    return (
      <span className="flex flex-col items-center gap-1 w-12" title={`${f.subject.label} is marked`}>
        {picture}
        <span className="max-w-full truncate text-[10.5px] font-semibold" style={{ color: f.subject.color }}>{f.subject.label}</span>
      </span>
    )
  }
  return (
    <button type="button" onClick={onMark} title="Mark this person" className="group/face flex flex-col items-center gap-1 w-12">
      <span className="rounded-full transition-shadow group-hover/face:shadow-[0_0_0_3px_rgba(200,255,0,0.55)]">{picture}</span>
      <span className="text-[10.5px] font-semibold" style={{ color: 'var(--ed-accent-text)' }}>Mark</span>
    </button>
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
