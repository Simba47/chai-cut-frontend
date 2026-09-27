import { DeleteObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { r2, R2_BUCKET } from '@/lib/r2'
import sql from '@/lib/db'

export async function listVideos(userId: string) {
  return sql`
    SELECT id, title, status, download_progress, duration_ms, created_at, storage_path, source_url, source_type,
      (SELECT COUNT(*)::int FROM clips c WHERE c.video_id = videos.id) AS clip_count
    FROM videos WHERE user_id = ${userId} ORDER BY created_at DESC
  `
}

export async function renameVideo(userId: string, videoId: string, title: string) {
  const trimmed = title.trim().slice(0, 120)
  if (!trimmed) throw Object.assign(new Error('Title cannot be empty'), { status: 400 })
  const [video] = await sql`
    UPDATE videos SET title = ${trimmed}
    WHERE id = ${videoId} AND user_id = ${userId}
    RETURNING id, title
  `
  if (!video) throw Object.assign(new Error('Not found'), { status: 404 })
  return { video }
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

  // Collect all R2 keys to delete
  const keysToDelete: string[] = []

  if (video.storage_path) {
    keysToDelete.push(video.storage_path)
    // FLAC audio cache created during transcription
    keysToDelete.push(video.storage_path.replace(/\.[^.]+$/, '_audio.flac'))
  }

  // Rendered output for every clip of this video
  const clipOutputs = await sql`
    SELECT output_storage_path FROM clips
    WHERE video_id = ${videoId} AND output_storage_path IS NOT NULL
  `
  for (const row of clipOutputs) keysToDelete.push(row.output_storage_path as string)

  if (keysToDelete.length > 0) {
    await r2.send(new DeleteObjectsCommand({
      Bucket: R2_BUCKET,
      Delete: { Objects: keysToDelete.map(Key => ({ Key })), Quiet: true },
    })).catch(() => {})
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

// Criteria-steered clip detection ("find me the funniest moments", "controversial takes", etc.) —
// same transcript source as getVideoSuggestions, but the caller picks what to look for.
export async function getVideoSuggestionsByCriteria(
  userId: string, videoId: string, criteria: string,
): Promise<{ suggestions: ClipSuggestion[] }> {
  const trimmedCriteria = criteria.trim().slice(0, 200)
  if (!trimmedCriteria) throw Object.assign(new Error('Tell the AI what to look for'), { status: 400 })

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
  if (words.length === 0) {
    throw Object.assign(new Error('This video has no transcript yet'), { status: 400 })
  }

  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) throw Object.assign(new Error('AI clip detection is not configured'), { status: 500 })

  return {
    suggestions: await detectClipsByCriteria(
      buildTranscriptText(words), durationMs, trimmedCriteria, geminiKey,
    ),
  }
}

function msToTimestamp(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function buildTranscriptText(words: Word[]) {
  const lines: string[] = []
  let lineStart = 0, lineEnd = 0, line: string[] = []
  for (const w of words) {
    if (line.length > 0 && w.start_ms - lineEnd > 2000) {
      lines.push(`[${msToTimestamp(lineStart)}–${msToTimestamp(lineEnd)}] ${line.join(' ')}`)
      line = []
    }
    if (line.length === 0) lineStart = w.start_ms
    line.push(w.word)
    lineEnd = w.end_ms
  }
  if (line.length > 0) lines.push(`[${msToTimestamp(lineStart)}–${msToTimestamp(lineEnd)}] ${line.join(' ')}`)
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

async function detectClipsByCriteria(
  transcript: string, durationMs: number, criteria: string, apiKey: string,
): Promise<ClipSuggestion[]> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' })
  const prompt = `You are a strict, skeptical video clip finder. Given a video transcript with timestamps and a request describing what to look for, find moments (30–90 seconds each) that genuinely match.

Be conservative. Most videos do NOT contain what any given request is looking for — that is the normal case, not an edge case. Only include a moment if a viewer watching just that clip, with no explanation from you, would immediately agree it matches. Do not stretch, do not include a moment just because it is loosely related or you can construct a justification for it — if you find yourself explaining why something "counts", it doesn't.

If nothing in the transcript is a genuine, confident match, you MUST return an empty JSON array: []. Returning [] is the correct and expected answer for most (request, video) combinations — never force a result to avoid returning nothing.

What to look for: ${criteria}

Video duration: ${msToTimestamp(durationMs)}

Transcript (each line is tagged [start–end] with when that line of speech actually begins and ends):
${transcript.slice(0, 8000)}

Choosing end_ms is the part you must get generously right, not minimally right. Do not stop at the line that merely contains the key moment — deliberately continue past it and include the NEXT 2-3 full lines of transcript after it as trailing context (the reaction, the response, the rest of the thought), then set end_ms to the end of that later line. A clip that runs a few seconds longer than strictly necessary is fine; a clip that cuts off before the payoff, reaction, or the speaker finishing their sentence is a failure. When genuinely unsure exactly where something ends, always round end_ms UP to a later line, never down to an earlier one.

Return ONLY a JSON array, no other text. Each element: {"title":"catchy 3-7 word title","start_ms":number,"end_ms":number,"summary":"one sentence on why this moment matches the request"}`

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error(`Gemini did not return a JSON array: ${text.slice(0, 300)}`)
  const parsed = JSON.parse(match[0]) as Array<{ title: string; start_ms: number; end_ms: number; summary: string }>
  const MIN_CLIP_MS = 20_000
  return parsed
    .map((s, i) => {
      const start_ms = Math.max(0, Math.round(s.start_ms))
      // Trailing buffer — Gemini persistently ends right at the punchline/reaction
      // instead of past it, even when told to include trailing context. A cut-off
      // ending is a much worse failure than a clip running a bit long, so pad hard.
      let end_ms = Math.min(durationMs, Math.round(s.end_ms) + 5000)
      // Gemini sometimes ignores the requested 30–90s length — pad short moments
      // out instead of discarding them outright (same fix ai_edit.ts needed).
      if (end_ms - start_ms < MIN_CLIP_MS) end_ms = Math.min(durationMs, start_ms + MIN_CLIP_MS)
      return { id: `ai-criteria-${i}`, title: s.title, start_ms, end_ms, summary: s.summary ?? '' }
    })
    .filter(s => s.end_ms - s.start_ms >= 10_000) // still too short (e.g. right at the end of the video) — drop it
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
