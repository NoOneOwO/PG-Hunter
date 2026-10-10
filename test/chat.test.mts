/**
 * PG Hunter — chat rules tests.
 *
 * Chat is a privacy boundary, not just a UI feature, so the rules are tested
 * directly instead of through the interface:
 *
 *   1. An attachment can only land in a kind we know how to serve back safely,
 *      and the kind is derived from the declared type rather than trusted from
 *      the client.
 *   2. Size caps hold per kind, and an unsupported file is refused before a
 *      single byte reaches R2.
 *   3. Read access covers the two participants (and admins, for support) while
 *      write access is participants only — nobody posts in someone else's voice.
 *   4. Every chat R2 key maps back to its conversation, which is what
 *      /api/media checks before streaming a private file.
 *   5. The kind vocabulary the code uses and the CHECK constraint in migration
 *      0012 cannot drift apart.
 *   6. A conversation opened from an enquiry carries the label the student's
 *      inbox shows, which lives on the row (migration 0014).
 *
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CHAT_KINDS,
  CHAT_SIZE_LIMITS,
  MAX_CHAT_TEXT,
  attachmentKindFor,
  canReadConversation,
  canWriteConversation,
  chatKeyPrefix,
  chatTextError,
  conversationIdFromKey,
  enquiryReplyLabel,
  isChatKind,
  messagePreview,
  validateChatAttachment,
  viewerSide,
} from '../src/lib/chatRules.ts';

const here = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* Attachment validation                                               */
/* ------------------------------------------------------------------ */

test('each supported type maps to its kind', () => {
  assert.equal(attachmentKindFor('image/jpeg'), 'image');
  assert.equal(attachmentKindFor('image/png'), 'image');
  assert.equal(attachmentKindFor('video/mp4'), 'video');
  assert.equal(attachmentKindFor('application/pdf'), 'document');
  assert.equal(attachmentKindFor('text/plain'), 'document');
  assert.equal(attachmentKindFor('audio/webm'), 'audio');
});

test('content types are matched ignoring parameters and case', () => {
  // MediaRecorder sends codec parameters in the type; Safari reports mp4.
  assert.equal(attachmentKindFor('audio/webm;codecs=opus'), 'audio');
  assert.equal(attachmentKindFor('AUDIO/MP4'), 'audio');
  assert.equal(attachmentKindFor(' image/JPEG '), 'image');
});

test('the kind comes from the bytes type, never from the client label', () => {
  // A client cannot call a PNG a "document" to get it served as a download.
  const check = validateChatAttachment('image/png', 1024);
  assert.equal(check.ok, true);
  assert.equal(check.ok && check.kind, 'image');
});

test('unsupported types are refused with a readable message', () => {
  for (const mime of [
    'application/zip',
    'application/vnd.ms-excel',
    'text/html',
    'application/x-msdownload',
    '',
  ]) {
    const check = validateChatAttachment(mime, 1024);
    assert.equal(check.ok, false, `${mime} should be refused`);
    assert.match(check.ok === false ? check.error : '', /images, videos, audio notes, PDFs or text files/);
  }
});

test('size caps hold per kind and are measured in bytes', () => {
  const cases: [string, 'image' | 'video' | 'document' | 'audio'][] = [
    ['image/jpeg', 'image'],
    ['video/mp4', 'video'],
    ['application/pdf', 'document'],
    ['audio/webm', 'audio'],
  ];
  for (const [mime, kind] of cases) {
    const limit = CHAT_SIZE_LIMITS[kind];
    assert.equal(validateChatAttachment(mime, limit).ok, true, `${kind} at its limit should pass`);
    const over = validateChatAttachment(mime, limit + 1);
    assert.equal(over.ok, false, `${kind} over its limit should fail`);
    assert.match(over.ok === false ? over.error : '', /too large/);
  }
});

test('empty files are refused', () => {
  const check = validateChatAttachment('image/png', 0);
  assert.equal(check.ok, false);
  assert.match(check.ok === false ? check.error : '', /empty/);
});

/* ------------------------------------------------------------------ */
/* Text messages                                                       */
/* ------------------------------------------------------------------ */

test('text messages must have content and stay within the cap', () => {
  assert.equal(chatTextError(undefined), 'Type a message first.');
  assert.equal(chatTextError(''), 'Type a message first.');
  assert.equal(chatTextError('   \n  '), 'Type a message first.');
  assert.equal(chatTextError('a'.repeat(MAX_CHAT_TEXT)), null);
  assert.match(chatTextError('a'.repeat(MAX_CHAT_TEXT + 1)) ?? '', /under 2000 characters/);
});

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

const conversation = { student_id: 'student-1', owner_id: 'owner-1' };

