// The Rulebook's input/output test log (its section 8) on the decision rules: each row is a seating (gaps in
// face widths, as the Rulebook writes them), who talks, and the format it must give with who is in which
// view, top to bottom. Run after every change to AUTO_FORMAT: npm run test:auto-format
// (Rows 2, 15 and 16 need real footage — following, fast cutting, a walk-through — and aren't here.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideFormat, seatBreaks, seatGaps } from './autoFormat'

const AR = 16 / 9
const NAMES = 'ABCDEFGH'
/** People sitting with these gaps between them (face widths), left to right, centred in the picture */
function seat(gaps: number[], w = 0.06) {
  const xs = [0]
  for (const g of gaps) xs.push(xs[xs.length - 1] + w + g * w)
  const off = 0.5 - (xs[xs.length - 1] + w) / 2
  return xs.map(x => ({ x: x + off, y: 0.3, w, h: w * 1.3 }))
}
/** Only `who` talks */
const talks = (n: number, who: number) => Array.from({ length: n }, (_, i) => (i === who ? 9000 : 0))
/** "Split: A B / C D", "Trio: A / B C / D", "Vertical: A B" — who is in each view (their face's middle inside it) */
function result(faces: ReturnType<typeof seat>, talk: number[] | null) {
  const r = decideFormat(faces, talk, AR)!
  const views = r.framing.map(v => faces.flatMap((f, i) => {
    const cx = f.x + f.w / 2
    return cx >= v.x && cx <= v.x + v.w ? [NAMES[i]] : []
  }).join(' '))
  if (r.why === 'whole') return 'Whole picture'
  return `${r.layout === 'vertical' ? 'Vertical' : r.layout === 'split' ? 'Split' : 'Trio'}: ${views.join(' / ')}`
}

const LOG: Array<[number, string, ReturnType<typeof seat>, number[] | null, string]> = [
  [1, '1 person, talking', seat([]), talks(1, 0), 'Vertical: A'],
  [3, '2 apart, B talks', seat([6]), talks(2, 1), 'Split: A / B'],
  [4, '2 apart, no transcript', seat([6]), null, 'Split: A / B'],
  [5, '2 sitting close', seat([0.4]), null, 'Vertical: A B'],
  [6, '3 apart, B (middle) talks', seat([3, 3]), talks(3, 1), 'Trio: A / B / C'],
  [7, '3 apart, C (right) talks', seat([3, 3]), talks(3, 2), 'Trio: A / B / C'],
  [8, '3 sitting close', seat([0.3, 0.3], 0.05), null, 'Vertical: A B C'],
  [9, '1 + 2 + 1, D talks', seat([3, 0.5, 3]), talks(4, 3), 'Trio: A / B C / D'],
  [10, '2 + 1 + 2, C talks', seat([0.5, 2.5, 2.5, 0.5], 0.05), talks(5, 2), 'Trio: A B / C / D E'],
  [11, '2 + 2, C talks', seat([0.5, 3, 0.5]), talks(4, 2), 'Split: A B / C D'],
  [12, '4 evenly spaced, A talks', seat([1.5, 1.6, 1.5]), talks(4, 0), 'Split: C D / A B'],
  [13, '3 + 3, A talks', seat([0.5, 0.6, 3, 0.5, 0.6], 0.045), talks(6, 0), 'Split: D E F / A B C'],
  [14, '4 + 1, E talks', seat([0.6, 0.5, 0.6, 3], 0.05), talks(5, 4), 'Split: A B C D / E'],
  // (row 17 changed by the user, 2026-10-25 — never lose a subject: small faces go by the rules too)
  [17, 'Wide shot, faces under 3.6% of width, nobody known to talk', seat([6, 6], 0.025), null, 'Trio: A / B / C'],
  [18, '2 apart, speaker changes halfway (B talks more)', seat([6]), [4000, 6000], 'Split: A / B'],
]
for (const [n, input, faces, talk, want] of LOG) {
  test(`test log ${n}: ${input} → ${want}`, () => assert.equal(result(faces, talk), want))
}

test('crosstalk (two talk equally): no speaker, the left one on top', () => {
  assert.equal(result(seat([6]), [5000, 5000]), 'Split: A / B')
})

