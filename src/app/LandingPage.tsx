'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import './landing.css'
import { SplineScene } from '@/components/ui/splite'
import { Spotlight } from '@/components/ui/spotlight'
import { LiquidButton } from '@/components/ui/liquid-glass-button'

export function LandingPage() {
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
        <a href="#" className="logo">✂ Chai <span className="cut-word">Cut</span></a>
        <ul className="nav-links">
          <li><a href="#features">Features</a></li>
          <li><a href="#process">How it works</a></li>
          <li><a href="#languages">Languages</a></li>
          <li><a href="#pricing">Pricing</a></li>
        </ul>
        <div className="nav-right">
          <Link href="/login" className="btn-nav-ghost">Log in</Link>
          <Link href="/signup" className="btn-nav-primary">Get started free</Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="hero hero-3d">
        <Spotlight size={600} />

        {/* Left: text */}
        <div className="hero-text">
          <div className="hero-eyebrow">
            <span className="eyebrow-dot" />
            Built for Indian creators
          </div>
          <h1 className="hero-headline">
            Your reel,<br />your voice.<br /><span className="warm">Auto-captioned.</span>
          </h1>
          <p className="hero-sub">
            Chai Cut trims, crops, and captions your short-form video in minutes — with support for Telugu, Hindi, Tamil, and five more Indian languages.
          </p>
          <div className="cta-row">
            <LiquidButton asChild size="lg">
              <Link href="/signup">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1.5L12.5 7 7 12.5M1.5 7h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Start editing free
              </Link>
            </LiquidButton>
            <LiquidButton asChild size="lg">
              <a href="#features">See features</a>
            </LiquidButton>
          </div>
          <div className="hero-meta">
            <div className="hero-meta-item">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.6 3.3 3.6.5-2.6 2.5.6 3.6L7 9.3l-3.2 1.6.6-3.6L1.8 4.8l3.6-.5L7 1z" fill="currentColor" /></svg>
              Free to start
            </div>
            <div className="hero-meta-item">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" /><path d="M7 4.5v3l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
              Export in minutes
            </div>
            <div className="hero-meta-item">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="3" width="11" height="8" rx="2" stroke="currentColor" strokeWidth="1.4" /><path d="M5 6.5l2 1.5 2-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              No watermarks
            </div>
          </div>
        </div>

        {/* Right: 3D Spline scene */}
        <div className="hero-3d-scene">
          <SplineScene
            scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
            className="w-full h-full"
          />
        </div>
      </section>

      {/* ── FEATURES ── */}
      <div id="features" className="features-bg">
        <section className="features-section">
          <div className="reveal">
            <p className="section-eyebrow">What you get</p>
            <h2 className="section-title">Everything your reel needs</h2>
            <p className="section-sub">A focused toolkit — no bloat, no learning curve. From raw footage to export-ready reel without switching tabs.</p>
          </div>
          <div className="features-grid">
            <div className="feature-card reveal">
              <div className="feature-icon fi-cyan">✦</div>
              <h3 className="feature-title">Auto-Captions</h3>
              <p className="feature-desc">AI-generated captions in Telugu, Hindi, Tamil and more. Styled, timed, and ready to post — no manual typing.</p>
            </div>
            <div className="feature-card reveal">
              <div className="feature-icon fi-warm">✂</div>
              <h3 className="feature-title">Smart Crop</h3>
              <p className="feature-desc">Drag a crop box to frame your subject in 9:16. Animate it across keyframes to follow movement.</p>
            </div>
            <div className="feature-card reveal">
              <div className="feature-icon fi-green">⬆</div>
              <h3 className="feature-title">4K Export</h3>
              <p className="feature-desc">Export up to 2160p. No watermarks. Download directly to your device, ready for Instagram, Shorts, or TikTok.</p>
            </div>
            <div className="feature-card reveal">
              <div className="feature-icon fi-purple">◈</div>
              <h3 className="feature-title">Multi-Segment Timeline</h3>
              <p className="feature-desc">Split your clip into segments, pick layouts per segment, and add transitions between them.</p>
            </div>
            <div className="feature-card reveal">
              <div className="feature-icon fi-yellow">≋</div>
              <h3 className="feature-title">Text Overlays</h3>
              <p className="feature-desc">Add custom text, titles, or call-outs anywhere on screen. Full style control — font, color, position.</p>
            </div>
            <div className="feature-card reveal">
              <div className="feature-icon fi-blue">♫</div>
              <h3 className="feature-title">Audio Mixer</h3>
              <p className="feature-desc">Layer background music, control volume per track, and keep your voice front and centre.</p>
            </div>
          </div>
        </section>
      </div>

      {/* ── PROCESS ── */}
      <div id="process" className="process-wrap">
        <div className="process-inner">
          <div className="reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
            <p className="section-eyebrow">How it works</p>
            <h2 className="section-title">From footage to reel in 3 steps</h2>
          </div>
          <div className="process-grid">
            <div className="process-step reveal">
              <span className="arrow-connector">→</span>
              <div className="step-num"><div className="step-num-circle">1</div> Upload</div>
              <h3 className="step-title">Drop your video</h3>
              <p className="step-desc">Upload from your device or paste a link. Chai Cut handles any length — short clips or hour-long sessions.</p>
            </div>
            <div className="process-step reveal">
              <span className="arrow-connector">→</span>
              <div className="step-num"><div className="step-num-circle">2</div> Edit</div>
              <h3 className="step-title">Crop, caption, cut</h3>
              <p className="step-desc">Set your crop frame, let auto-captions run, trim segments, add text overlays — all in one editor.</p>
            </div>
            <div className="process-step reveal">
              <div className="step-num"><div className="step-num-circle">3</div> Export</div>
              <h3 className="step-title">Download and post</h3>
              <p className="step-desc">Hit export, pick your quality, and download a watermark-free MP4 — ready for any platform.</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── LANGUAGES ── */}
      <section id="languages" className="lang-section">
        <div className="reveal">
          <p className="section-eyebrow">Language support</p>
          <h2 className="section-title">Your language, your content</h2>
          <p style={{ margin: '14px auto 48px', maxWidth: 480, color: 'var(--muted)', fontSize: 16, lineHeight: 1.7 }}>
            Auto-captions work in eight Indian languages. Each one includes Romanized transliteration so viewers can read along even without knowing the script.
          </p>
        </div>
        <div className="lang-grid">
          <div className="lang-card reveal"><span className="lang-name">Telugu</span><span className="lang-native">తెలుగు</span></div>
          <div className="lang-card reveal"><span className="lang-name">Hindi</span><span className="lang-native">हिंदी</span></div>
          <div className="lang-card reveal"><span className="lang-name">Tamil</span><span className="lang-native">தமிழ்</span></div>
          <div className="lang-card reveal"><span className="lang-name">Kannada</span><span className="lang-native">ಕನ್ನಡ</span></div>
          <div className="lang-card reveal"><span className="lang-name">Malayalam</span><span className="lang-native">മലയാളം</span></div>
          <div className="lang-card reveal"><span className="lang-name">Bengali</span><span className="lang-native">বাংলা</span></div>
          <div className="lang-card reveal"><span className="lang-name">Marathi</span><span className="lang-native">मराठी</span></div>
          <div className="lang-card reveal"><span className="lang-name">Gujarati</span><span className="lang-native">ગુજરાતી</span></div>
        </div>
        <p className="lang-note reveal">All languages include Romanized transliteration. <Link href="/signup">Get started →</Link></p>
      </section>

      {/* ── PRICING ── */}
      <div id="pricing" className="pricing-wrap">
        <div className="pricing-inner">
          <div className="reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
            <p className="section-eyebrow">Pricing</p>
            <h2 className="section-title">Start free, grow as you create</h2>
            <p style={{ fontSize: 16, color: 'var(--muted)', marginTop: 12 }}>No credit card needed to get started.</p>
          </div>
          <div className="pricing-grid">
            <div className="price-card reveal">
              <p className="price-plan">Free</p>
              <p className="price-amount"><small>₹</small>0</p>
              <p className="price-per">forever</p>
              <div className="price-divider" />
              <ul className="price-list">
                <li><span className="check">✓</span> Upload &amp; trim clips</li>
                <li><span className="check">✓</span> Smart crop + keyframes</li>
                <li><span className="check">✓</span> Text overlays</li>
                <li><span className="check">✓</span> Export up to 1080p</li>
                <li className="locked"><span className="lock">🔒</span> Auto-captions</li>
                <li className="locked"><span className="lock">🔒</span> 4K export</li>
                <li className="locked"><span className="lock">🔒</span> Audio mixer</li>
              </ul>
              <Link href="/signup" className="price-btn secondary">Get started free</Link>
            </div>
            <div className="price-card featured reveal">
              <div className="price-badge">Most popular</div>
              <p className="price-plan">Starter</p>
              <p className="price-amount"><small>₹</small>299</p>
              <p className="price-per">per month</p>
              <div className="price-divider" />
              <ul className="price-list">
                <li><span className="check">✓</span> Everything in Free</li>
                <li><span className="check">✓</span> Auto-captions in 8 languages</li>
                <li><span className="check">✓</span> 4K (2160p) export</li>
                <li><span className="check">✓</span> Audio mixer</li>
                <li><span className="check">✓</span> Filters &amp; transitions</li>
                <li><span className="check">✓</span> No watermarks</li>
                <li><span className="check">✓</span> Priority export queue</li>
              </ul>
              <Link href="/signup" className="price-btn primary">Start 7-day free trial</Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── CTA ── */}
      <section className="cta-section">
        <h2 className="reveal">Ready to <span style={{ color: 'var(--warm)' }}>cut</span> your first reel?</h2>
        <p className="reveal">Join thousands of Indian creators already editing on Chai Cut. Free to start, no credit card.</p>
        <div className="cta-btns reveal">
          <Link href="/signup" className="btn-primary" style={{ fontSize: 16, padding: '16px 40px' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1.5L12.5 7 7 12.5M1.5 7h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Start editing free
          </Link>
          <a href="#features" className="btn-ghost" style={{ fontSize: 16, padding: '16px 32px' }}>See all features</a>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="footer-left">
          <a href="#" className="footer-logo">✂ Chai <span className="cut-word">Cut</span></a>
          <span className="footer-copy">© 2026 Chai Cut. All rights reserved.</span>
        </div>
        <div className="footer-links">
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
          <a href="#">Contact</a>
        </div>
      </footer>
    </div>
  )
}
