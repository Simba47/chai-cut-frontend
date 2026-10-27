import sql from '@/lib/db'
import type { CaptionStyle, Overlay, SegmentLocal, TextOverlay } from '@chai-cut/shared'
import { cleanBrandKitData, type BrandKit } from '@/lib/shared/brandKit'
import { cleanBrandOn, type BrandOn } from '@/lib/shared/brandOn'
import { brandChanged, putBrandOn, takeBrandOff, updateBrand, type BrandTarget } from '@/modules/brand/engine'
import { rowsToLocal } from '@/modules/editor/utils'
import { hasColumn } from './clips'

/**
 * The brand engine (modules/brand/engine.ts) on clips that aren't open in the editor (brand kit
 * rebuild, Phase 2, 2026-10-27): the same rules as the editor, run on the server — a clip is read
 * as the editor reads it, the engine changes it, and only what it changed is written back, in one
 * transaction.
 *
 *  - brandClip: a kit put on a clip (or taken off, or swapped): new clips with the default kit,
 *    "Apply brand to all clips" on the clip board
 *  - catchUpClip: a clip whose kit changed since it went on follows it (before an export, so a clip
 *    exported without ever being opened is on-brand)
 *
 * Nothing here is paid for: it's our own database and code.
 */

const err = (message: string, status: number) => Object.assign(new Error(message), { status, expose: true })

/** A kit the user can put on clips (their own, or one shared with them), as the engine takes it; null: none such */
export async function usableKit(userId: string, kitId: string): Promise<BrandKit | null> {
  if (!/^[0-9a-f-]{36}$/i.test(kitId)) return null
  const shares = await sql<{ ok: boolean }[]>`SELECT to_regclass('public.brand_kit_shares') IS NOT NULL AS ok`.catch(() => [])
  const [row] = await (shares[0]?.ok
    ? sql<{ id: string; name: string; data: unknown; user_id: string }[]>`
        SELECT bk.id, bk.name, bk.data, bk.user_id FROM brand_kits bk WHERE bk.id = ${kitId}
          AND (bk.user_id = ${userId} OR EXISTS (SELECT 1 FROM brand_kit_shares s WHERE s.kit_id = bk.id AND s.user_id = ${userId}))`
    : sql<{ id: string; name: string; data: unknown; user_id: string }[]>`SELECT id, name, data, user_id FROM brand_kits WHERE id = ${kitId} AND user_id = ${userId}`
  ).catch(() => [])
  // (a shared kit's logo is its owner's)
  return row ? { id: row.id, name: row.name, data: cleanBrandKitData(row.data, row.user_id) } : null
}

/** A clip as the brand engine takes it, and what the writing back needs */
interface Loaded {
  target: BrandTarget
  brand: BrandOn | null
  userId: string
  /** Its caption style row, if it has one */
  hasStyle: boolean
}

