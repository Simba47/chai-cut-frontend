import crypto from 'node:crypto'

export function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000))
}

export function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex')
}

export function verifyOtpHash(otp: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashOtp(otp), 'hex')
  const stored = Buffer.from(storedHash, 'hex')
  if (candidate.length !== stored.length) return false
  return crypto.timingSafeEqual(candidate, stored)
}
