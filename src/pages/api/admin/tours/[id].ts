import type { APIContext } from 'astro';
import { getDb, json, requireAdmin } from '@/lib/server/auth';

export const prerender = false;

export async function DELETE(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const db = getDb();
  const id = context.params.id ?? '';
  const row = await db
    .prepare("SELECT id FROM media WHERE id = ? AND type = 'video'")
    .bind(id)
    .first<{ id: string }>();
  if (!row) return json({ error: 'Tour not found.' }, 404);

  await db.prepare('DELETE FROM media WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
