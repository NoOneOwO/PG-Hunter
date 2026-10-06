/**
 * HeroScene — the landing page's living PG skyline.
 *
 * A React Bits-style set piece: a stylised dusk city of PG buildings whose
 * windows come on in a wave, drifting clouds and birds, and a three-plane
 * parallax that follows the cursor (and the scroll on the way down).
 *
 * Composition rules, chosen against the real hero layout:
 *   - The hero is much wider than it is tall, and the left third carries the
 *     headline while the right side holds the search panel. So the artwork is
 *     anchored to the BOTTOM (`xMidYMax`) and all the detail that must survive
 *     the crop — lamps, the parked scooter, the students walking home, the PG
 *     sign on the near facade — lives in the bottom third.
 *   - The sun sits just left of centre, behind the headline block, where its
 *     glow reads as warmth in the type rather than as a second focal point.
 *
 * Performance contract, deliberately:
 *   - It is an SVG, so the server ships the finished artwork. No layout shift,
 *     no empty box before hydration; the island only adds motion.
 *   - Windows animate with CSS only — no per-frame JavaScript touches them.
 *   - Cursor tracking writes two CSS custom properties on one element, one rAF
 *     per frame; layers move with `transform` on the GPU.
 *   - Touch / small / low-core devices get `lite` mode: the gentle CSS motion
 *     stays, cursor parallax and the busiest layers are dropped.
 *   - `prefers-reduced-motion` renders the scene completely still.
 *   - Off-screen and on a hidden tab, everything pauses.
 *
 * Every generated value comes from a pure hash of its index, never
 * Math.random(), so the server and client render the identical scene.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from 'motion/react';

/* ------------------------------------------------------------------ */
/* deterministic layout helpers                                        */
/* ------------------------------------------------------------------ */

/** Stable pseudo-random in [0,1) from two integers — same on both sides. */
const rand = (a: number, b = 0): number => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

interface Building {
  x: number;
  w: number;
  h: number;
  seed: number;
}

const skyline = (
  count: number,
  seed: number,
  opts: { minH: number; maxH: number; minW: number; maxW: number; gap: number }
): Building[] => {
  const out: Building[] = [];
  let x = -40;
  for (let i = 0; i < count; i += 1) {
    const w = Math.round(opts.minW + rand(i + seed, 1) * (opts.maxW - opts.minW));
    const h = Math.round(opts.minH + rand(i + seed, 2) * (opts.maxH - opts.minH));
    out.push({ x, w, h, seed: i + seed });
    x += w + Math.round(opts.gap * (0.4 + rand(i + seed, 3)));
  }
  return out;
};

const FAR = skyline(30, 5, { minH: 80, maxH: 200, minW: 48, maxW: 120, gap: 5 });
const MID = skyline(17, 41, { minH: 160, maxH: 300, minW: 96, maxW: 190, gap: 12 });

/** Rooftop furniture so the skyline reads as buildings, not bars. */
const roofProps = (b: Building): 'tank' | 'antenna' | 'ac' | 'none' => {
  const roll = rand(b.seed, 9);
  if (roll < 0.3) return 'tank';
  if (roll < 0.52) return 'antenna';
  if (roll < 0.78) return 'ac';
  return 'none';
};

/** Window tints, so a whole skyline does not switch on in one flat colour. */
const WINDOW_TINTS = ['#fde047', '#fde047', '#fde047', '#fef3c7', '#bae6fd'] as const;

interface WindowSpec {
  x: number;
  y: number;
  lit: boolean;
  delay: number;
  tint: string;
}

/** Windows for one building: a grid, most of them lit after dusk. */
const windowsFor = (b: Building): WindowSpec[] => {
  const out: WindowSpec[] = [];
  const cols = Math.max(1, Math.floor((b.w - 22) / 26));
  const rows = Math.max(1, Math.floor((b.h - 44) / 32));
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const roll = rand(b.seed * 13 + c, r * 29 + 3);
      const tint = WINDOW_TINTS[Math.floor(rand(b.seed + c * 7, r + 11) * WINDOW_TINTS.length)] ?? WINDOW_TINTS[0];
      out.push({
        x: 14 + c * 26,
        y: 26 + r * 32,
        lit: roll > 0.32,
        // A gentle left-to-right wave as the lights come on.
        delay: b.x * 0.0016 + roll * 1.1,
        tint,
      });
    }
  }
  return out;
};

