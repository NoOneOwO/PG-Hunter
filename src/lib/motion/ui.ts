/**
 * PG Hunter — Motion UI layer.
 *
 * Built on vanilla Motion rather than the React binding: the site is Astro, and
 * mounting a React island per component would cost far more JS than the
 * animations are worth.
 *
 * Three declarative hooks, all opt-in via attributes so a page never animates
 * something it did not mean to:
 *
 *   data-reveal          fade + rise once, when scrolled into view
 *   data-reveal-group    reveal children in sequence instead of all at once
 *   data-hover-lift      spring up on hover, press in on tap
 *
 * `.section-head` and `.eyebrow` are revealed automatically, since by
 * construction they open a block of content and always want the same entrance.
 *
 * Split of responsibilities, deliberately:
 *
 *   - Entrances are a CSS animation (`.is-revealed` in global.css). Visibility
 *     is the one thing that must not be able to fail: a JS animation whose
 *     promise never settles, or a module that never loads, would strand real
 *     content at opacity 0. A CSS animation with `both` fill holds its end
 *     state on its own.
 *   - Motion drives the *gesture* work — the spring on hover lift, the press
 *     scale — which is where its physics genuinely earn their bytes, and where
 *     nothing is hidden until the animation lands.
 */

import { animate, hover, press } from "motion";

const prefersReduced = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Shared spring — a little weight, used for UI affordances. */
const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.7 } as const;

/** Per-item delay inside a revealed group, in ms. */
const STAGGER_MS = 55;

const REVEAL_SELECTOR = "[data-reveal]";
const GROUP_SELECTOR = "[data-reveal-group]";
const LIFT_SELECTOR = "[data-hover-lift]";
const AUTO_REVEAL_SELECTOR = ".section-head, .eyebrow";

/** Everything that should shrink a little under the finger. */
const PRESS_SELECTOR =
  ".btn-primary, .btn-secondary, .btn-accent, .btn, .chip, [data-save-btn]";

declare global {
  interface Window {
    __pgMotionFailsafe?: number;
  }
}

/* ------------------------------------------------------------------ *
 * entrances
 * ------------------------------------------------------------------ */

/**
 * True when the browser can drive the entrances itself with a CSS scroll
 * timeline (`animation-timeline: view()` in global.css).
 *
 * When it can, the entrances need no JavaScript at all: visibility cannot be
 * stranded by a slow module or an observer that never fires, and the reveal
 * tracks scroll position continuously rather than firing once. In that case
 * this module only wires the Motion gestures.
 */
const NATIVE_SCROLL_ANIM =
  typeof CSS !== "undefined" && CSS.supports("animation-timeline", "view()");

/**
 * Entrances still waiting to play, and the elements already played.
 *
 * Fallback path only, for engines without scroll-driven animations. Two
 * triggers cooperate rather than one, because layout is not final when scripts
 * run: images decode late, the pixel canvas sizes itself, fonts swap in, so an
 * element can be off screen at boot and on screen a moment later.
 *
 *   1. `settle()` re-checks for a short window after boot and reveals anything
 *      that has become visible.
 *   2. An IntersectionObserver covers the ordinary scroll-down case.
 *
 * Both funnel through `fire()`, and `played` keeps an entrance one-shot:
 * scrolling back up must not replay it.
 */
const pending = new Map<HTMLElement, () => void>();
const played = new WeakSet<HTMLElement>();

let observer: IntersectionObserver | null = null;

function isOnScreen(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
}

function fire(el: HTMLElement): void {
  if (played.has(el)) return;
  played.add(el);
  observer?.unobserve(el);
  const run = pending.get(el);
  pending.delete(el);
  run?.();
}

function ensureObserver(): IntersectionObserver {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          fire(entry.target as HTMLElement);
        }
      },
      { threshold: 0.12 }
    );
  }
  return observer;
}

function schedule(el: HTMLElement, run: () => void): void {
  if (played.has(el)) return;
  pending.set(el, run);
  // Visible right now: play immediately rather than wait for a frame.
  if (isOnScreen(el)) fire(el);
  else ensureObserver().observe(el);
}

/** The class global.css turns into the entrance animation. */
function reveal(el: HTMLElement, delayMs = 0): void {
  el.classList.add("is-revealed");
  if (delayMs) el.style.animationDelay = `${delayMs}ms`;
}

/**
 * Re-check pending entrances for a short window after boot.
 *
 * Bounded on purpose: a few seconds covers image decode and font swap, after
 * which the IntersectionObserver is the right trigger for the rest.
 */