/** A clip read as the editor reads it (app/editor/[clipId]/page.tsx): the parts the brand works on */
async function load(clipId: string): Promise<Loaded | null> {
  const [clip] = await sql<{ id: string; video_id: string; start_ms: number; end_ms: number; user_id: string; brand: unknown }[]>`
    SELECT c.id, c.video_id, c.start_ms, c.end_ms, v.user_id, to_jsonb(c)->'brand' AS brand
    FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}`
  if (!clip) return null
  const [segRows, styles, texts, overlays] = await Promise.all([
    sql`
      SELECT s.*, COALESCE(json_agg(jsonb_build_object('id', cb.id, 'segment_id', cb.segment_id, 'slot_index', cb.slot_index,
        'source_video_id', cb.source_video_id, 'source_offset_ms', cb.source_offset_ms, 'image_path', cb.image_path,
        'box_keyframes', '[]'::jsonb) ORDER BY cb.slot_index) FILTER (WHERE cb.id IS NOT NULL), '[]') AS crop_boxes
      FROM segments s LEFT JOIN crop_boxes cb ON cb.segment_id = s.id
      WHERE s.clip_id = ${clipId} GROUP BY s.id ORDER BY s.sort_order`,
    sql`SELECT * FROM caption_styles WHERE clip_id = ${clipId} LIMIT 1`,
    sql`SELECT * FROM text_overlays WHERE clip_id = ${clipId}`,
    sql`SELECT * FROM overlays WHERE clip_id = ${clipId} ORDER BY z_index`,
  ])
  const segments = rowsToLocal(segRows as never) as SegmentLocal[]
  // Its length on the timeline: its stretch of the video, longer by videos put in between, and by
  // parts played slower (as the editor's page works it out)
  const own = (s: SegmentLocal) => !(s.crop_boxes[0]?.source_video_id && s.crop_boxes[0].source_video_id !== clip.video_id)
  const inserted = segments.filter(s => s.video_offset_ms != null && !String(s.layout).startsWith('frame_') && !own(s))
    .reduce((t, s) => t + Math.max(0, s.end_ms - s.start_ms), 0)
  const slower = segments.filter(s => own(s) && Number(s.speed) > 0 && Number(s.speed) !== 1)
    .reduce((t, s) => t + (s.end_ms - s.start_ms) * (1 - Number(s.speed)), 0)
  const caption = (styles[0] ?? {}) as Partial<CaptionStyle>
  return {
    target: {
      clipId, lengthMs: clip.end_ms - clip.start_ms + inserted + Math.max(0, slower), mainVideoId: clip.video_id,
      overlays: overlays as unknown as Overlay[], texts: texts as unknown as TextOverlay[],
      caption, textCase: caption.uppercase ? 'upper' : 'title', segments,
    },
    brand: cleanBrandOn(clip.brand),
    userId: clip.user_id,
    hasStyle: styles.length > 0,
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
/** The caption style fields the brand can set (and the database has) */
const CAPTION_FIELDS = ['template', 'animation', 'font', 'size', 'color', 'highlight_color', 'uppercase', 'words_per_line'] as const

/** What the engine changed, written back in one transaction: brand logos, text styles, caption style, frames, the brand switch */
async function save(l: Loaded, next: BrandTarget, brand: BrandOn | null) {
  const was = l.target, clipId = was.clipId
  const [hasOpacity, hasTemplate, hasEnabled, hasBrand] = await Promise.all([
    hasColumn('overlays', 'opacity'), hasColumn('caption_styles', 'template'), hasColumn('caption_styles', 'enabled'), hasColumn('clips', 'brand'),
  ])
  const before = new Map(was.overlays.map(o => [o.id, o]))
  const after = new Map(next.overlays.map(o => [o.id, o]))
  const removed = was.overlays.filter(o => !after.has(o.id)).map(o => o.id)
  const added = next.overlays.filter(o => !before.has(o.id))
  const changed = next.overlays.filter(o => before.has(o.id) && !same(o, before.get(o.id)))
  const row = (o: Overlay) => ({
    storage_path: o.storage_path, x: o.x, y: o.y, w: o.w, h: o.h, start_ms: Math.round(o.start_ms), end_ms: Math.round(o.end_ms), z_index: o.z_index,
    ...(hasOpacity ? { opacity: o.opacity ?? null } : {}),
  })
  const texts = next.texts.filter((t, i) => !same([t.font, t.color, t.size], [was.texts[i]?.font, was.texts[i]?.color, was.texts[i]?.size]))
  const fields = CAPTION_FIELDS.filter(k => (k !== 'template' || hasTemplate) && !same(next.caption[k], was.caption[k]))
  const captionPatch = Object.fromEntries(fields.map(k => [k, next.caption[k] ?? null]))
  const frames = next.segments.filter(s => !same(s.frame, was.segments.find(x => x.id === s.id)?.frame))

  await sql.begin(async tx => {
    if (removed.length) await tx`DELETE FROM overlays WHERE id = ANY(${removed}) AND clip_id = ${clipId}`
    if (added.length) {
      await tx`INSERT INTO overlays ${tx(added.map(o => ({
        id: o.id, clip_id: clipId, type: o.type, source_video_id: o.source_video_id, source_offset_ms: o.source_offset_ms, ...row(o),
      })))}`
    }
    for (const o of changed) await tx`UPDATE overlays SET ${tx(row(o))} WHERE id = ${o.id} AND clip_id = ${clipId}`
    for (const t of texts) await tx`UPDATE text_overlays SET font = ${t.font ?? null}, color = ${t.color ?? null}, size = ${t.size ?? null} WHERE id = ${t.id} AND clip_id = ${clipId}`
    if (fields.length) {
      if (l.hasStyle) await tx`UPDATE caption_styles SET ${tx(captionPatch)} WHERE clip_id = ${clipId}`
      // (a clip with no caption style yet: one in the brand's look — captions stay off until switched on: they cost money)
      else await tx`INSERT INTO caption_styles ${tx({ clip_id: clipId, position: 'bottom-center', ...captionPatch, ...(hasEnabled ? { enabled: false } : {}) })}`
    }
    for (const s of frames) await tx`UPDATE segments SET frame = ${s.frame ? tx.json(s.frame as never) : null} WHERE id = ${s.id} AND clip_id = ${clipId}`
    if (hasBrand) await tx`UPDATE clips SET brand = ${brand ? tx.json(brand as never) : null} WHERE id = ${clipId}`
  })
}

/**
 * A kit put on a clip (`kitId`), or the brand taken off (`null`): a kit on before comes off first,
 * putting back what it changed. The clip must be the user's; the kit theirs or shared with them.
 * Returns whether the clip has a brand on now.
 */
export async function brandClip(userId: string, clipId: string, kitId: string | null): Promise<boolean> {
  const l = await load(clipId)
  if (!l) throw err('Clip not found', 404)
  if (l.userId !== userId) throw err('Clip not found', 404)
  const kit = kitId ? await usableKit(userId, kitId) : null
  if (kitId && !kit) throw err('That brand kit isn’t yours to use', 403)
  if (kit && l.brand?.kit_id === kit.id) return true
  let t = l.target
  if (l.brand) {
    // (the kit on now, else — deleted since — as it was when it went on)
    const old = (await usableKit(userId, l.brand.kit_id))?.data ?? l.brand.applied ?? null
    t = takeBrandOff(t, old, l.brand.before)
  }
  if (!kit) {
    await save(l, t, null)
    return false
  }
  const r = putBrandOn(t, kit)
  await save(l, r.target, { kit_id: kit.id, before: r.before, applied: kit.data })
  return true
}

/**
 * A clip whose kit changed since it went on follows it (updateBrand), as the editor does when it's
 * opened. A clip branded before the kit's version was kept takes the kit as it is now, as where it
 * starts from. Never fails the caller: a problem is only logged.
 */
export async function catchUpClip(clipId: string): Promise<void> {
  try {
    const l = await load(clipId)
    if (!l?.brand) return
    const kit = await usableKit(l.userId, l.brand.kit_id)
    if (!kit) return
    if (!l.brand.applied) { await save(l, l.target, { ...l.brand, applied: kit.data }); return }
    if (!brandChanged(l.brand.applied, kit.data)) return
    await save(l, updateBrand(l.target, l.brand.applied, kit), { ...l.brand, applied: kit.data })
  } catch (e) {
    console.error('[brand] a clip could not follow its kit:', e)
  }
}

/** The brand kit on one of the user's clips, as saved (null: none) */
export async function clipKit(userId: string, clipId: string): Promise<string | null> {
  if (!(await hasColumn('clips', 'brand'))) return null
  const [row] = await sql<{ kit: string | null }[]>`
    SELECT c.brand->>'kit_id' AS kit FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId} AND v.user_id = ${userId}`
  if (!row) throw err('Clip not found', 404)
  return row.kit
}

/** The clips of one of the user's videos, each with its brand kit (null: none), for the clip board */
export async function clipBrands(userId: string, videoId: string): Promise<Record<string, string | null>> {
  if (!(await hasColumn('clips', 'brand'))) return {}
  const rows = await sql<{ id: string; kit: string | null }[]>`
    SELECT c.id, c.brand->>'kit_id' AS kit FROM clips c JOIN videos v ON v.id = c.video_id
    WHERE c.video_id = ${videoId} AND v.user_id = ${userId}`
  return Object.fromEntries(rows.map(r => [r.id, r.kit]))
}

/**
 * "Apply brand to all clips" (the clip board): a kit on every clip of a video (or the brand off
 * them all, `null`). Clips being exported are left alone. Returns how many changed.
 */
export async function brandVideoClips(userId: string, videoId: string, kitId: string | null): Promise<{ changed: number; skipped: number }> {
  const rows = await sql<{ id: string; status: string }[]>`
    SELECT c.id, c.status FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.video_id = ${videoId} AND v.user_id = ${userId}`
  if (kitId && !(await usableKit(userId, kitId))) throw err('That brand kit isn’t yours to use', 403)
  let changed = 0, skipped = 0
  for (const r of rows) {
    if (r.status === 'rendering') { skipped++; continue }
    try { await brandClip(userId, r.id, kitId); changed++ } catch (e) {
      skipped++
      console.error('[brand] a clip could not be branded:', e)
    }
  }
  return { changed, skipped }
}

