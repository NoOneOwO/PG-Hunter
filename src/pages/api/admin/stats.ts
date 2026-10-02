import type { APIContext } from 'astro';
import { getDb, json, requireAdmin } from '@/lib/server/auth';

export const prerender = false;

export async function GET(context: APIContext) {
  const admin = await requireAdmin(context);
  if ('error' in admin) return admin.error;

  const db = getDb();
  const [users, listings, leads, verifications, videos] = await Promise.all([
    db
      .prepare("SELECT role, COUNT(*) AS n FROM users GROUP BY role")
      .all<{ role: string; n: number }>(),
    db
      .prepare('SELECT status, COUNT(*) AS n FROM owner_listings GROUP BY status')
      .all<{ status: string; n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM leads').first<{ n: number }>(),
    db
      .prepare('SELECT status, COUNT(*) AS n FROM verification_documents GROUP BY status')
      .all<{ status: string; n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM media WHERE type = 'video'").first<{ n: number }>(),
  ]);

  const byKey = (rows: { status?: string; role?: string; n: number }[], key: string) =>
    rows.find((r) => r.status === key || r.role === key)?.n ?? 0;

  return json({
    users: {
      total: users.results.reduce((sum, r) => sum + r.n, 0),
      students: byKey(users.results, 'student'),
      owners: byKey(users.results, 'owner'),
    },
    listings: {
      total: listings.results.reduce((sum, r) => sum + r.n, 0),
      drafts: byKey(listings.results, 'draft'),
      pending: byKey(listings.results, 'pending'),
      active: byKey(listings.results, 'active'),
      rejected: byKey(listings.results, 'rejected'),
    },
    leads: leads?.n ?? 0,
    verifications: {
      pending: byKey(verifications.results, 'pending'),
      approved: byKey(verifications.results, 'approved'),
      rejected: byKey(verifications.results, 'rejected'),
    },
    tourVideos: videos?.n ?? 0,
  });
}
