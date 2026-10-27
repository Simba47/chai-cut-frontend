// The brand engine (engine.ts): a kit going on a clip, coming off, and the clip following the kit
// live when it changes — always leaving the user's own changes as they are.
// Run: npm run test:brand
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SegmentLocal, TextOverlay } from '@chai-cut/shared'
import { DEFAULT_BRAND_KIT, logoBox, type BrandKit, type BrandKitData } from '@/lib/shared/brandKit'
import { putBrandOn, takeBrandOff, updateBrand, brandNewFrames, brandChanged, type BrandTarget } from './engine'

const LEN = 30_000
function kit(over: Partial<BrandKitData> = {}): BrandKit {
  const data: BrandKitData = {
    ...DEFAULT_BRAND_KIT,
    colors: { main: '#112233', accent: '#ff5500', extra: [] },
    logo: { ...DEFAULT_BRAND_KIT.logo, path: 'brand/u1/a.png', ratio: 1, corner: 'tr', size: 0.2, opacity: 1, show: 'all' },
    title: { font: 'Poppins', color: '#ffcc00', size: 80 },
    captions: { ...DEFAULT_BRAND_KIT.captions, on: true, template: 'bold', color: '#ffffff', highlight_color: '#ff5500', size: 60 },
    ...over,
  }
  return { id: 'k1', name: 'Kit', data, logo_url: 'https://cdn/logo-a.png' }
}
const text = (id: string, over: Partial<TextOverlay> = {}): TextOverlay =>
  ({ id, clip_id: 'c1', text: 'Big sale', start_ms: 0, end_ms: 3000, x: 0.5, y: 0.2, font: 'Inter', color: '#ffffff', size: 40, ...over }) as TextOverlay
const frame = (id: string): SegmentLocal => ({
  id, start_ms: 0, end_ms: 5000, layout: 'frame_title_caption', sort_order: 0, crop_boxes: [],
  frame: { band: { text: '', bg: '#000000', color: '#ffffff', size: 64, font: null }, items: [{ id: `${id}-t`, lane: 'band', kind: 'text', start_ms: 0, end_ms: 5000, text: 'Title', color: '#ffffff', bg: '#000000' }] },
} as SegmentLocal)
function clip(over: Partial<BrandTarget> = {}): BrandTarget {
  return {
    clipId: 'c1', lengthMs: LEN, mainVideoId: 'v1', overlays: [], texts: [text('t1'), text('t2')],
    caption: { template: 'plain', color: '#eeeeee', size: 52, animation: 'karaoke' }, textCase: 'title', segments: [frame('f1')], ...over,
  }
}
const logoOf = (t: BrandTarget) => t.overlays.find(o => o.storage_path?.startsWith('brand/'))

test('on: logo in its corner, title style on text, caption look, frame colours', () => {
  const { target: t } = putBrandOn(clip(), kit())
  const logo = logoOf(t)!
  assert.equal(logo.storage_path, 'brand/u1/a.png')
  assert.deepEqual({ x: logo.x, y: logo.y, w: logo.w, h: logo.h }, logoBox(kit().data.logo))
  assert.deepEqual([logo.start_ms, logo.end_ms], [0, LEN])
  assert.deepEqual(t.texts.map(x => [x.font, x.color, x.size]), [['Poppins', '#ffcc00', 80], ['Poppins', '#ffcc00', 80]])
  assert.equal(t.caption.template, 'bold')
  assert.equal(t.segments[0].frame!.band!.bg, '#112233')
  assert.equal(t.segments[0].frame!.items![0].color, '#ffcc00')
})

test('off: everything goes back, except what the user changed while it was on', () => {
  const on = putBrandOn(clip(), kit())
  // (the user recolours one text while the brand is on)
  const edited = { ...on.target, texts: on.target.texts.map(x => (x.id === 't2' ? { ...x, color: '#00ff00' } : x)) }
  const off = takeBrandOff(edited, kit().data, on.before)
  assert.equal(logoOf(off), undefined)
  assert.deepEqual([off.texts[0].font, off.texts[0].color, off.texts[0].size], ['Inter', '#ffffff', 40])
  assert.equal(off.texts[1].color, '#00ff00')
  assert.equal(off.caption.template, 'plain')
  assert.equal(off.segments[0].frame!.band!.bg, '#000000')
})

test('off with the kit deleted: its last-known settings still put text and captions back', () => {
  const on = putBrandOn(clip(), kit())
  const off = takeBrandOff(on.target, kit().data /* (as kept with the clip: BrandOn.applied) */, on.before)
  assert.equal(off.texts[0].font, 'Inter')
})

test('live: a new logo, colours and title style reach the clip', () => {
  const k1 = kit(), on = putBrandOn(clip(), k1)
  const k2 = kit({
    logo: { ...k1.data.logo, path: 'brand/u1/b.png', ratio: 0.5, corner: 'bl', size: 0.3 },
    colors: { ...k1.data.colors, main: '#334455' }, title: { font: 'Montserrat', color: '#ffffff', size: 90 },
  })
  k2.logo_url = 'https://cdn/logo-b.png'
  const t = updateBrand(on.target, k1.data, k2)
  const logo = logoOf(t)!
  assert.equal(logo.storage_path, 'brand/u1/b.png')
  assert.equal(logo.preview_url, 'https://cdn/logo-b.png')
  assert.deepEqual({ x: logo.x, y: logo.y, w: logo.w, h: logo.h }, logoBox(k2.data.logo))
  assert.deepEqual(t.texts.map(x => [x.font, x.size]), [['Montserrat', 90], ['Montserrat', 90]])
  assert.equal(t.segments[0].frame!.band!.bg, '#334455')
})

