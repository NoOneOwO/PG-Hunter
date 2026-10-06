/**
 * PG Hunter — iridescent gradient backdrop.
 *
 * A React Bits-style flowing gradient (Iridescence / Silk family) behind the
 * title band on a PG page, with one signature behaviour: it leans toward the
 * cursor. Hand-rolled on a 2D canvas rather than a WebGL shader for three
 * practical reasons:
 *
 *   1. Weight. No `ogl`/`three` in the bundle for what is decoration; this
 *      module is a few KB and ships as an external same-origin chunk.
 *   2. Compatibility. The live-listing route (/pgs/live/[id]) runs on demand and
 *      is served under the un-hashed CSP from middleware — that policy cannot
 *      allow a React island's inline runtime. A plain module script is `'self'`
 *      and therefore works on both the prerendered and the on-demand page.
 *   3. Control. At a low internal resolution with one CSS blur, the whole thing
 *      is cheaper than a single filtered DOM node, and it can be paused
 *      completely when it is off screen.
 *
 * Behaviour:
 *   - pointer devices: blob centres drift toward the cursor, plus a soft glow
 *     that tracks it exactly;
 *   - touch: no cursor exists, so the same blobs keep their slow auto-animation
 *     (a full-screen pointer listener is never attached);
 *   - `prefers-reduced-motion`: one static frame, no loop;
 *   - off screen or tab hidden: the loop stops.
 */

export interface GradientHandle {
  /** Stop the loop, detach every listener and release the canvas. */
  destroy: () => void;
}

interface Blob {
  /** Base position, in fractions of the canvas box. */
  x: number;
  y: number;
  /** Radius as a fraction of the larger canvas edge. */
  r: number;
  color: [number, number, number];
  alpha: number;
  /** How strongly this blob leans toward the pointer, 0..1. */
  pull: number;
  phase: number;
  speed: number;
}

/**
 * The palette is The Register at dusk: brand violet and its lighter neighbour
 * carry the scene, rose and the CTA amber supply the iridescence.
 *
 * The blend is `multiply`, so two overlapping stops mix like ink rather than
 * like light — a cool blue next to the amber would go green. Every pair here
 * lands somewhere warm instead. Alphas stay modest so text laid over the band
 * keeps its contrast.
 */
const BLOBS: Blob[] = [
  { x: 0.12, y: 0.3, r: 0.62, color: [143, 98, 241], alpha: 0.52, pull: 0.1, phase: 0.0, speed: 0.24 },
  { x: 0.42, y: 0.74, r: 0.7, color: [202, 184, 251], alpha: 0.5, pull: 0.14, phase: 1.7, speed: 0.19 },
  { x: 0.7, y: 0.22, r: 0.56, color: [244, 114, 182], alpha: 0.34, pull: 0.18, phase: 3.1, speed: 0.27 },
  { x: 0.92, y: 0.8, r: 0.6, color: [253, 224, 71], alpha: 0.34, pull: 0.22, phase: 4.4, speed: 0.22 },
  { x: 0.56, y: 0.46, r: 0.48, color: [105, 48, 203], alpha: 0.26, pull: 0.08, phase: 5.6, speed: 0.16 },
];

/** Internal resolution cap. The CSS blur hides the difference; the GPU, not we, pays. */
const MAX_EDGE = 520;
const MAX_DPR = 1;

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

const rgba = (c: [number, number, number], alpha: number): string =>
  `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${alpha.toFixed(3)})`;