test('a speaker needs SPEAKER_MIN of the talk: 6 people, the most talkative at 18%, is no speaker', () => {
  // A 18%, the rest about 16% each: left side on top
  assert.equal(result(seat([0.5, 0.6, 3, 0.5, 0.6], 0.045), [1800, 1640, 1640, 1640, 1640, 1640]), 'Split: A B C / D E F')
})

test('groups from the gaps (section 3 worked examples)', () => {
  const groups = (gaps: number[]) => seatBreaks(seatGaps(seat(gaps))).length + 1
  assert.equal(groups([3.0, 0.5, 3.0]), 3)
  assert.equal(groups([0.5, 3.0, 0.5]), 2)
  assert.equal(groups([0.5, 2.5, 2.5, 0.5]), 3)
  assert.equal(groups([1.5, 1.6, 1.5]), 1)
  assert.equal(groups([0.6, 0.5, 0.6, 3.0]), 2)
  assert.equal(groups([0.5, 0.6, 3.0, 0.5, 0.6]), 2)
})

test('views: the upscale limit — a Trio view is at least 320 px of a 1080p source (2× at most)', () => {
  const r = decideFormat(seat([3, 3], 0.04), null, AR, 1080)!
  for (const v of r.framing) assert.ok(v.h * 1080 >= 320 - 0.5, `view ${v.h * 1080} px tall`)
})

test('views: headroom — the top of each view is at least half a face above the forehead', () => {
  const faces = seat([3, 3])
  const r = decideFormat(faces, null, AR)!
  r.framing.forEach((v, i) => assert.ok(v.y <= faces[i].y - 0.5 * faces[i].h + 1e-9 || v.y === 0))
})

test('never lose a subject: a wide shot of seven with small faces keeps all seven in the views', () => {
  const faces = seat([2.4, 1.6, 2.2, 1.8, 1.7, 2.6], 0.03)
  const r = decideFormat(faces, null, AR)!
  assert.notEqual(r.layout, 'vertical')
  for (const f of faces) assert.ok(r.framing.some(v => f.x >= v.x && f.x + f.w <= v.x + v.w && f.y >= v.y && f.y + f.h <= v.y + v.h), 'someone is cut out')
})

test('never lose a subject: when no Split or Trio can hold everyone, the whole picture (Blur fill)', () => {
  // Two big close-ups squeezed at the left edge: neither fits one 9:16 crop together, and the left one's
  // strip (the picture's edge to the gap) is too narrow for a view that holds their head whole
  const faces = [{ x: 0.02, y: 0.2, w: 0.2, h: 0.445 }, { x: 0.24, y: 0.2, w: 0.2, h: 0.445 }]
  assert.equal(decideFormat(faces, null, AR)!.layout, 'frame_blur_fill')
})

test('a Split at the Rulebook’s cut that would lose someone tries the other cuts first (4 + 1, the four spread wide)', () => {
  const r = result(seat([3, 3, 3, 5], 0.05), null)
  assert.ok(r.startsWith('Split'), r)
})

// ── The guarantees, on thousands of random scenes (the user, 2026-10-25: "maintain these rules for every
// possible clip, not only the one we're working on") ──
// 1–8 people, faces tiny (a wide shot) to huge (a close-up), bunched, spread or at the picture's edges,
// with or without who talks, in 16:9, 2.17:1 (cinema), 4:3 and 1:1 pictures. Every result must: keep
// every face whole in a view (or be the whole picture), never overlap two views, never blow a view up past
// MAX_ZOOM, keep headroom above the faces, and stay inside the picture.
import { AUTO_FORMAT, WHOLE_PICTURE } from './autoFormat'

