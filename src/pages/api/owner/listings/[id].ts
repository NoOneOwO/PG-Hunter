import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAuth } from '@/lib/server/auth';
import { fetchListing, listingDto, type MediaRow } from '@/lib/server/listings';
import { deleteObject, mediaUrl } from '@/lib/server/media';
import { ensurePlanWindow } from '@/lib/server/listingPlans';

export const prerender = false;

/**
 * Fields that decide what was actually verified.
 *
 * A physical-visit verification attests to a specific property at a specific
 * address with specific rooms at specific rents. Changing any of those makes
 * the existing attestation false, so an edited listing goes back through
 * moderation and the badge is withdrawn until it is re-established.
 *
 * Deliberately NOT in this list: description, amenities, curfew, food and the
 * listing's name. Those are presentation, and re-queueing a live listing for
 * review because someone fixed a typo would punish the owner for improving
 * their own listing.
 */
const VERIFICATION_SENSITIVE_FIELDS = [
  ['address', 'address'],
  ['locality', 'locality'],
  ['city', 'city'],
  ['latitude', 'latitude'],
  ['longitude', 'longitude'],
] as const;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.trim() : fallback);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * The listing must exist, and the caller must own it or be an admin.
 *
 * `forEdit` is about *other owners*: no owner may touch a listing that is not
 * theirs. Admins are deliberately allowed through — at launch the team fills
 * in owners' PG pages from the admin panel, so an admin edit is a supported
 * flow, not an escalation. Writes still land on the owner's row (`owner_id`
 * never changes), which is what keeps enquiries, verification and the public
 * page on the owner's account.
 */
const ownedListing = async (context: APIContext, forEdit = false) => {
  const auth = await requireAuth(context);
  if ('error' in auth) return { error: auth.error, listing: null };
  const user = auth.user;

  const db = getDb();
  const id = context.params.id ?? '';
  const row = await db
    .prepare('SELECT * FROM owner_listings WHERE id = ?')
    .bind(id)
    .first<{ id: string; owner_id: string }>();
  if (!row) return { error: json({ error: 'Listing not found.' }, 404), listing: null };
  if (row.owner_id !== user.id && !user.is_admin) {
    return { error: json({ error: 'Not your listing.' }, 403), listing: null };
  }
  if (forEdit && row.owner_id !== user.id && !user.is_admin) {
    return { error: json({ error: 'Only the owner can edit this listing.' }, 403), listing: null };
  }
  return { error: null, listing: { id, user } as { id: string; user: typeof user } };
};

export async function GET(context: APIContext) {
  const result = await ownedListing(context);
  if (result.error) return result.error;
  const full = await fetchListing(getDb(), result.listing!.id);
  if (!full) return json({ error: 'Listing not found.' }, 404);
  return json({ listing: listingDto(full.row, full.rooms, full.media, mediaUrl) });
}

