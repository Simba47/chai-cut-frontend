import { auth } from '@/auth'
import { redirect } from 'next/navigation'

/** Clears a replaced sign-in's cookie, then shows /login (app/api/auth/signed-out) */
export const SIGNED_OUT = '/api/auth/signed-out'

export async function requireUser() {
  const session = await auth()
  // Signed in on another device since: the cookie is cleared there first (the middleware can't
  // tell it no longer counts, and would send /login straight back to /dashboard)
  if (session?.replaced) redirect(SIGNED_OUT)
  if (!session?.user?.id) redirect('/login')
  return { id: session.user.id, email: session.user.email ?? '' }
}
