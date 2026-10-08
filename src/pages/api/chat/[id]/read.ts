import type { APIContext } from 'astro';
import { getDb, json, requireAuth } from '@/lib/server/auth';
import { canReadConversation } from '@/lib/chatRules';
import { getConversation, markConversationRead, unreadCount } from '@/lib/server/chat';

export const prerender = false;

/**
 * POST /api/chat/:id/read — move the viewer's read watermark forward.
 *
 * Only the viewer's own side of the thread moves, and only when the viewer is
 * actually one of the two participants: an admin browsing a thread for support
 * must not silently mark the student's messages as read.
 */
export async function POST(context: APIContext) {
  const auth = await requireAuth(context);
  if ('error' in auth) return auth.error;

  const db = getDb();
  const conversation = await getConversation(db, context.params.id ?? '');
  if (!conversation) return json({ error: 'Conversation not found.' }, 404);
  if (!canReadConversation(conversation, auth.user.id, Boolean(auth.user.is_admin))) {
    return json({ error: 'Not your conversation.' }, 403);
  }

  await markConversationRead(db, conversation, auth.user.id);
  return json({ ok: true, unread: await unreadCount(db, auth.user.id) });
}
