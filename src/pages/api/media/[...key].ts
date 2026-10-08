import type { APIContext } from 'astro';
import { currentUser, getDb } from '@/lib/server/auth';
import { canReadConversation, conversationIdFromKey } from '@/lib/chatRules';
import { getObject } from '@/lib/server/media';

export const prerender = false;

/**
 * Stream an R2 object back to the browser.
 *
 * Listing images/documents are public; verification documents and chat
 * attachments are private. Verification files are readable by the submitting
 * owner (and admins); chat files only by the two people in the conversation.
 */
export async function GET(context: APIContext) {
  const key = Array.isArray(context.params.key)
    ? context.params.key.join('/')
    : (context.params.key ?? '');
  if (!key) return new Response('Not found', { status: 404 });

  // Chat attachments carry the conversation id in their key, so the check is
  // "is the requester in this conversation" rather than a lookup by file.
  const chatConversationId = conversationIdFromKey(key);
  if (chatConversationId) {
    const conversation = await getDb()
      .prepare('SELECT student_id, owner_id FROM conversations WHERE id = ?')
      .bind(chatConversationId)
      .first<{ student_id: string; owner_id: string }>();
    if (!conversation) return new Response('Not found', { status: 404 });
    const user = await currentUser(context);
    if (!user || !canReadConversation(conversation, user.id, Boolean(user.is_admin))) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  if (key.startsWith('verification/')) {
    const doc = await getDb()
      .prepare('SELECT owner_id FROM verification_documents WHERE file_key = ?')
      .bind(key)
      .first<{ owner_id: string }>();
    if (!doc) return new Response('Not found', { status: 404 });
    const user = await currentUser(context);
    if (!user || (user.id !== doc.owner_id && !user.is_admin)) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  let object: Awaited<ReturnType<typeof getObject>>;
  try {
    object = await getObject(key);
  } catch {
    return new Response('Not found', { status: 404 });
  }

  if (!object) {
    // If the object vanished from R2 after we knew the key existed, return a
    // clean 404 so the browser never hangs on a stale URL.
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  // Private objects must never be cached as shared: a `public` response for a
  // chat attachment could be served by an edge cache to anyone holding the URL.
  headers.set(
    'Cache-Control',
    chatConversationId
      ? 'private, max-age=300'
      : key.startsWith('verification/')
        ? 'private, no-store'
        : 'public, max-age=31536000, immutable'
  );
  if (chatConversationId || key.startsWith('verification/')) headers.set('Vary', 'Cookie');
  headers.set('Content-Length', String(object.size));

  return new Response(object.body, { headers });
}
