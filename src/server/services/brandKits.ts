import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET } from '@/lib/r2'
import sql from '@/lib/db'
import { getUserPlan } from './quota'
import { brandKitLimit, cleanBrandKitData, DEFAULT_BRAND_KIT, brandCaptionStyle, cleanProgressBar, logoBox, logoSpan, isBrandFont, brandFontKey, MAX_KIT_SHARES, SHARE_PLANS, type BrandKit, type BrandKitData } from '@/lib/shared/brandKit'
import { hasColumn } from './clips'
import { uploadMusic, musicUrl } from './music'

/**
 * Brand kits (lib/shared/brandKit.ts): a user's saved looks, kept in brand_kits (the backend creates
 * the table when it starts). How many a user can have depends on their plan.
 */

// (written for the user: shown as it is, a 503 too — lib/api-error.ts)
const err = (message: string, status: number) => Object.assign(new Error(message), { status, expose: true })
const MAX_NAME = 40
const cleanName = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, MAX_NAME) : '')

/** Before the backend has made the table: a clear answer instead of a database error */
async function tableReady() {
  const [row] = await sql<{ ok: boolean }[]>`SELECT to_regclass('public.brand_kits') IS NOT NULL AS ok`
  if (!row?.ok) throw err('Brand kits are being set up — try again in a few minutes.', 503)
}

async function signLogo(path: string | null): Promise<string | null> {
  if (!path) return null
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: path }), { expiresIn: 60 * 60 * 6 }).catch(() => null)
}

type Row = { id: string; name: string; data: unknown }
/** A kit as the editor gets it. `ownerId`: whose kit it is (its files are theirs); `sharedBy`: shared with this user by them */
async function toKit(row: Row, ownerId: string, sharedBy: string | null = null): Promise<BrandKit> {
  const data = cleanBrandKitData(row.data, ownerId)
  // (someone else's default is not this user's)
  if (sharedBy !== null) data.is_default = false
  const sign = (p: string | null | undefined) => (p ? musicUrl(p).catch(() => null) : Promise.resolve(null))
  const [logo_url, music_url, sting_url] = await Promise.all([signLogo(data.logo.path), sign(data.sound.music?.path), sign(data.sound.sting?.path)])
  return { id: row.id, name: row.name, data, logo_url, music_url, sting_url, ...(sharedBy !== null ? { shared_by: sharedBy } : {}) }
}

/** Is the sharing table there yet (the backend makes it when it starts)? */
async function sharesReady(): Promise<boolean> {
  const [row] = await sql<{ ok: boolean }[]>`SELECT to_regclass('public.brand_kit_shares') IS NOT NULL AS ok`.catch(() => [])
  return !!row?.ok
}

/** The user's kits, oldest first, then the kits shared with them, and how many of their own their plan allows */
export async function listBrandKits(userId: string): Promise<{ kits: BrandKit[]; limit: number; plan: string }> {
  await tableReady()
  const [rows, plan, shared] = await Promise.all([
    sql<Row[]>`SELECT id, name, data FROM brand_kits WHERE user_id = ${userId} ORDER BY created_at, id`,
    getUserPlan(userId),
    (async (): Promise<Array<Row & { owner: string; by: string | null }>> => (!(await sharesReady()) ? [] : sql<(Row & { owner: string; by: string | null })[]>`
      SELECT bk.id, bk.name, bk.data, bk.user_id AS owner, COALESCE(NULLIF(u.name, ''), u.email) AS by
      FROM brand_kit_shares s JOIN brand_kits bk ON bk.id = s.kit_id JOIN users u ON u.id = bk.user_id
      WHERE s.user_id = ${userId} ORDER BY s.created_at, bk.id`))(),
  ])
  const kits = await Promise.all([...rows.map(r => toKit(r, userId)), ...shared.map(r => toKit(r, r.owner, r.by ?? 'a teammate'))])
  return { kits, limit: brandKitLimit(plan), plan }
}

// ── Sharing a kit (Agency) ─────────────────────────────────────────────────────
// The owner shares a kit with other Shortcut accounts by their email: they see it in their Brand kit
// tool and on the clip board, and can put it on their clips, not change it. With its brand lock on,
// their editor offers only its colours and fonts (lib/shared/brandKit.ts brandLockOf).

