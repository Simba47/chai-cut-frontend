import type { NextAuthConfig } from 'next-auth'

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const { pathname } = nextUrl
      const isAuthPage =
        pathname.startsWith('/login') ||
        pathname.startsWith('/signup') ||
        pathname.startsWith('/verify-otp') ||
        pathname.startsWith('/forgot-password') ||
        pathname.startsWith('/reset-password')
      const isPublic = pathname === '/'
      const isApi = pathname.startsWith('/api')
      if (!isLoggedIn && !isAuthPage && !isPublic && !isApi) return false
      if (isLoggedIn && isAuthPage) return Response.redirect(new URL('/dashboard', nextUrl))
      return true
    },
  },
  providers: [],
} satisfies NextAuthConfig
