'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import NumberFlow from '@number-flow/react'
import { Mail, MapPin, Phone } from 'lucide-react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionStyle } from 'framer-motion'
import { PricingSection, type PricingPlan } from '@/components/ui/pricing'
import { DotField } from '@/components/ui/dot-field'
import { TiltCard } from '@/components/ui/tilt-card'
import { FillButtonContent } from '@/components/ui/fill-button'
import { EditorMockup } from '@/components/ui/editor-mockup'
import { BrandLogo } from '@/components/ui/brand-logo'
import { CircularCarousel, type CarouselItem } from '@/components/ui/circular-carousel'
import { SectionTransition } from '@/components/ui/section-transition'
import { PLANS } from '@/lib/plans'

const free = PLANS.free
const pro = PLANS.starter // shown as "Pro" on the landing page
const business = PLANS.agency // shown as "Business"

// Annual pricing is display-only for now: billing only supports monthly.
// Every card lists the same rows (✓/✗) so plans are easy to compare.
// Notes: video limits are totals, not monthly (see checkVideoQuota); AI clip
// suggestions need a transcript, which only plans with auto-captions get.
function planFeatures(plan: (typeof PLANS)[keyof typeof PLANS]) {
  return [
    { text: 'AI finds the best moments', included: plan.autoCaption },
    { text: `Up to ${plan.maxFileSizeGb} GB per video`, included: true },
    { text: `${plan.retentionDays}-day history`, included: true },
    { text: 'Auto-captions in Telugu, Hindi & Hinglish', included: plan.autoCaption },
    { text: 'Your logo on your clips', included: true },
    { text: 'No watermark', included: !plan.watermark },
  ]
}

const videos = (n: number) => `${n} long video${n === 1 ? '' : 's'}`

const PRICING_PLANS: PricingPlan[] = [
  {
    name: 'Free',
    price: free.price,
    yearlyPrice: free.price,
    headline: `Process ${videos(free.maxVideos)}`,
    subline: `Cut up to ${free.maxClips} clips`,
    features: planFeatures(free),
    buttonText: 'Start for free',
    href: '/signup',
  },
  {
    name: 'Pro',
    price: pro.price,
    yearlyPrice: Math.round(pro.price * 0.8),
    headline: `Process ${videos(pro.maxVideos)}`,
    subline: 'Cut as many clips as you want',
    features: planFeatures(pro),
    buttonText: 'Go Pro',
    href: '/signup',
    badge: 'Most popular',
    isPopular: true,
  },
  {
    name: 'Business',
    price: business.price,
    yearlyPrice: Math.round(business.price * 0.8),
    headline: `Process ${videos(business.maxVideos)}`,
    subline: 'Cut as many clips as you want',
    features: planFeatures(business),
    buttonText: 'Go Business',
    href: '/signup',
    badge: 'For agencies',
  },
]

// Languages drifting across the closing section
const LANGUAGES = [
  { native: 'తెలుగు', name: 'Telugu' },
  { native: 'हिंदी', name: 'Hindi' },
  { native: 'தமிழ்', name: 'Tamil' },
  { native: 'ಕನ್ನಡ', name: 'Kannada' },
  { native: 'മലയാളം', name: 'Malayalam' },
  { native: 'বাংলা', name: 'Bengali' },
  { native: 'मराठी', name: 'Marathi' },
  { native: 'ગુજરાતી', name: 'Gujarati' },
  { native: 'ਪੰਜਾਬੀ', name: 'Punjabi' },
  { native: 'ଓଡ଼ିଆ', name: 'Odia' },
  { native: 'English', name: 'English' },
  { native: 'Hinglish', name: 'Hinglish' },
]
// Highlighted in lime wherever it appears
const HIGHLIGHT_LANGUAGE = 'Telugu'
// Per-lane depth and speed (cycled across the languages); odd lanes travel right → left
const LANE_SIZES = ['lg', 'sm', 'md', 'sm', 'lg', 'md'] as const
const LANE_DURATIONS = [22, 30, 26, 34, 24, 28]

