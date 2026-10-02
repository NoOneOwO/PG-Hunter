import type { APIContext } from 'astro';
import { getDb, json, requireAdmin } from '@/lib/server/auth';
import { fetchListing, listingDto, type ListingRow } from '@/lib/server/listings';
import { mediaUrl } from '@/lib/server/media';

export const prerender = false;

const VALID_STATUSES = ['draft', 'pending', 'active', 'rejected'];

export async function GET(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const db = getDb();
  const status = new URL(context.request.url).searchParams.get('status');
  const filter = status && VALID_STATUSES.includes(status) ? status : null;

  const rowsRes = filter
    ? await db
        .prepare(
          `SELECT ol.*, u.name AS owner_name, u.email AS owner_email
           FROM owner_listings ol JOIN users u ON u.id = ol.owner_id
           WHERE ol.status = ? ORDER BY ol.updated_at DESC`
        )
        .bind(filter)
        .all<ListingRow & { owner_name: string; owner_email: string }>()
    : await db
        .prepare(
          `SELECT ol.*, u.name AS owner_name, u.email AS owner_email
           FROM owner_listings ol JOIN users u ON u.id = ol.owner_id
           ORDER BY ol.updated_at DESC`
        )
        .all<ListingRow & { owner_name: string; owner_email: string }>();

  const listings = await Promise.all(
    rowsRes.results.map(async (row) => {
      const full = await fetchListing(db, row.id);
      if (!full) return null;
      const dto = listingDto(full.row, full.rooms, full.media, mediaUrl);
      return { ...dto, ownerName: row.owner_name, ownerEmail: row.owner_email };
    })
  );

  return json({ listings: listings.filter(Boolean) });
}
