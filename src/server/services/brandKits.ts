import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET } from '@/lib/r2'
import sql from '@/lib/db'
import { getUserPlan } from './quota'
import { brandKitLimit, cleanBrandKitData, DEFAULT_BRAND_KIT, isBrandFont, brandFontKey, MAX_KIT_SHARES, SHARE_PLANS, type BrandKit, type BrandKitData } from '@/lib/shared/brandKit'
import { hasColumn } from './clips'
import { pictureColours } from './brandStyle'

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

/**
 * How long a logo's link works: as long as a signed link can (7 days). The editor puts it on the logo
 * it adds to a clip, so a short one (it was 6 hours) left a broken logo in an editor kept open longer.
 */
export const LOGO_LINK_SECONDS = 7 * 24 * 60 * 60

async function signLogo(path: string | null): Promise<string | null> {
  if (!path) return null
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: path }), { expiresIn: LOGO_LINK_SECONDS }).catch(() => null)
}

type Row = { id: string; name: string; data: unknown }
/** A kit as the editor gets it. `ownerId`: whose kit it is (its files are theirs); `sharedBy`: shared with this user by them */
async function toKit(row: Row, ownerId: string, sharedBy: string | null = null): Promise<BrandKit> {
  const data = await usableEnds(cleanBrandKitData(row.data, ownerId), ownerId, sharedBy !== null)
  // (someone else's default is not this user's)
  if (sharedBy !== null) data.is_default = false
  return { id: row.id, name: row.name, data, logo_url: await signLogo(data.logo.path), ...(sharedBy !== null ? { shared_by: sharedBy } : {}) }
}

/**
 * A kit's intro and outro as the user can have them on their clips (brand kit Phase 4): their own
 * videos still in their library. A shared kit's are its owner's videos — a clip can't show another
 * user's video (saveClip refuses it) — so the people it's shared with get none.
 */
export async function usableEnds(data: BrandKitData, ownerId: string, shared: boolean): Promise<BrandKitData> {
  const { intro, outro } = data.ends
  if (!intro && !outro) return data
  const ids = shared ? [] : [intro?.id, outro?.id].filter((x): x is string => !!x)
  const have = new Set(ids.length
    ? (await sql<{ id: string }[]>`SELECT id FROM videos WHERE id = ANY(${ids}) AND user_id = ${ownerId}`.catch(() => [])).map(r => r.id)
    : [])
  const keep = (v: typeof intro) => (v && have.has(v.id) ? v : null)
  return { ...data, ends: { ...data.ends, intro: keep(intro), outro: keep(outro) } }
}

/** Is the sharing table there yet (the backend makes it when it starts)? */
async function sharesReady(): Promise<boolean> {
  const [row] = await sql<{ ok: boolean }[]>`SELECT to_regclass('public.brand_kit_shares') IS NOT NULL AS ok`.catch(() => [])
  return !!row?.ok
}

/**
 * Whether the user can put this kit on their clips: their own, or one shared with them. The one check
 * every place that takes a kit's id uses (Make my clips, saving a clip with its brand switch on).
 */
export async function canUseKit(userId: string, kitId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(kitId)) return false
  const shares = await sharesReady()
  const [row] = await (shares
    ? sql`SELECT 1 FROM brand_kits bk WHERE bk.id = ${kitId}
        AND (bk.user_id = ${userId} OR EXISTS (SELECT 1 FROM brand_kit_shares s WHERE s.kit_id = bk.id AND s.user_id = ${userId}))`
    : sql`SELECT 1 FROM brand_kits WHERE id = ${kitId} AND user_id = ${userId}`).catch(() => [])
  return !!row
}

/**
 * The kit taken off clips that still have it switched on (`ownerId`: only that person's clips; else
 * everyone's): they keep their look — the logo and styles stay as they are — but no longer point at a
 * kit they can't use (the kit deleted, or no longer shared with them), which left the editor's switch
 * stuck on a kit it couldn't find
 */
async function releaseClips(kitId: string, ownerId?: string): Promise<void> {
  if (!(await hasColumn('clips', 'brand'))) return
  await (ownerId
    ? sql`UPDATE clips c SET brand = NULL FROM videos v WHERE v.id = c.video_id AND v.user_id = ${ownerId} AND c.brand->>'kit_id' = ${kitId}`
    : sql`UPDATE clips SET brand = NULL WHERE brand->>'kit_id' = ${kitId}`)
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
  // (their clips with it on keep their look, the kit's switch off)
  await releaseClips(kitId, memberId).catch(e => console.error('[brand] clips not released from a kit no longer shared:', e))
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

/**
 * The default kit put on clips just made — by hand, from Best moments or Ask AI — through the brand
 * engine, as the editor's switch puts it on (brandApply.ts brandClip): its logo, title style, caption
 * look (captions stay off until they're switched on: they cost money) and frames, with the kit's
 * version kept so the clips follow it. `lengthMs` isn't needed any more (the engine reads the clip);
 * kept for the callers. Never fails the clips: a problem is only logged.
 */
export async function brandNewClips(userId: string, clips: Array<{ id: string; lengthMs: number }>): Promise<void> {
  if (!clips.length) return
  try {
    const [row] = await sql<{ id: string }[]>`SELECT id FROM brand_kits WHERE user_id = ${userId} AND (data->>'is_default')::boolean LIMIT 1`.catch(() => [])
    if (!row) return
    const { brandClip } = await import('./brandApply')
    for (const c of clips) await brandClip(userId, c.id, row.id).catch(e => console.error('[brand] the default kit could not be put on a new clip:', e))
  } catch (e) {
    console.error('[brand] the default kit could not be put on new clips:', e)
  }
}

/**
 * The kit goes; its logo file stays (clips it was put on still show it). Every clip with it switched
 * on — the owner's, and those of the people it was shared with — keeps its look, the switch off.
 */
export async function deleteBrandKit(userId: string, kitId: string): Promise<void> {
  await tableReady()
  const rows = await sql`DELETE FROM brand_kits WHERE id = ${kitId} AND user_id = ${userId} RETURNING id`
  if (!rows.length) throw err('Brand kit not found', 404)
  await releaseClips(kitId).catch(e => console.error('[brand] clips not released from a deleted kit:', e))
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

const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MAX_LOGO_BYTES = 5 * 1024 * 1024

/**
 * A logo uploaded for a kit: kept under brand/<user>/ (a PNG keeps its see-through background), with
 * its brand colours read from it (brandStyle.ts pictureColours: on our server, no paid service)
 */
export async function uploadBrandLogo(userId: string, file: File): Promise<{ path: string; url: string | null; colors: { main: string; accent: string | null } | null }> {
  const ext = LOGO_TYPES[file.type]
  if (!ext) throw err('Use a PNG, JPG or WebP picture for the logo', 400)
  if (file.size > MAX_LOGO_BYTES) throw err('The logo can be at most 5 MB', 400)
  const path = `brand/${userId}/${crypto.randomUUID()}.${ext}`
  const body = Buffer.from(await file.arrayBuffer())
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: path, Body: body, ContentType: file.type }))
  const [url, colors] = await Promise.all([signLogo(path), pictureColours(body)])
  return { path, url, colors }
}
