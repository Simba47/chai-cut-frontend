import sql from '@/lib/db'
import type { RenderQuality } from '@chai-cut/shared'

export async function queueRender(userId: string, clipId: string, quality: RenderQuality = '1080p') {
  const [row] = await sql`
    SELECT c.id, c.status, v.storage_path, v.user_id
    FROM clips c JOIN videos v ON v.id = c.video_id
    WHERE c.id = ${clipId}
  `
  if (!row) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (row.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  if (row.status === 'rendering') throw Object.assign(new Error('Already rendering'), { status: 409 })
  if (!row.storage_path) throw Object.assign(new Error('Video not ready (no storage path)'), { status: 400 })

  await sql`UPDATE clips SET status = 'rendering' WHERE id = ${clipId}`

  const { getUserPlanConfig } = await import('./quota')
  const plan = await getUserPlanConfig(userId)
  const payload = { clip_id: clipId, video_storage_path: row.storage_path, quality, watermark: plan.watermark }
  const [job] = await sql`
    INSERT INTO jobs (type, payload, status) VALUES ('render', ${sql.json(payload)}, 'queued') RETURNING id
  `
  if (!job) {
    await sql`UPDATE clips SET status = 'draft' WHERE id = ${clipId}`
    throw Object.assign(new Error('Failed to queue render job'), { status: 500 })
  }
  return { job_id: job.id }
}
