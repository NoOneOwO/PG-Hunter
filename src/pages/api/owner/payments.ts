/**
 * /api/owner/payments
 *
 *   GET  — the caller's payment history (newest first).
 *   POST — submit a UPI reference for a paid plan. The amount is read from the
 *          plan catalogue server-side; the client never sends a price. The row
 *          is always created as `submitted` — only an admin can confirm it.
 */
export const prerender = false;

import type { APIContext } from 'astro';

import { getDb, json, readBody, requireAuth } from '@/lib/server/auth';
import { getPlan } from '@/lib/server/plans';
import { createPaymentRequest, listOwnerPayments } from '@/lib/server/payments';
import { validatePaymentRequest } from '@/lib/payments';

export async function GET(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;

  const payments = await listOwnerPayments(getDb(), auth.user.id);
  return json({ payments });
}

export async function POST(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;

  if (auth.user.role !== 'owner') {
    return json({ error: 'Only owners can pay for a listing plan.' }, 403);
  }

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const planSlug = body.planSlug === 'verified' ? 'verified' : body.planSlug === 'basic' ? 'basic' : null;
  if (!planSlug) return json({ error: 'Unknown plan.' }, 400);

  const listingIdRaw = typeof body.listingId === 'string' ? body.listingId.trim() : '';
  const listingId = listingIdRaw || null;

  const validation = validatePaymentRequest({ reference: body.reference, note: body.note });
  if (!validation.ok) {
    return json({ error: 'Check the highlighted field.', errors: validation.errors }, 400);
  }

  const db = getDb();

  // The listing, when given, must belong to the caller.
  if (listingId) {
    const owned = await db
      .prepare('SELECT id FROM owner_listings WHERE id = ? AND owner_id = ?')
      .bind(listingId, auth.user.id)
      .first<{ id: string }>();
    if (!owned) return json({ error: 'Listing not found.' }, 404);
  }

  // Price comes from the catalogue (single source of truth), not the client.
  const plan = await getPlan(planSlug, db);
  if (plan.priceInr <= 0) {
    return json({ error: 'This plan is free — no payment is needed.' }, 400);
  }

  const payment = await createPaymentRequest(db, {
    ownerId: auth.user.id,
    listingId,
    planSlug,
    amountInr: plan.priceInr,
    reference: validation.value.reference,
    note: validation.value.note,
  });

  if (!payment) return json({ error: 'Could not save the payment. Please try again.' }, 500);
  return json({ payment }, 201);
}
