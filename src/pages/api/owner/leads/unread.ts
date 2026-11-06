import type { APIContext } from 'astro';
import { getDb, json, requireAuth } from '@/lib/server/auth';

export const prerender = false;

/**
 * GET /api/owner/leads/unread — how many enquiries are still marked NEW.
 *
 * This is the owner's in-dashboard notification: one cheap COUNT that the
 * owner header polls once per page load. It is deliberately not push/SMS —
 * nothing leaves PG Hunter, and no third-party notification service is
 * involved.
 */
export async function GET(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;
  if (auth.user.role !== 'owner' && !auth.user.is_admin) {
    return json({ error: 'Owner access required.' }, 403);
  }

  const row = await getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM leads
       WHERE status = 'new'
         AND property_id IN (SELECT id FROM owner_listings WHERE owner_id = ?)`
    )
    .bind(auth.user.id)
    .first<{ c: number }>();

  return json({ unread: row?.c ?? 0 });
}
