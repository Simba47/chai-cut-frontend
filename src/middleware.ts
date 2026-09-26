import NextAuth from 'next-auth'
import { authConfig } from './auth.config'

const { auth } = NextAuth(authConfig)

export default auth

export const config = {
  // Skip Next internals and static files from /public (logo, favicon, etc.)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|ttf|woff2?)$).*)'],
}
