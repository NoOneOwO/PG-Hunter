import type { APIContext } from 'astro';
import { getDb, json, publicUser, requireAuth } from '@/lib/server/auth';
import { fetchListing, listingDto, type ListingRow } from '@/lib/server/listings';
import { mediaUrl } from '@/lib/server/media';

export const prerender = false;

interface VerificationDocRow {
  id: string;
  owner_id: string;
  listing_id: string | null;
  doc_type: string;
  file_key: string;
  file_name: string;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);
const lastDays = (days: number) =>
  Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    return dayKey(d);
  });

const countByDate = <T extends { date: string }>(
  days: string[],
  rows: T[],
  pick: (row: T) => number,
  valueName: 'count' | 'views'
) => {
  const map = new Map(rows.map((row) => [row.date, pick(row)]));
  return days.map((date) => ({ date, [valueName]: map.get(date) ?? 0 }));
};

/** Backend for the PG Owner landing page (after auth). */
export async function GET(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;
  const user = auth.user;
  if (user.role !== 'owner' && !user.is_admin) {
    return json({ error: 'Owner access required.' }, 403);
  }

  const db = getDb();
  const listingsRes = await db
    .prepare('SELECT * FROM owner_listings WHERE owner_id = ? ORDER BY updated_at DESC')
    .bind(user.id)
    .all<ListingRow>();
  const leadsRes = await db
    .prepare(
      `SELECT l.*, ol.name AS property_name
       FROM leads l
       LEFT JOIN owner_listings ol ON ol.id = l.property_id
       WHERE l.property_id IN (SELECT id FROM owner_listings WHERE owner_id = ?)
       ORDER BY l.created_at DESC`
    )
    .bind(user.id)
    .all<{ id: number; property_id: string; property_name: string | null; budget: string | null; move_in_month: string | null; message: string | null; source: string; status: string; created_at: string }>();
  const docsRes = await db
    .prepare('SELECT * FROM verification_documents WHERE owner_id = ? ORDER BY created_at DESC')
    .bind(user.id)
    .all<VerificationDocRow>();
  const statusRows = await db
    .prepare('SELECT status, COUNT(*) AS count FROM owner_listings WHERE owner_id = ? GROUP BY status')
    .bind(user.id)
    .all<{ status: ListingRow['status']; count: number }>();
  const leadDayRows = await db
    .prepare(
      `SELECT substr(l.created_at, 1, 10) AS date, COUNT(*) AS count
       FROM leads l
       WHERE l.property_id IN (SELECT id FROM owner_listings WHERE owner_id = ?)
         AND l.created_at >= date('now', '-13 days')
       GROUP BY substr(l.created_at, 1, 10)
       ORDER BY date`
    )
    .bind(user.id)
    .all<{ date: string; count: number }>();
  const reachDayRows = await db
    .prepare(
      `SELECT substr(e.created_at, 1, 10) AS date, COUNT(*) AS views
       FROM listing_events e
       JOIN owner_listings ol ON ol.id = e.listing_id
       WHERE ol.owner_id = ? AND e.event_type IN ('impression', 'view')
         AND e.created_at >= date('now', '-13 days')
       GROUP BY substr(e.created_at, 1, 10)
       ORDER BY date`
    )
    .bind(user.id)
    .all<{ date: string; views: number }>()
    .catch(() => ({ results: [] }));
  const topListingRows = await db
    .prepare(
      `SELECT ol.id, ol.name,
              COUNT(DISTINCT l.id) AS enquiries,
              COUNT(e.id) AS views
       FROM owner_listings ol
       LEFT JOIN leads l ON l.property_id = ol.id
       LEFT JOIN listing_events e ON e.listing_id = ol.id AND e.event_type IN ('impression', 'view')
       WHERE ol.owner_id = ?
       GROUP BY ol.id, ol.name
       ORDER BY views DESC, enquiries DESC, ol.updated_at DESC
       LIMIT 5`
    )
    .bind(user.id)
    .all<{ id: string; name: string; enquiries: number; views: number }>()
    .catch(() => ({ results: [] }));
  const totalsRow = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM listing_events e JOIN owner_listings ol ON ol.id = e.listing_id WHERE ol.owner_id = ?) AS views,
         (SELECT COUNT(*) FROM listing_rooms r JOIN owner_listings ol ON ol.id = r.listing_id WHERE ol.owner_id = ? AND r.available = 1) AS availableRooms,
         (SELECT COUNT(*) FROM media m JOIN owner_listings ol ON ol.id = m.listing_id WHERE ol.owner_id = ? AND m.type = 'photo') AS photos`
    )
    .bind(user.id, user.id, user.id)
    .first<{ views: number; availableRooms: number; photos: number }>()
    .catch(() => ({ views: 0, availableRooms: 0, photos: 0 }));

  const listings = await Promise.all(
    listingsRes.results.map(async (row) => {
      const full = await fetchListing(db, row.id);
      return full ? listingDto(full.row, full.rooms, full.media, mediaUrl) : null;
    })
  );

  const docs = docsRes.results.map((d) => ({
    id: d.id,
    listingId: d.listing_id,
    docType: d.doc_type,
    fileName: d.file_name,
    url: mediaUrl(d.file_key),
    status: d.status,
    notes: d.notes,
    createdAt: d.created_at,
  }));

  const verificationStatus: 'none' | 'pending' | 'approved' =
    docs.some((d) => d.status === 'pending')
      ? 'pending'
      : docs.length > 0 && docs.every((d) => d.status === 'approved')
        ? 'approved'
        : 'none';
  const days = lastDays(14);

  return json({
    user: publicUser(user),
    stats: {
      listings: listingsRes.results.length,
      activeListings: listingsRes.results.filter((l) => l.status === 'active').length,
      pendingListings: listingsRes.results.filter((l) => l.status === 'pending').length,
      leads: leadsRes.results.length,
      newLeads: leadsRes.results.filter((l) => l.status === 'new').length,
      verification: { status: verificationStatus, documents: docs.length },
      analytics: {
        listingStatuses: (['draft', 'pending', 'active', 'rejected'] as ListingRow['status'][]).map((status) => ({
          status,
          count: statusRows.results.find((row) => row.status === status)?.count ?? 0,
        })),
        enquiriesByDay: countByDate(days, leadDayRows.results, (row) => row.count, 'count'),
        reachByDay: countByDate(days, reachDayRows.results, (row) => row.views, 'views'),
        topListings: topListingRows.results,
        totals: {
          views: totalsRow?.views ?? 0,
          availableRooms: totalsRow?.availableRooms ?? 0,
          photos: totalsRow?.photos ?? 0,
        },
      },
    },
    listings: listings.filter(Boolean),
    leads: leadsRes.results,
  });
}
