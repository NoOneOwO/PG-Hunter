/**
 * PG Hunter — client chat API (browser side).
 *
 * Same-origin fetch against /api/chat/*; sessions stay in httpOnly cookies, so
 * nothing here handles tokens. Kept separate from lib/auth.ts because chat is
 * used by both the student and the owner shells and should not drag the whole
 * auth surface into either page bundle.
 */

import type { ChatKind } from './chatRules';

export interface ChatCounterpart {
  id: string;
  name: string;
  role: 'student' | 'owner';
  avatar: string | null;
}

export interface ChatConversation {
  id: string;
  listingId: string | null;
  listingName: string | null;
  /** The owner opened this thread in answer to the student's enquiry. */
  enquiryReply: boolean;
  counterpart: ChatCounterpart;
  lastMessage: { kind: ChatKind; preview: string; createdAt: string; fromMe: boolean } | null;
  unread: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatAttachment {
  url: string;
  name: string;
  mime: string;
  size: number;
  durationMs: number | null;
}

export interface ChatMessage {
  id: string;
  seq: number;
  senderId: string;
  fromMe: boolean;
  kind: ChatKind;
  body: string;
  createdAt: string;
  attachment: ChatAttachment | null;
}

export interface ChatThread {
  conversation: {
    id: string;
    listingId: string | null;
    listingName: string | null;
    enquiryReply: boolean;
    participants: { student: ChatCounterpart; owner: ChatCounterpart };
    canWrite: boolean;
  };
  messages: ChatMessage[];
}

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
};

export const getConversations = (): Promise<{ conversations: ChatConversation[]; unread: number }> =>
  api('/api/chat');

/**
 * Start (or reopen) a conversation.
 *
 * Students pass `ownerId` (+ the PG it is about); owners pass `studentId`,
 * plus `enquiryLeadId` when the thread answers an enquiry — that is what the
 * student's inbox labels as a reply. The server decides the other side from
 * the session, so neither can name a third participant.
 */
export const startConversation = (input: {
  ownerId?: string;
  studentId?: string;
  listingId?: string;
  enquiryLeadId?: number;
}): Promise<{ conversation: ChatConversation | null; conversationId: string }> =>
  api('/api/chat', { method: 'POST', body: JSON.stringify(input) });

/** Thread contents, or only what arrived after `afterSeq` when polling. */
export const getThread = (conversationId: string, afterSeq?: number): Promise<ChatThread> =>
  api(
    `/api/chat/${encodeURIComponent(conversationId)}${
      Number.isFinite(afterSeq) ? `?after=${Number(afterSeq)}` : ''
    }`
  );

export const sendTextMessage = (
  conversationId: string,
  body: string
): Promise<{ message: ChatMessage }> =>
  api(`/api/chat/${encodeURIComponent(conversationId)}`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });

/** Upload one attachment; `durationMs` is only meaningful for voice notes. */
export const sendAttachment = (
  conversationId: string,
  file: File,
  options: { caption?: string; durationMs?: number } = {}
): Promise<{ message: ChatMessage }> => {
  const form = new FormData();
  form.append('file', file);
  if (options.caption) form.append('caption', options.caption);
  if (options.durationMs) form.append('durationMs', String(Math.round(options.durationMs)));
  return api(`/api/chat/${encodeURIComponent(conversationId)}`, { method: 'POST', body: form });
};

export const markThreadRead = (
  conversationId: string
): Promise<{ ok: boolean; unread: number }> =>
  api(`/api/chat/${encodeURIComponent(conversationId)}/read`, { method: 'POST' });
