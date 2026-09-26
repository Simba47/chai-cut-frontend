'use client'

import './dashboard.css'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import type { Video } from '@chai-cut/shared'
import { ACCEPTED_VIDEO_EXTENSIONS, MAX_UPLOAD_BYTES } from '@chai-cut/shared'
import { ThemeToggle } from '@/components/ThemeToggle'

type DashVideo = Video & { video_url?: string | null; clip_count?: number }
type SortKey = 'newest' | 'oldest' | 'name'
interface PlanInfo {
  plan: string
  planName: string
  maxVideos: number
  maxFileSizeBytes: number
  maxFileSizeGb: number
  autoCaption: boolean
  usage: { videos: number; clips: number }
}

// Videos uploaded before titles existed fall back to their position in the list
function displayTitle(v: DashVideo, index: number) {
  return v.title?.trim() || `Video ${index}`
}

// Closes a popover on outside click or Escape
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, close])
  return ref
}

export default function DashboardPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [videos, setVideos] = useState<DashVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null)

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [pendingDelete, setPendingDelete] = useState<{ video: DashVideo; title: string } | null>(null)

  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)
  const [uploading, setUploading] = useState(false)
  const [uploadName, setUploadName] = useState('')
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

  async function fetchPlan() {
    const res = await fetch('/api/billing/plan').catch(() => null)
    if (res?.ok) setPlanInfo(await res.json())
  }

  useEffect(() => {
    Promise.all([fetchVideos(), fetchPlan()]).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const hasPending = videos.some(v => v.status === 'uploaded' || v.status === 'transcribing')
    if (!hasPending) return
    const id = setInterval(fetchVideos, 3000)
    return () => clearInterval(id)
  }, [videos])

  const atLimit = !!planInfo && planInfo.usage.videos >= planInfo.maxVideos

  // Numbering follows upload order (newest = highest), independent of the current sort
  const indexById = useMemo(() => new Map(videos.map((v, i) => [v.id, videos.length - i])), [videos])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = videos
      .map(v => ({ video: v, title: displayTitle(v, indexById.get(v.id) ?? 0) }))
      .filter(x => !q || x.title.toLowerCase().includes(q))
    if (sort === 'oldest') list.reverse()
    if (sort === 'name') list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
    return list
  }, [videos, indexById, query, sort])

  function validateFile(f: File): string | null {
    const limitBytes = planInfo?.maxFileSizeBytes ?? MAX_UPLOAD_BYTES
    const limitGb = planInfo?.maxFileSizeGb ?? 2
    if (f.size > limitBytes) return `This file is larger than your plan's ${limitGb} GB limit.`
    const ext = '.' + f.name.split('.').pop()?.toLowerCase()
    if (!ACCEPTED_VIDEO_EXTENSIONS.includes(ext as never)) return `Unsupported format. Accepted: ${ACCEPTED_VIDEO_EXTENSIONS.join(', ')}`
    return null
  }

  function startUpload(f: File) {
    if (uploading) return
    if (atLimit) { setUploadError(`You've used all ${planInfo?.maxVideos} videos on your plan. Delete a video or upgrade to add more.`); return }
    const error = validateFile(f)
    if (error) { setUploadError(error); return }
    handleFileUpload(f)
  }

  async function handleFileUpload(f: File) {
    setUploading(true)
    setUploadName(f.name)
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

      const title = f.name.replace(/\.[^.]+$/, '')
      const completeRes = await fetch('/api/ingest/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_path, title, ...(durationMs ? { duration_ms: durationMs } : {}) }),
      })
      if (!completeRes.ok) throw new Error((await completeRes.json()).error ?? 'Failed')
      const { video_id } = await completeRes.json()
      router.push(`/videos/${video_id}`)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
      setUploading(false)
    }
  }

  // Page-wide drag-and-drop; the depth counter stops child elements from flickering the overlay
  function isFileDrag(e: React.DragEvent) { return Array.from(e.dataTransfer.types).includes('Files') }
  function onDragEnter(e: React.DragEvent) {
    if (!isFileDrag(e)) return
    e.preventDefault()
    dragDepth.current++
    setDragOver(true)
  }
  function onDragLeave(e: React.DragEvent) {
    if (!isFileDrag(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) startUpload(dropped)
  }

  async function renameVideo(id: string, title: string) {
    const prev = videos
    setVideos(vs => vs.map(v => v.id === id ? { ...v, title } : v))
    const res = await fetch(`/api/videos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => null)
    if (!res?.ok) setVideos(prev)
  }

  if (loading) {
    return (
      <div className="dash" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
        <div className="dash-spinner" style={{ width: 32, height: 32 }} />
      </div>
    )
  }

  const usagePct = planInfo ? Math.min(100, (planInfo.usage.videos / planInfo.maxVideos) * 100) : 0
  const isEmpty = videos.length === 0

  return (
    <div
      className="dash"
      onDragEnter={onDragEnter}
      onDragOver={e => { if (isFileDrag(e)) e.preventDefault() }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <nav className="dash-nav">
        <a href="/dashboard" className="dash-brand">
          <img src="/logo-icon.png" alt="" />
          <span>Shortcut</span>
        </a>
        <div className="dash-nav-right">
          {planInfo && (
            <div
              className={`dash-usage${usagePct >= 100 ? ' is-full' : usagePct >= 90 ? ' is-warn' : ''}`}
              title={`${planInfo.usage.videos} of ${planInfo.maxVideos} videos used`}
            >
              <span className="dash-usage-label"><strong>{planInfo.usage.videos}</strong> / {planInfo.maxVideos} videos</span>
              <div className="dash-usage-bar"><div style={{ width: `${usagePct}%` }} /></div>
            </div>
          )}
          {planInfo && (planInfo.plan === 'free'
            ? <a href="/pricing" className="dash-btn dash-btn-primary dash-btn-sm">Upgrade</a>
            : <a href="/pricing" className="dash-plan" title="View plans">{planInfo.planName}</a>
          )}
          <ThemeToggle />
          <AccountMenu email={session?.user?.email ?? ''} planInfo={planInfo} />
        </div>
      </nav>

      <main className="dash-main">
        {!isEmpty && (
          <div className="dash-head">
            <h1>Your videos<span>{videos.length}</span></h1>
            <div className="dash-tools">
              <label className="dash-search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  className="dash-input"
                  type="search"
                  placeholder="Search videos"
                  aria-label="Search videos"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </label>
              <select className="dash-select" aria-label="Sort videos" value={sort} onChange={e => setSort(e.target.value as SortKey)}>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>
        )}

        {/* Upload strip — takes the whole stage on first run */}
        <div className={`dash-drop${isEmpty ? ' is-empty' : ''}${dragOver ? ' is-over' : ''}`}>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_VIDEO_EXTENSIONS.join(',')}
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) startUpload(f)
            }}
          />
          <div className="dash-drop-icon">
            <svg width={isEmpty ? 26 : 20} height={isEmpty ? 26 : 20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 16V4m0 0L7 9m5-5l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div className="dash-drop-text">
            {uploading ? (
              <>
                <p>Uploading {uploadName}… {uploadProgress}%</p>
                <div className="dash-progress"><div style={{ width: `${uploadProgress}%` }} /></div>
              </>
            ) : atLimit ? (
              <>
                <p>You&apos;ve used all {planInfo?.maxVideos} videos on your {planInfo?.planName} plan</p>
                <p>Delete a video to free up space, or <a href="/pricing">upgrade your plan</a>.</p>
              </>
            ) : (
              <>
                <p>{isEmpty ? 'Upload your first video' : 'Drag and drop a video anywhere on this page'}</p>
                <p>MP4, MOV, WEBM · up to {planInfo?.maxFileSizeGb ?? 2} GB{isEmpty ? ' · we’ll transcribe it so you can cut clips' : ''}</p>
              </>
            )}
          </div>
          {!atLimit && (
            <button className="dash-btn dash-btn-primary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? <><span className="dash-spinner" /> Uploading</> : 'Upload video'}
            </button>
          )}
        </div>

        {uploadError && <p className="dash-error" role="alert">{uploadError}</p>}

        {!isEmpty && (visible.length > 0 ? (
          <div className="dash-grid">
            {visible.map(({ video, title }) => (
              <VideoCard
                key={video.id}
                video={video}
                title={title}
                onRename={t => renameVideo(video.id, t)}
                onDelete={() => setPendingDelete({ video, title })}
              />
            ))}
          </div>
        ) : (
          <p className="dash-note">No videos match &ldquo;{query}&rdquo;</p>
        ))}
      </main>

      {dragOver && <div className="dash-drop-overlay">Drop your video to upload</div>}

      {pendingDelete && (
        <DeleteDialog
          title={pendingDelete.title}
          clipCount={pendingDelete.video.clip_count ?? 0}
          videoId={pendingDelete.video.id}
          onClose={() => setPendingDelete(null)}
          onDeleted={id => {
            setVideos(prev => prev.filter(x => x.id !== id))
            setPendingDelete(null)
            fetchPlan()
          }}
        />
      )}
    </div>
  )
}

function AccountMenu({ email, planInfo }: { email: string; planInfo: PlanInfo | null }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="dash-avatar" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {email.charAt(0) || '?'}
      </button>
      {open && (
        <div className="dash-popover" role="menu" style={{ minWidth: 220 }}>
          <div className="dash-popover-head">
            <p>{email}</p>
            {planInfo && <p>{planInfo.planName} plan · {planInfo.usage.videos}/{planInfo.maxVideos} videos</p>}
          </div>
          <a href="/pricing" className="dash-menu-item" role="menuitem">Plans &amp; billing</a>
          <button className="dash-menu-item" role="menuitem" onClick={() => signOut({ callbackUrl: '/login' })}>Sign out</button>
        </div>
      )}
    </div>
  )
}

function VideoCard({ video, title, onRename, onDelete }: {
  video: DashVideo
  title: string
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useDismiss(menuOpen, () => setMenuOpen(false))
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(title)
  // Keep the first signed URL — polling returns a fresh signature every 3s,
  // which would otherwise reload the thumbnail each time
  const [thumbSrc, setThumbSrc] = useState<string | null>(null)
  const [thumbLoaded, setThumbLoaded] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)
  useEffect(() => {
    if (!thumbSrc && !thumbFailed && video.status === 'ready' && video.video_url) setThumbSrc(`${video.video_url}#t=1`)
  }, [thumbSrc, thumbFailed, video.status, video.video_url])

  const ready = video.status === 'ready'
  const pct = video.download_progress ?? 0
  const stageLabel =
    pct < 5  ? 'Queued' :
    pct < 46 ? `Downloading ${pct}%` :
    pct < 58 ? `Processing ${pct}%` :
    pct < 70 ? 'Uploading…' :
    pct < 99 ? `Transcribing ${pct}%` : 'Finishing…'

  const created = new Date(video.created_at)
  const dateStr = created.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    ...(created.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  })
  const clips = video.clip_count ?? 0
  const clipLabel = clips === 0 ? 'No clips yet' : `${clips} clip${clips === 1 ? '' : 's'}`
  const durationLabel = video.duration_ms ? formatDuration(video.duration_ms) : null

  function open() {
    if (ready && !renaming) router.push(`/videos/${video.id}`)
  }

  function commitRename() {
    const next = draft.trim()
    setRenaming(false)
    if (next && next !== title) onRename(next)
    else setDraft(title)
  }

  return (
    <div
      className={`vcard${ready ? ' is-ready' : ''}`}
      role={ready ? 'link' : undefined}
      tabIndex={ready ? 0 : -1}
      aria-label={ready ? `Open ${title}` : undefined}
      onClick={open}
      onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) open() }}
    >
      <div className="vcard-thumb">
        {!thumbLoaded && (
          <div className="vcard-placeholder">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 9v6l5-3-5-3z" fill="currentColor" />
            </svg>
          </div>
        )}
        {thumbSrc && (
          <video
            src={thumbSrc}
            preload="metadata"
            muted
            playsInline
            disablePictureInPicture
            onLoadedData={() => setThumbLoaded(true)}
            onError={() => { setThumbFailed(true); setThumbSrc(null) }}
            style={{ opacity: thumbLoaded ? 1 : 0 }}
          />
        )}

        {video.status === 'uploaded' && (
          <div className="vcard-overlay"><span className="dash-spinner" />Queued</div>
        )}
        {video.status === 'transcribing' && (
          <div className="vcard-overlay">
            {stageLabel}
            <div className="dash-progress"><div style={{ width: `${Math.max(4, pct)}%` }} /></div>
          </div>
        )}
        {video.status === 'failed' && (
          <div className="vcard-overlay is-failed">Couldn&apos;t process this video</div>
        )}

        {durationLabel && <span className="vcard-duration">{durationLabel}</span>}
      </div>

      <div ref={menuRef}>
        <button
          className="vcard-menu-btn"
          aria-label={`Options for ${title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
          onKeyDown={e => e.stopPropagation()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
          </svg>
        </button>
        {menuOpen && (
          <div className="dash-popover" role="menu" onClick={e => e.stopPropagation()}>
            <button className="dash-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); setDraft(title); setRenaming(true) }}>
              Rename
            </button>
            <button className="dash-menu-item is-danger" role="menuitem" onClick={() => { setMenuOpen(false); onDelete() }}>
              Delete
            </button>
          </div>
        )}
      </div>

      <div className="vcard-info">
        {renaming ? (
          <input
            className="vcard-rename"
            autoFocus
            maxLength={120}
            aria-label="Video title"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onClick={e => e.stopPropagation()}
            onFocus={e => e.target.select()}
            onBlur={commitRename}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') { setDraft(title); setRenaming(false) }
            }}
          />
        ) : (
          <p className="vcard-title" title={title}>{title}</p>
        )}
        <p className="vcard-meta">
          {video.status === 'failed' ? <span style={{ color: 'var(--danger)' }}>Failed</span> : clipLabel} · {dateStr}
        </p>
      </div>
    </div>
  )
}

function DeleteDialog({ title, clipCount, videoId, onClose, onDeleted }: {
  title: string
  clipCount: number
  videoId: string
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !deleting) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [deleting, onClose])

  async function confirm() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/videos/${videoId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      onDeleted(videoId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setDeleting(false)
    }
  }

  return (
    <div className="dash-modal-backdrop" onClick={() => { if (!deleting) onClose() }}>
      <div className="dash-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onClick={e => e.stopPropagation()}>
        <h2 id="delete-title">Delete &ldquo;{title}&rdquo;?</h2>
        <p>
          This permanently removes the video{clipCount > 0 ? ` and its ${clipCount} clip${clipCount === 1 ? '' : 's'}` : ''}.
          This can&apos;t be undone.
          {error && <><br /><span style={{ color: 'var(--danger)' }}>{error}</span></>}
        </p>
        <div className="dash-modal-actions">
          <button className="dash-btn" onClick={onClose} disabled={deleting} autoFocus>Cancel</button>
          <button className="dash-btn dash-btn-danger" onClick={confirm} disabled={deleting}>
            {deleting ? <><span className="dash-spinner" /> Deleting</> : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatDuration(ms: number) {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
