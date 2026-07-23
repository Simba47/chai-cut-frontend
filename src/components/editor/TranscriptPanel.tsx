'use client'

import { useMemo, useState, useRef } from 'react'
import type { TranscriptWord } from '@chai-cut/shared'

interface Props {
  words: TranscriptWord[]
  clipStartMs: number
  clipEndMs: number
  currentTimeMs: number
  onSeek: (ms: number) => void
  onWordChange?: (id: string, text: string) => void
}

interface Sentence {
  words: TranscriptWord[]
  speaker_id: string | null
}

export function TranscriptPanel({ words, clipStartMs, clipEndMs, currentTimeMs, onSeek, onWordChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const clipped = useMemo(
    () => words.filter(w => w.start_ms >= clipStartMs && w.end_ms <= clipEndMs),
    [words, clipStartMs, clipEndMs],
  )

  const sentences = useMemo(() => groupIntoSentences(clipped), [clipped])

  function startEdit(w: TranscriptWord) {
    setEditingId(w.id)
    setEditingText(w.word)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    if (editingId && editingText.trim()) {
      onWordChange?.(editingId, editingText.trim())
    }
    setEditingId(null)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  if (!clipped.length) {
    return (
      <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
        Transcript loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto h-full">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Transcript {onWordChange && <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— double-click a word to edit</span>}
      </p>
      {sentences.map((sent, i) => (
        <div key={i} className="flex flex-col gap-1">
          {sent.speaker_id && (
            <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
              {sent.speaker_id}
            </span>
          )}
          <p className="text-sm leading-relaxed flex flex-wrap gap-0.5">
            {sent.words.map(w => {
              const relStart = w.start_ms - clipStartMs
              const relEnd = w.end_ms - clipStartMs
              const isActive = currentTimeMs >= relStart && currentTimeMs < relEnd

              if (editingId === w.id) {
                return (
                  <input
                    key={w.id}
                    ref={inputRef}
                    value={editingText}
                    onChange={e => setEditingText(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
                      if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                    }}
                    className="rounded px-0.5 text-sm font-medium outline-none"
                    style={{
                      background: 'rgba(0,180,216,0.18)',
                      border: '1px solid rgba(0,180,216,0.5)',
                      color: '#fff',
                      width: `${Math.max(editingText.length, 3) + 1}ch`,
                      minWidth: 32,
                    }}
                  />
                )
              }

              return (
                <span
                  key={w.id}
                  onClick={() => onSeek(relStart)}
                  onDoubleClick={() => onWordChange && startEdit(w)}
                  className="cursor-pointer rounded px-0.5 transition-colors"
                  style={{
                    background: isActive ? 'var(--accent)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--text)',
                    userSelect: 'none',
                  }}
                >
                  {w.word}
                </span>
              )
            })}
          </p>
        </div>
      ))}
    </div>
  )
}

function groupIntoSentences(words: TranscriptWord[]): Sentence[] {
  const sentences: Sentence[] = []
  let current: Sentence = { words: [], speaker_id: null }

  for (const w of words) {
    if (current.words.length > 0 && w.speaker_id !== current.speaker_id) {
      sentences.push(current)
      current = { words: [], speaker_id: w.speaker_id ?? null }
    }
    if (current.speaker_id === null) current.speaker_id = w.speaker_id ?? null
    current.words.push(w)

    if (/[.!?।]$/.test(w.word)) {
      sentences.push(current)
      current = { words: [], speaker_id: null }
    }
  }
  if (current.words.length) sentences.push(current)

  return sentences
}
