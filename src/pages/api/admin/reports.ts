import type { APIContext } from 'astro';
import { getDb, json, requireAdmin } from '@/lib/server/auth';

export const prerender = false;

export async function GET(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const url = new URL(context.request.url);
  const status = url.searchParams.get('status');
  const valid = ['open', 'reviewing', 'resolved', 'dismissed'];
  const filter = status && valid.includes(status) ? status : null;

  const db = getDb();
  const res = await db
    .prepare(
      `SELECT r.*, u.name as reporter_name, u.email as reporter_email
       FROM reports r
       LEFT JOIN users u ON u.id = r.reporter_id
       ${filter ? 'WHERE r.status = ?' : ''}
       ORDER BY r.created_at DESC
       LIMIT 100`
    )
    .bind(...(filter ? [filter] : []))
    .all();

  return json({ reports: res.results });
}
