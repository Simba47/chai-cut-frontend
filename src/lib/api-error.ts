import { NextResponse } from 'next/server'

export function apiError(err: unknown) {
  const e = err as { message?: string; status?: number }
  const status = e.status ?? 500
  // Never leak raw server/DB errors to the client
  const message = status < 500
    ? (e.message ?? 'Something went wrong')
    : 'Something went wrong. Please try again.'
  return NextResponse.json({ error: message }, { status })
}
