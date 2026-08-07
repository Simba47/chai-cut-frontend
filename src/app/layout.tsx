import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Chai Cut — Vertical Video Editor',
  description: 'Transcribe, clip, and edit vertical videos in Telugu, Hindi, and Hinglish.',
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
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