// "How it works" steps
const STEPS = [
  { title: 'Upload', desc: 'Upload your long-form video.' },
  { title: 'Select', desc: 'Select the part you want to turn into a short.' },
  { title: 'Reframe', desc: 'Drag the frame on what matters. Your video renders in parallel.' },
  { title: 'Export', desc: 'Add captions, make quick edits, and export your short.' },
]

// Features shown in the circular carousel
const featureIcon = (glyph: string, tone: string) => <span className={`feature-icon ${tone}`} aria-hidden>{glyph}</span>

const FEATURES: CarouselItem[] = [
  { id: 'captions', tag: 'AI', icon: featureIcon('✦', 'fi-cyan'), title: 'Auto-Captions', description: 'AI-generated captions in multiple languages. Styled, timed, and ready to post — no manual typing.' },
  { id: 'crop', tag: 'Framing', icon: featureIcon('✂', 'fi-warm'), title: 'Smart Crop', description: 'Turn horizontal videos into vertical reels. Animate it across keyframes to follow movement.' },
  { id: 'export', tag: 'Export', icon: featureIcon('⬆', 'fi-green'), title: 'Original-Quality Export', description: 'Export in the original quality you uploaded, ready for Instagram, Shorts, or TikTok.' },
  { id: 'timeline', tag: 'Editing', icon: featureIcon('◈', 'fi-purple'), title: 'Multi-Segment Timeline', description: 'Split your clip into segments and pick a different layout for each one.' },
  { id: 'text', tag: 'Design', icon: featureIcon('≋', 'fi-yellow'), title: 'Text Overlays', description: 'Add custom text, titles, or call-outs anywhere on screen. Full style control — font, color, position.' },
  { id: 'search', tag: 'Search', icon: featureIcon('⌕', 'fi-blue'), title: 'Scene Search', description: 'Shortcut searches the captions and pulls out that exact moment from your video which is needed for you.' },
]

const CONTACT = {
  email: 'connect@mutinytalent.com',
  phone: '+91 9391869151',
  address: ['Block B, 4th Floor, Plot No. 206,', 'Kavuri Hills, Madhapur,', 'Hyderabad, Telangana 500033'],
}

const EXPLORE = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#process' },
  { label: 'Editor', href: '#editor' },
  { label: 'Pricing', href: '#pricing' },
]

// Placeholder Instagram handle ("shortcut") — swap in the real account later.
// bg is the brand colour of the circle that slides up on hover; hoverIcon (optional)
// replaces the icon on that circle.
const SOCIALS = [
  {
    label: 'Shortcut on Instagram',
    bg: 'linear-gradient(72.44deg, #FF7A00 11.92%, #FF0169 51.56%, #D300C5 85.69%)',
    href: 'https://instagram.com/shortcut',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" clipRule="evenodd" d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        <path d="M18 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
        <path fillRule="evenodd" clipRule="evenodd" d="M1.654 4.276C1 5.56 1 7.24 1 10.6v2.8c0 3.36 0 5.04.654 6.324a6 6 0 0 0 2.622 2.622C5.56 23 7.24 23 10.6 23h2.8c3.36 0 5.04 0 6.324-.654a6 6 0 0 0 2.622-2.622C23 18.44 23 16.76 23 13.4v-2.8c0-3.36 0-5.04-.654-6.324a6 6 0 0 0-2.622-2.622C18.44 1 16.76 1 13.4 1h-2.8C7.24 1 5.56 1 4.276 1.654a6 6 0 0 0-2.622 2.622ZM13.4 3h-2.8c-1.713 0-2.878.002-3.778.075-.877.072-1.325.202-1.638.361a4 4 0 0 0-1.748 1.748c-.16.313-.29.761-.361 1.638C3.002 7.722 3 8.887 3 10.6v2.8c0 1.713.002 2.878.075 3.778.072.877.202 1.325.361 1.638a4 4 0 0 0 1.748 1.748c.313.16.761.29 1.638.361.9.073 2.065.075 3.778.075h2.8c1.713 0 2.878-.002 3.778-.075.877-.072 1.325-.202 1.638-.361a4 4 0 0 0 1.748-1.748c.16-.313.29-.761.361-1.638.073-.9.075-2.065.075-3.778v-2.8c0-1.713-.002-2.878-.075-3.778-.072-.877-.202-1.325-.361-1.638a4 4 0 0 0-1.748-1.748c-.313-.16-.761-.29-1.638-.361C16.278 3.002 15.113 3 13.4 3Z" />
      </svg>
    ),
  },
  {
    label: 'Email Shortcut',
    bg: '#FFFFFF',
    href: `mailto:${CONTACT.email}`,
    icon: (
      <svg viewBox="52 42 88 66" width="22" height="17" fill="currentColor" aria-hidden>
        <path d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
        <path d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
        <path d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
        <path d="M72 74V48l24 18 24-18v26L96 92" />
        <path d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
      </svg>
    ),
    // Official multicolour Gmail logo (2020)
    hoverIcon: (
      <svg viewBox="52 42 88 66" width="22" height="17" aria-hidden>
        <path fill="#4285F4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
        <path fill="#34A853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
        <path fill="#FBBC04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
        <path fill="#EA4335" d="M72 74V48l24 18 24-18v26L96 92" />
        <path fill="#C5221F" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
      </svg>
    ),
  },
  {
    label: 'Shortcut on WhatsApp',
    bg: '#25D366',
    href: 'https://wa.me/919391869151',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
      </svg>
    ),
  },
]

