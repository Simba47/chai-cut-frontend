// "Describe your brand" (brandStyles.ts): the ready-made styles are all usable, and a few words pick
// the right one. Run: npm run test:brand
import { test } from 'node:test'
import assert from 'node:assert/strict'
import catalogue from '@/modules/captions/caption_templates.json'
import { VIDEO_FONTS } from './videoFonts'
import { BRAND_STYLES, PLAIN_STYLE, matchBrandStyles, foundFromStyle } from './brandStyles'
import { DEFAULT_BRAND_KIT, withFoundBrand } from './brandKit'

const fonts = new Set(VIDEO_FONTS.map(f => f.family))
const looks = new Set((catalogue.templates as Array<{ id: string }>).map(t => t.id))

test('every style uses a font and a caption look the app has, and real colours', () => {
  for (const st of [...BRAND_STYLES, PLAIN_STYLE]) {
    assert.ok(fonts.has(st.font), `${st.id}: font ${st.font}`)
    assert.ok(looks.has(st.caption), `${st.id}: caption look ${st.caption}`)
    for (const c of [st.colors.main, st.colors.accent, ...st.colors.extra]) assert.match(c, /^#[0-9a-f]{6}$/, `${st.id}: ${c}`)
    assert.ok(st.colors.extra.length <= 3)
  }
  assert.equal(new Set(BRAND_STYLES.map(s => s.id)).size, BRAND_STYLES.length)
})

test('a few words pick the style they describe', () => {
  const first = (s: string) => matchBrandStyles(s)[0].id
  assert.equal(first('Telugu cooking channel, warm and homely'), 'food')
  assert.equal(first('vantalu and tiffin recipes'), 'food')
  assert.equal(first('BGMI gaming streams'), 'gaming')
  assert.equal(first('Daily bhakti songs and pooja'), 'devotional')
  assert.equal(first('stock market and investing tips'), 'money')
  assert.equal(first('Skincare and makeup for brides'), 'beauty')
  assert.equal(first('UPSC exam coaching'), 'education')
  assert.equal(first('cricket highlights'), 'sports')
  assert.equal(first('Tollywood movie reviews'), 'movies')
})

test('nothing matched, or nothing typed: clean and simple', () => {
  assert.equal(matchBrandStyles('xyz qwerty')[0].id, 'plain')
  assert.equal(matchBrandStyles('   ')[0].id, 'plain')
})

test('a word only matches at the start of a typed word ("ai" is not in "chain")', () => {
  assert.equal(matchBrandStyles('chain stores')[0].id, 'plain')
})

test('a style fills a kit: its colours and title font', () => {
  const st = BRAND_STYLES.find(s => s.id === 'food')!
  const d = withFoundBrand(DEFAULT_BRAND_KIT, foundFromStyle(st))
  assert.equal(d.colors.main, st.colors.main)
  assert.equal(d.colors.accent, st.colors.accent)
  assert.deepEqual(d.colors.extra, st.colors.extra)
  assert.equal(d.title.font, st.font)
})
