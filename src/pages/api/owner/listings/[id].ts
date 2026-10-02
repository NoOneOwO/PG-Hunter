import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAuth } from '@/lib/server/auth';
import { fetchListing, listingDto, type MediaRow } from '@/lib/server/listings';
import { deleteObject, mediaUrl } from '@/lib/server/media';

export const prerender = false;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.trim() : fallback);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** The listing must exist and the caller must own it (admins may view). */
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
  if (forEdit && row.owner_id !== user.id) {
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

  await db
    .prepare(
      `UPDATE owner_listings SET
        name = ?, property_type = ?, gender = ?, address = ?, locality = ?, city = ?,
        latitude = ?, longitude = ?, description = ?, rules = ?, curfew = ?, food = ?,
        amenity_slugs = ?, status = 'draft', rejection_reason = NULL, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      name,
      str(body.propertyType, 'pg'),
      str(body.gender, 'co-ed'),
      str(body.address),
      str(body.locality),
      str(body.city, 'Delhi'),
      num(body.latitude),
      num(body.longitude),
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
      now,
      id
    )
    .run();

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
