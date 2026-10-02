import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAdmin } from '@/lib/server/auth';

export const prerender = false;

const VALID_ACTIONS: Record<string, string> = {
  reviewing: 'reviewing',
  resolved: 'resolved',
  dismissed: 'dismissed',
  resolve: 'resolved',
  dismiss: 'dismissed',
};

export async function POST(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const id = String(context.params.id ?? '').trim();
  if (!id) return json({ error: 'Missing id.' }, 400);

  const body = await readBody(context);
  const raw = String(body?.action ?? body?.status ?? '').trim().toLowerCase();
  const status = VALID_ACTIONS[raw];
  if (!status) return json({ error: 'action must be reviewing, resolved or dismissed.' }, 400);

  const db = getDb();
  const existing = await db.prepare(`SELECT * FROM reports WHERE id = ?`).bind(id).first<{ id: string }>();
  if (!existing) return json({ error: 'Report not found.' }, 404);

  const now = nowIso();
  const resolvedAt = status === 'resolved' || status === 'dismissed' ? now : null;
  const resolvedBy = status === 'resolved' || status === 'dismissed' ? admin.user.id : null;

  await db
    .prepare(`UPDATE reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?`)
    .bind(status, resolvedAt, resolvedBy, id)
    .run();

  // Audit
  await db
    .prepare(
      `INSERT INTO moderation_actions (id, target_type, target_id, action, admin_user_id, reason, created_at) VALUES (?, 'report', ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), id, status === 'resolved' ? 'RESOLVED' : status === 'dismissed' ? 'DISMISSED' : 'REVIEWING', admin.user.id, null, now)
    .run();

  const updated = await db.prepare(`SELECT * FROM reports WHERE id = ?`).bind(id).first();
  return json({ report: updated });
}
