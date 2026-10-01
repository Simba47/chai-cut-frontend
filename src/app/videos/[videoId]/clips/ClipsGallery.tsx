'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CaptionStyle, SegmentLocal, TextOverlay, TranscriptWord } from '@chai-cut/shared'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AccountMenu } from '@/components/ui/account-menu'
import { ClipPlayer } from '@/components/clips/ClipPlayer'
import { PostText } from '@/components/clips/PostText'

export interface GalleryClip {
  id: string; title: string | null; start_ms: number; end_ms: number; status: string
  /** The Make my clips run it came from, and when */
  batch: string; batch_at: string
  ai_score: number | null; ai_reason: string | null
  post_caption: string | null; hashtags: string[] | null; output_url: string | null
  segments: SegmentLocal[]; words: TranscriptWord[]
  captionStyle: CaptionStyle | null; textOverlays: TextOverlay[]
}

const ACCENT = '#c8ff00'

/**
 * AI edits: every clip "Make my clips" made from the video, a section per run (newest first), each
 * playable in 9:16 here; Edit opens the editor, Export renders one
 */
export function ClipsGallery({ video, videoUrl, stockUrls, job, clips: initial }: {
  video: { id: string; title: string | null }
  videoUrl: string
  stockUrls: Record<string, string>
  job: { status: string; error: string | null } | null
  clips: GalleryClip[]
}) {
  const router = useRouter()
  const [clips, setClips] = useState(initial)
  useEffect(() => { setClips(initial) }, [initial])
  const [exportError, setExportError] = useState<string | null>(null)
  const running = job?.status === 'queued' || job?.status === 'running'
  // One section per Make my clips run, newest first (clips arrive in that order)
  const batches = clips.reduce<Array<{ id: string; at: string; clips: GalleryClip[] }>>((acc, c) => {
    const last = acc[acc.length - 1]
    if (last?.id === c.batch) last.clips.push(c)
    else acc.push({ id: c.batch, at: c.batch_at, clips: [c] })
    return acc
  }, [])
  const exporting = clips.some(c => c.status === 'rendering')

  // While the AI is still making clips, or clips are exporting, check every 3 s
  useEffect(() => {
    if (!running && !exporting) return
    const t = setInterval(async () => {
      const res = await fetch(`/api/videos/${video.id}/auto-clips`).catch(() => null)
      if (!res?.ok) return
      const data = await res.json() as { job: { status: string } | null; clips: Array<{ id: string; status: string; output_url: string | null }> }
      if (running && data.job?.status !== job?.status) { router.refresh(); return }
      setClips(cs => cs.map(c => {
        const u = data.clips.find(x => x.id === c.id)
        return u ? { ...c, status: u.status, output_url: u.output_url } : c
      }))
    }, 3000)
    return () => clearInterval(t)
  }, [running, exporting, video.id, job?.status, router])

  async function exportClip(id: string) {
    setExportError(null)
    const res = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clip_id: id, quality: '1080p' }),
    })
    if (!res.ok) { setExportError((await res.json().catch(() => ({}))).error ?? 'Export failed'); return }
    setClips(cs => cs.map(c => c.id === id ? { ...c, status: 'rendering', output_url: null } : c))
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0d0d0d' }}>
      <nav className="flex items-center gap-3 px-4 shrink-0 sticky top-0 z-10"
        style={{ height: 56, background: '#111', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Breadcrumbs shine items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Clip board', href: `/videos/${video.id}` },
          { label: 'AI edits' },
        ]} />
        <div className="flex-1" />
        <AccountMenu />
      </nav>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 flex flex-col gap-5">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-white">AI edits{video.title ? ` · ${video.title}` : ''}</h1>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Play any clip to see it as a reel. Open it in the editor to change it, or export the ones you want to download.
            </p>
          </div>
          <a href={`/videos/${video.id}`} className="text-sm px-3 py-2 rounded-lg transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.14)' }}>
            Back to clip board
          </a>
        </div>

        {running && (
          <p className="flex items-center gap-2 text-sm" style={{ color: ACCENT }}>
            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            AI is still making clips. They appear here when ready.
          </p>
        )}
        {job?.status === 'failed' && (
          <p className="text-sm" style={{ color: '#f87171' }}>Making clips failed{job.error ? `: ${job.error}` : ''}.</p>
        )}
        {exportError && <p className="text-sm" style={{ color: '#f87171' }}>{exportError}</p>}
        {!running && clips.length === 0 && (
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>No AI clips yet. Use “Make my clips” on the clip board.</p>
        )}

        {batches.map((b, bi) => (
        <section key={b.id} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {bi === 0 ? 'Latest batch' : `Batch ${batches.length - bi}`}
            <span className="font-normal" style={{ color: 'rgba(255,255,255,0.4)' }}> · {b.clips.length} clip{b.clips.length === 1 ? '' : 's'} · {new Date(b.at).toLocaleString()}</span>
          </h2>
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {b.clips.map(c => (
            <article key={c.id} className="flex flex-col gap-2.5 p-3 rounded-2xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <ClipPlayer videoUrl={videoUrl}
                stockUrls={Object.fromEntries(c.segments.flatMap(sg => sg.crop_boxes.map(b => b.source_video_id))
                  .filter((id): id is string => !!id && !!stockUrls[id]).map(id => [id, stockUrls[id]]))}
                startMs={c.start_ms} endMs={c.end_ms} segments={c.segments}
                words={c.words} captionStyle={c.captionStyle} textOverlays={c.textOverlays} />
              <div className="flex items-start gap-2">
                <p className="flex-1 text-sm font-semibold text-white leading-snug">{c.title || 'Untitled clip'}</p>
                {typeof c.ai_score === 'number' && (
                  <span title="Viral score (0–99)" className="shrink-0 text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-md"
                    style={{ color: ACCENT, background: 'rgba(200,255,0,0.1)', border: '1px solid rgba(200,255,0,0.25)' }}>
                    {c.ai_score}
                  </span>
                )}
              </div>
              {c.ai_reason && <p className="text-[11px] italic leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>{c.ai_reason}</p>}
              <div className="flex gap-2">
                <button onClick={() => router.push(`/editor/${c.id}`)}
                  className="flex-1 py-2 rounded-lg text-xs font-bold transition-opacity hover:opacity-90"
                  style={{ background: ACCENT, color: '#000' }}>
                  Edit
                </button>
                {c.output_url ? (
                  <a href={c.output_url} download target="_blank" rel="noreferrer"
                    className="flex-1 py-2 rounded-lg text-xs font-semibold text-center transition-colors hover:bg-white/15"
                    style={{ color: '#fff', background: 'rgba(255,255,255,0.08)' }}>
                    Download
                  </a>
                ) : (
                  <button onClick={() => exportClip(c.id)} disabled={c.status === 'rendering'}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors hover:bg-white/15 disabled:opacity-60"
                    style={{ color: '#fff', background: 'rgba(255,255,255,0.08)' }}>
                    {c.status === 'rendering' && <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                    {c.status === 'rendering' ? 'Exporting…' : 'Export'}
                  </button>
                )}
              </div>
              <PostText compact clipId={c.id} value={{ title: c.title, post_caption: c.post_caption, hashtags: c.hashtags }}
                onChange={t => setClips(cs => cs.map(x => x.id === c.id ? { ...x, title: t.title, post_caption: t.post_caption, hashtags: t.hashtags } : x))} />
            </article>
          ))}
        </div>
        </section>
        ))}
      </main>
    </div>
  )
}
