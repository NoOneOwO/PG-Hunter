import * as React from "react";
import { cn } from "cn";

/**
 * PixelBanner — the strip at the top of the profile.
 *
 * The scene is drawn into a small canvas that the browser scales up with
 * `image-rendering: pixelated`. The buffer size is derived from the banner's
 * measured size so the pixels stay square at every breakpoint (a fixed grid
 * stretched to a 1440px strip would render tall, thin rectangles instead of
 * pixels), and the whole scene is expressed as a proportion of the grid height
 * so a 375px phone and a 1440px desktop get the same composition.
 *
 * Frames are composited into a single ImageData (one putImageData per frame)
 * rather than thousands of fillRect calls, and the loop is capped well below
 * 60fps because pixel art reads better stepped anyway. Motion stops entirely
 * for `prefers-reduced-motion`, and the loop parks itself whenever the banner
 * scrolls out of view or the tab is hidden.
 */

/** Ordered-dither matrix; the texture that makes the sky read as pixel art. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

const SKY_STOPS: Array<[number, number, number]> = [
  [26, 11, 61], // deep night
  [44, 18, 93], // brand-950
  [86, 39, 165], // brand-800
  [122, 66, 230], // brand-600
  [168, 141, 246], // brand-400
];

const SUN = [253, 224, 71] as const; // accent-300
const HALO = [250, 204, 21] as const; // accent-400
const FAR_BUILDING = [49, 22, 106] as const;
const NEAR_BUILDING = [20, 9, 49] as const;
const WINDOW = [253, 224, 71] as const;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const skyAt = (t: number): [number, number, number] => {
  const clamped = Math.min(0.9999, Math.max(0, t));
  const scaled = clamped * (SKY_STOPS.length - 1);
  const index = Math.floor(scaled);
  const local = scaled - index;
  const a = SKY_STOPS[index];
  const b = SKY_STOPS[index + 1];
  return [lerp(a[0], b[0], local), lerp(a[1], b[1], local), lerp(a[2], b[2], local)];
};

/** Deterministic noise so the skyline never reshuffles between frames. */
const noise = (x: number, y: number): number => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

interface Building {
  x: number;
  w: number;
  h: number;
  windows: Array<[number, number]>;
  antenna: boolean;
}

interface Layer {
  buildings: Building[];
  width: number;
  color: readonly [number, number, number];
  speed: number;
}

/**
 * Build one parallax layer in grid units. Widths/heights are integers derived
 * from the row count, so the silhouette reads the same at every resolution.
 */
const buildLayer = (
  seed: number,
  cols: number,
  rows: number,
  minH: number,
  maxH: number
): Layer => {
  const buildings: Building[] = [];
  let x = -6;
  let width = 0;
  let index = 0;
  while (x < cols + 40) {
    const w = 2 + Math.floor(noise(index, seed) * Math.max(2, Math.round(cols / 26)));
    const h = minH + Math.floor(noise(index, seed + 91) * Math.max(1, maxH - minH));
    const windows: Array<[number, number]> = [];
    for (let wy = 1; wy < h - 1; wy += 2) {
      for (let wx = 1; wx < w - 1; wx += 2) {
        if (noise(index * 31 + wx, seed + wy * 17) > 0.5) windows.push([wx, wy]);
      }
    }
    buildings.push({
      x,
      w,
      h,
      windows,
      antenna: h > maxH * 0.72 && noise(index, seed + 3) > 0.45,
    });
    x += w + 1 + Math.floor(noise(index, seed + 7) * 3);
    width = x;
    index += 1;
  }
  return { buildings, width, color: FAR_BUILDING, speed: 1 };
};

export interface PixelBannerProps {
  className?: string;
}

