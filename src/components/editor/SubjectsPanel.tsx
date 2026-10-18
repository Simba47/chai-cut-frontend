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
// The panel asks "Who is in this clip?": the people of the camera angle (scene) at the playhead as faces
// to tap, with a strip of the other scenes to go through so none is missed (a scene's shot, and everywhere
// it comes back). A scene left as it is isn't lost: the view there follows whoever is talking, as everywhere.
// Group shots are folded away (optional); one button at the bottom, Follow them in the clip, does the rest.

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
  const [groupOpen, setGroupOpen] = useState(false)
  const busy = p.subjects.some(s => s.status === 'queued' || s.status === 'running')
  /** Marked but not looked for yet (or the last try failed): Follow takes them */
  const waiting = p.subjects.filter(s => s.status === 'new' || s.status === 'failed').length
  const tracked = p.subjects.filter(s => s.status === 'done')
  // The angles with people are the ones to go through; with none found the buttons alone do the marking
  const withPeople = p.angles.items.filter(a => a.people > 0)
  const listed = p.angles.status === 'done' && withPeople.length > 0
  const set = withPeople.filter(a => a.set).length
  // The scene shown: the one at the playhead, else the first one not set yet
  const atPlayhead = p.angles.now !== null ? p.angles.items[p.angles.now] : undefined
  const cur = atPlayhead && atPlayhead.people > 0 ? atPlayhead : (withPeople.find(a => !a.set) ?? withPeople[0])
  const curAt = cur ? p.angles.items.indexOf(cur) : -1
  const curNo = cur ? withPeople.indexOf(cur) + 1 : 0
  const scanPct = Math.max(5, p.angles.progress)
  const skeleton = (
    <div className="flex flex-wrap gap-3" aria-hidden="true">
      {[0, 1, 2, 3].map(i => <span key={i} className="w-11 h-11 rounded-full animate-pulse motion-reduce:animate-none" style={{ background: 'rgb(var(--ed-fg) / 0.07)' }} />)}
    </div>
  )
  /** The small link under the faces: someone the list doesn't show */
  const missing = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} aria-pressed={p.marking} className="self-start text-left text-[11.5px] underline underline-offset-2 hover:text-[var(--ed-text)]"
      style={{ color: p.marking ? 'var(--ed-accent-text)' : muted }}>
      {p.marking ? 'Click a person on the video… (Esc to stop)' : label}
    </button>
  )

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-bold text-[var(--ed-text)]">Who is in this clip?</span>
        <span className="text-[11.5px]" style={{ color: muted }}>
          {p.angles.status === 'scanning' ? `Looking for people… ${scanPct}%`
            : listed ? 'Tap everyone the view should follow. Tap each person once.'
            : 'Pick the people the view should follow.'}
        </span>
      </div>

      {p.angles.status === 'scanning' && (
        <>
          <span className="h-1 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ed-fg) / 0.08)' }} role="status" aria-label={`Looking for people ${scanPct}%`}>
            <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${scanPct}%`, background: '#c8ff00' }} />
          </span>
          {skeleton}
        </>
      )}
      {p.angles.status === 'failed' && (
        <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgb(var(--ed-fg) / 0.035)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.06)' }}>
          <span className="text-[11.5px]" style={{ color: muted }}>{p.angles.error ?? 'The people could not be found.'}</span>
          <button type="button" onClick={p.onScanAngles} className="shrink-0 h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.12)]"
            style={{ background: 'rgb(var(--ed-fg) / 0.07)', color: 'var(--ed-text)' }}>Try again</button>
        </div>
      )}
      {p.angles.status === 'done' && !listed && (
        <p className="text-[11.5px]" style={{ color: muted }}>No one was found in this clip. You can still pick people yourself.</p>
      )}

      {listed && cur && (
        <div className="flex flex-col gap-2.5">
          {withPeople.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar" role="group" aria-label="Scenes">
                {withPeople.map((a, n) => (
                  <SceneThumb key={n} angle={a} no={n + 1} current={a === cur} videoUrl={p.videoUrl} onOpen={() => p.onOpenAngle(p.angles.items.indexOf(a))} />
                ))}
              </div>
              <span className="text-[11px] tabular-nums" style={{ color: set === withPeople.length ? 'var(--ed-accent-text)' : muted }}>
                Scene {curNo} of {withPeople.length} · {cur.people === 1 ? '1 person' : `${cur.people} people`} · {set} of {withPeople.length} done
              </span>
            </div>
          )}
          {cur.people >= 2 ? (
            // Several people together are one group: one card, one button (the layout and views are the ones on screen)
            <div className="flex flex-col gap-2.5 rounded-xl p-3" style={{ background: 'rgb(var(--ed-fg) / 0.035)', boxShadow: cur.group ? 'inset 0 0 0 1.5px rgba(200,255,0,0.5)' : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.08)' }}>
              <div className="flex items-center">
                {cur.faces.map((f, k) => <FaceDot key={`${curAt}-${k}`} videoUrl={p.videoUrl} at={cur.at} box={f.box} first={k === 0} />)}
              </div>
              <span className="text-[13px] font-semibold text-[var(--ed-text)]">Group of {cur.people} people</span>
              {cur.group ? (
                <p className="text-[11.5px]" style={{ color: 'var(--ed-accent-text)' }}>Group set: {cur.group.label} · {LAYOUT_NAMES[cur.group.layout] ?? cur.group.layout}</p>
              ) : (
                <>
                  <button type="button" onClick={p.onMarkShot}
                    className="h-9 flex items-center justify-center gap-2 rounded-lg text-[12.5px] font-bold transition-colors hover:bg-[rgba(200,255,0,0.2)]"
                    style={{ background: 'rgba(200,255,0,0.12)', color: 'var(--ed-accent-text)', boxShadow: 'inset 0 0 0 1.5px rgba(200,255,0,0.55)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M2.5 20a5.5 5.5 0 0111 0M10.5 20a5.5 5.5 0 0111 0" />
                    </svg>
                    Mark as group
                  </button>
                  <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>
                    Set the layout and views for this scene first (say Split), then press Mark as group. Every time the clip shows this shot again, it gets the same.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {cur.faces.map((f, k) => <AngleFace key={`${curAt}-${k}`} videoUrl={p.videoUrl} at={cur.at} face={f} onMark={() => p.onMarkFace(curAt, k)} />)}
            </div>
          )}
          {cur.people < 2 && missing('Someone missing? Click them on the video', p.onClickMark)}
          {withPeople.length > 1 && <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>Someone you marked in another scene stays marked. A scene you skip follows whoever is talking.</p>}
        </div>
      )}
      {!listed && p.angles.status !== 'loading' && (
        <div className="flex flex-col gap-1.5">
          {missing('Or put the 9:16 view on a person and mark them', p.onToggleMarking)}
        </div>
      )}

      {p.error && <p role="alert" className="text-xs" style={{ color: '#f87171' }}>{p.error}</p>}

      {/* The people marked */}
      {p.loading && !p.subjects.length ? (
        <p className="text-xs" style={{ color: muted }}>Loading…</p>
      ) : p.subjects.length > 0 && (
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
                {s.status === 'new' && 'Ready to follow'}
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

      {/* A group shot: this shot keeps the format given here, wherever it comes back.
          While scenes are listed the group card of each scene does this; this box is for when none were found */}
      {!listed && <div className="flex flex-col rounded-xl" style={{ background: 'rgb(var(--ed-fg) / 0.035)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.06)' }}>
        <button type="button" onClick={() => setGroupOpen(o => !o)} aria-expanded={groupOpen} className="flex items-center gap-2 px-3 py-2.5 text-left">
          <span className="text-[12.5px] font-semibold text-[var(--ed-text)]">Group shots</span>
          <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>optional</span>
          <svg className="ml-auto shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ color: muted, transform: groupOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {!groupOpen && <span className="px-3 pb-2.5 -mt-1.5 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>Give a shot with several people its own layout.</span>}
        {groupOpen && (
          <div className="flex flex-col gap-2 px-3 pb-3">
            <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>
              Set the format and place the views (say Split: two people on top, one below), then press the button. Every time the clip shows this shot again, it gets the same.
            </p>
            {listed && cur?.group ? (
              <p className="text-[11.5px]" style={{ color: 'var(--ed-accent-text)' }}>This scene is set: {cur.group.label} · {LAYOUT_NAMES[cur.group.layout] ?? cur.group.layout}</p>
            ) : (
              <button type="button" onClick={p.onMarkShot}
                className="h-9 flex items-center justify-center gap-2 rounded-lg text-[12.5px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
                style={{ background: 'rgb(var(--ed-fg) / 0.06)', color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M2.5 20a5.5 5.5 0 0111 0M10.5 20a5.5 5.5 0 0111 0" />
                </svg>
                {listed ? 'Mark this scene as a group' : 'Mark this shot as a group'}
              </button>
            )}
          </div>
        )}
      </div>}

      {/* Everyone is marked: look for them all through the whole clip */}
      <button type="button" onClick={p.onMarkInClip} disabled={busy || waiting === 0}
        className="h-10 flex items-center justify-center gap-2 rounded-lg text-[13px] font-bold transition-opacity disabled:opacity-50"
        style={waiting === 0 ? { background: 'rgba(200,255,0,0.14)', color: 'var(--ed-accent-text)' } : { background: '#c8ff00', color: '#000' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        {waiting > 0 ? `Follow them in the clip (${waiting})` : 'Follow them in the clip'}
      </button>
      {waiting === 0 && !busy && p.subjects.length === 0 && <p className="-mt-1.5 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>Pick at least one person first.</p>}
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

/** One scene (camera angle) in the strip: its picture, ringed in lime when it is the one shown, ticked when set */
function SceneThumb({ angle: a, no, current, videoUrl, onOpen }: { angle: AngleItem; no: number; current: boolean; videoUrl: string | null; onOpen: () => void }) {
  // useFrameAt reads a little after the moment it is given
  const picture = useFrameAt(videoUrl, Math.max(0, a.at - 600))
  return (
    <button type="button" onClick={onOpen} aria-pressed={current} aria-label={`Scene ${no}, ${a.people === 1 ? '1 person' : `${a.people} people`}${a.set ? ', done' : ''}`}
      className="relative shrink-0 w-[60px] h-[34px] rounded-md overflow-hidden"
      style={{ background: 'rgb(var(--ed-fg) / 0.08)', boxShadow: current ? 'inset 0 0 0 2px #c8ff00' : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)', opacity: current ? 1 : 0.8 }}>
      {picture
        // eslint-disable-next-line @next/next/no-img-element
        && <img src={picture} alt="" className="w-full h-full object-cover" />}
      <span className="absolute left-0.5 top-0.5 min-w-[14px] h-[14px] px-1 rounded text-[9.5px] font-bold leading-[14px] text-center" style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}>{no}</span>
      {a.set && (
        <span className="absolute right-0.5 bottom-0.5 w-[14px] h-[14px] rounded-full flex items-center justify-center" style={{ background: '#c8ff00' }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
      )}
    </button>
  )
}

/** One face of a group card: a small round picture, overlapping the one before it */
function FaceDot({ videoUrl, at, box: b, first }: { videoUrl: string | null; at: number; box: AngleItem['faces'][number]['box']; first: boolean }) {
  // A little room around the face
  const x = Math.max(0, b.x - b.w * 0.25), y = Math.max(0, b.y - b.h * 0.3)
  const url = useFaceAt(videoUrl, at, { x, y, w: Math.min(1 - x, b.w * 1.5), h: Math.min(1 - y, b.h * 1.5) })
  return (
    <span className="w-11 h-11 rounded-full overflow-hidden shrink-0" aria-hidden="true"
      style={{ marginLeft: first ? 0 : -8, background: 'rgb(var(--ed-fg) / 0.1)', boxShadow: '0 0 0 2px #111112' }}>
      {url
        // eslint-disable-next-line @next/next/no-img-element
        && <img src={url} alt="" className="w-full h-full object-cover" />}
    </span>
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
