'use client'

import { InfoTip } from '@/components/ui/info-tip'
import { useEffect, useState } from 'react'
import type { SegmentLocal, FrameLayout, FrameItem, FrameSettings, SlotMotion, CornerStyle } from '@chai-cut/shared'
import { FRAME_TEMPLATES, FRAME_LAYOUTS, isFrameLayout, frameLanes, frameOf, cornerGeometry, CORNER_MAX, mainSlotSound } from '@/modules/editor/frames'
import { frameItemColor, FRAME_ITEM_COLORS } from './SegmentTimeline'
import { ItemTimeRange } from './ItemTimeRange'

const ACCENT = '#c8ff00'

type FramePatch = Partial<Pick<FrameSettings, 'main_slots' | 'main_volume' | 'main_muted' | 'main_volumes' | 'main_mutes' | 'main_corners'>>

interface Props {
  /** Every format that uses a frame, in time order */
  frames: SegmentLocal[]
  /** The format under the playhead (null in a Default area) */
  segment: SegmentLocal | null
  /** Range a frame picked in the gallery will cover (the format, or the Default area) */
  targetLabel: string | null
  /** Lock / unlock a frame: nothing in it can be moved, changed or removed while locked */
  onToggleLock?: (segId: string) => void
  currentTimeMs: number
  videoTitles: Record<string, string>
  /** Selected lane item id, or `main:<slot>` */
  selected: string | null
  onApply: (layout: FrameLayout) => void
  /** Go to a frame (seeks to its start) */
  onOpenFrame: (segId: string) => void
  /** Select something in a frame and show it at `atMs` (text opens in the Text tool) */
  onSelectItem: (segId: string, id: string | null, atMs?: number) => void
  onUpdateItem: (segId: string, id: string, patch: Partial<Omit<FrameItem, 'id'>>) => void
  onRemoveItem: (segId: string, id: string) => void
  onUpdateFrame: (segId: string, patch: FramePatch) => void
  /** Swap an item's video or photo through the media picker */
  onReplaceMedia: (segId: string, id: string, kind: 'video' | 'photo') => void
  /** Turn a frame back into a plain Vertical format */
  onRemoveFrame: (segId: string) => void
  /** Take the main video out of a slot */
  onRemoveMain: (segId: string, slot: number) => void
}

const MOTIONS: { id: SlotMotion; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'zoom_in', label: 'Zoom in' }, { id: 'zoom_out', label: 'Zoom out' },
  { id: 'pan_left', label: 'Pan left' }, { id: 'pan_right', label: 'Pan right' },
]

