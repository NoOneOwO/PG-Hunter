/**
 * PG Hunter — pixel engine.
 *
 * One canvas renderer shared by every pixel scene on the site. Scenes are
 * plain functions that paint into a `Painter`; this module owns everything
 * that is not scene logic:
 *
 *  - the low-resolution back buffer, sized from the element's measured box so
 *    pixels stay square at every breakpoint (a fixed grid stretched to 1440px
 *    renders tall thin rectangles, not pixels),
 *  - compositing (one `putImageData` per frame, never thousands of fillRect),
 *  - the render budget (capped well under 60fps, because pixel art reads
 *    better stepped anyway),
 *  - stopping the loop when the scene scrolls out of view or the tab is
 *    hidden, and drawing a single static frame under
 *    `prefers-reduced-motion: reduce`.
 *
 * Scenes must be deterministic functions of `time`: frame N always paints the
 * same picture for the same `t`. That is what makes the reduced-motion
 * fallback, and re-draws after a resize, correct for free.
 */

export type Rgb = readonly [number, number, number];

/** Brand palette, matching --color-pixel-* / brand-* in global.css. */
export const PALETTE = {
  night: [26, 11, 61],
  ink: [44, 18, 93],
  brand950: [30, 12, 65],
  brand800: [86, 39, 165],
  brand600: [122, 66, 230],
  brand400: [168, 141, 246],
  brand200: [216, 205, 252],
  lit: [253, 224, 71],
  amber: [250, 204, 21],
  ember: [244, 114, 82],
  rose: [225, 80, 120],
  jade: [52, 211, 153],
  sky: [56, 189, 248],
  slate900: [15, 23, 42],
  slate700: [51, 65, 85],
  slate500: [100, 116, 139],
  slate300: [203, 213, 225],
  slate200: [226, 232, 240],
  slate100: [241, 245, 249],
  white: [255, 255, 255],
} as const satisfies Record<string, Rgb>;

/** Ordered-dither matrix; the texture that makes a ramp read as pixel art. */
export const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