export function PixelBanner({ className }: PixelBannerProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Live scene state, rebuilt whenever the measured grid changes.
    let cols = 0;
    let rows = 0;
    let image: ImageData | null = null;
    let far: Layer | null = null;
    let near: Layer | null = null;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      // Chunkier pixels on narrow screens, finer on wide ones; ~170 columns
      // keeps the per-frame fill cost flat regardless of viewport.
      const pixel = Math.max(6, Math.min(12, Math.round(rect.width / 170)));
      const nextCols = Math.max(48, Math.round(rect.width / pixel));
      const nextRows = Math.max(16, Math.round(rect.height / pixel));
      if (nextCols === cols && nextRows === rows) return;

      cols = nextCols;
      rows = nextRows;
      canvas.width = cols;
      canvas.height = rows;
      image = ctx.createImageData(cols, rows);
      far = buildLayer(3, cols, rows, Math.round(rows * 0.18), Math.round(rows * 0.4));
      far.color = FAR_BUILDING;
      far.speed = 0.5;
      near = buildLayer(11, cols, rows, Math.round(rows * 0.3), Math.round(rows * 0.56));
      near.color = NEAR_BUILDING;
      near.speed = 1.3;
    };

    const draw = (time: number) => {
      if (!image || !far || !near || rows === 0) return;
      const pixels = image.data;
      pixels.fill(0);

      const put = (x: number, y: number, rgb: readonly number[] | number[]) => {
        const px = Math.round(x);
        const py = Math.round(y);
        if (px < 0 || px >= cols || py < 0 || py >= rows) return;
        const i = (py * cols + px) * 4;
        pixels[i] = rgb[0];
        pixels[i + 1] = rgb[1];
        pixels[i + 2] = rgb[2];
        pixels[i + 3] = 255;
      };

      const horizon = rows * 0.86;

      // --- sky: ordered-dithered vertical ramp -------------------------
      const levels = 5;
      for (let y = 0; y < horizon; y += 1) {
        const t = y / horizon;
        for (let x = 0; x < cols; x += 1) {
          const dithered = t * levels + (BAYER[y & 3][x & 3] - 0.5);
          const stepped = Math.min(levels, Math.max(0, Math.round(dithered)));
          put(x, y, skyAt(stepped / levels));
        }
      }

      // --- stars --------------------------------------------------------
      const starCount = Math.round(cols * 0.35);
      for (let i = 0; i < starCount; i += 1) {
        const sx = Math.floor(noise(i, 5) * cols);
        const sy = Math.floor(noise(i, 9) * horizon * 0.62);
        const phase = noise(i, 13) * Math.PI * 2;
        const twinkle = 0.4 + 0.6 * Math.sin(time * 0.0011 + phase);
        const b = 130 + 120 * twinkle;
        put(sx, sy, [b, b, Math.min(255, b + 25)]);
      }

      // --- rising sun, with retro slice lines --------------------------
      const sunX = cols * 0.68;
      const sunR = Math.max(3, rows * 0.17);
      const cycle = 30000;
      const phase = (time % cycle) / cycle;
      const sunY = rows * 1.0 - phase * (rows * 0.46);
      for (let y = Math.floor(sunY - sunR - 2); y <= sunY + sunR + 2; y += 1) {
        for (let x = Math.floor(sunX - sunR - 2); x <= sunX + sunR + 2; x += 1) {
          const dx = x - sunX;
          const dy = y - sunY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > sunR + 2) continue;
          const acrossDisc = (y - (sunY - sunR)) / (sunR * 2);
          // Bands get wider toward the bottom of the disc.
          const band = Math.floor((y - sunY + sunR) / (2 + acrossDisc * 3));
          if (band % 2 === 1 && acrossDisc > 0.15) continue;
          put(x, y, dist > sunR - 0.5 ? HALO : SUN);
        }
      }

      // --- parallax skyline ---------------------------------------------
      for (const layer of [far, near]) {
        const offset = (time * 0.004 * layer.speed) % layer.width;
        for (const building of layer.buildings) {
          for (let pass = 0; pass < 2; pass += 1) {
            const bx = building.x - offset + pass * layer.width;
            if (bx > cols || bx + building.w < 0) continue;
            for (let wy = 0; wy < building.h; wy += 1) {
              for (let wx = 0; wx < building.w; wx += 1) put(bx + wx, rows - wy, layer.color);
            }
            for (const [wx, wy] of building.windows) {
              const flicker = noise(wx * 7 + building.x, wy * 13) > 0.86;
              const alpha = flicker ? 0.5 + 0.5 * Math.sin(time * 0.002 + wx) : 1;
              put(bx + wx, rows - wy, [
                WINDOW[0] * alpha,
                WINDOW[1] * alpha,
                WINDOW[2] * alpha,
              ]);
            }
            if (building.antenna) {
              put(bx + (building.w >> 1), rows - building.h - 2, layer.color);
              put(bx + (building.w >> 1), rows - building.h - 3, layer.color);
            }
          }
        }
      }

      ctx.putImageData(image, 0, 0);
    };

    resize();

    if (reduced) {
      draw(9000);
    } else {
      let last = 0;
      let visible = true;
      let raf = 0;

      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (!visible || document.hidden) return;
        if (now - last < 1000 / 20) return;
        last = now;
        draw(now);
      };
      raf = requestAnimationFrame(loop);

      const observer = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting;
        },
        { threshold: 0 }
      );
      observer.observe(canvas);

      const onResize = () => {
        resize();
        draw(performance.now());
      };
      window.addEventListener("resize", onResize);

      return () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
        window.removeEventListener("resize", onResize);
      };
    }
  }, []);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Pixel art skyline at dusk"
      className={cn("block h-full w-full", className)}
      style={{ imageRendering: "pixelated" }}
    />
  );
}

export default PixelBanner;