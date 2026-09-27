import Link from 'next/link'
import { BrandLogo } from '@/components/ui/brand-logo'

/**
 * "Shortcut | Dashboard › Video › …" header trail, matching the editor's breadcrumb,
 * so every page shows where you are. The last item is the current page.
 * (styles: .crumbs in app/globals.css)
 */
export function Breadcrumbs({ items, shine = false }: { items: { label: string; href?: string }[]; shine?: boolean }) {
  return (
    <div className="crumbs">
      <Link href="/dashboard" className="crumbs-brand" aria-label="Shortcut dashboard"><BrandLogo shine={shine} /></Link>
      <span className="crumbs-divider" aria-hidden />
      <nav aria-label="Breadcrumb" className="crumbs-trail">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <span key={i} className="crumbs-item">
              {i > 0 && (
                <svg className="crumbs-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {last || !item.href
                ? <span className="crumbs-current" aria-current={last ? 'page' : undefined} title={item.label}>{item.label}</span>
                : <Link href={item.href} className="crumbs-link" title={item.label}>{item.label}</Link>}
            </span>
          )
        })}
      </nav>
    </div>
  )
}
