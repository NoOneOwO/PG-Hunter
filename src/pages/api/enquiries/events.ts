import type { APIContext } from 'astro';
import { getDb, json, readBody, requireAuth } from '@/lib/server/auth';
import { CLIENT_EVENT_TYPES, recordLeadEvent } from '@/lib/server/leads';
import type { EnquiryEventType } from '@/lib/server/leads';

export const prerender = false;

/**
 * POST /api/enquiries/events — the browser reports funnel events that only it
 * can observe: opening the form, and tapping Call / WhatsApp.
 *
 * Accepted types are a closed allowlist. Click events must reference a lead
 * that belongs to the caller, so a student cannot inflate another listing's
 * numbers. A click is recorded as a click — never as a completed call or
 * conversation.
 */
export async function POST(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;

  const body = (await readBody(context)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'Could not read the event.' }, 400);

  const type = String(body.type ?? '').trim() as EnquiryEventType;
  if (!CLIENT_EVENT_TYPES.includes(type)) return json({ error: 'Unknown enquiry event.' }, 400);

  const listingId = String(body.listingId ?? '').trim();
  if (!listingId) return json({ error: 'Missing listing id.' }, 400);

  const db = getDb();
  const listing = await db
    .prepare('SELECT id FROM owner_listings WHERE id = ?')
    .bind(listingId)
    .first<{ id: string }>();
  if (!listing) return json({ error: 'Unknown listing.' }, 404);

  let leadId: number | null = null;

  if (type !== 'ENQUIRY_STARTED') {
    const maybeLead = Number(body.leadId);
    if (!Number.isInteger(maybeLead) || maybeLead <= 0) {
      return json({ error: 'Missing enquiry reference.' }, 400);
    }
    const own = await db
      .prepare('SELECT id FROM leads WHERE id = ? AND student_id = ? AND property_id = ?')
      .bind(maybeLead, auth.user.id, listingId)
      .first<{ id: number }>();
    if (!own) return json({ error: 'Unknown enquiry.' }, 404);
    leadId = own.id;
  }

  await recordLeadEvent(db, { type, listingId, leadId, userId: auth.user.id });
  return json({ ok: true }, 202);
}
