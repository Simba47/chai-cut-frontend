'use client'

import { useEffect, useRef, useState } from 'react'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AccountMenu } from '@/components/ui/account-menu'
import { BrandLoaderScreen } from '@/components/ui/brand-loader'
import { useBrandKits, BrandKitStudio, KitBadge } from '@/components/editor/BrandKit'
import { BrandSetup } from '@/components/brand/BrandSetup'
import type { BrandKit } from '@/lib/shared/brandKit'

/**
 * Brand kits (user, 2026-10-26): every kit of the account in one place, outside the editor — each one
 * a card (its logo, colours, name; Default; shared by someone), a new one set up in a minute
 * (BrandSetup), any one opened in the full kit editor (BrandKitStudio). ?kit=<id>&view=setup|edit
 * opens one straight away (the editor and Make my clips link here). Styles: .bk-* in globals.css.
 */
type View = { mode: 'list' } | { mode: 'setup' | 'edit'; id: string }

export default function BrandPage() {
  const brand = useBrandKits()
  const [view, setViewState] = useState<View>({ mode: 'list' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<BrandKit | null>(null)
  // (the kits as they are now, for reading the address on back / forward)
  const kitsRef = useRef(brand.kits)
  kitsRef.current = brand.kits

  /** A view, kept in the address too (back and reload come back to it) */
  function setView(v: View, push = true) {
    setViewState(v)
    const q = v.mode === 'list' ? '' : `?kit=${v.id}&view=${v.mode}`
    if (push && `${window.location.search}` !== q) window.history.pushState(null, '', `/brand${q}`)
    if (v.mode !== 'list') brand.select(v.id)
  }
  // From the address (a link in, back / forward)
  useEffect(() => {
    if (brand.loading) return
    const read = () => {
      const p = new URLSearchParams(window.location.search)
      const id = p.get('kit'), mode = p.get('view')
      if (id && (mode === 'setup' || mode === 'edit') && kitsRef.current.some(k => k.id === id)) setView({ mode, id }, false)
      else {
        setView({ mode: 'list' }, false)
        // (a link to a kit that isn't there any more: the address says the list too)
        if (window.location.search) window.history.replaceState(null, '', '/brand')
      }
    }
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [brand.loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const own = brand.kits.filter(k => !k.shared_by)
  const shared = brand.kits.filter(k => k.shared_by)
  const atLimit = own.length >= brand.limit
  const hasDefault = own.some(k => k.data.is_default)

  async function newKit() {
    if (busy || atLimit) return
    setBusy(true); setError(null)
    try {
      const kit = await brand.create()
      // (the first brand is the one new clips get)
      if (!hasDefault) brand.update(kit.id, { data: { ...kit.data, is_default: true } })
      setView({ mode: 'setup', id: kit.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }
  /** One kit the default: the others aren't any more (the server keeps just one too) */
  function makeDefault(kit: BrandKit) {
    for (const k of own) if (k.id !== kit.id && k.data.is_default) brand.update(k.id, { data: { ...k.data, is_default: false } })
    brand.update(kit.id, { data: { ...kit.data, is_default: true } })
  }
  async function remove(kit: BrandKit) {
    setConfirm(null); setError(null)
    try { await (kit.shared_by ? brand.leave(kit.id) : brand.remove(kit.id)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  // The open kit gone (deleted or left in another tab): back to the list, not another kit
  const openId = view.mode === 'list' ? null : view.id
  useEffect(() => {
    if (openId && !brand.loading && !brand.kits.some(k => k.id === openId)) {
      setViewState({ mode: 'list' })
      window.history.replaceState(null, '', '/brand')
    }
  }, [openId, brand.kits, brand.loading])

  // Esc closes the delete box
  useEffect(() => {
    if (!confirm) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirm(null) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [confirm])

  if (brand.loading) return <BrandLoaderScreen label="Opening your brand kits…" />

  return (
    <div className="bk editor-theme min-h-screen flex flex-col">
      <nav className="bk-nav">
        <Breadcrumbs shine items={view.mode === 'list'
          ? [{ label: 'Dashboard', href: '/dashboard' }, { label: 'Brand kits' }]
          : [{ label: 'Dashboard', href: '/dashboard' }, { label: 'Brand kits', href: '/brand' }, { label: brand.current?.name || 'Brand kit' }]} />
        <div className="flex-1" />
        <AccountMenu />
      </nav>

      {view.mode !== 'list' && brand.current?.id === view.id ? (
        <div className="bk-work">
          {view.mode === 'setup'
            ? <BrandSetup brand={brand} onDone={() => setView({ mode: 'list' })} onMore={() => setView({ mode: 'edit', id: view.id })} />
            : <BrandKitStudio brand={brand} onClose={() => setView({ mode: 'list' })} closeLabel="Back to your brand kits" />}
        </div>
      ) : (
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
          <header className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[240px]">
              <h1 className="bk-title">Brand kits</h1>
              <p className="bk-sub">Your logo, colours and caption look — set once, on every clip you make.</p>
            </div>
            {own.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="bk-count">{own.length} of {brand.limit} on your plan</span>
                <button type="button" onClick={newKit} disabled={busy || atLimit} className="bk-primary" title={atLimit ? 'Your plan has room for no more kits' : undefined}>
                  {busy ? 'Making it…' : '+ New brand kit'}
                </button>
              </div>
            )}
          </header>

          {(error || brand.error) && <div className="bk-alert" role="alert">{error ?? brand.error}</div>}
          {atLimit && own.length > 0 && (
            <p className="bk-note">Your plan has room for {brand.limit} brand kit{brand.limit > 1 ? 's' : ''}. <a href="/pricing">Upgrade</a> for more — one per client or channel.</p>
          )}

          {own.length === 0 && !brand.error ? (
            // First time: one big way in
            <section className="bk-empty">
              <span className="bk-empty-ico" aria-hidden="true">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r="2" /><circle cx="17.5" cy="10.5" r="2" /><circle cx="8.5" cy="7.5" r="2" /><circle cx="6.5" cy="12.5" r="2" /><path d="M12 22a10 10 0 110-20 9 9 0 019 9c0 3-2 4-4 4h-2a2 2 0 00-1 3.7A2 2 0 0112 22z" /></svg>
              </span>
              <h2>Set up your brand in a minute</h2>
              <p>Paste your website or Instagram link — we bring in your logo and colours. Pick a caption look, and every new clip comes out on-brand.</p>
              <button type="button" onClick={newKit} disabled={busy} className="bk-primary bk-primary-lg">{busy ? 'Getting it ready…' : 'Set up my brand'}</button>
            </section>
          ) : (
            <div className="bk-grid">
              {own.map(k => <KitCard key={k.id} kit={k} onEdit={() => setView({ mode: 'edit', id: k.id })} onSetup={() => setView({ mode: 'setup', id: k.id })}
                onDefault={() => makeDefault(k)} onDelete={() => setConfirm(k)} />)}
            </div>
          )}

          {shared.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="bk-h2">Shared with you</h2>
              <div className="bk-grid">
                {shared.map(k => <KitCard key={k.id} kit={k} onEdit={() => setView({ mode: 'edit', id: k.id })} onDelete={() => setConfirm(k)} />)}
              </div>
            </section>
          )}
        </main>
      )}

      {confirm && (
        <div className="bk-modal" role="dialog" aria-modal="true" aria-labelledby="bk-del-title" onClick={() => setConfirm(null)}>
          <div className="bk-modal-box" onClick={e => e.stopPropagation()}>
            <h2 id="bk-del-title">{confirm.shared_by ? `Stop using “${confirm.name}”?` : `Delete “${confirm.name}”?`}</h2>
            <p>{confirm.shared_by
              ? `${confirm.shared_by} shared it with you. You can be added again later.`
              : 'Clips that already have this brand keep their logo and styles. This can’t be undone.'}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="bk-ghost" onClick={() => setConfirm(null)} autoFocus>Cancel</button>
              <button type="button" className="bk-danger" onClick={() => remove(confirm)}>{confirm.shared_by ? 'Stop using it' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** A kit on the Brand kits page: what it looks like, and what can be done with it */
function KitCard({ kit, onEdit, onSetup, onDefault, onDelete }: {
  kit: BrandKit; onEdit: () => void; onSetup?: () => void; onDefault?: () => void; onDelete: () => void
}) {
  const d = kit.data
  const colors = [d.colors.main, d.colors.accent, ...d.colors.extra]
  const started = !!d.logo.path || d.captions.on || !!d.handle
  return (
    <article className="bk-card" data-default={d.is_default || undefined}>
      <button type="button" className="bk-card-face" onClick={onEdit} aria-label={`Open ${kit.name}`}>
        <span className="bk-card-logo" style={{ background: d.colors.main }}>
          {d.logo.path && kit.logo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={kit.logo_url} alt="" />
            : <KitBadge kit={kit} />}
        </span>
        <span className="bk-card-body">
          <span className="bk-card-name">{kit.name}</span>
          <span className="bk-card-meta">
            {kit.shared_by ? `Shared by ${kit.shared_by}` : d.handle ? `@${d.handle}` : 'No @handle yet'}
          </span>
          <span className="bk-card-colors" aria-label="Brand colours">
            {colors.map((c, i) => <i key={`${c}-${i}`} style={{ background: c }} />)}
          </span>
        </span>
      </button>
      <div className="bk-card-foot">
        {d.is_default && !kit.shared_by
          ? <span className="bk-tag" title="New clips — and Make my clips — get this brand by themselves">Default</span>
          : onDefault && <button type="button" className="bk-link" onClick={onDefault} title="New clips — and Make my clips — get this brand by themselves">Make default</button>}
        <span className="flex-1" />
        {onSetup && !started && <button type="button" className="bk-link bk-link-strong" onClick={onSetup}>Finish setup</button>}
        <button type="button" className="bk-link" onClick={onEdit}>{kit.shared_by ? 'View' : 'Edit'}</button>
        <button type="button" className="bk-link bk-link-quiet" onClick={onDelete}>{kit.shared_by ? 'Leave' : 'Delete'}</button>
      </div>
    </article>
  )
}
