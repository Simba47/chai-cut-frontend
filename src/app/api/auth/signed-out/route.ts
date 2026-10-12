import { NextResponse, type NextRequest } from 'next/server'

/**
 * Where a device goes once its account signed in on another device (modules/auth/one-device.ts):
 * its session cookie is cleared — the middleware can't tell it no longer counts — and it lands on
 * /login, whose sign-in form says why (the `signed_out` note, AuthSlider.tsx).
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/login', req.url))
  for (const { name } of req.cookies.getAll()) {
    // authjs.session-token, its __Secure- form on https, and their chunks (.0, .1, …)
    if (!name.includes('authjs.session-token')) continue
    res.cookies.set(name, '', { maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax', secure: name.startsWith('__Secure-') })
  }
  res.cookies.set('signed_out', 'elsewhere', { maxAge: 10 * 60, path: '/', sameSite: 'lax' })
  return res
}
