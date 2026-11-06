/**
 * PG Hunter — server helpers for the enquiry pipeline.
 *
 * One pipeline, one source of truth: every enquiry is a row in `leads`
 * (0001_init) plus an append-only `lead_events` row (0015) for the funnel.
 * Nothing here sends SMS, email or WhatsApp messages — the WhatsApp link is
 * handed to the student's own device, who chooses whether to send anything.
 */

import { nowIso } from './auth';
import { buildContact } from '@/lib/enquiry';
import type { EnquiryContact } from '@/lib/enquiry';

export { ENQUIRY_BUDGETS, ENQUIRY_ROOM_TYPES, buildContact, formatEnquiryPhone, normalizePhone, parseEnquiry } from '@/lib/enquiry';
export type { EnquiryContact, EnquiryInput } from '@/lib/enquiry';

/* ------------------------------------------------------------------ */
/* Funnel events                                                       */
/* ------------------------------------------------------------------ */

export const ENQUIRY_EVENT_TYPES = [
  'ENQUIRY_STARTED',
  'ENQUIRY_SUBMITTED',
  'OWNER_CONTACT_DETAILS_VIEWED',
  'OWNER_CALL_CLICKED',
  'OWNER_WHATSAPP_CLICKED',
  'LEAD_STATUS_CHANGED',
] as const;
export type EnquiryEventType = (typeof ENQUIRY_EVENT_TYPES)[number];

/** Events the browser is allowed to report for itself. */
export const CLIENT_EVENT_TYPES: readonly EnquiryEventType[] = [
  'ENQUIRY_STARTED',
  'OWNER_CALL_CLICKED',
  'OWNER_WHATSAPP_CLICKED',
];

/**
 * The owner's contact for one enquiry, or null.
 *
 * Null covers every reason the page must show no buttons: the owner disabled
 * direct contact for this listing, the listing is gone, or the owner has no
 * valid number on their profile. The caller never learns WHICH of those it
 * was, and this function only ever succeeds for a listing the student already
 * has a lead on — so a modified request cannot ask for another owner's number.
 */
export const contactForListing = async (
  db: D1Database,
  listingId: string,
  studentId: string
): Promise<EnquiryContact | null> => {
  const row = await db
    .prepare(
      `SELECT ol.contact_direct, u.phone AS owner_phone
       FROM owner_listings ol
       JOIN users u ON u.id = ol.owner_id
       WHERE ol.id = ?
         AND ol.contact_direct = 1
         AND EXISTS (SELECT 1 FROM leads l WHERE l.property_id = ol.id AND l.student_id = ?)`
    )
    .bind(listingId, studentId)
    .first<{ contact_direct: number; owner_phone: string | null }>();
  if (!row) return null;
  return buildContact(row.owner_phone);
};

/**
 * Append one funnel event. Best-effort on purpose: analytics must never make
 * an enquiry fail after the lead row is already written.
 */
export const recordLeadEvent = async (
  db: D1Database,
  input: {
    type: EnquiryEventType;
    listingId: string;
    leadId?: number | null;
    userId?: string | null;
  }
): Promise<void> => {
  try {
    await db
      .prepare(
        'INSERT INTO lead_events (lead_id, listing_id, user_id, event_type, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(input.leadId ?? null, input.listingId, input.userId ?? null, input.type, nowIso())
      .run();
  } catch (err) {
    console.error('lead_event: insert failed', { type: input.type, error: String(err) });
  }
};
