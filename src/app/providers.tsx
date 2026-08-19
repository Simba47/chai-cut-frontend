'use client'

import { SessionProvider, useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'

const AUTH_PAGES = ['/login', '/signup', '/verify-otp', '/forgot-password', '/reset-password']

function SessionWatcher() {
  const { status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (status === 'unauthenticated' && !AUTH_PAGES.some(p => pathname.startsWith(p)) && pathname !== '/') {
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
