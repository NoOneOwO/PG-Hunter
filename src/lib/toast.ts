/**
 * PG Hunter — vanilla toast for the Astro-rendered dashboards.
 *
 * The React islands use sonner (see ProfileApp), but the owner and admin pages
 * are plain .astro with small client scripts; mounting a React island just for
 * toasts would cost more than the animation is worth. This is the same idea in
 * ~80 lines: one fixed container, one element per toast, entered and removed
 * with Motion so the timing matches the rest of the site.
 *
 *   import { toast } from '@/lib/toast';
 *   toast.success('Listing approved');
 *   toast.error('Could not save', 'Try again in a moment.');
 */

import { animate } from 'motion';

export type ToastTone = 'success' | 'error' | 'info';

const TONES: Record<ToastTone, { border: string; icon: string; glyph: string }> = {
  success: { border: 'border-emerald-200', icon: 'text-emerald-600', glyph: '✓' },
  error: { border: 'border-rose-200', icon: 'text-rose-600', glyph: '!' },
  info: { border: 'border-slate-200', icon: 'text-brand-600', glyph: 'i' },
};

const container = (): HTMLElement => {
  let host = document.getElementById('pg-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pg-toasts';
    host.className =
      'pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  return host;
};

const show = (tone: ToastTone, message: string, description?: string): void => {
  const host = container();
  const meta = TONES[tone];

  const el = document.createElement('div');
  el.className = `pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-none border ${meta.border} bg-white px-4 py-3 shadow-popover`;

  const icon = document.createElement('span');
  icon.className = `mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${meta.border} text-[11px] font-bold ${meta.icon}`;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = meta.glyph;

  const body = document.createElement('span');
  body.className = 'min-w-0 flex-1';

  const title = document.createElement('span');
  title.className = 'block text-sm font-semibold text-slate-900';
  title.textContent = message;
  body.appendChild(title);

  if (description) {
    const desc = document.createElement('span');
    desc.className = 'mt-0.5 block text-xs text-slate-500';
    desc.textContent = description;
    body.appendChild(desc);
  }

  el.append(icon, body);
  host.appendChild(el);

  animate(el, { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0)'] }, { duration: 0.18 });

  window.setTimeout(() => {
    animate(el, { opacity: 0, transform: 'translateY(6px)' }, { duration: 0.16 }).finished.then(() => {
      el.remove();
    });
  }, tone === 'error' ? 6000 : 3500);
};

export const toast = {
  success: (message: string, description?: string) => show('success', message, description),
  error: (message: string, description?: string) => show('error', message, description),
  info: (message: string, description?: string) => show('info', message, description),
};