export type KitShare = { user_id: string; name: string | null; email: string | null }

async function ownKit(userId: string, kitId: string) {
  await tableReady()
  const [kit] = await sql<{ id: string }[]>`SELECT id FROM brand_kits WHERE id = ${kitId} AND user_id = ${userId}`
  if (!kit) throw err('Brand kit not found', 404)
}

/** Who the owner's kit is shared with, and whether their plan can share */
export async function listKitShares(userId: string, kitId: string): Promise<{ people: KitShare[]; can_share: boolean }> {
  await ownKit(userId, kitId)
  const plan = await getUserPlan(userId)
  if (!(await sharesReady())) return { people: [], can_share: false }
  const people = await sql<KitShare[]>`
    SELECT u.id AS user_id, u.name, u.email FROM brand_kit_shares s JOIN users u ON u.id = s.user_id
    WHERE s.kit_id = ${kitId} ORDER BY s.created_at`
  return { people, can_share: SHARE_PLANS.includes(plan ?? 'free') }
}

/** The owner shares their kit with the account that has this email */
export async function shareKit(userId: string, kitId: string, email: unknown): Promise<KitShare> {
  await ownKit(userId, kitId)
  if (!SHARE_PLANS.includes((await getUserPlan(userId)) ?? 'free')) throw err('Sharing brand kits with your team is on the Agency plan.', 403)
  if (!(await sharesReady())) throw err('Sharing is being set up — try again in a few minutes.', 503)
  const mail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || mail.length > 200) throw err('Type their email address', 400)
  const [who] = await sql<KitShare[]>`SELECT id AS user_id, name, email FROM users WHERE lower(email) = ${mail} LIMIT 1`
  if (!who) throw err('No Shortcut account uses that email. Ask them to sign up first.', 404)
  if (who.user_id === userId) throw err('That’s you — the kit is already yours.', 400)
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM brand_kit_shares WHERE kit_id = ${kitId}`
  if (n >= MAX_KIT_SHARES) throw err(`A kit can be shared with up to ${MAX_KIT_SHARES} people.`, 403)
  await sql`INSERT INTO brand_kit_shares (kit_id, user_id) VALUES (${kitId}, ${who.user_id}) ON CONFLICT DO NOTHING`
  return who
}

/** Stops sharing: the owner takes someone off, or someone leaves a kit shared with them */
export async function unshareKit(userId: string, kitId: string, memberId: string): Promise<void> {
  await tableReady()
  if (!(await sharesReady())) return
  const [kit] = await sql<{ user_id: string }[]>`SELECT user_id FROM brand_kits WHERE id = ${kitId}`
  if (!kit || (kit.user_id !== userId && memberId !== userId)) throw err('Brand kit not found', 404)
  await sql`DELETE FROM brand_kit_shares WHERE kit_id = ${kitId} AND user_id = ${memberId}`
}

/** A new kit (default settings, or `data`), within the plan's count */
export async function createBrandKit(userId: string, body: { name?: unknown; data?: unknown }): Promise<BrandKit> {
  await tableReady()
  const plan = await getUserPlan(userId)
  const limit = brandKitLimit(plan)
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM brand_kits WHERE user_id = ${userId}`
  if (n >= limit) throw err(`Your plan has room for ${limit} brand kit${limit === 1 ? '' : 's'}. Upgrade for more.`, 403)
  const data: BrandKitData = body.data === undefined ? DEFAULT_BRAND_KIT : cleanBrandKitData(body.data, userId)
  const name = cleanName(body.name) || `Brand kit ${n + 1}`
  const [row] = await sql<Row[]>`
    INSERT INTO brand_kits (user_id, name, data) VALUES (${userId}, ${name}, ${sql.json(data as never)})
    RETURNING id, name, data`
  return toKit(row, userId)
}

