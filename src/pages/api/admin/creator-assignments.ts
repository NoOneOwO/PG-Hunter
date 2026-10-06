/**
 * POST /api/admin/creator-assignments — give an approved creator a PG to shoot.
 *
 * The payout is set here, at assignment time, and stored on the row. That is
 * what makes every rupee on a creator dashboard traceable to a real piece of
 * assigned work rather than a number typed into a template.
 */
export const prerender = false;

import type { APIContext } from 'astro';

import { getDb, json, readBody, requireAdmin } from '@/lib/server/auth';
import {
  createCreatorAssignment,
  getCreatorByUserId,
  parseAssignmentInput,
  publicAssignment,
} from '@/lib/server/creators';

export async function POST(context: APIContext) {
  const auth = await requireAdmin(context);
  if ('error' in auth) return auth.error;

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const parsed = parseAssignmentInput(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const db = getDb();
  const creator = await getCreatorByUserId(db, parsed.value.creatorId);
  if (!creator) return json({ error: 'That creator does not exist.' }, 404);
  if (creator.status !== 'approved') {
    return json({ error: 'Assignments can only go to an approved creator.' }, 409);
  }

  const row = await createCreatorAssignment(db, parsed.value);
  return json({ assignment: publicAssignment(row) }, 201);
}