function msToLabel(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Mini diagram of a frame: slots as tinted tiles, bands as dark strips with text lines */
function FrameThumb({ layout }: { layout: FrameLayout }) {
  const tints = ['#60a5fa', '#34d399', '#f472b6']
  return (
    <div className="flex flex-col gap-[2px] p-[3px] rounded-md" style={{ width: 40, height: 71, background: '#050505', border: '1px solid rgb(var(--ed-fg) / 0.12)' }}>
      {FRAME_TEMPLATES[layout].rows.map((r, i) => r.kind === 'band'
        ? (
          <div key={i} className="flex flex-col items-center justify-center gap-[2px]" style={{ flex: r.h }}>
            <span className="block rounded-full" style={{ width: '70%', height: 2, background: 'rgb(255 255 255 / 0.5)' }} />
            <span className="block rounded-full" style={{ width: '45%', height: 2, background: 'rgb(255 255 255 / 0.35)' }} />
          </div>
        ) : r.kind === 'caption' ? (
          // Caption strip: one highlighted line, like a caption
          <div key={i} className="flex items-center justify-center" style={{ flex: r.h }}>
            <span className="block rounded-full" style={{ width: '60%', height: 3, background: '#facc15' }} />
          </div>
        ) : (
          <div key={i} className="rounded-[3px]" style={{ flex: r.h, background: `${tints[r.slot % tints.length]}cc` }} />
        ))}
    </div>
  )
}

const KIND_ICON: Record<'main' | 'video' | 'photo' | 'text' | 'captions', React.ReactNode> = {
  main: <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M10 9l5 3-5 3V9z" /></>,
  video: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M22 8l-6 4 6 4V8z" /></>,
  photo: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>,
  text: <path d="M4 7V4h16v3M9 20h6M12 4v16" />,
  captions: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M7 15h4M13 15h4M7 11h10" /></>,
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
      <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function FramesPanel({
  frames, segment, targetLabel, currentTimeMs, videoTitles, selected, onToggleLock,
  onApply, onOpenFrame, onSelectItem, onUpdateItem, onRemoveItem, onUpdateFrame, onReplaceMedia, onRemoveFrame, onRemoveMain,
}: Props) {
  const current = segment && isFrameLayout(segment.layout) ? segment.layout : null
  // Which frames are opened up; the one under the playhead opens by itself
  const [open, setOpen] = useState<Set<string>>(() => new Set(segment && current ? [segment.id] : []))
  useEffect(() => {
    if (segment && current) setOpen(prev => prev.has(segment.id) ? prev : new Set(prev).add(segment.id))
  }, [segment?.id, current]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="flex flex-col">
      {/* Gallery */}
      <div className="px-3 py-3 flex flex-col gap-2.5" style={{ borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
        {!targetLabel && (
          <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Move the playhead onto a format first.</p>
        )}
        {/* 4 across, 2 rows */}
        <div className="grid grid-cols-4 gap-1.5">
          {FRAME_LAYOUTS.map(id => {
            const t = FRAME_TEMPLATES[id]
            const on = current === id
            return (
              <button key={id} onClick={() => onApply(id)} disabled={!targetLabel} aria-pressed={on} title={t.description}
                className="min-w-0 flex flex-col items-center gap-1 px-0.5 py-1.5 rounded-lg text-center transition-colors disabled:opacity-40 hover:bg-[rgb(var(--ed-fg)/0.05)]"
                style={{ background: on ? 'rgb(var(--ed-fg) / 0.08)' : 'rgb(var(--ed-fg) / 0.02)', boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? ACCENT : 'rgb(var(--ed-fg) / 0.08)'}` }}>
                <FrameThumb layout={id} />
                <span className="w-full text-[9.5px] font-semibold leading-[1.15]" style={{ color: on ? 'var(--ed-text)' : 'rgb(var(--ed-fg) / 0.75)' }}>{t.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Frames in this clip */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="text-xs font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
          {frames.length === 0 ? 'No frames yet' : `${frames.length} frame${frames.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {/* One card per frame, like the sections in Format */}
      <div className="px-3 pb-3 flex flex-col gap-1.5">
        {frames.map((seg, i) => {
          const layout = seg.layout as FrameLayout
          const isActive = seg.id === segment?.id
          const isOpen = open.has(seg.id)
          const f = frameOf(seg)
          const inside = (f.items ?? []).filter(it => it.end_ms > seg.start_ms && it.start_ms < seg.end_ms)
          const count = (kind: FrameItem['kind'], one: string, many: string) => {
            const c = inside.filter(it => it.kind === kind).length
            return c ? [`${c} ${c === 1 ? one : many}`] : []
          }
          const secs = Math.max(0, Math.round((seg.end_ms - seg.start_ms) / 1000))
          const length = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
          const summary = [length, ...count('video', 'video', 'videos'), ...count('photo', 'photo', 'photos'), ...count('text', 'text', 'text')].join(' · ')
          return (
            <div key={seg.id} role="button" tabIndex={0} aria-expanded={isOpen} aria-current={isActive || undefined}
              className="group relative flex flex-col rounded-xl cursor-pointer overflow-hidden transition-[background,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(200,255,0,0.6)]"
              style={{
                background: isActive ? 'linear-gradient(180deg, rgba(200,255,0,0.06), rgba(200,255,0,0.015))' : 'rgb(var(--ed-fg) / 0.03)',
                boxShadow: isActive ? 'inset 0 0 0 1px rgba(200,255,0,0.45), 0 8px 22px -16px rgba(200,255,0,0.5)' : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.07)',
              }}
              onClick={() => { onOpenFrame(seg.id); if (!isOpen) toggle(seg.id) }}
              onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) { onOpenFrame(seg.id); toggle(seg.id) } }}>
              <div className="flex items-start gap-2.5 pl-2.5 pr-1.5 pt-2 pb-1.5">
                {/* A tiny diagram of the frame */}
                <span className="shrink-0 w-8 h-8 mt-px flex items-center justify-center rounded-lg"
                  style={{ background: isActive ? 'rgba(200,255,0,0.1)' : 'rgb(var(--ed-fg) / 0.06)' }}>
                  <span className="flex flex-col gap-[1.5px]" style={{ width: 11, height: 18 }} aria-hidden="true">
                    {FRAME_TEMPLATES[layout].rows.map((r, ri) => (
                      <span key={ri} className="rounded-[1.5px]" style={{
                        flex: r.h,
                        background: r.kind === 'slot' ? (isActive ? '#c8ff00' : '#9ca3af') : 'transparent',
                        boxShadow: r.kind === 'slot' ? undefined : `inset 0 0 0 1px ${isActive ? 'rgba(200,255,0,0.6)' : 'rgba(156,163,175,0.6)'}`,
                      }} />
                    ))}
                  </span>
                </span>
                <div className="flex-1 min-w-0 flex flex-col">
                  {/* Line 1: name · time range */}
                  <div className="flex items-center gap-2 min-w-0 h-6">
                    <span className="text-[13px] font-semibold truncate text-[var(--ed-text)]">{FRAME_TEMPLATES[layout].name}</span>
                    {isActive && <span className="shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: '#c8ff00' }} title="Under the playhead" />}
                    <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                      {msToLabel(seg.start_ms)} – {msToLabel(seg.end_ms)}
                    </span>
                  </div>
                  {/* Line 2: length and what's in it · remove */}
                  <div className="flex items-center gap-1 min-w-0 h-6">
                    <span className="flex-1 min-w-0 truncate text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.42)' }}>{summary}</span>
                    {onToggleLock && (
                      <span className={`shrink-0 flex transition-opacity ${isActive || seg.locked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                        <RowSwitch kind="lock" on={!!seg.locked} onClick={() => onToggleLock(seg.id)}
                          label={seg.locked ? 'Unlock this frame' : 'Lock this frame (nothing in it can be moved, changed or removed)'} />
                      </span>
                    )}
                    <button onClick={e => { e.stopPropagation(); onRemoveFrame(seg.id) }}
                      aria-label={`Remove frame ${i + 1} (it goes back to Vertical)`} title="Remove frame (goes back to Vertical)"
                      className={`shrink-0 w-[22px] h-[22px] flex items-center justify-center rounded-md transition-[opacity,background,color] hover:bg-[rgba(239,68,68,0.12)] hover:text-[#f87171] ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                      style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                    </button>
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); toggle(seg.id) }} aria-label={isOpen ? 'Hide what\u2019s in this frame' : 'Show what\u2019s in this frame'}
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]"
                  style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                  <Chevron open={isOpen} />
                </button>
              </div>
              {isOpen && (
                <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} className="cursor-default">
                  <FrameContents seg={seg} currentTimeMs={currentTimeMs} videoTitles={videoTitles}
                    selected={isActive ? selected : null}
                    onSelectItem={(id, atMs) => onSelectItem(seg.id, id, atMs)}
                    onUpdateItem={(id, patch) => onUpdateItem(seg.id, id, patch)}
                    onRemoveItem={id => onRemoveItem(seg.id, id)}
                    onUpdateFrame={patch => onUpdateFrame(seg.id, patch)}
                    onRemoveMain={slot => onRemoveMain(seg.id, slot)}
                    onReplaceMedia={(id, kind) => onReplaceMedia(seg.id, id, kind)} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Everything in one frame — main video, videos, photos and text — each with its time, opening into its settings */
function FrameContents({ seg, currentTimeMs, videoTitles, selected, onSelectItem, onUpdateItem, onRemoveItem, onUpdateFrame, onRemoveMain, onReplaceMedia }: {
  seg: SegmentLocal
  currentTimeMs: number
  videoTitles: Record<string, string>
  selected: string | null
  onSelectItem: (id: string | null, atMs?: number) => void
  onUpdateItem: (id: string, patch: Partial<Omit<FrameItem, 'id'>>) => void
  onRemoveItem: (id: string) => void
  onUpdateFrame: (patch: FramePatch) => void
  onRemoveMain: (slot: number) => void
  onReplaceMedia: (id: string, kind: 'video' | 'photo') => void
}) {
  const frame = frameOf(seg)
  const lanes = frameLanes(seg.layout as FrameLayout)
  const laneIndex = (lane: FrameItem['lane']) => lanes.findIndex(l => l.lane === lane)
  const laneName = (lane: FrameItem['lane']) => lane === 'band' ? 'Band' : lanes.find(l => l.lane === lane)?.label ?? ''
  const main = frame.main_slots ?? [0]

  type Row = { id: string; icon: keyof typeof KIND_ICON; color: string; name: string; lane: FrameItem['lane']; from: number; to: number; item?: FrameItem }
  const rows: Row[] = [
    ...main.map((slot): Row => ({ id: `main:${slot}`, icon: 'main' as const, color: FRAME_ITEM_COLORS.main, name: 'Main video', lane: slot, from: seg.start_ms, to: seg.end_ms })),
    ...(frame.items ?? [])
      .filter(it => it.end_ms > seg.start_ms && it.start_ms < seg.end_ms)
      .map((it): Row => ({
        id: it.id, item: it, lane: it.lane, color: frameItemColor(it),
        icon: (it.captions ? 'captions' : it.kind) as keyof typeof KIND_ICON,
        name: it.kind === 'video' ? videoTitles[it.source_video_id ?? ''] ?? 'Video'
          : it.kind === 'photo' ? 'Photo'
          : it.captions ? 'Captions' : it.text?.trim() || 'Empty text',
        from: Math.max(it.start_ms, seg.start_ms), to: Math.min(it.end_ms, seg.end_ms),
      })),
  ].sort((a, b) => laneIndex(a.lane) - laneIndex(b.lane) || a.from - b.from || (a.item ? 1 : -1))

  return (
    <div className="mx-2 mb-2 flex flex-col rounded-lg overflow-hidden" style={{ background: 'rgb(var(--ed-fg) / 0.035)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.05)' }}>
      {rows.length === 0 && (
        <p className="text-[11px] px-2.5 py-2" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>Nothing here yet. Add with + on the timeline.</p>
      )}
      {rows.map((r, ri) => {
        const on = r.id === selected
        const isText = r.item?.kind === 'text'
        return (
          <div key={r.id} className="flex flex-col"
            style={{ background: on ? 'rgb(var(--ed-fg) / 0.05)' : undefined, boxShadow: on ? `inset 2px 0 0 ${r.color}` : undefined, borderTop: ri ? '1px solid rgb(var(--ed-fg) / 0.045)' : undefined }}>
            <div className="flex items-center pr-1" style={{ opacity: r.item?.hidden ? 0.55 : 1 }}>
            <button onClick={() => onSelectItem(on && !isText ? null : r.id, r.from)}
              aria-expanded={isText ? undefined : on}
              title={`${isText ? 'Edit in the Text tool · ' : ''}${laneName(r.lane)} · ${msToLabel(r.from)}–${msToLabel(r.to)}`}
              className="flex-1 min-w-0 flex items-center gap-2 h-8 pl-2 pr-1 text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]">
              <span className="w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded-[5px]" style={{ background: `${r.color}24` }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={r.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{KIND_ICON[r.icon]}</svg>
              </span>
              <span className="text-[11.5px] font-medium truncate flex-1 text-[var(--ed-text)]">{r.name}</span>
              <span className="text-[10px] shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.42)' }}>{laneName(r.lane)}</span>
            </button>
              {/* Quick switches, as on the Format cards: show / hide, sound */}
              {r.item && !r.item.captions && (
                <RowSwitch kind="eye" on={!!r.item.hidden} onClick={() => onUpdateItem(r.id, { hidden: !r.item!.hidden })}
                  label={r.item.hidden ? 'Show it again' : 'Hide it (not shown or exported)'} />
              )}
              {r.item?.kind === 'video' && (
                <RowSwitch kind="sound" on={!!r.item.muted} onClick={() => onUpdateItem(r.id, { muted: !r.item!.muted })}
                  label={r.item.muted ? 'Turn its sound back on' : 'Mute it'} />
              )}
              {!r.item && (() => {
                const key = String(r.lane)
                const snd = mainSlotSound(frame, r.lane as number)
                return (
                  <RowSwitch kind="sound" on={snd.muted} label={snd.muted ? 'Turn the main video\u2019s sound back on in this slot' : 'Mute the main video in this slot'}
                    onClick={() => onUpdateFrame({ main_mutes: { ...frame.main_mutes, [key]: !snd.muted }, main_volumes: { ...frame.main_volumes, [key]: snd.volume } })} />
                )
              })()}
              <button onClick={() => onSelectItem(on && !isText ? null : r.id, r.from)} aria-label={isText ? 'Edit in the Text tool' : on ? 'Close its settings' : 'Open its settings'}
                className="shrink-0 w-[22px] h-[22px] flex items-center justify-center rounded-md transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                {isText
                  ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3L7.5 6l-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : <Chevron open={on} />}
              </button>
            </div>

            {on && !isText && (
              <div className="flex flex-col gap-3 px-2.5 pb-3 pt-1">
                {r.item ? (
                  <>
                    {r.item.kind === 'video' && (
                      <>
                        <div className="flex items-center gap-3">
                          <button onClick={() => onReplaceMedia(r.id, 'video')} className="text-[11px] font-medium hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Change video</button>
                          <label className="ml-auto flex items-center gap-1.5 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                            From
                            <input type="number" min={0} step={0.5} aria-label="Where in the video it starts, in seconds"
                              value={Math.round((r.item.source_offset_ms ?? 0) / 100) / 10}
                              onChange={e => onUpdateItem(r.id, { source_offset_ms: Math.max(0, Math.round(Number(e.target.value || 0) * 1000)) })}
                              className="w-14 h-7 px-2 rounded-md text-xs tabular-nums outline-none text-[var(--ed-text)]"
                              style={{ background: 'rgb(var(--ed-fg) / 0.06)', border: '1px solid rgb(var(--ed-fg) / 0.12)' }} />
                            s
                          </label>
                        </div>
                        <Volume volume={r.item.volume ?? 1} muted={!!r.item.muted}
                          onVolume={volume => onUpdateItem(r.id, { volume })} onMuted={muted => onUpdateItem(r.id, { muted })} />
                      </>
                    )}
                    {r.item.kind === 'photo' && (
                      <>
                        <div className="flex items-center gap-2">
                          {/* crossOrigin must match FrameMediaPool's <img> for the same URL (frameMedia.ts) —
                              browsers cache a URL per CORS mode, so a mismatched second request for the same
                              URL fails as a CORS error instead of a fresh fetch. */}
                          {r.item.image_url && <img src={r.item.image_url} alt="" crossOrigin="anonymous" className="w-9 h-9 rounded object-cover shrink-0" />}
                          <button onClick={() => onReplaceMedia(r.id, 'photo')} className="text-[11px] font-medium hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Change photo</button>
                        </div>
                        <Chips title="Motion" options={MOTIONS} value={r.item.motion ?? 'none'} onChange={motion => onUpdateItem(r.id, { motion })} />
                      </>
                    )}
                    <CornerPicker value={r.item.corners} onChange={corners => onUpdateItem(r.id, { corners })} />
                    <ItemTimeRange item={r.item} segment={seg} currentTimeMs={currentTimeMs} onChange={patch => onUpdateItem(r.id, patch)} />
                    <button onClick={() => onRemoveItem(r.id)}
                      className="self-end text-[11px] font-medium hover:underline" style={{ color: '#f87171' }}>Remove</button>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Volume</span>
                      {(() => {
                        // This slot's own sound — other slots showing the main video aren't affected
                        const key = String(r.lane)
                        const snd = mainSlotSound(frame, r.lane as number)
                        return (
                          <Volume volume={snd.volume} muted={snd.muted}
                            onVolume={v => onUpdateFrame({ main_volumes: { ...frame.main_volumes, [key]: v }, main_mutes: { ...frame.main_mutes, [key]: snd.muted } })}
                            onMuted={m => onUpdateFrame({ main_mutes: { ...frame.main_mutes, [key]: m }, main_volumes: { ...frame.main_volumes, [key]: snd.volume } })} />
                        )
                      })()}
                    </div>
                    <CornerPicker value={frame.main_corners?.[String(r.lane)]}
                      onChange={corners => onUpdateFrame({ main_corners: { ...frame.main_corners, [String(r.lane)]: corners } })} />
                    <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                      Framing
                      <InfoTip label="About framing the main video" size={12}>Frame it by dragging its box on the source video. It plays for the whole frame. In the preview you can also move and resize it.</InfoTip>
                    </p>
                    <button onClick={() => onRemoveMain(r.lane as number)}
                      className="self-end text-[11px] font-medium hover:underline" style={{ color: '#f87171' }}>Take it out of this slot</button>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Small switch on a card or row: show / hide, sound, lock. Lit when hidden / muted (red) or locked (lime). */
function RowSwitch({ kind, on, onClick, label }: { kind: 'eye' | 'sound' | 'lock'; on: boolean; onClick: () => void; label: string }) {
  const tint = kind === 'lock' ? 'var(--ed-accent-text)' : '#f87171'
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onClick() }} aria-pressed={on} aria-label={label} title={label}
      className="shrink-0 w-[22px] h-[22px] flex items-center justify-center rounded-md transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
      style={{ color: on ? tint : 'rgb(var(--ed-fg) / 0.45)', background: on ? (kind === 'lock' ? 'rgba(200,255,0,0.12)' : 'rgba(239,68,68,0.12)') : undefined }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {kind === 'eye'
          ? (on ? <><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0112 5c5 0 9 5 9 7a11 11 0 01-2.2 3.2M6.6 6.6C4.4 8 3 10.4 3 12c0 2 4 7 9 7a9.6 9.6 0 004.4-1.1" /><path d="M9.9 9.9a3 3 0 004.2 4.2" /></>
            : <><path d="M3 12c0-2 4-7 9-7s9 5 9 7-4 7-9 7-9-5-9-7z" /><circle cx="12" cy="12" r="3" /></>)
          : kind === 'sound'
            ? (on ? <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></> : <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" /></>)
            : (on ? <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></> : <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 017.6-1.7" /></>)}
      </svg>
    </button>
  )
}

/** The editor's slim slider with a value on the right */
function Slider({ value, max = 100, step = 1, disabled, label, text, onChange }: { value: number; max?: number; step?: number; disabled?: boolean; label: string; text: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2.5">
      <input type="range" min={0} max={max} step={step} value={value} disabled={disabled} aria-label={label}
        onChange={e => onChange(Number(e.target.value))}
        className="ed-zoom-range flex-1 min-w-0 disabled:opacity-40"
        style={{ width: 'auto', '--p': `${(value / max) * 100}%` } as React.CSSProperties} />
      <span className="w-8 shrink-0 text-right text-[11px] tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>{text}</span>
    </div>
  )
}

/** Corners slider (0–100): rounder corners and a wider black border as it goes up; a tiny preview shows the look */
function CornerPicker({ value, onChange }: { value: CornerStyle | string | undefined; onChange: (v: CornerStyle) => void }) {
  const g = cornerGeometry(value)
  const v = g ? Math.round((g.radius / CORNER_MAX.radius) * 100) : 0
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-[11px] font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
        Corners
        <span className="block shrink-0" aria-hidden="true" style={{ width: 22, height: 16, background: '#000', padding: (v / 100) * 3, borderRadius: 2, boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.15)' }}>
          <span className="block w-full h-full" style={{ background: 'rgb(var(--ed-fg) / 0.55)', borderRadius: (v / 100) * 6 }} />
        </span>
      </span>
      <Slider value={v} label="Rounded corners" text={v ? `${v}%` : 'Off'} onChange={onChange} />
    </div>
  )
}

/** Volume slider (mute is the sound switch on the row) */
function Volume({ volume, muted, onVolume }: { volume: number; muted: boolean; onVolume: (v: number) => void; onMuted?: (m: boolean) => void }) {
  return <Slider value={muted ? 0 : Math.round(volume * 100)} step={5} disabled={muted} label="Volume" text={muted ? 'Muted' : `${Math.round(volume * 100)}%`} onChange={v => onVolume(v / 100)} />
}

function Chips<T extends string>({ title, options, value, onChange }: { title: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{title}</span>
      <div className="flex flex-wrap gap-1">
        {options.map(m => {
          const on = value === m.id
          return (
            <button key={m.id} onClick={() => onChange(m.id)} aria-pressed={on}
              className="px-2 h-6 rounded-md text-[11px] transition-colors"
              style={on ? { background: 'rgb(var(--ed-fg) / 0.12)', color: 'var(--ed-text)' } : { color: 'rgb(var(--ed-fg) / 0.55)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
              {m.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
