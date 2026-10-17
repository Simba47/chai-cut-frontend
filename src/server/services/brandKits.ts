import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET } from '@/lib/r2'
import sql from '@/lib/db'
import { getUserPlan } from './quota'
import { brandKitLimit, cleanBrandKitData, DEFAULT_BRAND_KIT, type BrandKit, type BrandKitData } from '@/lib/shared/brandKit'

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
async function toKit(row: Row, userId: string): Promise<BrandKit> {
  const data = cleanBrandKitData(row.data, userId)
  return { id: row.id, name: row.name, data, logo_url: await signLogo(data.logo.path) }
}

/** The user's kits, oldest first, and how many their plan allows */
export async function listBrandKits(userId: string): Promise<{ kits: BrandKit[]; limit: number; plan: string }> {
  await tableReady()
  const [rows, plan] = await Promise.all([
    sql<Row[]>`SELECT id, name, data FROM brand_kits WHERE user_id = ${userId} ORDER BY created_at, id`,
    getUserPlan(userId),
  ])
  return { kits: await Promise.all(rows.map(r => toKit(r, userId))), limit: brandKitLimit(plan), plan }
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
  const [row] = await sql<Row[]>`
    UPDATE brand_kits SET name = ${name ?? cur.name}, data = ${sql.json(data as never)}, updated_at = now()
    WHERE id = ${kitId} AND user_id = ${userId}
    RETURNING id, name, data`
  if (!row) throw err('Brand kit not found', 404)
  return toKit(row, userId)
}

/** The kit goes; its logo file stays (clips it was put on still show it) */
export async function deleteBrandKit(userId: string, kitId: string): Promise<void> {
  await tableReady()
  const rows = await sql`DELETE FROM brand_kits WHERE id = ${kitId} AND user_id = ${userId} RETURNING id`
  if (!rows.length) throw err('Brand kit not found', 404)
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
