/**
 * PG Hunter — count-up for server-rendered numbers.
 *
 * The dashboards render real figures on the server (no spinner, no fake zero),
 * so the animation has to start from the final value and read as motion rather
 * than as data arriving. Elements opt in with `data-count-up="123"`; the text
 * content stays the real number when Motion is unavailable or the user prefers
 * reduced motion.
 */

import { animate } from 'motion';

const prefersReduced = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const initCountUps = (root: ParentNode = document): void => {
  for (const el of root.querySelectorAll<HTMLElement>('[data-count-up]')) {
    if (el.dataset.counted) continue;
    el.dataset.counted = '1';

    const target = Number(el.dataset.countUp ?? '');
    if (!Number.isFinite(target) || target === 0 || prefersReduced()) {
      el.textContent = Number.isFinite(target) ? String(target) : el.textContent;
      continue;
    }

    animate(0, target, {
      duration: 0.9,
      ease: 'easeOut',
      onUpdate: (value: number) => {
        el.textContent = String(Math.round(value));
      },
    });
  }
};
