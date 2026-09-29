'use client'

import './dashboard.css'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Video } from '@chai-cut/shared'
import { ACCEPTED_VIDEO_EXTENSIONS } from '@chai-cut/shared'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AccountMenu } from '@/components/ui/account-menu'
import { BrandLoader } from '@/components/ui/brand-loader'
import { FillButtonContent } from '@/components/ui/fill-button'
import { useVideoUpload } from '@/modules/upload/useVideoUpload'

type DashVideo = Video & { video_url?: string | null; clip_count?: number; error?: string | null }
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
  const [videos, setVideos] = useState<DashVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null)

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  // Videos waiting for the delete confirmation (one from a card, or several from Select)
  const [pendingDelete, setPendingDelete] = useState<{ video: DashVideo; title: string }[] | null>(null)
  // Select mode: tick several videos, then delete them together
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)
  // Resumable upload straight to storage (see useVideoUpload); problems before it starts
  // (wrong type, too big, plan full) show in uploadError
  const upload = useVideoUpload(videoId => router.push(`/videos/${videoId}`))
  const uploading = upload.state.phase === 'uploading' || upload.state.phase === 'finishing'
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Import from a Google Drive or Dropbox link
  const [link, setLink] = useState('')
  const [importing, setImporting] = useState(false)

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
    // The plan's limit, once it's loaded (the server checks it again either way)
    if (planInfo && f.size > planInfo.maxFileSizeBytes) return `This file is larger than your plan's ${planInfo.maxFileSizeGb} GB limit.`
    const ext = '.' + f.name.split('.').pop()?.toLowerCase()
    if (!ACCEPTED_VIDEO_EXTENSIONS.includes(ext as never)) return `Unsupported format. Accepted: ${ACCEPTED_VIDEO_EXTENSIONS.join(', ')}`
    return null
  }

  function startUpload(f: File) {
    if (uploading) return
    if (atLimit) { setUploadError(`You've used all ${planInfo?.maxVideos} videos on your plan. Delete a video or upgrade to add more.`); return }
    const error = validateFile(f)
    if (error) { setUploadError(error); return }
    setUploadError(null)
    upload.start(f)
  }

  async function importLink(e: React.FormEvent) {
    e.preventDefault()
    const url = link.trim()
    if (!url || importing) return
    if (atLimit) { setUploadError(`You've used all ${planInfo?.maxVideos} videos on your plan. Delete a video or upgrade to add more.`); return }
    setImporting(true)
    setUploadError(null)
    try {
      const res = await fetch('/api/ingest/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not import that link')
      setLink('')
      await fetchVideos() // the new video appears with its download progress
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not import that link')
    } finally {
      setImporting(false)
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

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function stopSelecting() {
    setSelecting(false)
    setSelected(new Set())
  }
  // A video that disappears (deleted elsewhere) can't stay selected
  useEffect(() => {
    setSelected(prev => {
      const live = new Set(videos.map(v => v.id))
      const next = new Set([...prev].filter(id => live.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [videos])
  // Esc leaves select mode (unless the delete dialog is open — it handles Esc itself)
  useEffect(() => {
    if (!selecting || pendingDelete) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stopSelecting() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selecting, pendingDelete])

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
        <BrandLoader label="Loading your videos…" />
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
        <Breadcrumbs shine items={[{ label: 'Dashboard' }]} />
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
          {planInfo?.plan === 'free' && (
            <a href="/pricing" className="dash-btn-fill fill-btn fill-btn-sm"><FillButtonContent>Upgrade</FillButtonContent></a>
          )}
          <AccountMenu planInfo={planInfo} />
        </div>
      </nav>

      <main className={`dash-main${selecting ? ' has-selectbar' : ''}`}>
        {!isEmpty && (
          <div className="dash-head">
            <h1><span className="dash-title">Your videos</span><span className="dash-count">{videos.length}</span></h1>
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
              <SortMenu value={sort} onChange={setSort} />
              <button
                type="button"
                className={`dash-sort-btn dash-select-toggle${selecting ? ' is-on' : ''}`}
                aria-pressed={selecting}
                onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              >
                {selecting ? 'Done' : 'Select'}
              </button>
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
            {upload.state.phase === 'failed' ? (
              <>
                <p>{upload.state.canRetry ? 'Upload paused' : 'Upload stopped'} · {upload.state.fileName}{upload.state.canRetry ? ` · ${upload.state.progress}%` : ''}</p>
                <p className="dash-drop-error" role="alert">{upload.state.error}</p>
                <div className="dash-progress"><div style={{ width: `${upload.state.progress}%` }} /></div>
              </>
            ) : uploading ? (
              <>
                <p>
                  {upload.state.phase === 'finishing' ? `Finishing ${upload.state.fileName}…` : `Uploading ${upload.state.fileName}… ${upload.state.progress}%`}
                </p>
                <p>Keep this tab open. If the connection drops, the upload continues where it stopped.</p>
                <div className="dash-progress"><div style={{ width: `${upload.state.progress}%` }} /></div>
              </>
            ) : atLimit ? (
              <>
                <p>You&apos;ve used all {planInfo?.maxVideos} videos on your {planInfo?.planName} plan</p>
                <p>Delete a video to free up space, or <a href="/pricing">upgrade your plan</a>.</p>
              </>
            ) : (
              <>
                <p>{isEmpty ? 'Upload your first video' : 'Drag and drop a video anywhere on this page'}</p>
                <p>MP4, MOV, MKV, WebM{planInfo ? ` · up to ${planInfo.maxFileSizeGb} GB` : ''}{isEmpty ? ' · we’ll transcribe it so you can cut clips' : ''}</p>
              </>
            )}
          </div>
          {upload.state.phase === 'failed' ? (
            <div className="dash-drop-actions">
              <button type="button" className="dash-link-btn" onClick={upload.cancel}>{upload.state.canRetry ? 'Cancel' : 'OK'}</button>
              {upload.state.canRetry && (
                <button type="button" className="dash-upload-btn dash-upload-btn--plain" onClick={upload.retry}>Retry</button>
              )}
            </div>
          ) : upload.state.phase === 'uploading' ? (
            <button type="button" className="dash-link-btn" onClick={upload.cancel}>Cancel</button>
          ) : null}
          {!atLimit && upload.state.phase === 'idle' && (
            <button className="dash-upload-btn" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {/* Arrow flies out to the top-right on hover while a copy slides in from the bottom-left */}
              <span className="dash-upload-icon" aria-hidden>
                {uploading ? <span className="dash-spinner" /> : (
                  <>
                    <svg viewBox="0 0 14 15" width="10" fill="none" className="dash-upload-arrow"><path d="M13.376 11.552l-.264-10.44-10.44-.24.024 2.28 6.96-.048L.2 12.56l1.488 1.488 9.432-9.432-.048 6.912 2.304.024z" fill="currentColor" /></svg>
                    <svg viewBox="0 0 14 15" width="10" fill="none" className="dash-upload-arrow dash-upload-arrow--copy"><path d="M13.376 11.552l-.264-10.44-10.44-.24.024 2.28 6.96-.048L.2 12.56l1.488 1.488 9.432-9.432-.048 6.912 2.304.024z" fill="currentColor" /></svg>
                  </>
                )}
              </span>
              {uploading ? 'Uploading' : 'Upload video'}
            </button>
          )}
        </div>

        {!atLimit && (
          <form className="dash-import" onSubmit={importLink}>
            <label htmlFor="dash-import-link">Or import from a link</label>
            <input
              id="dash-import-link"
              className="dash-import-input"
              type="url"
              inputMode="url"
              placeholder="Paste a Google Drive or Dropbox link to a video"
              value={link}
              onChange={e => setLink(e.target.value)}
              disabled={importing}
            />
            <button type="submit" className="dash-link-btn" disabled={!link.trim() || importing}>
              {importing ? 'Importing…' : 'Import'}
            </button>
            <span className="dash-import-hint">
              Set sharing to &ldquo;Anyone with the link&rdquo;. YouTube import is coming soon.
            </span>
          </form>
        )}

        {uploadError && <p className="dash-error" role="alert">{uploadError}</p>}

        {!isEmpty && (visible.length > 0 ? (
          <div className="dash-grid">
            {visible.map(({ video, title }) => (
              <VideoCard
                key={video.id}
                video={video}
                title={title}
                selecting={selecting}
                selected={selected.has(video.id)}
                onToggle={() => toggleSelected(video.id)}
                onRename={t => renameVideo(video.id, t)}
                onDelete={() => setPendingDelete([{ video, title }])}
              />
            ))}
          </div>
        ) : (
          <p className="dash-note">No videos match &ldquo;{query}&rdquo;</p>
        ))}
      </main>

      {dragOver && <div className="dash-drop-overlay">Drop your video to upload</div>}

      {/* Select mode: what's ticked, and what to do with it */}
      {selecting && (() => {
        const allIds = visible.map(x => x.video.id)
        const allOn = allIds.length > 0 && allIds.every(id => selected.has(id))
        return (
          <div className="dash-selectbar" role="toolbar" aria-label="Selected videos">
            <span className="dash-selectbar-count" aria-live="polite">
              {selected.size === 0 ? 'Tap videos to select them' : `${selected.size} selected`}
            </span>
            <button type="button" className="dash-link-btn"
              onClick={() => setSelected(allOn ? new Set() : new Set(allIds))} disabled={allIds.length === 0}>
              {allOn ? 'Clear' : `Select all (${allIds.length})`}
            </button>
            <button type="button" className="dash-link-btn" onClick={stopSelecting}>Cancel</button>
            <button type="button" className="dash-btn dash-btn-danger" disabled={selected.size === 0}
              onClick={() => setPendingDelete(visible.filter(x => selected.has(x.video.id)).map(x => ({ video: x.video, title: x.title })))}>
              Delete{selected.size > 0 ? ` ${selected.size}` : ''}
            </button>
          </div>
        )
      })()}

      {pendingDelete && pendingDelete.length > 0 && (
        <DeleteDialog
          items={pendingDelete.map(p => ({ id: p.video.id, title: p.title, clipCount: p.video.clip_count ?? 0 }))}
          onClose={() => setPendingDelete(null)}
          onDeleted={ids => {
            const gone = new Set(ids)
            setVideos(prev => prev.filter(x => !gone.has(x.id)))
            setPendingDelete(null)
            if (selecting) stopSelecting()
            fetchPlan()
          }}
        />
      )}
    </div>
  )
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name' },
]

// Brand-styled replacement for the native <select> (whose open list can't be styled).
// Keyboard: ↑/↓ move, Enter/Space pick, Esc closes.
function SortMenu({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useDismiss(open, () => setOpen(false))
  const buttonRef = useRef<HTMLButtonElement>(null)
  const current = SORT_OPTIONS.find(o => o.value === value) ?? SORT_OPTIONS[0]

  function openMenu() {
    setActive(SORT_OPTIONS.findIndex(o => o.value === value))
    setOpen(true)
  }
  function pick(v: SortKey) {
    onChange(v)
    setOpen(false)
    buttonRef.current?.focus()
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % SORT_OPTIONS.length) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + SORT_OPTIONS.length) % SORT_OPTIONS.length) }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(SORT_OPTIONS[active].value) }
    if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={ref} className="dash-sort" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="dash-sort-btn"
        aria-label={`Sort videos: ${current.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        {current.label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="dash-popover dash-sort-list" role="listbox" aria-label="Sort videos" aria-activedescendant={`sort-${SORT_OPTIONS[active].value}`}>
          {SORT_OPTIONS.map((o, i) => (
            <li
              key={o.value}
              id={`sort-${o.value}`}
              role="option"
              aria-selected={o.value === value}
              className={`dash-menu-item${i === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              {o.label}
              {o.value === value && (
                <svg className="dash-sort-check" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function VideoCard({ video, title, selecting, selected, onToggle, onRename, onDelete }: {
  video: DashVideo
  title: string
  /** Select mode: the whole card toggles its tick; rename, delete and "Make clips" step aside */
  selecting: boolean
  selected: boolean
  onToggle: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
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

  function commitRename() {
    const next = draft.trim()
    setRenaming(false)
    if (next && next !== title) onRename(next)
    else setDraft(title)
  }

  return (
    <div
      className={`vcard${ready ? ' is-ready' : ''}${selecting ? ' is-selecting' : ''}${selected ? ' is-selected' : ''}`}
      {...(selecting ? {
        role: 'checkbox',
        'aria-checked': selected,
        'aria-label': `Select ${title}`,
        tabIndex: 0,
        onClick: onToggle,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle() } },
      } : {})}
    >
      {selecting && (
        <span className="vcard-check" aria-hidden="true">
          {selected && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      )}
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
          <div className="vcard-overlay is-failed">{video.error || 'Couldn’t process this video'}</div>
        )}


        {/* Details on the thumbnail: date (top-left), clips (bottom-left), length (bottom-right) */}
        {!selecting && <span className="vcard-chip vcard-date">{dateStr}</span>}
        {ready && (
          <span className="vcard-chip vcard-clips">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="6" cy="6" r="3" stroke="currentColor" strokeWidth="2" /><circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
              <path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {clipLabel}
          </span>
        )}
        {durationLabel && <span className="vcard-chip vcard-duration">{durationLabel}</span>}
      </div>

      {/* Quick actions: frosted pill in the thumbnail's top-right corner */}
      {!selecting && <div className="vcard-actions" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <button
          type="button"
          className="vcard-action"
          aria-label={`Rename ${title}`}
          title="Rename"
          onClick={() => { setDraft(title); setRenaming(true) }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M13.5 8.5l2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="vcard-action is-danger"
          aria-label={`Delete ${title}`}
          title="Delete"
          onClick={onDelete}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>}

      <div className="vcard-info">
        <div className="vcard-text">
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
        </div>
        {/* The only way into the clip picker, so a stray click on the card doesn't navigate */}
        {ready && !selecting && (
          <Link href={`/videos/${video.id}`} className="vcard-open fill-btn fill-btn-sm" aria-label={`Make clips from ${title}`}>
            <FillButtonContent icon="scissors">Make clips</FillButtonContent>
          </Link>
        )}
      </div>
    </div>
  )
}

// Confirms deleting one video (from its card) or several (from Select), then deletes them together
function DeleteDialog({ items, onClose, onDeleted }: {
  items: { id: string; title: string; clipCount: number }[]
  onClose: () => void
  onDeleted: (ids: string[]) => void
}) {
  const one = items.length === 1
  const clipCount = items.reduce((n, it) => n + it.clipCount, 0)
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
      const ids = items.map(it => it.id)
      const res = await fetch('/api/videos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Delete failed')
      onDeleted(ids)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setDeleting(false)
    }
  }

  return (
    <div className="dash-modal-backdrop" onClick={() => { if (!deleting) onClose() }}>
      <div className="dash-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onClick={e => e.stopPropagation()}>
        <h2 id="delete-title">{one ? <>Delete &ldquo;{items[0].title}&rdquo;?</> : `Delete ${items.length} videos?`}</h2>
        <p>
          This permanently removes {one ? 'the video' : `${items.length} videos`}
          {clipCount > 0 ? ` and ${one ? 'its' : 'their'} ${clipCount} clip${clipCount === 1 ? '' : 's'}` : ''}.
          This can&apos;t be undone.
          {error && <><br /><span style={{ color: 'var(--danger)' }}>{error}</span></>}
        </p>
        <div className="dash-modal-actions">
          <button className="dash-btn" onClick={onClose} disabled={deleting} autoFocus>Cancel</button>
          <button className="dash-btn dash-btn-danger" onClick={confirm} disabled={deleting}>
            {deleting ? <><span className="dash-spinner" /> Deleting</> : one ? 'Delete' : `Delete ${items.length} videos`}
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
