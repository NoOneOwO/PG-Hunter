/**
 * PG Hunter — pixel scenes.
 *
 * Each scene is a pure function of time (see `core.ts`), so any frame can be
 * reproduced exactly: that is what makes the reduced-motion fallback and the
 * resize redraw correct.
 *
 * The scenes share a language — dithered sky ramps, stepped silhouettes, one
 * warm accent, a hard 2-3 value palette — but each has its own subject and its
 * own motion, so the site never repeats the skyline:
 *
 *   skyline  dusk city, parallax towers, a rising sliced sun   (profile)
 *   street   dawn Delhi, an auto-rickshaw crossing the road    (landing)
 *   campus   college gate at sunrise, flag flapping            (colleges)
 *   map      locality street grid, pins drop and pulse         (localities)
 *   room     a PG room: window light, ceiling fan, bunk bed    (PG pages)
 */

import {
  BAYER,
  PALETTE,
  defineScene,
  mix,
  noise,
  rampAt,
  type Painter,
  type Rgb,
} from "./core";

/* ------------------------------------------------------------------ *
 * shared helpers
 * ------------------------------------------------------------------ */

/**
 * Paint a vertically dithered gradient from the top of the buffer down to
 * `horizon`. This is the single most recognisable "pixel art" cue, and the
 * reason these scenes don't look like flat vector shapes.
 */
function ditheredSky(
  p: Painter,
  stops: readonly Rgb[],
  horizon: number,
  levels = 5
): void {
  const bottom = Math.min(p.rows, Math.ceil(horizon));
  for (let y = 0; y < bottom; y += 1) {
    const t = y / Math.max(1, horizon);
    for (let x = 0; x < p.cols; x += 1) {
      const dithered = t * levels + (BAYER[y & 3][x & 3] - 0.5);
      const stepped = Math.min(levels, Math.max(0, Math.round(dithered)));
      p.put(x, y, rampAt(stops, stepped / levels));
    }
  }
}

/** A retro sun disc with horizontal slice gaps that widen toward the bottom. */
function slicedSun(
  p: Painter,
  cx: number,
  cy: number,
  radius: number,
  core: Rgb = PALETTE.lit,
  halo: Rgb = PALETTE.amber
): void {
  const r = Math.max(3, radius);
  const top = Math.floor(cy - r - 2);
  const bottom = Math.ceil(cy + r + 2);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.sqrt(dx * dx + dy * dy) > r + 1.5) continue;
      const across = (y - (cy - r)) / (r * 2);
      // Slices get taller as you move down the disc.
      const band = Math.floor((y - cy + r) / (1.5 + across * 3));
      if (band % 2 === 1 && across > 0.18) continue;
      p.put(x, y, Math.sqrt(dx * dx + dy * dy) > r - 0.5 ? halo : core);
    }
  }
}

/** Twinkling stars over the upper part of the buffer. */
function starfield(p: Painter, count: number, maxY: number): void {
  const total = Math.round(p.cols * count);
  for (let i = 0; i < total; i += 1) {
    const sx = Math.floor(noise(i, 5) * p.cols);
    const sy = Math.floor(noise(i, 9) * maxY);
    const phase = noise(i, 13) * Math.PI * 2;
    const b = 120 + 135 * (0.4 + 0.6 * Math.sin(p.time * 0.0011 + phase));
    p.put(sx, sy, [b, b, Math.min(255, b + 25)]);
  }
}

/** A silhouetted building block with a lit window grid. */
function tower(
  p: Painter,
  x: number,
  width: number,
  height: number,
  baseY: number,
  color: Rgb,
  windowColor: Rgb | null,
  seed: number
): void {
  if (width <= 0 || height <= 0) return;
  p.fill(x, baseY - height, width, height, color);
  if (windowColor) {
    for (let wy = 2; wy < height - 1; wy += 2) {
      for (let wx = 1; wx < width - 1; wx += 2) {
        if (noise(seed * 31 + wx, seed + wy * 17) > 0.52) {
          p.put(x + wx, baseY - height + wy, windowColor);
        }
      }
    }
  }
}

