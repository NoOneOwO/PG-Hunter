import type { APIContext } from 'astro';
import { getDb, json, requireAuth } from '@/lib/server/auth';

export const prerender = false;

/** Enquiries (leads) received for the owner's listings. */
export async function GET(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;
  if (auth.user.role !== 'owner' && !auth.user.is_admin) {
    return json({ error: 'Owner access required.' }, 403);
  }

  const res = await getDb()
    .prepare(
      `SELECT l.id, l.property_id, ol.name AS property_name, l.budget, l.move_in_month,
              l.message, l.source, l.status, l.created_at, u.name AS student_name
       FROM leads l
       LEFT JOIN owner_listings ol ON ol.id = l.property_id
       LEFT JOIN users u ON u.id = l.student_id
       WHERE l.property_id IN (SELECT id FROM owner_listings WHERE owner_id = ?)
       ORDER BY l.created_at DESC`
    )
    .bind(auth.user.id)
    .all<{
      id: number;
      property_id: string;
      property_name: string | null;
      budget: string | null;
      move_in_month: string | null;
      message: string | null;
      source: string;
      status: string;
      created_at: string;
      student_name: string | null;
    }>();

  return json({ leads: res.results });
}
