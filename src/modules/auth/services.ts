import crypto from 'node:crypto'
import sql from '@/lib/db'
import { hashPassword, validatePassword } from './password'
import { generateOtp, hashOtp, verifyOtpHash } from './otp'
import { sendOtpEmail } from './mailer'

const OTP_TTL_MS = 10 * 60 * 1000   // 10 minutes
const MAX_ATTEMPTS = 5

// ── Signup ────────────────────────────────────────────────────────────────────

export async function signupUser(email: string, password: string): Promise<void> {
  const norm = email.toLowerCase().trim()

  const pwErr = validatePassword(password)
  if (pwErr) throw Object.assign(new Error(pwErr), { status: 400 })

  const [existing] = await sql`
    SELECT id, "emailVerified" FROM users WHERE email = ${norm}
  `

  if (existing?.emailVerified) {
    throw Object.assign(new Error('An account with this email already exists'), { status: 409 })
  }

  const passwordHash = await hashPassword(password)

  if (existing) {
    // Unverified account — update password and resend OTP
    await sql`UPDATE users SET password_hash = ${passwordHash} WHERE email = ${norm}`
  } else {
    await sql`
      INSERT INTO users (id, email, password_hash)
      VALUES (${crypto.randomUUID()}, ${norm}, ${passwordHash})
    `
  }

  await issueOtp(norm, 'signup')
}

// ── OTP issue / verify ────────────────────────────────────────────────────────

export async function issueOtp(
  email: string,
  purpose: 'signup' | 'password_reset',
): Promise<void> {
  await sql`DELETE FROM verification_otps WHERE email = ${email} AND purpose = ${purpose}`

  const otp = generateOtp()
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  await sql`
    INSERT INTO verification_otps (email, otp_hash, purpose, expires_at)
    VALUES (${email}, ${hashOtp(otp)}, ${purpose}, ${expiresAt})
  `

  await sendOtpEmail(email, otp, purpose)
}

export async function verifyOtp(
  email: string,
  otp: string,
  purpose: 'signup' | 'password_reset',
): Promise<void> {
  const norm = email.toLowerCase().trim()

  const [row] = await sql`
    SELECT id, otp_hash, attempts, expires_at
    FROM verification_otps
    WHERE email = ${norm} AND purpose = ${purpose}
    ORDER BY created_at DESC LIMIT 1
  `

  if (!row) {
    throw Object.assign(new Error('No code found. Please request a new one.'), { status: 400 })
  }
  if (new Date(row.expires_at) < new Date()) {
    throw Object.assign(new Error('Code expired. Please request a new one.'), { status: 400 })
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    throw Object.assign(new Error('Too many attempts. Please request a new code.'), { status: 429 })
  }

  // Increment attempt before checking — prevents brute-force timing attacks
  await sql`UPDATE verification_otps SET attempts = attempts + 1 WHERE id = ${row.id}`

  if (!verifyOtpHash(otp.trim(), row.otp_hash)) {
    const left = MAX_ATTEMPTS - (Number(row.attempts) + 1)
    const msg = left > 0
      ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} remaining.`
      : 'Too many incorrect attempts. Please request a new code.'
    throw Object.assign(new Error(msg), { status: 400 })
  }

  // Valid — consume it
  await sql`DELETE FROM verification_otps WHERE id = ${row.id}`

  if (purpose === 'signup') {
    await sql`UPDATE users SET "emailVerified" = NOW() WHERE email = ${norm}`
  }
}

// ── Password reset ────────────────────────────────────────────────────────────

export async function requestPasswordReset(email: string): Promise<void> {
  const norm = email.toLowerCase().trim()
  // Don't reveal whether the email exists
  const [user] = await sql`
    SELECT id FROM users WHERE email = ${norm} AND "emailVerified" IS NOT NULL
  `
  if (!user) return
  await issueOtp(norm, 'password_reset')
}

export async function resetPassword(
  email: string,
  otp: string,
  newPassword: string,
): Promise<void> {
  const norm = email.toLowerCase().trim()

  const pwErr = validatePassword(newPassword)
  if (pwErr) throw Object.assign(new Error(pwErr), { status: 400 })

  await verifyOtp(norm, otp, 'password_reset')

  const passwordHash = await hashPassword(newPassword)
  await sql`UPDATE users SET password_hash = ${passwordHash} WHERE email = ${norm}`
}
