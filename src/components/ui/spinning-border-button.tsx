import * as React from 'react'

export type SpinningBorderButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Classes for the button's face (size, padding, font) */
  surfaceClassName?: string
}

/**
 * Button with a light that spins around its border while hovered, and lifts slightly with a glow.
 * At rest it shows a plain thin border. Shortcut's version: a lime face with black text and a
 * white beam (styles: .sbb-* in app/globals.css).
 */
export const SpinningBorderButton = React.forwardRef<HTMLButtonElement, SpinningBorderButtonProps>(
  function SpinningBorderButton({ children, className, surfaceClassName, ...props }, ref) {
    return (
      <button ref={ref} type="button" {...props} className={`sbb group${className ? ` ${className}` : ''}`}>
        {/* The beam: a conic gradient spinning behind the 1.5px edge, shown on hover */}
        <span className="sbb-beam" aria-hidden="true" />
        {/* The resting border, fading out as the beam appears */}
        <span className="sbb-rest" aria-hidden="true" />
        {/* The face */}
        <span className={`sbb-surface${surfaceClassName ? ` ${surfaceClassName}` : ''}`}>{children}</span>
      </button>
    )
  },
)

export default SpinningBorderButton