/** Deterministic hash noise — the same x/y always yields the same value. */
export function noise(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Sample a gradient ramp at `t` (0..1) with linear interpolation. */
export function rampAt(
  stops: readonly Rgb[],
  t: number
): [number, number, number] {
  const clamped = Math.min(0.9999, Math.max(0, t));
  const scaled = clamped * (stops.length - 1);
  const index = Math.floor(scaled);
  const local = scaled - index;
  const a = stops[index];
  const b = stops[index + 1];
  return [lerp(a[0], b[0], local), lerp(a[1], b[1], local), lerp(a[2], b[2], local)];
}

/** Blend two colours; `amount` 0 returns `a`, 1 returns `b`. */
export function mix(a: Rgb, b: Rgb, amount: number): [number, number, number] {
  return [lerp(a[0], b[0], amount), lerp(a[1], b[1], amount), lerp(a[2], b[2], amount)];
}

/** What a scene is handed each frame. All coordinates are in pixels. */
export interface Painter {
  cols: number;
  rows: number;
  /** Milliseconds since mount. Scenes must be pure functions of this. */
  time: number;
  put(x: number, y: number, rgb: Rgb | readonly number[]): void;
  /** Inclusive fill; clipped to the buffer. */
  fill(x: number, y: number, w: number, h: number, rgb: Rgb | readonly number[]): void;
  /** Horizontal line. */
  hline(x: number, y: number, len: number, rgb: Rgb | readonly number[]): void;
  /** Vertical line. */
  vline(x: number, y: number, len: number, rgb: Rgb | readonly number[]): void;
  noise(x: number, y: number): number;
  /** Blend `rgb` over whatever is already at (x,y). `amount` 0..1. */
  blend(x: number, y: number, rgb: Rgb, amount: number): void;
}

export type Scene = (p: Painter) => void;

/** Human-readable label, exposed for the canvas aria-label. */
export type SceneLabel = string;

interface Mounted {
  scene: Scene;
  label: SceneLabel;
  /** Extra pixel budget hint; heavy scenes render at a lower fps. */
  fps?: number;
}

const SCENES: Record<string, Mounted> = {};

/** Register a scene so `<canvas data-pixel-scene="name">` can find it. */
export function defineScene(
  name: string,
  scene: Scene,
  label: SceneLabel,
  fps = 20
): void {
  SCENES[name] = { scene, label, fps };
}

/** Frame drawn under prefers-reduced-motion: a scene representative moment. */
const STATIC_TIME = 9000;

export interface MountOptions {
  /** CSS pixel size of one art pixel. Larger = chunkier art. */
  targetPixels?: number;
  /** Cap the back buffer width so very wide screens stay cheap. */
  maxCols?: number;
}

export function mountScene(
  canvas: HTMLCanvasElement,
  sceneName: string,
  options: MountOptions = {}
): (() => void) | null {
  const mounted = SCENES[sceneName];
  if (!mounted) return null;

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return null;

  const { targetPixels = 10, maxCols = 200 } = options;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let cols = 0;
  let rows = 0;
  let image: ImageData | null = null;

  const painter: Painter = {
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },
    time: 0,
    noise,
    put(x, y, rgb) {
      if (!image) return;
      const px = Math.round(x);
      const py = Math.round(y);
      if (px < 0 || px >= cols || py < 0 || py >= rows) return;
      const i = (py * cols + px) * 4;
      image.data[i] = rgb[0];
      image.data[i + 1] = rgb[1];
      image.data[i + 2] = rgb[2];
      image.data[i + 3] = 255;
    },
    fill(x, y, w, h, rgb) {
      for (let dy = 0; dy < h; dy += 1) {
        for (let dx = 0; dx < w; dx += 1) this.put(x + dx, y + dy, rgb);
      }
    },
    hline(x, y, len, rgb) {
      for (let dx = 0; dx < len; dx += 1) this.put(x + dx, y, rgb);
    },
    vline(x, y, len, rgb) {
      for (let dy = 0; dy < len; dy += 1) this.put(x, y + dy, rgb);
    },
    blend(x, y, rgb, amount) {
      if (!image) return;
      const px = Math.round(x);
      const py = Math.round(y);
      if (px < 0 || px >= cols || py < 0 || py >= rows) return;
      const i = (py * cols + px) * 4;
      const data = image.data;
      const a = Math.min(1, Math.max(0, amount));
      data[i] = lerp(data[i], rgb[0], a);
      data[i + 1] = lerp(data[i + 1], rgb[1], a);
      data[i + 2] = lerp(data[i + 2], rgb[2], a);
      // Preserve existing coverage: an empty pixel becomes opaque, a painted
      // one keeps its alpha so overlapping passes do not punch holes.
      data[i + 3] = Math.max(data[i + 3], Math.round(255 * a));
    },
  };

  const draw = (time: number) => {
    if (!image || cols === 0 || rows === 0) return;
    painter.time = time;
    // Clear to fully transparent so scenes can leave parts of the buffer empty
    // (the hero scene draws a scene that fades into the page background).
    image.data.fill(0);
    mounted.scene(painter);
    ctx.putImageData(image, 0, 0);
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const pixel = Math.max(5, Math.min(14, Math.round(rect.width / targetPixels)));
    const nextCols = Math.max(32, Math.min(maxCols, Math.round(rect.width / pixel)));
    const nextRows = Math.max(12, Math.round(rect.height / pixel));
    if (nextCols === cols && nextRows === rows) return;
    cols = nextCols;
    rows = nextRows;
    canvas.width = cols;
    canvas.height = rows;
    image = ctx.createImageData(cols, rows);
  };

  // Size from the measured box. A ResizeObserver (rather than only a window
  // resize listener) means a canvas that mounts before layout — or inside a
  // container that settles late — recovers on its own instead of staying blank.
  const onResize = () => {
    const before = cols;
    resize();
    if (cols && cols !== before) draw(performance.now());
  };
  const sizeObserver = new ResizeObserver(onResize);
  sizeObserver.observe(canvas);
  window.addEventListener("resize", onResize, { passive: true });
  resize();

  const stop = () => {
    sizeObserver.disconnect();
    window.removeEventListener("resize", onResize);
  };

  // Still unmeasurable: the ResizeObserver will start it once there is a box.
  if (!cols) return stop;

  // A decorative canvas is already `aria-hidden` at the call site; only label
  // one that assistive tech can actually reach.
  if (canvas.getAttribute("aria-hidden") !== "true") {
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", mounted.label);
  }

  if (reduced) {
    draw(STATIC_TIME);
    return stop;
  }

  let last = 0;
  let visible = true;
  let raf = 0;
  const minFrame = 1000 / (mounted.fps ?? 20);

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    if (now - last < minFrame) return;
    last = now;
    draw(now);
  };
  raf = requestAnimationFrame(loop);

  // Only animate what the reader can actually see.
  const viewObserver = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
    },
    { threshold: 0 }
  );
  viewObserver.observe(canvas);

  // Pause while the tab is hidden so a backgrounded site costs nothing.
  const onVisibility = () => {
    if (!document.hidden) last = 0;
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    cancelAnimationFrame(raf);
    viewObserver.disconnect();
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Boot every scene canvas inside `root`. Returns the teardown for all of them. */
export function mountScenesIn(root: ParentNode = document): () => void {
  const canvases = Array.from(
    root.querySelectorAll<HTMLCanvasElement>("canvas[data-pixel-scene]")
  );
  const teardowns = canvases
    .map((canvas) => {
      const name = canvas.dataset.pixelScene ?? "";
      const pixel = Number(canvas.dataset.pixelSize ?? "") || undefined;
      const maxCols = Number(canvas.dataset.pixelMaxCols ?? "") || undefined;
      const teardown = mountScene(canvas, name, { targetPixels: pixel, maxCols });
      return teardown;
    })
    .filter((fn): fn is () => void => fn !== null);
  return () => teardowns.forEach((fn) => fn());
}