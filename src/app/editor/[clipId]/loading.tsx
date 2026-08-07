export default function EditorLoading() {
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#0d0d0d', overflow: 'hidden' }}>
      <style>{`
        @keyframes shimmer {
          0%   { opacity: 0.4 }
          50%  { opacity: 0.7 }
          100% { opacity: 0.4 }
        }
        .sk { animation: shimmer 1.4s ease-in-out infinite; background: rgba(255,255,255,0.08); border-radius: 6px; }
        .sk-slow { animation: shimmer 1.8s ease-in-out infinite; background: rgba(255,255,255,0.06); border-radius: 6px; }
      `}</style>

      {/* Header */}
      <header style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', background: '#111', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="sk" style={{ width: 32, height: 32, borderRadius: 8 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div className="sk" style={{ width: 120, height: 10 }} />
          <div className="sk" style={{ width: 180, height: 8, opacity: 0.5 }} />
        </div>
        <div style={{ flex: 1 }} />
        {/* Layout buttons */}
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(0,0,0,0.4)' }}>
          {['Vertical', 'Split', 'Trio', 'Horizontal'].map((l, i) => (
            <div key={l} className="sk" style={{ width: i === 0 ? 56 : 44, height: 28, borderRadius: 8, background: i === 0 ? 'rgba(0,180,216,0.25)' : undefined }} />
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div className="sk" style={{ width: 110, height: 32, borderRadius: 8 }} />
      </header>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>

        {/* Left: canvas + timeline */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Video canvas */}
          <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', inset: 6, borderRadius: 16, border: '1.5px solid rgba(255,255,255,0.08)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a' }}>
              {/* Placeholder video frame */}
              <div className="sk-slow" style={{ width: '60%', aspectRatio: '16/9', borderRadius: 10 }} />
            </div>
          </div>

          {/* Playback controls */}
          <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', background: '#111', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="sk" style={{ width: 28, height: 28, borderRadius: 6 }} />
            <div className="sk" style={{ width: 36, height: 36, borderRadius: 18 }} />
            <div className="sk" style={{ width: 28, height: 28, borderRadius: 6 }} />
            <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }}>
              <div style={{ width: '0%', height: '100%', background: '#00b4d8', borderRadius: 2 }} />
            </div>
            <div className="sk" style={{ width: 60, height: 14, borderRadius: 4 }} />
          </div>

          {/* Segment timeline */}
          <div style={{ height: 52, flexShrink: 0, background: '#0d0d0d', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="sk" style={{ flex: 1, height: 32, borderRadius: 8 }} />
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#111', borderLeft: '1px solid rgba(255,255,255,0.07)' }}>

          {/* 9:16 preview */}
          <div style={{ padding: 12, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="sk" style={{ width: 80, height: 10, marginBottom: 10 }} />
            <div className="sk-slow" style={{ width: '100%', aspectRatio: '9/16', borderRadius: 10 }} />
            <div className="sk" style={{ width: '100%', height: 40, borderRadius: 10, marginTop: 10 }} />
          </div>

          {/* Crop positions */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="sk" style={{ width: 100, height: 10, marginBottom: 10 }} />
            <div className="sk" style={{ width: '100%', height: 28, borderRadius: 6 }} />
          </div>

          {/* Segments */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="sk" style={{ width: 70, height: 10, marginBottom: 10 }} />
            {[1].map(i => (
              <div key={i} className="sk" style={{ width: '100%', height: 32, borderRadius: 6, marginBottom: 6 }} />
            ))}
            <div className="sk" style={{ width: '100%', height: 28, borderRadius: 6, opacity: 0.5 }} />
          </div>

          {/* Auto-captions */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div className="sk" style={{ width: 90, height: 10 }} />
              <div className="sk" style={{ width: 40, height: 20, borderRadius: 10 }} />
            </div>
          </div>

          {/* Filters */}
          <div style={{ padding: '10px 14px' }}>
            <div className="sk" style={{ width: 50, height: 10, marginBottom: 10 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="sk" style={{ width: 60, height: 10, flexShrink: 0 }} />
                  <div className="sk" style={{ flex: 1, height: 4, borderRadius: 2 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