export async function updateBrandKit(userId: string, kitId: string, body: { name?: unknown; data?: unknown }): Promise<BrandKit> {
  await tableReady()
  const name = body.name === undefined ? null : cleanName(body.name)
  if (name === '') throw err('Give the kit a name', 400)
  const [cur] = await sql<Row[]>`SELECT id, name, data FROM brand_kits WHERE id = ${kitId} AND user_id = ${userId}`
  if (!cur) throw err('Brand kit not found', 404)
  const data = cleanBrandKitData(body.data === undefined ? cur.data : body.data, userId)
  // The intro and outro: only the user's own videos
  const ends = [data.intro, data.outro].filter((v): v is string => !!v)
  if (ends.length) {
    const own = new Set((await sql`SELECT id FROM videos WHERE id = ANY(${ends}) AND user_id = ${userId}`).map(r => String(r.id)))
    if (data.intro && !own.has(data.intro)) data.intro = null
    if (data.outro && !own.has(data.outro)) data.outro = null
  }
  const row = await sql.begin(async tx => {
    // One default kit per account: marking this one unmarks the others
    if (data.is_default) {
      await tx`UPDATE brand_kits SET data = jsonb_set(data, '{is_default}', 'false'::jsonb), updated_at = now()
        WHERE user_id = ${userId} AND id <> ${kitId} AND (data->>'is_default')::boolean`
    }
    const [r] = await tx<Row[]>`
      UPDATE brand_kits SET name = ${name ?? cur.name}, data = ${tx.json(data as never)}, updated_at = now()
      WHERE id = ${kitId} AND user_id = ${userId}
      RETURNING id, name, data`
    return r
  })
  if (!row) throw err('Brand kit not found', 404)
  return toKit(row, userId)
}

// ── The default kit on new clips ───────────────────────────────────────────────
// A clip made by hand, from Best moments or from Ask AI starts with the account's default kit:
// its logo (where and when the kit says) and, when the kit's captions are on, its caption style —
// captions stay off until they're switched on in the editor (they cost money), then show in the
// kit's style. Make my clips does the same in the worker (its lib/brandKit.ts).

/** The account's default kit, or null (none marked, or the table isn't there yet) */
export async function defaultBrandKit(userId: string): Promise<BrandKitData | null> {
  const [row] = await sql<{ data: unknown }[]>`
    SELECT data FROM brand_kits WHERE user_id = ${userId} AND (data->>'is_default')::boolean LIMIT 1`.catch(() => [])
  return row ? cleanBrandKitData(row.data, userId) : null
}

/** The default kit put on clips just made (their ids and lengths in ms). Never fails the clips: a problem is only logged */
export async function brandNewClips(userId: string, clips: Array<{ id: string; lengthMs: number }>): Promise<void> {
  if (!clips.length) return
  try {
    const kit = await defaultBrandKit(userId)
    if (!kit) return
    const [hasOpacity, hasTemplate, hasEnabled] = await Promise.all([
      hasColumn('overlays', 'opacity'), hasColumn('caption_styles', 'template'), hasColumn('caption_styles', 'enabled'),
    ])
    if (kit.logo.path) {
      const box = logoBox(kit.logo)
      await sql`INSERT INTO overlays ${sql(clips.map(c => {
        const [start, end] = logoSpan(kit.logo, c.lengthMs)
        return {
          clip_id: c.id, type: 'image', storage_path: kit.logo.path, source_video_id: null, source_offset_ms: 0,
          x: box.x, y: box.y, w: box.w, h: box.h, start_ms: start, end_ms: end, z_index: 1,
          ...(hasOpacity ? { opacity: kit.logo.opacity < 0.999 ? kit.logo.opacity : null } : {}),
        }
      }))}`
    }
    if (kit.progress.on && await hasColumn('clips', 'progress_bar')) {
      await sql`UPDATE clips SET progress_bar = ${sql.json(cleanProgressBar(kit.progress) as never)} WHERE id = ANY(${clips.map(c => c.id)})`
    }
    if (kit.captions.on) {
      const style = brandCaptionStyle(kit.captions)
      if (!hasTemplate) delete style.template
      await sql`INSERT INTO caption_styles ${sql(clips.map(c => ({
        clip_id: c.id, position: 'bottom-center', ...style, ...(hasEnabled ? { enabled: false } : {}),
      })))}`
    }
  } catch (e) {
    console.error('[brand] the default kit could not be put on new clips:', e)
  }
}

