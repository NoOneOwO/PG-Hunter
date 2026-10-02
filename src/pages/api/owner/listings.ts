import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAuth } from '@/lib/server/auth';
import { fetchListing, listingDto, type ListingRow } from '@/lib/server/listings';
import { mediaUrl } from '@/lib/server/media';

export const prerender = false;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.trim() : fallback);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const idArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()))]
    : [];

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

export async function POST(context: APIContext) {
  const denied = await asOwner(context);
  if (denied) return denied;

  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const name = str(body.name);
  const rooms = Array.isArray(body.rooms) ? body.rooms : [];

  if (!name) return json({ error: 'Please enter a name for the PG.' }, 400);
  if (rooms.length === 0) return json({ error: 'Add at least one room with rent.' }, 400);

  const parsedRooms = rooms.map((r: any) => {
    const rent = typeof r?.rent === 'number' ? r.rent : NaN;
    return {
      roomType: str(r?.roomType, 'double'),
      occupancy: str(r?.occupancy, 'Sharing'),
      rent,
      deposit: typeof r?.deposit === 'number' ? r.deposit : 0,
      available: r?.available === undefined ? 1 : r.available ? 1 : 0,
    };
  });
  if (parsedRooms.some((r: { rent: number }) => !Number.isFinite(r.rent) || r.rent < 0)) {
    return json({ error: 'Each room needs a valid monthly rent.' }, 400);
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();

  await db
    .prepare(
      `INSERT INTO owner_listings
        (id, owner_id, name, property_type, gender, address, locality, city, latitude, longitude,
         description, rules, curfew, food, amenity_slugs, status, verification_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      auth.user.id,
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
      'draft',
      'unverified',
      now,
      now
    )
    .run();

  for (const r of parsedRooms) {
    await db
      .prepare(
        'INSERT INTO listing_rooms (listing_id, room_type, occupancy, rent, deposit, available) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(id, r.roomType, r.occupancy, r.rent, r.deposit, r.available)
      .run();
  }

  const pendingMediaIds = idArr(body.pendingMediaIds);
  for (let i = 0; i < pendingMediaIds.length; i++) {
    await db
      .prepare(
        `UPDATE media
         SET listing_id = ?, sort_order = ?
         WHERE id = ? AND uploaded_by = ? AND listing_id IS NULL AND type = 'photo'`
      )
      .bind(id, i, pendingMediaIds[i], auth.user.id)
      .run();
  }

  const full = await fetchListing(db, id);
  if (!full) return json({ error: 'Could not create the listing.' }, 500);
  return json({ listing: listingDto(full.row, full.rooms, full.media, mediaUrl) }, 201);
}
