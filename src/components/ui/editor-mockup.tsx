// Illustrated, animated replica of the Shortcut editing board for the landing page.
// Pure markup + CSS (styles: .mk-* in app/landing.css), laid out like the real editor today:
// header with breadcrumb · tool rail · options panel · format docks · canvas · control bar ·
// timeline · preview. The "video" is an original illustrated scene; the crop box on the canvas
// and the vertical preview share the same animation timing, so the preview always shows what's
// inside the crop box.

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
      <g opacity="0.5">
        <circle cx="18" cy="14" r="5" fill="#f5c07a" opacity="0.35" />
        <circle cx="34" cy="8" r="3" fill="#f5c07a" opacity="0.3" />
        <circle cx="128" cy="12" r="6" fill="#7fe3ee" opacity="0.25" />
        <circle cx="146" cy="24" r="3.5" fill="#f5c07a" opacity="0.3" />
        <circle cx="104" cy="6" r="2.5" fill="#fff" opacity="0.25" />
      </g>
      <g fill="#0a1015" opacity="0.9">
        <circle cx="14" cy="58" r="11" /><path d="M-4 90c2-16 10-24 18-24s16 8 18 24z" />
        <circle cx="38" cy="64" r="9" /><path d="M22 90c2-13 8-19 16-19s14 6 16 19z" />
        <circle cx="122" cy="60" r="10" /><path d="M104 90c2-15 9-22 18-22s16 7 18 22z" />
        <circle cx="148" cy="66" r="9" /><path d="M132 90c2-13 8-18 16-18s14 5 16 18z" />
      </g>
      <path d="M52 90c2-20 12-31 23-31s21 11 23 31z" fill="#1d2a33" />
      <path d="M66 62c3 4 6 5 9 5s6-1 9-5l1 8H65z" fill="#8a523a" />
      <ellipse cx="75" cy="44" rx="10" ry="12" fill="url(#mk-skin)" />
      <path d="M64 42c-1-11 5-17 12-17 8 0 13 6 12 16-2-5-5-8-9-8-5 0-9 2-15 9z" fill="#161616" />
      <path d="M70 47c1.5 1 3 1 4.5 0M76.5 47c1.5 1 3 1 4.5 0" stroke="#3a2419" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      <path d="M72 53c2 1.3 4.5 1.3 6.5 0" stroke="#5a2f22" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      <ellipse cx="96" cy="88" rx="20" ry="10" fill="#0b1217" opacity="0.85" />
    </svg>
  )
}

const THUMB_HUES = [18, 28, 200, 190, 32, 350, 210, 25, 180, 40, 330, 205, 15, 195, 22, 340]