/**
 * Build a repeatable skyline strip in grid units. Returns the buildings plus
 * the total width of the strip, so the caller can scroll it seamlessly.
 */
function skylineStrip(
  seed: number,
  cols: number,
  minH: number,
  maxH: number
): { x: number; w: number; h: number; seed: number }[] {
  const out: { x: number; w: number; h: number; seed: number }[] = [];
  let x = -6;
  let i = 0;
  while (x < cols + 40) {
    const w = 2 + Math.floor(noise(i, seed) * 5);
    const h = minH + Math.floor(noise(i, seed + 91) * Math.max(1, maxH - minH));
    out.push({ x, w, h, seed: i + seed });
    x += w + 1 + Math.floor(noise(i, seed + 7) * 3);
    i += 1;
  }
  return out;
}

/** Blit a string-art sprite. `key` maps a character to a colour. */
function sprite(
  p: Painter,
  art: readonly string[],
  x: number,
  y: number,
  key: Record<string, Rgb>
): void {
  for (let row = 0; row < art.length; row += 1) {
    const line = art[row];
    for (let col = 0; col < line.length; col += 1) {
      const color = key[line[col]];
      if (color) p.put(x + col, y + row, color);
    }
  }
}

/* ------------------------------------------------------------------ *
 * skyline — dusk city (profile banner)
 * ------------------------------------------------------------------ */

const SKY_NIGHT: Rgb[] = [
  PALETTE.night,
  PALETTE.ink,
  PALETTE.brand800,
  PALETTE.brand600,
  PALETTE.brand400,
];

function skyline(p: Painter): void {
  const { cols, rows } = p;
  const horizon = rows * 0.86;

  ditheredSky(p, SKY_NIGHT, horizon);
  starfield(p, 0.35, horizon * 0.62);

  const cycle = 30000;
  const phase = (p.time % cycle) / cycle;
  slicedSun(p, cols * 0.68, rows * 1.0 - phase * (rows * 0.46), rows * 0.17);

  const layers = [
    {
      buildings: skylineStrip(3, cols, Math.round(rows * 0.18), Math.round(rows * 0.4)),
      color: [49, 22, 106] as Rgb,
      speed: 0.5,
      windows: true,
    },
    {
      buildings: skylineStrip(11, cols, Math.round(rows * 0.3), Math.round(rows * 0.56)),
      color: [20, 9, 49] as Rgb,
      speed: 1.3,
      windows: true,
    },
  ];

  for (const layer of layers) {
    const stripWidth = layer.buildings[layer.buildings.length - 1].x + 6;
    const offset = (p.time * 0.004 * layer.speed) % stripWidth;
    for (const b of layer.buildings) {
      for (let pass = 0; pass < 2; pass += 1) {
        const bx = b.x - offset + pass * stripWidth;
        if (bx > cols || bx + b.w < 0) continue;
        tower(
          p,
          bx,
          b.w,
          b.h,
          rows,
          layer.color,
          layer.windows ? PALETTE.lit : null,
          b.seed
        );
        if (b.h > rows * 0.45 && noise(b.seed, 3) > 0.45) {
          p.vline(bx + (b.w >> 1), rows - b.h - 2, 2, layer.color);
        }
      }
    }
  }
}

defineScene(
  "skyline",
  skyline,
  "Pixel art skyline at dusk, with a sun rising behind two parallax rows of towers",
  20
);

/* ------------------------------------------------------------------ *
 * street — dawn Delhi (landing hero)
 * ------------------------------------------------------------------ */

/** Side-on auto-rickshaw. `#` outline, `Y` canopy, `G` body, `W` wheel. */
const RICKSHAW = [
  ".....#######.....",
  "....#########....",
  "...#####Y#####...",
  "..####Y#Y#####..",
  "..##YY#..#YY##...",
  "..####....####...",
  ".##############..",
  ".#GGGGGGGGGGGG#..",
  ".#GG#GGG#GGG#G#..",
  "..#.#...#.#..#...",
  "......W...W......",
];

