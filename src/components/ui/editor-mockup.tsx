// Illustrated, animated replica of the Shortcut editor for the landing hero.
// Pure markup + CSS (styles: .mk-* in app/landing.css). The "video" is an original
// illustrated scene; the crop box on the canvas and the vertical preview share the
// same animation timing, so the preview always shows what's inside the crop box.

function Scene() {
  return (
    <svg className="mk-scene" viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden>
      <defs>
        <radialGradient id="mk-warm" cx="0.28" cy="0.2" r="0.6">
          <stop offset="0" stopColor="#f2a65a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f2a65a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="mk-cool" cx="0.85" cy="0.8" r="0.55">
          <stop offset="0" stopColor="#1fb8c9" stopOpacity="0.4" />
          <stop offset="1" stopColor="#1fb8c9" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mk-skin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e0a07a" />
          <stop offset="1" stopColor="#9c5f43" />
        </linearGradient>
      </defs>
      <rect width="160" height="90" fill="#101a20" />
      <rect width="160" height="90" fill="url(#mk-warm)" />
      <rect width="160" height="90" fill="url(#mk-cool)" />
      {/* soft bokeh lights */}
      <g opacity="0.5">
        <circle cx="18" cy="14" r="5" fill="#f5c07a" opacity="0.35" />
        <circle cx="34" cy="8" r="3" fill="#f5c07a" opacity="0.3" />
        <circle cx="128" cy="12" r="6" fill="#7fe3ee" opacity="0.25" />
        <circle cx="146" cy="24" r="3.5" fill="#f5c07a" opacity="0.3" />
        <circle cx="104" cy="6" r="2.5" fill="#fff" opacity="0.25" />
      </g>
      {/* blurred crowd */}
      <g fill="#0a1015" opacity="0.9">
        <circle cx="14" cy="58" r="11" /><path d="M-4 90c2-16 10-24 18-24s16 8 18 24z" />
        <circle cx="38" cy="64" r="9" /><path d="M22 90c2-13 8-19 16-19s14 6 16 19z" />
        <circle cx="122" cy="60" r="10" /><path d="M104 90c2-15 9-22 18-22s16 7 18 22z" />
        <circle cx="148" cy="66" r="9" /><path d="M132 90c2-13 8-18 16-18s14 5 16 18z" />
      </g>
      {/* subject */}
      <path d="M52 90c2-20 12-31 23-31s21 11 23 31z" fill="#1d2a33" />
      <path d="M66 62c3 4 6 5 9 5s6-1 9-5l1 8H65z" fill="#8a523a" />
      <ellipse cx="75" cy="44" rx="10" ry="12" fill="url(#mk-skin)" />
      <path d="M64 42c-1-11 5-17 12-17 8 0 13 6 12 16-2-5-5-8-9-8-5 0-9 2-15 9z" fill="#161616" />
      <path d="M70 47c1.5 1 3 1 4.5 0M76.5 47c1.5 1 3 1 4.5 0" stroke="#3a2419" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      <path d="M72 53c2 1.3 4.5 1.3 6.5 0" stroke="#5a2f22" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      {/* foreground blur */}
      <ellipse cx="96" cy="88" rx="20" ry="10" fill="#0b1217" opacity="0.85" />
    </svg>
  )
}

// Same palette as the editor's caption colour picker (first three match the cycling captions)
const CAPTION_SWATCHES = ['#FFE600', '#FFFFFF', '#22D3EE', '#C8FF00', '#EC4899', '#F97316']

const THUMB_HUES =[18, 28, 200, 190, 32, 350, 210, 25, 180, 40, 330, 205, 15, 195]

export function EditorMockup() {
  return (
    <div className="mk" role="img" aria-label="The Shortcut editor turning a horizontal video into a vertical reel with auto-captions">
      {/* top bar */}
      <div className="mk-top">
        <span className="mk-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </span>
        <div className="mk-title"><b>Podcast Ep. 12</b><small>Saving…</small></div>
        <span className="mk-export">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
          Export
        </span>
      </div>

      <div className="mk-body">
        {/* tool rail */}
        <div className="mk-tools">
          <div className="mk-tool">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" /></svg>
            <span>Crop</span>
          </div>
          <div className="mk-tool on">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M16.5 10.2a2.3 2.3 0 1 0 0 3.6" /></svg>
            <span>Captions</span>
          </div>
          <div className="mk-tool">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 5h14M12 5v15" /></svg>
            <span>Text</span>
          </div>
          <div className="mk-tool">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>
            <span>Media</span>
          </div>
        </div>

        {/* canvas + controls + timeline */}
        <div className="mk-main">
          <div className="mk-tabs">
            <span className="on">Vertical</span><span>Split screen</span><span>Trio</span><span>Horizontal</span>
            <span className="mk-motion"><i />Motion</span>
          </div>
          <div className="mk-canvas">
            <Scene />
            <div className="mk-crop">
              <span className="mk-tag">9:16</span>
              <span className="mk-zoom">1.0x</span>
              <i /><i /><i /><i />
            </div>
          </div>
          <div className="mk-controls">
            <span className="mk-split">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" /></svg>
              Split
            </span>
            <span className="mk-transport">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 5v14M18 6l-8 6 8 6" /></svg>
              <span className="mk-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></svg></span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 5v14M6 6l8 6-8 6" /></svg>
            </span>
            <span className="mk-time">0:42 / 1:00</span>
          </div>
          <div className="mk-timeline">
            <div className="mk-ruler"><span>0:00</span><span>0:20</span><span>0:40</span><span>1:00</span></div>
            <div className="mk-segs"><i /><i /><i /></div>
            <div className="mk-strip">
              {THUMB_HUES.map((h, i) => (
                <i key={i} style={{ background: `linear-gradient(160deg, hsl(${h} 45% 34%), hsl(${h} 35% 14%))` }} />
              ))}
            </div>
            <div className="mk-select" />
            <div className="mk-playhead" />
          </div>
        </div>

        {/* vertical preview */}
        <div className="mk-preview">
          <div className="mk-preview-head"><b>Preview</b><small>9:16</small></div>
          <div className="mk-phone">
            <div className="mk-phone-scene"><Scene /></div>
            <div className="mk-captions">
              <span>ఇది మీ కథ</span>
              <span>यह आपकी कहानी है</span>
              <span>this is your story</span>
            </div>
          </div>

          {/* caption style controls, like the real Captions panel. The ring on the
              first three swatches moves in step with the caption colour above. */}
          <div className="mk-style">
            <div className="mk-style-label">Caption style</div>
            <div className="mk-swatches">
              {CAPTION_SWATCHES.map(c => <i key={c} style={{ background: c }} />)}
              <i className="mk-rainbow" />
            </div>
            <div className="mk-size"><span>Size</span><span>52px</span></div>
            <div className="mk-slider"><i /><b /></div>
            <div className="mk-case"><span className="on">Aa</span><span>AA</span><span>aa</span></div>
          </div>
        </div>
      </div>

      {/* floating captions card */}
      <div className="mk-float">
        <div className="mk-float-head">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M16.5 10.2a2.3 2.3 0 1 0 0 3.6" /></svg>
          Captions
        </div>
        <div className="mk-row"><span>Show captions</span><span className="mk-toggle on" /></div>
        <div className="mk-ok">✓ 55 words transcribed</div>
        <div className="mk-row"><span>Tenglish<small>Show captions in English letters</small></span><span className="mk-toggle" /></div>
        <div className="mk-edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          Edit caption text
        </div>
      </div>
    </div>
  )
}
