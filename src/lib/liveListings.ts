/**
 * PG Hunter — live D1 listings on the public site.
 *
 * The demo catalogue (src/data) is prerendered; real owner listings live in D1
 * and can change at any moment, so they are fetched from the public
 * `GET /api/listings` endpoint and rendered into the same card design on the
 * client. Both worlds share one page: on /pgs-near-you the live cards are
 * merged into the prerendered grid, and the home page shows them as a rail.
 *
 * Everything that reaches the markup goes through the escaping helpers in
 * lib/html — a listing name, locality and description are owner input.
 */

import type { Listing } from '@/lib/auth';
import { amenityBySlug } from '@/data/amenities';
import { escapeAttr, escapeHtml, safeImageSrc } from '@/lib/html';
import { formatINR } from '@/lib/format';

/** A public listing as the API returns it, plus the cheapest room's rent. */
export interface LiveListing extends Listing {
  minRent: number | null;
}

export interface LiveQuery {
  limit?: number;
  q?: string;
  sort?: string;
  gender?: string;
  budget?: string;
  roomType?: string;
  ids?: string[];
}

/** Fetch public listings; never throws — an empty list is a fine answer. */
export const fetchLiveListings = async (query: LiveQuery = {}): Promise<LiveListing[]> => {
  const search = new URLSearchParams();
  if (query.limit) search.set('limit', String(query.limit));
  if (query.q) search.set('q', query.q);
  if (query.sort) search.set('sort', query.sort);
  if (query.gender) search.set('gender', query.gender);
  if (query.budget) search.set('budget', query.budget);
  if (query.roomType) search.set('roomType', query.roomType);
  if (query.ids?.length) search.set('ids', query.ids.join(','));

  try {
    const res = await fetch(`/api/listings?${search.toString()}`, { credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = (await res.json()) as { listings?: LiveListing[] };
    return Array.isArray(data.listings) ? data.listings : [];
  } catch {
    return [];
  }
};

const verificationMeta = (status: Listing['verificationStatus']): { label: string; className: string } => {
  switch (status) {
    case 'rishabh_irl_verified':
      return { label: 'Rishabh IRL Verified', className: 'bg-emerald-100 text-emerald-800' };
    case 'pg_hunter_verified':
      return { label: 'PG Hunter Verified', className: 'bg-brand-100 text-brand-800' };
    default:
      return { label: 'Listed', className: 'bg-white/90 text-slate-700' };
  }
};

const coverOf = (listing: LiveListing): string | null => {
  const photo = listing.media.find((m) => m.type === 'photo' && (m.url || m.externalId));
  if (!photo) return null;
  return safeImageSrc(photo.url ?? photo.externalId);
};

const BOOKMARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`;

const roomSummary = (listing: LiveListing): string =>
  [...new Set(listing.rooms.map((room) => room.occupancy || room.roomType))].join(' · ');

/** One live listing as a card, matching PropertyCard's markup and classes. */
export const liveCardHtml = (listing: LiveListing, opts?: { removable?: boolean }): string => {
  const href = `/pgs/live/${encodeURIComponent(listing.id)}`;
  const image = coverOf(listing);
  const verification = verificationMeta(listing.verificationStatus);
  const rent = listing.minRent ?? (listing.rooms.length ? Math.min(...listing.rooms.map((r) => r.rent)) : null);
  const rooms = roomSummary(listing);
  const amenities = listing.amenitySlugs
    .slice(0, 3)
    .map((slug) => amenityBySlug(slug)?.label ?? slug)
    .map(
      (label) =>
        `<span class="bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">${escapeHtml(label)}</span>`
    )
    .join(' ');

  // The demo cards carry data-* attributes that the browse filters read; live
  // cards carry the same ones so one filter pass covers both worlds.
  const roomTypes = [...new Set(listing.rooms.map((room) => room.roomType))].join(' ');

  return `
<article class="card card-hover group relative flex flex-col overflow-hidden" data-property data-live-listing data-property-id="${escapeAttr(listing.id)}" data-reveal
  data-rent="${rent !== null ? escapeAttr(rent) : ''}"
  data-name="${escapeAttr(listing.name.toLowerCase())}"
  data-locality="${escapeAttr(`${listing.locality} ${listing.city}`.toLowerCase())}"
  data-colleges="${escapeAttr(listing.city.toLowerCase())}"
  data-college-names="${escapeAttr(listing.city.toLowerCase())}"
  data-roomtypes="${escapeAttr(roomTypes)}"
  data-gender="${escapeAttr(listing.gender)}"
  data-food="${listing.food?.available ? 'yes' : 'no'}"
  data-verified="${escapeAttr(listing.verificationStatus)}">
  <a href="${escapeAttr(href)}" class="relative block aspect-[4/3] overflow-hidden bg-slate-100" tabindex="-1" aria-hidden="true">
    ${
      image
        ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(listing.name)}" loading="lazy" decoding="async"
            class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" width="800" height="600" />`
        : `<span class="flex h-full w-full items-center justify-center bg-brand-50 text-sm text-brand-300">No photo yet</span>`
    }
    <span class="absolute left-3 top-3 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${verification.className}">
      ${escapeHtml(verification.label)}
    </span>
    <span class="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-sm bg-accent-400/95 px-2 text-[10px] font-extrabold uppercase tracking-wide text-slate-900" title="This listing is live on PG Hunter right now">
      Live
    </span>
  </a>
  <div class="flex flex-1 flex-col gap-2.5 p-4">
    <div class="flex items-start justify-between gap-2">
      <h3 class="text-base font-bold leading-snug text-slate-900">
        <a href="${escapeAttr(href)}" class="after:absolute after:inset-0">${escapeHtml(listing.name)}</a>
      </h3>
      ${
        opts?.removable
          ? `<button type="button" data-remove-saved="${escapeAttr(listing.id)}"
              class="relative z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
              aria-label="${escapeAttr(`Remove ${listing.name} from saved`)}" title="Remove from saved">✕</button>`
          : `<button type="button" data-save-btn data-property-id="${escapeAttr(listing.id)}"
              class="relative z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
              aria-label="${escapeAttr(`Save ${listing.name} to your shortlist`)}" aria-pressed="false" title="Save to shortlist">
              ${BOOKMARK_SVG}
            </button>`
      }
    </div>
    <p class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-medium text-slate-500">
      <span>${escapeHtml(listing.locality)}${listing.locality && listing.city ? ', ' : ''}${escapeHtml(listing.city)}</span>
      <span aria-hidden="true">·</span>
      <span>${escapeHtml(listing.gender === 'co-ed' ? 'Co-ed' : listing.gender === 'boys' ? 'Boys' : 'Girls')}</span>
    </p>
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span class="text-xl font-extrabold text-brand-700">${rent !== null ? escapeHtml(formatINR(rent)) : 'Ask owner'}</span>
      ${rent !== null ? '<span class="text-xs font-medium text-slate-500">/month starting from</span>' : ''}
    </div>
    ${rooms ? `<p class="text-sm font-semibold text-slate-700">${escapeHtml(rooms)}</p>` : ''}
    ${amenities ? `<div class="flex flex-wrap gap-1.5">${amenities}</div>` : ''}
    <div class="mt-auto flex items-center gap-3 border-t border-slate-200 pt-3">
      <a href="${escapeAttr(href)}" class="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-sm bg-brand-50 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100">
        View Details
      </a>
    </div>
  </div>
</article>`;
};

/** Replace a container's contents with live cards; returns how many rendered. */
export const renderLiveCards = async (
  container: HTMLElement,
  listings: LiveListing[],
  opts?: { removable?: boolean }
): Promise<number> => {
  container.innerHTML = listings.map((listing) => liveCardHtml(listing, opts)).join('');
  // Cards injected after page load need their entrances wired now.
  if (listings.length > 0) {
    const { initMotionUI } = await import('@/lib/motion/ui');
    initMotionUI();
  }
  return listings.length;
};

/**
 * Wire save buttons added after page load.
 *
 * PropertyCard's own script binds every `[data-save-btn]` present when it runs,
 * which is before these cards exist. Marking each button keeps the two binders
 * from double-binding the same element if the order ever changes.
 */
export const wireLiveSaveButtons = async (root: ParentNode = document): Promise<void> => {
  const { getCurrentSession, isSaved, toggleSaved } = await import('@/lib/auth');
  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-save-btn]:not([data-save-wired])')
  );

  for (const btn of buttons) {
    btn.dataset.saveWired = '1';
    const propertyId = btn.dataset.propertyId ?? '';
    if (!propertyId) continue;

    const setState = (saved: boolean) => {
      const svg = btn.querySelector('svg');
      btn.classList.toggle('text-brand-600', saved);
      btn.setAttribute('aria-pressed', String(saved));
      btn.setAttribute('aria-label', saved ? 'Remove from shortlist' : 'Save to shortlist');
      btn.title = saved ? 'Remove from shortlist' : 'Save to shortlist';
      if (svg) svg.style.fill = saved ? 'currentColor' : 'none';
    };

    setState(await isSaved(propertyId));

    btn.addEventListener('click', async () => {
      const session = await getCurrentSession();
      if (!session) {
        const here = window.location.pathname + window.location.search;
        window.location.href = `/login?next=${encodeURIComponent(here)}`;
        return;
      }
      const { saved, error } = await toggleSaved(propertyId);
      if (!error) {
        setState(saved);
        window.dispatchEvent(new CustomEvent('pghunter:saved', { detail: { propertyId, saved } }));
      }
    });
  }
};
