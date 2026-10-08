import type { APIContext } from 'astro';
import { currentUser, getDb, json, nowIso, readBody } from '@/lib/server/auth';

export const prerender = false;

const VALID_TARGET = new Set(['experience', 'pg', 'media', 'owner']);
const VALID_REASON = new Set(['spam', 'abuse', 'fake', 'inappropriate', 'other']);

export async function POST(context: APIContext) {
  const user = await currentUser(context);
  if (!user) return json({ error: 'Not logged in.' }, 401);

  const body = await readBody(context);
  const target_type = String(body?.target_type ?? body?.targetType ?? '').trim();
  const target_id = String(body?.target_id ?? body?.targetId ?? '').trim();
  const reason = String(body?.reason ?? '').trim();
  const description = body?.description ? String(body.description).trim().slice(0, 1000) : null;

  if (!VALID_TARGET.has(target_type)) return json({ error: 'Invalid target_type.' }, 400);
  if (!target_id) return json({ error: 'Missing target_id.' }, 400);
  if (!VALID_REASON.has(reason)) return json({ error: 'Invalid reason.' }, 400);
  if (description && description.length > 1000) return json({ error: 'Description too long.' }, 400);

  const db = getDb();

  // Verify target exists for experience
  if (target_type === 'experience') {
    const exists = await db.prepare(`SELECT id FROM pg_experiences WHERE id = ?`).bind(target_id).first();
    if (!exists) return json({ error: 'Experience not found.' }, 404);
  } else if (target_type === 'pg') {
    // Every PG id is a D1 listing id now, so an unknown one is a bad request.
    // The old "accept any non-empty id" rule only existed to let reports point
    // at the bundled mock catalogue, which is gone.
    const exists = await db
      .prepare(`SELECT id FROM owner_listings WHERE id = ?`)
      .bind(target_id)
      .first();
    if (!exists) return json({ error: 'Listing not found.' }, 404);
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
    )
    .bind(id, user.id, target_type, target_id, reason, description, now)
    .run();

  return json({ report: { id, target_type, target_id, reason, status: 'open', created_at: now } }, 201);
}
