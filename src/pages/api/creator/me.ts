/**
 * GET /api/creator/me — everything the creator dashboard needs in one request.
 *
 * Returns `profile: null` for a signed-in user who has not applied yet, so the
 * dashboard can render a real "not registered" state instead of an error.
 */
export const prerender = false;

import type { APIContext } from 'astro';

import { getDb, json, publicUser, requireAuth } from '@/lib/server/auth';
import { getCreatorDashboard } from '@/lib/server/creators';

export async function GET(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;

  const dashboard = await getCreatorDashboard(getDb(), auth.user);
  return json({ ...dashboard, user: publicUser(auth.user) });
}
