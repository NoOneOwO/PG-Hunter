import type { APIContext } from 'astro';
import { getDb, json, requireAdmin } from '@/lib/server/auth';

export const prerender = false;

export async function GET(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const url = new URL(context.request.url);
  const status = url.searchParams.get('status');
  const valid = ['pending', 'approved', 'rejected', 'spam'];
  const filter = status && valid.includes(status) ? status : null;

  const db = getDb();
  const res = await db
    .prepare(
      `SELECT e.*, u.name as user_name, u.email as user_email
       FROM pg_experiences e
       LEFT JOIN users u ON u.id = e.user_id
       ${filter ? 'WHERE e.status = ?' : ''}
       ORDER BY 
         CASE e.status WHEN 'pending' THEN 0 WHEN 'spam' THEN 1 ELSE 2 END,
         e.created_at DESC
       LIMIT 100`
    )
    .bind(...(filter ? [filter] : []))
    .all<{
      id: string;
      listing_id: string;
      user_id: string;
      rating: number | null;
      content: string;
      status: string;
      created_at: string;
      updated_at: string;
      user_name: string | null;
      user_email: string | null;
    }>();

  return json({ experiences: res.results });
}
