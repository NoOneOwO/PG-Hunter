import type { APIContext } from 'astro';
import { currentUser, getDb, json, readBody } from '@/lib/server/auth';
import { recordEvent } from '@/lib/server/engagement';

export const prerender = false;

export async function POST(context: APIContext) {
  const user = await currentUser(context);
  if (!user) return json({ error: 'Not logged in.' }, 401);

  const body = await readBody(context);
  const propertyId = String(body?.propertyId ?? '').trim();
  if (!propertyId) return json({ error: 'Missing property id.' }, 400);

  const db = getDb();
  await db
    .prepare(
      'INSERT INTO leads (property_id, student_id, budget, move_in_month, message, source) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(
      propertyId,
      user.id,
      String(body?.budget ?? '').trim() || null,
      String(body?.moveInMonth ?? '').trim() || null,
      String(body?.message ?? '').trim() || null,
      'web'
    )
    .run();
  await recordEvent(db, propertyId, user.id, 'ENQUIRY', null).catch(() => {});

  return json({ ok: true });
}
