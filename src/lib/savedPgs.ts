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
import { propertyBySlug, coverImage, startingRent } from '@/data/properties';
import { collegeById, localityById } from '@/data/colleges';
import { formatINR, formatDistance } from '@/lib/format';
import { amenityBySlug } from '@/data/amenities';

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
  const p = propertyBySlug(propertyId);
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
    .map((label) => `<span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">${label}</span>`)
    .join(' ');

  return `
<article class="card group relative flex flex-col overflow-hidden shadow-card transition-shadow hover:shadow-card-hover">
  <a href="/pgs/${p.slug}" class="relative block aspect-[4/3] overflow-hidden bg-slate-100" tabindex="-1" aria-hidden="true">
    <img src="${image?.externalId}" alt="${p.name}" loading="lazy" decoding="async"
      class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" width="800" height="600" />
    <span class="absolute left-3 top-3 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${verificationClass(p.verificationStatus)}">
      ${verificationLabel(p.verificationStatus)}
    </span>
  </a>
  <div class="flex flex-1 flex-col gap-2 p-4">
    <div class="flex items-start justify-between gap-2">
      <h3 class="text-base font-bold leading-snug text-slate-900">
        <a href="/pgs/${p.slug}" class="after:absolute after:inset-0">${p.name}</a>
      </h3>
      ${opts?.removable
        ? `<button type="button" data-remove-saved="${p.id}"
            class="relative z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
            aria-label="Remove ${p.name} from saved" title="Remove from saved">✕</button>`
        : ''}
    </div>
    <p class="text-xs font-medium text-slate-500">
      ${locality?.name ?? ''}${college ? ` · ${formatDistance(distance!.distanceMeters)} from ${college.shortName}` : ''}
    </p>
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span class="text-xl font-extrabold text-brand-700">${formatINR(rent)}</span>
      <span class="text-xs font-medium text-slate-500">/month starting from</span>
    </div>
    <p class="text-sm font-semibold text-slate-700">${roomSummary}</p>
    <div class="flex flex-wrap gap-1.5">${amenities}</div>
    <div class="mt-auto pt-3">
      <a href="/pgs/${p.slug}" class="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand-50 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100">
        View Details
      </a>
    </div>
  </div>
</article>`;
};

/** Render a grid of saved property cards into a container element. */
export const renderSavedGrid = (
  container: HTMLElement,
  propertyIds: string[],
  opts?: { removable?: boolean }
): number => {
  const valid = propertyIds.map((id) => propertyBySlug(id)).filter((p): p is Property => Boolean(p));
  container.innerHTML = valid
    .map((p) => savedCardHtml(p.id, opts))
    .join('');
  return valid.length;
};