const I = ({ d }: { d: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
)

const TOOLS: { label: string; on?: boolean; icon: React.ReactNode }[] = [
  { label: 'Format', icon: <path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14" /> },
  { label: 'Frames', icon: <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M6 12h12" /></> },
  { label: 'Captions', on: true, icon: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10.5 10.2a2.3 2.3 0 100 3.6M16.5 10.2a2.3 2.3 0 100 3.6" /></> },
  { label: 'Text', icon: <path d="M5 5h14M12 5v15" /> },
  { label: 'B-roll', icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" /></> },
  { label: 'Photos', icon: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></> },
  { label: 'Music', icon: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></> },
  { label: 'Cleanup', icon: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20" /></> },
]

const LayoutGlyph = ({ rows }: { rows: number }) => (
  <svg className="mk-glyph" viewBox="0 0 12 18" aria-hidden>
    <rect x="0.75" y="0.75" width="10.5" height="16.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    {rows === 1 && <rect x="2.5" y="2.5" width="7" height="13" rx="1" fill="currentColor" opacity=".55" />}
    {rows === 2 && <><rect x="2.5" y="2.5" width="7" height="5.6" rx="1" fill="currentColor" opacity=".55" /><rect x="2.5" y="9.9" width="7" height="5.6" rx="1" fill="currentColor" opacity=".55" /></>}
    {rows === 3 && <><rect x="2.5" y="2.5" width="7" height="3.7" rx=".8" fill="currentColor" opacity=".55" /><rect x="2.5" y="7.15" width="7" height="3.7" rx=".8" fill="currentColor" opacity=".55" /><rect x="2.5" y="11.8" width="7" height="3.7" rx=".8" fill="currentColor" opacity=".55" /></>}
    {rows === 0 && <rect x="2.5" y="6.5" width="7" height="5" rx="1" fill="currentColor" opacity=".55" />}
  </svg>
)

export function EditorMockup() {
  return (
    <div className="mk" role="img" aria-label="The Shortcut editing board turning a horizontal video into a vertical reel with captions">
      {/* Header: logo · breadcrumb · undo/redo · saved · help · profile */}
      <div className="mk-top">
        <span className="mk-logo">
          <svg viewBox="0 0 102 118" aria-hidden><path d="M36 2H92Q98 2 94 6L34 66A32 32 0 0 1 36 2Z" /><path d="M66 116H10Q4 116 8 112L68 52A32 32 0 0 1 66 116Z" /></svg>
          Shortcut
        </span>
        <span className="mk-divider" />
        <span className="mk-crumbs">Dashboard<i>›</i>Clip board<i>›</i><b>Editing board</b></span>
        <span className="mk-undo"><I d={<><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></>} /><I d={<><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 000 11H13" /></>} /></span>
        <span className="mk-saved">✓ Saved</span>
        <span className="mk-grow" />
        <span className="mk-help">?</span>
        <span className="mk-acct">Creator</span>
      </div>

      <div className="mk-body">
        {/* Tool rail */}
        <div className="mk-tools">
          {TOOLS.map(t => (
            <div key={t.label} className={`mk-tool${t.on ? ' on' : ''}`}>
              <I d={t.icon} /><span>{t.label}</span>
            </div>
          ))}
        </div>

        {/* Options panel: Captions */}
        <div className="mk-panel">
          <div className="mk-panel-title">Captions</div>
          <div className="mk-pcard">
            <span className="mk-pcard-icon"><I d={<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10.5 10.2a2.3 2.3 0 100 3.6M16.5 10.2a2.3 2.3 0 100 3.6" /></>} /></span>
            <span className="mk-pcard-text"><b>Show captions</b><small>● 55 words ready</small></span>
            <span className="mk-toggle on" />
          </div>
          <div className="mk-prow"><span>Language</span><span className="mk-seg"><i className="on">Original</i><i>English</i></span></div>
          <div className="mk-heading">Style</div>
          <div className="mk-tiles">
            <span className="on"><em>Hey <u>there</u></em>Karaoke</span>
            <span><em className="mk-up">HEY THERE</em>Hormozi</span>
            <span><em className="mk-box">Hey there</em>Box</span>
            <span><em className="mk-glow">Hey there</em>Glow</span>
          </div>
        </div>

        {/* Canvas, control bar and timeline */}
        <div className="mk-main">
          <div className="mk-docks">
            <span className="mk-dock">
              <span className="on"><LayoutGlyph rows={1} />Vertical</span>
              <span><LayoutGlyph rows={2} />Split screen</span>
              <span><LayoutGlyph rows={3} />Trio</span>
              <span><LayoutGlyph rows={0} />Horizontal</span>
            </span>
            <span className="mk-dock mk-motion"><i />Motion</span>
          </div>
          <div className="mk-canvas">
            <Scene />
            <div className="mk-crop">
              <span className="mk-tag">9:16</span>
              <span className="mk-zoom">1.0x</span>
              <i /><i /><i /><i />
            </div>
          </div>

          {/* Control bar: hide · trim · delete · music | previous · play · next · time | zoom */}
          <div className="mk-controls">
            <span className="mk-ctl-left">
              <I d={<><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 11l3 3 3-3" /></>} />
              <I d={<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" /></>} />
              <I d={<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />} />
            </span>
            <span className="mk-transport">
              <svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="2.4" height="14" rx="1" /><path d="M19 5.8v12.4a.8.8 0 01-1.2.7L9.5 12.7a.8.8 0 010-1.4l8.3-6.2a.8.8 0 011.2.7z" /></svg>
              <span className="mk-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></svg></span>
              <svg viewBox="0 0 24 24" fill="currentColor"><rect x="16.6" y="5" width="2.4" height="14" rx="1" /><path d="M5 5.8v12.4a.8.8 0 001.2.7l8.3-6.2a.8.8 0 000-1.4L6.2 5.1A.8.8 0 005 5.8z" /></svg>
              <span className="mk-time">0:42.3</span>
            </span>
            <span className="mk-ctl-zoom"><i>−</i><b>1x</b><i>+</i></span>
          </div>

          <div className="mk-timeline">
            <div className="mk-ruler"><span>0:00</span><span>0:15</span><span>0:30</span><span>0:45</span><span>1:00</span></div>
            <div className="mk-strip">
              {THUMB_HUES.map((h, i) => (
                <i key={i} style={{ background: `linear-gradient(160deg, hsl(${h} 45% 34%), hsl(${h} 35% 14%))` }} />
              ))}
              {/* Selected section: the lime trim frame with its ‹ › handles */}
              <span className="mk-select"><b>‹</b><b>›</b></span>
            </div>
            <div className="mk-sound"><span>♪ Video sound · 100%</span></div>
            <div className="mk-playhead"><span>0:42</span></div>
          </div>
        </div>

        {/* Preview: Export · how it looks in each app · the 9:16 reel with captions */}
        <div className="mk-preview">
          <div className="mk-preview-head">
            <b>Preview</b>
            <span className="mk-export">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 11.5l7-7M6 4.5h5.5V10" /></svg>
              Export
            </span>
          </div>
          <div className="mk-apps"><span className="on">Off</span><span>Instagram</span><span>YouTube</span></div>
          <div className="mk-phone">
            <div className="mk-phone-scene"><Scene /></div>
            <div className="mk-captions">
              <span>ఇది మీ కథ</span>
              <span>यह आपकी कहानी है</span>
              <span>this is your story</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
