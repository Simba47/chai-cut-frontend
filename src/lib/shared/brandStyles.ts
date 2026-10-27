import type { FoundBrand } from './brandKit'

/**
 * Ready-made brand styles for "Describe your brand" (brand kit rebuild, Phase 1, 2026-10-27): a
 * user with no website and no logo types a few words ("Telugu cooking channel, warm and homely") and
 * gets the style those words fit best — a palette, a title font (one of the editor's: VIDEO_FONTS)
 * and a caption look (an id in modules/captions/caption_templates.json). Matched by plain words, so
 * it costs nothing to run (no AI). Words include the Telugu and Hindi ones creators type in English
 * letters. Tests: brandStyles.test.ts checks every font and caption look exists.
 */

export interface BrandStyle {
  id: string
  /** What the user sees ("Food & cooking") */
  name: string
  /** Words that point to it (lower case; a word matches as the start of a typed word: "cook" → "cooking") */
  words: string[]
  colors: { main: string; accent: string; extra: string[] }
  font: string
  /** A caption look's id */
  caption: string
}

export const BRAND_STYLES: BrandStyle[] = [
  { id: 'food', name: 'Food & cooking', caption: 'tpl:sunshine', font: 'Poppins',
    colors: { main: '#7a2e0e', accent: '#ffb347', extra: ['#2e7d32', '#f4e3c1'] },
    words: ['food', 'cook', 'recipe', 'kitchen', 'chef', 'vanta', 'vantalu', 'khana', 'rasoi', 'biryani', 'restaurant', 'cafe', 'bakery', 'cake', 'snack',
      'street food', 'tiffin', 'curry', 'foodie', 'homely', 'homemade', 'ruchi', 'pachadi', 'swad'] },
  { id: 'tech', name: 'Tech & gadgets', caption: 'tpl:cyan', font: 'Space Grotesk',
    colors: { main: '#0b1f3a', accent: '#00c2ff', extra: ['#7c4dff'] },
    words: ['tech', 'gadget', 'phone', 'mobile', 'unboxing', 'ai', 'coding', 'code', 'software', 'laptop', 'app', 'computer', 'electronics', 'saas'] },
  { id: 'fitness', name: 'Fitness & health', caption: 'tpl:impact', font: 'Oswald',
    colors: { main: '#111111', accent: '#ff3d00', extra: ['#ffd600'] },
    words: ['fitness', 'gym', 'workout', 'yoga', 'health', 'diet', 'nutrition', 'bodybuilding', 'running', 'exercise', 'weight loss', 'fit', 'trainer'] },
  { id: 'beauty', name: 'Beauty & skincare', caption: 'tpl:blush', font: 'Playfair Display',
    colors: { main: '#3d1f2b', accent: '#ff7eb6', extra: ['#c9a227', '#ffd1dc'] },
    words: ['beauty', 'makeup', 'skincare', 'skin', 'hair', 'salon', 'nails', 'cosmetic', 'glow', 'mehendi', 'bridal'] },
  { id: 'fashion', name: 'Fashion & luxury', caption: 'tpl:editorial', font: 'Playfair Display',
    colors: { main: '#0d0d0d', accent: '#c9a227', extra: ['#f5f0e6'] },
    words: ['fashion', 'style', 'outfit', 'clothing', 'boutique', 'saree', 'sari', 'jewellery', 'jewelry', 'luxury', 'premium', 'designer', 'wedding', 'elegant', 'classy'] },
  { id: 'travel', name: 'Travel & vlogs', caption: 'tpl:fresh', font: 'Montserrat',
    colors: { main: '#0e4d64', accent: '#ffb703', extra: ['#2a9d8f'] },
    words: ['travel', 'vlog', 'trip', 'tour', 'explore', 'adventure', 'nature', 'journey', 'village', 'trek', 'ride', 'bike'] },
  { id: 'gaming', name: 'Gaming', caption: 'tpl:gamer', font: 'Bebas Neue',
    colors: { main: '#12002b', accent: '#39ff14', extra: ['#ff00e5'] },
    words: ['gaming', 'game', 'gamer', 'esports', 'bgmi', 'pubg', 'free fire', 'freefire', 'minecraft', 'stream', 'gta', 'valorant'] },
  { id: 'education', name: 'Learning & explainers', caption: 'tpl:clean', font: 'Nunito',
    colors: { main: '#1a237e', accent: '#ffca28', extra: ['#4fc3f7'] },
    words: ['education', 'study', 'learn', 'teacher', 'teach', 'tutorial', 'exam', 'class', 'school', 'college', 'upsc', 'coaching', 'tips', 'how to',
      'explain', 'science', 'history', 'english', 'maths', 'math', 'gk', 'facts'] },
  { id: 'money', name: 'Money & business', caption: 'tpl:hormozi-green', font: 'Inter',
    colors: { main: '#0f2d1f', accent: '#22c55e', extra: ['#c9a227'] },
    words: ['finance', 'money', 'stock', 'share market', 'trading', 'invest', 'crypto', 'business', 'startup', 'marketing', 'sales', 'entrepreneur',
      'real estate', 'property', 'tax', 'loan', 'insurance', 'agency'] },
  { id: 'comedy', name: 'Comedy & fun', caption: 'tpl:comic', font: 'Fredoka One',
    colors: { main: '#1b1b1b', accent: '#ffde00', extra: ['#ff4d6d'] },
    words: ['comedy', 'funny', 'meme', 'prank', 'entertainment', 'skit', 'fun', 'joke', 'roast', 'masti', 'comic'] },
  { id: 'devotional', name: 'Devotional & spiritual', caption: 'tpl:soft-glow', font: 'Playfair Display',
    colors: { main: '#5a1a00', accent: '#ff9933', extra: ['#ffd700'] },
    words: ['devotional', 'bhakti', 'spiritual', 'temple', 'god', 'prayer', 'mantra', 'bhajan', 'astrology', 'jyotish', 'meditation', 'puja', 'pooja',
      'divine', 'katha', 'pravachan', 'calm', 'peace'] },
  { id: 'news', name: 'News & podcasts', caption: 'tpl:podcast', font: 'Roboto',
    colors: { main: '#101418', accent: '#e53935', extra: ['#90a4ae'] },
    words: ['news', 'podcast', 'interview', 'talk', 'debate', 'politics', 'current affairs', 'update', 'headline', 'show', 'discussion'] },
  { id: 'music', name: 'Music & dance', caption: 'tpl:neon-red', font: 'Righteous',
    colors: { main: '#1a0533', accent: '#ff2e93', extra: ['#00e5ff'] },
    words: ['music', 'song', 'singer', 'singing', 'dance', 'dancer', 'cover', 'rap', 'beat', 'dj', 'band', 'guitar', 'folk'] },
  { id: 'kids', name: 'Kids & family', caption: 'tpl:bubble', font: 'Fredoka One',
    colors: { main: '#2b2d42', accent: '#ffb703', extra: ['#8ecae6', '#fb8500'] },
    words: ['kids', 'kid', 'children', 'child', 'baby', 'parenting', 'family', 'mom', 'mother', 'toys', 'cartoon', 'rhymes', 'story'] },
  { id: 'motivation', name: 'Motivation', caption: 'tpl:beast', font: 'Anton',
    colors: { main: '#0a0a0a', accent: '#ffd60a', extra: ['#e63946'] },
    words: ['motivation', 'motivational', 'mindset', 'success', 'inspiration', 'inspire', 'self improvement', 'life lessons', 'quotes', 'discipline', 'bold', 'loud'] },
  { id: 'sports', name: 'Sports', caption: 'tpl:punch', font: 'Oswald',
    colors: { main: '#0b3d2e', accent: '#f9c80e', extra: ['#e63946'] },
    words: ['cricket', 'sports', 'sport', 'football', 'kabaddi', 'ipl', 'match', 'highlights', 'player', 'tennis', 'badminton'] },
  { id: 'movies', name: 'Movies & reviews', caption: 'tpl:headline', font: 'Bebas Neue',
    colors: { main: '#141414', accent: '#e50914', extra: ['#f5c518'] },
    words: ['movie', 'film', 'cinema', 'trailer', 'tollywood', 'bollywood', 'kollywood', 'actor', 'actress', 'celebrity', 'review', 'web series', 'ott'] },
]

