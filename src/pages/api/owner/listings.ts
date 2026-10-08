import type { APIContext } from 'astro';
import { getDb, json, readBody, requireAuth } from '@/lib/server/auth';
import { fetchListing, listingDto, type ListingRow } from '@/lib/server/listings';
import { mediaUrl } from '@/lib/server/media';
import { parseListingPayload } from '@/lib/server/listingInput';
import { insertListing } from '@/lib/server/listingWrite';

export const prerender = false;

const asOwner = async (context: APIContext) => {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;
  if (auth.user.role !== 'owner' && !auth.user.is_admin) {
    return json({ error: 'Owner access required.' }, 403);
  }
  return null;
};

export async function GET(context: APIContext) {
  const denied = await asOwner(context);
  if (denied) return denied;

  const db = getDb();
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;
  const user = auth.user;

  const rows = await db
    .prepare('SELECT * FROM owner_listings WHERE owner_id = ? ORDER BY updated_at DESC')
    .bind(user.id)
    .all<ListingRow>();

  const listings = await Promise.all(
    rows.results.map(async (row) => {
      const full = await fetchListing(db, row.id);
      return full ? listingDto(full.row, full.rooms, full.media, mediaUrl) : null;
    })
  );
  return json({ listings: listings.filter(Boolean) });
}

/**
 * Create a listing owned by the caller.
 *
 * The row-building lives in lib/server/listingWrite.ts because the admin panel
 * creates listings with exactly the same shape (only `owner_id` differs).
 */
export async function POST(context: APIContext) {
  const denied = await asOwner(context);
  if (denied) return denied;

  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const parsed = parseListingPayload(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const listing = await insertListing(getDb(), {
    ownerId: auth.user.id,
    actorId: auth.user.id,
    listing: parsed.value,
    adminManaged: false,
  });
  if (!listing) return json({ error: 'Could not create the listing.' }, 500);
  return json({ listing }, 201);
}