/** A 3px bird that flaps between two wing positions. */
const BIRD_UP = ["..#..", ".#.#.", "#...#"];
const BIRD_DOWN = [".....", "#...#", ".#.#."];

function street(p: Painter): void {
  const { cols, rows, time } = p;
  const roadY = Math.round(rows * 0.82);
  const horizon = rows * 0.72;

  // Dawn: indigo overhead warming into amber at the rooftops.
  ditheredSky(
    p,
    [
      PALETTE.ink,
      PALETTE.brand800,
      PALETTE.brand600,
      PALETTE.brand400,
      PALETTE.amber,
      PALETTE.lit,
    ],
    horizon,
    6
  );

  // Sun sitting low and to the right, behind the skyline.
  const sunCycle = 46000;
  const sunPhase = (time % sunCycle) / sunCycle;
  slicedSun(
    p,
    cols * 0.78,
    horizon - rows * 0.04 + sunPhase * rows * 0.05,
    rows * 0.15
  );

  // Two parallax skyline strips.
  const far = skylineStrip(23, cols, Math.round(rows * 0.1), Math.round(rows * 0.24));
  const near = skylineStrip(37, cols, Math.round(rows * 0.18), Math.round(rows * 0.4));
  const drawStrip = (
    buildings: typeof far,
    color: Rgb,
    speed: number,
    windowColor: Rgb | null
  ) => {
    const stripWidth = buildings[buildings.length - 1].x + 6;
    const offset = (time * 0.0035 * speed) % stripWidth;
    for (const b of buildings) {
      for (let pass = 0; pass < 2; pass += 1) {
        const bx = b.x - offset + pass * stripWidth;
        if (bx > cols || bx + b.w < 0) continue;
        tower(p, bx, b.w, b.h, roadY, color, windowColor, b.seed);
      }
    }
  };
  drawStrip(far, mix(PALETTE.brand800, PALETTE.lit, 0.22), 0.4, null);
  drawStrip(near, mix(PALETTE.ink, PALETTE.night, 0.35), 0.9, PALETTE.lit);

  // Birds crossing the sky, two sizes so they read as distance.
  for (let i = 0; i < 4; i += 1) {
    const speed = 0.006 + i * 0.0022;
    const bx = ((time * speed + i * 47) % (cols + 20)) - 10;
    const by = rows * (0.14 + i * 0.06) + Math.sin(time * 0.0016 + i) * 1.2;
    const flap = Math.sin(time * 0.009 + i * 2) > 0 ? BIRD_UP : BIRD_DOWN;
    sprite(p, flap, bx, by, { "#": mix(PALETTE.night, PALETTE.ink, 0.5) });
  }

  // Road, kerb and centre line.
  p.fill(0, roadY, cols, rows - roadY, mix(PALETTE.slate900, PALETTE.night, 0.35));
  p.hline(0, roadY, cols, mix(PALETTE.slate500, PALETTE.slate700, 0.4));
  const dashPeriod = 14;
  const dashOffset = Math.round((time * 0.02) % dashPeriod);
  for (let x = -dashOffset; x < cols; x += dashPeriod) {
    p.fill(x, roadY + Math.floor((rows - roadY) * 0.55), 6, 1, PALETTE.lit);
  }

  // Street lamps: post plus a warm pool of light.
  const lampSpacing = Math.max(24, Math.round(cols / 4));
  for (let i = 0; i < 5; i += 1) {
    const lx = i * lampSpacing + 6;
    if (lx > cols) break;
    const postH = Math.round(rows * 0.2);
    p.vline(lx, roadY - postH, postH, mix(PALETTE.ink, PALETTE.night, 0.3));
    p.hline(lx, roadY - postH, 4, mix(PALETTE.ink, PALETTE.night, 0.3));
    p.put(lx + 4, roadY - postH + 1, PALETTE.lit);
    for (let g = 0; g < 5; g += 1) {
      const radius = 5 - Math.floor(g / 2);
      for (let a = 0; a < radius; a += 1) {
        p.blend(lx + 4 - a, roadY - postH + 1 + a, PALETTE.amber, 0.14);
        p.blend(lx + 4 + a, roadY - postH + 1 + a, PALETTE.amber, 0.14);
      }
    }
  }

  // The rickshaw crosses the road on a slow loop, bobbing over the tarmac.
  const rickshawW = RICKSHAW[0].length;
  const loopW = cols + rickshawW * 2;
  const travel = (time * 0.014) % loopW;
  const rx = Math.round(cols + rickshawW - travel);
  const bob = Math.round(Math.sin(time * 0.006) * 0.5);
  const ry = roadY + Math.floor((rows - roadY) * 0.12) + bob;
  if (rx > -rickshawW) {
    // Contact shadow first, so the vehicle sits on the road.
    for (let i = 0; i < rickshawW - 2; i += 1) {
      p.blend(rx + 1 + i, ry + RICKSHAW.length, PALETTE.slate900, 0.4);
    }
    sprite(p, RICKSHAW, rx, ry, {
      "#": PALETTE.brand950,
      Y: PALETTE.lit,
      G: PALETTE.jade,
      W: PALETTE.slate900,
    });
  }

  // Foreground kerb so the road does not butt straight into the page edge.
  p.fill(0, rows - 1, cols, 1, mix(PALETTE.brand950, PALETTE.night, 0.4));
}

