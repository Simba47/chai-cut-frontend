/** A place in line as people say it: 1 → "next in line", 3 → "3rd in line" (server/services/transcribe.ts placeInLine) */
export function inLineText(place: number): string {
  if (place <= 1) return 'next in line'
  const tens = place % 100, ones = place % 10
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'
  return `${place}${suffix} in line`
}
