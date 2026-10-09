import type { APIContext } from 'astro';
import { getDb, json, requireAdmin } from '@/lib/server/auth';
import { getAdminInbox } from '@/lib/server/adminInbox';

export const prerender = false;

/**
 * GET /api/admin/inbox
 *
 * The admin notification feed, derived from real queue rows, plus the caller's
 * unread count. Read-only; marking items seen is a separate POST so a GET never
 * mutates state.
 */
export async function GET(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const inbox = await getAdminInbox(getDb(), admin.user.id);
  return json(inbox);
}
