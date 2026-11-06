import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAuth } from '@/lib/server/auth';
import { recordEvent } from '@/lib/server/engagement';
import { isExpired } from '@/lib/verificationRules';
import { DUPLICATE_WINDOW_MINUTES, formatEnquiryPhone, parseEnquiry } from '@/lib/enquiry';
import { contactForListing, recordLeadEvent } from '@/lib/server/leads';

export const prerender = false;

/**
 * POST /api/enquiries — student submits one enquiry for one live PG.
 *
 * This is the only way a lead is created. It:
 *   - requires a session (the owner must be able to identify who asked),
 *   - re-validates every field server-side,
 *   - refuses listings that are not currently published,
 *   - collapses repeat submits inside DUPLICATE_WINDOW_MINUTES onto the
 *     original lead instead of stacking duplicates in the owner's inbox,
 *   - stores the student's number ONLY behind explicit consent,
 *   - returns the owner's Call/WhatsApp details only when the owner enabled
 *     direct contact for this listing.
 *
 * Nothing here sends a message to anyone. No SMS, no email, no WhatsApp API:
 * the owner sees the enquiry in their dashboard and the student decides
 * whether to call.
 */
export async function POST(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;
  const user = auth.user;

  const body = (await readBody(context)) as Record<string, unknown> | null;
  const parsed = parseEnquiry(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const input = parsed.value;

  const db = getDb();
  const listing = await db
    .prepare('SELECT id, owner_id, name, status, expires_at FROM owner_listings WHERE id = ?')
    .bind(input.propertyId)
    .first<{ id: string; owner_id: string; name: string; status: string; expires_at: string | null }>();

  if (!listing || listing.status !== 'active' || isExpired({ expires_at: listing.expires_at })) {
    return json({ error: 'This PG is no longer accepting enquiries. Please pick another listing.' }, 404);
  }
  if (listing.owner_id === user.id) {
    return json({ error: "This is your own listing, so you can't enquire about it." }, 400);
  }

  // Duplicate guard: same student, same PG, recent. Returning the original
  // lead keeps the contract "exactly one lead per successful submit" true even
  // when the browser retries or the student double-taps.
  const windowStart = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000).toISOString();
  const existing = await db
    .prepare(
      'SELECT id FROM leads WHERE property_id = ? AND student_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1'
    )
    .bind(input.propertyId, user.id, windowStart)
    .first<{ id: number }>();

  if (existing) {
    const contact = await contactForListing(db, input.propertyId, user.id);
    return json(
      {
        error: 'You already sent an enquiry for this PG. The owner can see it in their dashboard.',
        duplicate: true,
        leadId: existing.id,
        contact,
      },
      409
    );
  }

  // The number belongs to the student's own account, so saving it there is
  // fine; sharing it with the owner is a separate, explicit decision.
  if (input.phone) {
    const display = formatEnquiryPhone(input.phone);
    if (display !== user.phone) {
      await db
        .prepare('UPDATE users SET phone = ?, updated_at = ? WHERE id = ?')
        .bind(display, nowIso(), user.id)
        .run();
    }
  }

  const inserted = await db
    .prepare(
      `INSERT INTO leads
        (property_id, student_id, student_name, college, room_type, budget, move_in_month,
         message, source, status, phone_shared, shared_phone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'web', 'new', ?, ?, ?, ?)`
    )
    .bind(
      input.propertyId,
      user.id,
      input.name,
      input.college,
      input.roomType,
      input.budget,
      input.moveInMonth,
      input.message,
      input.phone && input.consent ? 1 : 0,
      input.phone && input.consent ? formatEnquiryPhone(input.phone) : null,
      nowIso(),
      nowIso()
    )
    .run();

  const lastRowId = inserted.meta?.last_row_id;
  const leadId = typeof lastRowId === 'number' && lastRowId > 0 ? lastRowId : null;

  await recordLeadEvent(db, { type: 'ENQUIRY_SUBMITTED', listingId: input.propertyId, leadId, userId: user.id });
  // Existing engagement funnel (owner dashboard charts) keeps counting enquiries.
  await recordEvent(db, input.propertyId, user.id, 'ENQUIRY', null).catch(() => {});

  const contact = await contactForListing(db, input.propertyId, user.id);
  if (contact) {
    await db
      .prepare('UPDATE leads SET contact_viewed_at = ? WHERE id = ? AND contact_viewed_at IS NULL')
      .bind(nowIso(), leadId)
      .run();
    await recordLeadEvent(db, {
      type: 'OWNER_CONTACT_DETAILS_VIEWED',
      listingId: input.propertyId,
      leadId,
      userId: user.id,
    });
  }

  return json(
    {
      ok: true,
      leadId,
      listingName: listing.name,
      /** True only when the student consented to share their number. */
      phoneShared: Boolean(input.phone && input.consent),
      /** Null when the owner has direct contact off or no valid number. */
      contact,
    },
    201
  );
}