test('both participants can read and write their conversation', () => {
  for (const viewer of ['student-1', 'owner-1']) {
    assert.equal(canReadConversation(conversation, viewer), true);
    assert.equal(canWriteConversation(conversation, viewer), true);
  }
});

test('an unrelated account can do neither', () => {
  assert.equal(canReadConversation(conversation, 'student-2'), false);
  assert.equal(canWriteConversation(conversation, 'student-2'), false);
});

test('admins may read a thread for support but may not speak in it', () => {
  assert.equal(canReadConversation(conversation, 'admin-1', true), true);
  assert.equal(
    canWriteConversation(conversation, 'admin-1'),
    false,
    'replying as somebody else is exactly what chat must not allow'
  );
});

test('viewerSide names the side the viewer is on, or null', () => {
  assert.equal(viewerSide(conversation, 'student-1'), 'student');
  assert.equal(viewerSide(conversation, 'owner-1'), 'owner');
  assert.equal(viewerSide(conversation, 'someone-else'), null);
});

/* ------------------------------------------------------------------ */
/* R2 key layout                                                       */
/* ------------------------------------------------------------------ */

test('a chat key round-trips back to its conversation', () => {
  const id = 'c0ffee00-1234-4000-8000-000000000000';
  const key = `${chatKeyPrefix(id)}9f8b7a6c.webm`;
  assert.equal(key, `chat/${id}/9f8b7a6c.webm`);
  assert.equal(conversationIdFromKey(key), id);
});

test('non-chat keys never resolve to a conversation', () => {
  // Listing media and verification documents must stay on their own rules.
  for (const key of [
    'owners/abc/listing-images/pic.jpg',
    'verification/abc/doc.pdf',
    'avatars/abc/avatar.png',
    'chat',
    'chat/',
  ]) {
    assert.equal(conversationIdFromKey(key), null, `${key} is not a conversation-scoped key`);
  }
});

/* ------------------------------------------------------------------ */
/* Previews                                                            */
/* ------------------------------------------------------------------ */

test('attachment previews are labelled, text is truncated', () => {
  assert.equal(messagePreview('image', ''), 'Photo');
  assert.equal(messagePreview('video', ''), 'Video');
  assert.equal(messagePreview('document', ''), 'Document');
  assert.equal(messagePreview('audio', ''), 'Voice message');
  assert.equal(messagePreview('text', 'short note'), 'short note');
  const long = messagePreview('text', 'x'.repeat(200));
  assert.equal(long.length, 91); // 90 chars + the ellipsis
  assert.ok(long.endsWith('…'));
});

/* ------------------------------------------------------------------ */
/* Vocabulary parity                                                   */
/* ------------------------------------------------------------------ */

test('isChatKind accepts exactly the kind vocabulary', () => {
  for (const kind of CHAT_KINDS) assert.equal(isChatKind(kind), true);
  for (const bad of ['', 'photo', 'file', 'TEXT', null, 7, undefined]) {
    assert.equal(isChatKind(bad), false);
  }
});

/* ------------------------------------------------------------------ */
/* Enquiry replies                                                     */
/* ------------------------------------------------------------------ */

test('an enquiry reply names the PG the student asked about', () => {
  assert.equal(enquiryReplyLabel('Sunrise PG'), 'Reply to your enquiry about Sunrise PG');
});

test('an enquiry reply still reads sensibly when the PG is gone', () => {
  // The listing can be renamed or unpublished between the enquiry and the
  // reply; the label must not render "about null".
  assert.equal(enquiryReplyLabel(null), 'Reply to your enquiry');
  assert.equal(enquiryReplyLabel(undefined), 'Reply to your enquiry');
  assert.equal(enquiryReplyLabel(''), 'Reply to your enquiry');
});

test('migration 0014 tags conversations with the enquiry they answer', () => {
  const sql = readFileSync(join(here, '..', 'db', 'migrations', '0014_enquiry_reply.sql'), 'utf8');
  assert.match(
    sql,
    /ALTER TABLE conversations\s+ADD COLUMN enquiry_lead_id INTEGER REFERENCES leads\(id\)/,
    'the student\'s inbox label is stored on the conversation, so the column must exist'
  );
});

test('migration 0012 accepts exactly the kinds the code can write', () => {
  const sql = readFileSync(join(here, '..', 'db', 'migrations', '0012_chat.sql'), 'utf8');
  const match = /CHECK \(kind IN \(([^)]*)\)\)/.exec(sql);
  assert.ok(match, 'messages.kind should carry a CHECK constraint');

  const allowed = match![1]
    .split(',')
    .map((part) => part.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  assert.deepEqual([...allowed].sort(), [...CHAT_KINDS].sort());
});
