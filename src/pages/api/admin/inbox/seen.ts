import type { APIContext } from 'astro';
import { getDb, json, requireAdmin } from '@/lib/server/auth';
import { markInboxSeen } from '@/lib/server/adminInbox';

export const prerender = false;

/**
 * POST /api/admin/inbox/seen
 *
 * Mark the admin's inbox as seen up to now. The watermark is advanced, not any
 * derived item — reopening a queue item later shows it as new again only if it
 * is re-created, never because a read was faked.
 */
export async function POST(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const lastSeenAt = await markInboxSeen(getDb(), admin.user.id);
  return json({ ok: true, lastSeenAt });
}
