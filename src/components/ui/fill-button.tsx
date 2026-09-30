import React from 'react'

const ARROW = 'M16.1716 10.9999L10.8076 5.63589L12.2218 4.22168L20 11.9999L12.2218 19.778L10.8076 18.3638L16.1716 12.9999H4V10.9999H16.1716Z'

// Outline scissors (drawn with strokes, see .fill-btn-icon-stroke)
function Scissors() {
  return (
    <>
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
    </>
  )
}

/**
 * Inner pieces for a `.fill-btn` (styles in app/landing.css): on hover a lime
 * circle grows from the centre to fill the button, the right icon slides out,
 * a left icon slides in, and the label shifts across.
 * `icon` swaps the default arrow for another glyph (e.g. scissors for "Make clips").
 * Usage: <Link className="... fill-btn"><FillButtonContent>Label</FillButtonContent></Link>
 */
export function FillButtonContent({ children, icon = 'arrow' }: { children: React.ReactNode; icon?: 'arrow' | 'scissors' }) {
  const glyph = icon === 'scissors' ? <Scissors /> : <path d={ARROW} />
  const cls = icon === 'scissors' ? ' fill-btn-icon-stroke' : ''
  return (
    <>
      <svg viewBox="0 0 24 24" className={`fill-btn-arrow fill-btn-arr-in${cls}`} aria-hidden>{glyph}</svg>
      <span className="fill-btn-text">{children}</span>
      <span className="fill-btn-circle" aria-hidden />
      <svg viewBox="0 0 24 24" className={`fill-btn-arrow fill-btn-arr-out${cls}`} aria-hidden>{glyph}</svg>
    </>
  )
}
