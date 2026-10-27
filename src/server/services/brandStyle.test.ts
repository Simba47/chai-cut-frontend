// A site's fonts and colours read from its CSS (brandStyle.ts), on small pieces of CSS written the
// way real sites write them (checked against 16 real sites when it was built, 2026-10-27).
// Run: npm run test:brand-style
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSiteStyle, nearestFont, googleFontFamilies, coloursIn, mergePalette } from './brandStyle'

test('a font set through a variable is found (font-family: var(--brand-font))', () => {
  const s = readSiteStyle([':root{--hds-font-family: sohne-var, "Helvetica Neue", sans-serif} body{font-family: var(--hds-font-family)}'])
  assert.equal(s.body, 'Inter')
})

test('heading and body fonts are told apart', () => {
  const s = readSiteStyle(['body{font-family:"Open Sans",Arial,sans-serif} h1,h2{font-family:"Playfair Display",Georgia,serif}'])
  assert.equal(s.body, 'Inter')
  assert.equal(s.heading, 'Playfair Display')
})

test('a stack starting with the system font says nothing', () => {
  const s = readSiteStyle(['body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'])
  assert.equal(s.body, null)
  assert.equal(s.heading, null)
})

test('code, maths and icon fonts are not the brand font', () => {
  const s = readSiteStyle(['code,pre{font-family:"JetBrains Mono",monospace} .katex{font-family:KaTeX_Main} .fa{font-family:"Font Awesome 6 Free"} body{font-family:Poppins}'])
  assert.equal(s.body, 'Poppins')
})

test('a Google Fonts link counts', () => {
  assert.deepEqual(googleFontFamilies('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&family=Lora&display=swap'), ['Open Sans', 'Lora'])
  assert.deepEqual(googleFontFamilies('https://fonts.googleapis.com/css?family=Montserrat:400,700|Raleway'), ['Montserrat', 'Raleway'])
  assert.deepEqual(googleFontFamilies('https://example.com/fonts.css'), [])
  assert.equal(readSiteStyle([], ['Montserrat']).body, 'Montserrat')
})

test('web fonts go to the nearest editor font', () => {
  assert.equal(nearestFont('Poppins'), 'Poppins')
  assert.equal(nearestFont('Gilroy-Bold'), 'Poppins')
  assert.equal(nearestFont('Inter Variable'), 'Inter')
  assert.equal(nearestFont('Helvetica Neue'), 'Inter')
  assert.equal(nearestFont('Merriweather'), 'Playfair Display')
  assert.equal(nearestFont('Bebas Neue'), 'Bebas Neue')
  assert.equal(nearestFont('Roboto Condensed'), 'Oswald')
  assert.equal(nearestFont('Dancing Script'), 'Pacifico')
  assert.equal(nearestFont('SpotifyMixUI'), null)
  assert.equal(nearestFont('system-ui'), null)
})

test('colours are read in every way CSS writes them; see-through ones are left out', () => {
  assert.equal(coloursIn('#635bff').length, 1)
  assert.equal(coloursIn('#fff').length, 1)
  assert.equal(coloursIn('rgb(99 91 255 / 40%)').length, 0)
  assert.equal(coloursIn('rgba(99,91,255,0.9)').length, 1)
  assert.equal(coloursIn('hsl(243 100% 68%)').length, 1)
})

test('a brand variable and a button beat a design system palette and framework stock colours', () => {
  const s = readSiteStyle([
    ':root{--brand-primary:#635bff;--red-500:#ef4444;--teal-200:#99f6e4;--bs-primary:#0d6efd}',
    '.btn-primary{background-color:#0d6efd} .cta{background:#ff5a1f} body{color:#1a1a1a;background:#ffffff}',
  ])
  assert.deepEqual(s.colors, ['#635bff', '#ff5a1f'])
})

test('the kit palette: the logo first, then the site; no white theme colour, nothing alike twice', () => {
  const p = mergePalette({ main: '#111111', accent: null }, ['#635bff', '#6a60ff', '#ff5a1f'], '#ffffff')
  assert.deepEqual(p, { main: '#111111', accent: '#635bff', extra: ['#ff5a1f'] })
  assert.equal(mergePalette(null, [], '#ffffff')?.main, '#ffffff')
  assert.equal(mergePalette(null, [], null), null)
})
