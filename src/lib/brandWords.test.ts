// A brand kit's words (brandWords.ts). Run: npx tsx --test src/lib/brandWords.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brandCaptionWords, brandClipText, brandHashtags, brandText, brandVoice, cleanBrandWords, hideWords, maskWord, spellWords, NO_BRAND_WORDS, type BrandWords } from './brandWords'

let t = 0
/** Words said one after another, 300 ms each */
const said = (...ws: string[]) => ws.map(word => { const r = { id: `w${t}`, word, start_ms: t, end_ms: t + 300 }; t += 320; return r })
const text = (rows: Array<{ word: string }>) => rows.map(r => r.word).join(' ')
const kit = (w: Partial<BrandWords>): BrandWords => ({ ...NO_BRAND_WORDS, ...w })

test('saved words made safe: names once each, no empty ones, hashtags without # or spaces, a known tone', () => {
  const w = cleanBrandWords({
    spell: [{ text: '  ShortCut ', heard: ['short cut', 'shortcut', '', 'Sort Cut'] }, { text: 'shortcut' }, { text: 'x' }, 'nope'],
    hide: ['damn', 'DAMN', ' ', 'a'],
    lines: ['Follow for more', 'follow for more', ''],
    end_posts: 'yes',
    hashtags: ['#Short Cut', '##edits', 'shortcut'],
    tone: 'angry',
  })
  assert.deepEqual(w.spell, [{ text: 'ShortCut', heard: ['Sort Cut'] }])
  assert.deepEqual(w.hide, ['damn'])
  assert.deepEqual(w.lines, ['Follow for more'])
  assert.equal(w.end_posts, false)
  assert.deepEqual(w.hashtags, ['ShortCut', 'edits'])
  assert.equal(w.tone, null)
  assert.deepEqual(cleanBrandWords(null), NO_BRAND_WORDS)
})

test('a name spelled the brand’s way: any case, said split, with punctuation and endings kept', () => {
  const spell = [{ text: 'ShortCut', heard: [] }]
  assert.equal(text(spellWords(said('try', 'shortcut,', 'now'), spell).rows), 'try ShortCut, now')
  const split = spellWords(said('open', 'Short', 'cut!'), spell)
  assert.equal(text(split.rows), 'open ShortCut!')
  // (joined over both words' time, in the first one's place)
  assert.equal(split.rows[1].end_ms - split.rows[1].start_ms, 620)
  assert.equal(text(spellWords(said('my', 'shortcuts'), spell).rows), 'my ShortCuts')
  assert.equal(text(spellWords(said("shortcut's", 'best'), spell).rows), "ShortCut's best")
})

test('what a name is heard as becomes it; a long name a letter off too, but never everyday words', () => {
  const spell = [{ text: 'ChaiCut', heard: ['chai cat'] }, { text: 'Chaitanya', heard: [] }, { text: 'Rana', heard: [] }]
  assert.equal(text(spellWords(said('this', 'is', 'chai', 'cat'), spell).rows), 'this is ChaiCut')
  assert.equal(text(spellWords(said('hi', 'chaitania'), spell).rows), 'hi Chaitanya')
  // (short names are only ever matched exactly: "rain" stays, "rana" is spelled)
  assert.equal(text(spellWords(said('rain', 'rana'), spell).rows), 'rain Rana')
  // (a long word starting with another letter isn't a near miss)
  assert.equal(text(spellWords(said('khaitanya'), spell).rows), 'khaitanya')
})

test('words said far apart are never joined into a name', () => {
  const rows = [{ word: 'short', start_ms: 0, end_ms: 300 }, { word: 'cut', start_ms: 2000, end_ms: 2300 }]
  assert.equal(text(spellWords(rows, [{ text: 'ShortCut', heard: [] }]).rows), 'short cut')
})

