import type { Metadata } from 'next'
import { Inter_Tight } from 'next/font/google'
import './globals.css'
import './landing.css'
import './auth.css'
import { Providers } from './providers'

// Exposed as --font-display; only the landing page opts into it
const displayFont = Inter_Tight({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Shortcut — Vertical Video Editor',
  description: 'Transcribe, clip, and edit vertical videos in Telugu, Hindi, and Hinglish.',
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Apply saved theme before first paint to prevent flash */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var t = localStorage.getItem('theme');
            if (t === 'light' || (!t && window.matchMedia('(prefers-color-scheme: light)').matches))
              document.documentElement.setAttribute('data-theme', 'light');
          } catch(e){}
        `}} />
      </head>
      <body className={displayFont.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