test('live: the user\'s own changes stay — a moved logo, a recoloured text, a caption colour', () => {
  const k1 = kit(), on = putBrandOn(clip(), k1)
  const mine: BrandTarget = {
    ...on.target,
    overlays: on.target.overlays.map(o => ({ ...o, x: 0.1, y: 0.7 })),
    texts: on.target.texts.map(x => (x.id === 't2' ? { ...x, color: '#00ff00' } : x)),
    caption: { ...on.target.caption, color: '#abcdef' },
  }
  const k2 = kit({ logo: { ...k1.data.logo, path: 'brand/u1/b.png', ratio: 0.5 }, title: { ...k1.data.title, color: '#ff0000' },
    captions: { ...k1.data.captions, color: '#000000', size: 70 } })
  const t = updateBrand(mine, k1.data, k2)
  const logo = logoOf(t)!
  assert.deepEqual([logo.x, logo.y, logo.storage_path], [0.1, 0.7, 'brand/u1/b.png'])
  assert.equal(logo.w, on.target.overlays[0].w)
  assert.equal(t.texts[0].color, '#ff0000')
  assert.equal(t.texts[1].color, '#00ff00')
  assert.equal(t.caption.color, '#abcdef')
  assert.equal(t.caption.size, 70)
})

test('live: a logo the user deleted stays deleted; a kit that loses its logo takes it off', () => {
  const k1 = kit(), on = putBrandOn(clip(), k1)
  const k2 = kit({ logo: { ...k1.data.logo, path: 'brand/u1/b.png' } })
  assert.equal(logoOf(updateBrand({ ...on.target, overlays: [] }, k1.data, k2)), undefined)
  const k3 = kit({ logo: { ...k1.data.logo, path: null } })
  assert.equal(logoOf(updateBrand(on.target, k1.data, k3)), undefined)
})

test('a frame picked while the brand is on gets it too', () => {
  const k = kit(), on = putBrandOn(clip({ segments: [] }), k)
  const later = { ...on.target, segments: [frame('f2')] }
  const r = brandNewFrames(later, k, on.before)!
  assert.equal(r.target.segments[0].frame!.band!.bg, '#112233')
  assert.ok(r.before.frames.f2)
  assert.equal(brandNewFrames(r.target, k, r.before), null)
})

test('only changes the clip shows count as the kit changing', () => {
  const a = kit().data
  assert.equal(brandChanged(a, { ...a, is_default: true }), false)
  assert.equal(brandChanged(a, { ...a, colors: { ...a.colors, main: '#000001' } }), true)
})

// ── Brand kit Phase 3: the title font on frame text, ready text styles ─────────
import { brandTextStyle, brandCaptionLooks, cleanBrandKitData } from '@/lib/shared/brandKit'
import { brandTextLook } from '@/modules/editor/textStyle'
import { brandCardItems } from './engine'

test('frame text takes the kit\'s title font; off puts its own back', () => {
  const k = kit()   // (title font Poppins)
  const on = putBrandOn(clip(), k)
  assert.equal(on.target.segments[0].frame!.items![0].font, 'Poppins')
  const off = takeBrandOff(on.target, k.data, on.before)
  assert.equal(off.segments[0].frame!.items![0].font ?? null, null)
})

test('a new title font reaches frame text still in the old one; a font the user picked stays', () => {
  const k1 = kit(), on = putBrandOn(clip({ segments: [frame('f1'), frame('f2')] }), k1)
  const mine = { ...on.target, segments: on.target.segments.map(s => (s.id === 'f2' ? { ...s, frame: { ...s.frame!, items: s.frame!.items!.map(it => ({ ...it, font: 'Anton' })) } } : s)) }
  const t = updateBrand(mine, k1.data, kit({ title: { ...k1.data.title, font: 'Montserrat' } }))
  assert.equal(t.segments[0].frame!.items![0].font, 'Montserrat')
  assert.equal(t.segments[1].frame!.items![0].font, 'Anton')
})

test('a Branded card\'s new text is in the title font', () => {
  const items = brandCardItems({ ...frame('c1'), layout: 'frame_brand_card' } as SegmentLocal, { name: 'Chai', data: { ...kit().data, handle: 'chai', card_title: 'Chai Co' } })
  assert.ok(items.length === 2 && items.every(it => it.font === 'Poppins'))
})

test('ready text styles: the title font when they have none; the call to action\'s box in the accent colour, or none', () => {
  const d = kit().data
  assert.deepEqual(brandTextStyle(d, 'subtitle'), { ...d.styles.subtitle, font: 'Poppins' })
  assert.equal(brandTextStyle(d, 'cta').bg, '#ff5500')
  assert.equal(brandTextStyle({ ...d, styles: { ...d.styles, cta: { ...d.styles.cta, bg: null } } }, 'cta').bg, null)
  assert.equal(brandTextStyle({ ...d, styles: { ...d.styles, cta: { ...d.styles.cta, bg: '#123456' } } }, 'cta').bg, '#123456')
  const look = brandTextLook(brandTextStyle(d, 'cta'))
  assert.equal(look.bg_color, '#ff5500'); assert.equal(look.uppercase, true); assert.equal(look.font, 'Poppins')
  // (a kit saved before styles: the defaults, the call to action on the accent colour)
  assert.equal(cleanBrandKitData({ colors: { main: '#111111', accent: '#00ff00' } }).styles.cta.bg, 'accent')
})

test('caption looks: the main one first, then the others', () => {
  const d = cleanBrandKitData({ captions: { on: true, template: 'tpl:clean' }, more_captions: [{ id: 'hooks', name: 'Hooks', captions: { template: 'tpl:beast' } }] })
  assert.deepEqual(brandCaptionLooks(d).map(l => [l.id, l.captions.template]), [['main', 'tpl:clean'], ['hooks', 'tpl:beast']])
})