/** The style for anything that matched nothing: clean and simple, the app's own colours */
export const PLAIN_STYLE: BrandStyle = {
  id: 'plain', name: 'Clean & simple', caption: 'tpl:clean', font: 'Inter',
  colors: { main: '#1c1c22', accent: '#c8ff00', extra: [] }, words: [],
}

/**
 * The styles a description fits, best first (each scored by the words it has: a longer word or
 * phrase counts for more), then others to try (clean and simple, and other moods) up to `max`;
 * PLAIN_STYLE first when nothing matched. "Telugu cooking channel, warm and homely" → Food &
 * cooking first.
 */
export function matchBrandStyles(description: string, max = 4): BrandStyle[] {
  const text = ` ${description.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
  const scored = !text.trim() ? [] : BRAND_STYLES.map(st => ({
    st,
    score: st.words.reduce((n, w) => n + (text.includes(` ${w}`) ? 1 + w.length / 10 : 0), 0),
  })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.st)
  // (always a few to try: after the ones the words fit, clean and simple, then looks of other moods)
  const out = scored.length ? scored.slice(0, max) : [PLAIN_STYLE]
  for (const st of [PLAIN_STYLE, ...OTHER_MOODS.map(id => BRAND_STYLES.find(x => x.id === id)!)]) {
    if (out.length >= max) break
    if (!out.includes(st)) out.push(st)
  }
  return out
}

/** Styles of different moods offered after the ones a description fits: premium, loud, playful */
const OTHER_MOODS = ['fashion', 'motivation', 'comedy']

/** A style as found brand parts (the kit's colours and title font; its caption look is put on apart) */
export const foundFromStyle = (st: BrandStyle): FoundBrand => ({ colors: { ...st.colors, extra: [...st.colors.extra] }, font: st.font })
