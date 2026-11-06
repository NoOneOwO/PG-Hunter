import type { APIContext } from 'astro';
import { getDb, getRequestUrl, json, requireAuth } from '@/lib/server/auth';
import { LEAD_STATUSES } from '@/lib/owner';

export const prerender = false;

export interface OwnerLeadRow {
  id: number;
  property_id: string;
  property_name: string | null;
  student_name: string | null;
  college: string | null;
  room_type: string | null;
  budget: string | null;
  move_in_month: string | null;
  message: string | null;
  source: string;
  status: string;
  owner_notes: string | null;
  phone_shared: number;
  shared_phone: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/owner/leads — the caller's own enquiries, optionally filtered by
 * listing and status.
 *
 * Two privacy rules are enforced here rather than in the page:
 *   - the lead set is scoped to listings owned by the session user, so a
 *     guessed listing id filters to nothing;
 *   - the student's phone is read from `leads.shared_phone`, and ONLY when
 *     `phone_shared = 1`. `users.phone` is never joined, so a student who kept
 *     the box unticked stays uncontactable by number even though the account
 *     has a number on file.
 *
 * Viewing, liking or saving a PG never creates a lead, so this response can
 * only ever describe students who actually enquired.
 */
export async function GET(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;
  if (auth.user.role !== 'owner' && !auth.user.is_admin) {
    return json({ error: 'Owner access required.' }, 403);
  }

  const params = getRequestUrl(context).searchParams;
  const listingFilter = (params.get('listing') ?? '').trim();
  const statusFilter = (params.get('status') ?? '').trim();

  if (statusFilter && !(LEAD_STATUSES as readonly string[]).includes(statusFilter)) {
    return json({ error: 'Unknown lead status.' }, 400);
  }

  const db = getDb();
  const conditions = ['l.property_id IN (SELECT id FROM owner_listings WHERE owner_id = ?)'];
  const bindings: unknown[] = [auth.user.id];
  if (listingFilter) {
    conditions.push('l.property_id = ?');
    bindings.push(listingFilter);
  }
  if (statusFilter) {
    conditions.push('l.status = ?');
    bindings.push(statusFilter);
  }

  const res = await db
    .prepare(
      `SELECT l.id, l.property_id, ol.name AS property_name,
              COALESCE(l.student_name, u.name) AS student_name,
              l.college, l.room_type, l.budget, l.move_in_month, l.message,
              l.source, l.status, l.owner_notes, l.phone_shared,
              CASE WHEN l.phone_shared = 1 THEN l.shared_phone ELSE NULL END AS shared_phone,
              l.created_at, l.updated_at
       FROM leads l
       LEFT JOIN owner_listings ol ON ol.id = l.property_id
       LEFT JOIN users u ON u.id = l.student_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY l.created_at DESC`
    )
    .bind(...bindings)
    .all<OwnerLeadRow>();

  // Counts are for the unfiltered inbox so the owner can see what is waiting
  // even while a filter is applied.
  const countsRes = await db
    .prepare(
      `SELECT status, COUNT(*) AS c FROM leads
       WHERE property_id IN (SELECT id FROM owner_listings WHERE owner_id = ?)
       GROUP BY status`
    )
    .bind(auth.user.id)
    .all<{ status: string; c: number }>();
  const counts: Record<string, number> = { all: 0 };
  for (const status of LEAD_STATUSES) counts[status] = 0;
  for (const row of countsRes.results) {
    counts[row.status] = row.c;
    counts.all += row.c;
  }

  const listingsRes = await db
    .prepare('SELECT id, name FROM owner_listings WHERE owner_id = ? ORDER BY name')
    .bind(auth.user.id)
    .all<{ id: string; name: string }>();

  return json({
    leads: res.results,
    counts,
    unread: counts.new ?? 0,
    listings: listingsRes.results,
  });
}
