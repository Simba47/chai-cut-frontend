'use client'

import { Fragment, useEffect, useState } from 'react'
import type { SegmentLocal, FrameLayout, FrameItem, FrameSettings, SlotMotion } from '@chai-cut/shared'
import { FRAME_TEMPLATES, FRAME_LAYOUTS, isFrameLayout, frameLanes, frameOf } from '@/modules/editor/frames'
import { frameItemColor, FRAME_ITEM_COLORS } from './SegmentTimeline'
import { ItemTimeRange } from './ItemTimeRange'

const ACCENT = '#c8ff00'

type FramePatch = Partial<Pick<FrameSettings, 'main_slots' | 'main_volume' | 'main_muted'>>

interface Props {
  /** Every format that uses a frame, in time order */
  frames: SegmentLocal[]
  /** The format under the playhead (null in a Default area) */
  segment: SegmentLocal | null
  /** Range a frame picked in the gallery will cover (the format, or the Default area) */
  targetLabel: string | null
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
    <div className="flex flex-col gap-[2px] p-[3px] rounded-md" style={{ width: 44, height: 78, background: '#050505', border: '1px solid rgb(var(--ed-fg) / 0.12)' }}>
      {FRAME_TEMPLATES[layout].rows.map((r, i) => r.kind === 'band'
        ? (
          <div key={i} className="flex flex-col items-center justify-center gap-[2px]" style={{ flex: r.h }}>
            <span className="block rounded-full" style={{ width: '70%', height: 2, background: 'rgb(255 255 255 / 0.5)' }} />
            <span className="block rounded-full" style={{ width: '45%', height: 2, background: 'rgb(255 255 255 / 0.35)' }} />
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
  frames, segment, targetLabel, currentTimeMs, videoTitles, selected,
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
      <div className="p-4 flex flex-col gap-2.5" style={{ borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
        <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
          {targetLabel ? <>Applies to <span className="tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.8)' }}>{targetLabel}</span></> : 'Move the playhead onto a format first.'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {FRAME_LAYOUTS.map(id => {
            const t = FRAME_TEMPLATES[id]
            const on = current === id
            return (
              <button key={id} onClick={() => onApply(id)} disabled={!targetLabel} aria-pressed={on} title={t.description}
                className="flex flex-col items-center gap-1.5 p-2 rounded-lg text-center transition-colors disabled:opacity-40 hover:bg-[rgb(var(--ed-fg)/0.05)]"
                style={{ background: on ? 'rgb(var(--ed-fg) / 0.08)' : 'rgb(var(--ed-fg) / 0.02)', boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? ACCENT : 'rgb(var(--ed-fg) / 0.08)'}` }}>
                <FrameThumb layout={id} />
                <span className="text-[11px] font-semibold leading-tight" style={{ color: on ? 'var(--ed-text)' : 'rgb(var(--ed-fg) / 0.75)' }}>{t.name}</span>
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
      <div className="px-2 pb-3 flex flex-col gap-0.5">
        {frames.map((seg, i) => {
          const layout = seg.layout as FrameLayout
          const isActive = seg.id === segment?.id
          const isOpen = open.has(seg.id)
          return (
            <Fragment key={seg.id}>
              <div role="button" tabIndex={0} aria-expanded={isOpen} aria-current={isActive || undefined}
                className="group flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg cursor-pointer transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]"
                style={{ background: isActive ? 'rgb(var(--ed-fg) / 0.07)' : undefined }}
                onClick={() => { onOpenFrame(seg.id); if (!isOpen) toggle(seg.id) }}
                onKeyDown={e => { if (e.key === 'Enter') { onOpenFrame(seg.id); toggle(seg.id) } }}>
                <span className="w-5 text-[11px] font-semibold tabular-nums text-center shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.35)' }}>{i + 1}</span>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: FRAME_ITEM_COLORS.main }} />
                <span className="text-xs font-medium tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.85)' }}>{msToLabel(seg.start_ms)} – {msToLabel(seg.end_ms)}</span>
                <span className="text-xs truncate flex-1" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>{FRAME_TEMPLATES[layout].name}</span>
                <button onClick={e => { e.stopPropagation(); onRemoveFrame(seg.id) }}
                  aria-label={`Remove frame ${i + 1} (it goes back to Vertical)`} title="Remove frame (goes back to Vertical)"
                  className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-opacity hover:bg-[rgb(var(--ed-fg)/0.1)] ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                  style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                </button>
                <button onClick={e => { e.stopPropagation(); toggle(seg.id) }} aria-label={isOpen ? 'Hide what\'s in this frame' : 'Show what\'s in this frame'}
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
                  style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                  <Chevron open={isOpen} />
                </button>
              </div>
              {isOpen && (
                <FrameContents seg={seg} currentTimeMs={currentTimeMs} videoTitles={videoTitles}
                  selected={isActive ? selected : null}
                  onSelectItem={(id, atMs) => onSelectItem(seg.id, id, atMs)}
                  onUpdateItem={(id, patch) => onUpdateItem(seg.id, id, patch)}
                  onRemoveItem={id => onRemoveItem(seg.id, id)}
                  onUpdateFrame={patch => onUpdateFrame(seg.id, patch)}
                  onRemoveMain={slot => onRemoveMain(seg.id, slot)}
                  onReplaceMedia={(id, kind) => onReplaceMedia(seg.id, id, kind)} />
              )}
            </Fragment>
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
    <div className="ml-7 mr-1 mb-1.5 flex flex-col gap-1 pl-2.5" style={{ borderLeft: '1px solid rgb(var(--ed-fg) / 0.1)' }}>
      {rows.length === 0 && (
        <p className="text-[11px] py-1.5" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>Nothing here yet. Add with + on the timeline.</p>
      )}
      {rows.map(r => {
        const on = r.id === selected
        const isText = r.item?.kind === 'text'
        return (
          <div key={r.id} className="flex flex-col rounded-lg overflow-hidden"
            style={{ background: on ? 'rgb(var(--ed-fg) / 0.05)' : undefined, boxShadow: on ? `inset 0 0 0 1px ${r.color}88` : undefined }}>
            <button onClick={() => onSelectItem(on && !isText ? null : r.id, r.from)}
              aria-expanded={isText ? undefined : on}
              title={isText ? 'Edit in the Text tool' : undefined}
              className="flex items-center gap-2 h-8 px-2 text-left rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={r.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">{KIND_ICON[r.icon]}</svg>
              <span className="text-xs truncate flex-1" style={{ color: 'rgb(var(--ed-fg) / 0.85)' }}>{r.name}</span>
              <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                {laneName(r.lane)} · {msToLabel(r.from)}–{msToLabel(r.to)}
              </span>
              {isText
                ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}><path d="M4.5 3L7.5 6l-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                : <span className="shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}><Chevron open={on} /></span>}
            </button>

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
                          {r.item.image_url && <img src={r.item.image_url} alt="" className="w-9 h-9 rounded object-cover shrink-0" />}
                          <button onClick={() => onReplaceMedia(r.id, 'photo')} className="text-[11px] font-medium hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Change photo</button>
                        </div>
                        <Chips title="Motion" options={MOTIONS} value={r.item.motion ?? 'none'} onChange={motion => onUpdateItem(r.id, { motion })} />
                      </>
                    )}
                    <ItemTimeRange item={r.item} segment={seg} currentTimeMs={currentTimeMs} onChange={patch => onUpdateItem(r.id, patch)} />
                    <button onClick={() => onRemoveItem(r.id)}
                      className="self-end text-[11px] font-medium hover:underline" style={{ color: '#f87171' }}>Remove</button>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Sound</span>
                      <Volume volume={frame.main_volume ?? 1} muted={!!frame.main_muted}
                        onVolume={main_volume => onUpdateFrame({ main_volume })} onMuted={main_muted => onUpdateFrame({ main_muted })} />
                    </div>
                    <p className="text-[11px] leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                      Frame it by dragging its box on the source video. It plays for the whole frame.
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

function Volume({ volume, muted, onVolume, onMuted }: { volume: number; muted: boolean; onVolume: (v: number) => void; onMuted: (m: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onMuted(!muted)} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}
        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
        style={{ color: muted ? '#f87171' : 'rgb(var(--ed-fg) / 0.7)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          {muted ? <path d="M23 9l-6 6M17 9l6 6" /> : <path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" />}
        </svg>
      </button>
      <input type="range" min={0} max={100} step={5} aria-label="Volume"
        value={Math.round(volume * 100)} disabled={muted}
        onChange={e => onVolume(Number(e.target.value) / 100)}
        className="flex-1 disabled:opacity-40" style={{ accentColor: ACCENT }} />
      <span className="w-8 text-right text-[11px] tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>{muted ? '0' : Math.round(volume * 100)}%</span>
    </div>
  )
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
