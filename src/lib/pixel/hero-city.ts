/**
 * hero-city — the landing hero's living street.
 *
 * Upgrades on the original `street` scene, kept in a separate module so the
 * older scene stays untouched for other pages:
 *
 *  - a full day → dusk → night cycle (about a minute long) that re-tints the
 *    sky, the buildings and the light;
 *  - a two-layer parallax skyline with windows that switch on as darkness
 *    falls;
 *  - two-way traffic: an auto-rickshaw coming home and a bus going out;
 *  - students walking the pavement (a nod to who the product is for), plus
 *    the birds and lamp pools the original had.
 *
 * Like every scene here it is a pure function of `time`, so the
 * reduced-motion static frame and resize redraws fall out for free.
 */

// Engine primitives come from `core`; shared scene helpers from
// `scenes-impl`, which re-uses the same primitives internally.
import { PALETTE, defineScene, mix, noise, type Painter, type Rgb } from "./core";
import {
  ditheredSky,
  slicedSun,
  skylineStrip,
  sprite,
  starfield,
  tower,
} from "./scenes-impl";

/* ------------------------------------------------------------------ *
 * sprites
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

/** A small city bus, facing right: `#` outline, `B` body, `W` windows, `w` wheels. */
const BUS = [
  "..############...",
  ".#WWWWWWWWWWWW#..",
  ".#WWWWWWWWWWWW#..",
  ".#BBBBBBBBBBBB#..",
  ".#BBBBBBBBBBBB#..",
  ".#BBBBBBBBBBBB#..",
  ".##############..",
  "..w..........w...",
];

/** Two-frame walking student: `K` body, `H` head/backpack accent. */
const STUDENT_A = ["..H...", ".KKK..", "..K...", ".K.K..", "..K.K."];
const STUDENT_B = ["..H...", ".KKK..", "..K...", "..KK..", ".K..K."];

/** A 3px bird that flaps between two wing positions. */
const BIRD_UP = ["..#..", ".#.#.", "#...#"];
const BIRD_DOWN = [".....", "#...#", ".#.#."];

/* ------------------------------------------------------------------ *
 * palette stages of the day
 * ------------------------------------------------------------------ */

const DAY_TOP: Rgb = [92, 169, 248];
const DAY_MID: Rgb = [140, 196, 250];
const DUSK_TOP: Rgb = PALETTE.ink;
const NIGHT_TOP: Rgb = PALETTE.night;

/** Sky ramps for each phase; `rampAt` interpolates between the two lists. */
const SKY_DAY: Rgb[] = [DAY_TOP, DAY_MID, [233, 226, 250], [252, 224, 181], [253, 230, 154]];
const SKY_DUSK: Rgb[] = [DUSK_TOP, PALETTE.brand800, PALETTE.brand600, PALETTE.brand400, PALETTE.amber];
const SKY_NIGHT: Rgb[] = [NIGHT_TOP, PALETTE.ink, PALETTE.brand950, [58, 26, 110], PALETTE.brand800];

/**
 * Blend two sky ramps colour-by-colour. `t` 0 returns `a`, 1 returns `b`.
 * Both ramps must have the same number of stops.
 */
function mixRamp(a: readonly Rgb[], b: readonly Rgb[], t: number): Rgb[] {
  return a.map((stop, index) => mix(stop, b[index], t));
}

/** The day's phase: 0 = noon, 0.5 = dusk, 1 = night (wraps). */
function dayPhase(time: number): number {
  const cycle = 64000;
  return (time % cycle) / cycle;
}

/**
 * Sky ramp + horizon light for the current phase, plus `darkness` (0..1)
 * which drives windows, lamps and stars.
 */
function phaseLight(time: number): { sky: Rgb[]; darkness: number } {
  const phase = dayPhase(time);
  // Day holds for a while, then slides through dusk into night.
  if (phase < 0.42) {
    return { sky: SKY_DAY, darkness: 0 };
  }
  if (phase < 0.62) {
    const t = (phase - 0.42) / 0.2;
    return { sky: mixRamp(SKY_DAY, SKY_DUSK, t), darkness: t };
  }
  if (phase < 0.82) {
    const t = (phase - 0.62) / 0.2;
    return { sky: mixRamp(SKY_DUSK, SKY_NIGHT, t), darkness: 1 };
  }
  // Night eases back toward pre-dawn indigo before the cycle restarts.
  const t = (phase - 0.82) / 0.18;
  return { sky: mixRamp(SKY_NIGHT, SKY_DUSK, t * 0.35), darkness: 1 - t * 0.3 };
}