defineScene(
  "street",
  street,
  "Pixel art of a Delhi street at dawn, with an auto-rickshaw crossing past lit street lamps",
  20
);

/* ------------------------------------------------------------------ *
 * campus — college gate at sunrise (colleges)
 * ------------------------------------------------------------------ */

/** `A` arch stone, `G` gold trim, `F` flag, `T` tree, `P` path, `K` ink. */
const GATE: Record<string, Rgb> = {
  A: mix(PALETTE.slate200, PALETTE.white, 0.25),
  G: PALETTE.lit,
  F: PALETTE.ember,
  T: PALETTE.jade,
  P: mix(PALETTE.slate300, PALETTE.slate200, 0.5),
  K: PALETTE.brand950,
};

function campus(p: Painter): void {
  const { cols, rows, time } = p;
  const ground = Math.round(rows * 0.78);

  ditheredSky(
    p,
    [
      PALETTE.night,
      PALETTE.ink,
      PALETTE.brand800,
      PALETTE.brand600,
      PALETTE.amber,
      PALETTE.lit,
    ],
    ground,
    6
  );
  slicedSun(p, cols * 0.5, ground - rows * 0.3, rows * 0.13);

  // Distant campus blocks behind the gate.
  const back = skylineStrip(53, cols, Math.round(rows * 0.12), Math.round(rows * 0.26));
  const stripWidth = back[back.length - 1].x + 6;
  const offset = (time * 0.0012) % stripWidth;
  for (const b of back) {
    for (let pass = 0; pass < 2; pass += 1) {
      const bx = b.x - offset + pass * stripWidth;
      if (bx > cols || bx + b.w < 0) continue;
      tower(p, bx, b.w, b.h, ground, mix(PALETTE.brand800, PALETTE.brand600, 0.5), null, b.seed);
    }
  }

  // Lawn.
  p.fill(0, ground, cols, rows - ground, mix(PALETTE.jade, PALETTE.slate100, 0.3));

  // Path leading to the gate.
  const pathTop = ground + Math.round(rows * 0.06);
  p.fill(
    Math.round(cols * 0.42),
    pathTop,
    Math.round(cols * 0.16),
    rows - pathTop,
    mix(PALETTE.slate300, PALETTE.white, 0.1)
  );

  // The gate itself: two pillars, an arch, a nameplate.
  const gateW = Math.round(cols * 0.34);
  const gateX = Math.round((cols - gateW) / 2);
  const pillarW = Math.max(4, Math.round(gateW * 0.12));
  const pillarH = Math.round(rows * 0.34);

  for (const px of [gateX, gateX + gateW - pillarW]) {
    p.fill(px, ground - pillarH, pillarW, pillarH, GATE.A);
    p.vline(px, ground - pillarH, pillarH, GATE.K);
    p.vline(px + pillarW - 1, ground - pillarH, pillarH, GATE.K);
  }
  // Arch span with stepped shoulders.
  const archY = ground - pillarH;
  const archH = Math.max(3, Math.round(rows * 0.1));
  p.fill(gateX, archY - archH, gateW, archH, GATE.A);
  p.hline(gateX, archY - archH, gateW, GATE.K);
  for (let step = 0; step < 3; step += 1) {
    const inset = Math.round(((step + 1) * pillarW) / 2);
    p.fill(gateX + inset, archY - archH - (step + 1), gateW - inset * 2, 1, GATE.A);
  }
  // Gold nameplate on the arch.
  p.fill(gateX + pillarW + 2, archY - archH + 2, gateW - pillarW * 2 - 4, 2, GATE.G);

  // Flag on the centre pillar pair, flapping.
  const poleX = Math.round(cols * 0.5);
  const poleH = Math.round(rows * 0.5);
  p.vline(poleX, ground - poleH, poleH, GATE.K);
  const wave = Math.sin(time * 0.005);
  for (let i = 0; i < Math.round(rows * 0.14); i += 1) {
    const waveX = poleX + 1 + i;
    const wobble = Math.round(wave * i * 0.12);
    const flagH = Math.max(2, Math.round(rows * 0.07) - Math.abs(wobble) - i * 0.06);
    p.fill(waveX, ground - poleH + 2 + wobble, 1, Math.max(1, Math.round(flagH)), GATE.F);
  }

  // Trees flanking the path, gently swaying.
  for (let i = 0; i < 5; i += 1) {
    const tx = Math.round(cols * (0.06 + i * 0.21));
    if (tx > cols - 4) break;
    const sway = Math.round(Math.sin(time * 0.0018 + i * 1.7) * 1.2);
    const trunkH = Math.round(rows * 0.1);
    p.vline(tx, ground - trunkH, trunkH, mix(PALETTE.ink, PALETTE.night, 0.3));
    for (let r = 0; r < 4; r += 1) {
      const w = 9 - r * 2;
      p.fill(tx - w / 2 + sway, ground - trunkH - 3 - r * 2, w, 2, mix(GATE.T, PALETTE.slate700, r * 0.16));
    }
  }
}

