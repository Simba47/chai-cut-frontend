import crypto from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(crypto.scrypt)
const SALT_LEN = 16
const KEY_LEN = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex')
  const key = (await scrypt(password, salt, KEY_LEN)) as Buffer
  return `${salt}:${key.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 2) return false
  const [salt, keyHex] = parts
  try {
    const key = (await scrypt(password, salt, KEY_LEN)) as Buffer
    const storedKey = Buffer.from(keyHex, 'hex')
    if (key.length !== storedKey.length) return false
    return crypto.timingSafeEqual(key, storedKey)
  } catch {
    return false
  }
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'At least 8 characters required'
  if (!/[A-Z]/.test(password)) return 'Include at least one uppercase letter'
  if (!/[0-9]/.test(password)) return 'Include at least one number'
  return null
}
