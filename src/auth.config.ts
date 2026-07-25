import type { NextAuthConfig } from 'next-auth'

export const authConfig = {
  pages: {
    signIn: '/login',
    verifyRequest: '/login?verify=true',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const { pathname } = nextUrl
      const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/signup')
      const isApi = pathname.startsWith('/api')
      if (!isLoggedIn && !isAuthPage && !isApi) return false
      if (isLoggedIn && isAuthPage) return Response.redirect(new URL('/dashboard', nextUrl))
      return true
    },
  },
  providers: [],
} satisfies NextAuthConfig
