/**
 * PUT /api/creator/assignments/:id — the creator moves their own work forward.
 *
 * Only two transitions are allowed from the creator side:
 *   start  — assigned → in_progress
 *   submit — in_progress (or a rejected resubmission) → submitted
 *
 * Approval, rejection and the paid stamp are admin-only (see
 * /api/admin/creator-assignments/:id) so a creator can never approve their own
 * payout. Ownership is enforced in the SQL by `advanceAssignment`, which
 * matches on creator_id as well as assignment id.
 */
export const prerender = false;

import type { APIContext } from 'astro';

import { getDb, json, readBody, requireAuth } from '@/lib/server/auth';
import { advanceAssignment, publicAssignment } from '@/lib/server/creators';

export async function PUT(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;

  const id = context.params.id;
  if (!id) return json({ error: 'Missing assignment id.' }, 400);

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const action = body.action === 'start' ? 'start' : body.action === 'submit' ? 'submit' : null;
  if (!action) return json({ error: 'Unknown action.' }, 400);

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (url && !/^https?:\/\//i.test(url)) {
    return json({ error: 'A submission link must start with http:// or https://.' }, 400);
  }
  const note = typeof body.note === 'string' ? body.note : '';

  const row = await advanceAssignment(getDb(), auth.user.id, id, action, { note, url });
  if (!row) return json({ error: 'That assignment is not yours.' }, 404);

  return json({ assignment: publicAssignment(row) });
}