/** The kit goes; its logo file stays (clips it was put on still show it) */
export async function deleteBrandKit(userId: string, kitId: string): Promise<void> {
  await tableReady()
  const rows = await sql`DELETE FROM brand_kits WHERE id = ${kitId} AND user_id = ${userId} RETURNING id`
  if (!rows.length) throw err('Brand kit not found', 404)
}

const MAX_FONT_BYTES = 10 * 1024 * 1024

/**
 * A font uploaded for a kit: a TrueType or OpenType file (checked by its first bytes, not its name),
 * kept at brand/<user>/fonts/<id>. Its family name for text and captions is "BrandFont-<id>"; its
 * name in the kit is the file's name, which the user can change.
 */
export async function uploadBrandFont(userId: string, file: File): Promise<{ family: string; name: string }> {
  if (file.size > MAX_FONT_BYTES) throw err('A font file can be at most 10 MB', 400)
  const body = Buffer.from(await file.arrayBuffer())
  const sig = body.subarray(0, 4).toString('latin1')
  const otf = sig === 'OTTO'
  if (!(otf || sig === '\x00\x01\x00\x00' || sig === 'true')) throw err('Use a TTF or OTF font file', 400)
  const id = crypto.randomUUID()
  const family = `BrandFont-${id}`
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: brandFontKey(userId, family), Body: body, ContentType: otf ? 'font/otf' : 'font/ttf' }))
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 40) || 'Brand font'
  return { family, name }
}

/** One of the user's own brand fonts, or one of a kit shared with them, for the editor to draw with */
export async function readBrandFont(userId: string, family: string): Promise<{ body: Uint8Array; type: string }> {
  if (!isBrandFont(family)) throw err('Not a brand font', 400)
  let res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: brandFontKey(userId, family) })).catch(() => null)
  if (!res?.Body && await sharesReady()) {
    // A shared kit's font: kept under its owner's folder
    const [kit] = await sql<{ user_id: string }[]>`
      SELECT bk.user_id FROM brand_kit_shares s JOIN brand_kits bk ON bk.id = s.kit_id
      WHERE s.user_id = ${userId} AND bk.data->'fonts' @> ${sql.json([{ family }] as never)} LIMIT 1`
    if (kit) res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: brandFontKey(kit.user_id, family) })).catch(() => null)
  }
  if (!res?.Body) throw err('Font not found', 404)
  return { body: await res.Body.transformToByteArray(), type: res.ContentType ?? 'font/ttf' }
}

/** A sound logo is short: its file at most this big */
const MAX_STING_BYTES = 3 * 1024 * 1024

/**
 * Brand music or a sound logo for a kit: stored like a song added in the editor (audio/<user>/…, so
 * clips play and export it like any song); the kit keeps its path
 */
export async function uploadBrandSound(userId: string, file: File, kind: 'music' | 'sting'): Promise<{ path: string; name: string; url: string }> {
  if (kind === 'sting' && file.size > MAX_STING_BYTES) throw err('A sound logo is a few seconds long: its file can be at most 3 MB', 400)
  const { storage_path, url } = await uploadMusic(userId, file)
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 60) || (kind === 'music' ? 'Brand music' : 'Sound logo')
  return { path: storage_path, name, url }
}

const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MAX_LOGO_BYTES = 5 * 1024 * 1024

/** A logo uploaded for a kit: kept under brand/<user>/ (a PNG keeps its see-through background) */
export async function uploadBrandLogo(userId: string, file: File): Promise<{ path: string; url: string | null }> {
  const ext = LOGO_TYPES[file.type]
  if (!ext) throw err('Use a PNG, JPG or WebP picture for the logo', 400)
  if (file.size > MAX_LOGO_BYTES) throw err('The logo can be at most 5 MB', 400)
  const path = `brand/${userId}/${crypto.randomUUID()}.${ext}`
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: path, Body: Buffer.from(await file.arrayBuffer()), ContentType: file.type }))
  return { path, url: await signLogo(path) }
}