/* ------------------------------------------------------------------ *
 * the scene
 * ------------------------------------------------------------------ */

function heroCity(p: Painter): void {
  const { cols, rows, time } = p;
  const roadY = Math.round(rows * 0.82);
  const horizon = rows * 0.72;
  const { sky, darkness } = phaseLight(time);

  ditheredSky(p, sky, horizon, 6);

  // Sun by day, out at night — the same sliced disc, re-coloured.
  const sunCycle = 64000;
  const sunPhase = (time % sunCycle) / sunCycle;
  const sunY = horizon - rows * 0.1 - Math.sin(Math.min(1, sunPhase / 0.42) * Math.PI) * rows * 0.06;
  if (darkness < 0.98) {
    slicedSun(p, cols * 0.78, sunY, rows * 0.13, PALETTE.lit, PALETTE.amber);
  } else {
    // A paler moon in the same slot, so the sky never loses its anchor.
    slicedSun(p, cols * 0.78, sunY + rows * 0.02, rows * 0.07, [226, 232, 240], [203, 213, 225]);
  }

  if (darkness > 0.35) {
    starfield(p, 0.3, horizon * 0.55);
  }

  // Two parallax skyline strips; windows warm up as `darkness` rises.
  const far = skylineStrip(23, cols, Math.round(rows * 0.1), Math.round(rows * 0.24));
  const near = skylineStrip(37, cols, Math.round(rows * 0.18), Math.round(rows * 0.4));
  const drawStrip = (
    buildings: typeof far,
    dayColor: Rgb,
    nightColor: Rgb,
    speed: number,
    windowSeed: number
  ) => {
    const stripWidth = buildings[buildings.length - 1].x + 6;
    const offset = (time * 0.0035 * speed) % stripWidth;
    const wall = mix(dayColor, nightColor, Math.max(darkness, 0.15));
    for (const b of buildings) {
      for (let pass = 0; pass < 2; pass += 1) {
        const bx = b.x - offset + pass * stripWidth;
        if (bx > cols || bx + b.w < 0) continue;
        // Building body, tinted toward the night ramp as darkness rises.
        tower(p, bx, b.w, b.h, roadY, wall, null, b.seed);
        if (darkness > 0.05) {
          // Per-window deterministic threshold: each window flips on at its
          // own moment as darkness rises, instead of all at once.
          const litColor = mix(PALETTE.amber, PALETTE.lit, noise(b.seed, 7));
          for (let wy = 2; wy < b.h - 1; wy += 2) {
            for (let wx = 1; wx < b.w - 1; wx += 2) {
              const roll = noise(windowSeed * 31 + wx, windowSeed + wy * 17);
              if (roll < darkness * 0.62) {
                p.put(bx + wx, roadY - b.h + wy, litColor);
              }
            }
          }
        }
      }
    }
  };
  drawStrip(far, mix(PALETTE.brand800, PALETTE.lit, 0.22), mix(PALETTE.brand950, PALETTE.ink, 0.4), 0.4, 5);
  drawStrip(near, mix(PALETTE.ink, PALETTE.night, 0.35), PALETTE.brand950, 0.9, 9);

  // Birds by day, gone to roost by night.
  if (darkness < 0.5) {
    for (let i = 0; i < 4; i += 1) {
      const speed = 0.006 + i * 0.0022;
      const bx = ((time * speed + i * 47) % (cols + 20)) - 10;
      const by = rows * (0.14 + i * 0.06) + Math.sin(time * 0.0016 + i) * 1.2;
      const flap = Math.sin(time * 0.009 + i * 2) > 0 ? BIRD_UP : BIRD_DOWN;
      sprite(p, flap, bx, by, { "#": mix(PALETTE.night, PALETTE.ink, 0.5) });
    }
  }

  // Road, kerb, centre line.
  p.fill(0, roadY, cols, rows - roadY, mix(PALETTE.slate900, NIGHT_TOP, 0.35 + darkness * 0.25));
  p.hline(0, roadY, cols, mix(PALETTE.slate500, PALETTE.slate700, 0.4));
  const dashPeriod = 14;
  const dashOffset = Math.round((time * 0.02) % dashPeriod);
  for (let x = -dashOffset; x < cols; x += dashPeriod) {
    p.fill(x, roadY + Math.floor((rows - roadY) * 0.55), 6, 1, darkness > 0.6 ? mix(PALETTE.lit, PALETTE.amber, 0.5) : PALETTE.lit);
  }

  // Street lamps: warm pools that strengthen after dark.
  const lampSpacing = Math.max(24, Math.round(cols / 4));
  for (let i = 0; i < 5; i += 1) {
    const lx = i * lampSpacing + 6;
    if (lx > cols) break;
    const postH = Math.round(rows * 0.2);
    p.vline(lx, roadY - postH, postH, mix(PALETTE.ink, PALETTE.night, 0.3));
    p.hline(lx, roadY - postH, 4, mix(PALETTE.ink, PALETTE.night, 0.3));
    p.put(lx + 4, roadY - postH + 1, PALETTE.lit);
    const glow = 0.08 + darkness * 0.1;
    for (let g = 0; g < 5; g += 1) {
      const radius = 5 - Math.floor(g / 2);
      for (let a = 0; a < radius; a += 1) {
        p.blend(lx + 4 - a, roadY - postH + 1 + a, PALETTE.amber, glow);
        p.blend(lx + 4 + a, roadY - postH + 1 + a, PALETTE.amber, glow);
      }
    }
  }

  // Pavement between kerb and buildings where the students walk.
  const pavementY = roadY - Math.max(3, Math.round(rows * 0.05));

  // The rickshaw crosses right-to-left on a slow loop.
  const rickshawW = RICKSHAW[0].length;
  const loopW = cols + rickshawW * 2;
  const travel = (time * 0.014) % loopW;
  const rx = Math.round(cols + rickshawW - travel);
  const bob = Math.round(Math.sin(time * 0.006) * 0.5);
  const ry = roadY + Math.floor((rows - roadY) * 0.12) + bob;
  if (rx > -rickshawW) {
    for (let i = 0; i < rickshawW - 2; i += 1) {
      p.blend(rx + 1 + i, ry + RICKSHAW.length, PALETTE.slate900, 0.4);
    }
    sprite(p, RICKSHAW, rx, ry, {
      "#": PALETTE.brand950,
      Y: PALETTE.lit,
      G: darkness > 0.5 ? PALETTE.jade : mix(PALETTE.jade, PALETTE.white, 0.15),
      W: PALETTE.slate900,
    });
  }

  // The bus goes the other way, further back, slightly slower.
  const busW = BUS[0].length;
  const busLoop = cols + busW * 2;
  const busTravel = (time * 0.009 + busLoop * 0.55) % busLoop;
  const busX = Math.round(busTravel - busW);
  const busY = roadY + Math.floor((rows - roadY) * 0.04) + Math.round(Math.sin(time * 0.004) * 0.4);
  if (busX < cols) {
    for (let i = 0; i < busW - 2; i += 1) {
      p.blend(busX + 1 + i, busY + BUS.length, PALETTE.slate900, 0.35);
    }
    sprite(p, BUS, busX, busY, {
      "#": PALETTE.brand950,
      B: darkness > 0.5 ? PALETTE.brand600 : mix(PALETTE.brand600, PALETTE.white, 0.2),
      W: PALETTE.sky,
      w: PALETTE.slate900,
    });
  }

  // Students strolling the pavement, flip-book legs and all.
  const walkers = [
    { dir: 1 as const, speed: 0.004, lane: 0.25, seed: 3 },
    { dir: -1 as const, speed: 0.0034, lane: 0.62, seed: 11 },
    { dir: 1 as const, speed: 0.0046, lane: 0.86, seed: 19 },
  ];
  for (const walker of walkers) {
    const span = cols + 12;
    const travelled = (time * walker.speed * (walker.dir === 1 ? 1 : -1) + walker.lane * span + span) % span;
    const wx = Math.round(walker.dir === 1 ? travelled - 6 : cols - travelled);
    const frame = Math.floor(time * 0.006 + walker.seed) % 2 === 0 ? STUDENT_A : STUDENT_B;
    const wy = pavementY - STUDENT_A.length + 1;
    for (let i = 0; i < 5; i += 1) {
      p.blend(wx + 1 + i, wy + STUDENT_A.length, PALETTE.slate900, 0.3);
    }
    sprite(p, frame, wx, wy, {
      H: darkness > 0.55 ? PALETTE.brand400 : PALETTE.ember,
      K: mix(PALETTE.slate900, NIGHT_TOP, darkness * 0.4),
    });
  }

  // Foreground kerb closes the composition.
  p.fill(0, rows - 1, cols, 1, mix(PALETTE.brand950, NIGHT_TOP, 0.4));
}

defineScene(
  "hero-city",
  heroCity,
  "Pixel art of a Delhi street living through a full day: dawn light, an auto-rickshaw and a bus passing, students walking home as the windows come on",
  20
);