/** A small seeded random generator (mulberry32): the same scenes every run */
function random(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const SHAPES = [16 / 9, 2.17, 4 / 3, 1]
const VIEW_PX: Record<string, number> = { split: 960, trio: 640 }

function randomScene(rnd: () => number) {
  const ar = SHAPES[Math.floor(rnd() * SHAPES.length)]
  const n = 1 + Math.floor(rnd() * 8)
  const kind = rnd()
  const size = kind < 0.3 ? 0.012 + rnd() * 0.023 : kind < 0.8 ? 0.035 + rnd() * 0.085 : 0.12 + rnd() * 0.13
  const faces: Array<{ x: number; y: number; w: number; h: number }> = []
  for (let tries = 0; faces.length < n && tries < 200; tries++) {
    const w = size * (0.8 + rnd() * 0.4)
    const h = Math.min(0.9, w * ar * 1.25)
    const x = rnd() * (1 - w), y = 0.03 + rnd() * Math.max(0, 0.95 - h - 0.03)
    // Faces don't sit on top of each other (side by side, a little apart)
    if (faces.some(f => x < f.x + f.w + 0.004 && f.x < x + w + 0.004)) continue
    faces.push({ x, y, w, h })
  }
  const talk = rnd() < 0.3 ? null : faces.map(() => (rnd() < 0.5 ? 0 : Math.round(rnd() * 9000)))
  return { ar, faces, talk }
}

const inside = (f: { x: number; y: number; w: number; h: number }, v: { x: number; y: number; w: number; h: number }) =>
  f.x >= v.x - 1e-6 && f.x + f.w <= v.x + v.w + 1e-6 && f.y >= v.y - 1e-6 && f.y + f.h <= v.y + v.h + 1e-6
const overlap = (p: { x: number; y: number; w: number; h: number }, q: { x: number; y: number; w: number; h: number }) =>
  Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y))

test('the guarantees hold on 5,000 random scenes', () => {
  const rnd = random(20261025)
  const counts: Record<string, number> = {}
  for (let i = 0; i < 5000; i++) {
    const { ar, faces, talk } = randomScene(rnd)
    if (!faces.length) continue
    const where = `scene ${i}: ${JSON.stringify({ ar: +ar.toFixed(2), faces: faces.map(f => [f.x, f.y, f.w, f.h].map(v => +v.toFixed(4))), talk })}`
    const r = decideFormat(faces, talk, ar)
    assert.ok(r, `no format — ${where}`)
    counts[r.why] = (counts[r.why] ?? 0) + 1
    if (r.layout === WHOLE_PICTURE) { assert.equal(r.framing.length, 0, where); continue }
    for (const v of r.framing) {
      // Inside the picture
      assert.ok(v.x >= -1e-9 && v.y >= -1e-9 && v.x + v.w <= 1 + 1e-9 && v.y + v.h <= 1 + 1e-9, `a view leaves the picture — ${where}`)
    }
    // Nobody lost: every face whole in a view — in a Vertical, a face wider than the 9:16 crop itself (an
    // extreme close-up in a cinema picture) can't be, so its middle is in the crop
    for (const f of faces) {
      const v0 = r.framing[0]
      const ok = r.layout === 'vertical' && f.w > v0.w
        ? f.x + f.w / 2 >= v0.x && f.x + f.w / 2 <= v0.x + v0.w
        : r.framing.some(v => inside(f, v))
      assert.ok(ok, `someone is cut out (${r.layout}, ${r.why}) — ${where}`)
    }
    if (r.layout === 'split' || r.layout === 'trio') {
      // No two views show the same part of the picture
      for (let a = 0; a < r.framing.length; a++) for (let b = a + 1; b < r.framing.length; b++) {
        assert.ok(overlap(r.framing[a], r.framing[b]) < 1e-9, `views overlap (${r.layout}, ${r.why}) — ${where}`)
      }
      for (const v of r.framing) {
        // Sharp enough: at most MAX_ZOOM (an assumed 1080p source)
        assert.ok(v.h * 1080 >= VIEW_PX[r.layout] / AUTO_FORMAT.MAX_ZOOM - 0.5, `a view is blown up past ${AUTO_FORMAT.MAX_ZOOM}× (${r.layout}) — ${where}`)
        // Headroom above its faces (or the view starts at the picture's top)
        const mine = faces.filter(f => inside(f, v))
        const top = Math.min(...mine.map(f => f.y)), tallest = Math.max(...mine.map(f => f.h))
        assert.ok(v.y <= top - AUTO_FORMAT.HEADROOM_MIN * tallest + 1e-6 || v.y < 1e-9, `no headroom (${r.layout}) — ${where}`)
      }
    }
  }
  console.log('formats over 5,000 random scenes:', JSON.stringify(counts))
})
