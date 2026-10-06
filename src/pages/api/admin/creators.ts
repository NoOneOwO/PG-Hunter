/**
 * GET /api/admin/creators?status= — the creator application queue.
 *
 * Read-only: decisions go through /api/admin/creators/:id so the audit fields
 * (reviewed_by / reviewed_at) are written in exactly one place.
 */
export const prerender = false;

import type { APIContext } from 'astro';

import { getDb, json, requireAdmin } from '@/lib/server/auth';
import { countCreatorsByStatus, listCreators, publicCreator } from '@/lib/server/creators';

export async function GET(context: APIContext) {
  const auth = await requireAdmin(context);
  if ('error' in auth) return auth.error;

  const status = new URL(context.request.url).searchParams.get('status') ?? undefined;
  const db = getDb();
  const [creators, counts] = await Promise.all([listCreators(db, status), countCreatorsByStatus(db)]);

  return json({
    counts,
    creators: creators.map((row) => ({
      ...publicCreator(row),
      userName: row.user_name,
      userEmail: row.user_email,
    })),
  });
}
