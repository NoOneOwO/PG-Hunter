/**
 * PG Hunter — chat storage (D1), used by /api/chat/* and the media route.
 *
 * Decisions (who may read, who may write, what counts as a valid attachment)
 * live in src/lib/chatRules.ts and are unit tested there. This module only
 * moves rows.
 */

import { nowIso } from './auth';
import { avatarUrlFor } from './auth';
import { mediaUrl } from './media';
import { messagePreview, viewerSide, type ChatKind } from '../chatRules';

export interface ConversationRow {
  id: string;
  student_id: string;
  owner_id: string;
  listing_id: string | null;
  /** The enquiry this thread answers, or null for a chat started any other way. */
  enquiry_lead_id: number | null;
  created_at: string;
  last_message_at: string | null;
  student_read_at: string | null;
  owner_read_at: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: ChatKind;
  body: string;
  file_key: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface ChatCounterpart {
  id: string;
  name: string;
  role: 'student' | 'owner';
  avatar: string | null;
}

export interface ChatConversationDto {
  id: string;
  listingId: string | null;
  listingName: string | null;
  /** The thread answers the student's enquiry — drives the student's inbox label. */
  enquiryReply: boolean;
  /** Who the viewer is talking to. */
  counterpart: ChatCounterpart;
  lastMessage: { kind: ChatKind; preview: string; createdAt: string; fromMe: boolean } | null;
  unread: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageDto {
  id: string;
  /** Monotonic cursor for polling — the message row's insertion sequence. */
  seq: number;
  senderId: string;
  fromMe: boolean;
  kind: ChatKind;
  body: string;
  createdAt: string;
  attachment: {
    url: string;
    name: string;
    mime: string;
    size: number;
    durationMs: number | null;
  } | null;
}

export const messageDto = (
  row: MessageRow & { seq: number },
  viewerId: string
): ChatMessageDto => ({
  id: row.id,
  seq: row.seq,
  senderId: row.sender_id,
  fromMe: row.sender_id === viewerId,
  kind: row.kind,
  body: row.body,
  createdAt: row.created_at,
  attachment:
    row.file_key && row.kind !== 'text'
      ? {
          url: mediaUrl(row.file_key),
          name: row.file_name ?? 'Attachment',
          mime: row.mime_type ?? 'application/octet-stream',
          size: row.size_bytes ?? 0,
          durationMs: row.duration_ms,
        }
      : null,
});

/**
 * Every conversation the viewer is part of, newest activity first.
 *
 * Counterpart, last message and unread count are resolved in the same query as
 * correlated subqueries rather than one round trip per conversation — the list
 * is up to 100 rows and D1 round trips are the expensive part here.
 */
export const listConversations = async (
  db: D1Database,
  viewerId: string
): Promise<ChatConversationDto[]> => {
  const res = await db
    .prepare(
      `SELECT c.*,
              s.name AS student_name, s.avatar_url AS student_avatar,
              o.name AS owner_name,   o.avatar_url AS owner_avatar,
              ol.name AS listing_name,
              (SELECT COUNT(*) FROM messages m
                WHERE m.conversation_id = c.id
                  AND m.sender_id <> ?1
                  AND m.created_at > COALESCE(
                        CASE WHEN c.student_id = ?1 THEN c.student_read_at ELSE c.owner_read_at END,
                        '')) AS unread,
              (SELECT m.kind      FROM messages m WHERE m.conversation_id = c.id ORDER BY m.rowid DESC LIMIT 1) AS last_kind,
              (SELECT m.body      FROM messages m WHERE m.conversation_id = c.id ORDER BY m.rowid DESC LIMIT 1) AS last_body,
              (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.rowid DESC LIMIT 1) AS last_sender,
              (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.rowid DESC LIMIT 1) AS last_created
       FROM conversations c
       JOIN users s ON s.id = c.student_id
       JOIN users o ON o.id = c.owner_id
       LEFT JOIN owner_listings ol ON ol.id = c.listing_id
       WHERE c.student_id = ?1 OR c.owner_id = ?1
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
       LIMIT 100`
    )
    .bind(viewerId)
    .all<
      ConversationRow & {
        student_name: string;
        student_avatar: string | null;
        owner_name: string;
        owner_avatar: string | null;
        listing_name: string | null;
        unread: number;
        last_kind: ChatKind | null;
        last_body: string | null;
        last_sender: string | null;
        last_created: string | null;
      }
    >();

  return res.results.map((row) => {
    const viewerIsStudent = row.student_id === viewerId;
    const counterpart: ChatCounterpart = viewerIsStudent
      ? {
          id: row.owner_id,
          name: row.owner_name,
          role: 'owner',
          avatar: avatarUrlFor(row.owner_avatar),
        }
      : {
          id: row.student_id,
          name: row.student_name,
          role: 'student',
          avatar: avatarUrlFor(row.student_avatar),
        };

    return {
      id: row.id,
      listingId: row.listing_id,
      listingName: row.listing_name,
      enquiryReply: row.enquiry_lead_id !== null,
      counterpart,
      lastMessage:
        row.last_kind && row.last_created
          ? {
              kind: row.last_kind,
              preview: messagePreview(row.last_kind, row.last_body ?? ''),
              createdAt: row.last_created,
              fromMe: row.last_sender === viewerId,
            }
          : null,
      unread: Number(row.unread ?? 0),
      createdAt: row.created_at,
      updatedAt: row.last_message_at ?? row.created_at,
    };
  });
};

/** The conversation row, or null. Access decisions are the caller's job. */
export const getConversation = (db: D1Database, id: string): Promise<ConversationRow | null> =>
  db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .bind(id)
    .first<ConversationRow>()
    .then((row) => row ?? null);

/**
 * Find the student/owner/listing triple, or create it.
 *
 * The lookup is explicit (rather than relying on INSERT OR IGNORE) because
 * `listing_id` is nullable and SQLite treats NULLs as distinct in a UNIQUE
 * index — two "start a chat" taps without a listing would otherwise create two
 * conversations about nothing.
 */
export const findOrCreateConversation = async (
  db: D1Database,
  input: {
    studentId: string;
    ownerId: string;
    listingId: string | null;
    /** Set when the owner is answering an enquiry, so the student's inbox can say so. */
    enquiryLeadId?: number | null;
  }
): Promise<ConversationRow> => {
  const existing = input.listingId
    ? await db
        .prepare(
          'SELECT * FROM conversations WHERE student_id = ? AND owner_id = ? AND listing_id = ?'
        )
        .bind(input.studentId, input.ownerId, input.listingId)
        .first<ConversationRow>()
    : await db
        .prepare(
          'SELECT * FROM conversations WHERE student_id = ? AND owner_id = ? AND listing_id IS NULL'
        )
        .bind(input.studentId, input.ownerId)
        .first<ConversationRow>();
  if (existing) {
    // A thread that already existed (the student messaged first) still becomes
    // an enquiry reply the moment the owner answers the enquiry from the
    // dashboard. Never the other way round: an established label is not
    // withdrawn by a later visit that omits the lead.
    if (input.enquiryLeadId && !existing.enquiry_lead_id) {
      await db
        .prepare('UPDATE conversations SET enquiry_lead_id = ? WHERE id = ?')
        .bind(input.enquiryLeadId, existing.id)
        .run();
      return { ...existing, enquiry_lead_id: input.enquiryLeadId };
    }
    return existing;
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO conversations (id, student_id, owner_id, listing_id, enquiry_lead_id, created_at,
                                  last_message_at, student_read_at, owner_read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.studentId,
      input.ownerId,
      input.listingId,
      input.enquiryLeadId ?? null,
      now,
      now,
      now,
      now
    )
    .run();

  const created = await getConversation(db, id);
  if (!created) throw new Error('Could not start that conversation.');
  return created;
};

/**
 * Messages in a conversation, oldest first.
 *
 * `afterSeq` is a message rowid: the thread is append-only, so "everything
 * newer than the last thing I saw" is exact and cheap, and polling never
 * re-sends a message it already delivered.
 */
export const listMessages = async (
  db: D1Database,
  conversationId: string,
  options: { afterSeq?: number; limit?: number; viewerId: string }
): Promise<ChatMessageDto[]> => {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 200);
  const afterSeq = Number.isFinite(options.afterSeq) ? Number(options.afterSeq) : 0;

  const res = await db
    .prepare(
      `SELECT rowid AS seq, * FROM messages
       WHERE conversation_id = ? AND rowid > ?
       ORDER BY rowid
       LIMIT ?`
    )
    .bind(conversationId, afterSeq, limit)
    .all<MessageRow & { seq: number }>();

  return res.results.map((row) => messageDto(row, options.viewerId));
};

export interface InsertMessageInput {
  conversationId: string;
  senderId: string;
  kind: ChatKind;
  body?: string;
  file?: {
    key: string;
    name: string;
    mime: string;
    size: number;
    durationMs?: number | null;
  };
}

/** Append a message and move the conversation's activity clock. */
export const insertMessage = async (
  db: D1Database,
  input: InsertMessageInput
): Promise<ChatMessageDto> => {
  const id = crypto.randomUUID();
  const now = nowIso();

  await db
    .prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, kind, body, file_key, file_name,
                             mime_type, size_bytes, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.conversationId,
      input.senderId,
      input.kind,
      (input.body ?? '').trim(),
      input.file?.key ?? null,
      input.file?.name ?? null,
      input.file?.mime ?? null,
      input.file?.size ?? null,
      input.file?.durationMs ?? null,
      now
    )
    .run();

