import { NextResponse } from 'next/server'

export function apiError(err: unknown) {
  const e = err as { message?: string; status?: number }
  const status = e.status ?? 500
  // The client only gets a generic message, so the real cause has to reach the server log
  if (status >= 500) console.error('[api]', err)
  // Never leak raw server/DB errors to the client
  const message = status < 500
    ? (e.message ?? 'Something went wrong')
    : 'Something went wrong. Please try again.'
  return NextResponse.json({ error: message }, { status })
}
