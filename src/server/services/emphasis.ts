import sql from '@/lib/db'
import { hasColumn } from './clips'

/**
 * The words that matter in a clip's captions, picked by AI — what the Creator caption styles make
 * big, coloured or underlined. The export asks the same question the first time it renders a clip
 * with a caption style (backend jobs/render.ts pickEmphasis, the same prompt); this asks it as soon
 * as one is picked in the editor, so the preview shows them. Kept on the caption style
 * (caption_styles.emphasis: { "<word start_ms>": true }); a clip that has them keeps them.
 */
const EMPHASIS_SCHEMA = { type: 'OBJECT', properties: { words: { type: 'ARRAY', items: { type: 'INTEGER' } } }, required: ['words'] }

export async function clipEmphasis(userId: string, clipId: string): Promise<{ emphasis: Record<string, true> | null }> {
  const [clip] = await sql`
    SELECT c.id, c.start_ms, c.end_ms, c.video_id, v.user_id
    FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })

  const saves = await hasColumn('caption_styles', 'emphasis')
  if (saves) {
    const [style] = await sql`SELECT emphasis FROM caption_styles WHERE clip_id = ${clipId} LIMIT 1`
    if (style?.emphasis) return { emphasis: style.emphasis as Record<string, true> }
  }

  const { aiProvider, askGemini } = await import('@/lib/gemini')
  if (!aiProvider()) return { emphasis: null }
  const [transcript] = await sql`SELECT id FROM transcripts WHERE video_id = ${clip.video_id} ORDER BY created_at DESC LIMIT 1`
  const words = transcript
    ? await sql<{ word: string; start_ms: number; end_ms: number }[]>`
        SELECT word, start_ms, end_ms FROM transcript_words
        WHERE transcript_id = ${transcript.id} AND start_ms >= ${clip.start_ms} AND start_ms < ${clip.end_ms}
        ORDER BY start_ms`
    : []
  if (!words.length) return { emphasis: null }

  // Lines as the captions break them: a pause over 300 ms or 5 words
  const lines: number[][] = []
  words.forEach((w, i) => {
    const line = lines[lines.length - 1]
    if (!line || line.length >= 5 || w.start_ms - words[i - 1].end_ms > 300) lines.push([i])
    else line.push(i)
  })
  const text = lines.map((l, li) => `${li}: ` + l.map(i => `${i}=${words[i].word}`).join(' ')).join('\n')
  const prompt = `These are caption lines from a short video (any language, often Telugu, Hindi or Tamil mixed with English). Each word is written as index=word.
For each line pick the 1 or 2 words that carry the meaning or emotion (a key noun, number, strong verb or punchline word) — never filler words. Skip a line if nothing stands out.
Return ONLY JSON: {"words": [index, ...]}

${text}`
  let picked: Record<string, true> | null = null
  try {
    const out = await askGemini(prompt, { schema: EMPHASIS_SCHEMA, temperature: 0, thinkingBudget: 0 })
    const match = out.match(/\{[\s\S]*\}/)
    const idx: unknown = match ? JSON.parse(match[0]).words : null
    if (Array.isArray(idx)) {
      picked = {}
      for (const i of idx) if (Number.isInteger(i) && words[i]) picked[String(words[i].start_ms)] = true
    }
  } catch (e) {
    console.warn('[emphasis] Gemini failed; the captions use each line\'s longest word:', e instanceof Error ? e.message : e)
    return { emphasis: null }
  }
  // Kept for the export too (only where none were picked yet: never over the user's own)
  if (picked && saves) {
    await sql`UPDATE caption_styles SET emphasis = ${sql.json(picked)} WHERE clip_id = ${clipId} AND emphasis IS NULL`
      .catch(e => console.warn('[emphasis] could not save:', e))
  }
  return { emphasis: picked }
}
