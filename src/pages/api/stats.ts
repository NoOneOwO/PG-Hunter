import type { APIContext } from 'astro';
import { currentUser, getDb, json } from '@/lib/server/auth';
import { getEngagementStats, isValidListingId } from '@/lib/server/engagement';

export const prerender = false;

/** GET /api/stats?listingId=... — returns views/saves/likes/dislikes + user state. */
export async function GET(context: APIContext) {
  const url = new URL(context.request.url);
  const listingId = String(url.searchParams.get('listingId') ?? url.searchParams.get('listing_id') ?? '').trim();
  if (!isValidListingId(listingId)) return json({ error: 'Missing listingId.' }, 400);
  const user = await currentUser(context);
  const stats = await getEngagementStats(getDb(), listingId, user?.id ?? null);
  return json(stats);
}
