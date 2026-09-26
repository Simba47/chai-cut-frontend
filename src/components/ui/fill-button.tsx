import React from 'react'

const ARROW = 'M16.1716 10.9999L10.8076 5.63589L12.2218 4.22168L20 11.9999L12.2218 19.778L10.8076 18.3638L16.1716 12.9999H4V10.9999H16.1716Z'

/**
 * Inner pieces for a `.fill-btn` (styles in app/landing.css): on hover a lime
 * circle grows from the centre to fill the button, the right arrow slides out,
 * a left arrow slides in, and the label shifts across.
 * Usage: <Link className="... fill-btn"><FillButtonContent>Label</FillButtonContent></Link>
 */
export function FillButtonContent({ children }: { children: React.ReactNode }) {
  return (
    <>
      <svg viewBox="0 0 24 24" className="fill-btn-arrow fill-btn-arr-in" aria-hidden><path d={ARROW} /></svg>
      <span className="fill-btn-text">{children}</span>
      <span className="fill-btn-circle" aria-hidden />
      <svg viewBox="0 0 24 24" className="fill-btn-arrow fill-btn-arr-out" aria-hidden><path d={ARROW} /></svg>
    </>
  )
}