// Hand-drawn arrow that swaps in for the label on .arrow-btn hover
function SquiggleArrow() {
  return (
    <svg className="arrow-btn-arrow" viewBox="0 0 38 15" fill="currentColor" aria-hidden>
      <path d="M10 7.519l-.939-.344h0l.939.344zm14.386-1.205l-.981-.192.981.192zm1.276 5.509l.537.843.148-.094.107-.139-.792-.611zm4.819-4.304l-.385-.923h0l.385.923zm7.227.707a1 1 0 0 0 0-1.414L31.343.448a1 1 0 0 0-1.414 0 1 1 0 0 0 0 1.414l5.657 5.657-5.657 5.657a1 1 0 0 0 1.414 1.414l6.364-6.364zM1 7.519l.554.833.029-.019.094-.061.361-.23 1.277-.77c1.054-.609 2.397-1.32 3.629-1.787.617-.234 1.17-.392 1.623-.455.477-.066.707-.008.788.034.025.013.031.021.039.034a.56.56 0 0 1 .058.235c.029.327-.047.906-.39 1.842l1.878.689c.383-1.044.571-1.949.505-2.705-.072-.815-.45-1.493-1.16-1.865-.627-.329-1.358-.332-1.993-.244-.659.092-1.367.305-2.056.566-1.381.523-2.833 1.297-3.921 1.925l-1.341.808-.385.245-.104.068-.028.018c-.011.007-.011.007.543.84zm8.061-.344c-.198.54-.328 1.038-.36 1.484-.032.441.024.94.325 1.364.319.45.786.64 1.21.697.403.054.824-.001 1.21-.09.775-.179 1.694-.566 2.633-1.014l3.023-1.554c2.115-1.122 4.107-2.168 5.476-2.524.329-.086.573-.117.742-.115s.195.038.161.014c-.15-.105.085-.139-.076.685l1.963.384c.192-.98.152-2.083-.74-2.707-.405-.283-.868-.37-1.28-.376s-.849.069-1.274.179c-1.65.43-3.888 1.621-5.909 2.693l-2.948 1.517c-.92.439-1.673.743-2.221.87-.276.064-.429.065-.492.057-.043-.006.066.003.155.127.07.099.024.131.038-.063.014-.187.078-.49.243-.94l-1.878-.689zm14.343-1.053c-.361 1.844-.474 3.185-.413 4.161.059.95.294 1.72.811 2.215.567.544 1.242.546 1.664.459a2.34 2.34 0 0 0 .502-.167l.15-.076.049-.028.018-.011c.013-.008.013-.008-.524-.852l-.536-.844.019-.012c-.038.018-.064.027-.084.032-.037.008.053-.013.125.056.021.02-.151-.135-.198-.895-.046-.734.034-1.887.38-3.652l-1.963-.384zm2.257 5.701l.791.611.024-.031.08-.101.311-.377 1.093-1.213c.922-.954 2.005-1.894 2.904-2.27l-.771-1.846c-1.31.547-2.637 1.758-3.572 2.725l-1.184 1.314-.341.414-.093.117-.025.032c-.01.013-.01.013.781.624zm5.204-3.381c.989-.413 1.791-.42 2.697-.307.871.108 2.083.385 3.437.385v-2c-1.197 0-2.041-.226-3.19-.369-1.114-.139-2.297-.146-3.715.447l.771 1.846z" />
    </svg>
  )
}

