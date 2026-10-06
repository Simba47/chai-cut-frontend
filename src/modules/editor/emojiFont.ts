'use client'

/**
 * The app's emoji: the same Twemoji drawings the export uses (public/fonts/ChaiEmoji.woff2, built
 * by the backend's build_emoji_font.py), so an emoji looks the same in the editor, the clip board
 * and the downloaded video. Only emoji characters come from this font (unicodeRange); letters stay
 * in the text's own font.
 */

const EMOJI_RANGE = 'U+200D, U+20E3, U+2190-2BFF, U+3030, U+303D, U+3297, U+3299, U+FE0F, U+1F000-1FAFF, U+E0020-E007F'
const faces = new Set<string>()

/**
 * The emoji font's family name (quoted, for a CSS / canvas font list) at a size adjustment:
 * 1 = one em of the text's font size, as text overlays draw it.
 */
export function emojiFamily(adjust = 1): string {
  const family = adjust === 1 ? 'Chai Emoji' : `Chai Emoji ${adjust.toFixed(3)}`
  if (!faces.has(family) && typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
    faces.add(family)
    const face = new FontFace(family, 'url(/fonts/ChaiEmoji.woff2)',
      { unicodeRange: EMOJI_RANGE, ...(adjust !== 1 ? { sizeAdjust: `${(adjust * 100).toFixed(1)}%` } : {}) } as FontFaceDescriptors)
    // Fetched only when an emoji is drawn (unicodeRange); added now so canvases and pages can use it
    document.fonts.add(face)
  }
  return `"${family}"`
}

// libass (captions) sizes a font by its full height (winAscent + winDescent = 1200 of 1000 units),
// so its emoji em is 0.833 of the caption size
const EMOJI_CAPTION_EM = 1000 / 1200

/** Captions: the emoji at the size the export's caption renderer draws it, next to a caption font of this em */
export function captionEmojiFamily(fontEm: number) {
  return emojiFamily(EMOJI_CAPTION_EM / fontEm)
}

/** CSS font-family for showing emoji on the page (the picker, lists) */
export function emojiCss() {
  return `${emojiFamily()}, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`
}