/** Total window nodes stay modest so the SVG stays cheap to rasterise. */
const MID_WINDOWS = MID.map((b) => ({ b, windows: windowsFor(b) }));

/** Student idle between the walking pairs — a silhouette, 22px tall. */
const Student = ({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <circle cx="10" cy="16" r="10" />
    <rect x="2" y="28" width="16" height="26" rx="6" />
    <rect x="3" y="54" width="6" height="22" rx="3" />
    <rect x="12" y="54" width="6" height="22" rx="3" />
    <rect x="18" y="30" width="10" height="14" rx="4" />
  </g>
);

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

type Mode = 'static' | 'lite' | 'full';

const detectMode = (): Mode => {
  if (typeof window === 'undefined') return 'static';
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = window.matchMedia('(max-width: 767px)').matches;
  return coarse || small || cores <= 4 ? 'lite' : 'full';
};

export default function HeroScene({ className = '' }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<Mode>('static');

  useEffect(() => {
    // The media query is checked directly as well, because `useReducedMotion`
    // reports false on its very first pass — checking it here means a
    // reduced-motion visitor never sees a single frame of movement.
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setMode(prefersReduced || reduced ? 'static' : detectMode());
  }, [reduced]);

  /**
   * One rAF-throttled pass that turns pointer position + scroll into the two
   * custom properties the CSS parallax reads. Nothing else listens.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root || mode === 'static') return;

    let frame = 0;
    let px = 0;
    let py = 0;

    const apply = () => {
      frame = 0;
      root.style.setProperty('--hs-x', px.toFixed(3));
      root.style.setProperty('--hs-y', py.toFixed(3));
      const rect = root.getBoundingClientRect();
      const travelled = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height)));
      root.style.setProperty('--hs-scroll', travelled.toFixed(3));
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const rect = root.getBoundingClientRect();
      px = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
      py = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
      schedule();
    };

    if (mode === 'full') window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });

    // Stop painting when the hero scrolls away or the tab is hidden.
    const observer = new IntersectionObserver(
      ([entry]) => root.classList.toggle('hs-paused', !entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(root);

    const onVisibility = () => root.classList.toggle('hs-paused', document.hidden);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('scroll', schedule);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mode]);

  const rootClass = [
    'hs-root',
    className,
    mode === 'full' ? 'hs-animate hs-parallax' : '',
    mode === 'lite' ? 'hs-animate hs-lite' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={rootRef} className={rootClass} aria-hidden="true">
      <svg
        className="hs-svg"
        viewBox="0 0 1440 620"
        // Bottom-anchored: a short hero crops the empty sky, never the street.
        preserveAspectRatio="xMidYMax slice"
        role="presentation"
        focusable="false"
      >
        <defs>
          <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e2d5fc" />
            <stop offset="38%" stopColor="#d9c9fb" />
            <stop offset="72%" stopColor="#f0d5e2" />
            <stop offset="100%" stopColor="#f8c98a" />
          </linearGradient>
          <radialGradient id="hs-sun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fde047" stopOpacity="0.85" />
            <stop offset="42%" stopColor="#fbbf24" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hs-horizon" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fde047" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#fde047" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hs-mid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9d74f4" />
            <stop offset="50%" stopColor="#7a42e6" />
            <stop offset="100%" stopColor="#5729a7" />
          </linearGradient>
          <linearGradient id="hs-far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#cbb9f9" />
            <stop offset="100%" stopColor="#b39bf7" />
          </linearGradient>
          <linearGradient id="hs-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4b2596" />
            <stop offset="45%" stopColor="#341b6b" />
            <stop offset="100%" stopColor="#251051" />
          </linearGradient>
          <linearGradient id="hs-near" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3d1d7d" />
            <stop offset="100%" stopColor="#251051" />
          </linearGradient>
          <radialGradient id="hs-lamp" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fde047" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#fde047" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ---------------------------------------------------- sky -- */}
        <rect width="1440" height="620" fill="url(#hs-sky)" />

        {/* the sun, left of centre: warmth behind the headline, not a rival */}
        <circle cx="470" cy="352" r="230" fill="url(#hs-sun)" />
        <circle cx="470" cy="352" r="62" fill="#fcd34d" opacity="0.95" />
        <circle cx="470" cy="352" r="62" fill="none" stroke="#fbbf24" strokeWidth="3" opacity="0.55" />

        <g className="hs-heavy" opacity="0.75">
          {Array.from({ length: 26 }, (_, i) => (
            <circle
              key={`star-${i}`}
              cx={Math.round(rand(i, 17) * 1440)}
              cy={Math.round(220 + rand(i, 23) * 250)}
              r={rand(i, 5) > 0.7 ? 2 : 1.3}
              fill="#ffffff"
              opacity={0.3 + rand(i, 31) * 0.5}
            />
          ))}
        </g>

        {/* ------------------------------------------------- clouds -- */}
        <g fill="#ffffff" opacity="0.7">
          <g className="hs-cloud" style={{ animationDelay: '-8s' }}>
            <ellipse cx="286" cy="252" rx="92" ry="26" />
            <ellipse cx="344" cy="236" rx="62" ry="22" />
            <ellipse cx="228" cy="242" rx="46" ry="17" />
          </g>
          <g className="hs-cloud" style={{ animationDelay: '-38s' }}>
            <ellipse cx="1024" cy="214" rx="76" ry="21" />
            <ellipse cx="1068" cy="200" rx="48" ry="16" />
          </g>
        </g>

        {/* -------------------------------------------------- birds -- */}
        <g className="hs-heavy" stroke="#5b2ba8" strokeWidth="2.6" fill="none" strokeLinecap="round">
          <g className="hs-bird" style={{ animationDelay: '-4s' }}>
            <path d="M0 0q7-7 14 0q7-7 14 0" />
          </g>
          <g className="hs-bird" style={{ animationDelay: '-14s', animationDuration: '36s' }}>
            <path d="M0 0q6-6 12 0q6-6 12 0" transform="translate(0 34)" />
          </g>
          <g className="hs-bird" style={{ animationDelay: '-24s', animationDuration: '44s' }}>
            <path d="M0 0q5-5 10 0q5-5 10 0" transform="translate(0 62)" />
          </g>
        </g>

        {/* --------------------------------------------- far skyline -- */}
        <g className="hs-layer hs-layer--far">
          {FAR.map((b, i) => (
            <rect key={`far-${i}`} x={b.x} y={478 - b.h} width={b.w} height={b.h + 60} rx="3" fill="url(#hs-far)" opacity="0.9" />
          ))}
        </g>

        {/* --------------------------------------------- mid skyline -- */}
        <g className="hs-layer hs-layer--mid">
          {MID_WINDOWS.map(({ b, windows }, index) => (
            <g key={`mid-${index}`}>
              <rect x={b.x} y={508 - b.h} width={b.w} height={b.h + 60} rx="4" fill="url(#hs-mid)" />
              <rect
                x={b.x}
                y={508 - b.h}
                width={b.w}
                height={b.h + 60}
                rx="4"
                fill="none"
                stroke="#5729a7"
                strokeWidth="2"
                opacity="0.45"
              />
              {/* parapet */}
              <rect x={b.x - 5} y={508 - b.h - 9} width={b.w + 10} height="9" rx="3" fill="#5729a7" />

              {/* rooftop furniture */}
              {roofProps(b) === 'tank' && (
                <g>
                  <rect x={b.x + b.w * 0.55} y={508 - b.h - 36} width="27" height="27" rx="3" fill="#482388" />
                  <rect x={b.x + b.w * 0.55 + 4} y={508 - b.h - 9} width="4" height="9" fill="#3d1d7d" />
                  <rect x={b.x + b.w * 0.55 + 19} y={508 - b.h - 9} width="4" height="9" fill="#3d1d7d" />
                </g>
              )}
              {roofProps(b) === 'antenna' && (
                <g stroke="#482388" strokeWidth="3">
                  <line x1={b.x + b.w * 0.3} y1={508 - b.h - 9} x2={b.x + b.w * 0.3} y2={508 - b.h - 54} />
                  <line x1={b.x + b.w * 0.3 - 13} y1={508 - b.h - 40} x2={b.x + b.w * 0.3 + 13} y2={508 - b.h - 40} />
                </g>
              )}
              {roofProps(b) === 'ac' && (
                <rect x={b.x + b.w * 0.62} y={508 - b.h - 21} width="31" height="15" rx="2" fill="#482388" />
              )}

              {/* windows: the wave of lights that makes the scene come alive */}
              {windows.map((w, wi) => (
                <rect
                  key={`w-${index}-${wi}`}
                  className={w.lit ? 'hs-win' : 'hs-win hs-win--dark'}
                  x={b.x + w.x}
                  y={508 - b.h + w.y}
                  width="13"
                  height="17"
                  rx="1.5"
                  fill={w.lit ? w.tint : '#4b2596'}
                  style={{ '--hs-delay': `${w.delay.toFixed(2)}s` } as CSSProperties}
                />
              ))}
            </g>
          ))}
        </g>

        {/* ------------------------------------------------ horizon -- */}
        <rect x="0" y="462" width="1440" height="56" fill="url(#hs-horizon)" />
        <rect x="0" y="508" width="1440" height="6" fill="#fde047" opacity="0.5" />

        {/* ------------------------------------------------- ground -- */}
        <rect x="0" y="512" width="1440" height="108" fill="url(#hs-ground)" />
        <rect x="0" y="512" width="1440" height="3" fill="#a888f6" opacity="0.55" />
        {/* warm spill from the street lamps along the kerb */}
        <rect x="0" y="515" width="1440" height="26" fill="url(#hs-horizon)" opacity="0.7" />

        {/* ------------------------------------------------ near layer */}
        <g className="hs-layer hs-layer--near">
          {/* pavement */}
          <rect x="0" y="556" width="1440" height="8" fill="#8f62f1" opacity="0.32" />

          {/* street lamps */}
          {[236, 726, 1136].map((x, i) => (
            <g key={`lamp-${i}`}>
              <rect x={x} y={340} width="5" height="220" fill="#3d1d7d" />
              <rect x={x - 17} y="336" width="39" height="6" rx="3" fill="#3d1d7d" />
              <circle className="hs-glow" cx={x + 2} cy="334" r="9" fill="#fde047" />
              <circle cx={x + 2} cy="338" r="66" fill="url(#hs-lamp)" />
            </g>
          ))}

          {/* parked scooter */}
          <g fill="#251051">
            <circle cx="352" cy="586" r="17" />
            <circle cx="422" cy="586" r="17" />
            <path d="M352 586l30-42h30l24 42h-28l-12-22-16 22z" />
            <rect x="386" y="538" width="30" height="8" rx="4" />
          </g>

          {/* bicycle leaning by the kerb */}
          <g className="hs-heavy" fill="none" stroke="#251051" strokeWidth="4">
            <circle cx="960" cy="578" r="22" />
            <circle cx="1024" cy="578" r="22" />
            <path d="M960 578l28-34h20l-8 34M988 544h-16M1012 550l12 28" />
            <circle cx="1002" cy="534" r="10" fill="#251051" stroke="none" />
          </g>

          {/* students heading home */}
          <g className="hs-heavy" fill="#251051">
            <Student x={560} y={498} />
            <Student x={884} y={504} scale={0.92} />
          </g>

          {/* foreground facade on the right edge, with its lit sign — depth */}
          <g>
            <rect x="1250" y="300" width="190" height="320" fill="url(#hs-near)" />
            <rect x="1246" y="300" width="8" height="320" fill="#251051" />
            <rect x="1300" y="352" width="96" height="34" rx="3" fill="#facc15" />
            <text x="1348" y="377" textAnchor="middle" fill="#251051" fontSize="20" fontWeight="800" letterSpacing="1">
              PG
            </text>
            {[0, 1, 2, 3].map((i) => (
              <rect
                key={`facade-${i}`}
                className="hs-win"
                x={1296 + (i % 2) * 66}
                y={412 + Math.floor(i / 2) * 96}
                width="42"
                height="54"
                rx="2"
                fill={i % 3 === 0 ? '#fde047' : i % 3 === 1 ? '#bae6fd' : '#fef3c7'}
                style={{ '--hs-delay': `${(0.3 + i * 0.25).toFixed(2)}s` } as CSSProperties}
              />
            ))}
          </g>
        </g>
      </svg>

      {/*
        A warm light that follows the cursor across the artwork. It is pure CSS
        driven by the same two custom properties the parallax reads, so it costs
        nothing but one extra painted layer — and it only exists in full mode,
        where a cursor exists at all.
      */}
      <span className="hs-spot" />
    </div>
  );
}
