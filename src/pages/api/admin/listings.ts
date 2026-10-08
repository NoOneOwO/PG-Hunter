import type { APIContext } from 'astro';
import { getDb, json, readBody, requireAdmin } from '@/lib/server/auth';
import { fetchListing, listingDto, type ListingRow } from '@/lib/server/listings';
import { mediaUrl } from '@/lib/server/media';
import { parseListingPayload } from '@/lib/server/listingInput';
import { insertListing } from '@/lib/server/listingWrite';

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

/**
 * Create a listing on an owner's behalf.
 *
 * This is how the team onboards an owner who just created an account: the PG
 * page belongs to the owner (`owner_id`), the row records that the team set it
 * up (`admin_managed`, `created_by`), and the owner can immediately see and
 * manage it from their own dashboard.
 *
 * Body: the listing payload plus `ownerId`.
 */
export async function POST(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const ownerId = String(body.ownerId ?? '').trim();
  if (!ownerId) return json({ error: 'Pick the owner this page belongs to.' }, 400);

  const db = getDb();
  const owner = await db
    .prepare("SELECT id, name, role FROM users WHERE id = ? AND role = 'owner'")
    .bind(ownerId)
    .first<{ id: string; name: string; role: string }>();
  if (!owner) return json({ error: 'That owner account does not exist.' }, 404);

  const parsed = parseListingPayload(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const listing = await insertListing(db, {
    ownerId: owner.id,
    actorId: admin.user.id,
    listing: parsed.value,
    adminManaged: true,
  });
  if (!listing) return json({ error: 'Could not create the listing.' }, 500);
  return json({ listing }, 201);
}