function settle(): void {
  let frames = 0;
  const MAX_FRAMES = 180;
  const tick = () => {
    frames += 1;
    for (const el of Array.from(pending.keys())) {
      if (isOnScreen(el)) fire(el);
    }
    if (frames < MAX_FRAMES && pending.size > 0) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function bindReveal(el: HTMLElement): void {
  schedule(el, () => reveal(el));
}

function bindGroup(group: HTMLElement): void {
  schedule(group, () => {
    // Delay each child so the grid reads as a sequence; the class holds the
    // end state, so a delay cannot strand anything hidden.
    Array.from(group.children).forEach((child, index) => {
      if (child instanceof HTMLElement) reveal(child, index * STAGGER_MS);
    });
  });
}

/* ------------------------------------------------------------------ *
 * gestures (Motion)
 * ------------------------------------------------------------------ */

function bindLift(el: HTMLElement): void {
  hover(el, (target, started) => {
    animate(
      target,
      { transform: started ? "translateY(-3px)" : "translateY(0px)" },
      SPRING
    );
  });
  press(el, (target, started) => {
    animate(target, { scale: started ? 0.985 : 1 }, SPRING);
  });
}

function bindPress(el: HTMLElement): void {
  press(el, (target, started) => {
    animate(target, { scale: started ? 0.97 : 1 }, SPRING);
  });
}

/* ------------------------------------------------------------------ *
 * boot
 * ------------------------------------------------------------------ */

/** Bind once per element; the attribute is our "already wired" marker. */
function once(el: Element, key: string): boolean {
  const flag = `data-motion-${key}`;
  if (el.hasAttribute(flag)) return false;
  el.setAttribute(flag, "");
  return true;
}

function bindAll(root: ParentNode, selector: string, bind: (el: HTMLElement) => void) {
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (once(el, "bound")) continue;
    bind(el);
  }
}

/**
 * Wire every hook inside `root`. Safe to call more than once after a
 * navigation; each element is only ever wired once.
 */
export function initMotionUI(root: ParentNode = document): void {
  // Reduced motion: make sure nothing is left hidden behind the class.
  if (prefersReduced()) {
    document.documentElement.classList.remove("js-motion");
    if (window.__pgMotionFailsafe) clearTimeout(window.__pgMotionFailsafe);
    return;
  }

  // Native scroll-driven entrances: CSS owns them, so nothing to reveal and
  // nothing to hide.
  if (NATIVE_SCROLL_ANIM) {
    bindAll(root, LIFT_SELECTOR, bindLift);
    bindAll(root, PRESS_SELECTOR, bindPress);
    return;
  }

  // Motion is running, so the hidden initial state has somewhere to go.
  if (window.__pgMotionFailsafe) {
    clearTimeout(window.__pgMotionFailsafe);
    window.__pgMotionFailsafe = undefined;
  }

  bindAll(root, AUTO_REVEAL_SELECTOR, bindReveal);
  bindAll(root, REVEAL_SELECTOR, bindReveal);
  bindAll(root, GROUP_SELECTOR, bindGroup);
  bindAll(root, LIFT_SELECTOR, bindLift);
  bindAll(root, PRESS_SELECTOR, bindPress);

  settle();
}

/**
 * Run `fn` once the browser has laid the page out.
 *
 * Deliberately *not* `load`: that event waits for every image, and this site
 * pulls in a page of property photos, so waiting on it can leave entrances
 * un-triggered for many seconds. `DOMContentLoaded` plus two frames is enough
 * for layout, and anything that shifts later (images decoding, fonts swapping,
 * the pixel canvas sizing itself) is picked up by `settle()`.
 *
 * Deferred module scripts run before layout is guaranteed, and an
 * IntersectionObserver created at that point measures its targets as
 * zero-size — which is why both the entrances and the pixel canvases wait.
 */
export function afterFirstLayout(fn: () => void): void {
  const run = () => requestAnimationFrame(() => requestAnimationFrame(fn));
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}

/**
 * Wire the motion layer, deferred until layout is known. Call this instead of
 * `initMotionUI` from a page's boot script.
 */
export function bootMotionUI(): void {
  afterFirstLayout(() => {
    initMotionUI();
    // A client-side navigation has no `load` event, so re-bind on those too.
    document.addEventListener("astro:page-load", () =>
      afterFirstLayout(() => initMotionUI())
    );
  });
}