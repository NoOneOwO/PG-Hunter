/**
 * PUT /api/admin/payments/:id — confirm or reject a submitted payment.
 *
 *   confirmed — the money actually arrived; opens the paid plan window on the
 *               attached listing (verification is a separate ledger).
 *   rejected  — the reference is wrong/not found; the row is kept for audit.
 */
export const prerender = false;

import type { APIContext } from 'astro';

import { getDb, json, readBody, requireAdmin } from '@/lib/server/auth';
import { decidePayment } from '@/lib/server/payments';

export async function PUT(context: APIContext) {
  const auth = await requireAdmin(context);
  if ('error' in auth) return auth.error;

  const id = context.params.id;
  if (!id) return json({ error: 'Missing payment id.' }, 400);

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const decision =
    body.decision === 'confirmed' ? 'confirmed' : body.decision === 'rejected' ? 'rejected' : null;
  if (!decision) return json({ error: 'Decision must be confirmed or rejected.' }, 400);

  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (decision === 'rejected' && note.length < 5) {
    return json({ error: 'Give a reason (at least 5 characters) so the owner can follow up.' }, 400);
  }

  const payment = await decidePayment(getDb(), {
    id,
    adminId: auth.user.id,
    decision,
    note: note || null,
  });
  if (!payment) return json({ error: 'Payment not found.' }, 404);

  return json({ payment });
}
