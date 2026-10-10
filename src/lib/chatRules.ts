/**
 * PG Hunter — pure chat rules.
 *
 * Deliberately free of `cloudflare:workers` / `env` so the decisions can be
 * unit tested under plain Node (see test/chat.test.mts). Everything that talks
 * to D1 or R2 lives in src/lib/server/chat.ts and calls in here.
 *
 * Two rules worth stating out loud, because they are privacy rules rather than
 * preferences:
 *
 *   1. A conversation has exactly two possible readers — its student and its
 *      owner. Files sent in one are not public: the R2 key carries the
 *      conversation id and /api/media refuses anyone who is not a participant.
 *   2. Admins may *read* a thread when helping with a support issue, but they
 *      may not send messages as somebody else. Support access is read-only.
 */

export const CHAT_KINDS = ['text', 'image', 'video', 'document', 'audio'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export type ChatAttachmentKind = Exclude<ChatKind, 'text'>;

export const isChatKind = (value: unknown): value is ChatKind =>
  typeof value === 'string' && (CHAT_KINDS as readonly string[]).includes(value);

export const isAttachmentKind = (value: unknown): value is ChatAttachmentKind =>
  value === 'image' || value === 'video' || value === 'document' || value === 'audio';

/** Longest text message. Sized for a real reply, not for a document dump. */
export const MAX_CHAT_TEXT = 2000;

/** Longest voice note, in milliseconds (3 minutes). */
export const MAX_AUDIO_MS = 3 * 60 * 1000;

/**
 * Per-kind size caps, in bytes.
 *
 * Chat is the one place a student can send a video, so the video cap is the
 * loosest. It stays well under the Workers request-body ceiling because the
 * whole file has to pass through the Worker to reach R2.
 */
export const CHAT_SIZE_LIMITS: Record<ChatAttachmentKind, number> = {
  image: 10 * 1024 * 1024, // 10 MB
  video: 50 * 1024 * 1024, // 50 MB
  document: 15 * 1024 * 1024, // 15 MB
  audio: 20 * 1024 * 1024, // 20 MB
};

/**
 * Accepted content types, grouped by the kind they map to.
 *
 * Matching is on the server against what the browser declared, and the kind is
 * derived from that declaration rather than trusted from the client — a
 * "document" that the client labels an image would otherwise be served back as
 * an image from /api/media.
 */
export const CHAT_MIME_TYPES: Record<ChatAttachmentKind, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'],
  // Documents are deliberately narrow: PDFs and plain text. No office formats,
  // which are the ones that carry macros.
  document: ['application/pdf', 'text/plain', 'text/csv'],
  // MediaRecorder emits webm (Chrome/Firefox) or mp4 (Safari); the rest
  // covers files recorded elsewhere and then attached.
  audio: ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a'],
};

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Which kind an uploaded content type belongs to, or null when unsupported. */
export const attachmentKindFor = (mime: string): ChatAttachmentKind | null => {
  const normalized = (mime ?? '').split(';')[0].trim().toLowerCase();
  for (const kind of ['image', 'video', 'document', 'audio'] as ChatAttachmentKind[]) {
    if (CHAT_MIME_TYPES[kind].includes(normalized)) return kind;
  }
  return null;
};

export type AttachmentCheck =
  | { ok: true; kind: ChatAttachmentKind }
  | { ok: false; error: string };

/**
 * Validate a chat upload by content type and size.
 *
 * `declaredMime` is what the browser reported. It is checked against a fixed
 * allowlist so a file can only land in a kind we know how to serve back
 * safely.
 */
export const validateChatAttachment = (declaredMime: string, size: number): AttachmentCheck => {
  const kind = attachmentKindFor(declaredMime);
  if (!kind) {
    return {
      ok: false,
      error: 'You can send images, videos, audio notes, PDFs or text files.',
    };
  }
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'That file is empty.' };
  const limit = CHAT_SIZE_LIMITS[kind];
  if (size > limit) {
    return {
      ok: false,
      error: `That ${kind} is too large — the limit is ${formatBytes(limit)}.`,
    };
  }
  return { ok: true, kind };
};

/** Validate a text message body; returns an error message or null. */
export const chatTextError = (body: unknown): string | null => {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) return 'Type a message first.';
  if (text.length > MAX_CHAT_TEXT) {
    return `Keep messages under ${MAX_CHAT_TEXT} characters.`;
  }
  return null;
};

/* ------------------------------------------------------------------ */
/* R2 key layout + access                                              */
/* ------------------------------------------------------------------ */

/** Object keys for chat files are namespaced by conversation. */
export const chatKeyPrefix = (conversationId: string): string => `chat/${conversationId}/`;

/**
 * The conversation a stored object belongs to, or null when the key is not a
 * chat key. Used by /api/media to decide whether a private object may be read.
 */
export const conversationIdFromKey = (key: string): string | null => {
  const match = /^chat\/([^/]+)\//.exec(key);
  return match ? match[1] : null;
};

export interface ConversationParties {
  student_id: string;
  owner_id: string;
}

/**
 * May `viewerId` read this conversation?
 * Admins get read access for support; nobody else.
 */
export const canReadConversation = (
  conversation: ConversationParties,
  viewerId: string,
  isAdmin = false
): boolean =>
  Boolean(isAdmin) ||
  conversation.student_id === viewerId ||
  conversation.owner_id === viewerId;

/**
 * May `viewerId` post into this conversation?
 *
 * Strictly participants — an admin who is not one of the two people in the
 * thread cannot speak with either of their voices. This is the one place where
 * admin power deliberately stops.
 */
export const canWriteConversation = (
  conversation: ConversationParties,
  viewerId: string
): boolean => conversation.student_id === viewerId || conversation.owner_id === viewerId;

/** One-line preview for the conversation list. */
export const messagePreview = (kind: ChatKind, body: string): string => {
  if (kind === 'image') return 'Photo';
  if (kind === 'video') return 'Video';
  if (kind === 'document') return 'Document';
  if (kind === 'audio') return 'Voice message';
  return body.length > 90 ? `${body.slice(0, 90)}…` : body;
};

/**
 * The line under a conversation the owner opened in answer to the student's
 * enquiry — the student's inbox has to say why an owner is suddenly writing.
 * Shared by the conversation list and the thread header so the two never
 * disagree, and pure so it is unit tested like the rest of this file.
 */
export const enquiryReplyLabel = (listingName: string | null | undefined): string =>
  listingName
    ? `Reply to your enquiry about ${listingName}`
    : 'Reply to your enquiry';

/** Which side of a conversation the viewer is on. */
export const viewerSide = (
  conversation: ConversationParties,
  viewerId: string
): 'student' | 'owner' | null => {
  if (conversation.student_id === viewerId) return 'student';
  if (conversation.owner_id === viewerId) return 'owner';
  return null;
};
