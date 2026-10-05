import type { APIContext } from 'astro';
import { getDb, json } from '@/lib/server/auth';
import {
  PUBLIC_LISTING_COLUMNS,
  fetchListingChildrenBatch,
  listingDto,
  type ListingRow,
} from '@/lib/server/listings';
import { mediaUrl } from '@/lib/server/media';

export const prerender = false;

/** Never let a caller ask for the whole table. */
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

const clampInt = (raw: string | null, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

/**
 * The minimum monthly rent a listing can actually be booked at.
 *
 * Rents live at the room level, so a budget filter has to look at the cheapest
 * room — but "starting from" must mean an *available* room: quoting the rent of
 * a full room type would advertise a price nobody can take. Falls back to every
 * room when the owner marked none as available, so the listing still shows a
 * price instead of vanishing from every band.
 *
 * Expressed as a correlated subquery so the filter runs inside SQLite and
 * therefore inside LIMIT/OFFSET — filtering after pagination would return short
 * or empty pages and an incorrect `total`.
 */
const MIN_RENT_SUBQUERY = `COALESCE(
  (SELECT MIN(r.rent) FROM listing_rooms r WHERE r.listing_id = ol.id AND r.available = 1),
  (SELECT MIN(r.rent) FROM listing_rooms r WHERE r.listing_id = ol.id)
)`;

/**
 * Public, published owner listings.
 *
 * Supports the search vocabulary of the demo results page:
 *   ?q=dtu&budget=under-10&roomType=double&gender=boys&sort=price-asc&limit=&offset=
 *
 * A listing is public only when it is BOTH approved and inside its plan window.
 * Expiry is enforced here, not in the UI: an expired listing stays in D1 for
 * the owner to renew, but must never appear in public results. Listings with no
 * window recorded (`expires_at IS NULL`) are treated as having no expiry rather
 * than being hidden, so legacy rows cannot vanish silently.
 */
export async function GET(context: APIContext) {
  const db = getDb();
  const params = new URL(context.request.url).searchParams;

  const q = (params.get('q') ?? '').trim().toLowerCase();
  const budget = params.get('budget') ?? '';
  const roomType = (params.get('roomType') ?? '').trim().toLowerCase();
  const gender = (params.get('gender') ?? '').trim().toLowerCase();
  const sort = params.get('sort') ?? 'recommended';
  const limit = clampInt(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(params.get('offset'), 0, 0, 100_000);

  // Batch lookup by id, used by the saved shortlist to resolve D1 listings it
  // already knows the ids of. Bounded like every other public read, and still
  // subject to the public-visibility conditions below, so it can never be used
  // to probe a draft or an expired listing.
  const ids = (params.get('ids') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_LIMIT);

  // Only fixed SQL fragments ever enter this list; every user value is bound.
  const conditions: string[] = [
    "ol.status = 'active'",
    "(ol.expires_at IS NULL OR ol.expires_at > ?)",
  ];
  const binds: (string | number)[] = [new Date().toISOString()];

  if (q) {
    conditions.push('(LOWER(ol.name) LIKE ? OR LOWER(ol.locality) LIKE ? OR LOWER(ol.address) LIKE ? OR LOWER(ol.city) LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }
  if (gender) {
    conditions.push('LOWER(ol.gender) = ?');
    binds.push(gender);
  }
  if (roomType) {
    conditions.push('EXISTS (SELECT 1 FROM listing_rooms r WHERE r.listing_id = ol.id AND LOWER(r.room_type) = ?)');
    binds.push(roomType);
  }
  if (ids.length) {
    conditions.push(`ol.id IN (${ids.map(() => '?').join(', ')})`);
    binds.push(...ids);
  }
  if (budget) {
    const budgetSql: Record<string, string> = {
      'under-10': `${MIN_RENT_SUBQUERY} < ?`,
      '10-15': `${MIN_RENT_SUBQUERY} BETWEEN ? AND ?`,
      '15-20': `${MIN_RENT_SUBQUERY} > ? AND ${MIN_RENT_SUBQUERY} <= ?`,
      '20-plus': `${MIN_RENT_SUBQUERY} > ?`,
    };
    const clause = budgetSql[budget];
    if (clause) {
      conditions.push(clause);
      if (budget === 'under-10') binds.push(10_000);
      else if (budget === '10-15') binds.push(10_000, 15_000);
      else if (budget === '15-20') binds.push(15_000, 20_000);
      else binds.push(20_000);
    }
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const orderBy =
    sort === 'price-asc' || sort === 'price-desc'
      ? `ORDER BY ${MIN_RENT_SUBQUERY} ${sort === 'price-asc' ? 'ASC' : 'DESC'}, ol.updated_at DESC`
      : 'ORDER BY ol.updated_at DESC';

  // An `ids` lookup must not be truncated by the default page size, so the
  // window is widened to the number of ids requested (already capped).
  const effectiveLimit = ids.length ? Math.max(1, Math.min(ids.length, MAX_LIMIT)) : limit;

  const [rowsRes, totalRes] = await Promise.all([
    db
      .prepare(
        `SELECT ${PUBLIC_LISTING_COLUMNS} FROM owner_listings ol ${where} ${orderBy} LIMIT ? OFFSET ?`
      )
      .bind(...binds, effectiveLimit, offset)
      .all<ListingRow>(),
    db
      .prepare(`SELECT COUNT(*) AS c FROM owner_listings ol ${where}`)
      .bind(...binds)
      .first<{ c: number }>(),
  ]);

  const rows = rowsRes.results;
  const { rooms, media } = await fetchListingChildrenBatch(
    db,
    rows.map((row) => row.id)
  );

  const listings = rows.map((row) => {
    const dto = listingDto(row, rooms.get(row.id) ?? [], media.get(row.id) ?? [], mediaUrl);
    // Same rule as MIN_RENT_SUBQUERY: available rooms first, all rooms as the
    // fallback. The two must agree or a card's price would contradict the
    // budget chip that selected it.
    const available = dto.rooms.filter((r) => r.available).map((r) => r.rent);
    const all = dto.rooms.map((r) => r.rent);
    const rents = available.length ? available : all;
    return { ...dto, minRent: rents.length ? Math.min(...rents) : null };
  });

  const total = totalRes?.c ?? listings.length;

  return json({
    count: listings.length,
    total,
    limit: effectiveLimit,
    offset,
    hasMore: offset + listings.length < total,
    listings,
  });
}
