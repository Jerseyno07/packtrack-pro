import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PAD = 10;

export default function TourOverlay({ steps, onDone }) {
  const [idx, setIdx] = useState(0);
  const [spot, setSpot] = useState(null);

  const step = steps[idx];
  const isLast = idx === steps.length - 1;

  useEffect(() => {
    step.onEnter?.();
    if (!step.target) { setSpot(null); return; }
    const t1 = setTimeout(() => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) { setSpot(null); return; }
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const t2 = setTimeout(() => {
        const r = el.getBoundingClientRect();
        setSpot({ top: r.top - PAD, left: r.left - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 });
      }, 300);
      return () => clearTimeout(t2);
    }, 120);
    return () => clearTimeout(t1);
  }, [idx]);

  const go = (dir) => setIdx((i) => Math.max(0, Math.min(steps.length - 1, i + dir)));
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const PW = 320;

  let pStyle = { position: 'fixed', width: PW, zIndex: 9999 };
  if (!spot) {
    pStyle = { ...pStyle, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' };
  } else {
    const below = spot.top + spot.h + 12;
    const above = spot.top - 12;
    if (below + 200 < vh) {
      pStyle = { ...pStyle, top: below, left: Math.min(Math.max(spot.left, 16), vw - PW - 16) };
    } else if (above > 200) {
      pStyle = { ...pStyle, top: above - 200, left: Math.min(Math.max(spot.left, 16), vw - PW - 16) };
    } else {
      pStyle = { ...pStyle, top: vh / 2 - 100, left: vw / 2 - PW / 2 };
    }
  }

  return (
    <div className="fixed inset-0" style={{ zIndex: 9998, pointerEvents: 'all' }}>
      {spot ? (
        <>
          <div className="fixed bg-black/50" style={{ top: 0, left: 0, right: 0, height: spot.top }} />
          <div className="fixed bg-black/50" style={{ top: spot.top + spot.h, left: 0, right: 0, bottom: 0 }} />
          <div className="fixed bg-black/50" style={{ top: spot.top, left: 0, width: spot.left, height: spot.h }} />
          <div className="fixed bg-black/50" style={{ top: spot.top, left: spot.left + spot.w, right: 0, height: spot.h }} />
          <div className="fixed rounded-lg" style={{ top: spot.top, left: spot.left, width: spot.w, height: spot.h, pointerEvents: 'none', boxShadow: '0 0 0 2px #60a5fa, 0 0 0 4px rgba(96,165,250,0.2)', zIndex: 9999 }} />
        </>
      ) : (
        <div className="fixed inset-0 bg-black/50" />
      )}

      <div className="fixed bg-white rounded-2xl shadow-2xl p-5 space-y-3" style={pStyle}>
        <div className="flex gap-1">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 rounded-full flex-1 transition-colors ${i === idx ? 'bg-blue-500' : i < idx ? 'bg-blue-200' : 'bg-slate-200'}`} />
          ))}
        </div>
        <div className="text-xs font-semibold text-blue-600 uppercase tracking-wide">{idx + 1} / {steps.length}</div>
        <div>
          <div className="font-bold text-slate-900 text-sm leading-snug">{step.title}</div>
          <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{step.body}</p>
        </div>
        <div className="flex items-center justify-between pt-1">
          <button onClick={onDone} className="text-xs text-slate-400 hover:text-slate-600 py-1">Skip tour</button>
          <div className="flex gap-2">
            {idx > 0 && (
              <button onClick={() => go(-1)} className="flex items-center gap-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">
                <ChevronLeft size={12} /> Prev
              </button>
            )}
            <button onClick={() => isLast ? onDone() : go(1)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
              {isLast ? 'Done' : <>Next <ChevronRight size={12} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
