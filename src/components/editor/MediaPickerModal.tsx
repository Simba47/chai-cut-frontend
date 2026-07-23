'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Video } from '@chai-cut/shared'

interface Props {
  clipId: string
  atMs: number
  onInsertVideo: (videoId: string) => void
  onInsertImage: (storagePath: string, url: string) => void
  onClose: () => void
}

type Tab = 'videos' | 'upload' | 'image'

function msToLabel(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function MediaPickerModal({ clipId, atMs, onInsertVideo, onInsertImage, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('videos')
  const [videos, setVideos] = useState<Video[]>([])
  const [loadingVideos, setLoadingVideos] = useState(true)

  // Upload video from device
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUploading, setVideoUploading] = useState(false)
  const [videoProgress, setVideoProgress] = useState(0)
  const [videoError, setVideoError] = useState<string | null>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  // Upload image from device
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sb = createClient()
    sb.from('videos').select('*').eq('status', 'ready').order('created_at', { ascending: false })
      .then(({ data }) => { setVideos((data ?? []) as Video[]); setLoadingVideos(false) })
  }, [])

  // ── Upload video from device ─────────────────────────────────────────────
  async function handleVideoUpload() {
    if (!videoFile) return
    setVideoUploading(true)
    setVideoError(null)
    setVideoProgress(0)
    try {
      // 1. Create video record
      const res = await fetch('/api/ingest/upload-and-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: videoFile.name, size: videoFile.size }),
      })
      // Fall back to the existing upload endpoint via FormData
      const formData = new FormData()
      formData.append('file', videoFile)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/ingest/upload')
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) setVideoProgress(Math.round((e.loaded / e.total) * 100))
      })
      const result = await new Promise<{ video_id: string }>((resolve, reject) => {
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText))
          else reject(new Error('Upload failed'))
        })
        xhr.addEventListener('error', () => reject(new Error('Network error')))
        xhr.send(formData)
      })
      onInsertVideo(result.video_id)
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : 'Upload failed')
      setVideoUploading(false)
    }
  }

  // ── Upload image from device ─────────────────────────────────────────────
  function handleImageFile(f: File) {
    if (!f.type.startsWith('image/')) return
    setImageFile(f)
    setImagePreview(URL.createObjectURL(f))
    setImageError(null)
  }

  async function handleImageUpload() {
    if (!imageFile) return
    setImageUploading(true)
    setImageError(null)
    try {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = imageFile.name.split('.').pop()
      const path = `${user.id}/overlays/${Date.now()}.${ext}`
      const { error } = await sb.storage.from('overlays').upload(path, imageFile, { contentType: imageFile.type })
      if (error) throw new Error(error.message)
      const { data: { publicUrl } } = sb.storage.from('overlays').getPublicUrl(path)
      onInsertImage(path, publicUrl)
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Upload failed')
      setImageUploading(false)
    }
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'videos', label: 'My Videos',
      icon: <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 2h6a1 1 0 0 1 1 1v1.5l2-1.5v6l-2-1.5V9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.2"/></svg>,
    },
    {
      id: 'upload', label: 'Upload Video',
      icon: <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 8V2M3 5l3-3 3 3M2 10h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    },
    {
      id: 'image', label: 'Image',
      icon: <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="4" cy="4" r="1" fill="currentColor"/><path d="M1 8l3-3 2 2 2-2.5L11 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    },
  ]

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden"
        style={{ width: 400, maxHeight: '72vh', background: '#1c1c1c', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-2">
          <div>
            <p className="text-sm font-bold text-white">Insert media</p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>at {msToLabel(atMs)}</p>
          </div>
          <button onClick={onClose} className="flex items-center justify-center rounded-xl" style={{ width: 30, height: 30, background: 'rgba(255,255,255,0.07)' }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="shrink-0 flex px-3 pb-3 gap-1.5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: tab === t.id ? '#7c3aed' : 'rgba(255,255,255,0.06)',
                color: tab === t.id ? '#fff' : 'rgba(255,255,255,0.4)',
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

        {/* ── My Videos tab ─────────────────────────────────────────────── */}
        {tab === 'videos' && (
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {loadingVideos && <p className="text-xs text-center py-10" style={{ color: 'rgba(255,255,255,0.25)' }}>Loading…</p>}
            {!loadingVideos && videos.length === 0 && (
              <div className="py-10 text-center flex flex-col gap-2">
                <p className="text-sm font-medium text-white">No uploaded videos</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)', lineHeight: 1.6 }}>
                  Upload a video from the Upload tab or the Dashboard to use it here as a clip.
                </p>
                <button onClick={() => setTab('upload')} className="mx-auto mt-2 px-4 py-2 rounded-lg text-xs font-semibold text-white" style={{ background: '#7c3aed' }}>
                  Upload video
                </button>
              </div>
            )}
            {videos.map((v, i) => (
              <div key={v.id} className="flex items-center gap-3 p-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="shrink-0 flex items-center justify-center rounded-lg" style={{ width: 56, height: 40, background: '#111' }}>
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" opacity={0.35}><path d="M5 3l13 7-13 7V3z" fill="white"/></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white truncate">Video {i + 1}</p>
                  {v.duration_ms != null && <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{msToLabel(v.duration_ms)}</p>}
                </div>
                <button
                  onClick={() => onInsertVideo(v.id)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold"
                  style={{ background: 'rgba(249,115,22,0.2)', color: '#fb923c', border: '1px solid rgba(249,115,22,0.35)' }}
                >
                  Insert
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Upload Video tab ───────────────────────────────────────────── */}
        {tab === 'upload' && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <input ref={videoInputRef} type="file" accept="video/mp4,video/mov,video/quicktime,video/webm,video/mkv" className="hidden"
              onChange={e => { if (e.target.files?.[0]) setVideoFile(e.target.files[0]) }} />

            {!videoFile ? (
              <button
                onClick={() => videoInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 rounded-2xl py-12"
                style={{ border: '2px dashed rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="w-12 h-12 flex items-center justify-center rounded-2xl" style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 16V8M8 12l4-4 4 4M4 20h16" stroke="#a78bfa" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-white">Choose video from device</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>MP4, MOV, WebM, MKV</p>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)' }}>
                <div className="w-10 h-10 flex items-center justify-center rounded-lg" style={{ background: 'rgba(124,58,237,0.2)' }}>
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M5 3l13 7-13 7V3z" fill="#a78bfa"/></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{videoFile.name}</p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{(videoFile.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
                <button onClick={() => setVideoFile(null)} className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>✕</button>
              </div>
            )}

            {videoUploading && (
              <div>
                <div className="flex justify-between text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <span>Uploading…</span><span>{videoProgress}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${videoProgress}%`, background: '#7c3aed' }} />
                </div>
              </div>
            )}

            {videoError && <p className="text-xs" style={{ color: '#f87171' }}>{videoError}</p>}

            <button
              onClick={handleVideoUpload}
              disabled={!videoFile || videoUploading}
              className="py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', marginTop: 'auto' }}
            >
              {videoUploading ? `Uploading ${videoProgress}%…` : 'Upload & insert'}
            </button>
          </div>
        )}

        {/* ── Image tab ─────────────────────────────────────────────────── */}
        {tab === 'image' && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleImageFile(e.target.files[0]) }} />

            {!imagePreview ? (
              <button
                onClick={() => imageInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 rounded-2xl py-12"
                style={{ border: '2px dashed rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="w-12 h-12 flex items-center justify-center rounded-2xl" style={{ background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.25)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="3" width="18" height="18" rx="3" stroke="#fb923c" strokeWidth="1.6"/>
                    <circle cx="8.5" cy="8.5" r="2" fill="#fb923c"/>
                    <path d="M3 15l5-5 4 4 3-3.5L21 15" stroke="#fb923c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-white">Choose image from gallery</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>JPG, PNG, WebP, GIF</p>
                </div>
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: '16/9', background: '#111' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="preview" className="w-full h-full object-contain" />
                  <button
                    onClick={() => { setImageFile(null); setImagePreview(null) }}
                    className="absolute top-2 right-2 flex items-center justify-center rounded-full"
                    style={{ width: 26, height: 26, background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.15)' }}
                  >
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="white" strokeWidth="1.6" strokeLinecap="round"/></svg>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs flex-1 truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>{imageFile?.name}</p>
                  <button onClick={() => imageInputRef.current?.click()} className="text-xs shrink-0" style={{ color: '#a78bfa' }}>Change</button>
                </div>
              </div>
            )}

            {imageError && <p className="text-xs" style={{ color: '#f87171' }}>{imageError}</p>}

            <button
              onClick={handleImageUpload}
              disabled={!imageFile || imageUploading}
              className="py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)', marginTop: 'auto' }}
            >
              {imageUploading ? 'Uploading…' : 'Insert image'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
