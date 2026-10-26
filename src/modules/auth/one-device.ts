import crypto from 'node:crypto'
import sql from '@/lib/db'

// ── One device per account ────────────────────────────────────────────────────
// Each sign-in gets a new id, kept in users.session_id and in that device's session (its JWT
// cookie). A session whose id isn't the account's current one was replaced by a sign-in on another
// device: it is signed out (auth.ts marks it `replaced`, the site sends it to /api/auth/signed-out).
// Sessions from before this rule have no id: they count until the account next signs in.

/** How long a looked-up id is trusted: a replaced device is signed out within this (plus its next request) */
const CHECK_TTL_MS = 10_000
const current = new Map<string, { sid: string | null; at: number }>()

/** Make a new sign-in the account's only one; its id (undefined when it can't be kept: no rule then) */
export async function startSession(userId: string): Promise<string | undefined> {
  const sid = crypto.randomUUID()
  try {
    await sql`UPDATE users SET session_id = ${sid} WHERE id = ${userId}`
    current.set(userId, { sid, at: Date.now() })
    return sid
  } catch (err) {
    console.error('[auth] Could not record the sign-in:', err instanceof Error ? err.message : err)
    return undefined
  }
}

/** Is this the account's current sign-in? (Yes when the database can't say: a hiccup never signs anyone out) */
export async function isCurrentSession(userId: string, sid: string | undefined): Promise<boolean> {
  // The remembered id is trusted only when it agrees. One that disagrees is looked up again before
  // anyone is signed out: with several copies of the website, the new sign-in may have been made on
  // another copy a moment ago (startSession), and this copy's memory is then out of date.
  const known = current.get(userId)
  if (known && Date.now() - known.at <= CHECK_TTL_MS && (known.sid === null || known.sid === sid)) return true
  try {
    const [u] = await sql<{ session_id: string | null }[]>`SELECT session_id FROM users WHERE id = ${userId}`
    if (!u) return false   // the account was deleted
    current.set(userId, { sid: u.session_id, at: Date.now() })
    return u.session_id === null || u.session_id === sid
  } catch {
    return true
  }
}
