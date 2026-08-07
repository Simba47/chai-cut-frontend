'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import type { Video } from '@chai-cut/shared'
import { ACCEPTED_VIDEO_EXTENSIONS, MAX_UPLOAD_BYTES } from '@chai-cut/shared'
import { ThemeToggle } from '@/components/ThemeToggle'

export default function DashboardPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [planInfo, setPlanInfo] = useState<{ plan: string; planName: string; maxVideos: number; maxFileSizeBytes: number; maxFileSizeGb: number; autoCaption: boolean; usage: { videos: number; clips: number } } | null>(null)

  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function fetchVideos() {
    const res = await fetch('/api/videos')
    if (res.redirected || res.status === 401) { router.push('/login'); return }
    if (res.ok) {
      const { videos } = await res.json()
      setVideos(videos ?? [])
    }
  }

  useEffect(() => {
    Promise.all([
      fetchVideos(),
      fetch('/api/billing/plan').then(r => r.ok ? r.json() : null).then(d => { if (d) setPlanInfo(d) }).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const hasPending = videos.some(v => v.status === 'uploaded' || v.status === 'transcribing')
    if (!hasPending) return
    const id = setInterval(fetchVideos, 3000)
    return () => clearInterval(id)
  }, [videos])

  function validateAndSetFile(f: File) {
    const limitBytes = planInfo?.maxFileSizeBytes ?? MAX_UPLOAD_BYTES
    const limitGb = planInfo?.maxFileSizeGb ?? 2
    if (f.size > limitBytes) { setUploadError(`File exceeds your plan limit of ${limitGb} GB.`); return }
    const ext = '.' + f.name.split('.').pop()?.toLowerCase()
    if (!ACCEPTED_VIDEO_EXTENSIONS.includes(ext as never)) {
      setUploadError(`Unsupported format. Accepted: ${ACCEPTED_VIDEO_EXTENSIONS.join(', ')}`)
      return
    }
    setUploadError(null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) { validateAndSetFile(dropped); handleFileUpload(dropped) }
  }

  async function handleFileUpload(f: File) {
    setUploading(true)
    setUploadProgress(0)
    setUploadError(null)
    try {
      const signRes = await fetch('/api/ingest/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: f.name, content_type: f.type, file_size: f.size }),
      })
      if (!signRes.ok) throw new Error((await signRes.json()).error ?? 'Failed to get upload URL')
      const { signed_url, storage_path } = await signRes.json()

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

      const completeRes = await fetch('/api/ingest/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_path, ...(durationMs ? { duration_ms: durationMs } : {}) }),
      })
      if (!completeRes.ok) throw new Error((await completeRes.json()).error ?? 'Failed')
      const { video_id } = await completeRes.json()
      await fetchVideos()
      router.push(`/videos/${video_id}`)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }}/>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', height: 52, background: 'var(--nav)', borderBottom: '1px solid var(--border)', boxShadow: 'var(--nav-shadow)', position: 'sticky', top: 0, zIndex: 50 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>✂ Chai Cut</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{session?.user?.email}</span>
          {planInfo && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: planInfo.plan === 'free' ? 'var(--surface)' : 'var(--accent)', color: planInfo.plan === 'free' ? 'var(--text-muted)' : '#fff', border: '1px solid var(--border)' }}>
              {planInfo.planName}
            </span>
          )}
          {planInfo?.plan === 'free' && (
            <a href="/pricing" style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, fontWeight: 700, background: 'var(--accent)', color: '#fff', textDecoration: 'none' }}>
              Upgrade
            </a>
          )}
          <ThemeToggle />
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)', background: 'var(--bg)', border: '1px solid var(--border-strong)', fontWeight: 500 }}
          >
            Sign out
          </button>
        </div>
      </nav>

      <main style={{ maxWidth: 768, margin: '0 auto', padding: '40px 24px 64px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', textAlign: 'center', marginBottom: 4, letterSpacing: '-0.02em' }}>Upload your video</h1>
        <p style={{ fontSize: 14, textAlign: 'center', marginBottom: 32, color: 'var(--text-muted)' }}>
          Transcribe and clip your long-form content
        </p>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            borderRadius: 18, padding: '56px 24px', textAlign: 'center', cursor: 'pointer',
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border-strong)'}`,
            background: dragOver ? 'rgba(0,180,216,0.06)' : 'var(--surface)',
            boxShadow: 'var(--card-shadow)',
            transition: 'all 0.2s', marginBottom: 12,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_VIDEO_EXTENSIONS.join(',')}
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) { validateAndSetFile(f); handleFileUpload(f) }
            }}
          />
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: '0 auto 12px', display: 'block', opacity: 0.35 }}>
            <path d="M20 28V12M20 12L13 19M20 12L27 19" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 30C5.8 30 4 28.2 4 26c0-1.9 1.3-3.5 3-4 .1-3.9 3.3-7 7.2-7 .6 0 1.2.1 1.8.2C17.2 13.5 18.5 13 20 13s2.8.5 4 1.2c.6-.1 1.2-.2 1.8-.2C29.7 14 33 17.1 33 21c1.7.5 3 2.1 3 4 0 2.2-1.8 4-4 4H8z" stroke="var(--text)" strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
          {uploading ? (
            <>
              <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 10 }}>Uploading… {uploadProgress}%</p>
              <div style={{ width: 192, margin: '0 auto', height: 6, borderRadius: 999, overflow: 'hidden', background: 'var(--border-strong)' }}>
                <div style={{ height: '100%', borderRadius: 999, width: `${uploadProgress}%`, background: 'var(--accent)', transition: 'width 0.3s' }}/>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Click or drag to upload a video</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                MP4, MOV, WEBM · up to {planInfo?.maxFileSizeGb ?? 2} GB
                {planInfo && ` · ${planInfo.usage.videos}/${planInfo.maxVideos} videos used`}
              </p>
            </>
          )}
        </div>

        {uploadError && (
          <p style={{ fontSize: 13, textAlign: 'center', marginBottom: 16, color: 'var(--danger)' }}>{uploadError}</p>
        )}

        {/* Videos */}
        {videos.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Your Videos
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
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
    } catch {
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
    pct < 99 ? `Transcribing ${pct}%` : 'Finishing…'

  const statusColor: Record<string, string> = {
    uploaded: '#f59e0b', transcribing: 'var(--accent)', ready: 'var(--success)', failed: 'var(--danger)',
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
      onClick={openEditor}
      onMouseLeave={() => setConfirmDelete(false)}
      style={{
        borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
        background: 'var(--surface)',
        border: `1px solid ${confirmDelete ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
        boxShadow: 'var(--card-shadow)',
        transition: 'border-color 0.15s, transform 0.15s',
      }}
    >
      {/* Thumbnail */}
      <div style={{ position: 'relative', aspectRatio: '16/9', background: 'var(--media-bg)' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3 }}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="6" fill="#888"/>
            <path d="M15 12v16l14-8-14-8z" fill="white"/>
          </svg>
        </div>

        {video.status === 'transcribing' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 24px', background: 'rgba(0,0,0,0.55)' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#fff', textAlign: 'center' }}>{stageLabel}</p>
            <div style={{ width: '100%', height: 6, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.15)' }}>
              <div style={{ height: '100%', borderRadius: 999, width: `${Math.max(4, pct)}%`, background: 'var(--accent)', transition: 'width 0.5s' }}/>
            </div>
          </div>
        )}

        {durationLabel && (
          <div style={{ position: 'absolute', top: 8, left: 8, fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: 'rgba(0,0,0,0.65)', color: 'rgba(255,255,255,0.85)' }}>
            {durationLabel}
          </div>
        )}

        <button
          onClick={handleDelete}
          style={{
            position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 8, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: confirmDelete ? 'rgba(239,68,68,0.9)' : 'rgba(0,0,0,0.55)',
            border: `1px solid ${confirmDelete ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
            color: '#fff', transition: 'all 0.15s',
          }}
          title={confirmDelete ? 'Tap again to confirm' : 'Delete'}
        >
          {deleting
            ? <div style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid #fff', borderTopColor: 'transparent', animation: 'spin 0.6s linear infinite' }}/>
            : confirmDelete
              ? <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>
              : <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2h2v1M4.5 3v6M7.5 3v6M3 3l.5 7h5L9 3" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          }
        </button>
      </div>

      {/* Info row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>{title}</p>
          <p style={{ fontSize: 11, color: statusColor[video.status] ?? 'var(--text-muted)' }}>
            {statusText[video.status] ?? video.status}
          </p>
        </div>
        {video.status === 'ready' && (
          <button
            onClick={e => { e.stopPropagation(); openEditor() }}
            style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', flexShrink: 0 }}
          >
            Edit →
          </button>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
