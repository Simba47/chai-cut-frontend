'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ConfirmOptions {
  title: string
  body?: string
  /** Label of the confirming button (default "Delete") */
  confirmLabel?: string
  /** Label of the other button (default "Cancel") and what it does besides closing */
  cancelLabel?: string
  onCancel?: () => void
  /** A warning rather than a delete: the confirm button isn't red */
  tone?: 'danger' | 'warning'
}

type Pending = ConfirmOptions & { onConfirm: () => void }

/**
 * "Are you sure?" before anything is deleted. `confirm(options, onConfirm)` opens the dialog and
 * runs `onConfirm` only if the user confirms; render `dialog` once in the page.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions, onConfirm: () => void) => void; dialog: React.ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null)
  const confirm = useCallback((options: ConfirmOptions, onConfirm: () => void) => setPending({ ...options, onConfirm }), [])
  const dialog = pending ? <ConfirmDialog {...pending} onClose={() => setPending(null)} /> : null
  return { confirm, dialog }
}

function ConfirmDialog({ title, body, confirmLabel = 'Delete', cancelLabel = 'Cancel', onCancel, tone = 'danger', onConfirm, onClose }: Pending & { onClose: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Focus the confirm button so Enter confirms; Esc cancels. Capture phase so the editor's own
    // shortcuts (Delete, Space…) don't also act while the dialog is open.
    const previous = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
      else if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); previous?.focus?.() }
  }, [onClose])

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 100, background: 'rgba(0,0,0,0.55)' }}
      onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={body ? 'confirm-body' : undefined}
        className="editor-theme flex flex-col gap-3 p-5 rounded-xl"
        style={{ width: 'min(400px, 100%)', background: 'var(--ed-panel, #161616)', border: '1px solid rgb(var(--ed-fg, 255 255 255) / 0.12)', boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}>
        <p id="confirm-title" className="text-sm font-semibold" style={{ color: 'var(--ed-text, #fff)' }}>{title}</p>
        {body && <p id="confirm-body" className="text-xs leading-relaxed" style={{ color: 'rgb(var(--ed-fg, 255 255 255) / 0.6)', whiteSpace: 'pre-line' }}>{body}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={() => { onClose(); onCancel?.() }}
            className="h-9 px-3.5 rounded-lg text-xs font-medium transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]"
            style={{ color: 'rgb(var(--ed-fg, 255 255 255) / 0.75)' }}>{cancelLabel}</button>
          <button ref={confirmRef} onClick={() => { onClose(); onConfirm() }}
            className="h-9 px-3.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90"
            style={tone === 'danger' ? { background: '#ef4444', color: '#fff' } : { background: '#c8ff00', color: '#000' }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
