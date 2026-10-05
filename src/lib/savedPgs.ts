/**
 * Client-side rendering helpers for saved-PG lists.
 *
 * Saved PGs are stored per-user in the Cloudflare Worker API (see
 * src/lib/auth.ts), so they can only be rendered in the browser after
 * fetching the user's saved ids. These helpers build the same card markup
 * the server-rendered PropertyCard component produces, minus interactivity,
 * so the Saved and Profile pages look consistent.
 */

import type { Property } from '@/data/types';
import { properties, propertyBySlug, coverImage, startingRent } from '@/data/properties';
import { collegeById, localityById } from '@/data/colleges';
import { formatINR, formatDistance } from '@/lib/format';
import { amenityBySlug } from '@/data/amenities';
import { escapeAttr, escapeHtml, safeImageSrc } from '@/lib/html';

/**
 * Resolve a saved property reference back to its record.
 *
 * `saved_pgs.property_id` is written from `data-property-id` on PropertyCard,
 * which is `Property.id` ('prop_sunrise_rohini'), NOT the slug. Resolving only
 * by slug meant every saved id failed to match and both /saved and /profile
 * silently rendered an empty shortlist. Accept either form so historical rows
 * and any slug-based caller both resolve.
 */
const propertyBySavedRef = (ref: string): Property | undefined =>
  properties.find((p) => p.id === ref) ?? propertyBySlug(ref);

const verificationLabel = (status: Property['verificationStatus']): string => {
  switch (status) {
    case 'rishabh_irl_verified':
      return 'Rishabh IRL Verified';
    case 'pg_hunter_verified':
      return 'PG Hunter Verified';
    default:
      return 'Listed';
  }
};

const verificationClass = (status: Property['verificationStatus']): string => {
  switch (status) {
    case 'rishabh_irl_verified':
      return 'bg-emerald-100 text-emerald-800';
    case 'pg_hunter_verified':
      return 'bg-brand-100 text-brand-800';
    default:
      return 'bg-white/90 text-slate-700';
  }
};

export const savedCardHtml = (propertyId: string, opts?: { removable?: boolean }): string => {
  const p = propertyBySavedRef(propertyId);
  if (!p) return '';

  const image = coverImage(p);
  const rent = startingRent(p);
  const locality = localityById(p.localityId);
  const distance = p.collegeDistances[0];
  const college = distance ? collegeById(distance.collegeId) : undefined;
  const roomSummary = [...new Set(p.rooms.map((r) => r.occupancy))].join(' · ');
  const amenities = p.amenitySlugs
    .map((slug) => amenityBySlug(slug)?.label ?? slug)
    .slice(0, 3)
    .map((label) => `<span class="bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">${escapeHtml(label)}</span>`)
    .join(' ');

  return `
<article class="card card-hover group relative flex flex-col overflow-hidden">
  <a href="/pgs/${encodeURIComponent(p.slug)}" class="relative block aspect-[4/3] overflow-hidden bg-slate-100" tabindex="-1" aria-hidden="true">
    <img src="${escapeAttr(safeImageSrc(image?.externalId) ?? '')}" alt="${escapeAttr(p.name)}" loading="lazy" decoding="async"
      class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" width="800" height="600" />
    <span class="absolute left-3 top-3 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${verificationClass(p.verificationStatus)}">
      ${escapeHtml(verificationLabel(p.verificationStatus))}
    </span>
  </a>
  <div class="flex flex-1 flex-col gap-2 p-4">
    <div class="flex items-start justify-between gap-2">
      <h3 class="text-base font-bold leading-snug text-slate-900">
        <a href="/pgs/${encodeURIComponent(p.slug)}" class="after:absolute after:inset-0">${escapeHtml(p.name)}</a>
      </h3>
      ${opts?.removable
        ? `<button type="button" data-remove-saved="${escapeAttr(p.id)}"
            class="relative z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
            aria-label="Remove ${escapeAttr(p.name)} from saved" title="Remove from saved">✕</button>`
        : ''}
    </div>
    <p class="text-xs font-medium text-slate-500">
      ${escapeHtml(locality?.name ?? '')}${college ? ` · ${escapeHtml(formatDistance(distance!.distanceMeters))} from ${escapeHtml(college.shortName)}` : ''}
    </p>
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span class="text-xl font-extrabold text-brand-700">${escapeHtml(formatINR(rent))}</span>
      <span class="text-xs font-medium text-slate-500">/month starting from</span>
    </div>
    <p class="text-sm font-semibold text-slate-700">${escapeHtml(roomSummary)}</p>
    <div class="flex flex-wrap gap-1.5">${amenities}</div>
    <div class="mt-auto pt-3">
      <a href="/pgs/${encodeURIComponent(p.slug)}" class="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-sm bg-brand-50 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100">
        View Details
      </a>
    </div>
  </div>
</article>`;
};

/**
 * Render a grid of saved cards into a container.
 *
 * A saved id can point at either world: a demo property (`prop_…`, resolved
 * from the bundled dataset) or a real D1 listing (resolved by the public
 * listings API). Demo cards render synchronously; live ids are fetched in one
 * batch call and appended as live cards. Returns the number rendered.
 */
export const renderSavedGrid = async (
  container: HTMLElement,
  propertyIds: string[],
  opts?: { removable?: boolean }
): Promise<number> => {
  const demo: Property[] = [];
  const liveIds: string[] = [];

  for (const id of propertyIds) {
    const property = propertyBySavedRef(id);
    if (property) demo.push(property);
    else if (id) liveIds.push(id);
  }

  container.innerHTML = demo.map((p) => savedCardHtml(p.id, opts)).join('');

  if (liveIds.length === 0) return demo.length;

  const { fetchLiveListings, renderLiveCards } = await import('@/lib/liveListings');
  const listings = await fetchLiveListings({ ids: liveIds, limit: liveIds.length });
  if (listings.length === 0) return demo.length;

  const holder = document.createElement('div');
  await renderLiveCards(holder, listings, opts);
  while (holder.firstElementChild) container.appendChild(holder.firstElementChild);

  // Re-bind entrances now that the cards are actually in the document.
  // `renderLiveCards` wires them while they still sit in this detached
  // holder, and a detached node has a zero rect — in the JS entrance path
  // (browsers without `animation-timeline: view()`) the observer would never
  // see them and the cards would stay at opacity 0. Calling again here lets
  // `settle()` pick up everything now that it is on screen.
  const { initMotionUI } = await import('@/lib/motion/ui');
  initMotionUI();

  return demo.length + listings.length;
};
