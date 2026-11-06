import type { APIContext } from 'astro';
import { getDb, getRequestUrl, json, nowIso, requireAuth } from '@/lib/server/auth';
import { contactForListing, recordLeadEvent } from '@/lib/server/leads';

export const prerender = false;

/**
 * GET /api/enquiries/contact?listingId=... — the owner's Call/WhatsApp details
 * for a PG the caller has ALREADY enquired about.
 *
 * The listing id comes from the student's own lead row, so changing the query
 * string can only ever ask about a listing they have a lead for; any other id
 * (including another owner's PG) returns `contact: null`. The owner's number
 * is never part of a public listing payload.
 */
export async function GET(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;

  const listingId = (getRequestUrl(context).searchParams.get('listingId') ?? '').trim();
  if (!listingId) return json({ error: 'Missing listing id.' }, 400);

  const db = getDb();
  const lead = await db
    .prepare(
      'SELECT id, contact_viewed_at FROM leads WHERE property_id = ? AND student_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    .bind(listingId, auth.user.id)
    .first<{ id: number; contact_viewed_at: string | null }>();

  if (!lead) return json({ error: 'Submit an enquiry first to see the owner’s contact details.' }, 403);

  const contact = await contactForListing(db, listingId, auth.user.id);

  // First unlock per lead is the honest "details viewed" metric; repeat page
  // loads should not inflate it.
  if (contact && !lead.contact_viewed_at) {
    await db.prepare('UPDATE leads SET contact_viewed_at = ? WHERE id = ?').bind(nowIso(), lead.id).run();
    await recordLeadEvent(db, {
      type: 'OWNER_CONTACT_DETAILS_VIEWED',
      listingId,
      leadId: lead.id,
      userId: auth.user.id,
    });
  }

  return json({ ok: true, leadId: lead.id, contact });
}
