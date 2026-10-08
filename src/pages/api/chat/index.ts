import type { APIContext } from 'astro';
import { getDb, json, readBody, requireAuth } from '@/lib/server/auth';
import { findOrCreateConversation, listConversations, unreadCount } from '@/lib/server/chat';

export const prerender = false;

/** GET /api/chat — the viewer's conversations, with unread counts. */
export async function GET(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;

  const db = getDb();
  const [conversations, unread] = await Promise.all([
    listConversations(db, auth.user.id),
    unreadCount(db, auth.user.id),
  ]);
  return json({ conversations, unread });
}

/**
 * POST /api/chat — start (or reopen) a conversation with a counterpart.
 *
 * A student opens one with an owner; an owner can open one with a student.
 * Whoever is not asking is the counterpart, so the same endpoint serves both
 * dashboards without either being able to invent a third participant.
 */
export async function POST(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;
  const viewer = auth.user;

  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const listingId = String(body.listingId ?? '').trim() || null;
  const db = getDb();

  let studentId: string;
  let ownerId: string;

  if (viewer.role === 'owner') {
    studentId = String(body.studentId ?? '').trim();
    ownerId = viewer.id;
    if (!studentId) return json({ error: 'Pick the student to message.' }, 400);
    const student = await db
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'student'")
      .bind(studentId)
      .first<{ id: string }>();
    if (!student) return json({ error: 'That student account does not exist.' }, 404);
  } else {
    ownerId = String(body.ownerId ?? '').trim();
    studentId = viewer.id;
    if (!ownerId) return json({ error: 'Pick the owner to message.' }, 400);
    const owner = await db
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'owner'")
      .bind(ownerId)
      .first<{ id: string }>();
    if (!owner) return json({ error: 'That owner account does not exist.' }, 404);
  }

  // A listing may only ever ride along on its own owner's conversation,
  // otherwise a thread could be tagged with somebody else's PG.
  if (listingId) {
    const listing = await db
      .prepare('SELECT id FROM owner_listings WHERE id = ? AND owner_id = ?')
      .bind(listingId, ownerId)
      .first<{ id: string }>();
    if (!listing) return json({ error: 'That PG could not be found for this owner.' }, 404);
  }

  const conversation = await findOrCreateConversation(db, { studentId, ownerId, listingId });
  const dto = (await listConversations(db, viewer.id)).find((c) => c.id === conversation.id) ?? null;
  return json({ conversation: dto, conversationId: conversation.id }, 201);
}