defineScene(
  "campus",
  campus,
  "Pixel art of a college gate at sunrise with a flapping flag and trees either side",
  18
);

/* ------------------------------------------------------------------ *
 * map — locality grid (localities)
 * ------------------------------------------------------------------ */

function map(p: Painter): void {
  const { cols, rows, time } = p;
  const road = mix(PALETTE.slate300, PALETTE.slate200, 0.35);

  p.fill(0, 0, cols, rows, road);

  // City blocks laid out on a jittered grid, with roads as the gaps.
  const cellW = Math.max(14, Math.round(cols / 7));
  const cellH = Math.max(9, Math.round(rows / 4));
  const blockW = cellW - 3;
  const blockH = cellH - 3;

  for (let gy = 0; gy * cellH < rows + cellH; gy += 1) {
    for (let gx = 0; gx * cellW < cols + cellW; gx += 1) {
      const jitterX = Math.round(noise(gx, gy) * 2);
      const jitterY = Math.round(noise(gx + 31, gy + 17) * 2);
      const bx = gx * cellW + 2 + jitterX;
      const by = gy * cellH + 2 + jitterY;
      const shade = noise(gx + 7, gy + 3);
      const color =
        shade > 0.72
          ? mix(PALETTE.brand200, PALETTE.white, 0.2)
          : mix(PALETTE.slate100, PALETTE.white, 0.55);
      p.fill(bx, by, blockW, blockH, color);
      // A few blocks are parks.
      if (shade > 0.88) {
        p.fill(bx + 1, by + 1, blockW - 2, blockH - 2, mix(PALETTE.jade, PALETTE.white, 0.72));
      }
      // Building footprints inside a block.
      const units = 1 + Math.floor(noise(gx + 11, gy + 5) * 3);
      for (let u = 0; u < units; u += 1) {
        const ux = bx + 1 + Math.floor(noise(gx * 4 + u, gy) * Math.max(1, blockW - 4));
        const uy = by + 1 + Math.floor(noise(gx, gy * 4 + u) * Math.max(1, blockH - 3));
        p.fill(ux, uy, 2, 2, mix(PALETTE.slate300, PALETTE.slate500, 0.35));
      }
    }
  }

  // A dashed route walking across the map, redrawn as a moving highlight.
  const routeY = Math.round(rows * 0.52);
  for (let x = 0; x < cols; x += 1) {
    const waveY = routeY + Math.round(Math.sin(x * 0.09) * rows * 0.12);
    if (x % 6 < 3) p.put(x, waveY, PALETTE.brand600);
    p.put(x, waveY + 1, mix(PALETTE.brand600, PALETTE.white, 0.5));
  }

  // Pins drop in on a stagger, then pulse a ring outwards.
  const pins = [
    { x: 0.2, y: 0.3, at: 0 },
    { x: 0.46, y: 0.6, at: 900 },
    { x: 0.74, y: 0.26, at: 1800 },
    { x: 0.62, y: 0.78, at: 2700 },
  ];
  for (const pin of pins) {
    const local = (time - pin.at) % 6000;
    const cx = Math.round(cols * pin.x);
    const baseY = Math.round(rows * pin.y);
    if (local < 0) continue;
    // Drop with an ease-out over the first 400ms of each cycle.
    const dropProgress = Math.min(1, local / 400);
    const eased = 1 - Math.pow(1 - dropProgress, 3);
    const stem = Math.round(rows * 0.12);
    const headY = Math.round(baseY - stem - (1 - eased) * stem);

    // Pulse ring on the ground.
    const pulse = ((local - 400) % 2200) / 2200;
    if (pulse >= 0 && pulse < 0.55) {
      const r = 1 + pulse * 9;
      const steps = Math.round(r * 6);
      for (let a = 0; a < steps; a += 1) {
        const ang = (a / steps) * Math.PI * 2;
        p.blend(cx + Math.cos(ang) * r, baseY + Math.sin(ang) * r * 0.45, PALETTE.brand600, (1 - pulse / 0.55) * 0.5);
      }
    }

    // Stem and head.
    p.vline(cx, headY + 3, stem, PALETTE.brand950);
    p.put(cx, baseY, PALETTE.brand950);
    p.put(cx - 1, baseY - 1, PALETTE.brand950);
    p.put(cx + 1, baseY - 1, PALETTE.brand950);
    p.fill(cx - 2, headY, 5, 4, PALETTE.brand950);
    p.fill(cx - 1, headY + 1, 3, 2, PALETTE.brand600);
  }
}

