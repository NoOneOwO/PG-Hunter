import type { APIContext } from 'astro';
import { getDb, json, nowIso, readBody, requireAuth } from '@/lib/server/auth';
import {
  canReadConversation,
  canWriteConversation,
  chatKeyPrefix,
  chatTextError,
  validateChatAttachment,
} from '@/lib/chatRules';
import { getConversationContext, insertMessage, listMessages } from '@/lib/server/chat';
import { storeObject } from '@/lib/server/media';

export const prerender = false;

/**
 * Resolve the conversation and check the viewer may read it.
 *
 * Admins pass the read check so the team can look at a thread when someone
 * reports a problem; writing is checked separately and is participants-only.
 */
const readable = async (context: APIContext) => {
  const auth = await requireAuth(context);
  if ('error' in auth) return { error: auth.error, context: null };

  const id = context.params.id ?? '';
  const found = id ? await getConversationContext(getDb(), id) : null;
  if (!found) return { error: json({ error: 'Conversation not found.' }, 404), context: null };

  const allowed = canReadConversation(found.conversation, auth.user.id, Boolean(auth.user.is_admin));
  if (!allowed) return { error: json({ error: 'Not your conversation.' }, 403), context: null };
  return { error: null, context: { ...found, viewer: auth.user } };
};

/**
 * GET /api/chat/:id[?after=<seq>]
 *
 * Without `after`, the most recent 200 messages; with it, only what arrived
 * since (the client's poll). Either way the response carries everything needed
 * to render the header, so a poll cannot drift from the thread.
 */
export async function GET(context: APIContext) {
  const result = await readable(context);
  if (result.error) return result.error;
  const { conversation, participants, listingName, viewer } = result.context!;

  const afterRaw = new URL(context.request.url).searchParams.get('after');
  const afterSeq = afterRaw ? Number(afterRaw) : 0;
  if (afterRaw && !Number.isFinite(afterSeq)) {
    return json({ error: 'after must be a message sequence number.' }, 400);
  }

  const messages = await listMessages(getDb(), conversation.id, {
    afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0,
    viewerId: viewer.id,
  });

  return json({
    conversation: {
      id: conversation.id,
      listingId: conversation.listing_id,
      listingName,
      participants,
      // The client uses this to decide whether to show a composer at all.
      canWrite: canWriteConversation(conversation, viewer.id),
    },
    messages,
  });
}

/**
 * POST /api/chat/:id
 *
 * Two shapes on one endpoint, because both are "send a message":
 *   - application/json  { body }                 a text message
 *   - multipart         file, caption?, durationMs?  an attachment
 *
 * The attachment's kind is derived from its declared content type against a
 * fixed allowlist (see lib/chatRules.ts) and the bytes land in R2 under
 * `chat/{conversationId}/…`, which /api/media only serves to participants.
 */
export async function POST(context: APIContext) {
  const result = await readable(context);
  if (result.error) return result.error;
  const { conversation, viewer } = result.context!;

  if (!canWriteConversation(conversation, viewer.id)) {
    return json(
      {
        error:
          'You can read this conversation but not post in it — only the student and the owner can reply.',
      },
      403
    );
  }

  const db = getDb();
  const contentType = context.request.headers.get('Content-Type') ?? '';

  // ---------------------------------------------------------- attachment
  if (contentType.includes('multipart/form-data')) {
    const form = await context.request.formData().catch(() => null);
    if (!form) return json({ error: 'Expected multipart form data.' }, 400);

    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'Missing "file" field.' }, 400);

    const check = validateChatAttachment(file.type, file.size);
    if (!check.ok) return json({ error: check.error }, 400);

    const caption = String(form.get('caption') ?? '').trim().slice(0, 500);
    const durationRaw = Number(form.get('durationMs'));
    const durationMs =
      check.kind === 'audio' && Number.isFinite(durationRaw) && durationRaw > 0
        ? Math.round(durationRaw)
        : null;

    const key = await storeObject(
      chatKeyPrefix(conversation.id).replace(/\/$/, ''),
      file.name || `${check.kind}`,
      file.type.split(';')[0].trim(),
      await file.arrayBuffer()
    );

    const message = await insertMessage(db, {
      conversationId: conversation.id,
      senderId: viewer.id,
      kind: check.kind,
      body: caption,
      file: {
        key,
        name: file.name || `${check.kind}`,
        mime: file.type.split(';')[0].trim(),
        size: file.size,
        durationMs,
      },
    });

    return json({ message }, 201);
  }

  // ---------------------------------------------------------------- text
  const body = await readBody(context);
  if (!body) return json({ error: 'Invalid request body.' }, 400);

  const textError = chatTextError(body.body);
  if (textError) return json({ error: textError }, 400);

  const message = await insertMessage(db, {
    conversationId: conversation.id,
    senderId: viewer.id,
    kind: 'text',
    body: String(body.body).trim(),
  });

  // A reply is the clearest signal there is something to read, so the sender's
  // own side is marked read at the same time — their own message never counts
  // as unread to them.
  await db
    .prepare(
      `UPDATE conversations
          SET ${conversation.student_id === viewer.id ? 'student_read_at' : 'owner_read_at'} = ?
        WHERE id = ?`
    )
    .bind(nowIso(), conversation.id)
    .run();

  return json({ message }, 201);
}
