'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import type { Video } from '@chai-cut/shared'
import { ACCEPTED_VIDEO_EXTENSIONS, MAX_UPLOAD_BYTES } from '@chai-cut/shared'

export default function DashboardPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)

  // Upload state
  const [file, setFile] = useState<File | null>(null)
  const [link, setLink] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function fetchVideos() {
    const res = await fetch('/api/videos')
    if (res.ok) {
      const { videos } = await res.json()
      setVideos(videos ?? [])
    }
  }

  useEffect(() => {
    fetchVideos().finally(() => setLoading(false))
  }, [])

  // Auto-poll every 3 s while any video is still processing
  useEffect(() => {
    const hasPending = videos.some(v => v.status === 'uploaded' || v.status === 'transcribing')
    if (!hasPending) return
    const id = setInterval(fetchVideos, 3000)
    return () => clearInterval(id)
  }, [videos])

  async function handleSignOut() {
    window.location.href = '/login'
  }

  function validateAndSetFile(f: File) {
    if (f.size > MAX_UPLOAD_BYTES) { setUploadError('File exceeds the 2 GB limit.'); return }
    const ext = '.' + f.name.split('.').pop()?.toLowerCase()
    if (!ACCEPTED_VIDEO_EXTENSIONS.includes(ext as never)) {
      setUploadError(`Unsupported format. Accepted: ${ACCEPTED_VIDEO_EXTENSIONS.join(', ')}`)
      return
    }
    setUploadError(null)
    setFile(f)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) validateAndSetFile(dropped)
  }

  async function handleFileUpload(f: File) {
    setUploading(true)
    setUploadProgress(0)
    setUploadError(null)
    try {
      // Step 1: get pre-signed R2 URL (avoids Vercel's 4.5 MB serverless body limit)
      const signRes = await fetch('/api/ingest/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: f.name, content_type: f.type }),
      })
      if (!signRes.ok) throw new Error((await signRes.json()).error ?? 'Failed to get upload URL')
      const { signed_url, storage_path } = await signRes.json()

      // Step 2: upload directly from browser to R2 with progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', signed_url)
        xhr.setRequestHeader('Content-Type', f.type || 'video/mp4')
        xhr.upload.addEventListener('progress', ev => {
          if (ev.lengthComputable) setUploadProgress(Math.round((ev.loaded / ev.total) * 100))
        })
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`Upload failed (${xhr.status})`))
        })
        xhr.addEventListener('error', () => reject(new Error('Network error')))
        xhr.send(f)
      })

      // Step 3: read duration client-side to avoid extra worker round-trip
      let durationMs: number | undefined
      try {
        durationMs = await new Promise<number>((res, rej) => {
          const v = document.createElement('video')
          v.preload = 'metadata'
          const url = URL.createObjectURL(f)
          v.onloadedmetadata = () => { URL.revokeObjectURL(url); res(Math.round(v.duration * 1000)) }
          v.onerror = () => { URL.revokeObjectURL(url); rej(new Error('metadata')) }
          v.src = url
        })
      } catch { /* leave undefined */ }

      // Step 4: create DB record
      const completeRes = await fetch('/api/ingest/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_path, ...(durationMs ? { duration_ms: durationMs } : {}) }),
      })
      if (!completeRes.ok) throw new Error((await completeRes.json()).error ?? 'Failed')
      const { video_id } = await completeRes.json()
      setFile(null)
      await fetchVideos()
      router.push(`/videos/${video_id}`)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleLinkSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!link.trim()) return
    setUploading(true)
    setUploadError(null)
    try {
      const res = await fetch('/api/ingest/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const { video_id } = await res.json()
      setLink('')
      await fetchVideos()
      router.push(`/videos/${video_id}`)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to queue link')
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0d0d0d' }}>
        <div className="w-8 h-8 border-2 border-[#00b4d8] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#0d0d0d' }}>
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-6 py-3 border-b"
        style={{ background: '#111', borderColor: 'rgba(255,255,255,0.07)' }}
      >
        <span className="text-base font-bold text-white tracking-tight">✂ Chai Cut</span>
        <div className="flex items-center gap-4">
          <span className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>{session?.user?.email}</span>
          <button
            onClick={handleSignOut}
            className="text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
            style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 pt-10 pb-16">
        {/* Upload section */}
        <h1 className="text-2xl font-bold text-white text-center mb-1">Upload your video</h1>
        <p className="text-sm text-center mb-8" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Transcribe and clip your long-form content
        </p>

        {/* Drag & drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-2xl p-14 text-center cursor-pointer transition-all mb-4"
          style={{
            border: `2px dashed ${dragOver ? '#00b4d8' : 'rgba(255,255,255,0.15)'}`,
            background: dragOver ? 'rgba(0,180,216,0.05)' : 'transparent',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_VIDEO_EXTENSIONS.join(',')}
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) { validateAndSetFile(f); handleFileUpload(f) }
            }}
          />
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="mx-auto mb-3" opacity={0.4}>
            <path d="M20 28V12M20 12L13 19M20 12L27 19" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 30C5.8 30 4 28.2 4 26c0-1.9 1.3-3.5 3-4 .1-3.9 3.3-7 7.2-7 .6 0 1.2.1 1.8.2C17.2 13.5 18.5 13 20 13s2.8.5 4 1.2c.6-.1 1.2-.2 1.8-.2C29.7 14 33 17.1 33 21c1.7.5 3 2.1 3 4 0 2.2-1.8 4-4 4H8z" stroke="white" strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
          {uploading ? (
            <div className="mt-2">
              <p className="text-sm text-white mb-2">Uploading… {uploadProgress}%</p>
              <div className="w-48 mx-auto h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${uploadProgress}%`, background: '#00b4d8' }} />
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium text-white mb-1">Click or drag to upload a video</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>MP4, MOV, WEBM · up to 2 GB</p>
            </>
          )}
        </div>

        {/* YouTube / link input */}
        <form onSubmit={handleLinkSubmit} className="flex gap-2 mb-3">
          <input
            type="url"
            value={link}
            onChange={e => setLink(e.target.value)}
            placeholder="Or paste a YouTube / video URL…"
            className="flex-1 px-3 py-2.5 rounded-xl text-sm text-white outline-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            disabled={uploading}
          />
          <button
            type="submit"
            disabled={uploading || !link.trim()}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
            style={{ background: '#00b4d8' }}
          >
            {uploading ? 'Adding…' : 'Add'}
          </button>
        </form>

        {uploadError && (
          <p className="text-sm mb-4 text-center" style={{ color: '#f87171' }}>{uploadError}</p>
        )}

        {/* Videos grid */}
        {videos.length > 0 && (
          <div className="mt-10">
            <h2 className="text-sm font-semibold text-white mb-4" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Your Videos
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {videos.map((v, i) => (
                <VideoCard
                  key={v.id}
                  video={v as Video}
                  index={videos.length - i}
                  onDeleted={id => setVideos(prev => prev.filter(x => x.id !== id))}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function VideoCard({ video, index, onDeleted }: { video: Video; index: number; onDeleted: (id: string) => void }) {
  const router = useRouter()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      const res = await fetch(`/api/videos/${video.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      onDeleted(video.id)
    } catch (err) {
      console.error(err)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const pct = video.download_progress ?? 0
  const stageLabel =
    pct < 5  ? 'Queued' :
    pct < 46 ? `Downloading ${pct}%` :
    pct < 58 ? `Processing ${pct}%` :
    pct < 70 ? 'Uploading…' :
    pct < 99 ? `Transcribing ${pct}%` :
               'Finishing…'

  const statusColor: Record<string, string> = {
    uploaded: '#f59e0b', transcribing: '#00b4d8', ready: '#22c55e', failed: '#ef4444',
  }
  const statusText: Record<string, string> = {
    uploaded: 'Queued', transcribing: stageLabel, ready: 'Ready', failed: 'Failed',
  }

  const dateStr = new Date(video.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const title = `Video ${index} — ${dateStr}`
  const durationLabel = video.duration_ms
    ? `${Math.floor(video.duration_ms / 60000)}m ${Math.floor((video.duration_ms % 60000) / 1000)}s`
    : null

  function openEditor() {
    if (video.status !== 'ready') return
    router.push(`/videos/${video.id}`)
  }

  return (
    <div
      className="rounded-xl overflow-hidden cursor-pointer transition-transform hover:scale-[1.02] relative"
      style={{
        background: '#1a1a1a',
        border: `1px solid ${confirmDelete ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.07)'}`,
      }}
      onClick={openEditor}
      onMouseLeave={() => setConfirmDelete(false)}
    >
      {/* Thumbnail area */}
      <div className="relative" style={{ aspectRatio: '16/9', background: '#141414' }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" opacity={0.2}>
            <rect width="40" height="40" rx="6" fill="#6b7280"/>
            <path d="M15 12v16l14-8-14-8z" fill="white"/>
          </svg>
        </div>

        {video.status === 'transcribing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6"
            style={{ background: 'rgba(0,0,0,0.7)' }}>
            <p className="text-xs font-medium text-white text-center">{stageLabel}</p>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(4, pct)}%`, background: '#00b4d8' }} />
            </div>
          </div>
        )}

        {durationLabel && (
          <div className="absolute top-2 left-2 text-xs font-medium px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(0,0,0,0.65)', color: 'rgba(255,255,255,0.8)' }}>
            {durationLabel}
          </div>
        )}

        <button
          onClick={handleDelete}
          className="absolute top-2 right-2 flex items-center justify-center rounded-lg transition-colors"
          style={{
            width: 26, height: 26,
            background: confirmDelete ? 'rgba(239,68,68,0.9)' : 'rgba(0,0,0,0.55)',
            border: `1px solid ${confirmDelete ? '#ef4444' : 'rgba(255,255,255,0.12)'}`,
          }}
          title={confirmDelete ? 'Tap again to confirm' : 'Delete video'}
        >
          {deleting
            ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            : confirmDelete
              ? <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>
              : <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2h2v1M4.5 3v6M7.5 3v6M3 3l.5 7h5L9 3" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          }
        </button>
      </div>

      {/* Bottom info */}
      <div className="px-3 py-2.5 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white truncate">{title}</p>
          <p className="text-xs mt-0.5 truncate" style={{ color: statusColor[video.status] ?? 'rgba(255,255,255,0.3)' }}>
            {statusText[video.status] ?? video.status}
          </p>
        </div>
        {video.status === 'ready' && (
          <button
            onClick={e => { e.stopPropagation(); openEditor() }}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
            style={{ background: '#00b4d8' }}
          >
            Edit →
          </button>
        )}
      </div>
    </div>
  )
}
