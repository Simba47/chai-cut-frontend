'use client'

import type React from 'react'

/**
 * Button whose border lights up on hover: a light runs around the edge while the pointer is
 * on it (styles: .shiny-cta in app/globals.css). Nothing animates inside the button.
 * Size, radius and font come from `className`; colours from the --shiny-cta-* variables,
 * which default to Shortcut's lime.
 */
export function ShinyButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props} className={`shiny-cta ${className}`}>
      <span className="shiny-cta-label">{children}</span>
    </button>
  )
}
