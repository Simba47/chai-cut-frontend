import sql from '@/lib/db'
import { hashPassword, validatePassword, verifyPassword } from '@/modules/auth/password'
import { deleteR2Keys, proxyKeyFor } from './videos'
import { getUserPlanConfig } from './quota'

/**
 * Account settings: read the profile, change the name, change the password, delete the account.
 * Used by /api/account and /api/account/password, and the /settings page.
 */

const MAX_NAME = 60

export interface AccountInfo {
  email: string
  name: string | null
  /** When the email was confirmed (signup OTP) */
  emailVerified: string | null
  planName: string
  /** Signed up with a password (not only a sign-in provider), so it can be changed here */
  hasPassword: boolean
}

export async function getAccount(userId: string): Promise<AccountInfo> {
  const [row] = await sql<{ email: string; name: string | null; emailVerified: Date | null; password_hash: string | null }[]>`
    SELECT email, name, "emailVerified", password_hash FROM users WHERE id = ${userId}
  `
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 })
  const plan = await getUserPlanConfig(userId)
  return {
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerified ? new Date(row.emailVerified).toISOString() : null,
    planName: plan.name,
    hasPassword: !!row.password_hash,
  }
}

/** Your name, as shown on the profile button and menu. Empty clears it (the email's name shows). */
export async function updateName(userId: string, raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string') throw Object.assign(new Error('Name must be text'), { status: 400 })
  // One line, no control characters, trimmed
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  if (name.length > MAX_NAME) throw Object.assign(new Error(`Keep your name under ${MAX_NAME} characters`), { status: 400 })
  const value = name || null
  await sql`UPDATE users SET name = ${value} WHERE id = ${userId}`
  return value
}

/** Change the password: the current one must be right, and the new one must pass the same rules as signup */
export async function changePassword(userId: string, current: unknown, next: unknown): Promise<void> {
  if (typeof current !== 'string' || typeof next !== 'string' || !current || !next) {
    throw Object.assign(new Error('Enter your current password and a new one'), { status: 400 })
  }
  const [row] = await sql<{ password_hash: string | null }[]>`SELECT password_hash FROM users WHERE id = ${userId}`
  if (!row?.password_hash) throw Object.assign(new Error('This account has no password to change'), { status: 400 })
  if (!(await verifyPassword(current, row.password_hash))) {
    throw Object.assign(new Error('Your current password is not right'), { status: 400 })
  }
  if (current === next) throw Object.assign(new Error('Choose a password different from the current one'), { status: 400 })
  const problem = validatePassword(next)
  if (problem) throw Object.assign(new Error(problem), { status: 400 })
  await sql`UPDATE users SET password_hash = ${await hashPassword(next)} WHERE id = ${userId}`
}

/**
 * Delete the account and everything in it, for good: every stored file (uploads, their cached
 * audio, every clip's export), then every row that belongs to the user (videos with their clips,
 * subscriptions, logs…), then the user. Needs the password (when the account has one) as a check.
 */
export async function deleteAccount(userId: string, password: unknown): Promise<void> {
  const [row] = await sql<{ password_hash: string | null }[]>`SELECT password_hash FROM users WHERE id = ${userId}`
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 })
  if (row.password_hash) {
    if (typeof password !== 'string' || !(await verifyPassword(password, row.password_hash))) {
      throw Object.assign(new Error('Your password is not right'), { status: 400 })
    }
  }

  // Files first (best effort: a missing file shouldn't keep the account alive)
  const videos = await sql<{ storage_path: string | null }[]>`SELECT storage_path FROM videos WHERE user_id = ${userId}`
  const clipOutputs = await sql<{ output_storage_path: string }[]>`
    SELECT c.output_storage_path FROM clips c JOIN videos v ON v.id = c.video_id
    WHERE v.user_id = ${userId} AND c.output_storage_path IS NOT NULL
  `
  const keys: string[] = []
  for (const v of videos) {
    if (!v.storage_path) continue
    // (_audio.flac: the sound kept for captions; _reading.json: a whole-video reading that stopped part-way)
    keys.push(v.storage_path, v.storage_path.replace(/\.[^.]+$/, '_audio.flac'), v.storage_path.replace(/\.[^.]+$/, '_reading.json'), proxyKeyFor(v.storage_path))
  }
  for (const c of clipOutputs) keys.push(c.output_storage_path)
  await deleteR2Keys(keys)

  // Then every row pointing at the user, found from the database's own foreign keys (so a table
  // added later is covered too), then the user. One transaction: all of it or none of it.
  await sql.begin(async tx => {
    const refs = await tx<{ tbl: string; col: string }[]>`
      SELECT cl.relname AS tbl, att.attname AS col
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = ANY(c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass
    `
    // Videos first: their clips, formats, captions… go with them (cascade)
    refs.sort((a, b) => (a.tbl === 'videos' ? -1 : b.tbl === 'videos' ? 1 : 0))
    for (const r of refs) await tx`DELETE FROM ${tx(r.tbl)} WHERE ${tx(r.col)} = ${userId}`
    // Tables that keep user_id without a foreign key
    await tx`DELETE FROM videos WHERE user_id = ${userId}`
    for (const t of ['subscriptions', 'suggestion_events']) {
      const [has] = await tx`SELECT 1 FROM information_schema.columns WHERE table_name = ${t} AND column_name = 'user_id'`
      if (has) await tx`DELETE FROM ${tx(t)} WHERE user_id = ${userId}`
    }
    await tx`DELETE FROM users WHERE id = ${userId}`
  })
}