  await db
    .prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?')
    .bind(now, input.conversationId)
    .run();

  const row = await db
    .prepare('SELECT rowid AS seq, * FROM messages WHERE id = ?')
    .bind(id)
    .first<MessageRow & { seq: number }>();
  if (!row) throw new Error('Could not save that message.');
  return messageDto(row, input.senderId);
};

/**
 * Move the viewer's read watermark to now.
 *
 * Only the viewer's own side moves, and the update is written as a plain
 * comparison so a slow request cannot drag a newer watermark backwards.
 */
export const markConversationRead = async (
  db: D1Database,
  conversation: ConversationRow,
  viewerId: string
): Promise<void> => {
  const side = viewerSide(conversation, viewerId);
  if (!side) return;
  const column = side === 'student' ? 'student_read_at' : 'owner_read_at';
  const now = nowIso();
  await db
    .prepare(
      `UPDATE conversations
          SET ${column} = ?
        WHERE id = ? AND (${column} IS NULL OR ${column} < ?)`
    )
    .bind(now, conversation.id, now)
    .run();
};

/** Total unread across the viewer's conversations — used for nav badges. */
export const unreadCount = async (db: D1Database, viewerId: string): Promise<number> => {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE (c.student_id = ?1 OR c.owner_id = ?1)
          AND m.sender_id <> ?1
          AND m.created_at > COALESCE(
                CASE WHEN c.student_id = ?1 THEN c.student_read_at ELSE c.owner_read_at END,
                '')`
    )
    .bind(viewerId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
};

/**
 * Everything the thread view needs: the row, both participants and the listing
 * it is about.
 *
 * The thread is the one place an admin can land without being a participant
 * (support), so it returns BOTH parties by name rather than a single
 * "counterpart" — a support view has to be unambiguous about whose chat it is.
 */
export interface ConversationContext {
  conversation: ConversationRow;
  listingName: string | null;
  participants: {
    student: ChatCounterpart;
    owner: ChatCounterpart;
  };
}

export const getConversationContext = async (
  db: D1Database,
  id: string
): Promise<ConversationContext | null> => {
  const row = await getConversation(db, id);
  if (!row) return null;

  const [student, owner, listing] = await Promise.all([
    db.prepare('SELECT id, name, avatar_url FROM users WHERE id = ?').bind(row.student_id).first<{
      id: string;
      name: string;
      avatar_url: string | null;
    }>(),
    db.prepare('SELECT id, name, avatar_url FROM users WHERE id = ?').bind(row.owner_id).first<{
      id: string;
      name: string;
      avatar_url: string | null;
    }>(),
    row.listing_id
      ? db
          .prepare('SELECT name FROM owner_listings WHERE id = ?')
          .bind(row.listing_id)
          .first<{ name: string }>()
      : Promise.resolve(null),
  ]);

  return {
    conversation: row,
    listingName: listing?.name ?? null,
    participants: {
      student: {
        id: row.student_id,
        name: student?.name ?? 'Student',
        role: 'student',
        avatar: avatarUrlFor(student?.avatar_url ?? null),
      },
      owner: {
        id: row.owner_id,
        name: owner?.name ?? 'Owner',
        role: 'owner',
        avatar: avatarUrlFor(owner?.avatar_url ?? null),
      },
    },
  };
};

export { canReadConversation, canWriteConversation, viewerSide } from '../chatRules';