export function LandingPage() {
  // One progress value drives the whole hero → features transition:
  // 0 when the features sheet enters the bottom of the screen, 1 when it reaches the top.
  const sheetRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress: raw } = useScroll({ target: sheetRef, offset: ['start end', 'start start'] })
  const p = useSpring(raw, { stiffness: 120, damping: 24, mass: 0.3 })
  const reduceMotion = useReducedMotion()
  const fx = (style: MotionStyle) => (reduceMotion ? undefined : style)

  // Hero breaks apart: lines drift in opposite directions, text blurs and recedes
  const line1X = useTransform(p, [0, 1], ['0%', '-22%'])
  const line2X = useTransform(p, [0, 1], ['0%', '22%'])
  const textOpacity = useTransform(p, [0, 0.75], [1, 0])
  const textScale = useTransform(p, [0, 1], [1, 0.9])
  const textBlur = useTransform(p, [0, 0.75], ['blur(0px)', 'blur(12px)'])
  const detailsOpacity = useTransform(p, [0, 0.35], [1, 0])
  const detailsY = useTransform(p, [0, 0.35], [0, -40])
  // Background dot field fades out as the hero recedes
  const fieldOpacity = useTransform(p, [0, 0.8], [1, 0])
  // Features rises as a card and flattens to full width
  const sheetScale = useTransform(p, [0, 1], [0.9, 1])
  const sheetRadius = useTransform(p, [0, 1], [48, 0])

  const heroRef = useRef<HTMLElement>(null)

  // Speed stat counts up 1 → 10 once the pill has faded in
  const [speed, setSpeed] = useState(1)
  useEffect(() => {
    if (reduceMotion) { setSpeed(10); return }
    const t = setTimeout(() => setSpeed(10), 1300)
    return () => clearTimeout(t)
  }, [reduceMotion])

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target) }
      }),
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    )
    document.querySelectorAll('.lp-root .reveal').forEach((el, i) => {
      ;(el as HTMLElement).style.transitionDelay = (i % 3) * 0.07 + 's'
      observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  return (
    <div className="lp-root">

      {/* ── NAV ── */}
      <nav className="lp-nav">
        <a href="#" className="logo" aria-label="Shortcut home"><BrandLogo shine /></a>
        <ul className="nav-links">
          <li>
            <a
              href="#"
              onClick={e => {
                e.preventDefault()
                window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
              }}
            >
              Home
            </a>
          </li>
          <li><a href="#features">Features</a></li>
          <li><a href="#process">How it works</a></li>
          <li><a href="#editor">Editor</a></li>
          <li><a href="#pricing">Pricing</a></li>
        </ul>
        <div className="nav-right">
          <Link href="/login" className="btn-nav-ghost fill-btn fill-btn-sm"><FillButtonContent>Log in</FillButtonContent></Link>
          <Link href="/signup" className="btn-nav-primary arrow-btn">
            <span className="arrow-btn-label">Get started free</span>
            <SquiggleArrow />
          </Link>
        </div>
      </nav>

      {/* ── HERO + FEATURES: hero pins while features slides over it ── */}
      <div className="hero-stack">
      <section className="hero" ref={heroRef}>
        {/* Soft light shade, same as the closing CTA section */}
        <div className="hero-shade" aria-hidden />
        {/* Interactive dot field: lights up around the cursor, ripples on click */}
        <motion.div className="hero-field" aria-hidden style={fx({ opacity: fieldOpacity })}>
          <DotField hostRef={heroRef} />
        </motion.div>

        <motion.div className="hero-text" style={fx({ opacity: textOpacity, scale: textScale, filter: textBlur })}>
          <div className="hero-eyebrow intro" style={{ '--d': '0s' } as React.CSSProperties}>
            <span className="eyebrow-dot" />
            Built for Indian creators
          </div>
          <h1 className="hero-headline">
            <motion.span className="line" style={fx({ x: line1X })}><span className="line-inner">The <span className="warm">Shortcut</span></span></motion.span>
            <motion.span className="line" style={fx({ x: line2X })}><span className="line-inner">to Short-Form.</span></motion.span>
          </h1>
          <motion.div style={fx({ opacity: detailsOpacity, y: detailsY })}>
          <p className="hero-sub intro" style={{ '--d': '.55s' } as React.CSSProperties}>
            The fastest way to turn long videos into short clips
          </p>
          <div className="hero-meta intro" style={{ '--d': '.85s' } as React.CSSProperties}>
            <div className="hero-meta-item">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.6 3.3 3.6.5-2.6 2.5.6 3.6L7 9.3l-3.2 1.6.6-3.6L1.8 4.8l3.6-.5L7 1z" fill="currentColor" /></svg>
              Free to start
            </div>
            <div className="hero-meta-item">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" /><path d="M7 4.5v3l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
              Export in minutes
            </div>
            <div className="hero-meta-item">
              {/* landscape frame → portrait frame */}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="0.9" y="3.5" width="6.6" height="4.6" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="9" y="1.6" width="4.1" height="7.6" rx="1" stroke="currentColor" strokeWidth="1.3" /><path d="M3 11.2c1.6 1.3 4.3 1.4 6.3-.2m0 0-1.6-.1m1.6.1-.3-1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Horizontal to vertical
            </div>
          </div>
          <div className="hero-speed intro" style={{ '--d': '1s' } as React.CSSProperties}>
            <span className="speed-num">
              <NumberFlow value={speed} className="tabular-nums" />×
            </span>
            <span className="speed-text"><strong>faster.</strong> Less editing, more posting.</span>
          </div>
          </motion.div>
        </motion.div>

      </section>

      {/* ── FEATURES (slides up over the pinned hero) ── */}
      <motion.div
        id="features"
        ref={sheetRef}
        className="section-wrap sheet"
        style={fx({ scale: sheetScale, borderTopLeftRadius: sheetRadius, borderTopRightRadius: sheetRadius })}
      >
        <section className="section-inner">
          <div className="section-head reveal">
            <p className="section-eyebrow">What you get</p>
            <h2 className="section-title">Everything your reel needs</h2>
            <p className="section-sub">A focused toolkit — no bloat, no learning curve. From raw footage to export-ready reel without switching tabs.</p>
          </div>
          <div className="reveal">
            <CircularCarousel items={FEATURES} />
          </div>
        </section>
      </motion.div>
      </div>

      {/* ── PROCESS ── */}
      <SectionTransition id="process" variant="tilt" className="section-wrap">
        <section className="section-inner">
          <div className="section-head reveal">
            <p className="section-eyebrow">How it works</p>
            <h2 className="section-title">From footage to reel in 4 steps</h2>
          </div>
          <div className="process-grid">
            {STEPS.map((step, i) => (
              <TiltCard key={step.title} className="process-step" index={i}>
                <div className="tilt-card-inner">
                  <div className="step-num"><div className="step-num-circle">{i + 1}</div> Step {i + 1}</div>
                  <h3 className="step-title">{step.title}</h3>
                  <p className="step-desc">{step.desc}</p>
                </div>
              </TiltCard>
            ))}
          </div>
        </section>
      </SectionTransition>

      {/* ── EDITOR: the editor in action ── */}
      <SectionTransition id="editor" variant="iris" className="section-wrap">
        <section className="section-inner">
          <div className="section-head reveal">
            <p className="section-eyebrow">Inside the editor</p>
            <h2 className="section-title">Crop, caption and cut in one place</h2>
          </div>
          <div className="editor-showcase reveal">
            <EditorMockup />
          </div>
        </section>
      </SectionTransition>

      {/* ── PRICING ── */}
      <SectionTransition id="pricing" variant="zoom" className="section-wrap">
        <PricingSection
          plans={PRICING_PLANS}
          eyebrow="Pricing"
          title="Simple pricing. Serious reels."
          description={'Start free. Go Pro when your content takes off.'}
        />
      </SectionTransition>

      {/* ── CTA ── */}
      <section className="cta-section">
        {/* One language per line, gliding across in alternating directions (decorative) */}
        <div className="lang-marquees" aria-hidden>
          {LANGUAGES.map((l, i) => (
            <div key={l.name} className="lang-lane" style={{ top: `${6 + i * (88 / (LANGUAGES.length - 1))}%` }}>
              <span
                className={`lm-chip lm-${LANE_SIZES[i % LANE_SIZES.length]}${i % 2 ? ' rtl' : ''}${l.name === HIGHLIGHT_LANGUAGE ? ' on' : ''}`}
                style={{
                  '--lm-dur': `${LANE_DURATIONS[i % LANE_DURATIONS.length]}s`,
                  '--lm-delay': `${-((i * 7.3) % LANE_DURATIONS[i % LANE_DURATIONS.length])}s`,
                } as React.CSSProperties}
              >
                <b>{l.native}</b>{l.name !== l.native && <small>{l.name}</small>}
              </span>
            </div>
          ))}
        </div>
        <h2 className="reveal">Ready to <span className="accent">cut</span> your first reel?</h2>
        <p className="reveal">Join thousands of Indian creators already editing on Shortcut. Free to start, no credit card.</p>
        <div className="lang-multi reveal">
          {/* globe */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9.5" /><path d="M2.5 12h19" /><path d="M12 2.5c2.6 2.8 3.9 6 3.9 9.5s-1.3 6.7-3.9 9.5c-2.6-2.8-3.9-6-3.9-9.5s1.3-6.7 3.9-9.5z" />
          </svg>
          Auto-captions in multiple languages
        </div>
        <p className="lang-note reveal"><Link href="/signup">Get started →</Link></p>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="footer-top">
          <div className="footer-brand">
            <a href="#" className="footer-logo" aria-label="Shortcut home"><BrandLogo size="sm" /></a>
            <p className="footer-tagline">Transcribe, clip, and edit vertical videos in Telugu, Hindi, and Hinglish.</p>
            <div className="socials">
              {SOCIALS.map(s => (
                <a
                  key={s.label}
                  href={s.href}
                  className="social"
                  aria-label={s.label}
                  title={s.label}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ '--brand-bg': s.bg } as React.CSSProperties}
                >
                  <span className="social-face">{s.icon}</span>
                  <span className="social-face social-face-hover" aria-hidden>{s.hoverIcon ?? s.icon}</span>
                </a>
              ))}
            </div>
          </div>

          <nav className="footer-col" aria-label="Explore">
            <h4 className="footer-heading">Explore</h4>
            <ul className="footer-list">
              {EXPLORE.map(l => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}
            </ul>
          </nav>

          <div className="footer-col" id="contact">
            <h4 className="footer-heading">Contact</h4>
            <ul className="footer-list footer-contact">
              <li><Mail aria-hidden /><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></li>
              <li><Phone aria-hidden /><a href={`tel:${CONTACT.phone.replace(/\s/g, '')}`}>{CONTACT.phone}</a></li>
              <li><MapPin aria-hidden /><address>{CONTACT.address.map(line => <span key={line}>{line}</span>)}</address></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <span className="footer-copy">© 2026 Shortcut. All rights reserved.</span>
          <div className="footer-links">
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#contact">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
