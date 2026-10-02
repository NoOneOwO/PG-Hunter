import type { APIContext } from 'astro';
import { currentUser, getDb, json, readBody } from '@/lib/server/auth';
import { createExperience, getApprovedExperiences, isValidListingId } from '@/lib/server/engagement';

export const prerender = false;

/** GET /api/experiences?listingId=... — public, only approved appear. */
export async function GET(context: APIContext) {
  const url = new URL(context.request.url);
  const listingId = String(url.searchParams.get('listingId') ?? url.searchParams.get('listing_id') ?? '').trim();
  if (!isValidListingId(listingId)) return json({ error: 'Missing listingId.' }, 400);
  const db = getDb();
  const { experiences, count, avgRating } = await getApprovedExperiences(db, listingId);
  return json({ experiences, count, avgRating });
}

/** POST /api/experiences { listingId, rating?: 1-5, content } — auth required, creates pending. */
export async function POST(context: APIContext) {
  const user = await currentUser(context);
  if (!user) return json({ error: 'Not logged in.' }, 401);

  const body = await readBody(context);
  const listingId = String(body?.listingId ?? body?.listing_id ?? body?.propertyId ?? '').trim();
  const content = String(body?.content ?? '').trim();
  const ratingRaw = body?.rating;

  if (!isValidListingId(listingId)) return json({ error: 'Missing or invalid listingId.' }, 400);
  if (content.length < 10) return json({ error: 'Experience must be at least 10 characters.' }, 400);
  if (content.length > 2000) return json({ error: 'Experience must be at most 2000 characters.' }, 400);

  let rating: number | null = null;
  if (ratingRaw !== undefined && ratingRaw !== null && String(ratingRaw).trim() !== '') {
    const r = Number(ratingRaw);
    if (!Number.isInteger(r) || r < 1 || r > 5) return json({ error: 'Rating must be an integer 1–5.' }, 400);
    rating = r;
  }

  const db = getDb();
  const exp = await createExperience(db, listingId, user, rating, content);
  return json({ experience: exp, message: 'Experience submitted for moderation.' }, 201);
}
