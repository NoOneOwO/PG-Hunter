/**
 * PG Hunter — admin inbox shaping tests.
 *
 * These lock in the two things that would otherwise mislead an admin:
 *
 *   1. The unread count must reflect every new item, even when the rendered
 *      list is capped — a backlog must not look smaller than it is.
 *   2. The read watermark is strict: an item created at exactly the watermark
 *      is not "new", so an admin does not see the same item counted forever.
 *
 * The pure module has no bindings, so it runs under plain Node.
 *
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INBOX_EPOCH,
  summariseInbox,
  type AdminInboxItem,
} from '../src/lib/adminInbox.ts';

const item = (id: string, at: string): AdminInboxItem => ({
  id,
  kind: 'listing',
  title: 'Listing awaiting approval',
  detail: 'Test',
  href: '/admin/pgs?status=pending',
  at,
});

test('items are ordered newest first', () => {
  const out = summariseInbox([
    item('a', '2026-01-01T00:00:00.000Z'),
    item('c', '2026-03-01T00:00:00.000Z'),
    item('b', '2026-02-01T00:00:00.000Z'),
  ]);
  assert.deepEqual(out.items.map((i) => i.id), ['c', 'b', 'a']);
});

test('unread counts items strictly newer than the watermark', () => {
  const watermark = '2026-02-01T00:00:00.000Z';
  const out = summariseInbox(
    [
      item('old', '2026-01-01T00:00:00.000Z'),
      item('edge', watermark), // exactly at the watermark -> not new
      item('new', '2026-03-01T00:00:00.000Z'),
    ],
    watermark
  );
  assert.equal(out.unread, 1);
});

test('with no watermark every item is unread', () => {
  const out = summariseInbox([item('a', '2026-01-01T00:00:00.000Z')], INBOX_EPOCH);
  assert.equal(out.unread, 1);
  assert.equal(out.lastSeenAt, INBOX_EPOCH);
});

test('the cap limits rendering but never the unread count', () => {
  const items = Array.from({ length: 30 }, (_, i) =>
    item(`i${i}`, `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`)
  );
  const out = summariseInbox(items, INBOX_EPOCH, 5);
  assert.equal(out.items.length, 5);
  assert.equal(out.unread, 30);
});

test('equal timestamps resolve deterministically by id', () => {
  const t = '2026-05-05T00:00:00.000Z';
  const out = summariseInbox([item('b', t), item('a', t)]);
  assert.deepEqual(out.items.map((i) => i.id), ['a', 'b']);
});
