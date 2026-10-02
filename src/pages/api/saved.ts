import type { APIContext } from 'astro';
import { currentUser, getDb, json, readBody } from '@/lib/server/auth';
import { recordEvent } from '@/lib/server/engagement';

export const prerender = false;

export async function GET(context: APIContext) {
  const user = await currentUser(context);
  if (!user) return json({ ids: [] });

  const res = await getDb()
    .prepare('SELECT property_id FROM saved_pgs WHERE user_id = ? ORDER BY created_at DESC')
    .bind(user.id)
    .all<{ property_id: string }>();

  return json({ ids: res.results.map((r) => r.property_id) });
}

export async function POST(context: APIContext) {
  const user = await currentUser(context);
  if (!user) return json({ error: 'Not logged in.' }, 401);

  const body = await readBody(context);
  const propertyId = String(body?.propertyId ?? '').trim();
  if (!propertyId) return json({ error: 'Missing property id.' }, 400);

  const db = getDb();
  const existing = await db
    .prepare('SELECT id FROM saved_pgs WHERE user_id = ? AND property_id = ?')
    .bind(user.id, propertyId)
    .first();

  if (existing) {
    await db
      .prepare('DELETE FROM saved_pgs WHERE user_id = ? AND property_id = ?')
      .bind(user.id, propertyId)
      .run();
    await recordEvent(db, propertyId, user.id, 'UNSAVE', null).catch(() => {});
    return json({ saved: false });
  }

  await db.prepare('INSERT INTO saved_pgs (user_id, property_id) VALUES (?, ?)').bind(user.id, propertyId).run();
  await recordEvent(db, propertyId, user.id, 'SAVE', null).catch(() => {});
  return json({ saved: true });
}
