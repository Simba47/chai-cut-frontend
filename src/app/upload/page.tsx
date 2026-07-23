'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ACCEPTED_VIDEO_EXTENSIONS, MAX_UPLOAD_BYTES } from '@chai-cut/shared'

type Mode = 'upload' | 'link'

export default function UploadPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [link, setLink] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) validateAndSetFile(dropped)
  }

  function validateAndSetFile(f: File) {
    if (f.size > MAX_UPLOAD_BYTES) { setError('File exceeds the 2 GB limit.'); return }
    const ext = '.' + f.name.split('.').pop()?.toLowerCase()
    if (!ACCEPTED_VIDEO_EXTENSIONS.includes(ext as never)) {
      setError(`Unsupported format. Accepted: ${ACCEPTED_VIDEO_EXTENSIONS.join(', ')}`)
      return
    }
    setError(null)
    setFile(f)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (mode === 'link') {
      if (!link.trim()) return
      setUploading(true)
      try {
        const res = await fetch('/api/ingest/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: link.trim() }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
        const { video_id } = await res.json()
        router.push(`/videos/${video_id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setUploading(false)
      }
      return
    }

    if (!file) return
    setUploading(true)
    setProgress(0)

    try {
      // Step 1: get a signed upload URL (browser → Supabase directly, no server buffer)
      const signRes = await fetch('/api/ingest/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content_type: file.type }),
      })
      if (!signRes.ok) throw new Error((await signRes.json()).error ?? 'Failed to get upload URL')
      const { signed_url, storage_path } = await signRes.json()

      // Step 2: upload directly to Supabase storage with progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', signed_url)
        xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
        xhr.upload.addEventListener('progress', ev => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100))
        })
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`Upload failed (${xhr.status})`))
        })
        xhr.addEventListener('error', () => reject(new Error('Network error')))
        xhr.send(file)
      })

      // Step 3: tell the server the upload is done → creates DB record
      // Read duration from the file so we can store it without a worker round-trip
      let durationMs: number | undefined
      try {
        durationMs = await new Promise<number>((res, rej) => {
          const v = document.createElement('video')
          v.preload = 'metadata'
          const url = URL.createObjectURL(file)
          v.onloadedmetadata = () => { URL.revokeObjectURL(url); res(Math.round(v.duration * 1000)) }
          v.onerror = () => { URL.revokeObjectURL(url); rej(new Error('metadata')) }
          v.src = url
        })
      } catch { /* leave undefined if browser can't read metadata */ }

      const completeRes = await fetch('/api/ingest/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_path, ...(durationMs ? { duration_ms: durationMs } : {}) }),
      })
      if (!completeRes.ok) throw new Error((await completeRes.json()).error ?? 'Failed')
      const { video_id } = await completeRes.json()
      router.push(`/dashboard?video=${video_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setUploading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-6">Add a Video</h1>

        <div className="flex rounded-lg overflow-hidden mb-6" style={{ border: '1px solid var(--border)' }}>
          {(['upload', 'link'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className="flex-1 py-2 text-sm font-medium transition-colors"
              style={{ background: mode === m ? 'var(--accent)' : 'var(--surface)', color: mode === m ? '#fff' : 'var(--text-muted)' }}>
              {m === 'upload' ? 'Upload file' : 'Paste link'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === 'upload' ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className="rounded-xl p-12 text-center cursor-pointer transition-colors"
              style={{ border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`, background: dragOver ? 'rgba(124,58,237,0.06)' : 'var(--surface)' }}
            >
              <input ref={inputRef} type="file" accept={ACCEPTED_VIDEO_EXTENSIONS.join(',')} className="hidden"
                onChange={e => e.target.files?.[0] && validateAndSetFile(e.target.files[0])} />
              {file ? (
                <div>
                  <p className="text-white font-medium">{file.name}</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
              ) : (
                <div>
                  <p className="text-white font-medium">Drop video here or click to browse</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>MP4, MOV, MKV, WebM — up to 2 GB</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-white">Video URL</label>
              <input type="url" value={link} onChange={e => setLink(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..." required={mode === 'link'}
                className="px-3 py-2 rounded-lg text-sm text-white outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Supports YouTube, Instagram, Twitter, and any yt-dlp-compatible URL.
              </p>
            </div>
          )}

          {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}

          {uploading && mode === 'upload' && (
            <div>
              <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                <span>Uploading…</span><span>{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
              </div>
            </div>
          )}

          <button type="submit"
            disabled={uploading || (mode === 'upload' && !file) || (mode === 'link' && !link.trim())}
            className="py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}>
            {uploading
              ? (mode === 'link' ? 'Queuing…' : 'Uploading…')
              : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
