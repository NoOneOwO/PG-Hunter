/**
 * Client-side rendering helpers for saved-PG lists.
 *
 * Saved PGs are stored per-user in the Cloudflare Worker API (see
 * src/lib/auth.ts), so the shortlist can only be rendered in the browser after
 * fetching the user's saved ids.
 *
 * Every saved id names a real listing in D1, so the cards are produced by the
 * same `liveCardHtml` renderer as the browse pages — one card design, one
 * source of truth for listings.
 */

import { fetchLiveListings, renderLiveCards } from '@/lib/liveListings';

/**
 * Render a grid of saved listings into a container. Returns how many cards were
 * rendered.
 *
 * An id whose listing has since been unpublished, expired or deleted simply
 * resolves to nothing and is dropped — the caller compares the rendered count
 * against the saved count to tell "empty shortlist" from "shortlist of
 * listings that are no longer live".
 */
export const renderSavedGrid = async (
  container: HTMLElement,
  propertyIds: string[],
  opts?: { removable?: boolean }
): Promise<number> => {
  const ids = propertyIds.filter(Boolean);
  container.innerHTML = '';
  if (ids.length === 0) return 0;

  const listings = await fetchLiveListings({ ids, limit: ids.length });
  if (listings.length === 0) return 0;

  // Build in a holder, then move the nodes so the container's children are the
  // cards themselves rather than a nested wrapper the page's CSS would miss.
  const holder = document.createElement('div');
  await renderLiveCards(holder, listings, opts);
  while (holder.firstElementChild) container.appendChild(holder.firstElementChild);

  // Re-bind entrances now that the cards are actually in the document.
  // `renderLiveCards` wires them while they still sit in this detached holder,
  // and a detached node has a zero rect — in the JS entrance path (browsers
  // without `animation-timeline: view()`) the observer would never see them and
  // the cards would stay at opacity 0. Calling again here lets `settle()` pick
  // up everything now that it is on screen.
  const { initMotionUI } = await import('@/lib/motion/ui');
  initMotionUI();

  return listings.length;
};
