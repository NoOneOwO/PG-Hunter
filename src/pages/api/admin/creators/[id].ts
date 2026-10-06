/**
 * PUT /api/admin/creators/:id — approve or reject a creator application.
 *
 * The reviewer is recorded on the row (`reviewed_by`, `reviewed_at`) and a
 * rejection should carry a note the creator can act on, so the dashboard can
 * show them exactly what to fix before resubmitting.
 */
export const prerender = false;

import type { APIContext } from 'astro';

import { getDb, json, readBody, requireAdmin } from '@/lib/server/auth';
import { publicCreator, reviewCreatorApplication } from '@/lib/server/creators';

export async function PUT(context: APIContext) {
  const auth = await requireAdmin(context);
  if ('error' in auth) return auth.error;

  const id = context.params.id;
  if (!id) return json({ error: 'Missing creator id.' }, 400);

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const decision = body.decision === 'approved' ? 'approved' : body.decision === 'rejected' ? 'rejected' : null;
  if (!decision) return json({ error: 'Decision must be approved or rejected.' }, 400);

  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (decision === 'rejected' && notes.length < 5) {
    return json({ error: 'Give the creator a reason they can act on (at least 5 characters).' }, 400);
  }

  const row = await reviewCreatorApplication(getDb(), id, decision, auth.user.id, notes || null);
  if (!row) return json({ error: 'Creator application not found.' }, 404);

  return json({ profile: publicCreator(row) });
}
