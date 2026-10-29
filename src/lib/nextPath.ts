/**
 * Where to go after signing in or up: the page that sent someone to sign in (NextAuth's ?callbackUrl —
 * e.g. a brand kit invite link, /brand?invite=…), kept for the session so it outlives switching to sign
 * up and the email code. Only a page of this site; anything else is ignored (the dashboard then).
 */
const KEY = 'shortcut:next'

/** This site's path from a link, or null when it isn't one */
export function samePath(link: string | null, origin: string): string | null {
  if (!link) return null
  try {
    const u = new URL(link, origin)
    if (u.origin !== origin || !u.pathname.startsWith('/') || u.pathname.startsWith('//')) return null
    return `${u.pathname}${u.search}`
  } catch { return null }
}

/** Kept from the sign-in page's address, if it has one */
export function keepNextPath() {
  const path = samePath(new URLSearchParams(window.location.search).get('callbackUrl'), window.location.origin)
  try { if (path && path !== '/' && !path.startsWith('/login') && !path.startsWith('/signup')) sessionStorage.setItem(KEY, path) } catch { /* private window */ }
}

/** Where to go now (and forgotten): the page kept, else the dashboard */
export function takeNextPath(): string {
  try {
    const path = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return samePath(path, window.location.origin) ?? '/dashboard'
  } catch { return '/dashboard' }
}
