import type { APIContext } from 'astro';
import { getDb, json } from '@/lib/server/auth';
import { fetchListing, listingDto, type ListingRow } from '@/lib/server/listings';
import { mediaUrl } from '@/lib/server/media';

export const prerender = false;

/**
 * Public, published (status = active) owner listings.
 * Supports the same search/filter/sort vocabulary as the demo results page:
 *   ?q=dtu&budget=under-10&roomType=double&gender=boys&sort=price-asc
 * Rent filters apply to the cheapest room in the listing.
 */
export async function GET(context: APIContext) {
  const db = getDb();
  const params = new URL(context.request.url).searchParams;
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const budget = params.get('budget') ?? '';
  const roomType = (params.get('roomType') ?? '').trim().toLowerCase();
  const gender = (params.get('gender') ?? '').trim().toLowerCase();
  const sort = params.get('sort') ?? 'recommended';

  const rowsRes = await db
    .prepare("SELECT * FROM owner_listings WHERE status = 'active' ORDER BY updated_at DESC")
    .all<ListingRow>();

  const listings = [];
  for (const row of rowsRes.results) {
    const full = await fetchListing(db, row.id);
    if (!full) continue;
    const dto = listingDto(full.row, full.rooms, full.media, mediaUrl);

    const minRent = Math.min(...dto.rooms.map((r) => r.rent), Number.POSITIVE_INFINITY);

    if (q) {
      const hay = [dto.name, dto.locality, dto.address, dto.city].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    if (budget) {
      const inBudget =
        budget === 'under-10'
          ? minRent < 10000
          : budget === '10-15'
            ? minRent >= 10000 && minRent <= 15000
            : budget === '15-20'
              ? minRent > 15000 && minRent <= 20000
              : budget === '20-plus'
                ? minRent > 20000
                : true;
      if (!inBudget) continue;
    }
    if (roomType && !dto.rooms.some((r) => r.roomType === roomType)) continue;
    if (gender && dto.gender !== gender) continue;

    listings.push({ ...dto, minRent });
  }

  if (sort === 'price-asc') listings.sort((a, b) => a.minRent - b.minRent);
  else if (sort === 'price-desc') listings.sort((a, b) => b.minRent - a.minRent);

  await Promise.all(
    listings.map((listing) =>
      db
        .prepare("INSERT INTO listing_events (listing_id, event_type, created_at) VALUES (?, 'impression', ?)")
        .bind(listing.id, new Date().toISOString())
        .run()
        .catch(() => undefined)
    )
  );

  return json({ count: listings.length, listings });
}
