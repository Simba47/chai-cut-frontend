import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET } from '@/lib/r2'
import sql from '@/lib/db'

export async function listVideos(userId: string) {
  return sql`
    SELECT id, status, download_progress, duration_ms, created_at
    FROM videos WHERE user_id = ${userId} ORDER BY created_at DESC
  `
}

export async function getVideo(userId: string, videoId: string) {
  const [video] = await sql`
    SELECT id, user_id, status, download_progress, duration_ms
    FROM videos WHERE id = ${videoId}
  `
  if (!video || video.user_id !== userId) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  return { video }
}

export async function deleteVideo(userId: string, videoId: string) {
  const [video] = await sql`
    SELECT id, user_id, storage_path FROM videos WHERE id = ${videoId}
  `
  if (!video) throw Object.assign(new Error('Not found'), { status: 404 })
  if (video.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })

  if (video.storage_path) {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: video.storage_path })).catch(() => {})
  }

  await sql`DELETE FROM videos WHERE id = ${videoId}`
}

interface ClipSuggestion { id: string; title: string; start_ms: number; end_ms: number; summary: string }
type Word = { word: string; start_ms: number; end_ms: number }

export async function getVideoSuggestions(userId: string, videoId: string): Promise<{ suggestions: ClipSuggestion[] }> {
  const [video] = await sql`
    SELECT id, user_id, duration_ms, status FROM videos WHERE id = ${videoId}
  `
  if (!video || video.user_id !== userId) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }

  const [transcriptRow] = await sql`
    SELECT id FROM transcripts WHERE video_id = ${videoId} ORDER BY created_at DESC LIMIT 1
  `

  const words: Word[] = transcriptRow
    ? await sql`SELECT word, start_ms, end_ms FROM transcript_words WHERE transcript_id = ${transcriptRow.id} ORDER BY start_ms`
    : []

  const durationMs = video.duration_ms ?? 0
  if (words.length === 0) return { suggestions: makeTimeChunks(durationMs) }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return { suggestions: makeWordChunks(words, durationMs) }

  try {
    return { suggestions: await detectClipsWithClaude(buildTranscriptText(words), durationMs, anthropicKey) }
  } catch (e) {
    console.error('[suggestions] Claude error:', e)
    return { suggestions: makeWordChunks(words, durationMs) }
  }
}

function msToTimestamp(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function buildTranscriptText(words: Word[]) {
  const lines: string[] = []
  let lineStart = 0, line: string[] = []
  for (const w of words) {
    if (line.length > 0 && w.start_ms - lineStart > 2000) {
      lines.push(`[${msToTimestamp(lineStart)}] ${line.join(' ')}`)
      line = []
    }
    if (line.length === 0) lineStart = w.start_ms
    line.push(w.word)
  }
  if (line.length > 0) lines.push(`[${msToTimestamp(lineStart)}] ${line.join(' ')}`)
  return lines.join('\n')
}

async function detectClipsWithClaude(transcript: string, durationMs: number, apiKey: string): Promise<ClipSuggestion[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You are a viral short-clip detector. Given a video transcript with timestamps, identify 5-8 engaging moments suitable for social media clips (30–90 seconds each). Return ONLY a JSON array, no other text. Each element: {"title":"catchy 3-7 word title","start_ms":number,"end_ms":number,"summary":"one sentence why it is a good clip"}`,
      messages: [{ role: 'user', content: `Video duration: ${msToTimestamp(durationMs)}\n\nTranscript:\n${transcript.slice(0, 8000)}` }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`)
  const data = await res.json()
  const text: string = data.content?.[0]?.text ?? ''
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON in Claude response')
  const parsed = JSON.parse(match[0]) as Array<{ title: string; start_ms: number; end_ms: number; summary: string }>
  return parsed.map((s, i) => ({
    id: `ai-${i}`, title: s.title,
    start_ms: Math.max(0, Math.round(s.start_ms)),
    end_ms: Math.min(durationMs, Math.round(s.end_ms)),
    summary: s.summary ?? '',
  }))
}

function makeWordChunks(words: Word[], durationMs: number): ClipSuggestion[] {
  const TARGET_MS = 60_000
  const suggestions: ClipSuggestion[] = []
  let chunkStart = 0, chunkWords: string[] = [], idx = 0
  for (const w of words) {
    if (chunkWords.length === 0) chunkStart = w.start_ms
    chunkWords.push(w.word)
    if (w.end_ms - chunkStart >= TARGET_MS) {
      suggestions.push({ id: `chunk-${idx++}`, title: chunkWords.slice(0, 6).join(' ').trim(), start_ms: chunkStart, end_ms: w.end_ms, summary: '' })
      chunkWords = []
    }
  }
  if (chunkWords.length > 0 && words.length > 0) {
    suggestions.push({ id: `chunk-${idx}`, title: chunkWords.slice(0, 6).join(' ').trim(), start_ms: chunkStart, end_ms: words[words.length - 1].end_ms || durationMs, summary: '' })
  }
  return suggestions
}

function makeTimeChunks(durationMs: number): ClipSuggestion[] {
  const chunkMs = 60_000
  return Array.from({ length: Math.max(1, Math.ceil(durationMs / chunkMs)) }, (_, i) => ({
    id: `time-${i}`, title: `Segment ${i + 1}`,
    start_ms: i * chunkMs, end_ms: Math.min((i + 1) * chunkMs, durationMs), summary: '',
  }))
}