defineScene("map", map, "Pixel art map of city blocks with a dashed route and pins pulsing into place", 16);

/* ------------------------------------------------------------------ *
 * room — PG interior (PG detail / saved)
 * ------------------------------------------------------------------ */

function room(p: Painter): void {
  const { cols, rows, time } = p;
  const floorY = Math.round(rows * 0.74);

  // Wall, skirting, floor.
  p.fill(0, 0, cols, rows, mix(PALETTE.brand200, PALETTE.white, 0.72));
  p.fill(0, 0, cols, floorY, mix(PALETTE.brand400, PALETTE.white, 0.68));
  p.hline(0, floorY, cols, PALETTE.brand950);
  p.fill(0, floorY + 1, cols, rows - floorY, mix(PALETTE.slate300, PALETTE.brand400, 0.35));

  // Floorboards receding toward the horizon.
  for (let y = floorY + 2; y < rows; y += 2) {
    p.hline(0, y, cols, mix(PALETTE.slate500, PALETTE.slate300, 0.6));
  }

  // Window with daylight and a slow drifting cloud.
  const winX = Math.round(cols * 0.1);
  const winW = Math.max(12, Math.round(cols * 0.26));
  const winY = Math.round(rows * 0.16);
  const winH = Math.round(rows * 0.34);
  p.fill(winX - 1, winY - 1, winW + 2, winH + 2, PALETTE.slate900);
  p.fill(winX, winY, winW, winH, mix(PALETTE.sky, PALETTE.white, 0.45));

  // Cloud drifting behind the glass.
  const cloudX = winX + ((time * 0.006) % (winW + 16)) - 8;
  for (let i = 0; i < 10; i += 1) {
    const cx = cloudX + (i % 5) * 2;
    const cy = winY + 3 + Math.floor(i / 5) * 2;
    if (cx >= winX && cx < winX + winW) p.blend(cx, cy, PALETTE.white, 0.85);
  }
  // Mullions.
  p.vline(winX + Math.floor(winW / 2), winY, winH, PALETTE.slate900);
  p.hline(winX, winY + Math.floor(winH / 2), winW, PALETTE.slate900);

  // Light shaft spilling from the window onto the floor, drifting slowly.
  const drift = Math.sin(time * 0.0004) * 2;
  for (let y = winY; y < rows; y += 1) {
    const t = (y - winY) / (rows - winY);
    const spread = Math.round(t * winW * 0.55);
    const cx = winX + winW / 2 + spread + drift;
    for (let x = cx - spread; x <= cx + spread; x += 1) {
      if (x < winX - 2 || x > winX + winW + spread) continue;
      p.blend(x, y, PALETTE.lit, 0.1 * (1 - t));
    }
  }

  // Ceiling fan: blades rotate, casting a faint shadow sweep on the wall.
  const fanX = Math.round(cols * 0.62);
  const fanY = Math.round(rows * 0.14);
  const angle = (time * 0.006) % (Math.PI * 2);
  p.vline(fanX, 0, fanY, PALETTE.slate900);
  for (let b = 0; b < 3; b += 1) {
    const a = angle + (b * Math.PI * 2) / 3;
    const ex = fanX + Math.cos(a) * Math.max(6, cols * 0.07);
    const ey = fanY + Math.sin(a) * Math.max(3, rows * 0.035);
    for (let step = 0; step < 10; step += 1) {
      const t = step / 10;
      p.put(fanX + (ex - fanX) * t, fanY + (ey - fanY) * t, PALETTE.slate700);
    }
  }
  p.put(fanX, fanY, PALETTE.slate900);

  // Bunk bed against the right wall.
  const bedX = Math.round(cols * 0.68);
  const bedW = Math.max(16, Math.round(cols * 0.22));
  const frame = PALETTE.brand950;
  const mattress = mix(PALETTE.white, PALETTE.brand200, 0.3);
  const lowerY = floorY - Math.round(rows * 0.16);
  const upperY = floorY - Math.round(rows * 0.3);
  for (const [y, h] of [
    [upperY, 3],
    [lowerY, 3],
  ] as const) {
    p.fill(bedX, y, bedW, h, mattress);
    p.hline(bedX, y, bedW, frame);
    p.fill(bedX + 1, y - 1, Math.round(bedW * 0.3), 1, mix(PALETTE.lit, PALETTE.white, 0.2));
  }
  p.vline(bedX, upperY, floorY - upperY, frame);
  p.vline(bedX + bedW - 1, upperY, floorY - upperY, frame);
  // Ladder.
  for (let r = 0; r < 4; r += 1) {
    const y = lowerY + 4 + r * 3;
    if (y < floorY - 1) p.hline(bedX + 2, y, 4, frame);
  }
  p.vline(bedX + 3, upperY + 3, floorY - upperY - 3, frame);

  // Desk lamp glow, breathing slowly.
  const lampX = Math.round(cols * 0.46);
  const lampY = floorY - Math.round(rows * 0.1);
  const breath = 0.6 + 0.4 * Math.sin(time * 0.0012);
  p.fill(lampX - 1, lampY - 2, 3, 2, PALETTE.lit);
  p.vline(lampX, lampY, 3, PALETTE.slate900);
  for (let g = 0; g < 6; g += 1) {
    p.blend(lampX - 1 - g, lampY - 2 - g, PALETTE.amber, 0.09 * breath);
    p.blend(lampX + 1 + g, lampY - 2 - g, PALETTE.amber, 0.09 * breath);
  }
}

defineScene(
  "room",
  room,
  "Pixel art of a PG room with light through a window, a turning ceiling fan and a bunk bed",
  18
);