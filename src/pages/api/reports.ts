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
    // Allow mock IDs, just check non-empty; for D1 listings, verify if exists but don't fail for mock
    if (target_id.length < 3) return json({ error: 'Invalid pg id.' }, 400);
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
