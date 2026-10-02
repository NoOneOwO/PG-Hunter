import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAdmin } from '@/lib/server/auth';

export const prerender = false;

const VALID_ACTIONS: Record<string, string> = {
  approve: 'approved',
  approved: 'approved',
  reject: 'rejected',
  rejected: 'rejected',
  spam: 'spam',
};

const AUDIT_ACTION: Record<string, string> = {
  approved: 'APPROVED',
  rejected: 'REJECTED',
  spam: 'SPAM',
};

export async function POST(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const id = String(context.params.id ?? '').trim();
  if (!id) return json({ error: 'Missing id.' }, 400);

  const body = await readBody(context);
  const rawAction = String(body?.action ?? '').trim().toLowerCase();
  const status = VALID_ACTIONS[rawAction];
  if (!status) return json({ error: 'action must be approve, reject or spam.' }, 400);
  const reason = body?.reason ? String(body.reason).trim().slice(0, 500) : null;

  const db = getDb();
  const existing = await db.prepare(`SELECT * FROM pg_experiences WHERE id = ?`).bind(id).first<{ id: string; status: string }>();
  if (!existing) return json({ error: 'Experience not found.' }, 404);

  const now = nowIso();
  await db.prepare(`UPDATE pg_experiences SET status = ?, updated_at = ? WHERE id = ?`).bind(status, now, id).run();

  // Audit trail — never silent
  const auditId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO moderation_actions (id, target_type, target_id, action, admin_user_id, reason, created_at) VALUES (?, 'experience', ?, ?, ?, ?, ?)`
    )
    .bind(auditId, id, AUDIT_ACTION[status] ?? status.toUpperCase(), admin.user.id, reason, now)
    .run();

  const updated = await db
    .prepare(`SELECT e.*, u.name as user_name, u.email as user_email FROM pg_experiences e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = ?`)
    .bind(id)
    .first();

  return json({ experience: updated, auditId });
}