export async function PUT(context: APIContext) {
  const result = await ownedListing(context, true);
  if (result.error) return result.error;

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const name = str(body.name);
  const rooms = Array.isArray(body.rooms) ? body.rooms : [];
  if (!name) return json({ error: 'Please enter a name for the PG.' }, 400);
  if (rooms.length === 0) return json({ error: 'Add at least one room with rent.' }, 400);

  const parsedRooms = rooms.map((r: any) => ({
    roomType: str(r?.roomType, 'double'),
    occupancy: str(r?.occupancy, 'Sharing'),
    rent: typeof r?.rent === 'number' ? r.rent : NaN,
    deposit: typeof r?.deposit === 'number' ? r.deposit : 0,
    available: r?.available === undefined ? 1 : r.available ? 1 : 0,
  }));
  if (parsedRooms.some((r: { rent: number }) => !Number.isFinite(r.rent) || r.rent < 0)) {
    return json({ error: 'Each room needs a valid monthly rent.' }, 400);
  }

  const db = getDb();
  const id = result.listing!.id;
  const now = nowIso();

  // What the listing looked like before this edit decides both whether it stays
  // published and whether the existing verification still holds.
  const before = await db
    .prepare('SELECT status, verification_status, address, locality, city, latitude, longitude FROM owner_listings WHERE id = ?')
    .bind(id)
    .first<{
      status: string;
      verification_status: string;
      address: string;
      locality: string;
      city: string;
      latitude: number | null;
      longitude: number | null;
    }>();
  if (!before) return json({ error: 'Listing not found.' }, 404);

  const nextValues: Record<string, string | number | null> = {
    address: str(body.address),
    locality: str(body.locality),
    city: str(body.city, 'Delhi'),
    latitude: num(body.latitude),
    longitude: num(body.longitude),
  };

  const changedSensitive = VERIFICATION_SENSITIVE_FIELDS.filter(
    ([key]) => {
      const previous = (before as unknown as Record<string, unknown>)[key];
      const next = nextValues[key];
      // Loose comparison on purpose: SQLite stores latitude as REAL, and null
      // must match null rather than "NaN" or "0".
      return (previous ?? null) !== (next ?? null);
    }
  ).map(([key]) => key);

  const markedVerified = before.verification_status !== 'unverified';
  const verificationWasInvalidated = markedVerified && changedSensitive.length > 0;

  /**
   * Publication state after an edit.
   *
   *   draft   -> stays draft (never auto-submits)
   *   rejected-> back to draft so the owner can act on the rejection and
   *              resubmit deliberately
   *   pending -> stays pending
   *   active  -> STAYS ACTIVE. The previous code forced 'draft' here, which
   *              silently unpublished a live, approved listing on any edit.
   *              If a verification-sensitive field changed we still keep it
   *              published but drop the badge and re-queue it for review, so
   *              nothing untruthful is displayed in the meantime.
   */
  const nextStatus = verificationWasInvalidated
    ? 'pending'
    : before.status === 'rejected'
      ? 'draft'
      : before.status;

  await db
    .prepare(
      `UPDATE owner_listings SET
        name = ?, property_type = ?, gender = ?, address = ?, locality = ?, city = ?,
        latitude = ?, longitude = ?, description = ?, rules = ?, curfew = ?, food = ?,
        amenity_slugs = ?, status = ?, rejection_reason = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      name,
      str(body.propertyType, 'pg'),
      str(body.gender, 'co-ed'),
      nextValues.address,
      nextValues.locality,
      nextValues.city,
      nextValues.latitude,
      nextValues.longitude,
      str(body.description),
      JSON.stringify(strArr(body.rules)),
      str(body.curfew) || null,
      JSON.stringify(
        body.food && typeof body.food === 'object'
          ? {
              available: Boolean(body.food.available),
              type: str(body.food.type) || undefined,
              monthlyCost: typeof body.food.monthlyCost === 'number' ? body.food.monthlyCost : undefined,
            }
          : { available: false }
      ),
      JSON.stringify(strArr(body.amenitySlugs)),
      nextStatus,
      // Editing always clears the old rejection reason: the owner has acted on
      // it, and the listing is no longer sitting in a rejected state.
      null,
      now,
      id
    )
    .run();

  if (verificationWasInvalidated) {
    // Withdraw the claim, keeping the reason visible to the owner. The old
    // ledger row is left intact and its revocation is recorded when the next
    // grant supersedes it — this only clears the read cache so no stale badge
    // renders on a listing whose details changed under it.
    await db
      .prepare(
        `UPDATE owner_listings
            SET verification_status = 'unverified',
                verified_at = NULL,
                verified_by = NULL,
                verification_method = NULL,
                verification_evidence = NULL,
                verification_expires_at = NULL
          WHERE id = ?`
      )
      .bind(id)
      .run();
  }

  if (nextStatus === 'active') {
    // Preserve the existing window; an edit must not silently extend it.
    await ensurePlanWindow(db, { listingId: id, plan: 'basic', renew: false });
  }

  await db.prepare('DELETE FROM listing_rooms WHERE listing_id = ?').bind(id).run();
  for (const r of parsedRooms) {
    await db
      .prepare(
        'INSERT INTO listing_rooms (listing_id, room_type, occupancy, rent, deposit, available) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(id, r.roomType, r.occupancy, r.rent, r.deposit, r.available)
      .run();
  }

  const full = await fetchListing(db, id);
  if (!full) return json({ error: 'Could not update the listing.' }, 500);
  return json({ listing: listingDto(full.row, full.rooms, full.media, mediaUrl) });
}

export async function DELETE(context: APIContext) {
  const result = await ownedListing(context, true);
  if (result.error) return result.error;

  const db = getDb();
  const id = result.listing!.id;

  // Remove R2 objects before the media rows cascade away.
  const mediaRes = await db
    .prepare("SELECT external_id FROM media WHERE listing_id = ? AND provider = 'r2'")
    .bind(id)
    .all<MediaRow>();
  await Promise.all(mediaRes.results.map((m) => deleteObject(m.external_id)));

  await db.prepare('DELETE FROM owner_listings WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
