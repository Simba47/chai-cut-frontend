'use client'

import { SessionProvider, useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { PUBLIC_PATHS } from '@/lib/publicPaths'

const AUTH_PAGES = ['/login', '/signup', '/verify-otp', '/forgot-password', '/reset-password']

function SessionWatcher() {
  const { status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (status === 'unauthenticated' && !AUTH_PAGES.some(p => pathname.startsWith(p)) && !PUBLIC_PATHS.includes(pathname)) {
      router.replace('/login')
    }
  }, [status, pathname, router])

  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SessionWatcher />
      {children}
    </SessionProvider>
  )
}
