/**
 * POST /api/creator/apply — create or update the signed-in user's creator
 * application.
 *
 * Idempotent per account: a second submission updates the same row instead of
 * creating a duplicate, and a resubmission after a rejection re-enters the
 * review queue (see upsertCreatorApplication).
 */
export const prerender = false;

import type { APIContext } from 'astro';

import { validateCreatorApplication } from '@/lib/creatorRules';
import { getDb, json, readBody, requireAuth } from '@/lib/server/auth';
import { publicCreator, upsertCreatorApplication } from '@/lib/server/creators';

export async function POST(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const parsed = validateCreatorApplication(body);
  if (!parsed.ok) {
    // Field keys mirror the form's name attributes so the page can put each
    // message under the input that produced it.
    return json({ error: 'Please fix the highlighted fields.', fieldErrors: parsed.errors }, 400);
  }

  try {
    const row = await upsertCreatorApplication(getDb(), auth.user, parsed.value);
    return json({ profile: publicCreator(row) });
  } catch (err) {
    console.error('creator_apply: failed', err);
    return json({ error: 'Could not save your application right now. Please try again.' }, 503);
  }
}
