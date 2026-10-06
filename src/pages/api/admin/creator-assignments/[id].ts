/**
 * PUT /api/admin/creator-assignments/:id — review a submission, or mark it paid.
 *
 *   approved — the work passed review; its payout joins the creator's earnings
 *   rejected — sent back with a reason the creator can act on
 *   paid     — stamps paid_at on an already-approved row (money actually moved)
 */
export const prerender = false;

import type { APIContext } from 'astro';

import { getDb, json, readBody, requireAdmin } from '@/lib/server/auth';
import { publicAssignment, reviewCreatorAssignment } from '@/lib/server/creators';

export async function PUT(context: APIContext) {
  const auth = await requireAdmin(context);
  if ('error' in auth) return auth.error;

  const id = context.params.id;
  if (!id) return json({ error: 'Missing assignment id.' }, 400);

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const decision =
    body.decision === 'approved' ? 'approved' : body.decision === 'rejected' ? 'rejected' : body.decision === 'paid' ? 'paid' : null;
  if (!decision) return json({ error: 'Decision must be approved, rejected or paid.' }, 400);

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (decision === 'rejected' && reason.length < 5) {
    return json({ error: 'Give the creator a reason they can act on (at least 5 characters).' }, 400);
  }

  const row = await reviewCreatorAssignment(getDb(), id, decision, reason || null);
  if (!row) return json({ error: 'Assignment not found.' }, 404);

  return json({ assignment: publicAssignment(row) });
}