export const mountGradient = (canvas: HTMLCanvasElement): GradientHandle => {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return { destroy: () => {} };

  const host = canvas.parentElement ?? canvas;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width = 0;
  let height = 0;
  let raf = 0;
  let running = true;
  let visible = true;
  let started = performance.now();

  /** Pointer target and eased position, both in 0..1 canvas space. */
  const target = { x: -1, y: -1 };
  const pointer = { x: -1, y: -1 };
  const hasPointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const resize = (): void => {
    const rect = host.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const scale = Math.min(1, MAX_EDGE / Math.max(rect.width, rect.height));
    width = Math.max(2, Math.round(rect.width * scale * dpr));
    height = Math.max(2, Math.round(rect.height * scale * dpr));
    canvas.width = width;
    canvas.height = height;
  };

  const paint = (t: number): void => {
    if (width < 2 || height < 2) return;

    // Ease the pointer so the gradient glides instead of snapping.
    if (pointer.x < 0 || target.x < 0) {
      pointer.x = target.x;
      pointer.y = target.y;
    } else {
      pointer.x = mix(pointer.x, target.x, 0.06);
      pointer.y = mix(pointer.y, target.y, 0.06);
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    /*
     * Multiply, not `lighter`.
     *
     * The base is white, so additive blending clamps every colour straight back
     * to white and the whole band renders blank — the trap this scene fell into
     * first. Multiply tints the white base downward, which is exactly what a
     * colour wash on paper does, and overlapping blobs deepen into a richer
     * blend instead of blowing out.
     */
    ctx.globalCompositeOperation = 'multiply';
    const reach = Math.max(width, height);

    for (const blob of BLOBS) {
      // Slow orbit, so the band is never completely still even without a cursor.
      const wobbleX = Math.sin(t * blob.speed + blob.phase) * 0.11;
      const wobbleY = Math.cos(t * blob.speed * 0.82 + blob.phase * 1.3) * 0.09;

      let x = (blob.x + wobbleX) * width;
      let y = (blob.y + wobbleY) * height;

      if (pointer.x >= 0) {
        // Lean toward the cursor: closer blobs follow it harder.
        x = mix(x, pointer.x * width, blob.pull);
        y = mix(y, pointer.y * height, blob.pull);
      }

      const radius = blob.r * reach;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, rgba(blob.color, blob.alpha));
      gradient.addColorStop(0.55, rgba(blob.color, blob.alpha * 0.42));
      gradient.addColorStop(1, rgba(blob.color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    // A precise highlight under the cursor — this is the part that feels alive.
    if (pointer.x >= 0) {
      const radius = reach * 0.34;
      const x = pointer.x * width;
      const y = pointer.y * height;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, 'rgba(253, 224, 71, 0.42)');
      glow.addColorStop(0.5, 'rgba(172, 143, 247, 0.28)');
      glow.addColorStop(1, 'rgba(172, 143, 247, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  };

  const frame = (): void => {
    raf = 0;
    if (!running || !visible) return;
    paint((performance.now() - started) / 1000);
    raf = requestAnimationFrame(frame);
  };

  const schedule = (): void => {
    if (raf || !running || !visible) return;
    raf = requestAnimationFrame(frame);
  };

  const stop = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  /* -------------------------------------------------- interaction -- */

  /**
   * Tracking lives on `document` rather than on the band itself.
   *
   * The band is `pointer-events: none` so it can never swallow a click, a
   * selection or a focus target that belongs to the real page. Listening one
   * level up keeps the interaction without taking anything away: a pointer near
   * the band drives it, and one that leaves releases it back to its own drift.
   */
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    const rect = host.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const near =
      event.clientX >= rect.left - 90 &&
      event.clientX <= rect.right + 90 &&
      event.clientY >= rect.top - 90 &&
      event.clientY <= rect.bottom + 90;
    if (!near) {
      target.x = -1;
      target.y = -1;
      return;
    }
    target.x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    target.y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  };

  /* ---------------------------------------------------- lifecycle -- */

  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        if (reduced) paint(0);
        else {
          started = performance.now();
          schedule();
        }
      } else {
        stop();
      }
    },
    { threshold: 0 }
  );

  const onVisibility = (): void => {
    running = !document.hidden;
    if (running && visible && !reduced) {
      started = performance.now();
      schedule();
    } else {
      stop();
    }
  };

  resize();
  if (reduced) {
    paint(0);
  } else {
    if (hasPointer) document.addEventListener('pointermove', onPointerMove, { passive: true });
    observer.observe(host);
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
  }

  const onResize = (): void => {
    resize();
    if (reduced) paint(0);
  };
  window.addEventListener('resize', onResize, { passive: true });

  return {
    destroy: () => {
      stop();
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointermove', onPointerMove);
    },
  };
};

/**
 * Mount every `[data-gradient]` canvas inside `root`. Each canvas is remembered
 * on the element, so re-running (e.g. after a view transition) never stacks two
 * render loops on one canvas.
 */
type MountedCanvas = HTMLCanvasElement & { __gb?: GradientHandle };

export const mountGradientsIn = (root: ParentNode = document): (() => void) => {
  const mounted: MountedCanvas[] = [];
  for (const canvas of root.querySelectorAll<MountedCanvas>('canvas[data-gradient]')) {
    if (canvas.__gb) continue;
    canvas.__gb = mountGradient(canvas);
    mounted.push(canvas);
  }
  return () => {
    for (const canvas of mounted) {
      canvas.__gb?.destroy();
      delete canvas.__gb;
    }
  };
};