test('words in other letters keep their script; their English spelling is fixed', () => {
  const rows = [{ word: 'షార్ట్', word_roman: 'short', start_ms: 0, end_ms: 300 }, { word: 'కట్', word_roman: 'cut', start_ms: 320, end_ms: 600 }]
  const out = spellWords(rows, [{ text: 'ShortCut', heard: [] }]).rows
  assert.equal(out.length, 1)
  assert.equal(out[0].word_roman, 'ShortCut')
  assert.equal(out[0].word, 'షార్ట్ కట్')
})

test('spelling twice changes nothing more', () => {
  const spell = [{ text: 'ShortCut', heard: ['sort cut'] }]
  const once = spellWords(said('sort', 'cut', 'shortcuts', 'shortcat'), spell)
  assert.equal(text(once.rows), 'ShortCut ShortCuts ShortCut')
  const twice = spellWords(once.rows, spell)
  assert.equal(twice.fixed, 0)
  assert.deepEqual(twice.rows, once.rows)
})

test('hidden words and phrases masked, in both spellings, and only whole words', () => {
  assert.equal(maskWord('damn,'), 'd***,')
  assert.equal(maskWord('a'), '*')
  const out = hideWords(said('damn', 'it', 'hello', 'Brand', 'X!'), ['damn', 'hell', 'brand x']).rows
  assert.equal(text(out), 'd*** it hello B**** *!')
  const roman = hideWords([{ word: 'డ్యామ్', word_roman: 'damn', start_ms: 0, end_ms: 1 }], ['damn']).rows[0]
  assert.equal(roman.word, '***')
  assert.equal(roman.word_roman, 'd***')
})

test('caption words: spelled, then masked; none of the kit’s words: the same list', () => {
  const rows = said('short', 'cut', 'damn')
  assert.equal(brandCaptionWords(rows, null), rows)
  assert.equal(brandCaptionWords(rows, kit({ lines: ['Follow'] })), rows)
  assert.equal(text(brandCaptionWords(rows, kit({ spell: [{ text: 'ShortCut', heard: [] }], hide: ['damn'] }))), 'ShortCut d***')
})

test('written text: names spelled however they’re written, hidden words masked, other words alone', () => {
  const w = kit({ spell: [{ text: 'ShortCut', heard: ['sort cut'] }], hide: ['damn', 'brand x'] })
  assert.equal(brandText('Try short-cut today! Shortcuts rock. Sort cut too.', w), 'Try ShortCut today! ShortCuts rock. ShortCut too.')
  assert.equal(brandText('Better than Brand X, damn.', w), 'Better than B**** *, d***.')
  assert.equal(brandText('shortcutting and damnation stay', w), 'shortcutting and damnation stay')
})

test('hashtags: the brand’s first, no repeats, none hidden', () => {
  const w = kit({ hashtags: ['ShortCut'], hide: ['damn'] })
  assert.deepEqual(brandHashtags(['shortcut', '#reels', 'Damn', 'edits'], w), ['ShortCut', 'reels', 'edits'])
})

test('post text written for a clip follows the brand; its voice for the writer', () => {
  const w = kit({ spell: [{ text: 'ShortCut', heard: [] }], hashtags: ['ShortCut'], lines: ['Follow for more'], end_posts: true, tone: 'bold' })
  const out = brandClipText({ hook: 'shortcut magic', title: 'Why shortcut wins', post_caption: 'Made in shortcut', hashtags: ['edits'] }, w)
  assert.deepEqual(out, { hook: 'ShortCut magic', title: 'Why ShortCut wins', post_caption: 'Made in ShortCut', hashtags: ['ShortCut', 'edits'] })
  assert.deepEqual(brandVoice(w), { tone: 'bold, punchy and confident, in short sentences', avoid: '', hashtags: ['ShortCut'], cta: 'Follow for more' })
  assert.equal(brandVoice(kit({ lines: ['Follow'] }))?.cta, '')
  assert.equal(brandVoice(NO_BRAND_WORDS), null)
})
