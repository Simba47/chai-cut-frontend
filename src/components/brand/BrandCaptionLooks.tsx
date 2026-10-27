'use client'

import type { BrandCaptionLook } from '@/lib/shared/brandKit'
import type { CaptionStyle } from '@chai-cut/shared'

/**
 * A brand kit's caption looks in the editor's Captions panel (brand kit rebuild, Phase 3): its main
 * look and the others it keeps ("Bold for hooks"…), one tap each — on the lines picked, else on
 * all the captions (as any style picked there). The one the captions are in now is lit.
 */
export function BrandCaptionLooks({ kitName, looks, current, onPick }: {
  kitName: string
  looks: BrandCaptionLook[]
  /** The caption style shown in the panel now */
  current: Partial<CaptionStyle>
  onPick: (look: BrandCaptionLook) => void
}) {
  if (!looks.length) return null
  const isOn = (l: BrandCaptionLook) => (current.template ?? null) === l.captions.template && (current.color ?? '').toLowerCase() === l.captions.color
  return (
    <div className="bcl" role="radiogroup" aria-label={`${kitName} caption looks`}>
      <span className="bcl-label">{kitName}</span>
      <div className="flex gap-1.5 flex-wrap">
        {looks.map(l => (
          <button key={l.id} type="button" role="radio" aria-checked={isOn(l)} className="bcl-chip" data-on={isOn(l) || undefined}
            onClick={() => onPick(l)} title={`Captions in your “${l.name}” look`}>
            <i aria-hidden="true" style={{ background: l.captions.color }} /><i aria-hidden="true" style={{ background: l.captions.highlight_color }} />
            {l.name}
          </button>
        ))}
      </div>
    </div>
  )
}
