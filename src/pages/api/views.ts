import type { APIContext } from 'astro';
import { currentUser, getDb, json, readBody } from '@/lib/server/auth';
import { isValidListingId, recordView, getEngagementStats } from '@/lib/server/engagement';

export const prerender = false;

/** POST /api/views { listingId, anonId? } — records a VIEW with 5-min dedup, anonymous allowed. */
export async function POST(context: APIContext) {
  const body = await readBody(context);
  const listingId = String(body?.listingId ?? body?.listing_id ?? body?.propertyId ?? '').trim();
  const anonIdRaw = String(body?.anonId ?? body?.sessionId ?? '').trim();
  const anonId = anonIdRaw && /^[a-zA-Z0-9_-]{8,64}$/.test(anonIdRaw) ? anonIdRaw : null;

  if (!isValidListingId(listingId)) return json({ error: 'Missing or invalid listingId.' }, 400);

  const user = await currentUser(context);
  const userId = user?.id ?? null;
  const sessionId = userId ? null : anonId;

  const db = getDb();
  const counted = await recordView(db, listingId, userId, sessionId);
  const stats = await getEngagementStats(db, listingId, userId);
  return json({ counted, views: stats.views });
}

/** GET /api/views?listingId=... — convenience: returns views count (no mutation). */
export async function GET(context: APIContext) {
  const url = new URL(context.request.url);
  const listingId = String(url.searchParams.get('listingId') ?? url.searchParams.get('listing_id') ?? '').trim();
  if (!isValidListingId(listingId)) return json({ error: 'Missing listingId.' }, 400);
  const user = await currentUser(context);
  const stats = await getEngagementStats(getDb(), listingId, user?.id ?? null);
  return json({ views: stats.views });
}
