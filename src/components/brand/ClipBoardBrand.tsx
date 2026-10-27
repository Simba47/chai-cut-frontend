'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The brand on the clip board (brand kit rebuild, Phase 2, 2026-10-27): which kit each clip has (a
 * tag on its card), and "Put on all clips" — one kit on every clip of the video, or the brand off
 * them all (the server's brand engine: services/brandApply.ts). Kept apart from the clip board
 * itself (ClipPickerShell.tsx), which only places these.
 */

interface KitLite { id: string; name: string; isDefault: boolean; main: string; accent: string }

export interface ClipBrands {
  kits: KitLite[]
  /** The kit on a clip (null: none) */
  kitOf: (clipId: string) => KitLite | null
  /** The kit "Put on all" and "+ Brand" use: the one picked, else the default, else the first */
  pick: string
  setPick: (id: string) => void
  branded: number
  /** What's being changed: 'all', or one clip's id */
  busy: string | null
  note: { text: string; bad: boolean } | null
  applyAll: (kitId: string | null) => Promise<void>
  setClip: (clipId: string, kitId: string | null) => Promise<void>
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Something went wrong. Please try again.')
  return body as T
}

/** The user's kits and each clip's kit, read again when the clips change (Make my clips adds some) */
export function useClipBrands(videoId: string, clipIds: string[]): ClipBrands {
  const [kits, setKits] = useState<KitLite[]>([])
  const [of, setOf] = useState<Record<string, string | null>>({})
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const clipsKey = clipIds.join(',')

  const loadClips = useCallback(() => fetch(`/api/videos/${videoId}/brand`).then(r => json<{ clips: Record<string, string | null> }>(r))
    .then(d => setOf(d.clips)).catch(() => { /* tags left as they were */ }), [videoId])
  useEffect(() => {
    fetch('/api/brand-kits').then(r => json<{ kits: Array<{ id: string; name: string; data: { is_default?: boolean; colors: { main: string; accent: string } } }> }>(r))
      .then(d => {
        const ks = d.kits.map(k => ({ id: k.id, name: k.name, isDefault: !!k.data.is_default, main: k.data.colors.main, accent: k.data.colors.accent }))
        setKits(ks)
        setPick(p => (ks.some(k => k.id === p) ? p : (ks.find(k => k.isDefault) ?? ks[0])?.id ?? ''))
      }).catch(() => { /* no kits shown */ })
  }, [])
  useEffect(() => { loadClips() }, [loadClips, clipsKey])

  const kitOf = (clipId: string) => { const id = of[clipId]; return id ? kits.find(k => k.id === id) ?? null : null }
  const branded = clipIds.filter(id => !!of[id]).length

  async function applyAll(kitId: string | null) {
    setBusy('all'); setNote(null)
    try {
      const r = await fetch(`/api/videos/${videoId}/brand`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kit_id: kitId }) })
        .then(res => json<{ changed: number; skipped: number }>(res))
      await loadClips()
      const kit = kits.find(k => k.id === kitId)
      setNote({
        bad: false,
        text: `${kit ? `${kit.name} is on` : 'Brand taken off'} ${r.changed} clip${r.changed === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} being exported left as they are` : ''}`,
      })
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), bad: true })
    } finally { setBusy(null) }
  }
  async function setClip(clipId: string, kitId: string | null) {
    setBusy(clipId); setNote(null)
    try {
      await fetch(`/api/clips/${clipId}/brand`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kit_id: kitId }) })
        .then(res => json<{ on: boolean }>(res))
      setOf(o => ({ ...o, [clipId]: kitId }))
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), bad: true })
    } finally { setBusy(null) }
  }
  return { kits, kitOf, pick, setPick, branded, busy, note, applyAll, setClip }
}

/** Two dots in a kit's colours */
const Dots = ({ k }: { k: Pick<KitLite, 'main' | 'accent'> }) => (
  <span className="cbb-dots" aria-hidden="true"><i style={{ background: k.main }} /><i style={{ background: k.accent }} /></span>
)

/** Above the clips: the kit, "Put on all N clips", how many have one, and "Take off all" */
export function BrandAllBar({ b, total }: { b: ClipBrands; total: number }) {
  if (!total) return null
  if (!b.kits.length) {
    return (
      <div className="cbb-bar">
        <span className="cbb-label">Brand</span>
        <span className="text-[11px] flex-1 min-w-0" style={{ color: 'rgb(var(--cb-fg) / 0.55)' }}>Put your logo, colours and caption look on every clip.</span>
        <a href="/brand" className="cbb-btn">Make a brand kit</a>
      </div>
    )
  }
  const kit = b.kits.find(k => k.id === b.pick) ?? null
  const allOn = !!kit && b.branded === total
  return (
    <div className="flex flex-col gap-1.5">
      <div className="cbb-bar">
        <span className="cbb-label">Brand</span>
        {kit && <Dots k={kit} />}
        <select value={b.pick} onChange={e => b.setPick(e.target.value)} disabled={!!b.busy} aria-label="The brand kit to put on the clips" className="cbb-select">
          {b.kits.map(k => <option key={k.id} value={k.id}>{k.name}{k.isDefault ? ' · default' : ''}</option>)}
        </select>
        <button type="button" className="cbb-btn" data-primary disabled={!!b.busy || !kit} onClick={() => b.applyAll(b.pick)}
          title={allOn ? 'Put it on again: a clip whose kit changed gets the newest version' : `Put ${kit?.name ?? 'this kit'} on all ${total} clips`}>
          {b.busy === 'all' ? 'Working…' : `Put on all ${total}`}
        </button>
      </div>
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10.5px] tabular-nums" style={{ color: 'rgb(var(--cb-fg) / 0.5)' }}>{b.branded} of {total} branded</span>
        {b.branded > 0 && (
          <button type="button" className="text-[10.5px] font-semibold hover:underline" disabled={!!b.busy} onClick={() => b.applyAll(null)}
            style={{ color: 'rgb(var(--cb-fg) / 0.55)' }}>Take off all</button>
        )}
        {b.note && <span role={b.note.bad ? 'alert' : 'status'} className="text-[10.5px] truncate" style={{ color: b.note.bad ? '#f87171' : '#c8ff00' }}>{b.note.text}</span>}
      </div>
    </div>
  )
}

/** On a clip's card: its kit (× takes it off), or "+ Brand" to put the picked kit on */
export function BrandTag({ b, clipId }: { b: ClipBrands; clipId: string }) {
  const kit = b.kitOf(clipId)
  const busy = b.busy === clipId
  if (kit) {
    return (
      <span className="cbb-tag" title={`${kit.name} is on this clip`} onClick={e => e.stopPropagation()}>
        <Dots k={kit} />{busy ? 'Taking off…' : kit.name}
        <button type="button" aria-label={`Take ${kit.name} off this clip`} disabled={!!b.busy} onClick={() => b.setClip(clipId, null)}>×</button>
      </span>
    )
  }
  const pick = b.kits.find(k => k.id === b.pick)
  if (!pick) return null
  return (
    <button type="button" className="cbb-tag" data-add disabled={!!b.busy} title={`Put ${pick.name} on this clip`}
      onClick={e => { e.stopPropagation(); b.setClip(clipId, pick.id) }}>
      {busy ? 'Adding…' : '+ Brand'}
    </button>
  )
}
