import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Chai Cut — Vertical Video Editor',
  description: 'Transcribe, clip, and edit vertical videos in Telugu, Hindi, and Hinglish.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
